-- Phase 6 Batch 7: the AI operating layer (docs/phase6-ai-operating-layer.md).
--
-- One row per AI request made through the server-side AI gateway: who asked (from the session),
-- which versioned task and prompt ran, which provider/model answered (or why it did not), the
-- structured result shown to the person, the NW OS records it cites, the actions it suggested and
-- what happened to them. It is the audit/debug trail of the AI layer and the basis of its per-user
-- usage limits. It never holds secrets (no keys, no raw provider payloads) and grants nothing:
-- authority stays with the authority resolver, and a suggested action only runs through the
-- existing "AI Proposal" approval.

CREATE TABLE ai_conversations (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  user_role       text NOT NULL,
  -- The versioned task definition (server/ai/tasks.ts), e.g. assistant_query / assistant_query_v1.
  task            text NOT NULL CHECK (task IN ('assistant_query', 'daily_briefing', 'project_summary', 'issue_analysis', 'drawing_analysis', 'commercial_analysis')),
  prompt_version  text NOT NULL,
  project_id      text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  request_id      text NOT NULL UNIQUE,
  -- ok: the model answered and passed validation; fallback: the deterministic NW OS answer was
  -- shown (model unavailable, failed or invalid); refused: a forbidden request, never sent to a
  -- model; rate_limited: over the usage limit, never sent; error: nothing could be answered.
  status          text NOT NULL CHECK (status IN ('ok', 'fallback', 'refused', 'rate_limited', 'error')),
  fallback_reason text,
  provider        text,
  model           text,
  -- Whether a model was actually called (counts towards the usage limit).
  model_called    boolean NOT NULL DEFAULT false,
  question        text,
  result          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The NW OS records the answer cites: [{type, id, project_id}]. Only records in the asker's scope.
  evidence        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Suggested actions and their state: [{index, action, summary, params, state, approval_id, ...}].
  -- state: suggested -> proposed (an AI Proposal approval exists) | dismissed.
  proposals       jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage           jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms      integer,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (user_id, created_at DESC);
CREATE INDEX ai_conversations_usage_idx ON ai_conversations (user_id, task, created_at) WHERE model_called;
CREATE INDEX ai_conversations_created_idx ON ai_conversations (created_at);
