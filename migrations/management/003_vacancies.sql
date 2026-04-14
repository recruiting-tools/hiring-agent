-- migration: 003_vacancies.sql
-- Playbook runtime session state (control-plane only).
--
-- NOTE: vacancy business data lives in chatbot.vacancies (per-tenant DB),
-- NOT here. Tenant data isolation is enforced at the DB level — each tenant
-- has their own chatbot DB instance. Only control-plane state belongs in
-- the shared management DB.

-- gen_random_uuid() is built-in since PostgreSQL 13 (Neon uses PG16).
-- pgcrypto is enabled here as a safety net for older environments.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Playbook sessions (runtime state) ───────────────────────────────────────

-- One session per recruiter per playbook invocation.
-- vacancy_id is a first-class field (not buried in context JSONB) so the
-- UI and backend can filter/resume/block sessions by vacancy without
-- JSON-heuristics. context JSONB still accumulates extracted fields,
-- user choices, and generated content.
-- call_stack supports subroutine: [{playbook_key, return_step_order}]

CREATE TABLE IF NOT EXISTS management.playbook_sessions (
  session_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  recruiter_id       TEXT REFERENCES management.recruiters(recruiter_id),
  conversation_id    TEXT,         -- link to hiring-agent chat conversation

  playbook_key       TEXT NOT NULL REFERENCES management.playbook_definitions(playbook_key),
  current_step_order INTEGER,

  -- vacancy_id references chatbot.vacancies (per-tenant DB) — no FK possible
  -- across DB boundaries, so it's a plain TEXT reference enforced at app level
  vacancy_id         TEXT,

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

-- vacancy-centric lookup: find/resume active sessions for a given vacancy
CREATE INDEX IF NOT EXISTS idx_playbook_sessions_vacancy
  ON management.playbook_sessions (tenant_id, vacancy_id, status)
  WHERE status = 'active';

-- prevent duplicate active sessions: one active session per recruiter+vacancy+playbook
CREATE UNIQUE INDEX IF NOT EXISTS idx_playbook_sessions_active_unique
  ON management.playbook_sessions (tenant_id, recruiter_id, vacancy_id, playbook_key)
  WHERE status = 'active';
