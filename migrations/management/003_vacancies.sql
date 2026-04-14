-- migration: 003_vacancies.sql
-- Vacancy metadata and playbook runtime session state.

-- ── Vacancies ────────────────────────────────────────────────────────────────

-- Vacancies live in the management DB (not per-tenant DB) because:
--   - they are recruiter-facing metadata, not candidate operational data
--   - hiring-agent needs direct access without per-tenant connection routing
--   - tenant isolation is enforced via tenant_id FK

CREATE TABLE IF NOT EXISTS management.vacancies (
  vacancy_id        TEXT PRIMARY KEY DEFAULT 'vac-' || gen_random_uuid()::TEXT,
  tenant_id         TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  created_by        TEXT REFERENCES management.recruiters(recruiter_id),

  title             TEXT NOT NULL,
  raw_text          TEXT,                          -- original uploaded content, pre-extraction

  -- fields extracted by LLM from raw_text, confirmed by recruiter
  must_haves        JSONB NOT NULL DEFAULT '[]',   -- TEXT[]
  nice_haves        JSONB NOT NULL DEFAULT '[]',   -- TEXT[]
  work_conditions   JSONB NOT NULL DEFAULT '{}',   -- see spec §3.3
  application_steps JSONB NOT NULL DEFAULT '[]',   -- see spec §3.2
  company_info      JSONB NOT NULL DEFAULT '{}',   -- {name, description, notes}
  faq               JSONB NOT NULL DEFAULT '[]',   -- [{q, a}] candidate FAQ

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

  hh_vacancy_id     TEXT,
  hh_vacancy_url    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vacancies_tenant_status
  ON management.vacancies (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_vacancies_tenant_created
  ON management.vacancies (tenant_id, created_at DESC);

-- ── Playbook sessions (runtime state) ───────────────────────────────────────

-- One session per recruiter per playbook invocation.
-- context JSONB accumulates everything: vacancy_id (injected from UI),
-- extracted fields, user choices, generated content.
-- call_stack supports subroutine: [{playbook_key, return_step_order}]

CREATE TABLE IF NOT EXISTS management.playbook_sessions (
  session_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  recruiter_id       TEXT REFERENCES management.recruiters(recruiter_id),
  conversation_id    TEXT,         -- link to hiring-agent chat conversation

  playbook_key       TEXT NOT NULL REFERENCES management.playbook_definitions(playbook_key),
  current_step_order INTEGER,

  context            JSONB NOT NULL DEFAULT '{}',
  call_stack         JSONB NOT NULL DEFAULT '[]',

  status             TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'aborted', 'error')),

  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_playbook_sessions_conversation
  ON management.playbook_sessions (conversation_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_playbook_sessions_tenant_active
  ON management.playbook_sessions (tenant_id, status)
  WHERE status = 'active';
