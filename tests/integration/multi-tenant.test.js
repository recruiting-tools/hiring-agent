import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FakeLlmAdapter } from "../../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../../services/candidate-chatbot/src/handlers.js";
import { createHttpServer } from "../../services/candidate-chatbot/src/http-server.js";
import { InMemoryHiringStore } from "../../services/candidate-chatbot/src/store.js";

const seed5 = JSON.parse(readFileSync(
  new URL("../fixtures/iteration-5-seed.json", import.meta.url), "utf8"
));

const seed1 = JSON.parse(readFileSync(
  new URL("../fixtures/iteration-1-seed.json", import.meta.url), "utf8"
));

async function req(server, method, path, body) {
  const port = server.address().port;
  const opts = { method, headers: { "content-type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`http://localhost:${port}${path}`, opts);
  const isJson = r.headers.get("content-type")?.includes("json");
  const responseBody = isJson ? await r.json() : await r.text();
  return { status: r.status, body: responseBody };
}

// ─── Test 1 ───────────────────────────────────────────────────────────────────
test("isolation: getRecruiterByToken finds recruiter from multi-recruiter seed", async () => {
  const store = new InMemoryHiringStore(seed5);

  const alpha = await store.getRecruiterByToken("rec-tok-alpha-001");
  assert.ok(alpha !== null, "should find alpha recruiter");
  assert.equal(alpha.recruiter_id, "rec-alpha-001");
  assert.equal(alpha.client_id, "client-alpha-001");

  const beta = await store.getRecruiterByToken("rec-tok-beta-001");
  assert.ok(beta !== null, "should find beta recruiter");
  assert.equal(beta.recruiter_id, "rec-beta-001");
  assert.equal(beta.client_id, "client-beta-001");

  const alpha2 = await store.getRecruiterByToken("rec-tok-alpha-002");
  assert.ok(alpha2 !== null, "should find second alpha recruiter");
  assert.equal(alpha2.recruiter_id, "rec-alpha-002");
});

// ─── Test 2 ───────────────────────────────────────────────────────────────────
test("isolation: getRecruiterByToken returns null for unknown token in multi-recruiter seed", async () => {
  const store = new InMemoryHiringStore(seed5);

  const result = await store.getRecruiterByToken("nonexistent-token-xyz");
  assert.equal(result, null);
});

// ─── Test 3 ───────────────────────────────────────────────────────────────────
test("isolation: getQueueForRecruiter returns only messages for recruiter's own client", async () => {
  const store = new InMemoryHiringStore(seed5);

  store.plannedMessages.push({
    planned_message_id: "pm-alpha-003",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Alpha message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });
  store.plannedMessages.push({
    planned_message_id: "pm-beta-003",
    conversation_id:    "conv-beta-sales-001",
    candidate_id:       "cand-beta-sales-001",
    pipeline_run_id:    "run-beta-sales-001",
    step_id:            "b2b_experience",
    body:               "Beta message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const alphaQueue = await store.getQueueForRecruiter("rec-tok-alpha-001");
  assert.ok(alphaQueue !== null);
  const alphaIds = alphaQueue.map(i => i.planned_message_id);
  assert.ok(alphaIds.includes("pm-alpha-003"), "alpha message should be in alpha queue");
  assert.ok(!alphaIds.includes("pm-beta-003"), "beta message must NOT be in alpha queue");

  const betaQueue = await store.getQueueForRecruiter("rec-tok-beta-001");
  assert.ok(betaQueue !== null);
  const betaIds = betaQueue.map(i => i.planned_message_id);
  assert.ok(betaIds.includes("pm-beta-003"), "beta message should be in beta queue");
  assert.ok(!betaIds.includes("pm-alpha-003"), "alpha message must NOT be in beta queue");
});

// ─── Test 4 ───────────────────────────────────────────────────────────────────
test("isolation: recruiter A cannot see pending messages from recruiter B jobs", async () => {
  const store = new InMemoryHiringStore(seed5);

  store.plannedMessages.push({
    planned_message_id: "pm-alpha-001",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Привет от Alpha",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });
  store.plannedMessages.push({
    planned_message_id: "pm-beta-001",
    conversation_id:    "conv-beta-sales-001",
    candidate_id:       "cand-beta-sales-001",
    pipeline_run_id:    "run-beta-sales-001",
    step_id:            "b2b_experience",
    body:               "Привет от Beta",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const alphaQueue = await store.getQueueForRecruiter("rec-tok-alpha-001");
  assert.ok(alphaQueue !== null);
  const alphaIds = alphaQueue.map(i => i.planned_message_id);
  assert.ok(alphaIds.includes("pm-alpha-001"), "alpha message should be visible to alpha recruiter");
  assert.ok(!alphaIds.includes("pm-beta-001"), "beta message must NOT be visible to alpha recruiter");
});

// ─── Test 5 ───────────────────────────────────────────────────────────────────
test("isolation: recruiter B cannot see pending messages from recruiter A jobs", async () => {
  const store = new InMemoryHiringStore(seed5);

  store.plannedMessages.push({
    planned_message_id: "pm-alpha-005",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Alpha only message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });
  store.plannedMessages.push({
    planned_message_id: "pm-beta-005",
    conversation_id:    "conv-beta-sales-001",
    candidate_id:       "cand-beta-sales-001",
    pipeline_run_id:    "run-beta-sales-001",
    step_id:            "b2b_experience",
    body:               "Beta only message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const betaQueue = await store.getQueueForRecruiter("rec-tok-beta-001");
  assert.ok(betaQueue !== null);
  const betaIds = betaQueue.map(i => i.planned_message_id);
  assert.ok(betaIds.includes("pm-beta-005"), "beta message should be visible to beta recruiter");
  assert.ok(!betaIds.includes("pm-alpha-005"), "alpha message must NOT be visible to beta recruiter");
});

// ─── Test 6 ───────────────────────────────────────────────────────────────────
test("isolation: two recruiters from same client both see shared client messages", async () => {
  const store = new InMemoryHiringStore(seed5);

  store.plannedMessages.push({
    planned_message_id: "pm-alpha-shared",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Alpha shared message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const queue1 = await store.getQueueForRecruiter("rec-tok-alpha-001");
  const queue2 = await store.getQueueForRecruiter("rec-tok-alpha-002");

  assert.ok(queue1.some(i => i.planned_message_id === "pm-alpha-shared"),
    "alpha recruiter 1 should see shared alpha message");
  assert.ok(queue2.some(i => i.planned_message_id === "pm-alpha-shared"),
    "alpha recruiter 2 should see shared alpha message");
});

// ─── Test 7 ───────────────────────────────────────────────────────────────────
test("isolation: GET /recruiter/:token/queue scopes to client when two clients have pending messages", async () => {
  const store = new InMemoryHiringStore(seed5);

  store.plannedMessages.push({
    planned_message_id: "pm-alpha-http",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Alpha HTTP message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });
  store.plannedMessages.push({
    planned_message_id: "pm-beta-http",
    conversation_id:    "conv-beta-sales-001",
    candidate_id:       "cand-beta-sales-001",
    pipeline_run_id:    "run-beta-sales-001",
    step_id:            "b2b_experience",
    body:               "Beta HTTP message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/recruiter/rec-tok-beta-001/queue");
    assert.equal(status, 200);
    const ids = body.items.map(i => i.planned_message_id);
    assert.ok(ids.includes("pm-beta-http"),   "beta message visible to beta recruiter");
    assert.ok(!ids.includes("pm-alpha-http"), "alpha message NOT visible to beta recruiter");

    const { status: s2, body: b2 } = await req(server, "GET", "/recruiter/rec-tok-alpha-001/queue");
    assert.equal(s2, 200);
    const ids2 = b2.items.map(i => i.planned_message_id);
    assert.ok(ids2.includes("pm-alpha-http"), "alpha message visible to alpha recruiter");
    assert.ok(!ids2.includes("pm-beta-http"), "beta message NOT visible to alpha recruiter");
  } finally {
    server.close();
  }
});

// ─── Test 8 ───────────────────────────────────────────────────────────────────
test("isolation: jobs without client_id are included in queue for any recruiter (backward compat)", async () => {
  // Old seed: jobs have no client_id, single recruiter
  const store = new InMemoryHiringStore(seed1);

  store.plannedMessages.push({
    planned_message_id: "pm-no-client",
    conversation_id:    "conv-zakup-001",
    candidate_id:       "cand-zakup-good",
    pipeline_run_id:    "run-zakup-001",
    step_id:            "purchase_volume",
    body:               "No client_id job message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const queue = await store.getQueueForRecruiter("rec-tok-demo-001");
  assert.ok(queue !== null);
  assert.ok(queue.some(i => i.planned_message_id === "pm-no-client"),
    "message for job without client_id must be included (backward compat)");
});

// ─── Test 9 ───────────────────────────────────────────────────────────────────
test("isolation: blockMessage by recruiter A does not make message visible to recruiter B", async () => {
  const store = new InMemoryHiringStore(seed5);

  // Alpha message (visible only to alpha)
  store.plannedMessages.push({
    planned_message_id: "pm-alpha-block",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Alpha message to block",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });
  // Beta message (visible only to beta)
  store.plannedMessages.push({
    planned_message_id: "pm-beta-block",
    conversation_id:    "conv-beta-sales-001",
    candidate_id:       "cand-beta-sales-001",
    pipeline_run_id:    "run-beta-sales-001",
    step_id:            "b2b_experience",
    body:               "Beta message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  // Alpha recruiter blocks their own message
  await store.blockMessage("pm-alpha-block");

  // Beta recruiter queue should NOT contain either alpha message (blocked or not)
  const betaQueue = await store.getQueueForRecruiter("rec-tok-beta-001");
  const betaIds = betaQueue.map(i => i.planned_message_id);
  assert.ok(!betaIds.includes("pm-alpha-block"),
    "blocked alpha message must NOT appear in beta queue");
  assert.ok(betaIds.includes("pm-beta-block"),
    "beta message must still appear in beta queue");
});

// ─── Test 10 ──────────────────────────────────────────────────────────────────
test("isolation: send-now by recruiter A does not make message visible to recruiter B", async () => {
  const store = new InMemoryHiringStore(seed5);

  // Alpha message
  store.plannedMessages.push({
    planned_message_id: "pm-alpha-sendnow",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Alpha send-now message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 10 * 60_000).toISOString()
  });
  // Beta message
  store.plannedMessages.push({
    planned_message_id: "pm-beta-sendnow",
    conversation_id:    "conv-beta-sales-001",
    candidate_id:       "cand-beta-sales-001",
    pipeline_run_id:    "run-beta-sales-001",
    step_id:            "b2b_experience",
    body:               "Beta message",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 10 * 60_000).toISOString()
  });

  // Alpha recruiter approves their message via send-now (changes to 'approved', moved to past)
  await store.approveAndSendNow("pm-alpha-sendnow");

  // Beta recruiter should still NOT see the alpha message (even though it's now 'approved')
  const betaQueue = await store.getQueueForRecruiter("rec-tok-beta-001");
  const betaIds = betaQueue.map(i => i.planned_message_id);
  assert.ok(!betaIds.includes("pm-alpha-sendnow"),
    "approved alpha message must NOT appear in beta queue");
  assert.ok(betaIds.includes("pm-beta-sendnow"),
    "beta message must still appear in beta queue");

  // Alpha recruiter should see their approved message
  const alphaQueue = await store.getQueueForRecruiter("rec-tok-alpha-001");
  const alphaIds = alphaQueue.map(i => i.planned_message_id);
  assert.ok(alphaIds.includes("pm-alpha-sendnow"),
    "approved alpha message must be visible to alpha recruiter");
});

// ─── Test 11 ──────────────────────────────────────────────────────────────────
test("isolation: recruiter B cannot block a message belonging to recruiter A's tenant (IDOR)", async () => {
  const store = new InMemoryHiringStore(seed5);
  const llm = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter: llm });

  store.plannedMessages.push({
    planned_message_id: "pm-alpha-idor-block",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Alpha message for IDOR block test",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 10 * 60_000).toISOString()
  });

  // Beta recruiter tries to block Alpha's message
  const result = await chatbot.blockMessage("rec-tok-beta-001", "pm-alpha-idor-block");
  assert.equal(result.status, 403, "must return 403 forbidden");
  assert.equal(result.body.error, "forbidden");

  // Alpha's message must still be pending (not blocked)
  const pm = await store.findPlannedMessage("pm-alpha-idor-block");
  assert.equal(pm.review_status, "pending", "message must remain pending after cross-tenant block attempt");
});

// ─── Test 12 ──────────────────────────────────────────────────────────────────
test("isolation: recruiter B cannot send-now a message belonging to recruiter A's tenant (IDOR)", async () => {
  const store = new InMemoryHiringStore(seed5);
  const llm = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter: llm });

  store.plannedMessages.push({
    planned_message_id: "pm-alpha-idor-send",
    conversation_id:    "conv-alpha-dev-001",
    candidate_id:       "cand-alpha-dev-001",
    pipeline_run_id:    "run-alpha-dev-001",
    step_id:            "ts_experience",
    body:               "Alpha message for IDOR send-now test",
    reason:             "test",
    review_status:      "pending",
    auto_send_after:    new Date(Date.now() + 10 * 60_000).toISOString()
  });

  // Beta recruiter tries to send-now Alpha's message
  const result = await chatbot.sendMessageNow("rec-tok-beta-001", "pm-alpha-idor-send");
  assert.equal(result.status, 403, "must return 403 forbidden");
  assert.equal(result.body.error, "forbidden");

  // Alpha's message must remain pending (not approved/sent)
  const pm = await store.findPlannedMessage("pm-alpha-idor-send");
  assert.equal(pm.review_status, "pending", "message must remain pending after cross-tenant send-now attempt");
});
