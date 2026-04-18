import { createHhDeliveryOrchestrator } from "./hh-delivery-orchestrator.js";

export async function reconcileSentHhMessage({
  store,
  plannedMessage,
  hhNegotiationId,
  hhMessageId,
  sentAt,
  attemptId = null
}) {
  const orchestrator = createHhDeliveryOrchestrator({ store, hhClient: null });
  return orchestrator.reconcileSentMessage({
    plannedMessage,
    hhNegotiationId,
    hhMessageId,
    sentAt,
    attemptId
  });
}

export async function sendHHWithGuard({ store, hhClient, plannedMessage, hhNegotiationId }) {
  const orchestrator = createHhDeliveryOrchestrator({ store, hhClient });
  return orchestrator.sendPlannedMessage({ plannedMessage, hhNegotiationId });
}
