-- Authentication, sessions and project assignments (Phase 2).
-- Roles mirror UserRole in src/types.ts; permissions per role live in code
-- (server/auth/permissions.ts, derived from src/utils/permissions.ts).

CREATE TABLE users (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL,
  -- scrypt hash ("scrypt$N$r$p$salt$hash"); never plaintext. NULL means no password login.
  password_hash text,
  auth_provider text NOT NULL DEFAULT 'password' CHECK (auth_provider IN ('password')),
  role          text NOT NULL CHECK (role IN (
                  'Owner / CEO', 'Admin', 'Project Manager', 'Site Supervisor', 'Purchasing',
                  'Accountant', 'Production Manager', 'Production Staff', 'Contractor', 'Client')),
  is_active     boolean NOT NULL DEFAULT true,
  -- Development seed accounts. The server refuses to log these in when NODE_ENV=production.
  is_dev_seed   boolean NOT NULL DEFAULT false,
  client_id     text REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- No contractors table yet; matches work_packages.contractor_id / work_items.contractor_id.
  contractor_id text,
  phone         text,
  department    text,
  title         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login    timestamptz,
  CONSTRAINT users_client_needs_client_id CHECK (role <> 'Client' OR client_id IS NOT NULL),
  CONSTRAINT users_contractor_needs_contractor_id CHECK (role <> 'Contractor' OR contractor_id IS NOT NULL)
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Server-side sessions. Only a SHA-256 hash of the cookie token is stored.
CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text,
  ip           text
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- Explicit project membership, on top of the links already on projects
-- (project_manager_id, site_supervisor_id) and work packages (contractor_id).
CREATE TABLE project_assignments (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE INDEX project_assignments_project_id_idx ON project_assignments (project_id);
