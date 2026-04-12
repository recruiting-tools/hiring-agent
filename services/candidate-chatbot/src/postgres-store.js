import pg from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;

export class PostgresHiringStore {
  constructor({ connectionString }) {
    this.pool = new Pool({ connectionString, max: 5 });
    // In-memory job registry: jobs come from seed/pipeline_templates table
    this._jobs = new Map();
  }

  async close() {
    await this.pool.end();
  }

  // Seed the DB from the iteration-1-seed.json fixture format.
  // Idempotent: uses INSERT ... ON CONFLICT DO NOTHING.
  async seed(seedData) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const job of seedData.jobs) {
        await client.query(
          `INSERT INTO chatbot.jobs (job_id, title, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (job_id) DO NOTHING`,
          [job.job_id, job.title, job.description]
        );

        const tpl = job.pipeline_template;
        await client.query(
          `INSERT INTO chatbot.pipeline_templates (template_id, template_version, job_id, name, steps_json)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (template_id) DO NOTHING`,
          [tpl.template_id, tpl.template_version, job.job_id, tpl.name, JSON.stringify(tpl.steps)]
        );

        // Cache jobs in memory for fast access
        this._jobs.set(job.job_id, { ...job });
      }

      for (const fixture of seedData.candidate_fixtures) {
        await client.query(
          `INSERT INTO chatbot.candidates (candidate_id, display_name, resume_text)
           VALUES ($1, $2, $3)
           ON CONFLICT (candidate_id) DO NOTHING`,
          [fixture.candidate_id, fixture.display_name, fixture.resume_text]
        );

        await client.query(
          `INSERT INTO chatbot.conversations (conversation_id, job_id, candidate_id, channel, channel_thread_id, status)
           VALUES ($1, $2, $3, 'test', $1, 'open')
           ON CONFLICT (conversation_id) DO NOTHING`,
          [fixture.conversation_id, fixture.job_id, fixture.candidate_id]
        );

        const job = this._jobs.get(fixture.job_id);
        const tpl = job.pipeline_template;

        await client.query(
          `INSERT INTO chatbot.pipeline_runs (pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'active')
           ON CONFLICT (pipeline_run_id) DO NOTHING`,
          [
            fixture.pipeline_run_id,
            fixture.job_id,
            fixture.candidate_id,
            tpl.template_id,
            tpl.template_version,
            tpl.steps[0]?.id ?? null
          ]
        );

        for (let i = 0; i < tpl.steps.length; i++) {
          const step = tpl.steps[i];
          await client.query(
            `INSERT INTO chatbot.pipeline_step_state
               (pipeline_run_id, step_id, step_index, state, awaiting_reply)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (pipeline_run_id, step_id) DO NOTHING`,
            [
              fixture.pipeline_run_id,
              step.id,
              step.step_index,
              i === 0 ? "active" : "pending",
              i === 0
            ]
          );
        }
      }

      await client.query("COMMIT");

      // Load jobs into memory cache (also load from DB for completeness)
      await this._loadJobsFromDb();
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async _loadJobsFromDb() {
    const { rows: jobs } = await this.pool.query("SELECT job_id, title, description FROM chatbot.jobs");
    const { rows: templates } = await this.pool.query(
      "SELECT template_id, template_version, job_id, name, steps_json FROM chatbot.pipeline_templates"
    );

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
    const { rows } = await this.pool.query(
      "SELECT candidate_id, canonical_email, display_name, resume_text FROM chatbot.candidates WHERE candidate_id = $1",
      [candidateId]
    );
    return rows[0] ?? null;
  }

  async findConversation(conversationId) {
    const { rows } = await this.pool.query(
      "SELECT conversation_id, job_id, candidate_id, channel, channel_thread_id, status FROM chatbot.conversations WHERE conversation_id = $1",
      [conversationId]
    );
    return rows[0] ?? null;
  }

  async findActiveRunForConversation(conversation) {
    const { rows } = await this.pool.query(
      `SELECT pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status
       FROM chatbot.pipeline_runs
       WHERE job_id = $1 AND candidate_id = $2 AND status = 'active'
       LIMIT 1`,
      [conversation.job_id, conversation.candidate_id]
    );
    return rows[0] ?? null;
  }

  async findRunForConversation(conversation) {
    const { rows } = await this.pool.query(
      `SELECT pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status
       FROM chatbot.pipeline_runs
       WHERE job_id = $1 AND candidate_id = $2
       LIMIT 1`,
      [conversation.job_id, conversation.candidate_id]
    );
    return rows[0] ?? null;
  }

  async getPendingSteps(pipelineRunId) {
    const { rows } = await this.pool.query(
      `SELECT pipeline_run_id, step_id, step_index, state, awaiting_reply, extracted_facts, last_reason, completed_at
       FROM chatbot.pipeline_step_state
       WHERE pipeline_run_id = $1 AND state IN ('pending', 'active')
       ORDER BY step_index ASC`,
      [pipelineRunId]
    );
    return rows.map(normalizeStepState);
  }

  async getStepStates(pipelineRunId) {
    const { rows } = await this.pool.query(
      `SELECT pipeline_run_id, step_id, step_index, state, awaiting_reply, extracted_facts, last_reason, completed_at
       FROM chatbot.pipeline_step_state
       WHERE pipeline_run_id = $1
       ORDER BY step_index ASC`,
      [pipelineRunId]
    );
    return rows.map(normalizeStepState);
  }

  getTemplateStep(jobId, stepId) {
    const job = this.getJob(jobId);
    return job.pipeline_template.steps.find((s) => s.id === stepId) ?? null;
  }

  async getHistory(conversationId) {
    const { rows } = await this.pool.query(
      `SELECT message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at, received_at
       FROM chatbot.messages
       WHERE conversation_id = $1
       ORDER BY occurred_at ASC NULLS LAST`,
      [conversationId]
    );
    return rows;
  }

  async getLastOutboundBody(conversationId) {
    const { rows: planned } = await this.pool.query(
      `SELECT body FROM chatbot.planned_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [conversationId]
    );
    if (planned.length) return planned[0].body;

    const { rows: messages } = await this.pool.query(
      `SELECT body FROM chatbot.messages
       WHERE conversation_id = $1 AND direction = 'outbound'
       ORDER BY occurred_at DESC NULLS LAST
       LIMIT 1`,
      [conversationId]
    );
    return messages[0]?.body ?? null;
  }

  async addInboundMessage(request, conversation) {
    const messageId = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO chatbot.messages
         (message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at)
       VALUES ($1, $2, $3, 'inbound', 'text', $4, $5, $6, $7)
       RETURNING *`,
      [
        messageId,
        conversation.conversation_id,
        conversation.candidate_id,
        request.text,
        request.channel,
        request.channel_message_id,
        request.occurred_at
      ]
    );
    return rows[0];
  }

  async addPipelineEvent(event, client) {
    const db = client ?? this.pool;
    const eventId = randomUUID();
    const { rows } = await db.query(
      `INSERT INTO chatbot.pipeline_events
         (event_id, pipeline_run_id, candidate_id, event_type, step_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        eventId,
        event.pipeline_run_id,
        event.candidate_id,
        event.event_type,
        event.step_id ?? null,
        JSON.stringify(event.payload ?? {})
      ]
    );
    return rows[0];
  }

  async applyLlmDecision({ run, job, llmOutput, conversation }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const now = new Date().toISOString();

      // Mark completed steps
      for (const completedStepId of llmOutput.completed_step_ids) {
        const stepFacts = llmOutput.extracted_facts?.[completedStepId] ?? {};
        await client.query(
          `UPDATE chatbot.pipeline_step_state
           SET state = 'completed', awaiting_reply = false, extracted_facts = $1,
               last_reason = 'completed_by_llm', completed_at = $2, updated_at = $2
           WHERE pipeline_run_id = $3 AND step_id = $4`,
          [JSON.stringify(stepFacts), now, run.pipeline_run_id, completedStepId]
        );

        await this.addPipelineEvent({
          pipeline_run_id: run.pipeline_run_id,
          candidate_id: run.candidate_id,
          event_type: "step_completed",
          step_id: completedStepId,
          payload: { extracted_facts: stepFacts }
        }, client);
      }

      let plannedMessage = null;

      if (llmOutput.step_result === "reject" && llmOutput.rejected_step_id) {
        // Mark rejected step
        await client.query(
          `UPDATE chatbot.pipeline_step_state
           SET state = 'rejected', awaiting_reply = false, last_reason = 'rejected_by_llm', updated_at = $1
           WHERE pipeline_run_id = $2 AND step_id = $3`,
          [now, run.pipeline_run_id, llmOutput.rejected_step_id]
        );

        // Update run to rejected
        await client.query(
          `UPDATE chatbot.pipeline_runs
           SET status = 'rejected', active_step_id = $1, updated_at = $2
           WHERE pipeline_run_id = $3`,
          [llmOutput.rejected_step_id, now, run.pipeline_run_id]
        );
        run.status = "rejected";
        run.active_step_id = llmOutput.rejected_step_id;

        await this.addPipelineEvent({
          pipeline_run_id: run.pipeline_run_id,
          candidate_id: run.candidate_id,
          event_type: "run_rejected",
          step_id: llmOutput.rejected_step_id,
          payload: { reason: "reject_when_matched" }
        }, client);
      } else {
        // Reset pending steps, advance to next active
        await client.query(
          `UPDATE chatbot.pipeline_step_state
           SET state = 'pending', awaiting_reply = false, updated_at = $1
           WHERE pipeline_run_id = $2 AND state IN ('pending', 'active')`,
          [now, run.pipeline_run_id]
        );

        // Find next pending step (not in completed list)
        const { rows: remaining } = await client.query(
          `SELECT step_id, step_index FROM chatbot.pipeline_step_state
           WHERE pipeline_run_id = $1 AND state = 'pending'
           ORDER BY step_index ASC`,
          [run.pipeline_run_id]
        );
        const nextActive = remaining.find((s) => !llmOutput.completed_step_ids.includes(s.step_id));

        if (nextActive) {
          await client.query(
            `UPDATE chatbot.pipeline_step_state
             SET state = 'active', awaiting_reply = true, updated_at = $1
             WHERE pipeline_run_id = $2 AND step_id = $3`,
            [now, run.pipeline_run_id, nextActive.step_id]
          );
          await client.query(
            `UPDATE chatbot.pipeline_runs SET active_step_id = $1, updated_at = $2 WHERE pipeline_run_id = $3`,
            [nextActive.step_id, now, run.pipeline_run_id]
          );
          run.active_step_id = nextActive.step_id;
        } else {
          await client.query(
            `UPDATE chatbot.pipeline_runs SET status = 'completed', active_step_id = NULL, updated_at = $1 WHERE pipeline_run_id = $2`,
            [now, run.pipeline_run_id]
          );
          run.status = "completed";
          run.active_step_id = null;

          await this.addPipelineEvent({
            pipeline_run_id: run.pipeline_run_id,
            candidate_id: run.candidate_id,
            event_type: "run_completed",
            step_id: null,
            payload: {}
          }, client);
        }
      }

      // Create planned message if LLM provided one
      if (llmOutput.next_message) {
        const plannedMessageId = randomUUID();
        const stepId = llmOutput.rejected_step_id ?? run.active_step_id;
        const sendAfter = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const reason = buildPlannedMessageReason(llmOutput, job);

        // Count existing message_planned events for idempotency key
        const { rows: evtCount } = await client.query(
          `SELECT COUNT(*) AS cnt FROM chatbot.pipeline_events
           WHERE pipeline_run_id = $1 AND event_type = 'message_planned'`,
          [run.pipeline_run_id]
        );
        const idempotencyKey = `${run.pipeline_run_id}:${stepId}:${evtCount[0].cnt}`;

        const { rows } = await client.query(
          `INSERT INTO chatbot.planned_messages
             (planned_message_id, conversation_id, candidate_id, pipeline_run_id, step_id,
              body, reason, review_status, moderation_policy, send_after, auto_send_after, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', 'window_to_reject', $8, $8, $9)
           RETURNING *`,
          [
            plannedMessageId,
            conversation.conversation_id,
            conversation.candidate_id,
            run.pipeline_run_id,
            stepId,
            llmOutput.next_message,
            reason,
            sendAfter,
            idempotencyKey
          ]
        );
        plannedMessage = rows[0];

        await this.addPipelineEvent({
          pipeline_run_id: run.pipeline_run_id,
          candidate_id: run.candidate_id,
          event_type: "message_planned",
          step_id: stepId,
          payload: { planned_message_id: plannedMessageId }
        }, client);
      }

      await client.query("COMMIT");
      return plannedMessage;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
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
    const { rows } = await this.pool.query(
      `SELECT planned_message_id, conversation_id, candidate_id, pipeline_run_id, step_id, body, reason, review_status
       FROM chatbot.planned_messages
       WHERE review_status = 'pending'
       ORDER BY created_at ASC`
    );
    return { items: rows };
  }

  async rebuildStepStateFromEvents(pipelineRunId) {
    const run = await this._getRunById(pipelineRunId);
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

    const { rows: events } = await this.pool.query(
      `SELECT event_type, step_id, payload FROM chatbot.pipeline_events
       WHERE pipeline_run_id = $1
       ORDER BY created_at ASC`,
      [pipelineRunId]
    );

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

  async _getRunById(pipelineRunId) {
    const { rows } = await this.pool.query(
      `SELECT pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status
       FROM chatbot.pipeline_runs WHERE pipeline_run_id = $1`,
      [pipelineRunId]
    );
    return rows[0] ?? null;
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
