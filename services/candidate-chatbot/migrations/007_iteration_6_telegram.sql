-- migration: 007_iteration_6_telegram.sql

-- 1. Add tg_chat_id to recruiters (nullable — recruiter may not have connected Telegram)
ALTER TABLE chatbot.recruiters
  ADD COLUMN IF NOT EXISTS tg_chat_id BIGINT;

-- 2. recruiter_subscriptions in management schema
CREATE TABLE IF NOT EXISTS management.recruiter_subscriptions (
  subscription_id  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  recruiter_id     TEXT NOT NULL,
  job_id           TEXT NOT NULL,
  step_index       INTEGER NOT NULL,
  event_type       TEXT NOT NULL DEFAULT 'step_completed',
  -- event_type: 'step_completed' | 'run_rejected'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recruiter_id, job_id, step_index, event_type)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_recruiter
  ON management.recruiter_subscriptions(recruiter_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_job_step
  ON management.recruiter_subscriptions(job_id, step_index);
