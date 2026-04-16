import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FakeLlmAdapter } from "../../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../../services/candidate-chatbot/src/handlers.js";
import { InMemoryHiringStore } from "../../services/candidate-chatbot/src/store.js";
import { FakeHhClient } from "../../services/hh-connector/src/hh-client.js";
import { CronSender } from "../../services/hh-connector/src/cron-sender.js";
import { reconcileSentHhMessage, sendHHWithGuard } from "../../services/hh-connector/src/send-guard.js";

const seed = JSON.parse(await readFile(new URL("../fixtures/iteration-1-seed.json", import.meta.url), "utf8"));

async function makeRuntimeWithNegotiation() {
  const store = new InMemoryHiringStore(seed);
  const hhClient = new FakeHhClient();

  await store.upsertHhNegotiation({
    hh_negotiation_id: "neg-001",
    job_id: "job-zakup-china",
    candidate_id: "cand-zakup-good",
    hh_vacancy_id: "hh-vac-001",
    hh_collection: "response",
    channel_thread_id: "conv-zakup-001"
  });
  hhClient.addNegotiation("neg-001", []);

  const cronSender = new CronSender({ store, hhClient });
  return { store, hhClient, cronSender };
}

function makePlannedMessage(overrides = {}) {
  return {
    planned_message_id: "pm-test-001",
    conversation_id: "conv-zakup-001",
    candidate_id: "cand-zakup-good",
    pipeline_run_id: "run-zakup-001",
    step_id: "direct_china_suppliers",
    body: "Расскажите подробнее о вашем опыте",
    reason: "test",
    review_status: "pending",
    moderation_policy: "window_to_reject",
    auto_send_after: new Date(Date.now() - 1000).toISOString(), // already past
    sent_at: null,
    channel_thread_id: "conv-zakup-001",
    ...overrides
  };
}

test("cron sender: tick sends message when auto_send_after has passed", async () => {
  const { store, hhClient, cronSender } = await makeRuntimeWithNegotiation();

  // Add a planned message that's past its auto_send_after
  const pm = makePlannedMessage({ auto_send_after: new Date(Date.now() - 5000).toISOString() });
  store.plannedMessages.push(pm);

  const results = await cronSender.tick();

  assert.equal(hhClient.sentCount(), 1);
  assert.equal(hhClient.lastSent().text, pm.body);
  assert.ok(results.some((r) => r.planned_message_id === pm.planned_message_id && r.sent === true));
});

test("cron sender: tick does not send message before auto_send_after", async () => {
  const { store, hhClient, cronSender } = await makeRuntimeWithNegotiation();

  const pm = makePlannedMessage({ auto_send_after: new Date(Date.now() + 60_000).toISOString() });
  store.plannedMessages.push(pm);

  await cronSender.tick();

  assert.equal(hhClient.sentCount(), 0);
});

test("cron sender: tick skips messages with review_status=blocked", async () => {
  const { store, hhClient, cronSender } = await makeRuntimeWithNegotiation();

  const pm = makePlannedMessage({
    auto_send_after: new Date(Date.now() - 1000).toISOString(),
    review_status: "blocked"
  });
  store.plannedMessages.push(pm);

  await cronSender.tick();

  assert.equal(hhClient.sentCount(), 0);
});

test("cron sender: tick skips planned_message with no matching hh_negotiation", async () => {
  const store = new InMemoryHiringStore(seed);
  const hhClient = new FakeHhClient();
  const cronSender = new CronSender({ store, hhClient });

  // No negotiation seeded for this conversation
  const pm = makePlannedMessage({ auto_send_after: new Date(Date.now() - 1000).toISOString() });
  store.plannedMessages.push(pm);

  const results = await cronSender.tick();

  assert.equal(hhClient.sentCount(), 0);
  assert.ok(results.some((r) => r.skipped === true && r.reason === "no_negotiation"));
});

test("cron sender: sendHHWithGuard records delivery_attempt with status=delivered on success", async () => {
  const { store, hhClient } = await makeRuntimeWithNegotiation();
  const pm = makePlannedMessage();

  await sendHHWithGuard({
    store,
    hhClient,
    plannedMessage: pm,
    hhNegotiationId: "neg-001"
  });

  const attempt = await store.getSuccessfulDeliveryAttempt(pm.planned_message_id);
  assert.ok(attempt, "Should have a successful delivery attempt");
  assert.equal(attempt.status, "delivered");
  assert.ok(attempt.hh_message_id);
});

test("cron sender: sendHHWithGuard returns duplicate=true when already delivered (idempotency)", async () => {
  const { store, hhClient } = await makeRuntimeWithNegotiation();
  const pm = makePlannedMessage();

  // First call
  const result1 = await sendHHWithGuard({
    store,
    hhClient,
    plannedMessage: pm,
    hhNegotiationId: "neg-001"
  });
  assert.equal(result1.sent, true);
  assert.equal(hhClient.sentCount(), 1);

  // Second call with same planned_message_id
  const result2 = await sendHHWithGuard({
    store,
    hhClient,
    plannedMessage: pm,
    hhNegotiationId: "neg-001"
  });
  assert.equal(result2.sent, false);
  assert.equal(result2.duplicate, true);
  assert.equal(hhClient.sentCount(), 1, "HH API must not be called a second time");
});

test("cron sender: sendHHWithGuard records failed attempt and returns error when HH throws", async () => {
  const { store, hhClient } = await makeRuntimeWithNegotiation();
  const pm = makePlannedMessage();

  // Make hhClient.sendMessage throw
  hhClient.sendMessage = async () => { throw new Error("HH API unavailable"); };

  const result = await sendHHWithGuard({
    store,
    hhClient,
    plannedMessage: pm,
    hhNegotiationId: "neg-001"
  });

  assert.equal(result.sent, false);
  assert.ok(result.error);

  // Check that a failed attempt was recorded
  const attempt = store.deliveryAttempts.find((a) => a.planned_message_id === pm.planned_message_id);
  assert.ok(attempt);
  assert.equal(attempt.status, "failed");
  assert.ok(attempt.error_body);
});

test("cron sender: tick sets sent_at on planned_message after successful delivery", async () => {
  const { store, hhClient, cronSender } = await makeRuntimeWithNegotiation();

  const pm = makePlannedMessage({ auto_send_after: new Date(Date.now() - 1000).toISOString() });
  store.plannedMessages.push(pm);

  await cronSender.tick();

  const updated = store.plannedMessages.find((m) => m.planned_message_id === pm.planned_message_id);
  assert.ok(updated.sent_at, "sent_at should be set after delivery");
});

test("cron sender: tick sets review_status=sent on planned_message after successful delivery", async () => {
  const { store, hhClient, cronSender } = await makeRuntimeWithNegotiation();

  const pm = makePlannedMessage({ auto_send_after: new Date(Date.now() - 1000).toISOString() });
  store.plannedMessages.push(pm);

  await cronSender.tick();

  const updated = store.plannedMessages.find((m) => m.planned_message_id === pm.planned_message_id);
  assert.equal(updated.review_status, "sent");
});

test("cron sender: sendHHWithGuard mirrors outbound HH message into history immediately", async () => {
  const { store, hhClient } = await makeRuntimeWithNegotiation();
  const pm = makePlannedMessage();
  store.plannedMessages.push(pm);

  const result = await sendHHWithGuard({
    store,
    hhClient,
    plannedMessage: pm,
    hhNegotiationId: "neg-001"
  });

  const updated = store.plannedMessages.find((m) => m.planned_message_id === pm.planned_message_id);
  assert.equal(updated.review_status, "sent");
  assert.equal(updated.hh_message_id, result.hh_message_id);

  const outbound = store.messages.find(
    (message) => message.conversation_id === pm.conversation_id && message.channel_message_id === result.hh_message_id
  );
  assert.ok(outbound, "outbound HH message should appear in local conversation history immediately");
  assert.equal(outbound.direction, "outbound");
  assert.equal(outbound.body, pm.body);

  const pollState = await store.getHhPollState("neg-001");
  assert.equal(pollState.awaiting_reply, true);
  assert.equal(pollState.last_sender, "employer");
});

test("reconcileSentHhMessage creates idempotent local state for direct HH sends", async () => {
  const { store } = await makeRuntimeWithNegotiation();
  const pm = makePlannedMessage({ planned_message_id: "pm-direct-001" });
  store.plannedMessages.push(pm);

  await reconcileSentHhMessage({
    store,
    plannedMessage: pm,
    hhNegotiationId: "neg-001",
    hhMessageId: "hh-direct-001",
    sentAt: "2026-04-17T09:00:00.000Z"
  });
  await reconcileSentHhMessage({
    store,
    plannedMessage: pm,
    hhNegotiationId: "neg-001",
    hhMessageId: "hh-direct-001",
    sentAt: "2026-04-17T09:00:00.000Z"
  });

  const deliveredAttempts = store.deliveryAttempts.filter(
    (attempt) => attempt.planned_message_id === pm.planned_message_id && attempt.status === "delivered"
  );
  assert.equal(deliveredAttempts.length, 1);
  assert.equal(deliveredAttempts[0].hh_message_id, "hh-direct-001");

  const updated = store.plannedMessages.find((m) => m.planned_message_id === pm.planned_message_id);
  assert.equal(updated.review_status, "sent");
  assert.equal(updated.hh_message_id, "hh-direct-001");

  const outboundMessages = store.messages.filter(
    (message) => message.conversation_id === pm.conversation_id && message.channel_message_id === "hh-direct-001"
  );
  assert.equal(outboundMessages.length, 1);
  assert.equal(outboundMessages[0].direction, "outbound");
});

test("send guard: concurrent sends deliver exactly once", async () => {
  const { store, hhClient } = await makeRuntimeWithNegotiation();
  const pm = makePlannedMessage();

  const [result1, result2] = await Promise.all([
    sendHHWithGuard({ store, hhClient, plannedMessage: pm, hhNegotiationId: "neg-001" }),
    sendHHWithGuard({ store, hhClient, plannedMessage: pm, hhNegotiationId: "neg-001" })
  ]);

  const sentCount = [result1, result2].filter((r) => r.sent === true).length;
  assert.equal(sentCount, 1, "Exactly one send should succeed");

  const delivered = store.deliveryAttempts.filter(
    (a) => a.planned_message_id === pm.planned_message_id && a.status === "delivered"
  );
  assert.equal(delivered.length, 1, "Exactly one delivered attempt should exist");

  assert.equal(hhClient.sentCount(), 1, "HH API must be called exactly once");
});

test("alert: getAwaitingReplyStaleConversations returns negotiation when awaiting_reply=true and last sent > 2h ago", async () => {
  const { store } = await makeRuntimeWithNegotiation();

  // Set poll state: awaiting_reply=true
  await store.upsertHhPollState("neg-001", {
    last_polled_at: new Date().toISOString(),
    hh_updated_at: new Date().toISOString(),
    last_sender: "employer",
    awaiting_reply: true,
    next_poll_at: new Date(Date.now() + 60_000).toISOString()
  });

  // Add a delivered outbound message 3 hours ago
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  store.deliveryAttempts.push({
    attempt_id: "att-001",
    planned_message_id: "pm-old",
    hh_negotiation_id: "neg-001",
    status: "delivered",
    hh_message_id: "hh-m-001",
    attempted_at: threeHoursAgo,
    error_body: null
  });

  const stale = await store.getAwaitingReplyStaleConversations(120); // 120 minutes
  assert.equal(stale.length, 1);
  assert.equal(stale[0].hh_negotiation_id, "neg-001");
  assert.ok(stale[0].awaiting_since_minutes >= 120);
});

test("alert: getAwaitingReplyStaleConversations does not return negotiation when last sent < 2h ago", async () => {
  const { store } = await makeRuntimeWithNegotiation();

  await store.upsertHhPollState("neg-001", {
    last_polled_at: new Date().toISOString(),
    hh_updated_at: new Date().toISOString(),
    last_sender: "employer",
    awaiting_reply: true,
    next_poll_at: new Date(Date.now() + 60_000).toISOString()
  });

  // Add a delivered outbound message only 30 minutes ago
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  store.deliveryAttempts.push({
    attempt_id: "att-002",
    planned_message_id: "pm-recent",
    hh_negotiation_id: "neg-001",
    status: "delivered",
    hh_message_id: "hh-m-002",
    attempted_at: thirtyMinAgo,
    error_body: null
  });

  const stale = await store.getAwaitingReplyStaleConversations(120);
  assert.equal(stale.length, 0, "Should not return negotiation when last message was < 2h ago");
});

test("send guard: stale sending attempt is treated as failed and retried", async () => {
  const { store, hhClient } = await makeRuntimeWithNegotiation();
  const pm = makePlannedMessage();
  store.plannedMessages.push(pm);

  store.deliveryAttempts.push({
    attempt_id: "attempt-stale-send",
    planned_message_id: pm.planned_message_id,
    hh_negotiation_id: "neg-001",
    status: "sending",
    hh_message_id: null,
    attempted_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    error_body: null,
    retry_count: 0,
    next_retry_at: null
  });

  const result = await sendHHWithGuard({
    store,
    hhClient,
    plannedMessage: pm,
    hhNegotiationId: "neg-001"
  });

  assert.equal(result.sent, true);
  assert.equal(hhClient.sentCount(), 1);
  const latest = store.deliveryAttempts.at(-1);
  assert.equal(latest.status, "delivered");
});

test("send guard: retryable failures follow bounded retry schedule and hit DLQ after max", async () => {
  const { store, hhClient } = await makeRuntimeWithNegotiation();
  const pm = makePlannedMessage();
  store.plannedMessages.push(pm);

  let callCount = 0;
  const error = new Error("temporary hh glitch");
  error.status = 503;
  hhClient.sendMessage = async () => {
    callCount += 1;
    throw error;
  };

  let finalResult = null;
  for (let i = 0; i < 10; i += 1) {
    const result = await sendHHWithGuard({
      store,
      hhClient,
      plannedMessage: pm,
      hhNegotiationId: "neg-001"
    });
    if (result.retry_after) {
      const attempts = await store.getDeliveryAttempts(pm.planned_message_id);
      const latest = attempts[0];
      if (!latest || latest.status !== "failed") {
        break;
      }
      latest.next_retry_at = new Date(Date.now() - 1000).toISOString();
    }
    finalResult = result;
    if (result.dlq) break;
  }

  assert.ok(finalResult);
  assert.equal(finalResult.dlq, true);
  const updated = store.plannedMessages.find((m) => m.planned_message_id === pm.planned_message_id);
  assert.equal(updated.review_status, "blocked");
  assert.ok(callCount >= 5, "Should retry up to bounded limit");
  assert.equal(callCount, 5);
  const failed = store.deliveryAttempts.filter((attempt) => attempt.status === "failed");
  assert.equal(failed.length >= 5, true);
});
