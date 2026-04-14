import assert from "node:assert/strict";
import test from "node:test";
import { resolveModerationDelayMs, getModerationAutoSendDelayMs, DEFAULT_MODERATION_AUTO_SEND_DELAY_HOURS } from "../../services/candidate-chatbot/src/config.js";

// ─── resolveModerationDelayMs ─────────────────────────────────────────────────

test("resolveModerationDelayMs: uses vacancy-level minutes when set", () => {
  const settings = { auto_send_delay_minutes: 120 };
  const expected = 120 * 60 * 1000;
  assert.equal(resolveModerationDelayMs(settings), expected);
});

test("resolveModerationDelayMs: uses vacancy-level minutes for non-default value", () => {
  const settings = { auto_send_delay_minutes: 30 };
  assert.equal(resolveModerationDelayMs(settings), 30 * 60 * 1000);
});

test("resolveModerationDelayMs: falls back to global env when moderation_settings is empty", () => {
  const globalMs = getModerationAutoSendDelayMs();
  assert.equal(resolveModerationDelayMs({}), globalMs);
});

test("resolveModerationDelayMs: falls back to global env when moderation_settings is undefined", () => {
  const globalMs = getModerationAutoSendDelayMs();
  assert.equal(resolveModerationDelayMs(undefined), globalMs);
});

test("resolveModerationDelayMs: falls back to global env when auto_send_delay_minutes is null", () => {
  const globalMs = getModerationAutoSendDelayMs();
  assert.equal(resolveModerationDelayMs({ auto_send_delay_minutes: null }), globalMs);
});

test("resolveModerationDelayMs: falls back to global env when auto_send_delay_minutes is 0", () => {
  const globalMs = getModerationAutoSendDelayMs();
  assert.equal(resolveModerationDelayMs({ auto_send_delay_minutes: 0 }), globalMs);
});

test("resolveModerationDelayMs: falls back to global env when auto_send_delay_minutes is negative", () => {
  const globalMs = getModerationAutoSendDelayMs();
  assert.equal(resolveModerationDelayMs({ auto_send_delay_minutes: -10 }), globalMs);
});

test("resolveModerationDelayMs: vacancy delay can be shorter than global default", () => {
  const defaultHours = DEFAULT_MODERATION_AUTO_SEND_DELAY_HOURS;
  const defaultMs = defaultHours * 60 * 60 * 1000;
  const shorterSettings = { auto_send_delay_minutes: 15 };
  assert.ok(resolveModerationDelayMs(shorterSettings) < defaultMs, "vacancy delay should be shorter than global default");
});

// ─── demo-vacancies.json structure ────────────────────────────────────────────

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("demo-vacancies.json: loads and has required vacancies", async () => {
  const raw = await readFile(join(__dirname, "../../tests/fixtures/demo-vacancies.json"), "utf8");
  const vacancies = JSON.parse(raw);
  assert.ok(Array.isArray(vacancies), "should be an array");
  assert.ok(vacancies.length >= 4, "should have at least 4 vacancies (3 active + 1 draft)");
});

test("demo-vacancies.json: all vacancies have required fields", async () => {
  const raw = await readFile(join(__dirname, "../../tests/fixtures/demo-vacancies.json"), "utf8");
  const vacancies = JSON.parse(raw);
  for (const vac of vacancies) {
    assert.ok(vac.vacancy_id, `${vac.vacancy_id}: should have vacancy_id`);
    assert.ok(vac.job_id, `${vac.vacancy_id}: should have job_id`);
    assert.ok(vac.title, `${vac.vacancy_id}: should have title`);
    assert.ok(["active", "draft", "archived"].includes(vac.status), `${vac.vacancy_id}: invalid status`);
    assert.ok(["pending", "partial", "complete"].includes(vac.extraction_status), `${vac.vacancy_id}: invalid extraction_status`);
    assert.ok(vac.moderation_settings !== undefined, `${vac.vacancy_id}: should have moderation_settings`);
  }
});

test("demo-vacancies.json: has at least 3 active vacancies", async () => {
  const raw = await readFile(join(__dirname, "../../tests/fixtures/demo-vacancies.json"), "utf8");
  const vacancies = JSON.parse(raw);
  const active = vacancies.filter(v => v.status === "active");
  assert.ok(active.length >= 3, `expected >= 3 active vacancies, got ${active.length}`);
});

test("demo-vacancies.json: has at least 1 draft vacancy", async () => {
  const raw = await readFile(join(__dirname, "../../tests/fixtures/demo-vacancies.json"), "utf8");
  const vacancies = JSON.parse(raw);
  const drafts = vacancies.filter(v => v.status === "draft");
  assert.ok(drafts.length >= 1, `expected >= 1 draft vacancy, got ${drafts.length}`);
});

test("demo-vacancies.json: active vacancies have extracted fields", async () => {
  const raw = await readFile(join(__dirname, "../../tests/fixtures/demo-vacancies.json"), "utf8");
  const vacancies = JSON.parse(raw);
  for (const vac of vacancies.filter(v => v.status === "active")) {
    assert.ok(Array.isArray(vac.must_haves) && vac.must_haves.length > 0, `${vac.vacancy_id}: must_haves should be non-empty array`);
    assert.ok(Array.isArray(vac.faq), `${vac.vacancy_id}: faq should be array`);
    assert.ok(vac.work_conditions && typeof vac.work_conditions === "object", `${vac.vacancy_id}: work_conditions should be object`);
  }
});

test("demo-vacancies.json: draft vacancy has source_materials", async () => {
  const raw = await readFile(join(__dirname, "../../tests/fixtures/demo-vacancies.json"), "utf8");
  const vacancies = JSON.parse(raw);
  const draft = vacancies.find(v => v.status === "draft");
  assert.ok(draft, "draft vacancy should exist");
  assert.ok(draft.source_materials, "draft vacancy should have source_materials");
  assert.ok(draft.source_materials.vacancy_text, "source_materials should have vacancy_text");
});

test("demo-vacancies.json: active vacancies have positive auto_send_delay_minutes", async () => {
  const raw = await readFile(join(__dirname, "../../tests/fixtures/demo-vacancies.json"), "utf8");
  const vacancies = JSON.parse(raw);
  for (const vac of vacancies.filter(v => v.status === "active")) {
    const delay = vac.moderation_settings?.auto_send_delay_minutes;
    assert.ok(Number.isFinite(delay) && delay > 0, `${vac.vacancy_id}: moderation_settings.auto_send_delay_minutes should be positive number`);
  }
});

// ─── candidate-archetypes.json structure ─────────────────────────────────────

test("candidate-archetypes.json: loads and has all required archetypes", async () => {
  const raw = await readFile(join(__dirname, "../../data/demo-simulator/candidate-archetypes.json"), "utf8");
  const data = JSON.parse(raw);
  const requiredArchetypes = ["strong_fit", "medium_needs_clarification", "salary_mismatch", "went_dark"];
  for (const id of requiredArchetypes) {
    const found = data.archetypes.find(a => a.id === id);
    assert.ok(found, `archetype ${id} should exist`);
  }
});

test("candidate-archetypes.json: vacancy_weights sum to approximately 1.0", async () => {
  const raw = await readFile(join(__dirname, "../../data/demo-simulator/candidate-archetypes.json"), "utf8");
  const data = JSON.parse(raw);
  for (const [cls, weights] of Object.entries(data.vacancy_weights)) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1.0) < 0.01, `${cls}: weights should sum to 1.0, got ${total}`);
  }
});
