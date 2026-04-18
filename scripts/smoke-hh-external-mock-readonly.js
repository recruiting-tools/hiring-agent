#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FakeLlmAdapter } from "../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../services/candidate-chatbot/src/handlers.js";
import { createHhRuntime } from "../services/candidate-chatbot/src/hh-runtime.js";
import { InMemoryHiringStore } from "../services/candidate-chatbot/src/store.js";

const baseUrl = String(process.env.HH_EXTERNAL_MOCK_BASE_URL ?? process.env.HH_API_BASE_URL ?? "")
  .trim()
  .replace(/\/$/, "");
const bearerToken = String(process.env.HH_EXTERNAL_MOCK_BEARER_TOKEN ?? "mock_access_token");

if (!baseUrl) {
  console.error("HH_EXTERNAL_MOCK_BASE_URL or HH_API_BASE_URL is required");
  process.exit(1);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${bearerToken}`,
    "Content-Type": "application/json"
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function createVacancy(body) {
  const { response, payload } = await api("/_mock/vacancies", {
    method: "POST",
    body
  });
  assert.equal(response.status, 201, `expected vacancy creation 201, got ${response.status}`);
  assert.ok(payload.vacancy_id, "vacancy_id missing");
  assert.ok(Array.isArray(payload.negotiation_ids), "negotiation_ids missing");
  return payload;
}

function buildOverride(nextMessage) {
  return {
    step_result: "needs_clarification",
    completed_step_ids: [],
    rejected_step_id: null,
    extracted_facts: {},
    missing_information: ["experience_scope"],
    next_message: nextMessage,
    confidence: 0.9,
    guard_flags: []
  };
}

function forceDuePollState(store, hhNegotiationId) {
  return store.getHhPollState(hhNegotiationId).then((pollState) => {
    assert.ok(pollState, `expected poll state for ${hhNegotiationId}`);
    return store.upsertHhPollState(hhNegotiationId, {
      ...pollState,
      next_poll_at: new Date(Date.now() - 1_000).toISOString()
    });
  });
}

async function assertRemoteApplicantOnlyThread(negotiationId) {
  const { response, payload } = await api(`/negotiations/${negotiationId}/messages`);
  assert.equal(response.status, 200, `expected messages endpoint 200, got ${response.status}`);
  assert.ok(Array.isArray(payload.items), "messages payload missing items");
  assert.equal(payload.items.length, 1, `expected exactly one remote inbound message for ${negotiationId}`);
  assert.equal(
    payload.items[0]?.author?.participant_type,
    "applicant",
    `expected only applicant-authored messages for ${negotiationId}`
  );
}

async function main() {
  const seed = JSON.parse(
    await readFile(new URL("../tests/fixtures/iteration-1-seed.json", import.meta.url), "utf8")
  );

  const immediateVacancy = await createVacancy({
    vacancy_text: "Закупщик Китай\nПрямые закупки у фабрик, 1688 и WeChat",
    candidate_count: 2,
    ttl_seconds: 10800,
    initial_reply_delay_sec: 0,
    follow_up_delay_sec: 1
  });
  const delayedVacancy = await createVacancy({
    vacancy_text: "B2B Sales Manager\nДлинный цикл сделки, промышленный продукт",
    candidate_count: 1,
    ttl_seconds: 10800,
    initial_reply_delay_sec: 2,
    follow_up_delay_sec: 1
  });

  const overrides = Object.fromEntries([
    ...immediateVacancy.negotiation_ids.map((id) => [
      `conv-hh-${id}`,
      buildOverride("Подскажите, пожалуйста, с какими категориями товаров вы работали и какой у вас был объём закупок?")
    ]),
    ...delayedVacancy.negotiation_ids.map((id) => [
      `conv-hh-${id}`,
      buildOverride("Подскажите, пожалуйста, был ли у вас именно B2B-опыт и какой обычно был средний чек по сделкам?")
    ])
  ]);

  const store = new InMemoryHiringStore(seed);
  await store.setHhOAuthTokens("hh", {
    access_token: bearerToken,
    refresh_token: "mock_refresh_token",
    token_type: "bearer",
    expires_at: "2099-01-01T00:00:00.000Z"
  });

  const llmAdapter = new FakeLlmAdapter(overrides);
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const runtime = await createHhRuntime({
    store,
    chatbot,
    env: {
      HH_CLIENT_ID: "mock-client-id",
      HH_CLIENT_SECRET: "mock-client-secret",
      HH_REDIRECT_URI: "https://example.test/hh-callback/",
      HH_API_BASE_URL: baseUrl
    }
  });

  assert.equal(store.getPendingQueue().items.length, 0, "expected empty pending queue before import");

  const vacancyMappings = [
    {
      hh_vacancy_id: immediateVacancy.vacancy_id,
      job_id: "job-zakup-china",
      collections: ["response", "phone_interview"]
    },
    {
      hh_vacancy_id: delayedVacancy.vacancy_id,
      job_id: "job-b2b-sales-manager",
      collections: ["response", "phone_interview"]
    }
  ];
  const windowStart = new Date(Date.now() - 5 * 60_000).toISOString();

  const firstImport = await runtime.hhImportRunner.syncApplicants({
    windowStart,
    windowEnd: new Date().toISOString(),
    vacancyMappings
  });

  assert.equal(firstImport.imported_collections, 4, "expected two mappings across two collections");
  assert.equal(firstImport.imported_negotiations, 2, "expected only immediate vacancy negotiations on first import");
  assert.equal(firstImport.imported_messages, 2, "expected two imported inbound messages on first import");

  for (const negotiationId of immediateVacancy.negotiation_ids) {
    const importedNegotiation = await store.findHhNegotiation(negotiationId);
    assert.ok(importedNegotiation, `expected imported negotiation ${negotiationId}`);
    assert.equal(importedNegotiation.job_id, "job-zakup-china");
    assert.equal(store.getHistory(`conv-hh-${negotiationId}`).length, 1, "expected imported thread history before poll");
  }
  for (const negotiationId of delayedVacancy.negotiation_ids) {
    const importedNegotiation = await store.findHhNegotiation(negotiationId);
    assert.equal(importedNegotiation, null, `did not expect delayed negotiation ${negotiationId} on first import`);
  }

  const immediateRemoteList = await api(`/negotiations/response?vacancy_id=${immediateVacancy.vacancy_id}`);
  const delayedRemoteList = await api(`/negotiations/response?vacancy_id=${delayedVacancy.vacancy_id}`);
  assert.equal(immediateRemoteList.response.status, 200);
  assert.equal(delayedRemoteList.response.status, 200);
  assert.equal(immediateRemoteList.payload.items.length, 2, "expected two remote response negotiations for immediate vacancy");
  assert.equal(delayedRemoteList.payload.items.length, 1, "expected one remote response negotiation for delayed vacancy");

  await Promise.all(immediateVacancy.negotiation_ids.map((id) => forceDuePollState(store, id)));
  const dueBeforePollAll = await store.getHhNegotiationsDue();
  assert.equal(dueBeforePollAll.length, 2, "expected two due negotiations before pollAll");
  const pollAllResult = await runtime.hhPollRunner.pollAll();
  assert.deepEqual(pollAllResult, { polled: "all_due" }, "expected endpoint-style pollAll result");

  const pendingAfterPollAll = store.getPendingQueue();
  assert.equal(pendingAfterPollAll.items.length, 2, "expected two planned messages after pollAll");
  assert.deepEqual(
    new Set(pendingAfterPollAll.items.map((item) => item.conversation_id)),
    new Set(immediateVacancy.negotiation_ids.map((id) => `conv-hh-${id}`)),
    "expected planned messages only for immediate vacancy conversations"
  );

  for (const negotiationId of immediateVacancy.negotiation_ids) {
    const history = store.getHistory(`conv-hh-${negotiationId}`);
    assert.equal(history.length, 2, `expected imported + webhook inbound messages for ${negotiationId}`);
    assert.ok(history.every((message) => message.direction === "inbound"), `expected no local outbound in ${negotiationId}`);
    await assertRemoteApplicantOnlyThread(negotiationId);
  }

  assert.equal(store.messages.filter((message) => message.direction === "outbound").length, 0, "expected no outbound messages locally");
  assert.equal(store.deliveryAttempts.length, 0, "expected no delivery attempts without send path");

  await sleep(2200);

  const secondImport = await runtime.hhImportRunner.syncApplicants({
    windowStart,
    windowEnd: new Date().toISOString(),
    vacancyMappings
  });

  assert.equal(secondImport.imported_collections, 4, "expected second import to scan the same collections");
  assert.equal(secondImport.imported_negotiations, 1, "expected delayed negotiation to import on second pass");
  assert.equal(secondImport.imported_messages, 1, "expected exactly one newly imported delayed inbound");

  const delayedNegotiationId = delayedVacancy.negotiation_ids[0];
  const delayedNegotiation = await store.findHhNegotiation(delayedNegotiationId);
  assert.ok(delayedNegotiation, "expected delayed negotiation to be imported on second pass");
  assert.equal(delayedNegotiation.job_id, "job-b2b-sales-manager");
  assert.equal(store.getHistory(`conv-hh-${delayedNegotiationId}`).length, 1, "expected delayed thread imported before poll");

  const pollSingleResult = await runtime.hhImportRunner.pollNegotiation(delayedNegotiationId);
  assert.equal(pollSingleResult.processed, true, "expected pollNegotiation to succeed");
  assert.equal(pollSingleResult.new_messages, 1, "expected delayed negotiation to produce one inbound message");

  const pendingAfterDelayedPoll = store.getPendingQueue();
  assert.equal(pendingAfterDelayedPoll.items.length, 3, "expected third planned message after delayed poll");
  assert.ok(
    pendingAfterDelayedPoll.items.some((item) => item.conversation_id === `conv-hh-${delayedNegotiationId}`),
    "expected delayed conversation to enter pending queue"
  );

  const delayedHistory = store.getHistory(`conv-hh-${delayedNegotiationId}`);
  assert.equal(delayedHistory.length, 2, "expected imported + webhook inbound messages for delayed negotiation");
  assert.ok(delayedHistory.every((message) => message.direction === "inbound"), "expected delayed thread to stay read-only");
  await assertRemoteApplicantOnlyThread(delayedNegotiationId);

  console.log("External HH mock read-only smoke passed.");
  console.log(JSON.stringify({
    immediate_vacancy_id: immediateVacancy.vacancy_id,
    delayed_vacancy_id: delayedVacancy.vacancy_id,
    first_import: {
      imported_negotiations: firstImport.imported_negotiations,
      imported_messages: firstImport.imported_messages
    },
    poll_all: {
      due_count: dueBeforePollAll.length,
      result: pollAllResult.polled
    },
    second_import: {
      imported_negotiations: secondImport.imported_negotiations,
      imported_messages: secondImport.imported_messages
    },
    pending_messages: pendingAfterDelayedPoll.items.length
  }, null, 2));
}

main().catch((error) => {
  console.error(`External HH mock read-only smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
