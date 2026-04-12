export class InMemoryHiringStore {
  constructor(seed) {
    this.client = structuredClone(seed.client);
    this.recruiter = structuredClone(seed.recruiter);
    this.jobs = new Map();
    this.candidates = new Map();
    this.conversations = new Map();
    this.pipelineRuns = new Map();
    this.pipelineStepState = new Map();
    this.messages = [];
    this.plannedMessages = [];
    this.pipelineEvents = [];
    this.idCounters = new Map();

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
      status: "open"
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

  applyLlmDecision({ run, job, llmOutput, conversation }) {
    const stepStates = this.getStepStates(run.pipeline_run_id);
    const now = new Date().toISOString();

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
      return null;
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
      send_after: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      auto_send_after: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
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
    return plannedMessage;
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
