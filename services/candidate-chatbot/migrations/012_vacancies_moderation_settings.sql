-- migration: 012_vacancies_moderation_settings.sql
-- Add vacancy-level moderation configuration.
--
-- moderation_settings JSONB supports per-vacancy overrides for:
--   auto_send_delay_minutes  — replaces global MODERATION_AUTO_SEND_DELAY_HOURS for this vacancy
--   queue_target             — desired pending items in moderation queue for this vacancy
--   simulator_enabled        — whether demo-simulator should generate activity for this vacancy
--
-- Resolution order in postgres-store: vacancy.moderation_settings.auto_send_delay_minutes → global env

ALTER TABLE chatbot.vacancies
  ADD COLUMN IF NOT EXISTS moderation_settings JSONB NOT NULL DEFAULT '{}';
