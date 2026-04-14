import { interpolate } from "../context-interpolation.js";
import { PlaybookLlmError, saveVacancyField } from "./llm-extract.js";

export async function handleLlmGenerateStep({ step, context, tenantSql, llmAdapter }) {
  if (!llmAdapter?.generate) {
    throw new PlaybookLlmError("llmAdapter.generate is required");
  }

  const prompt = interpolate(step.prompt_template, context);
  const raw = await llmAdapter.generate(prompt);
  const generatedValue = parseMaybeJson(raw);
  const nextContext = step.context_key
    ? { ...context, [step.context_key]: generatedValue }
    : context;

  if (step.db_save_column) {
    await saveVacancyField({
      tenantSql,
      vacancyId: nextContext.vacancy_id,
      column: step.db_save_column,
      value: generatedValue
    });
  }

  return {
    context: nextContext,
    nextStepOrder: step.next_step_order ?? null,
    reply: {
      kind: "llm_output",
      content: raw,
      content_type: "text"
    }
  };
}

function parseMaybeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
