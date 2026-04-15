import { randomBytes } from "node:crypto";
import { getModerationAutoSendDelayMs } from "./config.js";

export class InMemoryHiringStore {
  constructor(seed) {
    // Support both single recruiter (old format) and array (new format)
    this.recruiters = seed.recruiters
      ? structuredClone(seed.recruiters)
      : (seed.recruiter ? [structuredClone(seed.recruiter)] : []);
    // backward compat alias
    this.recruiter = this.recruiters[0] ?? null;

    this.clients = seed.clients
      ? structuredClone(seed.clients)
      : (seed.client ? [structuredClone(seed.client)] : []);
    // backward compat alias
    this.client = this.clients[0] ?? null;

    this.jobs = new Map();
    this.candidates = new Map();
    this.conversations = new Map();
    this.pipelineRuns = new Map();
    this.pipelineStepState = new Map();
    this.messages = [];
    this.plannedMessages = [];
    this.pipelineEvents = [];
    this.idCounters = new Map();
    // Telegram subscriptions
    this.recruiterSubscriptions = structuredClone(seed.recruiter_subscriptions ?? []);
    // HH integration
    this.hhNegotiations = new Map();  // hh_negotiation_id → negotiation
    this.hhPollStates = new Map();    // hh_negotiation_id → pollState
    this.deliveryAttempts = [];       // flat array of delivery attempts
    this.oauthTokens = new Map();     // provider → token row
    this.sessions = new Map();        // session_token → { recruiter_id, expires_at }
    this.featureFlags = new Map([
      ["hh_send", { flag: "hh_send", enabled: false, description: "Controls outbound HH sending" }],
      ["hh_import", { flag: "hh_import", enabled: false, description: "Controls HH applicant import and polling" }]
    ]);

    for (const job of seed.jobs) {
      this.jobs.set(job.job_id, structuredClone(job));
    }

    for (const fixture of seed.candidate_fixtures) {
      this.seedCandidateFixture(fixture);
    }
  }

  seedCandidateFixture(fixture) {
    const job = this.getJob(fixture.job_id);
    const candidate = {
      candidate_id: fixture.candidate_id,
      canonical_email: null,
      display_name: fixture.display_name,
      resume_text: fixture.resume_text
    };
    const conversation = {
      conversation_id: fixture.conversation_id,
      job_id: fixture.job_id,
      candidate_id: fixture.candidate_id,
      channel: "test",
      channel_thread_id: fixture.conversation_id,
      status: "open",
      client_id: job.client_id ?? null
    };
    const pipelineRun = {
      pipeline_run_id: fixture.pipeline_run_id,
      job_id: fixture.job_id,
      candidate_id: fixture.candidate_id,
      template_id: job.pipeline_template.template_id,
      template_version: job.pipeline_template.template_version,
      active_step_id: job.pipeline_template.steps[0]?.id ?? null,
      state_json: {},
      status: "active"
    };

    this.candidates.set(candidate.candidate_id, candidate);
    this.conversations.set(conversation.conversation_id, conversation);
    this.pipelineRuns.set(pipelineRun.pipeline_run_id, pipelineRun);
    this.pipelineStepState.set(pipelineRun.pipeline_run_id, job.pipeline_template.steps.map((step, index) => ({
      pipeline_run_id: pipelineRun.pipeline_run_id,
      step_id: step.id,
      step_index: step.step_index,
      state: index === 0 ? "active" : "pending",
      awaiting_reply: index === 0,
      extracted_facts: {},
      last_reason: null,
      completed_at: null
    })));
  }

  nextId(prefix) {
    const next = (this.idCounters.get(prefix) ?? 0) + 1;
    this.idCounters.set(prefix, next);
    return `${prefix}-${String(next).padStart(4, "0")}`;
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return job;
  }

  getCandidate(candidateId) {
    return this.candidates.get(candidateId) ?? null;
  }

  findConversation(conversationId) {
    return this.conversations.get(conversationId) ?? null;
  }

  findActiveRunForConversation(conversation) {
    const run = [...this.pipelineRuns.values()].find((candidateRun) => (
      candidateRun.job_id === conversation.job_id &&
      candidateRun.candidate_id === conversation.candidate_id &&
      candidateRun.status === "active"
    ));
    return run ?? null;
  }

  findRunForConversation(conversation) {
    const run = [...this.pipelineRuns.values()].find((candidateRun) => (
      candidateRun.job_id === conversation.job_id &&
      candidateRun.candidate_id === conversation.candidate_id
    ));
    return run ?? null;
  }

  getPendingSteps(pipelineRunId) {
    return this.getStepStates(pipelineRunId)
      .filter((step) => step.state === "pending" || step.state === "active")
      .sort((a, b) => a.step_index - b.step_index);
  }

  getStepStates(pipelineRunId) {
    return this.pipelineStepState.get(pipelineRunId) ?? [];
  }

  getTemplateStep(jobId, stepId) {
    const job = this.getJob(jobId);
    return job.pipeline_template.steps.find((step) => step.id === stepId) ?? null;
  }

  getHistory(conversationId) {
    return this.messages
      .filter((message) => message.conversation_id === conversationId)
      .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  }

  getLastOutboundBody(conversationId) {
    const planned = this.plannedMessages
      .filter((message) => message.conversation_id === conversationId)
      .at(-1)?.body;
    if (planned) {
      return planned;
    }

    return this.messages
      .filter((message) => message.conversation_id === conversationId && message.direction === "outbound")
      .at(-1)?.body ?? null;
  }

  addInboundMessage(request, conversation) {
    const message = {
      message_id: this.nextId("msg"),
      conversation_id: conversation.conversation_id,
      candidate_id: conversation.candidate_id,
      direction: "inbound",
      message_type: "text",
      body: request.text,
      channel: request.channel,
      channel_message_id: request.channel_message_id,
      occurred_at: request.occurred_at,
      received_at: new Date().toISOString()
    };
    this.messages.push(message);
    return message;
  }

  addPipelineEvent(event) {
    const stored = {
      event_id: this.nextId("event"),
      created_at: new Date().toISOString(),
      ...event
    };
    this.pipelineEvents.push(stored);
    return stored;
  }

  applyLlmDecision({ run, job, llmOutput, conversation, pendingSteps: _pendingSteps }) {
    const stepStates = this.getStepStates(run.pipeline_run_id);
    const now = new Date().toISOString();
    const beforeEventCount = this.pipelineEvents.length;

    for (const completedStepId of llmOutput.completed_step_ids) {
      const stepState = stepStates.find((step) => step.step_id === completedStepId);
      if (!stepState) continue;
      const stepFacts = llmOutput.extracted_facts?.[completedStepId] ?? {};
      stepState.state = "completed";
      stepState.awaiting_reply = false;
      stepState.extracted_facts = stepFacts;
      stepState.last_reason = "completed_by_llm";
      stepState.completed_at = now;
      this.addPipelineEvent({
        pipeline_run_id: run.pipeline_run_id,
        candidate_id: run.candidate_id,
        event_type: "step_completed",
        step_id: completedStepId,
        payload: {
          extracted_facts: stepFacts
        }
      });
    }

    if (llmOutput.step_result === "reject" && llmOutput.rejected_step_id) {
      const rejectedState = stepStates.find((step) => step.step_id === llmOutput.rejected_step_id);
      if (rejectedState) {
        rejectedState.state = "rejected";
        rejectedState.awaiting_reply = false;
        rejectedState.last_reason = "rejected_by_llm";
      }
      run.status = "rejected";
      run.active_step_id = llmOutput.rejected_step_id;
      this.addPipelineEvent({
        pipeline_run_id: run.pipeline_run_id,
        candidate_id: run.candidate_id,
        event_type: "run_rejected",
        step_id: llmOutput.rejected_step_id,
        payload: {
          reason: "reject_when_matched"
        }
      });
    } else {
      const pending = this.getPendingSteps(run.pipeline_run_id);
      const nextActive = pending.find((step) => !llmOutput.completed_step_ids.includes(step.step_id));
      for (const stepState of pending) {
        stepState.state = "pending";
        stepState.awaiting_reply = false;
      }
      if (nextActive) {
        nextActive.state = "active";
        nextActive.awaiting_reply = true;
        run.active_step_id = nextActive.step_id;
      } else {
        run.status = "completed";
        run.active_step_id = null;
        this.addPipelineEvent({
          pipeline_run_id: run.pipeline_run_id,
          candidate_id: run.candidate_id,
          event_type: "run_completed",
          step_id: null,
          payload: {}
        });
      }
    }

    if (!llmOutput.next_message) {
      return { plannedMessage: null, newEvents: this.pipelineEvents.slice(beforeEventCount) };
    }

    const plannedMessage = {
      planned_message_id: this.nextId("pm"),
      conversation_id: conversation.conversation_id,
      candidate_id: conversation.candidate_id,
      pipeline_run_id: run.pipeline_run_id,
      step_id: llmOutput.rejected_step_id ?? run.active_step_id,
      body: llmOutput.next_message,
      reason: buildPlannedMessageReason(llmOutput, job),
      review_status: "pending",
      moderation_policy: "window_to_reject",
      send_after: new Date(Date.now() + getModerationAutoSendDelayMs()).toISOString(),
      auto_send_after: new Date(Date.now() + getModerationAutoSendDelayMs()).toISOString(),
      idempotency_key: `${run.pipeline_run_id}:${llmOutput.rejected_step_id ?? run.active_step_id}:${this.pipelineEvents.filter((e) => e.pipeline_run_id === run.pipeline_run_id && e.event_type === "message_planned").length}`
    };
    this.plannedMessages.push(plannedMessage);
    this.addPipelineEvent({
      pipeline_run_id: run.pipeline_run_id,
      candidate_id: run.candidate_id,
      event_type: "message_planned",
      step_id: plannedMessage.step_id,
      payload: {
        planned_message_id: plannedMessage.planned_message_id
      }
    });
    return { plannedMessage, newEvents: this.pipelineEvents.slice(beforeEventCount) };
  }

  // ─── Recruiter lookups ───────────────────────────────────────────────────────

  getRecruiterById(recruiterId) {
    return this.recruiters.find(r => r.recruiter_id === recruiterId) ?? null;
  }

  findRunById(pipelineRunId) {
    return this.pipelineRuns.get(pipelineRunId) ?? null;
  }

  // ─── Telegram subscriptions ──────────────────────────────────────────────────

  addSubscription(sub) {
    // sub: { recruiter_id, job_id, step_index, event_type }
    // Tenant isolation: recruiter must belong to the same client as the job
    const recruiter = this.getRecruiterById(sub.recruiter_id);
    const job = this.jobs.get(sub.job_id) ?? null;
    if (!recruiter || !job || recruiter.client_id !== job.client_id) {
      throw new Error(
        `Tenant isolation: recruiter ${sub.recruiter_id} cannot subscribe to job ${sub.job_id}`
      );
    }
    const existing = this.recruiterSubscriptions.find(
      s => s.recruiter_id === sub.recruiter_id &&
           s.job_id === sub.job_id &&
           s.step_index === sub.step_index &&
           s.event_type === sub.event_type
    );
    if (!existing) {
      this.recruiterSubscriptions.push({
        subscription_id: this.nextId('sub'),
        created_at: new Date().toISOString(),
        ...sub
      });
    }
  }

  removeSubscription(recruiterId, jobId, stepIndex, eventType = 'step_completed') {
    this.recruiterSubscriptions = this.recruiterSubscriptions.filter(
      s => !(s.recruiter_id === recruiterId &&
             s.job_id === jobId &&
             s.step_index === stepIndex &&
             s.event_type === eventType)
    );
  }

  getSubscriptionsForStep(jobId, stepIndex, eventType) {
    return this.recruiterSubscriptions.filter(
      s => s.job_id === jobId &&
           s.step_index === stepIndex &&
           s.event_type === eventType
    );
  }

  markManualReview({ run, candidateId, reason, rawOutput }) {
    // run.status stays "active" — the event log records the failure,
    // but the run remains open for the recruiter to intervene or for
    // the next candidate message to be re-processed.
    this.addPipelineEvent({
      pipeline_run_id: run.pipeline_run_id,
      candidate_id: candidateId,
      event_type: "llm_output_rejected",
      step_id: run.active_step_id,
      payload: {
        reason,
        raw_output: rawOutput
      }
    });
  }

  getPendingQueue() {
    return {
      items: this.plannedMessages
        .filter((message) => message.review_status === "pending")
        .map((message) => ({
          planned_message_id: message.planned_message_id,
          conversation_id: message.conversation_id,
          candidate_id: message.candidate_id,
          pipeline_run_id: message.pipeline_run_id,
          step_id: message.step_id,
          body: message.body,
          reason: message.reason,
          review_status: message.review_status
        }))
    };
  }

  // ─── HH Negotiations ────────────────────────────────────────────────────────

  async findHhNegotiation(hhNegotiationId) {
    return this.hhNegotiations.get(hhNegotiationId) ?? null;
  }

  async upsertHhNegotiation({ hh_negotiation_id, job_id, candidate_id, hh_vacancy_id, hh_collection, channel_thread_id }) {
    const existing = this.hhNegotiations.get(hh_negotiation_id) ?? {};
    const negotiation = {
      ...existing,
      hh_negotiation_id,
      job_id,
      candidate_id,
      hh_vacancy_id,
      hh_collection,
      channel_thread_id,
      created_at: existing.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.hhNegotiations.set(hh_negotiation_id, negotiation);
    return negotiation;
  }

  async ensureImportedHhNegotiation({ hhNegotiation, job_id, collection = "response", resume }) {
    const job = this.getJob(job_id);
    const candidate_id = `cand-hh-${hhNegotiation.id}`;
    const conversation_id = `conv-hh-${hhNegotiation.id}`;
    const pipeline_run_id = `run-hh-${hhNegotiation.id}`;
    const template = job.pipeline_template;
    const existingRun = this.pipelineRuns.get(pipeline_run_id) ?? null;
    const needsReset = !existingRun
      || existingRun.job_id !== job_id
      || existingRun.template_id !== template.template_id
      || existingRun.template_version !== template.template_version;

    this.candidates.set(candidate_id, {
      candidate_id,
      canonical_email: resume?.email ?? this.candidates.get(candidate_id)?.canonical_email ?? null,
      display_name: buildResumeDisplayName(resume, hhNegotiation.resume?.id),
      resume_text: buildResumeText(resume)
    });

    const initialStepId = resolveInitialStepId(template, collection);
    const initialStepIndex = template.steps.findIndex((s) => s.id === initialStepId);

    // Preserve status for existing conversations — do not reopen completed/withdrawn (M1)
    const existingConv = this.conversations.get(conversation_id);
    const convStatus = existingConv && ["completed", "withdrawn"].includes(existingConv.status)
      ? existingConv.status
      : "open";
    this.conversations.set(conversation_id, {
      conversation_id,
      job_id,
      candidate_id,
      channel: "hh",
      channel_thread_id: conversation_id,
      status: convStatus,
      client_id: job.client_id ?? null
    });

    this.pipelineRuns.set(pipeline_run_id, {
      pipeline_run_id,
      job_id,
      candidate_id,
      template_id: template.template_id,
      template_version: template.template_version,
      active_step_id: needsReset
        ? initialStepId
        : (existingRun?.active_step_id ?? initialStepId),
      state_json: existingRun?.state_json ?? {},
      status: needsReset ? "active" : (existingRun?.status ?? "active")
    });

    if (needsReset || !this.pipelineStepState.has(pipeline_run_id)) {
      this.pipelineStepState.set(
        pipeline_run_id,
        template.steps.map((step, index) => {
          const isPrior = index < initialStepIndex;
          const isInitial = step.id === initialStepId;
          return {
            pipeline_run_id,
            step_id: step.id,
            step_index: step.step_index,
            state: isPrior ? "completed" : (isInitial ? "active" : "pending"),
            awaiting_reply: isInitial,
            extracted_facts: {},
            last_reason: null,
            completed_at: null
          };
        })
      );
    }

    if (needsReset) {
      for (const plannedMessage of this.plannedMessages) {
        if (plannedMessage.conversation_id !== conversation_id) continue;
        if (!["pending", "approved"].includes(plannedMessage.review_status)) continue;
        plannedMessage.review_status = "blocked";
        plannedMessage.reason = appendImportResetReason(plannedMessage.reason);
      }
    }

    await this.upsertHhNegotiation({
      hh_negotiation_id: hhNegotiation.id,
      job_id,
      candidate_id,
      hh_vacancy_id: hhNegotiation.vacancy?.id ?? hhNegotiation.hh_vacancy_id ?? "",
      hh_collection: hhNegotiation.state?.id ?? hhNegotiation.collection ?? "response",
      channel_thread_id: conversation_id
    });

    return { candidate_id, conversation_id, pipeline_run_id };
  }

  async findHhNegotiationByChannelThreadId(channelThreadId) {
    for (const neg of this.hhNegotiations.values()) {
      if (neg.channel_thread_id === channelThreadId) return neg;
    }
    return null;
  }

  async getHhNegotiationsDue() {
    const now = new Date();
    const result = [];
    for (const neg of this.hhNegotiations.values()) {
      const pollState = this.hhPollStates.get(neg.hh_negotiation_id);
      // If no poll state yet, treat as due immediately
      if (!pollState || new Date(pollState.next_poll_at) <= now) {
        result.push(neg);
      }
    }
    return result;
  }

  // ─── HH Poll State ───────────────────────────────────────────────────────────

  async getHhPollState(hhNegotiationId) {
    return this.hhPollStates.get(hhNegotiationId) ?? null;
  }

  async upsertHhPollState(hhNegotiationId, { last_polled_at, hh_updated_at, last_sender, awaiting_reply, next_poll_at }) {
    const existing = this.hhPollStates.get(hhNegotiationId) ?? {};
    const pollState = {
      ...existing,
      hh_negotiation_id: hhNegotiationId,
      last_polled_at,
      hh_updated_at,
      last_sender,
      awaiting_reply,
      no_response_streak: existing.no_response_streak ?? 0,
      next_poll_at
    };
    this.hhPollStates.set(hhNegotiationId, pollState);
    return pollState;
  }

  async upsertImportedMessage({
    conversation_id,
    candidate_id,
    direction,
    body,
    channel,
    channel_message_id,
    occurred_at
  }) {
    const existing = this.messages.find(
      (message) => message.conversation_id === conversation_id && message.channel_message_id === channel_message_id
    );
    if (existing) return null;

    const stored = {
      message_id: this.nextId("msg"),
      conversation_id,
      candidate_id,
      direction,
      message_type: "text",
      body,
      channel,
      channel_message_id,
      occurred_at,
      received_at: new Date().toISOString()
    };
    this.messages.push(stored);
    return stored;
  }

  // ─── Cron Sender ─────────────────────────────────────────────────────────────

  async getPlannedMessagesDue(now) {
    return this.plannedMessages
      .filter((pm) => {
        if (!["pending", "approved"].includes(pm.review_status)) return false;
        if (!pm.auto_send_after) return false;
        return new Date(pm.auto_send_after) <= now;
      })
      .map((pm) => {
        const conv = this.conversations.get(pm.conversation_id);
        if (!conv) throw new Error(`Missing conversation for planned_message ${pm.planned_message_id}`);
        return { ...pm, channel_thread_id: conv.channel_thread_id };
      });
  }

  // ─── Delivery Attempts ───────────────────────────────────────────────────────

  async recordDeliveryAttempt({ attempt_id, planned_message_id, hh_negotiation_id, status }) {
    const existing = this.deliveryAttempts.find(
      (a) => a.planned_message_id === planned_message_id && ["sending", "delivered"].includes(a.status)
    );
    if (existing) return existing;

    const attempt = {
      attempt_id,
      planned_message_id,
      hh_negotiation_id,
      status,
      hh_message_id: null,
      attempted_at: new Date().toISOString(),
      error_body: null
    };
    this.deliveryAttempts.push(attempt);
    return attempt;
  }

  async getSuccessfulDeliveryAttempt(plannedMessageId) {
    return this.deliveryAttempts.find(
      (a) => a.planned_message_id === plannedMessageId && a.status === "delivered"
    ) ?? null;
  }

  async markDeliveryAttemptDelivered({ attempt_id, hh_message_id }) {
    const attempt = this.deliveryAttempts.find((a) => a.attempt_id === attempt_id);
    if (attempt) {
      attempt.status = "delivered";
      attempt.hh_message_id = hh_message_id;
    }
  }

  async markDeliveryAttemptFailed({ attempt_id, error_body }) {
    const attempt = this.deliveryAttempts.find((a) => a.attempt_id === attempt_id);
    if (attempt) {
      attempt.status = "failed";
      attempt.error_body = error_body;
    }
  }

  async markPlannedMessageSent({ planned_message_id, sent_at, hh_message_id }) {
    const pm = this.plannedMessages.find((m) => m.planned_message_id === planned_message_id);
    if (pm) {
      pm.review_status = "sent";
      pm.sent_at = sent_at;
    }
    if (hh_message_id) {
      const attempt = this.deliveryAttempts.find(
        (a) => a.planned_message_id === planned_message_id && a.status === "delivered"
      );
      if (attempt) attempt.hh_message_id = hh_message_id;
    }
  }

  // ─── Alert ───────────────────────────────────────────────────────────────────

  async getAwaitingReplyStaleConversations(staleMinutes) {
    const now = new Date();
    const result = [];

    for (const [hhNegotiationId, pollState] of this.hhPollStates.entries()) {
      if (!pollState.awaiting_reply) continue;

      // Find the last delivered outbound message for this negotiation
      const deliveredAttempts = this.deliveryAttempts
        .filter((a) => a.hh_negotiation_id === hhNegotiationId && a.status === "delivered")
        .sort((a, b) => new Date(b.attempted_at) - new Date(a.attempted_at));

      if (deliveredAttempts.length === 0) continue;

      const lastSentAt = new Date(deliveredAttempts[0].attempted_at);
      const minutesAgo = (now - lastSentAt) / (60 * 1000);

      if (minutesAgo >= staleMinutes) {
        const negotiation = this.hhNegotiations.get(hhNegotiationId);
        result.push({
          hh_negotiation_id: hhNegotiationId,
          channel_thread_id: negotiation?.channel_thread_id ?? null,
          last_sent_at: lastSentAt.toISOString(),
          awaiting_since_minutes: Math.floor(minutesAgo)
        });
      }
    }

    return result;
  }

  // ─── Management / HH OAuth ──────────────────────────────────────────────────

  async getHhOAuthTokens(provider = "hh") {
    return this.oauthTokens.get(provider) ?? null;
  }

  async setHhOAuthTokens(provider = "hh", tokens) {
    const existing = this.oauthTokens.get(provider) ?? null;
    const row = {
      provider,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
      token_type: tokens.token_type ?? existing?.token_type ?? "bearer",
      expires_at: tokens.expires_at ?? existing?.expires_at ?? null,
      scope: tokens.scope ?? existing?.scope ?? null,
      metadata: structuredClone(tokens.metadata ?? existing?.metadata ?? {}),
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.oauthTokens.set(provider, row);
    return row;
  }

  async getFeatureFlag(flag) {
    return this.featureFlags.get(flag) ?? null;
  }

  async setFeatureFlag(flag, enabled, description = null) {
    const existing = this.featureFlags.get(flag) ?? null;
    const row = {
      flag,
      enabled,
      description: description ?? existing?.description ?? null,
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.featureFlags.set(flag, row);
    return row;
  }

  // ─── Moderation UI ───────────────────────────────────────────────────────────

  async getRecruiterByToken(token) {
    return this.recruiters.find(r => r.recruiter_token === token) ?? null;
  }

  async getRecruiterByEmail(email) {
    return this.recruiters.find(r => r.email === email) ?? null;
  }

  async setRecruiterPassword(recruiterId, passwordHash) {
    const recruiter = this.recruiters.find((row) => row.recruiter_id === recruiterId);
    if (!recruiter) return;
    recruiter.password_hash = passwordHash;
  }

  async createSession(recruiterId) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    this.sessions.set(token, {
      recruiter_id: recruiterId,
      expires_at: expiresAt
    });
    return token;
  }

  async getSessionRecruiter(token) {
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expires_at <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return this.recruiters.find((row) => row.recruiter_id === session.recruiter_id) ?? null;
  }

  async findPlannedMessage(plannedMessageId) {
    return this.plannedMessages.find((m) => m.planned_message_id === plannedMessageId) ?? null;
  }

  async findConversation(conversationId) {
    return this.conversations.get(conversationId) ?? null;
  }

  async getQueueForRecruiter(recruiterToken, { jobId } = {}) {
    const recruiter = await this.getRecruiterByToken(recruiterToken);
    if (!recruiter) return null; // null = token not found

    const clientId = recruiter.client_id ?? null;
    const now = Date.now();

    return this.plannedMessages
      .filter((pm) => ["pending", "approved"].includes(pm.review_status))
      .filter((pm) => {
        // Scope by client_id. Backward compat: if job has no client_id → include.
        const conv = this.conversations.get(pm.conversation_id);
        if (!conv) return false;
        const job = this.jobs.get(conv.job_id);
        if (!job) return false;
        if (jobId && conv.job_id !== jobId) return false;
        // Exclude if job has a client_id that doesn't match recruiter's client_id.
        // Treat missing/null job.client_id as "no tenant" (backward compat).
        // Null-client_id recruiter sees only null-client_id jobs (matches Postgres behavior).
        const jobClientId = job.client_id ?? null;
        if (jobClientId !== null && jobClientId !== clientId) return false;
        return true;
      })
      .map((pm) => {
        const conv = this.conversations.get(pm.conversation_id);
        const candidate = this.candidates.get(pm.candidate_id);
        const job = conv ? this.jobs.get(conv.job_id) : null;
        const run = [...this.pipelineRuns.values()].find((r) => r.pipeline_run_id === pm.pipeline_run_id);
        const stepStates = run ? this.getStepStates(run.pipeline_run_id) : [];
        const activeStep = stepStates.find((s) => s.step_id === (run?.active_step_id ?? pm.step_id));
        const history = this.getHistory(pm.conversation_id);
        const lastMessageBody = history.at(-1)?.body ?? pm.body;
        let templateStep = null;
        if (job && activeStep) {
          try {
            templateStep = this.getTemplateStep(job.job_id, activeStep.step_id);
          } catch {
            templateStep = null;
          }
        }
        return {
          planned_message_id: pm.planned_message_id,
          conversation_id: pm.conversation_id,
          candidate_id: pm.candidate_id,
          candidate_display_name: candidate?.display_name ?? "Неизвестно",
          job_id: job?.job_id ?? null,
          job_title: job?.title ?? "Неизвестно",
          step_id: pm.step_id ?? null,
          active_step_goal: templateStep?.goal ?? pm.step_id ?? "",
          body: pm.body,
          planned_message_preview: summarizeText(pm.body, 200),
          last_message_preview: summarizeText(lastMessageBody, 200),
          reason: pm.reason,
          review_status: pm.review_status,
          auto_send_after: pm.auto_send_after,
          seconds_until_auto_send: Math.round((new Date(pm.auto_send_after) - now) / 1000),
          resume_text: candidate?.resume_text ?? "",
          history: history.map((message) => ({
            message_id: message.message_id,
            direction: message.direction,
            body: message.body,
            occurred_at: message.occurred_at,
            channel: message.channel,
            message_type: message.message_type
          }))
        };
      })
      .sort((a, b) => new Date(a.auto_send_after) - new Date(b.auto_send_after));
  }

  async blockMessage(plannedMessageId) {
    const pm = this.plannedMessages.find((m) => m.planned_message_id === plannedMessageId);
    if (!pm) return; // no-op: handler checks existence before calling
    if (pm.review_status === "sent") throw new Error("already_sent");
    pm.review_status = "blocked";
  }

  async approveAndSendNow(plannedMessageId) {
    const pm = this.plannedMessages.find((m) => m.planned_message_id === plannedMessageId);
    if (!pm) return; // no-op: handler checks existence before calling
    if (pm.review_status === "sent") throw new Error("already_sent");
    pm.review_status = "approved";
    pm.auto_send_after = new Date(Date.now() - 1000).toISOString();
  }

  rebuildStepStateFromEvents(pipelineRunId) {
    const run = this.pipelineRuns.get(pipelineRunId);
    if (!run) {
      throw new Error(`Unknown pipeline run: ${pipelineRunId}`);
    }
    const job = this.getJob(run.job_id);
    const rebuilt = job.pipeline_template.steps.map((step, index) => ({
      pipeline_run_id: pipelineRunId,
      step_id: step.id,
      step_index: step.step_index,
      state: "pending",
      awaiting_reply: false,
      extracted_facts: {},
      last_reason: null,
      completed_at: null
    }));

    let runRejected = false;
    let runCompleted = false;
    for (const event of this.pipelineEvents.filter((candidateEvent) => candidateEvent.pipeline_run_id === pipelineRunId)) {
      if (event.event_type === "step_completed") {
        const step = rebuilt.find((state) => state.step_id === event.step_id);
        if (step) {
          step.state = "completed";
          step.awaiting_reply = false;
          step.extracted_facts = event.payload.extracted_facts ?? {};
          step.last_reason = "completed_by_llm";
        }
      }
      if (event.event_type === "run_rejected") {
        const step = rebuilt.find((state) => state.step_id === event.step_id);
        if (step) {
          step.state = "rejected";
          step.awaiting_reply = false;
          step.last_reason = "rejected_by_llm";
        }
        runRejected = true;
      }
      if (event.event_type === "run_completed") {
        runCompleted = true;
      }
    }

    if (!runRejected && !runCompleted) {
      const nextActive = rebuilt.find((step) => step.state === "pending");
      if (nextActive) {
        nextActive.state = "active";
        nextActive.awaiting_reply = true;
      }
    }

    return rebuilt;
  }
}

function buildResumeDisplayName(resume, fallbackId) {
  const fullName = [resume?.first_name, resume?.last_name].filter(Boolean).join(" ").trim();
  return fullName || resume?.title || fallbackId || "HH candidate";
}

function buildResumeText(resume) {
  if (!resume) return "";
  const parts = [
    resume.title ? `Title: ${resume.title}` : null,
    resume.first_name || resume.last_name
      ? `Name: ${[resume.first_name, resume.last_name].filter(Boolean).join(" ").trim()}`
      : null,
    resume.email ? `Email: ${resume.email}` : null
  ].filter(Boolean);
  return parts.join("\n");
}

function buildPlannedMessageReason(llmOutput, job) {
  const completed = llmOutput.completed_step_ids.length
    ? `Закрыты шаги ${llmOutput.completed_step_ids.join(", ")}.`
    : "Новые шаги не закрыты.";
  const missing = llmOutput.missing_information?.length
    ? ` Остались ${llmOutput.missing_information.join(", ")}.`
    : "";
  const reject = llmOutput.rejected_step_id
    ? ` Отказ по шагу ${llmOutput.rejected_step_id}.`
    : "";
  return `${completed}${missing}${reject} Вакансия: ${job.title}.`;
}

function appendImportResetReason(reason) {
  const suffix = " Заблокировано после HH re-import remap.";
  if (!reason) return suffix.trim();
  return reason.includes("HH re-import remap") ? reason : `${reason}${suffix}`;
}

function summarizeText(value, maxLength) {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

// Determine starting pipeline step for an imported HH candidate based on HH collection.
// "response"        -> step[0] (brand-new applicant, start from beginning)
// "phone_interview" -> step[1] (past initial screen; step[0] is marked completed on import)
// all other values  -> step[0] with a console.warn for manual review
function resolveInitialStepId(template, collection) {
  if (collection === "phone_interview" && template.steps.length > 1) {
    return template.steps[1].id;
  }
  if (collection !== "response" && collection !== "phone_interview") {
    console.warn(`resolveInitialStepId: unknown HH collection '${collection}', defaulting to step[0]`);
  }
  return template.steps[0]?.id ?? null;
}
