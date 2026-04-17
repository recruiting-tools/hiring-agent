import assert from "node:assert/strict";
import test from "node:test";
import { validateLlmOutput } from "../../services/candidate-chatbot/src/validator.js";

const context = {
  pendingSteps: [
    { step_id: "b2b_sales_experience" }
  ],
  pendingTemplateSteps: [
    { id: "b2b_sales_experience", kind: "question" }
  ],
  lastOutboundBody: null,
  hasPriorOutbound: false
};

function validOutput(overrides = {}) {
  return {
    step_result: "needs_clarification",
    completed_step_ids: [],
    rejected_step_id: null,
    extracted_facts: {},
    missing_information: ["b2b_sales_experience"],
    next_message: "Подскажите, пожалуйста, был ли у вас именно B2B-опыт?",
    confidence: 0.9,
    guard_flags: [],
    ...overrides
  };
}

test("validator rejects premature acknowledgement when no step was completed", () => {
  const result = validateLlmOutput(validOutput({
    next_message: "Спасибо! Подскажите, пожалуйста, какой у вас был средний чек?"
  }), context);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "premature_acknowledgement");
});

test("validator rejects reply-style opener when there was no prior outbound", () => {
  const result = validateLlmOutput(validOutput({
    next_message: "Да, увидел. Подскажите, пожалуйста, какой у вас был средний чек?"
  }), context);

  assert.equal(result.ok, false);
  assert.equal(result.reason, "reply_style_without_prior_outbound");
});

test("validator allows acknowledgement when a step was actually completed", () => {
  const result = validateLlmOutput(validOutput({
    completed_step_ids: ["b2b_sales_experience"],
    next_message: "Спасибо! Подскажите, пожалуйста, какой обычно был средний чек?"
  }), context);

  assert.equal(result.ok, true);
});

test("validator allows reply-style opener when prior outbound exists", () => {
  const result = validateLlmOutput(validOutput({
    next_message: "Да, увидел. Подскажите, пожалуйста, какой у вас был средний чек?"
  }), { ...context, hasPriorOutbound: true });

  assert.equal(result.ok, true);
});
