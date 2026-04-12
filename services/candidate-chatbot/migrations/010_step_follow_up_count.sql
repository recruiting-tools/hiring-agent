-- migration: 010_step_follow_up_count.sql
-- Adds follow_up_count to pipeline_step_state so the runtime can enforce
-- per-step follow-up limits without re-scanning pipeline_events.

ALTER TABLE chatbot.pipeline_step_state
  ADD COLUMN IF NOT EXISTS follow_up_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN chatbot.pipeline_step_state.follow_up_count IS
  'Number of follow-up messages sent for this step. Incremented by cron-sender. '
  'Compared against step.follow_up_max to enforce per-step follow-up limits.';
