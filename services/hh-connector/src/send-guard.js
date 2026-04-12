import { randomUUID } from "node:crypto";

export async function sendHHWithGuard({ store, hhClient, plannedMessage, hhNegotiationId }) {
  // 1. Check for an existing successful attempt (idempotency)
  const existing = await store.getSuccessfulDeliveryAttempt(plannedMessage.planned_message_id);
  if (existing) {
    return { sent: false, duplicate: true, hh_message_id: existing.hh_message_id };
  }

  // 2. Record attempt as 'sending'
  const attempt = await store.recordDeliveryAttempt({
    attempt_id: randomUUID(),
    planned_message_id: plannedMessage.planned_message_id,
    hh_negotiation_id: hhNegotiationId,
    status: "sending"
  });

  try {
    // 3. Send via HH
    const { hh_message_id } = await hhClient.sendMessage(hhNegotiationId, plannedMessage.body);

    // 4. Record success
    await store.markDeliveryAttemptDelivered({ attempt_id: attempt.attempt_id, hh_message_id });
    await store.markPlannedMessageSent({
      planned_message_id: plannedMessage.planned_message_id,
      sent_at: new Date().toISOString(),
      hh_message_id
    });

    return { sent: true, hh_message_id };
  } catch (err) {
    await store.markDeliveryAttemptFailed({ attempt_id: attempt.attempt_id, error_body: err.message });
    return { sent: false, error: err.message };
  }
}
