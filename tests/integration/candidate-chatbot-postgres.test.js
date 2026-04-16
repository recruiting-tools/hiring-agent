import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FakeLlmAdapter } from "../../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../../services/candidate-chatbot/src/handlers.js";
import { PostgresHiringStore } from "../../services/candidate-chatbot/src/postgres-store.js";

const DB_URL = process.env.CHATBOT_DATABASE_URL;

if (!DB_URL) {
  console.log("Skipping postgres tests: CHATBOT_DATABASE_URL not set");
  process.exit(0);
}

const seed = JSON.parse(await readFile(new URL("../fixtures/iteration-1-seed.json", import.meta.url), "utf8"));

async function createPostgresRuntime(overrides = {}) {
  const store = new PostgresHiringStore({ connectionString: DB_URL });
  await store.reset();
  await store.seed(seed);
  const app = createCandidateChatbot({
    store,
    llmAdapter: new FakeLlmAdapter(overrides)
  });
  return { app, store };
}

function requestFor(conversationId, text, suffix = "001") {
  return {
    conversation_id: conversationId,
    channel: "test",
    channel_message_id: `in-${conversationId}-${suffix}`,
    text,
    occurred_at: "2026-04-12T08:00:00.000Z"
  };
}

test("postgres store: webhook creates planned message in DB", async () => {
  const { app, store } = await createPostgresRuntime();

  const response = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text
  ));

  assert.equal(response.status, 200);
  assert.equal(response.body.step_result, "needs_clarification");
  assert.ok(response.body.planned_message_id);
  assert.ok(response.body.message);
  assert.doesNotMatch(response.body.message, /\{\{|\}\}/);

  // Verify planned message is persisted in DB
  const queue = await store.getPendingQueue();
  const found = queue.items.find((item) => item.planned_message_id === response.body.planned_message_id);
  assert.ok(found, "planned message must be in DB queue");
  assert.equal(found.body, response.body.message);

  await store.close();
});

test("postgres store: multiple steps completed in single transaction", async () => {
  const { app, store } = await createPostgresRuntime();

  const response = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text
  ));

  assert.deepEqual(response.body.completed_step_ids, [
    "direct_china_suppliers",
    "china_platforms",
    "purchase_volume"
  ]);

  // Check DB step states
  const stepStates = await store.getStepStates("run-zakup-001");
  assert.equal(stepStates.find((s) => s.step_id === "direct_china_suppliers").state, "completed");
  assert.equal(stepStates.find((s) => s.step_id === "china_platforms").state, "completed");
  assert.equal(stepStates.find((s) => s.step_id === "purchase_volume").state, "completed");
  assert.equal(stepStates.find((s) => s.step_id === "product_categories").state, "active");

  await store.close();
});

test("postgres store: reject writes run_rejected event", async () => {
  const { app, store } = await createPostgresRuntime();

  const response = await app.postWebhookMessage(requestFor(
    "conv-cook-001",
    seed.candidate_fixtures[1].inbound_text
  ));

  assert.equal(response.status, 200);
  assert.equal(response.body.step_result, "reject");
  assert.equal(response.body.run_status, "rejected");

  // Verify run is rejected in DB
  const conv = await store.findConversation("conv-cook-001");
  const run = await store.findRunForConversation(conv);
  assert.equal(run.status, "rejected");

  await store.close();
});

test("postgres store: manual_review does not create planned_message in DB", async () => {
  const { app, store } = await createPostgresRuntime({
    "conv-zakup-001": {
      step_result: "manual_review",
      completed_step_ids: [],
      rejected_step_id: null,
      extracted_facts: {},
      missing_information: [],
      next_message: "",
      confidence: 0.1,
      guard_flags: ["test_manual_review"]
    }
  });

  const queueBefore = await store.getPendingQueue();
  const countBefore = queueBefore.items.length;

  const response = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    "какое-то сообщение"
  ));

  assert.equal(response.status, 202);
  assert.equal(response.body.step_result, "manual_review");
  assert.equal(response.body.planned_message_id, null);

  const queueAfter = await store.getPendingQueue();
  assert.equal(queueAfter.items.length, countBefore, "no new planned messages for manual_review");

  await store.close();
});

test("postgres store: rebuildStepStateFromEvents matches live step_state", async () => {
  const { app, store } = await createPostgresRuntime();

  await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text
  ));

  const liveState = await store.getStepStates("run-zakup-001");
  const rebuilt = await store.rebuildStepStateFromEvents("run-zakup-001");

  // Both should agree on completed steps
  for (const step of liveState) {
    const rebuiltStep = rebuilt.find((s) => s.step_id === step.step_id);
    assert.ok(rebuiltStep, `rebuilt must have step ${step.step_id}`);
    assert.equal(rebuiltStep.state, step.state, `state mismatch for ${step.step_id}`);
  }

  await store.close();
});

test("postgres store: reset removes chatbot.vacancies rows", async () => {
  const { store } = await createPostgresRuntime();

  try {
    await store.sql`
      INSERT INTO chatbot.vacancies (
        vacancy_id,
        created_by,
        title,
        raw_text,
        must_haves,
        nice_haves,
        work_conditions,
        application_steps,
        company_info,
        faq,
        extraction_status,
        status,
        job_id
      )
      VALUES (
        ${"vac-postgres-reset-1"},
        ${"rec-alpha-001"},
        ${"Senior buyer"},
        ${"Ищем senior buyer с опытом закупок"},
        ${JSON.stringify(["Опыт закупок от 3 лет"])}::jsonb,
        ${JSON.stringify(["Опыт ВЭД"])}::jsonb,
        ${JSON.stringify({ schedule: "5/2" })}::jsonb,
        ${JSON.stringify([{ name: "Скрининг", type: "must_have_check" }])}::jsonb,
        ${JSON.stringify({ name: "Acme" })}::jsonb,
        ${JSON.stringify([{ q: "Формат?", a: "Офис" }])}::jsonb,
        ${"complete"},
        ${"active"},
        ${"job-zakup-china"}
      )
    `;

    const beforeReset = await store.sql`
      SELECT vacancy_id, title, status, extraction_status, must_haves
      FROM chatbot.vacancies
      WHERE vacancy_id = ${"vac-postgres-reset-1"}
    `;

    assert.equal(beforeReset.length, 1);
    assert.equal(beforeReset[0].title, "Senior buyer");
    assert.equal(beforeReset[0].status, "active");
    assert.equal(beforeReset[0].extraction_status, "complete");
    assert.deepEqual(beforeReset[0].must_haves, ["Опыт закупок от 3 лет"]);

    await store.reset();

    const afterReset = await store.sql`
      SELECT vacancy_id
      FROM chatbot.vacancies
      WHERE vacancy_id = ${"vac-postgres-reset-1"}
    `;

    assert.equal(afterReset.length, 0);
  } finally {
    await store.close();
  }
});
