-- Phase 6 Batch 12B: trusted identity in the database.
--
-- Before this migration the runtime role (nwos_app) could insert a session row for any user,
-- change any user's role, and write assignments, authority rules and Owner absences directly:
-- whoever held its password could become the Owner. Now the database itself decides who is
-- acting, from evidence the runtime credential alone cannot produce:
--
--  1. Credentials and sessions are owner-only tables. nwos_app has no privilege on them. It can
--     only call a few SECURITY DEFINER functions (search_path pinned): auth_password_params,
--     auth_login, auth_session, auth_logout, auth_assume, auth_set_password, auth_purge_expired.
--     A session is created only by auth_login, which verifies the password-derived key, and the
--     token is generated inside the database. Failed attempts are limited in the database.
--  2. Passwords: the server derives a key with scrypt (memory-hard); the database keeps only
--     sha256(derived key), salt and parameters, in auth_credentials. Nothing stored there can be
--     presented to auth_login. Existing password hashes are NOT carried over: before this
--     migration users.password_hash held the scrypt key itself, readable with the runtime
--     credential, and a converted hash would let anyone who copied it sign in. Every account
--     therefore starts without a credential and sets a new password with an individual,
--     single-use, expiring code (auth_reset_tokens): the Owner through the operator's recovery
--     procedure (migrator credential), staff from codes the Owner (or an Admin, for ordinary
--     staff) issues. (pgcrypto is not used: an extension is installed once per database, outside
--     NW OS's schema, and is not needed for this.)
--  3. Identity per transaction: auth_assume(session token) records, in an owner-only table keyed
--     by (backend pid, transaction id), which signed-in user this transaction acts for. Nothing the
--     application says about a user id or role is trusted, and an identity can never carry over to
--     another transaction on a pooled connection (a new transaction has a new id).
--  4. Guards (triggers, SECURITY DEFINER) on the security-critical records: users, project
--     assignments, authority rules, Owner absences, WhatsApp contact mappings, project sensitivity
--     and legacy review decisions. A change needs a verified identity with the right role; the
--     background jobs (no identity) may only make changes the database can check itself:
--     switching authority off, starting an Owner absence whose start time has passed, ending one
--     whose end time has passed. Roles that own the tables (migrator, administrator) are not
--     checked: they could drop the triggers anyway, and they are never the runtime credential.
--  5. audit_logs.actor_verified: true when the row's actor is the transaction's verified identity.
--  6. Cut-over: every existing session is ended, every old password hash is dropped, and every
--     account needs a new password (activation code) before it can sign in.

-- ---------------------------------------------------------------- owner-only tables
CREATE TABLE auth_credentials (
  user_id     text PRIMARY KEY REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  scheme      text NOT NULL CHECK (scheme = 'scrypt'),
  params      jsonb NOT NULL,
  salt        text NOT NULL,
  -- hex sha256 of the scrypt-derived key; the key and the password are never stored.
  verifier    text NOT NULL CHECK (verifier ~ '^[0-9a-f]{64}$'),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Old password hashes are dropped, never converted (see 2. above): every account needs a new
-- password. Identities, roles, assignments and history are untouched.
ALTER TABLE users DROP COLUMN password_hash;

CREATE TABLE auth_config (key text PRIMARY KEY, value text NOT NULL);
-- Salts shown for unknown emails are derived from this, so they do not reveal which emails exist.
INSERT INTO auth_config VALUES ('unknown_email_salt_secret', encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'));

CREATE TABLE auth_login_failures (
  user_id  text NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_login_failures_user_idx ON auth_login_failures (user_id, at);

-- Activation / reset codes: individual, single-use, expiring. Only the code's sha256 is kept; the
-- code itself is shown once to whoever issued it, to hand to the account holder.
CREATE TABLE auth_reset_tokens (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('activation', 'reset', 'owner_recovery')),
  issued_by   text NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX auth_reset_tokens_user_idx ON auth_reset_tokens (user_id);

CREATE UNLOGGED TABLE auth_tx_identity (
  backend_pid  integer NOT NULL,
  txid         bigint NOT NULL,
  user_id      text NOT NULL,
  session_hash text NOT NULL,
  assumed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (backend_pid, txid)
);

-- Cut-over: sessions created before the database verified passwords are not trusted.
DELETE FROM sessions;

ALTER TABLE audit_logs ADD COLUMN actor_verified boolean;

-- ---------------------------------------------------------------- internal helpers (not callable by nwos_app)
-- Whether the connected login can act as the owner of a table (migrator, administrator): those
-- roles are not checked. nwos_app never can.
CREATE FUNCTION auth_exempt(rel oid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT pg_has_role(session_user, (SELECT relowner FROM pg_class WHERE oid = rel), 'MEMBER')
$$;

CREATE FUNCTION auth_token_hash(p_token text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;

-- The verified identity of the current transaction: its user must still be active and its session
-- still valid (a revoked or expired session stops authorizing at once).
CREATE FUNCTION auth_identity(OUT user_id text, OUT role text) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.role
    FROM auth_tx_identity i
    JOIN users u ON u.id = i.user_id AND u.is_active
    JOIN sessions s ON s.token_hash = i.session_hash AND s.user_id = u.id AND s.expires_at > now()
   WHERE i.backend_pid = pg_backend_pid() AND i.txid = txid_current()
$$;

CREATE FUNCTION auth_refuse(what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%', what USING ERRCODE = 'NWA01';
END $$;

-- ---------------------------------------------------------------- the API nwos_app may call
CREATE FUNCTION auth_password_params(p_email text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE c auth_credentials%ROWTYPE;
BEGIN
  SELECT ac.* INTO c FROM auth_credentials ac JOIN users u ON u.id = ac.user_id WHERE lower(u.email) = lower(btrim(p_email));
  IF FOUND THEN
    RETURN jsonb_build_object('scheme', c.scheme, 'salt', c.salt) || c.params;
  END IF;
  -- Unknown email: stable, plausible parameters (the server does the same work either way).
  RETURN jsonb_build_object('scheme', 'scrypt', 'N', 32768, 'r', 8, 'p', 1, 'keylen', 64, 'salt',
    rtrim(translate(encode(substr(sha256(convert_to((SELECT value FROM auth_config WHERE key = 'unknown_email_salt_secret') || lower(btrim(p_email)), 'UTF8')), 1, 16), 'base64'), '+/', '-_'), '='));
END $$;

CREATE FUNCTION auth_login(p_email text, p_key_hex text, p_user_agent text, p_ip text,
  OUT status text, OUT token text, OUT user_id text, OUT expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  u users%ROWTYPE;
  c auth_credentials%ROWTYPE;
  has_credential boolean;
  given text;
BEGIN
  SELECT * INTO u FROM users WHERE lower(email) = lower(btrim(p_email));
  IF NOT FOUND THEN status := 'invalid'; RETURN; END IF;
  -- At most 10 failed attempts per account in 15 minutes.
  IF (SELECT count(*) FROM auth_login_failures f WHERE f.user_id = u.id AND f.at > now() - interval '15 minutes') >= 10 THEN
    status := 'locked'; RETURN;
  END IF;
  SELECT * INTO c FROM auth_credentials WHERE auth_credentials.user_id = u.id;
  has_credential := FOUND;
  BEGIN
    given := encode(sha256(decode(p_key_hex, 'hex')), 'hex');
  EXCEPTION WHEN OTHERS THEN
    given := NULL;
  END;
  IF NOT has_credential OR given IS NULL OR c.verifier IS NULL OR given <> c.verifier THEN
    INSERT INTO auth_login_failures (user_id) VALUES (u.id);
    status := 'invalid'; RETURN;
  END IF;
  IF NOT u.is_active THEN status := 'inactive'; user_id := u.id; RETURN; END IF;
  DELETE FROM auth_login_failures f WHERE f.user_id = u.id;
  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  expires_at := now() + interval '12 hours';
  INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip) VALUES (auth_token_hash(token), u.id, expires_at, left(p_user_agent, 300), left(p_ip, 100));
  UPDATE users SET last_login = now() WHERE id = u.id;
  user_id := u.id;
  status := 'ok';
END $$;

-- The session's user (sliding 12-hour expiry, 7-day absolute limit), or no row.
CREATE FUNCTION auth_session(p_token text) RETURNS TABLE (
  id text, name text, email text, role text, is_active boolean, is_dev_seed boolean, client_id text, contractor_id text,
  phone text, department text, title text, created_at timestamptz, updated_at timestamptz, last_login timestamptz
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM sessions WHERE token_hash = auth_token_hash(p_token) AND sessions.expires_at > now();
  IF NOT FOUND THEN RETURN; END IF;
  IF s.created_at < now() - interval '7 days' THEN
    DELETE FROM sessions WHERE token_hash = s.token_hash;
    RETURN;
  END IF;
  IF s.last_seen_at < now() - interval '5 minutes' THEN
    UPDATE sessions SET last_seen_at = now(), expires_at = now() + interval '12 hours' WHERE token_hash = s.token_hash;
  END IF;
  RETURN QUERY SELECT u.id, u.name, u.email, u.role, u.is_active, u.is_dev_seed, u.client_id, u.contractor_id, u.phone, u.department, u.title, u.created_at, u.updated_at, u.last_login
                 FROM users u WHERE u.id = s.user_id AND u.is_active;
END $$;

CREATE FUNCTION auth_logout(p_token text) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM sessions WHERE token_hash = auth_token_hash(p_token)
$$;

-- This transaction acts for the session's user. Refused for an invalid session; one identity per
-- transaction.
CREATE FUNCTION auth_assume(p_token text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  h text := auth_token_hash(p_token);
  uid text;
  prev text;
BEGIN
  SELECT s.user_id INTO uid FROM sessions s JOIN users u ON u.id = s.user_id AND u.is_active
   WHERE s.token_hash = h AND s.expires_at > now() AND s.created_at > now() - interval '7 days';
  IF uid IS NULL THEN PERFORM auth_refuse('The session is not valid'); END IF;
  SELECT i.user_id INTO prev FROM auth_tx_identity i WHERE i.backend_pid = pg_backend_pid() AND i.txid = txid_current();
  IF prev IS NOT NULL AND prev <> uid THEN PERFORM auth_refuse('This transaction already acts for another user'); END IF;
  -- Older transactions of this connection are over: their identity is removed.
  DELETE FROM auth_tx_identity WHERE backend_pid = pg_backend_pid() AND txid <> txid_current();
  INSERT INTO auth_tx_identity (backend_pid, txid, user_id, session_hash) VALUES (pg_backend_pid(), txid_current(), uid, h)
    ON CONFLICT (backend_pid, txid) DO NOTHING;
  RETURN uid;
END $$;

-- The scrypt parameters and key a new credential is made from, checked and normalized: never
-- weaker than the server's own (N >= 2^15, r >= 8, p >= 1, a 32-128 byte key, a 16+ byte salt).
CREATE FUNCTION auth_checked_params(p_params jsonb, p_salt text, p_key_hex text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  n int; r int; p int; k int;
BEGIN
  BEGIN
    n := (p_params->>'N')::int; r := (p_params->>'r')::int; p := (p_params->>'p')::int; k := (p_params->>'keylen')::int;
  EXCEPTION WHEN OTHERS THEN
    PERFORM auth_refuse('Invalid password parameters');
  END;
  IF n IS NULL OR r IS NULL OR p IS NULL OR k IS NULL OR n < 32768 OR (n & (n - 1)) <> 0 OR r < 8 OR p < 1 OR p > 16 OR k < 32 OR k > 128
     OR coalesce(length(p_salt), 0) < 22 OR p_key_hex IS NULL OR p_key_hex !~ '^[0-9a-f]+$' OR length(p_key_hex) <> 2 * k THEN
    PERFORM auth_refuse('Invalid password parameters');
  END IF;
  RETURN jsonb_build_object('N', n, 'r', r, 'p', p, 'keylen', k);
END $$;

-- An audit record written by the database itself (durable evidence of credential events).
CREATE FUNCTION auth_audit(p_actor_id text, p_action text, p_user_id text, p_after jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, after, details)
  SELECT a.id, coalesce(a.name, 'operator ' || session_user), coalesce(a.role, 'database operator'), p_action, 'user', p_user_id, p_after,
         CASE WHEN a.id IS NULL THEN 'by database role ' || session_user END
    FROM (SELECT 1) one LEFT JOIN users a ON a.id = p_actor_id
$$;

-- Sets a password directly: only the roles that own the tables (development seed, test fixtures).
-- People set their own password with an activation code (auth_activate).
CREATE FUNCTION auth_set_password(p_user_id text, p_params jsonb, p_salt text, p_key_hex text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE params jsonb;
BEGIN
  IF NOT auth_exempt('users'::regclass) THEN
    PERFORM auth_refuse('Passwords are set by their owner with an activation code');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN PERFORM auth_refuse('Unknown user'); END IF;
  params := auth_checked_params(p_params, p_salt, p_key_hex);
  INSERT INTO auth_credentials (user_id, scheme, params, salt, verifier, updated_at)
  VALUES (p_user_id, 'scrypt', params, p_salt, encode(sha256(decode(p_key_hex, 'hex')), 'hex'), now())
  ON CONFLICT (user_id) DO UPDATE SET params = EXCLUDED.params, salt = EXCLUDED.salt, verifier = EXCLUDED.verifier, updated_at = now();
  DELETE FROM sessions WHERE sessions.user_id = p_user_id;
  DELETE FROM auth_login_failures WHERE auth_login_failures.user_id = p_user_id;
  DELETE FROM auth_reset_tokens WHERE auth_reset_tokens.user_id = p_user_id AND used_at IS NULL;
END $$;

-- Issues an activation / reset code for an account and returns it once. The account's password
-- and sessions end at once, and any earlier unused code is withdrawn: it signs in again only after
-- its holder sets a new password with this code. Never changes a role or authority.
--   The verified Owner: any other account. A verified Admin: other accounts that are neither Owner
--   nor Admin. The migrator / administrator credential: any account (Owner recovery, new
--   installations). Nobody else, and never one's own account (that is the recovery procedure).
CREATE FUNCTION auth_issue_reset(p_user_id text, p_purpose text, p_valid_minutes integer,
  OUT token text, OUT expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  me record;
  target users%ROWTYPE;
  issuer text;
  actor text;
BEGIN
  SELECT * INTO target FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN PERFORM auth_refuse('Unknown user'); END IF;
  IF p_purpose IS NULL OR p_purpose NOT IN ('activation', 'reset', 'owner_recovery') THEN PERFORM auth_refuse('Unknown code purpose'); END IF;
  IF p_valid_minutes IS NULL OR p_valid_minutes < 5 OR p_valid_minutes > 4320 THEN PERFORM auth_refuse('A code is valid for 5 minutes to 3 days'); END IF;
  IF auth_exempt('users'::regclass) THEN
    issuer := 'operator ' || session_user;
  ELSE
    IF p_purpose = 'owner_recovery' THEN PERFORM auth_refuse('Owner recovery needs the operator''s administrative credential'); END IF;
    SELECT * INTO me FROM auth_identity();
    IF me.user_id IS NULL THEN PERFORM auth_refuse('Issuing a code needs a signed-in Owner or Admin (database-verified)'); END IF;
    IF me.user_id = target.id THEN PERFORM auth_refuse('You cannot reset your own account'); END IF;
    IF me.role = 'Admin' THEN
      IF target.role IN ('Owner / CEO', 'Admin') THEN PERFORM auth_refuse('An Admin cannot reset an Owner or Admin'); END IF;
    ELSIF me.role <> 'Owner / CEO' THEN
      PERFORM auth_refuse('Only an Owner or Admin can reset accounts');
    END IF;
    issuer := me.user_id;
    actor := me.user_id;
  END IF;
  IF NOT target.is_active THEN PERFORM auth_refuse('The account is deactivated: reactivate it first'); END IF;
  DELETE FROM auth_credentials WHERE auth_credentials.user_id = target.id;
  DELETE FROM sessions WHERE sessions.user_id = target.id;
  DELETE FROM auth_reset_tokens WHERE auth_reset_tokens.user_id = target.id AND used_at IS NULL;
  token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  expires_at := now() + make_interval(mins => p_valid_minutes);
  INSERT INTO auth_reset_tokens (token_hash, user_id, purpose, issued_by, expires_at) VALUES (auth_token_hash(token), target.id, p_purpose, issuer, expires_at);
  PERFORM auth_audit(actor, 'auth.code_issued', target.id,
    jsonb_build_object('purpose', p_purpose, 'expires_at', expires_at, 'issued_by', issuer, 'password', '(removed)', 'sessions', '(ended)'));
END $$;

-- Sets the account's new password with an activation / reset code: the code must belong to this
-- email, be unused and unexpired, and the account active. Single use; ends any sessions.
-- Returns ok, invalid (unknown, used or another account's code), expired or inactive.
CREATE FUNCTION auth_activate(p_email text, p_token text, p_params jsonb, p_salt text, p_key_hex text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  t auth_reset_tokens%ROWTYPE;
  u users%ROWTYPE;
  params jsonb;
BEGIN
  SELECT rt.* INTO t FROM auth_reset_tokens rt JOIN users us ON us.id = rt.user_id
   WHERE rt.token_hash = auth_token_hash(coalesce(p_token, '')) AND lower(us.email) = lower(btrim(coalesce(p_email, '')))
   FOR UPDATE OF rt;
  IF NOT FOUND OR t.used_at IS NOT NULL THEN RETURN 'invalid'; END IF;
  IF t.expires_at <= now() THEN RETURN 'expired'; END IF;
  SELECT * INTO u FROM users WHERE id = t.user_id;
  IF NOT u.is_active THEN RETURN 'inactive'; END IF;
  params := auth_checked_params(p_params, p_salt, p_key_hex);
  UPDATE auth_reset_tokens SET used_at = now() WHERE token_hash = t.token_hash;
  DELETE FROM auth_reset_tokens WHERE auth_reset_tokens.user_id = u.id AND used_at IS NULL;
  INSERT INTO auth_credentials (user_id, scheme, params, salt, verifier, updated_at)
  VALUES (u.id, 'scrypt', params, p_salt, encode(sha256(decode(p_key_hex, 'hex')), 'hex'), now())
  ON CONFLICT (user_id) DO UPDATE SET params = EXCLUDED.params, salt = EXCLUDED.salt, verifier = EXCLUDED.verifier, updated_at = now();
  DELETE FROM sessions WHERE sessions.user_id = u.id;
  DELETE FROM auth_login_failures WHERE auth_login_failures.user_id = u.id;
  PERFORM auth_audit(u.id, 'auth.password_set', u.id, jsonb_build_object('purpose', t.purpose, 'code_issued_by', t.issued_by, 'code_issued_at', t.issued_at));
  RETURN 'ok';
END $$;

-- Which accounts have a password, and which wait for an activation code (no secrets).
CREATE FUNCTION auth_account_status() RETURNS TABLE (user_id text, has_password boolean, password_set_at timestamptz, code_purpose text, code_expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, c.user_id IS NOT NULL, c.updated_at, t.purpose, t.expires_at
    FROM users u
    LEFT JOIN auth_credentials c ON c.user_id = u.id
    LEFT JOIN LATERAL (SELECT rt.purpose, rt.expires_at FROM auth_reset_tokens rt WHERE rt.user_id = u.id AND rt.used_at IS NULL AND rt.expires_at > now() ORDER BY rt.issued_at DESC LIMIT 1) t ON true
$$;

CREATE FUNCTION auth_purge_expired() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n integer;
BEGIN
  DELETE FROM sessions WHERE expires_at < now() OR created_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM auth_login_failures WHERE at < now() - interval '1 day';
  DELETE FROM auth_reset_tokens WHERE (used_at IS NOT NULL AND used_at < now() - interval '30 days') OR expires_at < now() - interval '30 days';
  RETURN n;
END $$;

-- ---------------------------------------------------------------- guards
CREATE FUNCTION auth_guard_users() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  me record;
  managed CONSTANT text[] := ARRAY['Owner / CEO', 'Admin'];
BEGIN
  IF auth_exempt(TG_RELID) THEN RETURN coalesce(NEW, OLD); END IF;
  -- Signing in records the time (auth_login); nothing else changes without an identity.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - ARRAY['last_login', 'updated_at']) = (to_jsonb(OLD) - ARRAY['last_login', 'updated_at']) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO me FROM auth_identity();
  IF me.user_id IS NULL THEN PERFORM auth_refuse('Changing a user needs a signed-in Owner or Admin (database-verified)'); END IF;
  IF TG_OP = 'DELETE' THEN PERFORM auth_refuse('Users are deactivated, never deleted'); END IF;
  IF me.role = 'Owner / CEO' THEN
    NULL;
  ELSIF me.role = 'Admin' THEN
    IF NEW.role = ANY (managed) OR (TG_OP = 'UPDATE' AND OLD.role = ANY (managed)) THEN
      PERFORM auth_refuse('An Admin cannot create or change Owner or Admin accounts');
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.owner_priority IS DISTINCT FROM OLD.owner_priority OR NEW.is_primary_owner IS DISTINCT FROM OLD.is_primary_owner OR NEW.is_dev_seed IS DISTINCT FROM OLD.is_dev_seed) THEN
      PERFORM auth_refuse('Only the Owner changes these settings');
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.is_primary_owner OR NEW.owner_priority <> 0 OR NEW.is_dev_seed) THEN
      PERFORM auth_refuse('Only the Owner changes these settings');
    END IF;
  ELSE
    PERFORM auth_refuse('Only an Owner or Admin can create or change users');
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.id = me.user_id AND (NEW.role IS DISTINCT FROM OLD.role OR NOT NEW.is_active) THEN
    PERFORM auth_refuse('You cannot change your own role or deactivate yourself');
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'Owner / CEO' AND OLD.is_active AND (NEW.role <> 'Owner / CEO' OR NOT NEW.is_active)
     AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'Owner / CEO' AND is_active AND id <> OLD.id) THEN
    PERFORM auth_refuse('The last active Owner cannot be removed');
  END IF;
  RETURN NEW;
END $$;

-- A changed role, deactivation or client / contractor link ends the user's sessions.
CREATE FUNCTION auth_users_end_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.contractor_id IS DISTINCT FROM OLD.contractor_id THEN
    DELETE FROM sessions WHERE sessions.user_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER users_auth_guard BEFORE INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION auth_guard_users();
CREATE TRIGGER users_auth_end_sessions AFTER UPDATE ON users FOR EACH ROW EXECUTE FUNCTION auth_users_end_sessions();

-- Owner or Admin; an Admin not for Owner / Admin accounts.
CREATE FUNCTION auth_guard_user_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  me record;
  target_role text;
BEGIN
  IF auth_exempt(TG_RELID) THEN RETURN coalesce(NEW, OLD); END IF;
  SELECT * INTO me FROM auth_identity();
  IF me.user_id IS NULL THEN PERFORM auth_refuse(format('Changing %s needs a signed-in Owner or Admin (database-verified)', TG_TABLE_NAME)); END IF;
  IF me.role = 'Owner / CEO' THEN RETURN coalesce(NEW, OLD); END IF;
  IF me.role <> 'Admin' THEN PERFORM auth_refuse(format('Only an Owner or Admin can change %s', TG_TABLE_NAME)); END IF;
  SELECT u.role INTO target_role FROM users u WHERE u.id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END);
  IF target_role IN ('Owner / CEO', 'Admin') OR (TG_OP = 'UPDATE' AND (SELECT u.role FROM users u WHERE u.id = OLD.user_id) IN ('Owner / CEO', 'Admin')) THEN
    PERFORM auth_refuse(format('An Admin cannot change %s of an Owner or Admin', TG_TABLE_NAME));
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

CREATE TRIGGER project_assignments_auth_guard BEFORE INSERT OR UPDATE OR DELETE ON project_assignments FOR EACH ROW EXECUTE FUNCTION auth_guard_user_link();
CREATE TRIGGER whatsapp_contacts_auth_guard BEFORE INSERT OR UPDATE OR DELETE ON whatsapp_contacts FOR EACH ROW EXECUTE FUNCTION auth_guard_user_link();

-- Authority rules: the Owner. Without an identity only switching authority off (the background
-- watch: expiry, an ended absence), never on, never anything else.
CREATE FUNCTION auth_guard_delegated_authorities() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  me record;
  off_fields CONSTANT text[] := ARRAY['active', 'deactivated_at', 'deactivation_reason', 'expiry_processed_at', 'updated_at'];
BEGIN
  IF auth_exempt(TG_RELID) THEN RETURN coalesce(NEW, OLD); END IF;
  SELECT * INTO me FROM auth_identity();
  IF me.role = 'Owner / CEO' THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND me.user_id IS NULL
     AND (to_jsonb(NEW) - off_fields) = (to_jsonb(OLD) - off_fields)
     AND NOT (NEW.active AND NOT OLD.active)
     AND (OLD.expiry_processed_at IS NULL OR NEW.expiry_processed_at IS NOT DISTINCT FROM OLD.expiry_processed_at) THEN
    RETURN NEW;
  END IF;
  PERFORM auth_refuse('Changing authority rules needs the signed-in Owner (database-verified)');
  RETURN NULL;
END $$;
CREATE TRIGGER delegated_authorities_auth_guard BEFORE INSERT OR UPDATE OR DELETE ON delegated_authorities FOR EACH ROW EXECUTE FUNCTION auth_guard_delegated_authorities();

-- Owner absences: the Owner. Without an identity only what the dates already decided: start a
-- scheduled absence whose start has passed, end one whose end has passed.
CREATE FUNCTION auth_guard_owner_absences() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me record;
BEGIN
  IF auth_exempt(TG_RELID) THEN RETURN coalesce(NEW, OLD); END IF;
  SELECT * INTO me FROM auth_identity();
  IF me.role = 'Owner / CEO' THEN RETURN coalesce(NEW, OLD); END IF;
  IF TG_OP = 'UPDATE' AND me.user_id IS NULL THEN
    IF OLD.status = 'scheduled' AND NEW.status = 'active' AND OLD.start_at <= now()
       AND (to_jsonb(NEW) - ARRAY['status', 'activated_at']) = (to_jsonb(OLD) - ARRAY['status', 'activated_at']) THEN
      RETURN NEW;
    END IF;
    IF OLD.status IN ('scheduled', 'active') AND NEW.status IN ('ended', 'cancelled') AND OLD.end_at <= now() AND NEW.ended_by IS NULL
       AND (to_jsonb(NEW) - ARRAY['status', 'ended_at', 'ended_by', 'end_reason']) = (to_jsonb(OLD) - ARRAY['status', 'ended_at', 'ended_by', 'end_reason']) THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM auth_refuse('Changing Owner absences needs the signed-in Owner (database-verified)');
  RETURN NULL;
END $$;
CREATE TRIGGER owner_absences_auth_guard BEFORE INSERT OR UPDATE OR DELETE ON owner_absences FOR EACH ROW EXECUTE FUNCTION auth_guard_owner_absences();

-- Project sensitivity is the authority ceiling: only the Owner raises or lowers it.
CREATE FUNCTION auth_guard_project_sensitivity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me record;
BEGIN
  IF auth_exempt(TG_RELID) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.sensitivity = 'Normal' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.sensitivity IS NOT DISTINCT FROM OLD.sensitivity THEN RETURN NEW; END IF;
  SELECT * INTO me FROM auth_identity();
  IF me.role IS DISTINCT FROM 'Owner / CEO' THEN PERFORM auth_refuse('Changing project sensitivity needs the signed-in Owner (database-verified)'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER projects_sensitivity_auth_guard BEFORE INSERT OR UPDATE OF sensitivity ON projects FOR EACH ROW EXECUTE FUNCTION auth_guard_project_sensitivity();

-- A legacy review decision is the signed-in Owner's own.
CREATE FUNCTION auth_guard_legacy_review_decisions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me record;
BEGIN
  IF auth_exempt(TG_RELID) THEN RETURN NEW; END IF;
  SELECT * INTO me FROM auth_identity();
  IF me.role IS DISTINCT FROM 'Owner / CEO' OR NEW.reviewed_by_id IS DISTINCT FROM me.user_id OR NEW.reviewed_by_role IS DISTINCT FROM me.role THEN
    PERFORM auth_refuse('A legacy review decision is recorded by the signed-in Owner (database-verified)');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legacy_review_decisions_auth_guard BEFORE INSERT ON legacy_review_decisions FOR EACH ROW EXECUTE FUNCTION auth_guard_legacy_review_decisions();

-- Audit rows say whether their actor is this transaction's verified identity.
CREATE FUNCTION auth_audit_actor_verified() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.actor_verified := coalesce(NEW.actor_id = (SELECT user_id FROM auth_identity()), false);
  RETURN NEW;
END $$;
CREATE TRIGGER audit_logs_actor_verified BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION auth_audit_actor_verified();

-- Every SECURITY DEFINER function resolves names in this schema only (pg_temp last), so a
-- caller cannot shadow a table with a temporary one.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema() AND p.prosecdef LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = %I, pg_temp', f.sig, current_schema());
  END LOOP;
END $$;
