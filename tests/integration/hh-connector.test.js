import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FakeLlmAdapter } from "../../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../../services/candidate-chatbot/src/handlers.js";
import { InMemoryHiringStore } from "../../services/candidate-chatbot/src/store.js";
import { FakeHhClient } from "../../services/hh-connector/src/hh-client.js";
import { HhContractMock, loadHhFixtureLibrary } from "../../services/hh-connector/src/hh-contract-mock.js";
import { HhConnector } from "../../services/hh-connector/src/hh-connector.js";

const seed = JSON.parse(await readFile(new URL("../fixtures/iteration-1-seed.json", import.meta.url), "utf8"));

function makeRuntime() {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = new FakeHhClient();
  const connector = new HhConnector({ store, hhClient, chatbot });
  return { store, llmAdapter, chatbot, hhClient, connector };
}

async function seedNegotiation(store, overrides = {}) {
  return store.upsertHhNegotiation({
    hh_negotiation_id: "neg-001",
    job_id: "job-zakup-china",
    candidate_id: "cand-zakup-good",
    hh_vacancy_id: "hh-vac-001",
    hh_collection: "response",
    channel_thread_id: "conv-zakup-001",
    ...overrides
  });
}

test("hh connector: pollNegotiation writes inbound message to chatbot.messages when applicant sends", async () => {
  const { store, hhClient, connector } = makeRuntime();
  await seedNegotiation(store);
  hhClient.addNegotiation("neg-001", [
    { id: "m1", author: "applicant", text: "Привет, интересует вакансия", created_at: "2026-04-12T10:00:00Z" }
  ]);

  await connector.pollNegotiation("neg-001");

  const messages = store.messages.filter((m) => m.conversation_id === "conv-zakup-001");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].direction, "inbound");
  assert.equal(messages[0].body, "Привет, интересует вакансия");
  assert.equal(messages[0].channel, "hh");
  assert.equal(messages[0].channel_message_id, "m1");
});

test("hh connector: pollNegotiation triggers chatbot pipeline (creates planned_message) for new applicant message", async () => {
  const { store, hhClient, connector } = makeRuntime();
  await seedNegotiation(store);
  hhClient.addNegotiation("neg-001", [
    { id: "m1", author: "applicant", text: "8 лет закупаю из Китая напрямую с фабрик", created_at: "2026-04-12T10:00:00Z" }
  ]);

  await connector.pollNegotiation("neg-001");

  const planned = store.plannedMessages.filter((pm) => pm.conversation_id === "conv-zakup-001");
  assert.ok(planned.length >= 1, "Should have at least one planned message");
  assert.equal(planned[0].review_status, "pending");
});

test("hh connector: pollNegotiation is idempotent — duplicate poll does not create duplicate inbound message", async () => {
  const { store, hhClient, connector } = makeRuntime();
  await seedNegotiation(store);
  hhClient.addNegotiation("neg-001", [
    { id: "m1", author: "applicant", text: "Привет", created_at: "2026-04-12T10:00:00Z" }
  ]);

  await connector.pollNegotiation("neg-001");
  await connector.pollNegotiation("neg-001");

  const messages = store.messages.filter((m) => m.conversation_id === "conv-zakup-001" && m.channel_message_id === "m1");
  assert.equal(messages.length, 1, "Duplicate poll must not create duplicate messages");
});

test("hh connector: pollNegotiation sorts messages by created_at before determining last_sender", async () => {
  const { store, hhClient, connector } = makeRuntime();
  await seedNegotiation(store);
  // Messages deliberately out of order (employer last by timestamp, but first in array)
  hhClient.addNegotiation("neg-001", [
    { id: "m2", author: "employer", text: "reply", created_at: "2026-04-12T10:01:00Z" },
    { id: "m1", author: "applicant", text: "hello", created_at: "2026-04-12T10:00:00Z" }
  ]);

  await connector.pollNegotiation("neg-001");

  const pollState = await store.getHhPollState("neg-001");
  // Last message by created_at is employer → awaiting_reply=true
  assert.equal(pollState.last_sender, "employer");
  assert.equal(pollState.awaiting_reply, true);
});

test("hh connector: pollNegotiation sets awaiting_reply=true when employer sent last", async () => {
  const { store, hhClient, connector } = makeRuntime();
  await seedNegotiation(store);
  hhClient.addNegotiation("neg-001", [
    { id: "m1", author: "applicant", text: "Привет", created_at: "2026-04-12T10:00:00Z" },
    { id: "m2", author: "employer", text: "Здравствуйте", created_at: "2026-04-12T10:01:00Z" }
  ]);

  await connector.pollNegotiation("neg-001");

  const pollState = await store.getHhPollState("neg-001");
  assert.equal(pollState.awaiting_reply, true);
  assert.equal(pollState.last_sender, "employer");
});

test("hh connector: pollNegotiation sets awaiting_reply=false after applicant message", async () => {
  const { store, hhClient, connector } = makeRuntime();
  await seedNegotiation(store);
  hhClient.addNegotiation("neg-001", [
    { id: "m1", author: "employer", text: "Здравствуйте", created_at: "2026-04-12T10:00:00Z" },
    { id: "m2", author: "applicant", text: "Добрый день!", created_at: "2026-04-12T10:01:00Z" }
  ]);

  await connector.pollNegotiation("neg-001");

  const pollState = await store.getHhPollState("neg-001");
  assert.equal(pollState.awaiting_reply, false);
  assert.equal(pollState.last_sender, "applicant");
});

test("hh connector: pollAll only polls negotiations where next_poll_at <= now", async () => {
  const { store, hhClient, connector } = makeRuntime();

  // Negotiation 1: due now (next_poll_at in the past)
  await store.upsertHhNegotiation({
    hh_negotiation_id: "neg-due",
    job_id: "job-zakup-china",
    candidate_id: "cand-zakup-good",
    hh_vacancy_id: "hh-vac-001",
    hh_collection: "response",
    channel_thread_id: "conv-zakup-001"
  });
  await store.upsertHhPollState("neg-due", {
    last_polled_at: null,
    hh_updated_at: null,
    last_sender: null,
    awaiting_reply: false,
    next_poll_at: new Date(Date.now() - 1000).toISOString() // in the past
  });

  // Negotiation 2: not due yet (next_poll_at in the future)
  await store.upsertHhNegotiation({
    hh_negotiation_id: "neg-future",
    job_id: "job-cook-hot-shop",
    candidate_id: "cand-cook-reject",
    hh_vacancy_id: "hh-vac-002",
    hh_collection: "response",
    channel_thread_id: "conv-cook-001"
  });
  await store.upsertHhPollState("neg-future", {
    last_polled_at: null,
    hh_updated_at: null,
    last_sender: null,
    awaiting_reply: false,
    next_poll_at: new Date(Date.now() + 60_000).toISOString() // in the future
  });

  hhClient.addNegotiation("neg-due", [
    { id: "m1", author: "applicant", text: "Привет", created_at: "2026-04-12T10:00:00Z" }
  ]);
  hhClient.addNegotiation("neg-future", []);

  await connector.pollAll();

  // Only neg-due should have been polled → poll state updated
  const dueState = await store.getHhPollState("neg-due");
  assert.ok(dueState.last_polled_at, "neg-due should have been polled");

  // neg-future should have its poll state unchanged (next_poll_at still in the future)
  const futureMessages = store.messages.filter((m) => m.conversation_id === "conv-cook-001");
  assert.equal(futureMessages.length, 0, "neg-future should not have been polled");
});

test("hh contract mock: fixture library loads manifest and reversed messages fixture", async () => {
  const library = await loadHhFixtureLibrary();

  assert.equal(library.manifest.schema_version, 1);
  assert.ok(library.fixtures.has("negotiations.messages.reversed"));
  assert.deepEqual(
    library.fixtures.get("negotiations.messages.reversed").body.items.map((item) => item.id),
    ["m2", "m1"]
  );
});

test("hh contract mock: listNegotiations paginates and preserves same resume_id across vacancy ids", async () => {
  const hhClient = await HhContractMock.create();
  hhClient.seedResume({ id: "resume-shared", title: "Shared resume" });
  hhClient.addNegotiation("neg-a", [], {
    hh_vacancy_id: "vac-001",
    collection: "response",
    updated_at: "2026-04-12T10:00:00Z",
    resume: { id: "resume-shared", url: "https://api.hh.ru/resumes/resume-shared" },
    vacancy: { id: "vac-001", name: "Закупщик" }
  });
  hhClient.addNegotiation("neg-b", [], {
    hh_vacancy_id: "vac-002",
    collection: "response",
    updated_at: "2026-04-12T11:00:00Z",
    resume: { id: "resume-shared", url: "https://api.hh.ru/resumes/resume-shared" },
    vacancy: { id: "vac-002", name: "Продажи" }
  });
  hhClient.addNegotiation("neg-c", [], {
    hh_vacancy_id: "vac-003",
    collection: "response",
    updated_at: "2026-04-12T12:00:00Z",
    resume: { id: "resume-003", url: "https://api.hh.ru/resumes/resume-003" },
    vacancy: { id: "vac-003", name: "Операции" }
  });

  const page0 = await hhClient.listNegotiations("response", { page: 0, per_page: 2 });
  const page1 = await hhClient.listNegotiations("response", { page: 1, per_page: 2 });

  assert.equal(page0.items.length, 2);
  assert.equal(page1.items.length, 1);
  assert.equal(page0.items[0].id, "neg-c");
  assert.equal(page0.items[1].resume.id, "resume-shared");
  assert.equal(page1.items[0].resume.id, "resume-shared");
  assert.notEqual(page0.items[1].vacancy.id, page1.items[0].vacancy.id);
});

test("hh contract mock: changeState moves negotiation to another collection and updates list results", async () => {
  const hhClient = await HhContractMock.create({ now: "2026-04-12T12:05:00Z" });
  hhClient.addNegotiation("neg-001", [], {
    collection: "response",
    hh_vacancy_id: "vac-001",
    resume: { id: "resume-001", url: "https://api.hh.ru/resumes/resume-001" },
    vacancy: { id: "vac-001", name: "Закупщик" }
  });

  const result = await hhClient.changeState("phone_interview", "neg-001");
  const responseList = await hhClient.listNegotiations("response");
  const phoneList = await hhClient.listNegotiations("phone_interview");

  assert.equal(result.collection, "phone_interview");
  assert.equal(phoneList.items.length, 1);
  assert.equal(phoneList.items[0].id, "neg-001");
  assert.equal(responseList.items.length, 0);
});

test("hh contract mock: expireAccessToken causes 401 fixture-shaped error", async () => {
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-001", []);
  hhClient.expireAccessToken();

  await assert.rejects(
    hhClient.getMessages("neg-001"),
    (error) => error.status === 401 && error.code === "expired_token"
  );
});
