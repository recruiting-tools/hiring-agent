import { randomUUID } from "node:crypto";

const MAX_RETRY_ATTEMPTS = 5;
const STALE_SENDING_WINDOW_MS = 5 * 60 * 1000;
const BASE_RETRY_MS = 15_000;
const MAX_RETRY_MS = 45 * 60 * 1000;

function computeBackoffMs(retryCount) {
  return Math.min(BASE_RETRY_MS * 2 ** retryCount, MAX_RETRY_MS);
}

function parseRetryCount(failedAttempts) {
  if (!failedAttempts.length) return 0;
  return failedAttempts.reduce((maxValue, attempt) => {
    const value = Number(attempt.retry_count ?? 0);
    return Number.isFinite(value) ? Math.max(maxValue, value) : maxValue;
  }, 0);
}

function isRetryableError(error) {
  const status = Number(error?.status ?? error?.code);
  if (!Number.isFinite(status)) return true;
  return status >= 500 || status === 408 || status === 429;
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function reconcileSentHhMessage({
  store,
  plannedMessage,
  hhNegotiationId,
  hhMessageId,
  sentAt,
  attemptId = null
}) {
  const sentAtIso = sentAt instanceof Date ? sentAt.toISOString() : sentAt;
  const plannedMessageId = plannedMessage.planned_message_id;

  if (attemptId) {
    await store.markDeliveryAttemptDelivered({ attempt_id: attemptId, hh_message_id: hhMessageId });
  } else {
    const existing = await store.getSuccessfulDeliveryAttempt(plannedMessageId);
    if (!existing) {
      const deliveredAttempt = await store.recordDeliveryAttempt({
        attempt_id: randomUUID(),
        planned_message_id: plannedMessageId,
        hh_negotiation_id: hhNegotiationId,
        status: "delivered"
      });
      await store.markDeliveryAttemptDelivered({
        attempt_id: deliveredAttempt.attempt_id,
        hh_message_id: hhMessageId
      });
    } else if (existing.hh_message_id !== hhMessageId) {
      await store.markDeliveryAttemptDelivered({
        attempt_id: existing.attempt_id,
        hh_message_id: hhMessageId
      });
    }
  }

  await store.markPlannedMessageSent({
    planned_message_id: plannedMessageId,
    sent_at: sentAtIso,
    hh_message_id: hhMessageId
  });

  if (plannedMessage.conversation_id && plannedMessage.candidate_id && hhMessageId) {
    await store.upsertImportedMessage({
      conversation_id: plannedMessage.conversation_id,
      candidate_id: plannedMessage.candidate_id,
      direction: "outbound",
      body: plannedMessage.body,
      channel: plannedMessage.channel ?? "hh",
      channel_message_id: hhMessageId,
      occurred_at: sentAtIso
    });
  }

  if (hhNegotiationId) {
    const currentPollState = await store.getHhPollState(hhNegotiationId);
    await store.upsertHhPollState(hhNegotiationId, {
      last_polled_at: currentPollState?.last_polled_at ?? sentAtIso,
      hh_updated_at: sentAtIso,
      last_sender: "employer",
      awaiting_reply: true,
      next_poll_at: sentAtIso
    });
  }
}

export async function sendHHWithGuard({ store, hhClient, plannedMessage, hhNegotiationId }) {
  const traceId = randomUUID();
  const now = new Date();
  const plannedMessageId = plannedMessage.planned_message_id;

  const existing = await store.getSuccessfulDeliveryAttempt(plannedMessageId);
  if (existing) {
    console.info("[hh-send] queue_transition", {
      trace_id: traceId,
      action: "duplicate_suppressed",
      planned_message_id: plannedMessageId,
      hh_negotiation_id: hhNegotiationId,
      hh_message_id: existing.hh_message_id
    });
    return { sent: false, duplicate: true, hh_message_id: existing.hh_message_id };
  }

  const attempts = await store.getDeliveryAttempts(plannedMessageId);
  const latestAttempt = attempts[0] ?? null;
  const failedAttempts = attempts.filter((attempt) => attempt.status === "failed");
  const retryCount = parseRetryCount(failedAttempts);

  if (latestAttempt?.status === "sending") {
    const ageMs = now.getTime() - new Date(latestAttempt.attempted_at).getTime();
    if (ageMs > STALE_SENDING_WINDOW_MS) {
      await store.markDeliveryAttemptFailed({
        attempt_id: latestAttempt.attempt_id,
        error_body: "Stale sending attempt recovered after restart",
        nextRetryAt: now,
        retryCount: latestAttempt.retry_count ?? retryCount
      });
    } else {
      return {
        sent: false,
        duplicate: true,
        hh_message_id: latestAttempt.hh_message_id ?? null,
        reason: "inflight"
      };
    }
  }

  const latestFailed = attempts.find((attempt) => attempt.status === "failed") ?? null;
  if (latestFailed?.next_retry_at && new Date(latestFailed.next_retry_at) > now) {
    return {
      sent: false,
      duplicate: false,
      retry_scheduled: true,
      retry_after: latestFailed.next_retry_at,
      retry_count: latestFailed.retry_count ?? retryCount
    };
  }

  if (retryCount >= MAX_RETRY_ATTEMPTS) {
    await store.markPlannedMessageBlockedForDlq(plannedMessageId, {
      reason: `max_retries_reached:${MAX_RETRY_ATTEMPTS}`
    });
    return { sent: false, duplicate: false, dlq: true, retry_count: retryCount };
  }

  const attemptId = randomUUID();
  const attempt = await store.recordDeliveryAttempt({
    attempt_id: attemptId,
    planned_message_id: plannedMessageId,
    hh_negotiation_id: hhNegotiationId,
    status: "sending",
    retry_count: retryCount
  });

  if (attempt.attempt_id !== attemptId || attempt.status !== "sending") {
    return { sent: false, duplicate: true, hh_message_id: attempt.hh_message_id ?? null };
  }

  console.info("[hh-send] queue_transition", {
    trace_id: traceId,
    action: "send_started",
    planned_message_id: plannedMessageId,
    hh_negotiation_id: hhNegotiationId,
    attempt_id: attempt.attempt_id,
    retry_count: retryCount
  });

  try {
    const { hh_message_id } = await hhClient.sendMessage(hhNegotiationId, plannedMessage.body);
    await reconcileSentHhMessage({
      store,
      plannedMessage,
      hhNegotiationId,
      hhMessageId: hh_message_id,
      sentAt: now.toISOString(),
      attemptId
    });

    console.info("[hh-send] queue_transition", {
      trace_id: traceId,
      action: "sent",
      planned_message_id: plannedMessageId,
      hh_negotiation_id: hhNegotiationId,
      attempt_id: attempt.attempt_id,
      hh_message_id
    });

    return { sent: true, hh_message_id, retry_count: retryCount };
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    if (isRetryableError(error) && retryCount + 1 < MAX_RETRY_ATTEMPTS) {
      const nextRetryAt = new Date(now.getTime() + computeBackoffMs(retryCount));
      const nextRetryIso = nextRetryAt.toISOString();
      await store.markDeliveryAttemptFailed({
        attempt_id: attemptId,
        error_body: errorMessage,
        nextRetryAt,
        retryCount: retryCount + 1
      });

      console.info("[hh-send] queue_transition", {
        trace_id: traceId,
        action: "retry_scheduled",
        planned_message_id: plannedMessageId,
        hh_negotiation_id: hhNegotiationId,
        attempt_id: attempt.attempt_id,
        retry_count: retryCount + 1,
        retry_after: nextRetryIso
      });

      return {
        sent: false,
        error: errorMessage,
        retry_scheduled: true,
        retry_after: nextRetryIso,
        retry_count: retryCount + 1
      };
    }

    await store.markDeliveryAttemptFailed({
      attempt_id: attemptId,
      error_body: errorMessage,
      nextRetryAt: null,
      retryCount: retryCount + 1
    });
    await store.markPlannedMessageBlockedForDlq(plannedMessageId, {
      reason: `send_failed:${error?.status ?? error?.code ?? "unknown"}`
    });

    console.warn("[hh-send] queue_transition", {
      trace_id: traceId,
      action: "dlq",
      planned_message_id: plannedMessageId,
      hh_negotiation_id: hhNegotiationId,
      attempt_id: attempt.attempt_id,
      retry_count: retryCount + 1,
      error: errorMessage
    });

    return { sent: false, error: errorMessage, dlq: true, retry_count: retryCount + 1 };
  }
}
