import { interpolate } from "../context-interpolation.js";
import { parseJsonResponse } from "../../json-response.js";

export class PlaybookLlmError extends Error {}

export async function handleLlmExtractStep({ step, context, tenantSql, llmAdapter, llmConfig = {} }) {
  const prompt = buildJsonPrompt(step, context);
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

export function buildJsonPrompt(stepOrTemplate, context) {
  const step = typeof stepOrTemplate === "string"
    ? { prompt_template: stepOrTemplate }
    : (stepOrTemplate ?? {});
  const interpolated = interpolate(step.prompt_template, context).trim();
  const additions = resolvePromptAdditions(step);

  const parts = [interpolated];
  if (additions) {
    parts.push(additions);
  }

  const draft = parts.filter(Boolean).join("\n\n");
  if (/Return valid JSON only, no markdown\.\s*$/i.test(draft)) {
    return draft;
  }

  return `${draft}\n\nReturn valid JSON only, no markdown.`;
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

function resolvePromptAdditions(step) {
  if (
    step?.playbook_key === "create_vacancy" &&
    step?.db_save_column === "must_haves"
  ) {
    return [
      "Дополнительные правила:",
      "- Считай количество ЛОГИЧЕСКИХ блокирующих требований, а не количество строк, подпунктов или примеров из описания.",
      "- Если одно блокирующее требование описано через альтернативы («или», «либо», «одна из», «один из», список допустимых специальностей/сертификатов/направлений), верни это как ОДИН элемент массива.",
      "- Не раскладывай альтернативные специальности, профили образования, сертификаты или допустимые бэкграунды в несколько элементов массива.",
      "- Каждый элемент массива должен соответствовать одному логическому must-have.",
      "- Хорошо: [\"Одна из специальностей: X / Y / Z\", \"Понимание технологических процессов\"]",
      "- Плохо: [\"Специальность: X\", \"Специальность: Y\", \"Специальность: Z\", \"Понимание технологических процессов\"]"
    ].join("\n");
  }

  return "";
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
