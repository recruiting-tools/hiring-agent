import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationContext } from "../../services/candidate-chatbot/src/conversation-context.js";

test("buildConversationContext derives last message, prior outbound, and active step", () => {
  const context = buildConversationContext({
    conversation: { conversation_id: "conv-001", job_id: "job-001" },
    run: { pipeline_run_id: "run-001", active_step_id: "step-b" },
    job: { job_id: "job-001", title: "Sales" },
    candidate: { candidate_id: "cand-001", display_name: "Ivan" },
    inboundMessage: { body: "Последний ответ кандидата" },
    pendingSteps: [
      { step_id: "step-b", state: "active" },
      { step_id: "step-c", state: "pending" }
    ],
    pendingTemplateSteps: [
      { id: "step-b", kind: "question", goal: "Уточнить B2B" },
      { id: "step-c", kind: "question", goal: "Уточнить чек" }
    ],
    history: [
      { direction: "outbound", body: "Первый вопрос" },
      { direction: "inbound", body: "Первый ответ" },
      { direction: "outbound", body: "Второй вопрос" }
    ]
  });

  assert.equal(context.hasPriorOutbound, true);
  assert.equal(context.lastOutboundBody, "Второй вопрос");
  assert.equal(context.lastMessage.body, "Второй вопрос");
  assert.equal(context.lastInboundMessage.body, "Первый ответ");
  assert.equal(context.activePendingStep.step_id, "step-b");
  assert.equal(context.activeTemplateStep.id, "step-b");
});
