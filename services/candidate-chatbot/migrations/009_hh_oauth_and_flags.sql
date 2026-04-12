-- migration: 009_hh_oauth_and_flags.sql

CREATE TABLE IF NOT EXISTS management.oauth_tokens (
  provider       TEXT PRIMARY KEY,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT,
  token_type     TEXT,
  expires_at     TIMESTAMPTZ,
  scope          TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS management.feature_flags (
  flag         TEXT PRIMARY KEY,
  enabled      BOOLEAN NOT NULL DEFAULT false,
  description  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO management.feature_flags (flag, enabled, description)
VALUES ('hh_send', false, 'Controls outbound HH sending')
ON CONFLICT (flag) DO NOTHING;

INSERT INTO management.feature_flags (flag, enabled, description)
VALUES ('hh_import', false, 'Controls HH applicant import and polling')
ON CONFLICT (flag) DO NOTHING;
