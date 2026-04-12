-- migration: 004_planned_messages_hh_message_id.sql
-- Stores the HH message ID returned after a successful send on the planned_messages row,
-- making it available without joining message_delivery_attempts.

ALTER TABLE chatbot.planned_messages ADD COLUMN IF NOT EXISTS hh_message_id TEXT;
