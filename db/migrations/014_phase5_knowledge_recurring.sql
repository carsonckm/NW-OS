-- Phase 5: the knowledge base becomes the company's approved operating memory, and
-- recurring problems are detected from live records (suggestions only; a person decides).

-- Revisions: a published article is never rewritten. A new revision is written as a Draft
-- that supersedes it; when the new revision is approved the old one is archived.
ALTER TABLE knowledge_articles
  ADD COLUMN revision      integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD COLUMN supersedes_id text REFERENCES knowledge_articles (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX knowledge_articles_supersedes_idx ON knowledge_articles (supersedes_id);
CREATE INDEX knowledge_articles_status_category_idx ON knowledge_articles (status, category);

-- Where an approved article was applied (an issue, task, QC, production order ...).
CREATE TABLE knowledge_usage (
  id          bigserial PRIMARY KEY,
  article_id  text NOT NULL REFERENCES knowledge_articles (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  user_id     text NOT NULL,
  project_id  text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  entity_type text,
  entity_id   text,
  note        text,
  used_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_usage_article_idx ON knowledge_usage (article_id, used_at DESC);

-- A person's decision on a detected recurring problem (the detector never acts on its own).
CREATE TABLE recurring_problem_reviews (
  pattern_key  text PRIMARY KEY,
  decision     text NOT NULL CHECK (decision IN ('Knowledge drafted', 'Action taken', 'Dismissed')),
  note         text,
  article_id   text REFERENCES knowledge_articles (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  occurrences  integer NOT NULL,
  decided_by   text NOT NULL,
  decided_at   timestamptz NOT NULL DEFAULT now()
);
