import { neon } from "@neondatabase/serverless";
import { randomUUID, randomBytes } from "node:crypto";
import { resolveModerationDelayMs } from "./config.js";

function resolveInitialStepIdPostgres(template, collection) {
  if (collection === "phone_interview" && template.steps.length > 1) {
    return template.steps[1].id;
  }
  if (collection !== "response" && collection !== "phone_interview") {
    console.warn(`resolveInitialStepIdPostgres: unknown HH collection '${collection}', defaulting to step[0]`);
  }
  return template.steps[0]?.id ?? null;
}

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
        management.feature_flags,
        management.oauth_tokens,
        management.recruiter_subscriptions,
        chatbot.hh_vacancy_job_mappings,
        chatbot.message_delivery_attempts,
        chatbot.hh_poll_state,
        chatbot.hh_negotiations,
        chatbot.planned_messages,
        chatbot.pipeline_events,
        chatbot.pipeline_step_state,
        chatbot.pipeline_runs,
        chatbot.messages,
        chatbot.conversations,
        chatbot.pipeline_templates,
        chatbot.vacancies,
        chatbot.candidates,
        chatbot.jobs,
        chatbot.recruiters
      CASCADE
    `;
    this._jobs.clear();
  }

  // Seed the DB from the iteration-1-seed.json fixture format.
  // Idempotent: uses INSERT ... ON CONFLICT DO NOTHING.
  async seed(seedData) {
    // Upsert clients (supports clients[] array or single client object)
    for (const client of (seedData.clients ?? (seedData.client ? [seedData.client] : []))) {
      await this.sql`
        INSERT INTO management.clients (client_id, name)
        VALUES (${client.client_id}, ${client.name})
        ON CONFLICT (client_id) DO NOTHING
      `;
    }

    for (const job of seedData.jobs) {
      await this.sql`
        INSERT INTO chatbot.jobs (job_id, title, description, client_id)
        VALUES (${job.job_id}, ${job.title}, ${job.description}, ${job.client_id ?? null})
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

    for (const mapping of seedData.hh_vacancy_job_mappings ?? []) {
      await this.sql`
        INSERT INTO chatbot.hh_vacancy_job_mappings
          (hh_vacancy_id, job_id, client_id, collections, enabled, created_at, updated_at)
        VALUES (
          ${mapping.hh_vacancy_id},
          ${mapping.job_id},
          ${mapping.client_id ?? null},
          ${JSON.stringify(mapping.collections ?? ["response", "phone_interview"])},
          ${mapping.enabled ?? true},
          ${mapping.created_at ?? new Date().toISOString()},
          ${mapping.updated_at ?? new Date().toISOString()}
        )
        ON CONFLICT (hh_vacancy_id) DO UPDATE SET
          job_id = EXCLUDED.job_id,
          client_id = EXCLUDED.client_id,
          collections = EXCLUDED.collections,
          enabled = EXCLUDED.enabled,
          updated_at = EXCLUDED.updated_at
      `;
    }

    for (const fixture of seedData.candidate_fixtures) {
      await this.sql`
        INSERT INTO chatbot.candidates (candidate_id, display_name, resume_text)
        VALUES (${fixture.candidate_id}, ${fixture.display_name}, ${fixture.resume_text})
        ON CONFLICT (candidate_id) DO NOTHING
      `;

      await this.sql`
        INSERT INTO chatbot.conversations (conversation_id, job_id, candidate_id, channel, channel_thread_id, status, client_id)
        VALUES (${fixture.conversation_id}, ${fixture.job_id}, ${fixture.candidate_id}, 'test', ${fixture.conversation_id}, 'open',
          (SELECT client_id FROM chatbot.jobs WHERE job_id = ${fixture.job_id}))
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

    // Upsert all recruiters (supports recruiters[] array or single recruiter object)
    for (const rec of (seedData.recruiters ?? (seedData.recruiter ? [seedData.recruiter] : []))) {
      if (!rec.recruiter_token) continue;
      await this.sql`
        INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token, tg_chat_id)
        VALUES (${rec.recruiter_id}, ${rec.client_id}, ${rec.email}, ${rec.recruiter_token}, ${rec.tg_chat_id ?? null})
        ON CONFLICT (recruiter_id) DO UPDATE SET
          recruiter_token = EXCLUDED.recruiter_token,
          tg_chat_id = EXCLUDED.tg_chat_id
      `;
    }

    await this._loadJobsFromDb();
  }

  async loadJobsFromDb() {
    return this._loadJobsFromDb();
  }

  async _loadJobsFromDb() {
    const jobs = await this.sql`SELECT job_id, title, description, client_id FROM chatbot.jobs`;
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
          client_id: job.client_id ?? null,
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
    // Idempotent: if this channel_message_id was already stored by the importer,
    // return the existing row rather than throwing a unique constraint violation.
    if (request.channel_message_id) {
      const existing = await this.sql`
        SELECT message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at, received_at
        FROM chatbot.messages
        WHERE conversation_id = ${conversation.conversation_id} AND channel_message_id = ${request.channel_message_id}
        LIMIT 1
      `;
      if (existing[0]) return existing[0];
    }
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

  async applyLlmDecision({ run, job, llmOutput, conversation, pendingSteps, vacancyModerationSettings }) {
    // Compute the next active step in-memory from already-fetched pendingSteps.
    // This avoids an interactive read-then-write transaction and allows using
    // the neon() HTTP batch transaction API.
    const now = new Date().toISOString();
    const newEvents = [];

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
    const sendAfter = new Date(Date.now() + resolveModerationDelayMs(vacancyModerationSettings)).toISOString();

    // Build the full list of SQL queries to execute as a batch transaction
    const queries = [];

    // Helper: push an event to both the SQL batch and the newEvents return array
    const pushEvent = (event_type, step_id, payload) => {
      const event = { pipeline_run_id: run.pipeline_run_id, candidate_id: run.candidate_id, event_type, step_id, payload };
      newEvents.push(event);
      queries.push(this.sql`
        INSERT INTO chatbot.pipeline_events
          (event_id, pipeline_run_id, candidate_id, event_type, step_id, payload)
        VALUES (${randomUUID()}, ${run.pipeline_run_id}, ${run.candidate_id}, ${event_type}, ${step_id}, ${JSON.stringify(payload)})
      `);
    };

    // 1. Mark completed steps
    for (const completedStepId of llmOutput.completed_step_ids) {
      const stepFacts = llmOutput.extracted_facts?.[completedStepId] ?? {};
      queries.push(this.sql`
        UPDATE chatbot.pipeline_step_state
        SET state = 'completed', awaiting_reply = false, extracted_facts = ${JSON.stringify(stepFacts)},
            last_reason = 'completed_by_llm', completed_at = ${now}, updated_at = ${now}
        WHERE pipeline_run_id = ${run.pipeline_run_id} AND step_id = ${completedStepId}
      `);
      pushEvent("step_completed", completedStepId, { extracted_facts: stepFacts });
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
      pushEvent("run_rejected", llmOutput.rejected_step_id, { reason: "reject_when_matched" });
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
        pushEvent("run_completed", null, {});
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
      pushEvent("message_planned", stepId, { planned_message_id: plannedMessageId });

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

    return { plannedMessage: plannedMessageRow, newEvents };
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

  // ─── HH Negotiations ────────────────────────────────────────────────────────

  async findHhNegotiation(hhNegotiationId) {
    const rows = await this.sql`
      SELECT hh_negotiation_id, job_id, candidate_id, hh_vacancy_id, hh_collection, channel_thread_id, created_at, updated_at
      FROM chatbot.hh_negotiations WHERE hh_negotiation_id = ${hhNegotiationId}
    `;
    return rows[0] ?? null;
  }

  async upsertHhNegotiation({ hh_negotiation_id, job_id, candidate_id, hh_vacancy_id, hh_collection, channel_thread_id }) {
    const rows = await this.sql`
      INSERT INTO chatbot.hh_negotiations
        (hh_negotiation_id, job_id, candidate_id, hh_vacancy_id, hh_collection, channel_thread_id)
      VALUES (${hh_negotiation_id}, ${job_id}, ${candidate_id}, ${hh_vacancy_id}, ${hh_collection}, ${channel_thread_id})
      ON CONFLICT (hh_negotiation_id) DO UPDATE SET
        job_id = EXCLUDED.job_id,
        candidate_id = EXCLUDED.candidate_id,
        hh_vacancy_id = EXCLUDED.hh_vacancy_id,
        hh_collection = EXCLUDED.hh_collection,
        channel_thread_id = EXCLUDED.channel_thread_id,
        updated_at = now()
      RETURNING *
    `;
    return rows[0];
  }

  async ensureImportedHhNegotiation({ hhNegotiation, job_id, collection = "response", resume }) {
    const job = this.getJob(job_id);
    const candidate_id = `cand-hh-${hhNegotiation.id}`;
    const conversation_id = `conv-hh-${hhNegotiation.id}`;
    const pipeline_run_id = `run-hh-${hhNegotiation.id}`;
    const template = job.pipeline_template;
    const initialStepId = resolveInitialStepIdPostgres(template, collection);
    const initialStepIndex = template.steps.findIndex((s) => s.id === initialStepId);
    const existingRunRows = await this.sql`
      SELECT pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status
      FROM chatbot.pipeline_runs
      WHERE pipeline_run_id = ${pipeline_run_id}
      LIMIT 1
    `;
    const existingRun = existingRunRows[0] ?? null;
    const needsReset = !existingRun
      || existingRun.job_id !== job_id
      || existingRun.template_id !== template.template_id
      || existingRun.template_version !== template.template_version;

    await this.sql`
      INSERT INTO chatbot.candidates (candidate_id, canonical_email, display_name, resume_text)
      VALUES (
        ${candidate_id},
        ${resume?.email ?? null},
        ${buildResumeDisplayName(resume, hhNegotiation.resume?.id)},
        ${buildResumeText(resume)}
      )
      ON CONFLICT (candidate_id) DO UPDATE SET
        canonical_email = COALESCE(EXCLUDED.canonical_email, chatbot.candidates.canonical_email),
        display_name = COALESCE(EXCLUDED.display_name, chatbot.candidates.display_name),
        resume_text = COALESCE(NULLIF(EXCLUDED.resume_text, ''), chatbot.candidates.resume_text)
    `;

    await this.sql`
      INSERT INTO chatbot.conversations (conversation_id, job_id, candidate_id, channel, channel_thread_id, status, client_id)
      VALUES (${conversation_id}, ${job_id}, ${candidate_id}, 'hh', ${conversation_id}, 'open', ${job.client_id ?? null})
      ON CONFLICT (conversation_id) DO UPDATE SET
        job_id = EXCLUDED.job_id,
        candidate_id = EXCLUDED.candidate_id,
        status = CASE WHEN chatbot.conversations.status IN ('completed', 'withdrawn') THEN chatbot.conversations.status ELSE 'open' END,
        client_id = EXCLUDED.client_id
    `;

    if (!existingRun) {
      await this.sql`
        INSERT INTO chatbot.pipeline_runs (pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status, client_id)
        VALUES (
          ${pipeline_run_id},
          ${job_id},
          ${candidate_id},
          ${template.template_id},
          ${template.template_version},
          ${initialStepId},
          'active',
          ${job.client_id ?? null}
        )
      `;
    } else if (needsReset) {
      // H2: atomic transaction prevents broken pipeline state if server crashes mid-remap
      await this.sql.transaction([
        this.sql`
          UPDATE chatbot.pipeline_runs
          SET job_id = ${job_id},
              candidate_id = ${candidate_id},
              template_id = ${template.template_id},
              template_version = ${template.template_version},
              active_step_id = ${initialStepId},
              status = 'active',
              client_id = ${job.client_id ?? null},
              updated_at = now()
          WHERE pipeline_run_id = ${pipeline_run_id}
        `,
        this.sql`
          DELETE FROM chatbot.pipeline_step_state
          WHERE pipeline_run_id = ${pipeline_run_id}
        `,
        this.sql`
          UPDATE chatbot.planned_messages
          SET review_status = 'blocked',
              reason = CASE
                WHEN reason IS NULL OR reason = '' THEN 'Заблокировано после HH re-import remap.'
                WHEN position('HH re-import remap' in reason) > 0 THEN reason
                ELSE reason || ' Заблокировано после HH re-import remap.'
              END
          WHERE conversation_id = ${conversation_id}
            AND review_status IN ('pending', 'approved')
        `
      ]);
    }

    if (!existingRun || needsReset) {
      // M4: prior steps (before initialStepIndex) marked completed; initial step = active
      for (let i = 0; i < template.steps.length; i += 1) {
        const step = template.steps[i];
        const isPrior = i < initialStepIndex;
        const isInitial = step.id === initialStepId;
        const stepState = isPrior ? "completed" : (isInitial ? "active" : "pending");
        await this.sql`
          INSERT INTO chatbot.pipeline_step_state
            (pipeline_run_id, step_id, step_index, state, awaiting_reply)
          VALUES (${pipeline_run_id}, ${step.id}, ${step.step_index}, ${stepState}, ${isInitial})
          ON CONFLICT (pipeline_run_id, step_id) DO NOTHING
        `;
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
    const rows = await this.sql`
      SELECT hh_negotiation_id, job_id, candidate_id, hh_vacancy_id, hh_collection, channel_thread_id, created_at, updated_at
      FROM chatbot.hh_negotiations WHERE channel_thread_id = ${channelThreadId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async getHhNegotiationsDue(limit = 100) {
    const rows = await this.sql`
      SELECT n.hh_negotiation_id, n.job_id, n.candidate_id, n.hh_vacancy_id, n.hh_collection, n.channel_thread_id
      FROM chatbot.hh_negotiations n
      LEFT JOIN chatbot.hh_poll_state ps ON ps.hh_negotiation_id = n.hh_negotiation_id
      WHERE ps.hh_negotiation_id IS NULL OR ps.next_poll_at <= now()
      ORDER BY ps.next_poll_at ASC NULLS FIRST
      LIMIT ${limit}
    `;
    return rows;
  }

  // ─── HH Poll State ───────────────────────────────────────────────────────────

  async getHhPollState(hhNegotiationId) {
    const rows = await this.sql`
      SELECT hh_negotiation_id, last_polled_at, hh_updated_at, last_sender, awaiting_reply, no_response_streak, next_poll_at
      FROM chatbot.hh_poll_state WHERE hh_negotiation_id = ${hhNegotiationId}
    `;
    return rows[0] ?? null;
  }

  async upsertHhPollState(hhNegotiationId, { last_polled_at, hh_updated_at, last_sender, awaiting_reply, next_poll_at }) {
    const rows = await this.sql`
      INSERT INTO chatbot.hh_poll_state
        (hh_negotiation_id, last_polled_at, hh_updated_at, last_sender, awaiting_reply, next_poll_at)
      VALUES (${hhNegotiationId}, ${last_polled_at}, ${hh_updated_at}, ${last_sender}, ${awaiting_reply}, ${next_poll_at})
      ON CONFLICT (hh_negotiation_id) DO UPDATE SET
        last_polled_at = EXCLUDED.last_polled_at,
        hh_updated_at = EXCLUDED.hh_updated_at,
        last_sender = EXCLUDED.last_sender,
        awaiting_reply = EXCLUDED.awaiting_reply,
        next_poll_at = EXCLUDED.next_poll_at
      RETURNING *
    `;
    return rows[0];
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
    if (!channel_message_id) return null;

    const rows = await this.sql`
      INSERT INTO chatbot.messages
        (message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at)
      VALUES (${randomUUID()}, ${conversation_id}, ${candidate_id}, ${direction}, 'text', ${body}, ${channel}, ${channel_message_id}, ${occurred_at})
      ON CONFLICT (conversation_id, channel_message_id) DO NOTHING
      RETURNING *
    `;
    return rows[0];
  }

  // ─── Cron Sender ─────────────────────────────────────────────────────────────

  async getPlannedMessagesDue(now, limit = 100) {
    const rows = await this.sql`
      SELECT pm.*, c.channel_thread_id
      FROM chatbot.planned_messages pm
      LEFT JOIN chatbot.conversations c ON c.conversation_id = pm.conversation_id
      LEFT JOIN LATERAL (
        SELECT da.status, da.attempted_at, da.next_retry_at
        FROM chatbot.message_delivery_attempts da
        WHERE da.planned_message_id = pm.planned_message_id
        ORDER BY da.attempted_at DESC, da.attempt_id DESC
        LIMIT 1
      ) da ON TRUE
      WHERE pm.review_status IN ('pending', 'approved')
        AND pm.auto_send_after <= ${now.toISOString()}
        AND (
          da.status IS NULL
          OR da.status = 'failed'
          OR (
            da.status = 'sending'
            AND (da.attempted_at <= now() - interval '5 minutes')
          )
        )
        AND (
          da.status <> 'failed'
          OR da.next_retry_at IS NULL
          OR da.next_retry_at <= ${now.toISOString()}
        )
        AND pm.sent_at IS NULL
      ORDER BY pm.auto_send_after ASC, pm.created_at ASC
      LIMIT ${limit}
    `;
    for (const row of rows) {
      if (!row.channel_thread_id) {
        throw new Error(`Missing conversation for planned_message ${row.planned_message_id}`);
      }
    }
    return rows;
  }

  // ─── Delivery Attempts ───────────────────────────────────────────────────────

  async recordDeliveryAttempt({
    attempt_id,
    planned_message_id,
    hh_negotiation_id,
    status,
    retry_count = 0,
    next_retry_at = null
  }) {
    try {
      const rows = await this.sql`
        INSERT INTO chatbot.message_delivery_attempts
          (attempt_id, planned_message_id, hh_negotiation_id, status, retry_count, next_retry_at)
        VALUES (${attempt_id}, ${planned_message_id}, ${hh_negotiation_id}, ${status}, ${retry_count}, ${next_retry_at})
        RETURNING *
      `;
      return rows[0];
    } catch (err) {
      if (err.code === "23505") {
        // Another concurrent send is in flight — return existing active attempt
        const existing = await this.sql`
          SELECT * FROM chatbot.message_delivery_attempts
          WHERE planned_message_id = ${planned_message_id}
            AND status IN ('sending', 'delivered')
          LIMIT 1
        `;
        return existing[0];
      }
      throw err;
    }
  }

  async getDeliveryAttempts(plannedMessageId) {
    const rows = await this.sql`
      SELECT * FROM chatbot.message_delivery_attempts
      WHERE planned_message_id = ${plannedMessageId}
      ORDER BY attempted_at DESC, attempt_id DESC
    `;
    return rows;
  }

  async getSuccessfulDeliveryAttempt(plannedMessageId) {
    const rows = await this.sql`
      SELECT * FROM chatbot.message_delivery_attempts
      WHERE planned_message_id = ${plannedMessageId} AND status = 'delivered'
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async markDeliveryAttemptDelivered({ attempt_id, hh_message_id }) {
    await this.sql`
      UPDATE chatbot.message_delivery_attempts
      SET status = 'delivered', hh_message_id = ${hh_message_id}, next_retry_at = NULL
      WHERE attempt_id = ${attempt_id}
    `;
  }

  async markDeliveryAttemptFailed({ attempt_id, error_body, nextRetryAt = null, retryCount = null }) {
    await this.sql`
      UPDATE chatbot.message_delivery_attempts
      SET status = 'failed',
          error_body = ${error_body},
          next_retry_at = ${nextRetryAt ?? null},
          retry_count = COALESCE(${retryCount}, retry_count, 0)
      WHERE attempt_id = ${attempt_id}
    `;
  }

  async markPlannedMessageSent({ planned_message_id, sent_at, hh_message_id }) {
    await this.sql`
      UPDATE chatbot.planned_messages
      SET review_status = 'sent', sent_at = ${sent_at}
      WHERE planned_message_id = ${planned_message_id}
    `;
    if (hh_message_id) {
      await this.sql`
        UPDATE chatbot.message_delivery_attempts
        SET hh_message_id = ${hh_message_id}
        WHERE planned_message_id = ${planned_message_id} AND status = 'delivered'
      `;
    }
  }

  async markPlannedMessageBlockedForDlq(plannedMessageId, { reason }) {
    const blockedReason = reason ? `DLQ: ${reason}` : "DLQ";
    await this.sql`
      UPDATE chatbot.planned_messages
      SET review_status = 'blocked',
          reason = CASE
            WHEN reason IS NULL OR reason = '' THEN ${blockedReason}
            WHEN reason LIKE '%DLQ:%' THEN reason
            ELSE reason || ' ' || ${blockedReason}
          END,
          updated_at = now()
      WHERE planned_message_id = ${plannedMessageId}
    `;
  }

  // ─── Alert ───────────────────────────────────────────────────────────────────

  async getAwaitingReplyStaleConversations(staleMinutes) {
    const rows = await this.sql`
      SELECT
        ps.hh_negotiation_id,
        n.channel_thread_id,
        MAX(a.attempted_at) AS last_sent_at,
        EXTRACT(EPOCH FROM (now() - MAX(a.attempted_at))) / 60 AS awaiting_since_minutes
      FROM chatbot.hh_poll_state ps
      JOIN chatbot.hh_negotiations n ON n.hh_negotiation_id = ps.hh_negotiation_id
      JOIN chatbot.message_delivery_attempts a ON a.hh_negotiation_id = ps.hh_negotiation_id AND a.status = 'delivered'
      WHERE ps.awaiting_reply = true
      GROUP BY ps.hh_negotiation_id, n.channel_thread_id
      HAVING EXTRACT(EPOCH FROM (now() - MAX(a.attempted_at))) / 60 >= ${staleMinutes}
    `;
    return rows.map((r) => ({
      hh_negotiation_id: r.hh_negotiation_id,
      channel_thread_id: r.channel_thread_id,
      last_sent_at: r.last_sent_at,
      awaiting_since_minutes: Math.floor(Number(r.awaiting_since_minutes))
    }));
  }

  // ─── Moderation UI ───────────────────────────────────────────────────────────

  async getRecruiterByToken(token) {
    const rows = await this.sql`
      SELECT recruiter_id, client_id, email, recruiter_token
      FROM chatbot.recruiters
      WHERE recruiter_token = ${token}
    `;
    return rows[0] ?? null;
  }

  async getRecruiterByEmail(email) {
    const rows = await this.sql`
      SELECT recruiter_id, client_id, email, recruiter_token, tg_chat_id, password_hash
      FROM chatbot.recruiters
      WHERE email = ${email}
    `;
    return rows[0] ?? null;
  }

  async setRecruiterPassword(recruiterId, passwordHash) {
    await this.sql`
      UPDATE chatbot.recruiters
      SET password_hash = ${passwordHash}
      WHERE recruiter_id = ${recruiterId}
    `;
  }

  async createSession(recruiterId) {
    const token = randomBytes(32).toString("hex");
    await this.sql`
      INSERT INTO chatbot.sessions (session_token, recruiter_id)
      VALUES (${token}, ${recruiterId})
    `;
    return token;
  }

  async getSessionRecruiter(token) {
    const rows = await this.sql`
      SELECT r.recruiter_id, r.client_id, r.email, r.recruiter_token, r.tg_chat_id
      FROM chatbot.sessions s
      JOIN chatbot.recruiters r ON r.recruiter_id = s.recruiter_id
      WHERE s.session_token = ${token}
        AND s.expires_at > now()
    `;
    return rows[0] ?? null;
  }

  async findPlannedMessage(plannedMessageId) {
    const rows = await this.sql`
      SELECT * FROM chatbot.planned_messages WHERE planned_message_id = ${plannedMessageId}
    `;
    return rows[0] ?? null;
  }

  async getQueueForRecruiter(recruiterToken, { jobId } = {}) {
    const recruiter = await this.getRecruiterByToken(recruiterToken);
    if (!recruiter) return null;

    const rows = await this.sql`
      SELECT
        pm.planned_message_id,
        pm.conversation_id,
        pm.candidate_id,
        cand.display_name AS candidate_display_name,
        cand.resume_text,
        j.title AS job_title,
        j.job_id,
        pm.step_id,
        pr.active_step_id,
        pm.body,
        pm.reason,
        pm.review_status,
        pm.auto_send_after,
        EXTRACT(EPOCH FROM (pm.auto_send_after - now()))::int AS seconds_until_auto_send
      FROM chatbot.planned_messages pm
      JOIN chatbot.conversations c    ON c.conversation_id = pm.conversation_id
      JOIN chatbot.candidates cand    ON cand.candidate_id = pm.candidate_id
      JOIN chatbot.jobs j             ON j.job_id = c.job_id
      LEFT JOIN chatbot.pipeline_runs pr ON pr.pipeline_run_id = pm.pipeline_run_id
      JOIN chatbot.recruiters r       ON r.recruiter_token = ${recruiterToken}
      WHERE pm.review_status IN ('pending', 'approved')
        AND (j.client_id IS NULL OR j.client_id = r.client_id)
        ${jobId ? this.sql`AND c.job_id = ${jobId}` : this.sql``}
      ORDER BY pm.auto_send_after ASC
    `;
    const conversationIds = [...new Set(rows.map((row) => row.conversation_id))];
    const historyRows = conversationIds.length
      ? await this.sql`
        SELECT message_id, conversation_id, direction, message_type, body, channel, occurred_at
        FROM chatbot.messages
        WHERE conversation_id = ANY(${conversationIds})
        ORDER BY occurred_at ASC NULLS LAST
      `
      : [];
    const historyByConversationId = new Map();
    for (const message of historyRows) {
      const current = historyByConversationId.get(message.conversation_id) ?? [];
      current.push({
        message_id: message.message_id,
        direction: message.direction,
        body: message.body,
        occurred_at: message.occurred_at,
        channel: message.channel,
        message_type: message.message_type
      });
      historyByConversationId.set(message.conversation_id, current);
    }

    return rows.map((row) => {
      const history = historyByConversationId.get(row.conversation_id) ?? [];
      const lastMessageBody = history.at(-1)?.body ?? row.body;
      let active_step_goal = row.active_step_id ?? row.step_id ?? "";
      try {
        active_step_goal = this.getTemplateStep(row.job_id, row.active_step_id ?? row.step_id)?.goal ?? active_step_goal;
      } catch { /* job not in _jobs registry */ }
      return {
        ...row,
        active_step_goal,
        planned_message_preview: summarizeText(row.body, 200),
        last_message_preview: summarizeText(lastMessageBody, 200),
        history
      };
    });
  }

  async blockMessage(plannedMessageId) {
    const existing = await this.findPlannedMessage(plannedMessageId);
    if (!existing) return;
    if (existing.review_status === "sent") throw new Error("already_sent");
    await this.sql`
      UPDATE chatbot.planned_messages
      SET review_status = 'blocked'
      WHERE planned_message_id = ${plannedMessageId}
    `;
  }

  async approveAndSendNow(plannedMessageId) {
    const existing = await this.findPlannedMessage(plannedMessageId);
    if (!existing) return;
    if (existing.review_status === "sent") throw new Error("already_sent");
    await this.sql`
      UPDATE chatbot.planned_messages
      SET review_status = 'approved',
          auto_send_after = now() - interval '1 second'
      WHERE planned_message_id = ${plannedMessageId}
    `;
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

  // ─── Recruiter lookups ───────────────────────────────────────────────────────

  async getRecruiterById(recruiterId) {
    const rows = await this.sql`
      SELECT recruiter_id, client_id, email, recruiter_token, tg_chat_id
      FROM chatbot.recruiters
      WHERE recruiter_id = ${recruiterId}
    `;
    return rows[0] ?? null;
  }

  async findRunById(pipelineRunId) {
    const rows = await this.sql`
      SELECT pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status
      FROM chatbot.pipeline_runs
      WHERE pipeline_run_id = ${pipelineRunId}
    `;
    return rows[0] ?? null;
  }

  // ─── Telegram subscriptions ──────────────────────────────────────────────────

  async addSubscription({ recruiter_id, job_id, step_index, event_type }) {
    // Tenant isolation: recruiter must belong to the same client as the job
    const check = await this.sql`
      SELECT 1 FROM chatbot.recruiters r
      JOIN chatbot.jobs j ON j.client_id = r.client_id
      WHERE r.recruiter_id = ${recruiter_id} AND j.job_id = ${job_id}
    `;
    if (check.length === 0) {
      throw new Error(
        `Tenant isolation: recruiter ${recruiter_id} cannot subscribe to job ${job_id}`
      );
    }
    await this.sql`
      INSERT INTO management.recruiter_subscriptions
        (recruiter_id, job_id, step_index, event_type)
      VALUES (${recruiter_id}, ${job_id}, ${step_index}, ${event_type})
      ON CONFLICT (recruiter_id, job_id, step_index, event_type) DO NOTHING
    `;
  }

  async removeSubscription(recruiterId, jobId, stepIndex, eventType = 'step_completed') {
    await this.sql`
      DELETE FROM management.recruiter_subscriptions
      WHERE recruiter_id = ${recruiterId}
        AND job_id = ${jobId}
        AND step_index = ${stepIndex}
        AND event_type = ${eventType}
    `;
  }

  async getSubscriptionsForStep(jobId, stepIndex, eventType) {
    const rows = await this.sql`
      SELECT subscription_id, recruiter_id, job_id, step_index, event_type, created_at
      FROM management.recruiter_subscriptions
      WHERE job_id = ${jobId}
        AND step_index = ${stepIndex}
        AND event_type = ${eventType}
    `;
    return rows;
  }

  // ─── Management / HH OAuth ──────────────────────────────────────────────────

  async getHhOAuthTokens(provider = "hh") {
    const rows = await this.sql`
      SELECT provider, access_token, refresh_token, token_type, expires_at, scope, metadata, created_at, updated_at
      FROM management.oauth_tokens
      WHERE provider = ${provider}
    `;
    return rows[0] ?? null;
  }

  async getHhVacancyJobMappings({ enabledOnly = true } = {}) {
    const rows = await this.sql`
      SELECT hh_vacancy_id, job_id, client_id, collections, enabled, created_at, updated_at
      FROM chatbot.hh_vacancy_job_mappings
      WHERE ${enabledOnly ? this.sql`enabled = true` : this.sql`TRUE = TRUE`}
      ORDER BY hh_vacancy_job_mapping_id
    `;
    return rows.map(normalizeHhVacancyJobMappingRow);
  }

  async setHhOAuthTokens(provider = "hh", tokens) {
    const rows = await this.sql`
      INSERT INTO management.oauth_tokens
        (provider, access_token, refresh_token, token_type, expires_at, scope, metadata, updated_at)
      VALUES (
        ${provider},
        ${tokens.access_token},
        ${tokens.refresh_token ?? null},
        ${tokens.token_type ?? "bearer"},
        ${tokens.expires_at ?? null},
        ${tokens.scope ?? null},
        ${JSON.stringify(tokens.metadata ?? {})},
        now()
      )
      ON CONFLICT (provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, management.oauth_tokens.refresh_token),
        token_type = EXCLUDED.token_type,
        expires_at = EXCLUDED.expires_at,
        scope = EXCLUDED.scope,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      RETURNING provider, access_token, refresh_token, token_type, expires_at, scope, metadata, created_at, updated_at
    `;
    return rows[0];
  }

  async getFeatureFlag(flag) {
    const rows = await this.sql`
      SELECT flag, enabled, description, created_at, updated_at
      FROM management.feature_flags
      WHERE flag = ${flag}
    `;
    return rows[0] ?? null;
  }

  async setFeatureFlag(flag, enabled, description = null) {
    const rows = await this.sql`
      INSERT INTO management.feature_flags (flag, enabled, description, updated_at)
      VALUES (${flag}, ${enabled}, ${description}, now())
      ON CONFLICT (flag) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        description = COALESCE(EXCLUDED.description, management.feature_flags.description),
        updated_at = now()
      RETURNING flag, enabled, description, created_at, updated_at
    `;
    return rows[0];
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

function normalizeHhVacancyJobMappingRow(row) {
  return {
    hh_vacancy_id: row.hh_vacancy_id,
    job_id: row.job_id,
    client_id: row.client_id ?? null,
    collections: row.collections,
    enabled: row.enabled ?? true,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
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

function summarizeText(value, maxLength) {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
