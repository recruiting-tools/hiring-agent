-- migration: 005_playbook_session_job_identity.sql
-- Additive identity split for playbook runtime:
-- - job_id is the canonical external business identifier
-- - job_setup_id is the internal recruiter setup/runtime key
-- - vacancy_id remains as a temporary compatibility alias

ALTER TABLE management.playbook_sessions
  ADD COLUMN IF NOT EXISTS job_id TEXT,
  ADD COLUMN IF NOT EXISTS job_setup_id TEXT;

UPDATE management.playbook_sessions
SET
  job_setup_id = COALESCE(job_setup_id, vacancy_id),
  job_id = COALESCE(job_id, context ->> 'job_id')
WHERE job_setup_id IS NULL
   OR job_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_playbook_sessions_job
  ON management.playbook_sessions (tenant_id, job_id, status)
  WHERE status = 'active' AND job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playbook_sessions_job_setup
  ON management.playbook_sessions (tenant_id, job_setup_id, status)
  WHERE status = 'active' AND job_setup_id IS NOT NULL;
