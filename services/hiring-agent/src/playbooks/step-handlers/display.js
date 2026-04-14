import { interpolate } from "../context-interpolation.js";
import { parseOptions } from "./buttons.js";

export async function handleDisplayStep({ step, context, recruiterInput }) {
  const content = step.user_message
    ? interpolate(step.user_message, context)
    : resolveDisplayContent(step, context);
  const options = parseOptions(step.options);

  if (options.length && !recruiterInput) {
    return {
      context,
      nextStepOrder: null,
      awaitingInput: true,
      reply: {
        kind: "display",
        content,
        content_type: "text",
        options
      }
    };
  }

  if (options.length && recruiterInput) {
    return {
      context,
      nextStepOrder: step.next_step_order ?? null,
      reply: null
    };
  }

  return {
    context,
    nextStepOrder: step.next_step_order ?? null,
    reply: {
      kind: "display",
      content,
      content_type: "text",
      ...(options.length ? { options } : {})
    }
  };
}

function resolveDisplayContent(step, context) {
  if (!step.context_key) return "";
  return context[step.context_key] == null ? "" : String(context[step.context_key]);
}
