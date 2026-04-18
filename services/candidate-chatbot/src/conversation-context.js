export async function loadConversationContext({
  store,
  conversation,
  run,
  job,
  candidate,
  inboundMessage,
  pendingSteps,
  pendingTemplateSteps
}) {
  const history = await store.getHistory(conversation.conversation_id);
  const lastOutboundBody = await store.getLastOutboundBody(conversation.conversation_id);
  return buildConversationContext({
    conversation,
    run,
    job,
    candidate,
    inboundMessage,
    pendingSteps,
    pendingTemplateSteps,
    history,
    lastOutboundBody
  });
}

export function buildConversationContext({
  conversation,
  run,
  job,
  candidate,
  inboundMessage,
  pendingSteps = [],
  pendingTemplateSteps = [],
  history = [],
  lastOutboundBody = null,
  hasPriorOutbound = null,
  activeTemplateStep = null
}) {
  const orderedHistory = Array.isArray(history) ? history : [];
  const lastMessage = orderedHistory.at(-1) ?? null;
  const lastInboundMessage = findLastByDirection(orderedHistory, "inbound");
  const lastOutboundMessage = findLastByDirection(orderedHistory, "outbound");
  const activePendingStep = pendingSteps[0] ?? null;
  const resolvedActiveTemplateStep = activeTemplateStep
    ?? pendingTemplateSteps.find((step) => step.id === activePendingStep?.step_id)
    ?? null;
  const resolvedLastOutboundBody = lastOutboundBody ?? lastOutboundMessage?.body ?? null;
  const resolvedHasPriorOutbound = hasPriorOutbound ?? (lastOutboundMessage !== null) ?? false;

  return {
    conversation,
    run,
    job,
    candidate,
    inboundMessage,
    pendingSteps,
    pendingTemplateSteps,
    history: orderedHistory,
    lastMessage,
    lastInboundMessage,
    lastOutboundMessage,
    lastOutboundBody: resolvedLastOutboundBody,
    hasPriorOutbound: resolvedHasPriorOutbound,
    activePendingStep,
    activeTemplateStep: resolvedActiveTemplateStep
  };
}

export function normalizeConversationContext(input) {
  if (input?.conversationContext) {
    return buildConversationContext(input.conversationContext);
  }
  return buildConversationContext(input ?? {});
}

function findLastByDirection(history, direction) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.direction === direction) {
      return history[index];
    }
  }
  return null;
}
