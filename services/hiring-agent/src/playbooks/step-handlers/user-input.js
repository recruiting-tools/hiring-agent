import { interpolate } from "../context-interpolation.js";

export async function handleUserInputStep({ step, session, context, recruiterInput, tenantSql }) {
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

  const nextContext = step.context_key
    ? { ...context, [step.context_key]: recruiterInput }
    : context;

  if (!nextContext.vacancy_id && session?.playbook_key === "create_vacancy") {
    const vacancy = await createDraftVacancy({
      tenantSql,
      recruiterId: session.recruiter_id,
      rawText: recruiterInput
    });
    nextContext.vacancy_id = vacancy.vacancy_id;
    nextContext.vacancy = vacancy;
  }

  return {
    context: nextContext,
    vacancyId: nextContext.vacancy_id ?? null,
    nextStepOrder: step.next_step_order ?? null,
    reply: null
  };
}

async function createDraftVacancy({ tenantSql, recruiterId, rawText }) {
  if (!tenantSql) {
    throw new Error("tenantSql is required to create draft vacancies");
  }

  const title = deriveDraftTitle(rawText);
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
      ${title},
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
