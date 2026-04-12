-- migration: 008_auth.sql

-- 1. Add password_hash to recruiters (nullable — existing rows have no password yet)
ALTER TABLE chatbot.recruiters
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. Sessions table for cookie-based auth
CREATE TABLE IF NOT EXISTS chatbot.sessions (
  session_token  TEXT PRIMARY KEY,
  recruiter_id   TEXT NOT NULL REFERENCES chatbot.recruiters(recruiter_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days'
);

CREATE INDEX IF NOT EXISTS idx_sessions_recruiter_id
  ON chatbot.sessions(recruiter_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON chatbot.sessions(expires_at);
