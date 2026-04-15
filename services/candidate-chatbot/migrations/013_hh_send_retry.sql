-- migration: 013_hh_send_retry.sql
-- Improves HH send pipeline idempotency and retry behavior:
-- 1) Add retry metadata for message_delivery_attempts.
-- 2) Ensure imported HH messages are idempotent by (conversation_id, channel_message_id).
-- 3) Keep latest failed attempt state recoverable after restarts.

ALTER TABLE chatbot.message_delivery_attempts
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_messages_channel_message_id
  ON chatbot.messages (conversation_id, channel_message_id)
  WHERE channel_message_id IS NOT NULL;
