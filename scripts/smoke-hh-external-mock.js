#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FakeLlmAdapter } from "../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../services/candidate-chatbot/src/handlers.js";
import { InMemoryHiringStore } from "../services/candidate-chatbot/src/store.js";
import { createHhRuntime } from "../services/candidate-chatbot/src/hh-runtime.js";

const baseUrl = String(process.env.HH_EXTERNAL_MOCK_BASE_URL ?? process.env.HH_API_BASE_URL ?? "").trim().replace(/\/$/, "");
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

async function main() {
  const seed = JSON.parse(
    await readFile(new URL("../tests/fixtures/iteration-1-seed.json", import.meta.url), "utf8")
  );

  const { response: createResponse, payload: created } = await api("/_mock/vacancies", {
    method: "POST",
    body: {
      vacancy_text: "Senior Recruiter\nНужен рекрутер для AI и product ролей",
      candidate_count: 1,
      ttl_seconds: 10800,
      initial_reply_delay_sec: 0,
      follow_up_delay_sec: 1
    }
  });

  assert.equal(createResponse.status, 201, `expected vacancy creation 201, got ${createResponse.status}`);
  assert.ok(created.vacancy_id, "vacancy_id missing");
  assert.equal(created.negotiation_ids.length, 1, "expected exactly one negotiation for smoke");

  const negotiationId = created.negotiation_ids[0];
  const conversationId = `conv-hh-${negotiationId}`;

  const store = new InMemoryHiringStore(seed);
  await store.setHhOAuthTokens("hh", {
    access_token: bearerToken,
    refresh_token: "mock_refresh_token",
    token_type: "bearer",
    expires_at: "2099-01-01T00:00:00.000Z"
  });

  const llmAdapter = new FakeLlmAdapter({
    [conversationId]: {
      step_result: "needs_clarification",
      completed_step_ids: [],
      rejected_step_id: null,
      extracted_facts: {},
      missing_information: ["experience_scope"],
      next_message: "Уточните, пожалуйста, какие вакансии вы закрывали в последние 12 месяцев и с каким SLA работали?",
      confidence: 0.9,
      guard_flags: []
    }
  });
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

  const imported = await runtime.hhImportRunner.syncApplicants({
    windowStart: new Date(Date.now() - 5 * 60_000).toISOString(),
    vacancyMappings: [{
      hh_vacancy_id: created.vacancy_id,
      job_id: "job-zakup-china"
    }]
  });

  assert.equal(imported.imported_negotiations, 1, "expected one imported negotiation");

  const importedNegotiation = await store.findHhNegotiation(negotiationId);
  assert.ok(importedNegotiation, "negotiation was not imported into store");

  await runtime.hhImportRunner.pollNegotiation(negotiationId);

  const planned = await store.getPendingQueue();
  const plannedMessage = planned.items.find((item) => item.conversation_id === conversationId);
  assert.ok(plannedMessage, "expected a planned outbound message after first poll");

  await store.approveAndSendNow(plannedMessage.planned_message_id);
  const sendResult = await runtime.hhSendRunner.sendDue();
  assert.equal(sendResult.sent, 1, "expected one outbound HH send");

  await sleep(1200);
  await runtime.hhPollRunner.pollAll();

  const threadMessages = store.messages.filter((message) => message.conversation_id === conversationId);
  assert.ok(threadMessages.length >= 3, `expected at least 3 messages in thread, got ${threadMessages.length}`);
  assert.equal(threadMessages.at(-1).direction, "inbound", "expected latest message to be inbound applicant reply");

  const { response: messagesResponse, payload: messagesPayload } = await api(`/negotiations/${negotiationId}/messages`);
  assert.equal(messagesResponse.status, 200, `expected messages endpoint 200, got ${messagesResponse.status}`);
  assert.ok(messagesPayload.items.length >= 3, "expected external mock thread to contain inbound, outbound, inbound");

  console.log("External HH mock smoke passed.");
  console.log(JSON.stringify({
    vacancy_id: created.vacancy_id,
    negotiation_id: negotiationId,
    imported_messages: threadMessages.length,
    sent: sendResult.sent
  }, null, 2));
}

main().catch((error) => {
  console.error(`External HH mock smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
