import { interpolate } from "../context-interpolation.js";
import { parseJsonResponse } from "../../json-response.js";

export class PlaybookLlmError extends Error {}

export async function handleLlmExtractStep({ step, context, tenantSql, llmAdapter, llmConfig = {} }) {
  const prompt = buildJsonPrompt(step.prompt_template, context);
  const model = resolveExtractModelOverride(step, llmConfig);
  const raw = await generateWithRetry(llmAdapter, prompt, { model });
  let parsed;
  try {
    parsed = parseJsonResponse(raw);
  } catch (error) {
    throw new PlaybookLlmError(error instanceof Error ? error.message : "Invalid JSON response");
  }
  const nextContext = step.context_key
    ? { ...context, [step.context_key]: parsed }
    : context;

  if (step.db_save_column) {
    await saveVacancyField({
      tenantSql,
      vacancyId: nextContext.vacancy_id,
      column: step.db_save_column,
      value: parsed
    });
  }

  return {
    context: nextContext,
    nextStepOrder: step.next_step_order ?? null,
    reply: null
  };
}

export function buildJsonPrompt(template, context) {
  const interpolated = interpolate(template, context).trim();
  if (/Return valid JSON only, no markdown\.\s*$/i.test(interpolated)) {
    return interpolated;
  }

  return `${interpolated}\n\nReturn valid JSON only, no markdown.`;
}

async function generateWithRetry(llmAdapter, prompt, { model = null } = {}) {
  if (!llmAdapter?.generate) {
    throw new PlaybookLlmError("llmAdapter.generate is required");
  }

  try {
    return await llmAdapter.generate(prompt, model ? { model } : undefined);
  } catch (firstError) {
    try {
      return await llmAdapter.generate(prompt, model ? { model } : undefined);
    } catch {
      throw new PlaybookLlmError(firstError instanceof Error ? firstError.message : "llm_generate_failed");
    }
  }
}

function resolveExtractModelOverride(step, llmConfig) {
  if (
    step?.playbook_key === "create_vacancy" &&
    step?.db_save_column === "application_steps"
  ) {
    return llmConfig?.createVacancy?.applicationStepsExtractModel ?? null;
  }

  return null;
}

export async function saveVacancyField({ tenantSql, vacancyId, column, value }) {
  if (!tenantSql) {
    throw new Error("tenantSql is required to persist vacancy fields");
  }

  if (!vacancyId) {
    throw new Error("vacancy_id is required to persist vacancy fields");
  }

  switch (column) {
    case "must_haves":
      await tenantSql`
        UPDATE chatbot.vacancies
        SET must_haves = ${JSON.stringify(value)}::jsonb, extraction_status = 'partial', updated_at = now()
        WHERE vacancy_id = ${vacancyId}
      `;
      return;
    case "nice_haves":
      await tenantSql`
        UPDATE chatbot.vacancies
        SET nice_haves = ${JSON.stringify(value)}::jsonb, extraction_status = 'partial', updated_at = now()
        WHERE vacancy_id = ${vacancyId}
      `;
      return;
    case "work_conditions":
      await tenantSql`
        UPDATE chatbot.vacancies
        SET work_conditions = ${JSON.stringify(value)}::jsonb, extraction_status = 'partial', updated_at = now()
        WHERE vacancy_id = ${vacancyId}
      `;
      return;
    case "application_steps":
      await tenantSql`
        UPDATE chatbot.vacancies
        SET application_steps = ${JSON.stringify(value)}::jsonb, extraction_status = 'partial', updated_at = now()
        WHERE vacancy_id = ${vacancyId}
      `;
      return;
    case "company_info":
      await tenantSql`
        UPDATE chatbot.vacancies
        SET company_info = ${JSON.stringify(value)}::jsonb, extraction_status = 'partial', updated_at = now()
        WHERE vacancy_id = ${vacancyId}
      `;
      return;
    case "faq":
      await tenantSql`
        UPDATE chatbot.vacancies
        SET faq = ${JSON.stringify(value)}::jsonb, extraction_status = 'partial', updated_at = now()
        WHERE vacancy_id = ${vacancyId}
      `;
      return;
    default:
      throw new Error(`Unsupported vacancy column for playbook save: ${column}`);
  }
}
