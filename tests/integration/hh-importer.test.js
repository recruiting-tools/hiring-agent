import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { InMemoryHiringStore } from "../../services/candidate-chatbot/src/store.js";
import { FakeHhClient } from "../../services/hh-connector/src/hh-client.js";
import { HhImporter } from "../../services/hh-connector/src/hh-importer.js";

const seed = JSON.parse(await readFile(new URL("../fixtures/iteration-1-seed.json", import.meta.url), "utf8"));

function makeRuntime() {
  const store = new InMemoryHiringStore(seed);
  const hhClient = new FakeHhClient();
  const importer = new HhImporter({ store, hhClient });
  return { store, hhClient, importer };
}

// ─── M4: step reconstruction from HH collection ──────────────────────────────

test("hh importer: response candidate placed at template steps[0]", async () => {
  const { store, hhClient, importer } = makeRuntime();
  hhClient.addNegotiation("neg-resp", [], {
    hh_vacancy_id: "hh-vac-001",
    collection: "response",
    updated_at: "2026-04-12T10:00:00Z"
  });

  await importer.syncApplicants({
    vacancyMappings: [{ hh_vacancy_id: "hh-vac-001", job_id: "job-zakup-china" }],
    windowStart: "2026-04-10T00:00:00Z"
  });

  const run = store.pipelineRuns.get("run-hh-neg-resp");
  assert.ok(run, "pipeline run should be created");
  const template = seed.jobs[0].pipeline_template;
  assert.equal(run.active_step_id, template.steps[0].id, "response candidate starts at step[0]");

  const stepStates = store.pipelineStepState.get("run-hh-neg-resp");
  const firstState = stepStates.find(s => s.step_id === template.steps[0].id);
  assert.equal(firstState.state, "active");
  assert.equal(firstState.awaiting_reply, true);
});

test("hh importer: phone_interview candidate placed at template steps[1] with step[0] completed", async () => {
  const { store, hhClient, importer } = makeRuntime();
  hhClient.addNegotiation("neg-phone", [], {
    hh_vacancy_id: "hh-vac-001",
    collection: "phone_interview",
    updated_at: "2026-04-12T10:00:00Z"
  });

  await importer.syncApplicants({
    vacancyMappings: [{ hh_vacancy_id: "hh-vac-001", job_id: "job-zakup-china" }],
    windowStart: "2026-04-10T00:00:00Z"
  });

  const run = store.pipelineRuns.get("run-hh-neg-phone");
  assert.ok(run, "pipeline run should be created");
  const template = seed.jobs[0].pipeline_template;
  assert.equal(run.active_step_id, template.steps[1].id, "phone_interview candidate starts at steps[1]");

  const stepStates = store.pipelineStepState.get("run-hh-neg-phone");
  const step0State = stepStates.find(s => s.step_id === template.steps[0].id);
  const step1State = stepStates.find(s => s.step_id === template.steps[1].id);
  assert.equal(step0State.state, "completed", "step[0] should be completed for phone_interview");
  assert.equal(step0State.awaiting_reply, false);
  assert.equal(step1State.state, "active", "step[1] should be active");
  assert.equal(step1State.awaiting_reply, true);
});

// ─── M2: per-mapping isolation ────────────────────────────────────────────────

test("hh importer: syncApplicants with unknown job_id does not throw, reports error in results", async () => {
  const { store, hhClient, importer } = makeRuntime();
  hhClient.addNegotiation("neg-bad-job", [], {
    hh_vacancy_id: "hh-vac-bad",
    collection: "response",
    updated_at: "2026-04-12T10:00:00Z"
  });
  hhClient.addNegotiation("neg-good", [], {
    hh_vacancy_id: "hh-vac-001",
    collection: "response",
    updated_at: "2026-04-12T10:00:00Z"
  });

  let result;
  await assert.doesNotReject(async () => {
    result = await importer.syncApplicants({
      vacancyMappings: [
        { hh_vacancy_id: "hh-vac-bad", job_id: "job-does-not-exist" },
        { hh_vacancy_id: "hh-vac-001", job_id: "job-zakup-china" }
      ],
      windowStart: "2026-04-10T00:00:00Z"
    });
  }, "syncApplicants should not throw on bad job_id");

  const errorResult = result.results.find(r => r.job_id === "job-does-not-exist");
  assert.ok(errorResult, "error result should be present");
  assert.ok(errorResult.error, "error result should have error message");

  const goodResult = result.results.find(r => r.job_id === "job-zakup-china");
  assert.ok(goodResult, "good mapping should still produce a result");
  assert.equal(goodResult.imported_negotiations, 1, "good mapping should import 1 negotiation");
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

test("hh importer: re-import of same negotiation is idempotent", async () => {
  const { store, hhClient, importer } = makeRuntime();
  hhClient.addNegotiation("neg-idem", [
    { id: "msg-1", author: "applicant", text: "Привет", created_at: "2026-04-12T10:00:00Z" }
  ], {
    hh_vacancy_id: "hh-vac-001",
    collection: "response",
    updated_at: "2026-04-12T10:00:00Z"
  });

  const mapping = [{ hh_vacancy_id: "hh-vac-001", job_id: "job-zakup-china" }];
  const window = { windowStart: "2026-04-10T00:00:00Z" };

  await importer.syncApplicants({ vacancyMappings: mapping, ...window });
  await importer.syncApplicants({ vacancyMappings: mapping, ...window });

  const neg = store.hhNegotiations.get("neg-idem");
  assert.ok(neg, "negotiation should exist");

  const msgs = store.messages.filter(m => m.channel_message_id === "msg-1");
  assert.equal(msgs.length, 1, "message should not be duplicated on re-import");
});

// ─── Message direction mapping ────────────────────────────────────────────────

test("hh importer: applicant messages imported as inbound, employer as outbound", async () => {
  const { store, hhClient, importer } = makeRuntime();
  hhClient.addNegotiation("neg-dir", [
    { id: "m-in", author: "applicant", text: "Я интересуюсь", created_at: "2026-04-12T10:00:00Z" },
    { id: "m-out", author: "employer", text: "Расскажите подробнее", created_at: "2026-04-12T10:05:00Z" }
  ], {
    hh_vacancy_id: "hh-vac-001",
    collection: "response",
    updated_at: "2026-04-12T10:05:00Z"
  });

  await importer.syncApplicants({
    vacancyMappings: [{ hh_vacancy_id: "hh-vac-001", job_id: "job-zakup-china" }],
    windowStart: "2026-04-10T00:00:00Z"
  });

  const inbound = store.messages.find(m => m.channel_message_id === "m-in");
  const outbound = store.messages.find(m => m.channel_message_id === "m-out");
  assert.equal(inbound?.direction, "inbound");
  assert.equal(outbound?.direction, "outbound");
});

// ─── Window filtering ─────────────────────────────────────────────────────────

test("hh importer: negotiations outside window are not imported", async () => {
  const { store, hhClient, importer } = makeRuntime();
  hhClient.addNegotiation("neg-old", [], {
    hh_vacancy_id: "hh-vac-001",
    collection: "response",
    updated_at: "2026-04-01T10:00:00Z"
  });
  hhClient.addNegotiation("neg-new", [], {
    hh_vacancy_id: "hh-vac-001",
    collection: "response",
    updated_at: "2026-04-12T10:00:00Z"
  });

  await importer.syncApplicants({
    vacancyMappings: [{ hh_vacancy_id: "hh-vac-001", job_id: "job-zakup-china" }],
    windowStart: "2026-04-08T00:00:00Z"
  });

  assert.equal(store.hhNegotiations.has("neg-old"), false, "out-of-window negotiation should not be imported");
  assert.equal(store.hhNegotiations.has("neg-new"), true, "in-window negotiation should be imported");
});
