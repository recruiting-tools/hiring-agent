import assert from "node:assert/strict";
import test from "node:test";
import { classifyOpenerKind, deriveOutboundPolicy, validateOutboundPolicy } from "../../services/candidate-chatbot/src/outbound-message-policy.js";

const baseContext = {
  pendingSteps: [{ step_id: "b2b_sales_experience" }],
  pendingTemplateSteps: [{ id: "b2b_sales_experience", kind: "question" }],
  hasPriorOutbound: false,
  lastMessage: { direction: "inbound", body: "Здравствуйте" }
};

const baseOutput = {
  step_result: "needs_clarification",
  completed_step_ids: [],
  rejected_step_id: null
};

test("classifyOpenerKind distinguishes reply, acknowledgement, and neutral", () => {
  assert.equal(classifyOpenerKind("Да, увидел. Уточню дальше"), "reply_style");
  assert.equal(classifyOpenerKind("Спасибо! Подскажите, пожалуйста"), "acknowledgement");
  assert.equal(classifyOpenerKind("Подскажите, пожалуйста, был ли B2B-опыт?"), "neutral");
});

test("deriveOutboundPolicy allows reply style only for follow-up after inbound", () => {
  const followUp = deriveOutboundPolicy({
    ...baseContext,
    hasPriorOutbound: true,
    lastMessage: { direction: "inbound", body: "Ответ кандидата" }
  }, baseOutput);
  assert.equal(followUp.allowsReplyStyle, true);

  const noInboundTurn = deriveOutboundPolicy({
    ...baseContext,
    hasPriorOutbound: true,
    lastMessage: { direction: "outbound", body: "Наш прошлый вопрос" }
  }, baseOutput);
  assert.equal(noInboundTurn.allowsReplyStyle, false);
});

test("validateOutboundPolicy returns state-based reply context error", () => {
  const result = validateOutboundPolicy("Да, увидел. Подскажите, пожалуйста, какой был средний чек?", {
    ...baseContext,
    hasPriorOutbound: true,
    lastMessage: { direction: "outbound", body: "Наш прошлый вопрос" }
  }, baseOutput);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "reply_style_without_reply_context");
});

test("validateOutboundPolicy allows acknowledgement when decision signal exists", () => {
  const result = validateOutboundPolicy("Спасибо! Подскажите, пожалуйста, какой был средний чек?", baseContext, {
    ...baseOutput,
    completed_step_ids: ["b2b_sales_experience"]
  });

  assert.equal(result.ok, true);
});
