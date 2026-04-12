-- migration: 003_send_guard_unique_index.sql
-- Prevents double-send via partial unique index on active delivery attempts.
-- Only one 'sending' or 'delivered' record can exist per planned_message_id at a time.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_delivery_active
  ON chatbot.message_delivery_attempts (planned_message_id)
  WHERE status IN ('sending', 'delivered');
