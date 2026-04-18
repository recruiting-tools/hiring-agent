import { DEFAULT_VALIDATOR_CONFIG } from "./config.js";
import { normalizeConversationContext } from "./conversation-context.js";

const STEP_RESULTS = new Set(["done", "needs_clarification", "reject", "manual_review"]);
const ACK_OPENER_RE = /^\s*(спасибо|благодарю|понял(?:а)?|да,\s*увидел(?:а)?)/i;
const REPLY_STYLE_RE = /^\s*(понял(?:а)?|да,\s*увидел(?:а)?)/i;

export function parseLlmOutput(rawOutput) {
  if (typeof rawOutput === "string") {
    return JSON.parse(rawOutput);
  }
  return rawOutput;
}

export function validateLlmOutput(rawOutput, context, config = DEFAULT_VALIDATOR_CONFIG) {
  const normalizedContext = normalizeConversationContext(context);
  let output;
  try {
    output = parseLlmOutput(rawOutput);
  } catch (error) {
    return invalid("invalid_json", rawOutput, error);
  }

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return invalid("output_not_object", rawOutput);
  }

  if (!STEP_RESULTS.has(output.step_result)) {
    return invalid("invalid_step_result", rawOutput);
  }

  const pendingStepIds = new Set(normalizedContext.pendingSteps.map((step) => step.step_id));
  const completed = output.completed_step_ids;
  if (!Array.isArray(completed)) {
    return invalid("completed_step_ids_not_array", rawOutput);
  }
  for (const stepId of completed) {
    if (!pendingStepIds.has(stepId)) {
      return invalid(`unknown_completed_step:${stepId}`, rawOutput);
    }
  }

  if (output.rejected_step_id !== null && output.rejected_step_id !== undefined && !pendingStepIds.has(output.rejected_step_id)) {
    return invalid(`unknown_rejected_step:${output.rejected_step_id}`, rawOutput);
  }

  if (typeof output.confidence !== "number") {
    return invalid("confidence_not_number", rawOutput);
  }
  if (output.confidence < config.minConfidence) {
    return invalid("low_confidence", rawOutput);
  }

  const nextMessage = output.next_message ?? "";
  if (typeof nextMessage !== "string") {
    return invalid("next_message_not_string", rawOutput);
  }

  if (nextMessage.includes("{{") || nextMessage.includes("}}")) {
    return invalid("placeholder_in_next_message", rawOutput);
  }

  if ((output.step_result === "needs_clarification" || output.step_result === "reject") && nextMessage.trim() === "") {
    return invalid("empty_next_message", rawOutput);
  }

  if (nextMessage.length > config.maxMessageLength) {
    return invalid("next_message_too_long", rawOutput);
  }

  if (normalizedContext.lastOutboundBody && normalize(nextMessage) === normalize(normalizedContext.lastOutboundBody)) {
    return invalid("duplicate_outbound_message", rawOutput);
  }

  if (nextMessage.trim() !== "" && !normalizedContext.hasPriorOutbound && REPLY_STYLE_RE.test(nextMessage)) {
    return invalid("reply_style_without_prior_outbound", rawOutput);
  }

  if (nextMessage.trim() !== "" && completed.length === 0 && ACK_OPENER_RE.test(nextMessage) && !REPLY_STYLE_RE.test(nextMessage)) {
    return invalid("premature_acknowledgement", rawOutput);
  }

  const activeTemplateStep = normalizedContext.activeTemplateStep
    ?? normalizedContext.pendingTemplateSteps.find(
      (step) => step.id === normalizedContext.pendingSteps[0]?.step_id
    );
  if (activeTemplateStep?.kind === "tool" && /https?:\/\//i.test(nextMessage)) {
    return invalid("tool_step_fake_url", rawOutput);
  }

  return {
    ok: true,
    output: {
      step_result: output.step_result,
      completed_step_ids: completed,
      rejected_step_id: output.rejected_step_id ?? null,
      extracted_facts: output.extracted_facts ?? {},
      missing_information: output.missing_information ?? [],
      next_message: nextMessage,
      confidence: output.confidence,
      guard_flags: output.guard_flags ?? []
    }
  };
}

function invalid(reason, rawOutput, error = null) {
  return {
    ok: false,
    reason,
    rawOutput,
    error
  };
}

function normalize(text) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
