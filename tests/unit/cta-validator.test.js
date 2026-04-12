import assert from "node:assert/strict";
import test from "node:test";
import { hasHardImperativeWithoutSoftener, hasSoftCta, validateSoftCta } from "../../services/candidate-chatbot/src/cta-validator.js";

test("cta validator: rejects hard next-step imperative without a soft CTA", () => {
  const text = "Отлично, следующий шаг — короткое тестовое задание на план A/B теста и два варианта главного слайда.";

  assert.equal(hasSoftCta(text), false);
  assert.equal(hasHardImperativeWithoutSoftener(text), true);
  assert.equal(validateSoftCta(text).ok, false);
});

test("cta validator: accepts soft next-step offer with optionality", () => {
  const text = "Отлично, следующий шаг у нас — короткое тестовое задание на план A/B теста и два варианта главного слайда. Если вам ок, я пришлю детали.";

  assert.equal(hasSoftCta(text), true);
  assert.equal(hasHardImperativeWithoutSoftener(text), false);
  assert.equal(validateSoftCta(text).ok, true);
});

test("cta validator: accepts question-based CTA", () => {
  const text = "Если вам интересно, могу сразу прислать тестовое задание. Подойдет такой следующий шаг?";

  assert.equal(validateSoftCta(text).ok, true);
});
