export async function handleAutoFetchStep({ step, context, tenantSql }) {
  if (!tenantSql) {
    throw new Error("tenantSql is required for auto_fetch steps");
  }

  if (!context.vacancy_id && !context.job_id) {
    throw new Error("vacancy_id or job_id is required for auto_fetch steps");
  }

  const vacancy = await findVacancyByIdentity(tenantSql, context);
  if (!vacancy) {
    throw new Error(`Vacancy not found: ${context.vacancy_id ?? context.job_id}`);
  }

  return {
    context: {
      ...context,
      vacancy_id: vacancy.vacancy_id ?? context.vacancy_id ?? null,
      job_id: vacancy.job_id ?? context.job_id ?? null,
      vacancy,
      raw_vacancy_text: vacancy.raw_text
    },
    nextStepOrder: step.next_step_order ?? null,
    reply: null
  };
}

async function findVacancyByIdentity(tenantSql, context) {
  if (context.vacancy_id) {
    const rows = await tenantSql`
      SELECT *
      FROM chatbot.vacancies
      WHERE vacancy_id = ${context.vacancy_id}
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  }

  if (context.job_id) {
    const rows = await tenantSql`
      SELECT *
      FROM chatbot.vacancies
      WHERE job_id = ${context.job_id}
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'draft' THEN 1
          ELSE 2
        END ASC,
        updated_at DESC NULLS LAST,
        created_at DESC
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  }

  return null;
}
