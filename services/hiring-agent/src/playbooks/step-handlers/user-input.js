import { interpolate } from "../context-interpolation.js";
import { syncJobSetupContext } from "../job-setup-context.js";
import { resolveCreateVacancyMaterials } from "../../create-vacancy-materials.js";

export async function handleUserInputStep({
  step,
  session,
  context,
  recruiterInput,
  tenantSql,
  fetchImpl,
  hhVacancyFetchTimeoutMs
}) {
  if (!recruiterInput) {
    return {
      context,
      nextStepOrder: null,
      awaitingInput: true,
      reply: {
        kind: "user_input",
        message: interpolate(step.user_message, context)
      }
    };
  }

  const materials = session?.playbook_key === "create_vacancy"
    ? await resolveCreateVacancyMaterials({
      recruiterInput,
      fetchImpl,
      timeoutMs: hhVacancyFetchTimeoutMs
    })
    : null;
  const resolvedInput = materials?.rawText ?? recruiterInput;
  const nextContext = step.context_key
    ? { ...context, [step.context_key]: resolvedInput }
    : context;

  if (!nextContext.vacancy_id && session?.playbook_key === "create_vacancy") {
    const vacancy = await createDraftVacancy({
      tenantSql,
      recruiterId: session.recruiter_id,
      rawText: resolvedInput,
      title: materials?.title ?? null
    });
    nextContext.vacancy_id = vacancy.vacancy_id;
    nextContext.job_id = vacancy.job_id ?? nextContext.job_id ?? null;
    nextContext.job_setup_id = vacancy.vacancy_id;
    nextContext.job_setup = vacancy;
    nextContext.vacancy = vacancy;
  }

  const syncedContext = syncJobSetupContext(nextContext);

  return {
    context: syncedContext,
    vacancyId: syncedContext.vacancy_id ?? null,
    jobId: syncedContext.job_id ?? syncedContext.job_setup?.job_id ?? syncedContext.vacancy?.job_id ?? null,
    jobSetupId: syncedContext.job_setup_id ?? syncedContext.vacancy_id ?? null,
    nextStepOrder: step.next_step_order ?? null,
    reply: null
  };
}

async function createDraftVacancy({ tenantSql, recruiterId, rawText, title = null }) {
  if (!tenantSql) {
    throw new Error("tenantSql is required to create draft vacancies");
  }

  const resolvedTitle = String(title ?? "").trim() || deriveDraftTitle(rawText);
  const rows = await tenantSql`
    INSERT INTO chatbot.vacancies (
      created_by,
      title,
      raw_text,
      status,
      extraction_status,
      communication_plan,
      communication_plan_draft,
      communication_examples,
      communication_examples_plan_hash
    )
    VALUES (
      ${recruiterId},
      ${resolvedTitle},
      ${rawText},
      'draft',
      'pending',
      NULL,
      NULL,
      '[]'::jsonb,
      NULL
    )
    RETURNING *
  `;

  return rows[0];
}

function deriveDraftTitle(rawText) {
  const firstLine = String(rawText ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "Новая вакансия";
  }

  return firstLine.slice(0, 120);
}
