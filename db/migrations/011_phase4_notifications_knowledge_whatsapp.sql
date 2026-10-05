-- Phase 4: server-backed notifications (with automation rule de-duplication), the
-- production knowledge base with approval, and the WhatsApp gateway's contact registry
-- and message log (no provider is connected; identity comes only from this registry).

CREATE TABLE knowledge_articles (
  id          text PRIMARY KEY,
  status      text NOT NULL CHECK (status IN ('Draft', 'Review', 'Approved', 'Archived')),
  category    text,
  project_id  text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_by  text
);
CREATE INDEX knowledge_articles_status_idx ON knowledge_articles (status);

CREATE TABLE notifications (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title       text NOT NULL,
  message     text NOT NULL DEFAULT '',
  type        text NOT NULL DEFAULT 'info',
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
  project_id  text,
  link_tab    text,
  entity_type text,
  entity_id   text,
  -- Automation rule occurrence that raised it; one notification per user per occurrence.
  rule_key    text,
  is_read     boolean NOT NULL DEFAULT false,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, rule_key)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC);

CREATE TABLE whatsapp_contacts (
  phone       text PRIMARY KEY CHECK (phone ~ '^\+[0-9]{8,15}$'),
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  verified    boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_contacts_user_idx ON whatsapp_contacts (user_id);

CREATE TABLE whatsapp_messages (
  id          bigserial PRIMARY KEY,
  direction   text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  phone       text NOT NULL,
  user_id     text REFERENCES users (id) ON DELETE SET NULL,
  body        text NOT NULL,
  -- recognized | unknown_contact | inactive_user | provider_not_configured ...
  outcome     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
