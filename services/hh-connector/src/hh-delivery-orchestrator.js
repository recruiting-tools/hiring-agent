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

export class HhDeliveryOrchestrator {
  constructor({ store, hhClient, now = () => new Date() }) {
    this.store = store;
    this.hhClient = hhClient;
    this.now = now;
  }

  async reconcileSentMessage({
    plannedMessage,
    hhNegotiationId,
    hhMessageId,
    sentAt,
    attemptId = null
  }) {
    const sentAtIso = sentAt instanceof Date ? sentAt.toISOString() : sentAt;
    const plannedMessageId = plannedMessage.planned_message_id;

    if (attemptId) {
      await this.store.markDeliveryAttemptDelivered({ attempt_id: attemptId, hh_message_id: hhMessageId });
    } else {
      const existing = await this.store.getSuccessfulDeliveryAttempt(plannedMessageId);
      if (!existing) {
        const deliveredAttempt = await this.store.recordDeliveryAttempt({
          attempt_id: randomUUID(),
          planned_message_id: plannedMessageId,
          hh_negotiation_id: hhNegotiationId,
          status: "delivered"
        });
        await this.store.markDeliveryAttemptDelivered({
          attempt_id: deliveredAttempt.attempt_id,
          hh_message_id: hhMessageId
        });
      } else if (existing.hh_message_id !== hhMessageId) {
        await this.store.markDeliveryAttemptDelivered({
          attempt_id: existing.attempt_id,
          hh_message_id: hhMessageId
        });
      }
    }

    await this.store.markPlannedMessageSent({
      planned_message_id: plannedMessageId,
      sent_at: sentAtIso,
      hh_message_id: hhMessageId
    });

    if (plannedMessage.conversation_id && plannedMessage.candidate_id && hhMessageId) {
      await this.store.upsertImportedMessage({
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
      const currentPollState = await this.store.getHhPollState(hhNegotiationId);
      await this.store.upsertHhPollState(hhNegotiationId, {
        last_polled_at: currentPollState?.last_polled_at ?? sentAtIso,
        hh_updated_at: sentAtIso,
        last_sender: "employer",
        awaiting_reply: true,
        next_poll_at: sentAtIso
      });
    }
  }

  async sendPlannedMessage({ plannedMessage, hhNegotiationId }) {
    const traceId = randomUUID();
    const now = this.now();
    const plannedMessageId = plannedMessage.planned_message_id;

    const existing = await this.store.getSuccessfulDeliveryAttempt(plannedMessageId);
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

    const attempts = await this.store.getDeliveryAttempts(plannedMessageId);
    const latestAttempt = attempts[0] ?? null;
    const failedAttempts = attempts.filter((attempt) => attempt.status === "failed");
    const retryCount = parseRetryCount(failedAttempts);

    const inflightResult = await this.#recoverOrSuppressInflightAttempt({
      latestAttempt,
      now,
      traceId,
      plannedMessageId,
      hhNegotiationId,
      retryCount
    });
    if (inflightResult) {
      return inflightResult;
    }

    const retryResult = await this.#handleRetryWindow({
      attempts,
      now,
      plannedMessageId,
      retryCount
    });
    if (retryResult) {
      return retryResult;
    }

    if (retryCount >= MAX_RETRY_ATTEMPTS) {
      await this.store.markPlannedMessageBlockedForDlq(plannedMessageId, {
        reason: `max_retries_reached:${MAX_RETRY_ATTEMPTS}`
      });
      return { sent: false, duplicate: false, dlq: true, retry_count: retryCount };
    }

    const attempt = await this.#reserveAttempt({
      plannedMessageId,
      hhNegotiationId,
      retryCount
    });
    if (attempt.attempt_id === null) {
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
      const { hh_message_id } = await this.hhClient.sendMessage(hhNegotiationId, plannedMessage.body);
      await this.reconcileSentMessage({
        plannedMessage,
        hhNegotiationId,
        hhMessageId: hh_message_id,
        sentAt: now.toISOString(),
        attemptId: attempt.attempt_id
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
      return this.#handleSendFailure({
        error,
        traceId,
        plannedMessageId,
        hhNegotiationId,
        attemptId: attempt.attempt_id,
        retryCount,
        now
      });
    }
  }

  async #recoverOrSuppressInflightAttempt({
    latestAttempt,
    now,
    traceId,
    plannedMessageId,
    hhNegotiationId,
    retryCount
  }) {
    if (latestAttempt?.status !== "sending") {
      return null;
    }

    const ageMs = now.getTime() - new Date(latestAttempt.attempted_at).getTime();
    if (ageMs > STALE_SENDING_WINDOW_MS) {
      await this.store.markDeliveryAttemptFailed({
        attempt_id: latestAttempt.attempt_id,
        error_body: "Stale sending attempt recovered after restart",
        nextRetryAt: now,
        retryCount: latestAttempt.retry_count ?? retryCount
      });
      console.info("[hh-send] queue_transition", {
        trace_id: traceId,
        action: "stale_inflight_recovered",
        planned_message_id: plannedMessageId,
        hh_negotiation_id: hhNegotiationId,
        attempt_id: latestAttempt.attempt_id
      });
      return null;
    }

    return {
      sent: false,
      duplicate: true,
      hh_message_id: latestAttempt.hh_message_id ?? null,
      reason: "inflight"
    };
  }

  async #handleRetryWindow({ attempts, now, plannedMessageId, retryCount }) {
    const latestFailed = attempts.find((attempt) => attempt.status === "failed") ?? null;
    if (!latestFailed?.next_retry_at || new Date(latestFailed.next_retry_at) <= now) {
      return null;
    }
    return {
      sent: false,
      duplicate: false,
      retry_scheduled: true,
      retry_after: latestFailed.next_retry_at,
      retry_count: latestFailed.retry_count ?? retryCount,
      planned_message_id: plannedMessageId
    };
  }

  async #reserveAttempt({ plannedMessageId, hhNegotiationId, retryCount }) {
    const attemptId = randomUUID();
    const attempt = await this.store.recordDeliveryAttempt({
      attempt_id: attemptId,
      planned_message_id: plannedMessageId,
      hh_negotiation_id: hhNegotiationId,
      status: "sending",
      retry_count: retryCount
    });

    if (attempt.attempt_id !== attemptId || attempt.status !== "sending") {
      return { attempt_id: null, hh_message_id: attempt.hh_message_id ?? null };
    }

    return attempt;
  }

  async #handleSendFailure({
    error,
    traceId,
    plannedMessageId,
    hhNegotiationId,
    attemptId,
    retryCount,
    now
  }) {
    const errorMessage = toErrorMessage(error);
    if (isRetryableError(error) && retryCount + 1 < MAX_RETRY_ATTEMPTS) {
      const nextRetryAt = new Date(now.getTime() + computeBackoffMs(retryCount));
      const nextRetryIso = nextRetryAt.toISOString();
      await this.store.markDeliveryAttemptFailed({
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
        attempt_id: attemptId,
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

    await this.store.markDeliveryAttemptFailed({
      attempt_id: attemptId,
      error_body: errorMessage,
      nextRetryAt: null,
      retryCount: retryCount + 1
    });
    await this.store.markPlannedMessageBlockedForDlq(plannedMessageId, {
      reason: `send_failed:${error?.status ?? error?.code ?? "unknown"}`
    });

    console.warn("[hh-send] queue_transition", {
      trace_id: traceId,
      action: "dlq",
      planned_message_id: plannedMessageId,
      hh_negotiation_id: hhNegotiationId,
      attempt_id: attemptId,
      retry_count: retryCount + 1,
      error: errorMessage
    });

    return { sent: false, error: errorMessage, dlq: true, retry_count: retryCount + 1 };
  }
}

export function createHhDeliveryOrchestrator(args) {
  return new HhDeliveryOrchestrator(args);
}
