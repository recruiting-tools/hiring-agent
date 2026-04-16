import { interpolate } from "../context-interpolation.js";
import { syncJobSetupContext } from "../job-setup-context.js";
import { parseJsonResponse } from "../../json-response.js";
import { PlaybookLlmError, saveVacancyField } from "./llm-extract.js";

export async function handleLlmGenerateStep({ step, context, tenantSql, llmAdapter }) {
  if (!llmAdapter?.generate) {
    throw new PlaybookLlmError("llmAdapter.generate is required");
  }

  const syncedContext = syncJobSetupContext(context);
  const prompt = interpolate(step.prompt_template, syncedContext);
  const raw = await llmAdapter.generate(prompt);
  const generatedValue = parseMaybeJson(raw);
  const nextContext = step.context_key
    ? syncJobSetupContext({ ...syncedContext, [step.context_key]: generatedValue })
    : syncedContext;

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
    return parseJsonResponse(raw);
  } catch {
    return raw;
  }
}
