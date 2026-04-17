import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FakeLlmAdapter } from "../../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../../services/candidate-chatbot/src/handlers.js";
import { createHttpServer } from "../../services/candidate-chatbot/src/http-server.js";
import { InMemoryHiringStore } from "../../services/candidate-chatbot/src/store.js";

const seed = JSON.parse(await readFile(new URL("../fixtures/iteration-1-seed.json", import.meta.url), "utf8"));

function createRuntime(overrides = {}) {
  const store = new InMemoryHiringStore(seed);
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

test("webhook returns real planned message, not placeholder", async () => {
  const { app } = createRuntime();

  const response = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text
  ));

  assert.equal(response.status, 200);
  assert.equal(response.body.step_result, "needs_clarification");
  assert.equal(response.body.run_status, "active");
  assert.ok(response.body.planned_message_id);
  assert.ok(response.body.message);
  assert.doesNotMatch(response.body.message, /\{\{|\}\}/);
});

test("one candidate answer can complete multiple steps", async () => {
  const { app, store } = createRuntime();

  const response = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text
  ));

  assert.deepEqual(response.body.completed_step_ids, [
    "direct_china_suppliers",
    "china_platforms",
    "purchase_volume"
  ]);
  const stepStates = store.getStepStates("run-zakup-001");
  assert.equal(stepStates.find((step) => step.step_id === "direct_china_suppliers").state, "completed");
  assert.equal(stepStates.find((step) => step.step_id === "china_platforms").state, "completed");
  assert.equal(stepStates.find((step) => step.step_id === "purchase_volume").state, "completed");
  assert.equal(stepStates.find((step) => step.step_id === "product_categories").state, "active");
});

test("pipeline stays active when required facts are missing", async () => {
  const { app, store } = createRuntime();

  const response = await app.postWebhookMessage(requestFor(
    "conv-sales-001",
    seed.candidate_fixtures[2].inbound_text
  ));

  assert.equal(response.status, 200);
  assert.equal(response.body.run_status, "active");
  assert.deepEqual(response.body.completed_step_ids, ["crm_usage", "compensation_model"]);
  const run = store.pipelineRuns.get("run-sales-001");
  assert.equal(run.status, "active");
  assert.equal(run.active_step_id, "b2b_sales_experience");
});

test("pipeline rejects candidate when reject_when is met", async () => {
  const { app, store } = createRuntime();

  const response = await app.postWebhookMessage(requestFor(
    "conv-cook-001",
    seed.candidate_fixtures[1].inbound_text
  ));

  assert.equal(response.status, 200);
  assert.equal(response.body.step_result, "reject");
  assert.equal(response.body.run_status, "rejected");
  assert.equal(response.body.rejected_step_id, "medical_book");
  assert.match(response.body.message, /не сможем продолжить|обязательны/i);
  assert.equal(store.pipelineRuns.get("run-cook-001").status, "rejected");
  assert.equal(store.getStepStates("run-cook-001").find((step) => step.step_id === "medical_book").state, "rejected");
});

test("invalid llm json goes to manual review and does not create planned message", async () => {
  const { app, store } = createRuntime({
    "conv-sales-001": "{not valid json"
  });

  const response = await app.postWebhookMessage(requestFor(
    "conv-sales-001",
    seed.candidate_fixtures[2].inbound_text
  ));

  assert.equal(response.status, 202);
  assert.equal(response.body.step_result, "manual_review");
  assert.equal(response.body.run_status, "manual_review");
  assert.equal(response.body.planned_message_id, null);
  assert.equal(store.plannedMessages.length, 0);
  assert.equal(store.pipelineEvents.at(-1).event_type, "llm_output_rejected");
  assert.deepEqual(response.body.guard_flags, ["invalid_json"]);
  // run stays active — next message can still be processed
  assert.equal(store.pipelineRuns.get("run-sales-001").status, "active");
});

test("duplicate outbound message is blocked by validator", async () => {
  let duplicateMessage = null;
  const { app, store } = createRuntime({
    "conv-zakup-001": () => {
      if (duplicateMessage) {
        return {
          step_result: "needs_clarification",
          completed_step_ids: ["product_categories"],
          rejected_step_id: null,
          extracted_facts: {
            product_categories: ["инструмент", "товары для дома"]
          },
          missing_information: ["quality_cases", "compensation_and_travel"],
          next_message: duplicateMessage,
          confidence: 0.88,
          guard_flags: []
        };
      }
      return undefined;
    }
  });

  const firstResponse = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text,
    "001"
  ));
  assert.equal(firstResponse.status, 200);

  duplicateMessage = firstResponse.body.message;
  const secondResponse = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    "Категории: инструмент и товары для дома.",
    "002"
  ));

  assert.equal(secondResponse.status, 202);
  assert.equal(secondResponse.body.step_result, "manual_review");
  assert.deepEqual(secondResponse.body.guard_flags, ["duplicate_outbound_message"]);
  assert.equal(store.plannedMessages.length, 1);
  assert.equal(store.plannedMessages[0].body, duplicateMessage);
});

test("premature acknowledgement is blocked by validator", async () => {
  const { app, store } = createRuntime({
    "conv-sales-001": {
      step_result: "needs_clarification",
      completed_step_ids: [],
      rejected_step_id: null,
      extracted_facts: {},
      missing_information: ["b2b_sales_experience"],
      next_message: "Спасибо! Подскажите, пожалуйста, какой у вас был средний чек?",
      confidence: 0.88,
      guard_flags: []
    }
  });

  const response = await app.postWebhookMessage(requestFor(
    "conv-sales-001",
    seed.candidate_fixtures[2].inbound_text
  ));

  assert.equal(response.status, 202);
  assert.equal(response.body.step_result, "manual_review");
  assert.deepEqual(response.body.guard_flags, ["premature_acknowledgement"]);
  assert.equal(store.plannedMessages.length, 0);
});

test("pending queue returns created planned message", async () => {
  const { app } = createRuntime();

  const webhookResponse = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text
  ));
  const queueResponse = await app.getPendingQueue();

  assert.equal(queueResponse.status, 200);
  assert.equal(queueResponse.body.items.length, 1);
  assert.equal(queueResponse.body.items[0].planned_message_id, webhookResponse.body.planned_message_id);
  assert.equal(queueResponse.body.items[0].conversation_id, "conv-zakup-001");
  assert.equal(queueResponse.body.items[0].review_status, "pending");
});

test("planned message defaults to 2 hour moderation window", async () => {
  const { app, store } = createRuntime();
  const before = Date.now();

  const webhookResponse = await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text
  ));

  assert.equal(webhookResponse.status, 200);
  const plannedMessage = store.plannedMessages.find((item) => item.planned_message_id === webhookResponse.body.planned_message_id);
  assert.ok(plannedMessage, "planned message should exist");

  const delayMs = new Date(plannedMessage.auto_send_after).getTime() - before;
  assert.ok(delayMs >= 2 * 60 * 60 * 1000 - 10_000, `expected about 2h delay, got ${delayMs}ms`);
  assert.ok(delayMs <= 2 * 60 * 60 * 1000 + 10_000, `expected about 2h delay, got ${delayMs}ms`);
});

test("webhook returns 404 for unknown conversation", async () => {
  const { app } = createRuntime();

  const response = await app.postWebhookMessage(requestFor(
    "conv-missing-001",
    "Здравствуйте"
  ));

  assert.equal(response.status, 404);
  assert.equal(response.body.error, "conversation_not_found");
});

test("webhook returns 409 when conversation has no active pipeline run", async () => {
  const { app, store } = createRuntime();
  store.pipelineRuns.get("run-cook-001").status = "rejected";

  const response = await app.postWebhookMessage(requestFor(
    "conv-cook-001",
    seed.candidate_fixtures[1].inbound_text
  ));

  assert.equal(response.status, 409);
  assert.equal(response.body.error, "no_active_pipeline_run");
  assert.equal(response.body.pipeline_run_id, "run-cook-001");
  assert.equal(response.body.run_status, "rejected");
});

test("http server exposes webhook and pending queue endpoints", async () => {
  const { app } = createRuntime();
  const server = createHttpServer(app);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const webhookResponse = await fetch(`http://127.0.0.1:${port}/webhook/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(requestFor(
        "conv-zakup-001",
        seed.candidate_fixtures[0].inbound_text
      ))
    });
    const webhookBody = await webhookResponse.json();

    assert.equal(webhookResponse.status, 200);
    assert.equal(webhookBody.run_status, "active");
    assert.ok(webhookBody.planned_message_id);

    const queueResponse = await fetch(`http://127.0.0.1:${port}/queue/pending`);
    const queueBody = await queueResponse.json();
    assert.equal(queueResponse.status, 200);
    assert.equal(queueBody.items.length, 1);
    assert.equal(queueBody.items[0].planned_message_id, webhookBody.planned_message_id);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("http server: GET /hh-authorize/ stores durable oauth state", async () => {
  const { app, store } = createRuntime();
  const calls = [];
  const hhOAuthClient = {
    clientId: "hh-client-id",
    redirectUri: "https://example.test/hh-callback/",
    async exchangeCodeForTokens(code) {
      calls.push({ type: "exchange", code });
      return store.setHhOAuthTokens("hh", {
        access_token: "access-001",
        refresh_token: "refresh-001",
        token_type: "bearer",
        expires_at: "2026-04-12T12:00:00.000Z",
        metadata: { source: "test" }
      });
    },
    async getMe() {
      calls.push({ type: "me" });
      return { id: "employer-001", manager: { id: "manager-001" } };
    }
  };
  const server = createHttpServer(app, { store, hhOAuthClient });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const authorizeResponse = await fetch(`http://127.0.0.1:${port}/hh-authorize/`);
    const authorizeBody = await authorizeResponse.json();
    const authorizeState = await store.getHhOAuthTokens(`hh_state:hh:${authorizeBody.state}`);

    assert.equal(authorizeResponse.status, 200);
    assert.equal(authorizeBody.ok, true);
    assert.equal(authorizeBody.provider, "hh");
    assert.equal(authorizeBody.state, authorizeState?.access_token);
    assert.equal(authorizeState.token_type, "oauth_state");
    assert.match(authorizeBody.authorize_url, /https:\/\/hh\.ru\/oauth\/authorize\?/);

    const callbackResponse = await fetch(`http://127.0.0.1:${port}/hh-callback/?code=oauth-code-123&state=${authorizeBody.state}`);
    const callbackBody = await callbackResponse.json();
    const tokens = await store.getHhOAuthTokens("hh");
    const consumedState = await store.getHhOAuthTokens(`hh_state:hh:${authorizeBody.state}`);

    assert.equal(callbackResponse.status, 200);
    assert.equal(callbackBody.ok, true);
    assert.equal(callbackBody.employer_id, "employer-001");
    assert.equal(callbackBody.manager_id, "manager-001");
    assert.equal(tokens.access_token, "access-001");
    assert.equal(consumedState.token_type, "oauth_state_consumed");
    assert.deepEqual(calls, [
      { type: "exchange", code: "oauth-code-123" },
      { type: "me" }
    ]);
  } finally {
    server.close();
  }
});

test("http server: /hh-callback/ requires state, rejects missing/invalid/expired states", async () => {
  const { app, store } = createRuntime();
  const hhOAuthClient = {
    clientId: "hh-client-id",
    clientSecret: "hh-client-secret",
    redirectUri: "https://example.test/hh-callback/",
    async exchangeCodeForTokens() {
      assert.fail("exchangeCodeForTokens should not be called");
    },
    async getMe() {
      assert.fail("getMe should not be called");
    }
  };
  const server = createHttpServer(app, { store, hhOAuthClient });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const missingStateResponse = await fetch(`http://127.0.0.1:${port}/hh-callback/?code=oauth-code`);
    const missingStateBody = await missingStateResponse.json();
    assert.equal(missingStateResponse.status, 400);
    assert.equal(missingStateBody.error, "missing_state");

    const invalidStateResponse = await fetch(`http://127.0.0.1:${port}/hh-callback/?code=oauth-code&state=missing-state`);
    const invalidStateBody = await invalidStateResponse.json();
    assert.equal(invalidStateResponse.status, 400);
    assert.equal(invalidStateBody.error, "invalid_oauth_state");

    const expiredState = "expired-state";
    await store.setHhOAuthTokens(`hh_state:hh:${expiredState}`, {
      access_token: expiredState,
      token_type: "oauth_state",
      expires_at: "2000-01-01T00:00:00.000Z",
      metadata: { redirect_uri: "https://example.test/hh-callback/" }
    });
    const expiredStateResponse = await fetch(`http://127.0.0.1:${port}/hh-callback/?code=oauth-code&state=expired-state`);
    const expiredStateBody = await expiredStateResponse.json();
    const expiredStateRow = await store.getHhOAuthTokens(`hh_state:hh:${expiredState}`);
    assert.equal(expiredStateResponse.status, 400);
    assert.equal(expiredStateBody.error, "oauth_state_expired");
    assert.equal(expiredStateRow.token_type, "oauth_state_expired");
  } finally {
    server.close();
  }
});

test("http server: /hh-callback/ handles oauth exchange failures", async () => {
  const { app, store } = createRuntime();
  const calls = [];
  const hhOAuthClient = {
    clientId: "hh-client-id",
    redirectUri: "https://example.test/hh-callback/",
    async exchangeCodeForTokens() {
      calls.push({ type: "exchange" });
      const error = new Error("token exchange failed");
      error.status = 500;
      throw error;
    },
    async getMe() {
      calls.push({ type: "me" });
      assert.fail("getMe should not be called");
    }
  };
  const state = "state-failure-500";
  await store.setHhOAuthTokens(`hh_state:hh:${state}`, {
    access_token: state,
    token_type: "oauth_state",
    expires_at: "2026-12-31T23:59:59.000Z",
    metadata: { redirect_uri: "https://example.test/hh-callback/" }
  });

  const server = createHttpServer(app, { store, hhOAuthClient });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const failedResponse = await fetch(`http://127.0.0.1:${port}/hh-callback/?code=oauth-code&state=${state}`);
    const failedBody = await failedResponse.json();
    const failedState = await store.getHhOAuthTokens(`hh_state:hh:${state}`);

    assert.equal(failedResponse.status, 400);
    assert.equal(failedBody.error, "hh_oauth_exchange_failed");
    assert.equal(failedState.token_type, "oauth_state_error");
    assert.equal(calls.length, 1);
  } finally {
    server.close();
  }
});

test("state projection matches events log for completed and rejected steps", async () => {
  const { app, store } = createRuntime();

  await app.postWebhookMessage(requestFor(
    "conv-zakup-001",
    seed.candidate_fixtures[0].inbound_text
  ));
  await app.postWebhookMessage(requestFor(
    "conv-cook-001",
    seed.candidate_fixtures[1].inbound_text
  ));

  for (const runId of ["run-zakup-001", "run-cook-001"]) {
    const actual = store.getStepStates(runId);
    const rebuilt = store.rebuildStepStateFromEvents(runId);

    for (const actualStep of actual) {
      const rebuiltStep = rebuilt.find((step) => step.step_id === actualStep.step_id);
      assert.equal(rebuiltStep.state, actualStep.state, `${runId}:${actualStep.step_id}:state`);
      assert.equal(rebuiltStep.awaiting_reply, actualStep.awaiting_reply, `${runId}:${actualStep.step_id}:awaiting_reply`);
      assert.deepEqual(rebuiltStep.extracted_facts, actualStep.extracted_facts, `${runId}:${actualStep.step_id}:extracted_facts`);
    }
  }
});
