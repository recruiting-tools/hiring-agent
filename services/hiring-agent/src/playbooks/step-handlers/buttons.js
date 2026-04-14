import { interpolate } from "../context-interpolation.js";
import { findMatchingOption, resolveNextStepOrder } from "./routing.js";

export async function handleButtonsStep({ step, context, recruiterInput }) {
  const options = parseOptions(step.options);
  if (!recruiterInput) {
    return {
      context,
      nextStepOrder: null,
      awaitingInput: true,
      reply: {
        kind: "buttons",
        message: interpolate(step.user_message, context),
        options,
        step_key: step.step_key
      }
    };
  }

  const selected = findMatchingOption(options, recruiterInput);
  if (!selected) {
    return {
      context,
      nextStepOrder: null,
      awaitingInput: true,
      reply: {
        kind: "buttons",
        message: interpolate(step.user_message, context),
        options,
        step_key: step.step_key
      }
    };
  }

  return {
    context: step.context_key ? { ...context, [step.context_key]: selected } : context,
    nextStepOrder: resolveNextStepOrder(step, selected),
    reply: null
  };
}

export function parseOptions(rawOptions) {
  return String(rawOptions ?? "")
    .split(";")
    .map((option) => option.trim())
    .filter(Boolean);
}
