-- migration: 013_hh_vacancy_job_mappings.sql
-- Stores explicit HH vacancy -> job mappings used by the import pipeline.

CREATE TABLE IF NOT EXISTS chatbot.hh_vacancy_job_mappings (
  hh_vacancy_job_mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hh_vacancy_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES chatbot.jobs(job_id) ON DELETE RESTRICT,
  collections JSONB NOT NULL DEFAULT '["response","phone_interview"]'::jsonb,
  client_id TEXT REFERENCES management.clients(client_id),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE chatbot.hh_vacancy_job_mappings
  ADD CONSTRAINT uq_hh_vacancy_job_mappings_vacancy_id
  UNIQUE (hh_vacancy_id),
  ADD CONSTRAINT chk_hh_vacancy_job_mappings_collections_array
  CHECK (
    jsonb_typeof(collections) = 'array'
    AND jsonb_array_length(collections) > 0
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(collections) AS collection
      WHERE collection NOT IN ('response', 'phone_interview')
    )
  ),
  ADD CONSTRAINT chk_hh_vacancy_job_mappings_vacancy_id_not_empty
  CHECK (btrim(hh_vacancy_id) <> '');

CREATE INDEX IF NOT EXISTS idx_hh_vacancy_job_mappings_job_id
  ON chatbot.hh_vacancy_job_mappings (job_id);

CREATE INDEX IF NOT EXISTS idx_hh_vacancy_job_mappings_enabled
  ON chatbot.hh_vacancy_job_mappings (enabled)
  WHERE enabled = true;
