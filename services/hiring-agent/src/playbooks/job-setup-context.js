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

  const jobSetup = isPlainObject(nextContext.job_setup) ? nextContext.job_setup : null;
  const vacancy = isPlainObject(nextContext.vacancy) ? nextContext.vacancy : null;
  const canonicalJobSetup = jobSetup ?? vacancy;

  if (canonicalJobSetup) {
    if (!jobSetup) {
      nextContext.job_setup = canonicalJobSetup;
    }
    if (!vacancy) {
      nextContext.vacancy = canonicalJobSetup;
    }
    if (canonicalJobSetup.vacancy_id && !nextContext.vacancy_id) {
      nextContext.vacancy_id = canonicalJobSetup.vacancy_id;
    }
    if (canonicalJobSetup.job_id && !nextContext.job_id) {
      nextContext.job_id = canonicalJobSetup.job_id;
    }
    if (canonicalJobSetup.vacancy_id && !nextContext.job_setup_id) {
      nextContext.job_setup_id = canonicalJobSetup.vacancy_id;
    }
  }

  const rawJobSetupText = getRawJobSetupText(nextContext);
  if (rawJobSetupText != null && nextContext.raw_job_setup_text == null) {
    nextContext.raw_job_setup_text = rawJobSetupText;
  }
  if (rawJobSetupText != null && nextContext.raw_vacancy_text == null) {
    nextContext.raw_vacancy_text = rawJobSetupText;
  }

  return nextContext;
}
