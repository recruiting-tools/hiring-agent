-- migration: 012_vacancy_communication_plan.sql
-- Stores communication-plan configuration directly on chatbot.vacancies.

ALTER TABLE chatbot.vacancies
  ADD COLUMN IF NOT EXISTS communication_plan JSONB,
  ADD COLUMN IF NOT EXISTS communication_plan_draft JSONB,
  ADD COLUMN IF NOT EXISTS communication_examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS communication_examples_plan_hash TEXT,
  ADD COLUMN IF NOT EXISTS communication_plan_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_vacancies_communication_plan_contract'
      AND conrelid = 'chatbot.vacancies'::regclass
  ) THEN
    ALTER TABLE chatbot.vacancies
      ADD CONSTRAINT chk_vacancies_communication_plan_contract
      CHECK (
        communication_plan IS NULL OR (
          jsonb_typeof(communication_plan) = 'object'
          AND communication_plan ? 'scenario_title'
          AND communication_plan ? 'goal'
          AND communication_plan ? 'steps'
          AND CASE
            WHEN jsonb_typeof(communication_plan->'steps') = 'array'
              THEN jsonb_array_length(communication_plan->'steps') BETWEEN 4 AND 7
            ELSE false
          END
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_vacancies_communication_plan_draft_contract'
      AND conrelid = 'chatbot.vacancies'::regclass
  ) THEN
    ALTER TABLE chatbot.vacancies
      ADD CONSTRAINT chk_vacancies_communication_plan_draft_contract
      CHECK (
        communication_plan_draft IS NULL OR (
          jsonb_typeof(communication_plan_draft) = 'object'
          AND communication_plan_draft ? 'scenario_title'
          AND communication_plan_draft ? 'goal'
          AND communication_plan_draft ? 'steps'
          AND CASE
            WHEN jsonb_typeof(communication_plan_draft->'steps') = 'array'
              THEN jsonb_array_length(communication_plan_draft->'steps') BETWEEN 4 AND 7
            ELSE false
          END
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_vacancies_communication_examples_array'
      AND conrelid = 'chatbot.vacancies'::regclass
  ) THEN
    ALTER TABLE chatbot.vacancies
      ADD CONSTRAINT chk_vacancies_communication_examples_array
      CHECK (jsonb_typeof(communication_examples) = 'array');
  END IF;
END
$$;

COMMENT ON COLUMN chatbot.vacancies.communication_plan IS
  'Saved communication scenario contract: {scenario_title, goal, steps:[{step, reminders_count, comment}]}';

COMMENT ON COLUMN chatbot.vacancies.communication_plan_draft IS
  'Draft communication scenario contract with the same JSON shape as communication_plan.';

COMMENT ON COLUMN chatbot.vacancies.communication_examples IS
  'Generated first-message examples: [{title, message}]';

COMMENT ON COLUMN chatbot.vacancies.communication_examples_plan_hash IS
  'SHA-256 of communication plan used to generate communication_examples.';
