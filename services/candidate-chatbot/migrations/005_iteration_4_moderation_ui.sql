-- migration: 005_iteration_4_moderation_ui.sql

CREATE TABLE IF NOT EXISTS chatbot.recruiters (
  recruiter_id    TEXT PRIMARY KEY,
  client_id       TEXT,
  email           TEXT,
  recruiter_token TEXT UNIQUE NOT NULL
);

-- Seed demo recruiter
INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token)
VALUES ('recruiter-demo-001', 'client-demo-001', 'recruiter@example.test', 'rec-tok-demo-001')
ON CONFLICT (recruiter_id) DO UPDATE SET recruiter_token = EXCLUDED.recruiter_token;
