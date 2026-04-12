-- migration: 001_iteration_2_client_schema.sql

CREATE SCHEMA IF NOT EXISTS chatbot;

CREATE TABLE chatbot.jobs (
  job_id         TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.pipeline_templates (
  template_id      TEXT PRIMARY KEY,
  template_version INTEGER NOT NULL,
  job_id           TEXT REFERENCES chatbot.jobs,
  name             TEXT NOT NULL,
  steps_json       JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.candidates (
  candidate_id   TEXT PRIMARY KEY,
  canonical_email TEXT,
  display_name   TEXT,
  resume_text    TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.conversations (
  conversation_id   TEXT PRIMARY KEY,
  job_id            TEXT REFERENCES chatbot.jobs,
  candidate_id      TEXT REFERENCES chatbot.candidates,
  channel           TEXT NOT NULL,
  channel_thread_id TEXT,
  status            TEXT NOT NULL DEFAULT 'open',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.pipeline_runs (
  pipeline_run_id  TEXT PRIMARY KEY,
  job_id           TEXT REFERENCES chatbot.jobs,
  candidate_id     TEXT REFERENCES chatbot.candidates,
  template_id      TEXT,
  template_version INTEGER NOT NULL,
  active_step_id   TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.pipeline_step_state (
  pipeline_run_id  TEXT REFERENCES chatbot.pipeline_runs,
  step_id          TEXT NOT NULL,
  step_index       INTEGER NOT NULL,
  state            TEXT NOT NULL DEFAULT 'pending',
  awaiting_reply   BOOLEAN NOT NULL DEFAULT false,
  extracted_facts  JSONB NOT NULL DEFAULT '{}',
  last_reason      TEXT,
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (pipeline_run_id, step_id)
);

CREATE TABLE chatbot.pipeline_events (
  event_id         TEXT PRIMARY KEY,
  pipeline_run_id  TEXT REFERENCES chatbot.pipeline_runs,
  candidate_id     TEXT REFERENCES chatbot.candidates,
  event_type       TEXT NOT NULL,
  step_id          TEXT,
  payload          JSONB NOT NULL DEFAULT '{}',
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.messages (
  message_id         TEXT PRIMARY KEY,
  conversation_id    TEXT REFERENCES chatbot.conversations,
  candidate_id       TEXT REFERENCES chatbot.candidates,
  direction          TEXT NOT NULL CHECK (direction IN ('inbound','outbound','system')),
  message_type       TEXT NOT NULL DEFAULT 'text',
  body               TEXT,
  channel            TEXT NOT NULL,
  channel_message_id TEXT,
  occurred_at        TIMESTAMPTZ,
  received_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.planned_messages (
  planned_message_id TEXT PRIMARY KEY,
  conversation_id    TEXT REFERENCES chatbot.conversations,
  candidate_id       TEXT REFERENCES chatbot.candidates,
  pipeline_run_id    TEXT REFERENCES chatbot.pipeline_runs,
  step_id            TEXT,
  body               TEXT NOT NULL,
  reason             TEXT,
  review_status      TEXT NOT NULL DEFAULT 'pending',
  moderation_policy  TEXT NOT NULL DEFAULT 'window_to_reject',
  send_after         TIMESTAMPTZ,
  auto_send_after    TIMESTAMPTZ,
  idempotency_key    TEXT UNIQUE,
  created_at         TIMESTAMPTZ DEFAULT now()
);
