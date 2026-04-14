import { interpolate } from "../context-interpolation.js";
import { parseOptions } from "./buttons.js";
import { findMatchingOption, resolveNextStepOrder } from "./routing.js";

export async function handleDisplayStep({ step, context, recruiterInput }) {
  const content = step.user_message
    ? interpolate(step.user_message, context)
    : resolveDisplayContent(step, context);
  const contentType = resolveDisplayContentType(step, content);
  const options = parseOptions(step.options);

  if (options.length && !recruiterInput) {
    return {
      context,
      nextStepOrder: null,
      awaitingInput: true,
      reply: {
        kind: "display",
        content,
        content_type: contentType,
        options
      }
    };
  }

  if (options.length && recruiterInput) {
    const selected = findMatchingOption(options, recruiterInput);
    if (!selected) {
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

    return {
      context: step.context_key ? { ...context, [step.context_key]: selected } : context,
      nextStepOrder: resolveNextStepOrder(step, selected),
      reply: null
    };
  }

  return {
    context,
    nextStepOrder: resolveNextStepOrder(step),
    reply: {
      kind: "display",
      content,
      content_type: contentType,
      ...(options.length ? { options } : {})
    }
  };
}

function resolveDisplayContent(step, context) {
  if (!step.context_key) return "";
  return context[step.context_key] == null ? "" : String(context[step.context_key]);
}

function resolveDisplayContentType(step, content) {
  if (typeof step.user_message === "string" && step.user_message.includes("| html")) {
    return "html";
  }

  if (typeof content === "string" && /<[^>]+>/.test(content)) {
    return "html";
  }

  return "text";
}
