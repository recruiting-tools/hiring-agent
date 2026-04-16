-- migration: 014_vacancy_paused_status.sql
-- Allow recruiter notebook actions to pause a vacancy without archiving it.

DO $$
DECLARE
  existing_check_name text;
BEGIN
  SELECT conname
    INTO existing_check_name
  FROM pg_constraint
  WHERE conrelid = 'chatbot.vacancies'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%'
    AND pg_get_constraintdef(oid) ILIKE '%draft%'
    AND pg_get_constraintdef(oid) ILIKE '%active%'
    AND pg_get_constraintdef(oid) ILIKE '%archived%'
  LIMIT 1;

  IF existing_check_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE chatbot.vacancies DROP CONSTRAINT %I',
      existing_check_name
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'chatbot.vacancies'::regclass
      AND conname = 'vacancies_status_check'
  ) THEN
    ALTER TABLE chatbot.vacancies
      ADD CONSTRAINT vacancies_status_check
      CHECK (status IN ('draft', 'active', 'paused', 'archived'));
  END IF;
END $$;
