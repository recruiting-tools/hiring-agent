import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

export class PostgresHiringStore {
  constructor({ connectionString }) {
    this.sql = neon(connectionString);
    // In-memory job registry loaded from DB via seed/loadJobs
    this._jobs = new Map();
  }

  // No-op: HTTP mode has no persistent connections to close.
  async close() {}

  // Truncate all chatbot tables in dependency order (for test isolation).
  async reset() {
    await this.sql`
      TRUNCATE TABLE
        chatbot.planned_messages,
        chatbot.pipeline_events,
        chatbot.pipeline_step_state,
        chatbot.pipeline_runs,
        chatbot.messages,
        chatbot.conversations,
        chatbot.pipeline_templates,
        chatbot.candidates,
        chatbot.jobs
      CASCADE
    `;
    this._jobs.clear();
  }

  // Seed the DB from the iteration-1-seed.json fixture format.
  // Idempotent: uses INSERT ... ON CONFLICT DO NOTHING.
  async seed(seedData) {
    for (const job of seedData.jobs) {
      await this.sql`
        INSERT INTO chatbot.jobs (job_id, title, description)
        VALUES (${job.job_id}, ${job.title}, ${job.description})
        ON CONFLICT (job_id) DO NOTHING
      `;

      const tpl = job.pipeline_template;
      await this.sql`
        INSERT INTO chatbot.pipeline_templates (template_id, template_version, job_id, name, steps_json)
        VALUES (${tpl.template_id}, ${tpl.template_version}, ${job.job_id}, ${tpl.name}, ${JSON.stringify(tpl.steps)})
        ON CONFLICT (template_id) DO NOTHING
      `;

      this._jobs.set(job.job_id, { ...job });
    }

    for (const fixture of seedData.candidate_fixtures) {
      await this.sql`
        INSERT INTO chatbot.candidates (candidate_id, display_name, resume_text)
        VALUES (${fixture.candidate_id}, ${fixture.display_name}, ${fixture.resume_text})
        ON CONFLICT (candidate_id) DO NOTHING
      `;

      await this.sql`
        INSERT INTO chatbot.conversations (conversation_id, job_id, candidate_id, channel, channel_thread_id, status)
        VALUES (${fixture.conversation_id}, ${fixture.job_id}, ${fixture.candidate_id}, 'test', ${fixture.conversation_id}, 'open')
        ON CONFLICT (conversation_id) DO NOTHING
      `;

      const job = this._jobs.get(fixture.job_id);
      const tpl = job.pipeline_template;

      await this.sql`
        INSERT INTO chatbot.pipeline_runs (pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status)
        VALUES (${fixture.pipeline_run_id}, ${fixture.job_id}, ${fixture.candidate_id}, ${tpl.template_id}, ${tpl.template_version}, ${tpl.steps[0]?.id ?? null}, 'active')
        ON CONFLICT (pipeline_run_id) DO NOTHING
      `;

      for (let i = 0; i < tpl.steps.length; i++) {
        const step = tpl.steps[i];
        await this.sql`
          INSERT INTO chatbot.pipeline_step_state
            (pipeline_run_id, step_id, step_index, state, awaiting_reply)
          VALUES (${fixture.pipeline_run_id}, ${step.id}, ${step.step_index}, ${i === 0 ? "active" : "pending"}, ${i === 0})
          ON CONFLICT (pipeline_run_id, step_id) DO NOTHING
        `;
      }
    }

    await this._loadJobsFromDb();
  }

  async _loadJobsFromDb() {
    const jobs = await this.sql`SELECT job_id, title, description FROM chatbot.jobs`;
    const templates = await this.sql`
      SELECT template_id, template_version, job_id, name, steps_json FROM chatbot.pipeline_templates
    `;

    for (const job of jobs) {
      const tpl = templates.find((t) => t.job_id === job.job_id);
      if (tpl) {
        this._jobs.set(job.job_id, {
          job_id: job.job_id,
          title: job.title,
          description: job.description,
          pipeline_template: {
            template_id: tpl.template_id,
            template_version: tpl.template_version,
            name: tpl.name,
            steps: tpl.steps_json
          }
        });
      }
    }
  }

  getJob(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) throw new Error(`Unknown job: ${jobId}`);
    return job;
  }

  async getCandidate(candidateId) {
    const rows = await this.sql`
      SELECT candidate_id, canonical_email, display_name, resume_text
      FROM chatbot.candidates WHERE candidate_id = ${candidateId}
    `;
    return rows[0] ?? null;
  }

  async findConversation(conversationId) {
    const rows = await this.sql`
      SELECT conversation_id, job_id, candidate_id, channel, channel_thread_id, status
      FROM chatbot.conversations WHERE conversation_id = ${conversationId}
    `;
    return rows[0] ?? null;
  }

  async findActiveRunForConversation(conversation) {
    const rows = await this.sql`
      SELECT pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status
      FROM chatbot.pipeline_runs
      WHERE job_id = ${conversation.job_id} AND candidate_id = ${conversation.candidate_id} AND status = 'active'
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async findRunForConversation(conversation) {
    const rows = await this.sql`
      SELECT pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status
      FROM chatbot.pipeline_runs
      WHERE job_id = ${conversation.job_id} AND candidate_id = ${conversation.candidate_id}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async getPendingSteps(pipelineRunId) {
    const rows = await this.sql`
      SELECT pipeline_run_id, step_id, step_index, state, awaiting_reply, extracted_facts, last_reason, completed_at
      FROM chatbot.pipeline_step_state
      WHERE pipeline_run_id = ${pipelineRunId} AND state IN ('pending', 'active')
      ORDER BY step_index ASC
    `;
    return rows.map(normalizeStepState);
  }

  async getStepStates(pipelineRunId) {
    const rows = await this.sql`
      SELECT pipeline_run_id, step_id, step_index, state, awaiting_reply, extracted_facts, last_reason, completed_at
      FROM chatbot.pipeline_step_state
      WHERE pipeline_run_id = ${pipelineRunId}
      ORDER BY step_index ASC
    `;
    return rows.map(normalizeStepState);
  }

  getTemplateStep(jobId, stepId) {
    const job = this.getJob(jobId);
    return job.pipeline_template.steps.find((s) => s.id === stepId) ?? null;
  }

  async getHistory(conversationId) {
    const rows = await this.sql`
      SELECT message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at, received_at
      FROM chatbot.messages
      WHERE conversation_id = ${conversationId}
      ORDER BY occurred_at ASC NULLS LAST
    `;
    return rows;
  }

  async getLastOutboundBody(conversationId) {
    const planned = await this.sql`
      SELECT body FROM chatbot.planned_messages
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (planned.length) return planned[0].body;

    const messages = await this.sql`
      SELECT body FROM chatbot.messages
      WHERE conversation_id = ${conversationId} AND direction = 'outbound'
      ORDER BY occurred_at DESC NULLS LAST
      LIMIT 1
    `;
    return messages[0]?.body ?? null;
  }

  async addInboundMessage(request, conversation) {
    const messageId = randomUUID();
    const rows = await this.sql`
      INSERT INTO chatbot.messages
        (message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at)
      VALUES (${messageId}, ${conversation.conversation_id}, ${conversation.candidate_id}, 'inbound', 'text', ${request.text}, ${request.channel}, ${request.channel_message_id}, ${request.occurred_at})
      RETURNING *
    `;
    return rows[0];
  }

  async addPipelineEvent(event) {
    const eventId = randomUUID();
    const rows = await this.sql`
      INSERT INTO chatbot.pipeline_events
        (event_id, pipeline_run_id, candidate_id, event_type, step_id, payload)
      VALUES (${eventId}, ${event.pipeline_run_id}, ${event.candidate_id}, ${event.event_type}, ${event.step_id ?? null}, ${JSON.stringify(event.payload ?? {})})
      RETURNING *
    `;
    return rows[0];
  }

  async applyLlmDecision({ run, job, llmOutput, conversation, pendingSteps }) {
    // Compute the next active step in-memory from already-fetched pendingSteps.
    // This avoids an interactive read-then-write transaction and allows using
    // the neon() HTTP batch transaction API.
    const now = new Date().toISOString();

    let nextActiveStepId = null;
    let runStatus = run.status;
    let isRunCompleted = false;

    if (llmOutput.step_result === "reject" && llmOutput.rejected_step_id) {
      runStatus = "rejected";
    } else {
      const nextActive = (pendingSteps ?? []).find(
        (s) => !llmOutput.completed_step_ids.includes(s.step_id)
      );
      if (nextActive) {
        nextActiveStepId = nextActive.step_id;
      } else {
        runStatus = "completed";
        isRunCompleted = true;
      }
    }

    // Pre-generate IDs for all events and planned message
    const plannedMessageId = llmOutput.next_message ? randomUUID() : null;
    const stepId = llmOutput.rejected_step_id ?? nextActiveStepId ?? run.active_step_id;
    const sendAfter = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Build the full list of SQL queries to execute as a batch transaction
    const queries = [];

    // 1. Mark completed steps
    for (const completedStepId of llmOutput.completed_step_ids) {
      const stepFacts = llmOutput.extracted_facts?.[completedStepId] ?? {};
      queries.push(this.sql`
        UPDATE chatbot.pipeline_step_state
        SET state = 'completed', awaiting_reply = false, extracted_facts = ${JSON.stringify(stepFacts)},
            last_reason = 'completed_by_llm', completed_at = ${now}, updated_at = ${now}
        WHERE pipeline_run_id = ${run.pipeline_run_id} AND step_id = ${completedStepId}
      `);
      queries.push(this.sql`
        INSERT INTO chatbot.pipeline_events
          (event_id, pipeline_run_id, candidate_id, event_type, step_id, payload)
        VALUES (${randomUUID()}, ${run.pipeline_run_id}, ${run.candidate_id}, 'step_completed', ${completedStepId}, ${JSON.stringify({ extracted_facts: stepFacts })})
      `);
    }

    // 2. Handle reject or advance
    if (llmOutput.step_result === "reject" && llmOutput.rejected_step_id) {
      queries.push(this.sql`
        UPDATE chatbot.pipeline_step_state
        SET state = 'rejected', awaiting_reply = false, last_reason = 'rejected_by_llm', updated_at = ${now}
        WHERE pipeline_run_id = ${run.pipeline_run_id} AND step_id = ${llmOutput.rejected_step_id}
      `);
      queries.push(this.sql`
        UPDATE chatbot.pipeline_runs
        SET status = 'rejected', active_step_id = ${llmOutput.rejected_step_id}, updated_at = ${now}
        WHERE pipeline_run_id = ${run.pipeline_run_id}
      `);
      queries.push(this.sql`
        INSERT INTO chatbot.pipeline_events
          (event_id, pipeline_run_id, candidate_id, event_type, step_id, payload)
        VALUES (${randomUUID()}, ${run.pipeline_run_id}, ${run.candidate_id}, 'run_rejected', ${llmOutput.rejected_step_id}, ${JSON.stringify({ reason: "reject_when_matched" })})
      `);
    } else {
      // Reset all pending/active steps to pending
      queries.push(this.sql`
        UPDATE chatbot.pipeline_step_state
        SET state = 'pending', awaiting_reply = false, updated_at = ${now}
        WHERE pipeline_run_id = ${run.pipeline_run_id} AND state IN ('pending', 'active')
      `);

      if (nextActiveStepId) {
        queries.push(this.sql`
          UPDATE chatbot.pipeline_step_state
          SET state = 'active', awaiting_reply = true, updated_at = ${now}
          WHERE pipeline_run_id = ${run.pipeline_run_id} AND step_id = ${nextActiveStepId}
        `);
        queries.push(this.sql`
          UPDATE chatbot.pipeline_runs SET active_step_id = ${nextActiveStepId}, updated_at = ${now}
          WHERE pipeline_run_id = ${run.pipeline_run_id}
        `);
      } else {
        queries.push(this.sql`
          UPDATE chatbot.pipeline_runs SET status = 'completed', active_step_id = NULL, updated_at = ${now}
          WHERE pipeline_run_id = ${run.pipeline_run_id}
        `);
        queries.push(this.sql`
          INSERT INTO chatbot.pipeline_events
            (event_id, pipeline_run_id, candidate_id, event_type, step_id, payload)
          VALUES (${randomUUID()}, ${run.pipeline_run_id}, ${run.candidate_id}, 'run_completed', ${null}, ${JSON.stringify({})})
        `);
      }
    }

    // 3. Create planned message
    let plannedMessageRow = null;
    if (plannedMessageId && llmOutput.next_message) {
      const reason = buildPlannedMessageReason(llmOutput, job);
      // Use a counter-based idempotency key (count of existing message_planned events before this one)
      const existingEventCount = llmOutput.completed_step_ids.length + (isRunCompleted ? 1 : 0);
      const idempotencyKey = `${run.pipeline_run_id}:${stepId}:${existingEventCount}`;

      queries.push(this.sql`
        INSERT INTO chatbot.planned_messages
          (planned_message_id, conversation_id, candidate_id, pipeline_run_id, step_id,
           body, reason, review_status, moderation_policy, send_after, auto_send_after, idempotency_key)
        VALUES (${plannedMessageId}, ${conversation.conversation_id}, ${conversation.candidate_id},
                ${run.pipeline_run_id}, ${stepId}, ${llmOutput.next_message}, ${reason},
                'pending', 'window_to_reject', ${sendAfter}, ${sendAfter}, ${idempotencyKey})
      `);
      queries.push(this.sql`
        INSERT INTO chatbot.pipeline_events
          (event_id, pipeline_run_id, candidate_id, event_type, step_id, payload)
        VALUES (${randomUUID()}, ${run.pipeline_run_id}, ${run.candidate_id}, 'message_planned', ${stepId}, ${JSON.stringify({ planned_message_id: plannedMessageId })})
      `);

      plannedMessageRow = {
        planned_message_id: plannedMessageId,
        conversation_id: conversation.conversation_id,
        candidate_id: conversation.candidate_id,
        pipeline_run_id: run.pipeline_run_id,
        step_id: stepId,
        body: llmOutput.next_message,
        reason,
        review_status: "pending",
        moderation_policy: "window_to_reject",
        send_after: sendAfter,
        auto_send_after: sendAfter,
        idempotency_key: idempotencyKey
      };
    }

    // Execute all writes as one atomic batch transaction
    await this.sql.transaction(queries);

    // Update run object in-memory so caller sees new status
    run.status = runStatus;
    run.active_step_id = llmOutput.rejected_step_id ?? nextActiveStepId ?? null;

    return plannedMessageRow;
  }

  async markManualReview({ run, candidateId, reason, rawOutput }) {
    await this.addPipelineEvent({
      pipeline_run_id: run.pipeline_run_id,
      candidate_id: candidateId,
      event_type: "llm_output_rejected",
      step_id: run.active_step_id,
      payload: { reason, raw_output: rawOutput }
    });
  }

  async getPendingQueue() {
    const rows = await this.sql`
      SELECT planned_message_id, conversation_id, candidate_id, pipeline_run_id, step_id, body, reason, review_status
      FROM chatbot.planned_messages
      WHERE review_status = 'pending'
      ORDER BY created_at ASC
    `;
    return { items: rows };
  }

  async rebuildStepStateFromEvents(pipelineRunId) {
    const runs = await this.sql`
      SELECT pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status
      FROM chatbot.pipeline_runs WHERE pipeline_run_id = ${pipelineRunId}
    `;
    const run = runs[0];
    if (!run) throw new Error(`Unknown pipeline run: ${pipelineRunId}`);

    const job = this.getJob(run.job_id);
    const rebuilt = job.pipeline_template.steps.map((step) => ({
      pipeline_run_id: pipelineRunId,
      step_id: step.id,
      step_index: step.step_index,
      state: "pending",
      awaiting_reply: false,
      extracted_facts: {},
      last_reason: null,
      completed_at: null
    }));

    const events = await this.sql`
      SELECT event_type, step_id, payload FROM chatbot.pipeline_events
      WHERE pipeline_run_id = ${pipelineRunId}
      ORDER BY created_at ASC
    `;

    let runRejected = false;
    let runCompleted = false;

    for (const event of events) {
      if (event.event_type === "step_completed") {
        const step = rebuilt.find((s) => s.step_id === event.step_id);
        if (step) {
          step.state = "completed";
          step.awaiting_reply = false;
          step.extracted_facts = event.payload.extracted_facts ?? {};
          step.last_reason = "completed_by_llm";
        }
      }
      if (event.event_type === "run_rejected") {
        const step = rebuilt.find((s) => s.step_id === event.step_id);
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
      const nextActive = rebuilt.find((s) => s.state === "pending");
      if (nextActive) {
        nextActive.state = "active";
        nextActive.awaiting_reply = true;
      }
    }

    return rebuilt;
  }
}

function normalizeStepState(row) {
  return {
    pipeline_run_id: row.pipeline_run_id,
    step_id: row.step_id,
    step_index: row.step_index,
    state: row.state,
    awaiting_reply: row.awaiting_reply,
    extracted_facts: row.extracted_facts ?? {},
    last_reason: row.last_reason ?? null,
    completed_at: row.completed_at ?? null
  };
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
