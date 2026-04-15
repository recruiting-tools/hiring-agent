import { resolveNextStepOrder } from "./routing.js";

export async function handleDecisionStep({ step, context }) {
  const rules = parseDecisionRules(step.notes, context);
  const rule = rules.find((candidate) => {
    if (candidate.default) return true;
    return evaluateCondition(candidate.condition, context);
  });

  if (!rule) {
    return {
      context,
      nextStepOrder: resolveNextStepOrder(step),
      reply: null
    };
  }

  return {
    context,
    nextStepOrder: rule.next ?? resolveNextStepOrder(step, rule.route ?? rule.outcome),
    reply: rule.message
      ? {
        kind: "display",
        content: String(rule.message),
        content_type: "text"
      }
      : null
  };
}

function parseDecisionRules(notes, context) {
  if (!notes) {
    return [{ default: true, next: null }];
  }

  try {
    const parsed = JSON.parse(notes);
    if (Array.isArray(parsed?.rules)) {
      return parsed.rules;
    }
  } catch {}

  if (Array.isArray(context.must_haves) && String(notes).includes("count < 2")) {
    const count = context.must_haves.length;
    const mustHavesBlock = formatMustHavesBlock(context.must_haves);
    return [
      {
        condition: "context.must_haves.length < 2",
        next: 4,
        message: [
          `Нашли только ${count} обязательных требования — кажется маловато. Не упустили ничего важного?`,
          mustHavesBlock
        ].filter(Boolean).join("\n\n")
      },
      {
        condition: "context.must_haves.length >= 5",
        next: 4,
        message: [
          `Нашли ${count} обязательных требований — это много. Все они действительно блокирующие?`,
          mustHavesBlock
        ].filter(Boolean).join("\n\n")
      },
      {
        default: true,
        next: 4
      }
    ];
  }

  return [{ default: true, next: null }];
}

function evaluateCondition(condition, context) {
  if (!condition) return false;
  const fn = new Function("context", `return (${condition});`);
  return Boolean(fn(context));
}

function formatMustHavesBlock(mustHaves) {
  const items = Array.isArray(mustHaves)
    ? mustHaves.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];

  if (!items.length) {
    return "";
  }

  return [
    "Список обязательных требований:",
    ...items.map((item) => `• ${item}`)
  ].join("\n");
}
