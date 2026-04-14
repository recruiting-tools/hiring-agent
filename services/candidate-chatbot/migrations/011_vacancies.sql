-- migration: 011_vacancies.sql
-- Vacancy business data lives in the per-tenant chatbot DB (not management),
-- so that each tenant's vacancy content is isolated at the DB level.
--
-- Link to existing chatbot.jobs via job_id FK so V1-migrated candidate data
-- (conversations, pipeline_runs) continues to work through the same job_id.
-- Funnel query: conversations → job_id ← vacancies.job_id ← vacancy_id (UI context)

CREATE TABLE IF NOT EXISTS chatbot.vacancies (
  vacancy_id        TEXT PRIMARY KEY DEFAULT 'vac-' || gen_random_uuid()::TEXT,
  created_by        TEXT,                          -- recruiter_id (no FK — cross-db)

  title             TEXT NOT NULL,
  raw_text          TEXT,                          -- original uploaded content, pre-extraction

  -- fields extracted by LLM from raw_text, confirmed by recruiter
  must_haves        JSONB NOT NULL DEFAULT '[]',   -- TEXT[]
  nice_haves        JSONB NOT NULL DEFAULT '[]',   -- TEXT[]
  work_conditions   JSONB NOT NULL DEFAULT '{}',   -- {pay_per_shift, salary_range, schedule, ...}
  application_steps JSONB NOT NULL DEFAULT '[]',   -- [{name, type, what, script, in_our_scope, is_target}]
  company_info      JSONB NOT NULL DEFAULT '{}',   -- {name, description, notes}
  faq               JSONB NOT NULL DEFAULT '[]',   -- [{q, a}]

  -- extraction_status tracks LLM progress through create_vacancy playbook
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN (
      'pending',   -- raw_text uploaded, extraction not started
      'partial',   -- some fields extracted, playbook in progress
      'complete'   -- all fields extracted and confirmed by recruiter
    )),

  status            TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',     -- being set up via create_vacancy playbook
      'active',    -- in use for candidate communications
      'archived'   -- no longer active
    )),

  -- link to chatbot.jobs so existing conversations/pipeline_runs stay connected
  job_id            TEXT REFERENCES chatbot.jobs(job_id),

  hh_vacancy_id     TEXT,
  hh_vacancy_url    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vacancies_status
  ON chatbot.vacancies (status);

CREATE INDEX IF NOT EXISTS idx_vacancies_job_id
  ON chatbot.vacancies (job_id);
