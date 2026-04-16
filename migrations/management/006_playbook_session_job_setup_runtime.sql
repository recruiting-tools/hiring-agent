-- migration: 006_playbook_session_job_setup_runtime.sql
-- Tighten management.playbook_sessions runtime identity:
-- - job_setup_id is the only canonical runtime/setup key
-- - vacancy_id remains as a compatibility mirror only

UPDATE management.playbook_sessions
SET job_setup_id = COALESCE(
  job_setup_id,
  context ->> 'job_setup_id',
  vacancy_id,
  context ->> 'vacancy_id'
)
WHERE job_setup_id IS NULL;

DROP INDEX IF EXISTS idx_playbook_sessions_vacancy;
DROP INDEX IF EXISTS idx_playbook_sessions_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_playbook_sessions_active_job_setup_unique
  ON management.playbook_sessions (tenant_id, recruiter_id, job_setup_id, playbook_key)
  WHERE status = 'active' AND job_setup_id IS NOT NULL;
