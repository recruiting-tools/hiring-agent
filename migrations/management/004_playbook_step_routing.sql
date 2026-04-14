-- migration: 004_playbook_step_routing.sql
-- Add explicit per-step routing for multi-path playbook interactions.

ALTER TABLE management.playbook_steps
ADD COLUMN IF NOT EXISTS routing JSONB;
