import { interpolate } from "../context-interpolation.js";

export class PlaybookLlmError extends Error {}

export async function handleLlmExtractStep({ step, context, tenantSql, llmAdapter }) {
  const prompt = buildJsonPrompt(step.prompt_template, context);
  const raw = await generateWithRetry(llmAdapter, prompt);
  const parsed = JSON.parse(raw);
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

async function generateWithRetry(llmAdapter, prompt) {
  if (!llmAdapter?.generate) {
    throw new PlaybookLlmError("llmAdapter.generate is required");
  }

  try {
    return await llmAdapter.generate(prompt);
  } catch (firstError) {
    try {
      return await llmAdapter.generate(prompt);
    } catch {
      throw new PlaybookLlmError(firstError instanceof Error ? firstError.message : "llm_generate_failed");
    }
  }
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
