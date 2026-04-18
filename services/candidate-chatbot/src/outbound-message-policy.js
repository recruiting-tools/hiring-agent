import { normalizeConversationContext } from "./conversation-context.js";

const ACK_OPENER_RE = /^\s*(спасибо|благодарю|понял(?:а)?|да,\s*увидел(?:а)?)/i;
const REPLY_STYLE_RE = /^\s*(понял(?:а)?|да,\s*увидел(?:а)?)/i;

export function classifyOpenerKind(message) {
  const text = String(message ?? "").trim();
  if (!text) return "empty";
  if (REPLY_STYLE_RE.test(text)) return "reply_style";
  if (ACK_OPENER_RE.test(text)) return "acknowledgement";
  return "neutral";
}

export function deriveOutboundPolicy(context, output) {
  const normalizedContext = normalizeConversationContext(context);
  const completedStepCount = Array.isArray(output?.completed_step_ids)
    ? output.completed_step_ids.length
    : 0;
  const hasDecisionSignal = completedStepCount > 0
    || output?.rejected_step_id !== null && output?.rejected_step_id !== undefined
    || output?.step_result === "reject";
  const lastMessageDirection = normalizedContext.lastMessage?.direction ?? null;
  const threadPosition = normalizedContext.hasPriorOutbound ? "follow_up" : "first_touch";

  return {
    threadPosition,
    lastMessageDirection,
    hasDecisionSignal,
    allowsAcknowledgement: hasDecisionSignal,
    allowsReplyStyle: normalizedContext.hasPriorOutbound && lastMessageDirection === "inbound"
  };
}

export function validateOutboundPolicy(message, context, output) {
  const normalizedContext = normalizeConversationContext(context);
  const openerKind = classifyOpenerKind(message);
  if (openerKind === "empty" || openerKind === "neutral") {
    return { ok: true, openerKind, policy: deriveOutboundPolicy(normalizedContext, output) };
  }

  const policy = deriveOutboundPolicy(normalizedContext, output);

  if (openerKind === "reply_style" && !policy.allowsReplyStyle) {
    const reason = normalizedContext.hasPriorOutbound
      ? "reply_style_without_reply_context"
      : "reply_style_without_prior_outbound";
    return { ok: false, reason, openerKind, policy };
  }

  if (openerKind === "acknowledgement" && !policy.allowsAcknowledgement) {
    return { ok: false, reason: "premature_acknowledgement", openerKind, policy };
  }

  return { ok: true, openerKind, policy };
}
