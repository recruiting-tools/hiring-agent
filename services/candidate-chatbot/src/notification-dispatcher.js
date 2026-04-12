export class NotificationDispatcher {
  constructor(store, telegramClient) {
    this.store = store;
    this.telegramClient = telegramClient;
  }

  // Called after applyLlmDecision — pass the newly emitted events
  async dispatch(newEvents) {
    for (const event of newEvents) {
      if (event.event_type === 'step_completed' || event.event_type === 'run_rejected') {
        await this._handleStepEvent(event);
      }
    }
  }

  async _handleStepEvent(event) {
    const run = await this.store.findRunById(event.pipeline_run_id);
    if (!run) return;

    const job = this.store.getJob(run.job_id);
    const templateStep = event.step_id
      ? this.store.getTemplateStep(run.job_id, event.step_id)
      : null;
    const stepIndex = templateStep?.step_index ?? null;

    const subs = await this.store.getSubscriptionsForStep(run.job_id, stepIndex, event.event_type);

    for (const sub of subs) {
      const recruiter = await this.store.getRecruiterById(sub.recruiter_id);
      if (!recruiter?.tg_chat_id) continue;  // null tg_chat_id → skip gracefully

      const candidate = await this.store.getCandidate(run.candidate_id);
      const message = this._buildMessage(event, job, candidate, templateStep);
      await this.telegramClient.notify(recruiter.tg_chat_id, message);
    }
  }

  _buildMessage(event, job, candidate, templateStep) {
    const candidateName = candidate?.display_name ?? 'Кандидат';
    const jobTitle = job?.title ?? 'Вакансия';
    const stepGoal = templateStep?.goal ?? event.step_id ?? '—';

    if (event.event_type === 'step_completed') {
      return `Кандидат ${candidateName} прошёл шаг «${stepGoal}» (${jobTitle})`;
    } else if (event.event_type === 'run_rejected') {
      return `Кандидат ${candidateName} отклонён на шаге «${stepGoal}» (${jobTitle})`;
    }
    return `Событие ${event.event_type} по кандидату ${candidateName} (${jobTitle})`;
  }
}
