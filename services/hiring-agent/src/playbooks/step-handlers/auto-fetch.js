export async function handleAutoFetchStep({ step, context, tenantSql }) {
  if (!tenantSql) {
    throw new Error("tenantSql is required for auto_fetch steps");
  }

  if (!context.vacancy_id) {
    throw new Error("vacancy_id is required for auto_fetch steps");
  }

  const rows = await tenantSql`
    SELECT *
    FROM chatbot.vacancies
    WHERE vacancy_id = ${context.vacancy_id}
    LIMIT 1
  `;

  const vacancy = rows[0] ?? null;
  if (!vacancy) {
    throw new Error(`Vacancy not found: ${context.vacancy_id}`);
  }

  return {
    context: {
      ...context,
      vacancy,
      raw_vacancy_text: vacancy.raw_text
    },
    nextStepOrder: step.next_step_order ?? null,
    reply: null
  };
}
