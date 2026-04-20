-- migration: 016_vacancy_communication_plan_canonicalize.sql
-- Canonicalize legacy communication_plan step shape and tighten the DB contract
-- so future writes must use {step, reminders_count, comment} per step.

CREATE OR REPLACE FUNCTION chatbot.normalize_communication_plan(raw_plan jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  raw_step jsonb;
  normalized_steps jsonb := '[]'::jsonb;
  step_text text;
  comment_text text;
  reminders_text text;
  reminders_count integer;
BEGIN
  IF raw_plan IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(raw_plan) <> 'object'
     OR NOT raw_plan ? 'scenario_title'
     OR NOT raw_plan ? 'goal'
     OR NOT raw_plan ? 'steps'
     OR jsonb_typeof(raw_plan->'steps') <> 'array'
     OR jsonb_array_length(raw_plan->'steps') < 4
     OR jsonb_array_length(raw_plan->'steps') > 7
  THEN
    RETURN NULL;
  END IF;

  FOR raw_step IN
    SELECT value
    FROM jsonb_array_elements(raw_plan->'steps')
  LOOP
    IF jsonb_typeof(raw_step) <> 'object' THEN
      RETURN NULL;
    END IF;

    step_text := NULLIF(btrim(COALESCE(
      raw_step->>'step',
      raw_step->>'goal',
      raw_step->>'message',
      raw_step->>'text'
    )), '');

    IF step_text IS NULL THEN
      RETURN NULL;
    END IF;

    comment_text := NULLIF(btrim(COALESCE(
      raw_step->>'comment',
      raw_step->>'message',
      raw_step->>'text'
    )), '');

    IF raw_step ? 'step' THEN
      reminders_text := COALESCE(
        raw_step->>'reminders_count',
        raw_step->>'reminders',
        raw_step->>'reminder_count',
        '0'
      );

      BEGIN
        reminders_count := round(reminders_text::numeric)::integer;
      EXCEPTION WHEN others THEN
        RETURN NULL;
      END;

      IF reminders_count < 0 OR reminders_count > 3 THEN
        RETURN NULL;
      END IF;
    ELSE
      reminders_count := 0;
    END IF;

    normalized_steps := normalized_steps || jsonb_build_array(
      jsonb_build_object(
        'step', step_text,
        'reminders_count', reminders_count,
        'comment', COALESCE(comment_text, '—')
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'scenario_title', COALESCE(NULLIF(btrim(raw_plan->>'scenario_title'), ''), 'Рабочий сценарий коммуникации'),
    'goal', COALESCE(NULLIF(btrim(raw_plan->>'goal'), ''), 'Договоренность о следующем шаге'),
    'steps', normalized_steps
  );
END;
$$;

WITH normalized AS (
  SELECT
    vacancy_id,
    chatbot.normalize_communication_plan(communication_plan) AS next_communication_plan,
    chatbot.normalize_communication_plan(communication_plan_draft) AS next_communication_plan_draft,
    CASE
      WHEN communication_examples IS NOT NULL
        AND jsonb_typeof(communication_examples) = 'array'
      THEN communication_examples
      ELSE '[]'::jsonb
    END AS next_communication_examples,
    CASE
      WHEN communication_examples_plan_hash IS NOT NULL
        AND communication_examples IS NOT NULL
        AND jsonb_typeof(communication_examples) = 'array'
        AND jsonb_array_length(communication_examples) > 0
      THEN communication_examples_plan_hash
      ELSE NULL
    END AS next_communication_examples_plan_hash
  FROM chatbot.vacancies
)
UPDATE chatbot.vacancies AS v
SET
  communication_plan = n.next_communication_plan,
  communication_plan_draft = n.next_communication_plan_draft,
  communication_examples = n.next_communication_examples,
  communication_examples_plan_hash = n.next_communication_examples_plan_hash,
  updated_at = now()
FROM normalized AS n
WHERE v.vacancy_id = n.vacancy_id
  AND (
    v.communication_plan IS DISTINCT FROM n.next_communication_plan
    OR v.communication_plan_draft IS DISTINCT FROM n.next_communication_plan_draft
    OR v.communication_examples IS DISTINCT FROM n.next_communication_examples
    OR v.communication_examples_plan_hash IS DISTINCT FROM n.next_communication_examples_plan_hash
  );

ALTER TABLE chatbot.vacancies
  DROP CONSTRAINT IF EXISTS chk_vacancies_communication_plan_contract;

ALTER TABLE chatbot.vacancies
  ADD CONSTRAINT chk_vacancies_communication_plan_contract
  CHECK (
    communication_plan IS NULL
    OR chatbot.normalize_communication_plan(communication_plan) = communication_plan
  );

ALTER TABLE chatbot.vacancies
  DROP CONSTRAINT IF EXISTS chk_vacancies_communication_plan_draft_contract;

ALTER TABLE chatbot.vacancies
  ADD CONSTRAINT chk_vacancies_communication_plan_draft_contract
  CHECK (
    communication_plan_draft IS NULL
    OR chatbot.normalize_communication_plan(communication_plan_draft) = communication_plan_draft
  );
