-- migration: 002_playbook_definitions.sql
-- Platform-wide playbook catalog and per-tenant access control.
-- Replaces earlier draft of this migration (which synced from HR-stalker).

-- ── Playbook catalog ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS management.playbook_definitions (
  playbook_key        TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  trigger_description TEXT,
  keywords            TEXT[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'beta', 'coming_soon', 'deprecated')),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Playbook steps ───────────────────────────────────────────────────────────

-- step_order=0 is reserved for auto_fetch (loads vacancy from UI context silently).
-- Routing: next_step_order NULL = end of playbook.
-- options: semicolon-separated button labels for 'buttons' and 'display' steps.

CREATE TABLE IF NOT EXISTS management.playbook_steps (
  step_key        TEXT PRIMARY KEY,  -- e.g. "setup_communication.1"
  playbook_key    TEXT NOT NULL REFERENCES management.playbook_definitions(playbook_key) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  name            TEXT NOT NULL,
  step_type       TEXT NOT NULL
    CHECK (step_type IN (
      'auto_fetch',   -- step 0: silent DB load from UI vacancy context
      'buttons',      -- show labeled options, route by choice
      'user_input',   -- collect free text from recruiter
      'data_fetch',   -- SQL query, result shown to recruiter
      'llm_extract',  -- LLM → structured JSON, optionally saved to vacancies column
      'llm_generate', -- LLM → text/HTML shown to recruiter
      'decision',     -- rule/LLM-based routing with optional message
      'display',      -- show formatted content + optional continue/refine buttons
      'subroutine'    -- delegate to another playbook, return here when done
    )),
  user_message      TEXT,     -- text shown to recruiter (display / user_input / buttons)
  prompt_template   TEXT,     -- LLM prompt (llm_extract / llm_generate); variables: {{context.key}}
  context_key       TEXT,     -- session.context key where output is stored
  db_save_column    TEXT,     -- for llm_extract: column in management.vacancies to UPDATE
  next_step_order   INTEGER,  -- default next step (NULL = playbook complete)
  options           TEXT,     -- semicolon-separated labels for buttons/display choices
  notes             TEXT,     -- internal notes, not shown to recruiter
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (playbook_key, step_order)
);

CREATE INDEX IF NOT EXISTS idx_playbook_steps_playbook_key
  ON management.playbook_steps (playbook_key, step_order);

-- ── Per-tenant access control ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS management.tenant_playbook_access (
  tenant_id    TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  playbook_key TEXT NOT NULL REFERENCES management.playbook_definitions(playbook_key) ON DELETE CASCADE,
  enabled      BOOLEAN NOT NULL DEFAULT false,
  enabled_at   TIMESTAMPTZ,
  enabled_by   TEXT,   -- recruiter_id, 'admin', or 'system'
  notes        TEXT,
  PRIMARY KEY (tenant_id, playbook_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_playbook_access_enabled
  ON management.tenant_playbook_access (tenant_id)
  WHERE enabled = true;
