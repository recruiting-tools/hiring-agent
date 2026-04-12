import { validateLlmOutput } from "./validator.js";

export function createCandidateChatbot({ store, llmAdapter, validatorConfig }) {
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

      const plannedMessage = await store.applyLlmDecision({
        run,
        job,
        llmOutput: validation.output,
        conversation
      });

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
    }
  };
}
