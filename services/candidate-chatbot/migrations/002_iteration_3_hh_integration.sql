-- migration: 002_iteration_3_hh_integration.sql
-- Adds HH integration tables to the chatbot schema

-- HH negotiations → our conversations
CREATE TABLE chatbot.hh_negotiations (
  hh_negotiation_id TEXT PRIMARY KEY,          -- ID of the negotiation in HH API
  job_id            TEXT REFERENCES chatbot.jobs,
  candidate_id      TEXT REFERENCES chatbot.candidates,
  hh_vacancy_id     TEXT NOT NULL,             -- HH vacancy ID (string like '12345678')
  hh_collection     TEXT NOT NULL DEFAULT 'response',  -- HH collection: response/invited/etc
  channel_thread_id TEXT NOT NULL,             -- = conversations.channel_thread_id
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Poll state for each negotiation
CREATE TABLE chatbot.hh_poll_state (
  hh_negotiation_id  TEXT PRIMARY KEY REFERENCES chatbot.hh_negotiations,
  last_polled_at     TIMESTAMPTZ,
  hh_updated_at      TIMESTAMPTZ,              -- timestamp of last message from HH (for future pre-filter)
  last_sender        TEXT CHECK (last_sender IN ('applicant', 'employer')),
  awaiting_reply     BOOLEAN NOT NULL DEFAULT false,  -- true = we sent last, waiting for candidate
  no_response_streak INTEGER NOT NULL DEFAULT 0,      -- how many times candidate didn't reply
  next_poll_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivery attempts — source of truth for idempotency guard
CREATE TABLE chatbot.message_delivery_attempts (
  attempt_id         TEXT PRIMARY KEY,
  planned_message_id TEXT NOT NULL REFERENCES chatbot.planned_messages,
  hh_negotiation_id  TEXT NOT NULL REFERENCES chatbot.hh_negotiations,
  status             TEXT NOT NULL CHECK (status IN ('sending', 'delivered', 'failed', 'duplicate')),
  hh_message_id      TEXT,                     -- ID in HH after successful send
  attempted_at       TIMESTAMPTZ DEFAULT now(),
  error_body         TEXT                      -- error body if status='failed'
);

-- Add sent_at to planned_messages (null = not yet sent)
ALTER TABLE chatbot.planned_messages ADD COLUMN sent_at TIMESTAMPTZ;
