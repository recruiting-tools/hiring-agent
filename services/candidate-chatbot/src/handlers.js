import { validateLlmOutput } from "./validator.js";

export function createCandidateChatbot({ store, llmAdapter, validatorConfig, notificationDispatcher }) {
  return {
    async postWebhookMessage(request) {
      const conversation = await store.findConversation(request.conversation_id);
      if (!conversation) {
        return {
          status: 404,
          body: {
            error: "conversation_not_found"
          }
        };
      }

      const run = await store.findActiveRunForConversation(conversation);
      if (!run) {
        const existingRun = await store.findRunForConversation(conversation);
        return {
          status: 409,
          body: {
            error: "no_active_pipeline_run",
            pipeline_run_id: existingRun?.pipeline_run_id ?? null,
            run_status: existingRun?.status ?? null
          }
        };
      }

      const job = store.getJob(conversation.job_id);
      const candidate = await store.getCandidate(conversation.candidate_id);
      const inboundMessage = await store.addInboundMessage(request, conversation);
      const pendingSteps = await store.getPendingSteps(run.pipeline_run_id);
      const pendingTemplateSteps = pendingSteps.map((step) => store.getTemplateStep(job.job_id, step.step_id)).filter(Boolean);

      const rawLlmOutput = await llmAdapter.evaluate({
        conversation,
        run,
        job,
        candidate,
        inboundMessage,
        pendingSteps,
        pendingTemplateSteps,
        history: await store.getHistory(conversation.conversation_id)
      });

      const validation = validateLlmOutput(rawLlmOutput, {
        pendingSteps,
        pendingTemplateSteps,
        lastOutboundBody: await store.getLastOutboundBody(conversation.conversation_id)
      }, validatorConfig);

      if (!validation.ok) {
        await store.markManualReview({
          run,
          candidateId: conversation.candidate_id,
          reason: validation.reason,
          rawOutput: validation.rawOutput
        });
        return {
          status: 202,
          body: {
            pipeline_run_id: run.pipeline_run_id,
            run_status: "manual_review",
            step_result: "manual_review",
            completed_step_ids: [],
            rejected_step_id: null,
            planned_message_id: null,
            message: null,
            guard_flags: [validation.reason]
          }
        };
      }

      const { plannedMessage, newEvents } = await store.applyLlmDecision({
        run,
        job,
        llmOutput: validation.output,
        conversation,
        pendingSteps
      });

      if (notificationDispatcher) {
        await notificationDispatcher.dispatch(newEvents);
      }

      return {
        status: 200,
        body: {
          pipeline_run_id: run.pipeline_run_id,
          run_status: run.status,
          step_result: validation.output.step_result,
          completed_step_ids: validation.output.completed_step_ids,
          rejected_step_id: validation.output.rejected_step_id,
          planned_message_id: plannedMessage?.planned_message_id ?? null,
          message: plannedMessage?.body ?? null
        }
      };
    },

    async getPendingQueue() {
      return {
        status: 200,
        body: await store.getPendingQueue()
      };
    },

    async getModerationQueue(recruiterToken, { jobId } = {}) {
      const items = await store.getQueueForRecruiter(recruiterToken, { jobId });
      if (items === null) {
        return { status: 404, body: { error: "recruiter_not_found" } };
      }
      const recruiter = await store.getRecruiterByToken(recruiterToken);
      return { status: 200, body: { recruiter_id: recruiter.recruiter_id, items } };
    },

    async blockMessage(recruiterToken, plannedMessageId) {
      const recruiter = await store.getRecruiterByToken(recruiterToken);
      if (!recruiter) return { status: 404, body: { error: "recruiter_not_found" } };
      const pm = await store.findPlannedMessage(plannedMessageId);
      if (!pm) return { status: 404, body: { error: "planned_message_not_found" } };
      if (recruiter.client_id) {
        const conv = await store.findConversation(pm.conversation_id);
        const job = conv ? store.getJob(conv.job_id) : null;
        if (job && job.client_id && job.client_id !== recruiter.client_id) {
          return { status: 403, body: { error: "forbidden" } };
        }
      }
      if (pm.review_status === "sent") return { status: 409, body: { error: "already_sent" } };
      try {
        await store.blockMessage(plannedMessageId);
      } catch (e) {
        if (e.message === "already_sent") return { status: 409, body: { error: "already_sent" } };
        throw e;
      }
      return { status: 200, body: { planned_message_id: plannedMessageId, review_status: "blocked" } };
    },

    async sendMessageNow(recruiterToken, plannedMessageId) {
      const recruiter = await store.getRecruiterByToken(recruiterToken);
      if (!recruiter) return { status: 404, body: { error: "recruiter_not_found" } };
      const pm = await store.findPlannedMessage(plannedMessageId);
      if (!pm) return { status: 404, body: { error: "planned_message_not_found" } };
      if (recruiter.client_id) {
        const conv = await store.findConversation(pm.conversation_id);
        const job = conv ? store.getJob(conv.job_id) : null;
        if (job && job.client_id && job.client_id !== recruiter.client_id) {
          return { status: 403, body: { error: "forbidden" } };
        }
      }
      if (pm.review_status === "sent") return { status: 409, body: { error: "already_sent" } };
      try {
        await store.approveAndSendNow(plannedMessageId);
      } catch (e) {
        if (e.message === "already_sent") return { status: 409, body: { error: "already_sent" } };
        throw e;
      }
      const updated = await store.findPlannedMessage(plannedMessageId);
      return {
        status: 200,
        body: {
          planned_message_id: plannedMessageId,
          review_status: updated.review_status,
          auto_send_after: updated.auto_send_after,
          queued_for_immediate_send: true
        }
      };
    }
  };
}
