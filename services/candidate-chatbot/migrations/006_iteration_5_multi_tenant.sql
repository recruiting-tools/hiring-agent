-- migration: 006_iteration_5_multi_tenant.sql

-- 1. Management schema + clients table
CREATE SCHEMA IF NOT EXISTS management;

CREATE TABLE IF NOT EXISTS management.clients (
  client_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add client_id to chatbot tables (nullable — backward compat)
ALTER TABLE chatbot.jobs
  ADD COLUMN IF NOT EXISTS client_id TEXT;

ALTER TABLE chatbot.conversations
  ADD COLUMN IF NOT EXISTS client_id TEXT;

ALTER TABLE chatbot.pipeline_runs
  ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Optional index for scoped queries
CREATE INDEX IF NOT EXISTS idx_jobs_client_id           ON chatbot.jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client_id  ON chatbot.conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_client_id  ON chatbot.pipeline_runs(client_id);

-- 3. Seed demo clients
INSERT INTO management.clients (client_id, name)
VALUES
  ('client-alpha-001', 'Alpha Corp'),
  ('client-beta-001',  'Beta Ltd')
ON CONFLICT (client_id) DO NOTHING;

-- 4. Seed demo recruiters for both clients (idempotent)
INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token)
VALUES
  ('rec-alpha-001', 'client-alpha-001', 'alice@alpha.test', 'rec-tok-alpha-001'),
  ('rec-alpha-002', 'client-alpha-001', 'alex@alpha.test',  'rec-tok-alpha-002'),
  ('rec-beta-001',  'client-beta-001',  'bob@beta.test',    'rec-tok-beta-001'),
  ('rec-beta-002',  'client-beta-001',  'bella@beta.test',  'rec-tok-beta-002')
ON CONFLICT (recruiter_id) DO UPDATE SET
  client_id       = EXCLUDED.client_id,
  recruiter_token = EXCLUDED.recruiter_token;
