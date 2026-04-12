import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FakeLlmAdapter } from "../../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../../services/candidate-chatbot/src/handlers.js";
import { createHttpServer } from "../../services/candidate-chatbot/src/http-server.js";
import { InMemoryHiringStore } from "../../services/candidate-chatbot/src/store.js";

const seed = JSON.parse(await readFile(new URL("../fixtures/iteration-1-seed.json", import.meta.url), "utf8"));

async function req(server, method, path, body) {
  const port = server.address().port;
  const opts = { method, headers: { "content-type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`http://localhost:${port}${path}`, opts);
  const isJson = r.headers.get("content-type")?.includes("json");
  const responseBody = isJson ? await r.json() : await r.text();
  return { status: r.status, body: responseBody, contentType: r.headers.get("content-type") };
}

function makePendingMessage(overrides = {}) {
  return {
    planned_message_id: "pm-test-default",
    conversation_id: "conv-zakup-001",
    candidate_id: "cand-zakup-good",
    pipeline_run_id: "run-zakup-001",
    step_id: "purchase_volume",
    body: "Уточните объём закупок",
    reason: "test reason",
    review_status: "pending",
    auto_send_after: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    send_after: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    ...overrides
  };
}

// ─── Test 1 ───────────────────────────────────────────────────────────────────
test("moderation: GET /recruiter/:token/queue returns 404 for unknown token", async () => {
  const store = new InMemoryHiringStore(seed);
  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/recruiter/wrong-token/queue");
    assert.equal(status, 404);
    assert.equal(body.error, "recruiter_not_found");
  } finally {
    server.close();
  }
});

// ─── Test 2 ───────────────────────────────────────────────────────────────────
test("moderation: GET /recruiter/:token/queue returns only pending and approved messages", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-pending", review_status: "pending" }));
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-approved", review_status: "approved" }));
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-blocked", review_status: "blocked" }));
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-sent", review_status: "sent" }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/recruiter/rec-tok-demo-001/queue");
    assert.equal(status, 200);
    const ids = body.items.map((i) => i.planned_message_id);
    assert.ok(ids.includes("pm-pending"), "pending should be in queue");
    assert.ok(ids.includes("pm-approved"), "approved should be in queue");
    assert.ok(!ids.includes("pm-blocked"), "blocked should NOT be in queue");
    assert.ok(!ids.includes("pm-sent"), "sent should NOT be in queue");
  } finally {
    server.close();
  }
});

// ─── Test 3 ───────────────────────────────────────────────────────────────────
test("moderation: GET /recruiter/:token/queue does not include blocked messages", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-blocked-only", review_status: "blocked" }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/recruiter/rec-tok-demo-001/queue");
    assert.equal(status, 200);
    const ids = body.items.map((i) => i.planned_message_id);
    assert.ok(!ids.includes("pm-blocked-only"), "blocked message must not appear in queue");
  } finally {
    server.close();
  }
});

// ─── Test 4 ───────────────────────────────────────────────────────────────────
test("moderation: GET /recruiter/:token/queue does not include sent messages", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-sent-only", review_status: "sent" }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/recruiter/rec-tok-demo-001/queue");
    assert.equal(status, 200);
    const ids = body.items.map((i) => i.planned_message_id);
    assert.ok(!ids.includes("pm-sent-only"), "sent message must not appear in queue");
  } finally {
    server.close();
  }
});

// ─── Test 5 ───────────────────────────────────────────────────────────────────
test("moderation: GET /recruiter/:token/queue response includes seconds_until_auto_send for each item", async () => {
  const store = new InMemoryHiringStore(seed);
  const sendAfter = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min from now
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-with-timer", auto_send_after: sendAfter }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/recruiter/rec-tok-demo-001/queue");
    assert.equal(status, 200);
    const item = body.items.find((i) => i.planned_message_id === "pm-with-timer");
    assert.ok(item, "item should be in queue");
    assert.ok(typeof item.seconds_until_auto_send === "number", "seconds_until_auto_send should be a number");
    assert.ok(item.seconds_until_auto_send > 0, "seconds_until_auto_send should be positive for future message");
    assert.ok(item.seconds_until_auto_send <= 360, "seconds_until_auto_send should be ~300 for 5-min future message");
  } finally {
    server.close();
  }
});

// ─── Test 6 ───────────────────────────────────────────────────────────────────
test("moderation: GET /recruiter/:token/queue enriches items with candidate_display_name and job_title", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-enriched" }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/recruiter/rec-tok-demo-001/queue");
    assert.equal(status, 200);
    const item = body.items.find((i) => i.planned_message_id === "pm-enriched");
    assert.ok(item, "item should be in queue");
    assert.equal(item.candidate_display_name, "Максим Волков");
    assert.equal(item.job_title, "Закупщик (Китай)");
    assert.ok(item.body, "body should be present");
  } finally {
    server.close();
  }
});

// ─── Test 7 ───────────────────────────────────────────────────────────────────
test("moderation: GET /recruiter/:token/queue sorts items by auto_send_after ascending", async () => {
  const store = new InMemoryHiringStore(seed);
  const sooner = new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const later = new Date(Date.now() + 8 * 60 * 1000).toISOString();
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-later", auto_send_after: later }));
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-sooner", auto_send_after: sooner }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/recruiter/rec-tok-demo-001/queue");
    assert.equal(status, 200);
    assert.ok(body.items.length >= 2, "should have at least 2 items");
    const ids = body.items.map((i) => i.planned_message_id);
    const soonerIdx = ids.indexOf("pm-sooner");
    const laterIdx = ids.indexOf("pm-later");
    assert.ok(soonerIdx < laterIdx, "sooner message should appear before later message");
  } finally {
    server.close();
  }
});

// ─── Test 8 ───────────────────────────────────────────────────────────────────
test("moderation: POST /recruiter/:token/queue/:id/block sets review_status to blocked", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-to-block" }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "POST", "/recruiter/rec-tok-demo-001/queue/pm-to-block/block");
    assert.equal(status, 200);
    assert.equal(body.planned_message_id, "pm-to-block");
    assert.equal(body.review_status, "blocked");

    // Verify it no longer appears in the queue
    const { body: queue } = await req(server, "GET", "/recruiter/rec-tok-demo-001/queue");
    const ids = queue.items.map((i) => i.planned_message_id);
    assert.ok(!ids.includes("pm-to-block"), "blocked message should not appear in queue");
  } finally {
    server.close();
  }
});

// ─── Test 9 ───────────────────────────────────────────────────────────────────
test("moderation: POST /recruiter/:token/queue/:id/block returns 404 for unknown token", async () => {
  const store = new InMemoryHiringStore(seed);
  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "POST", "/recruiter/wrong-token/queue/any-id/block");
    assert.equal(status, 404);
    assert.equal(body.error, "recruiter_not_found");
  } finally {
    server.close();
  }
});

// ─── Test 10 ──────────────────────────────────────────────────────────────────
test("moderation: POST /recruiter/:token/queue/:id/block returns 404 for unknown planned_message_id", async () => {
  const store = new InMemoryHiringStore(seed);
  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "POST", "/recruiter/rec-tok-demo-001/queue/nonexistent-pm-id/block");
    assert.equal(status, 404);
    assert.equal(body.error, "planned_message_not_found");
  } finally {
    server.close();
  }
});

// ─── Test 11 ──────────────────────────────────────────────────────────────────
test("moderation: POST /recruiter/:token/queue/:id/block returns 409 when message already sent", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-already-sent", review_status: "sent" }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "POST", "/recruiter/rec-tok-demo-001/queue/pm-already-sent/block");
    assert.equal(status, 409);
    assert.equal(body.error, "already_sent");
  } finally {
    server.close();
  }
});

// ─── Test 12 ──────────────────────────────────────────────────────────────────
test("moderation: POST /recruiter/:token/queue/:id/send-now sets auto_send_after to past", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({
    planned_message_id: "pm-send-now-time",
    auto_send_after: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const before = Date.now();
    const { status, body } = await req(server, "POST", "/recruiter/rec-tok-demo-001/queue/pm-send-now-time/send-now");
    assert.equal(status, 200);
    assert.ok(body.auto_send_after, "auto_send_after should be in response");
    const sendAfterTs = new Date(body.auto_send_after).getTime();
    assert.ok(sendAfterTs < before, "auto_send_after should be in the past");
  } finally {
    server.close();
  }
});

// ─── Test 13 ──────────────────────────────────────────────────────────────────
test("moderation: POST /recruiter/:token/queue/:id/send-now sets review_status to approved", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({ planned_message_id: "pm-send-now-status" }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, "POST", "/recruiter/rec-tok-demo-001/queue/pm-send-now-status/send-now");
    assert.equal(status, 200);
    assert.equal(body.review_status, "approved");
    assert.equal(body.queued_for_immediate_send, true);
  } finally {
    server.close();
  }
});

// ─── Test 14 ──────────────────────────────────────────────────────────────────
test("moderation: POST /recruiter/:token/queue/:id/send-now makes message immediately due in getPlannedMessagesDue", async () => {
  const store = new InMemoryHiringStore(seed);
  store.plannedMessages.push(makePendingMessage({
    planned_message_id: "pm-future",
    auto_send_after: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  }));

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status } = await req(server, "POST", "/recruiter/rec-tok-demo-001/queue/pm-future/send-now");
    assert.equal(status, 200);

    const due = await store.getPlannedMessagesDue(new Date());
    const found = due.find((m) => m.planned_message_id === "pm-future");
    assert.ok(found, "message should be immediately due after send-now");
  } finally {
    server.close();
  }
});

// ─── Test 15 ──────────────────────────────────────────────────────────────────
test("moderation: GET /recruiter/:token serves HTML page with Content-Type text/html", async () => {
  const store = new InMemoryHiringStore(seed);
  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body, contentType } = await req(server, "GET", "/recruiter/rec-tok-demo-001");
    assert.equal(status, 200);
    assert.ok(contentType?.includes("text/html"), `Expected text/html, got: ${contentType}`);
    assert.ok(typeof body === "string" && body.includes("<!DOCTYPE html>"), "Response body should be HTML");
  } finally {
    server.close();
  }
});
