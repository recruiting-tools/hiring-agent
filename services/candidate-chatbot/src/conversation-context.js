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
  activeTemplateStep = null,
  lastMessage = null,
  lastInboundMessage = null,
  lastOutboundMessage = null
}) {
  const orderedHistory = Array.isArray(history) ? history : [];
  const resolvedLastMessage = lastMessage ?? orderedHistory.at(-1) ?? null;
  const resolvedLastInboundMessage = lastInboundMessage ?? findLastByDirection(orderedHistory, "inbound");
  const resolvedLastOutboundMessage = lastOutboundMessage ?? findLastByDirection(orderedHistory, "outbound");
  const activePendingStep = pendingSteps[0] ?? null;
  const resolvedActiveTemplateStep = activeTemplateStep
    ?? pendingTemplateSteps.find((step) => step.id === activePendingStep?.step_id)
    ?? null;
  const resolvedLastOutboundBody = lastOutboundBody ?? resolvedLastOutboundMessage?.body ?? null;
  const resolvedHasPriorOutbound = hasPriorOutbound ?? (resolvedLastOutboundMessage !== null) ?? false;

  return {
    conversation,
    run,
    job,
    candidate,
    inboundMessage,
    pendingSteps,
    pendingTemplateSteps,
    history: orderedHistory,
    lastMessage: resolvedLastMessage,
    lastInboundMessage: resolvedLastInboundMessage,
    lastOutboundMessage: resolvedLastOutboundMessage,
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
