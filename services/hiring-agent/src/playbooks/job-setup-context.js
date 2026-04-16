function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getJobSetup(context) {
  if (!isPlainObject(context)) return null;
  if (isPlainObject(context.job_setup)) return context.job_setup;
  if (isPlainObject(context.vacancy)) return context.vacancy;
  return null;
}

export function getRawJobSetupText(context) {
  if (!isPlainObject(context)) return null;
  return context.raw_job_setup_text ?? context.raw_vacancy_text ?? getJobSetup(context)?.raw_text ?? null;
}

export function getJobIdFromContext(context) {
  const jobSetup = getJobSetup(context);
  return jobSetup?.job_id
    ?? context?.job_id
    ?? context?.client_context?.job_id
    ?? context?.vacancy_id
    ?? null;
}

export function syncJobSetupContext(context, { vacancyId = null, jobId = null, jobSetupId = null } = {}) {
  const nextContext = isPlainObject(context) ? { ...context } : {};

  if (vacancyId && !nextContext.vacancy_id) {
    nextContext.vacancy_id = vacancyId;
  }
  if (jobId && !nextContext.job_id) {
    nextContext.job_id = jobId;
  }
  if ((jobSetupId ?? vacancyId) && !nextContext.job_setup_id) {
    nextContext.job_setup_id = jobSetupId ?? vacancyId;
  }

  const jobSetup = isPlainObject(nextContext.job_setup)
    ? nextContext.job_setup
    : (isPlainObject(nextContext.vacancy) ? nextContext.vacancy : null);

  if (jobSetup) {
    if (!isPlainObject(nextContext.job_setup)) {
      nextContext.job_setup = jobSetup;
    }
    if (jobSetup.vacancy_id && !nextContext.vacancy_id) {
      nextContext.vacancy_id = jobSetup.vacancy_id;
    }
    if (jobSetup.job_id && !nextContext.job_id) {
      nextContext.job_id = jobSetup.job_id;
    }
    if (jobSetup.vacancy_id && !nextContext.job_setup_id) {
      nextContext.job_setup_id = jobSetup.vacancy_id;
    }
  }

  const rawJobSetupText = getRawJobSetupText(nextContext);
  if (rawJobSetupText != null && nextContext.raw_job_setup_text == null) {
    nextContext.raw_job_setup_text = rawJobSetupText;
  }

  return nextContext;
}
