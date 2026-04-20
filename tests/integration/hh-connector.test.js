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

test("hh connector: pollAll skips missing HH negotiation with long backoff and continues", async () => {
  const { store, hhClient, connector } = makeRuntime();
  hhClient.getMessages = async (hhNegotiationId) => {
    if (hhNegotiationId === "neg-missing") {
      const error = new Error("HH API request failed with status 404");
      error.status = 404;
      throw error;
    }
    return [
      { id: "msg-good-1", author: "applicant", text: "Привет", created_at: "2026-04-12T10:00:00Z" }
    ];
  };

  await store.upsertHhNegotiation({
    hh_negotiation_id: "neg-missing",
    job_id: "job-zakup-china",
    candidate_id: "cand-zakup-good",
    hh_vacancy_id: "hh-vac-001",
    hh_collection: "response",
    channel_thread_id: "conv-zakup-001"
  });
  await store.upsertHhPollState("neg-missing", {
    last_polled_at: null,
    hh_updated_at: "2026-04-12T09:55:00Z",
    last_sender: "employer",
    awaiting_reply: true,
    next_poll_at: new Date(Date.now() - 1000).toISOString()
  });

  await store.upsertHhNegotiation({
    hh_negotiation_id: "neg-good",
    job_id: "job-zakup-china",
    candidate_id: "cand-zakup-good",
    hh_vacancy_id: "hh-vac-001",
    hh_collection: "response",
    channel_thread_id: "conv-zakup-001"
  });
  await store.upsertHhPollState("neg-good", {
    last_polled_at: null,
    hh_updated_at: null,
    last_sender: null,
    awaiting_reply: false,
    next_poll_at: new Date(Date.now() - 1000).toISOString()
  });

  const result = await connector.pollAll();

  assert.equal(result.due_count, 2);
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0].reason, "hh_negotiation_not_found");
  assert.equal(result.results[0].skipped, true);

  const missingState = await store.getHhPollState("neg-missing");
  assert.equal(missingState.awaiting_reply, false);
  assert.equal(missingState.last_sender, "employer");
  assert.ok(new Date(missingState.next_poll_at).getTime() > Date.now() + (29 * 24 * 60 * 60 * 1000));

  const goodState = await store.getHhPollState("neg-good");
  assert.ok(goodState.last_polled_at, "good negotiation should still be processed");
});

test("hh connector: syncApplicants imports negotiations and messages for mapped vacancies", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.seedResume({
    id: "resume-001",
    title: "Senior procurement manager",
    first_name: "Ирина",
    last_name: "Соколова",
    email: "irina@example.com"
  });
  hhClient.addNegotiation("neg-import-001", [
    { id: "msg-1", author: "applicant", text: "Добрый день", created_at: "2026-04-12T10:00:00Z" },
    { id: "msg-2", author: "employer", text: "Здравствуйте", created_at: "2026-04-12T10:05:00Z" }
  ], {
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T10:05:00Z",
    resume: { id: "resume-001", url: "https://api.hh.ru/resumes/resume-001" },
    vacancy: { id: "131345849", name: "Закупщик (Китай)" }
  });
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot,
    vacancyMappings: [{ hh_vacancy_id: "131345849", job_id: "job-zakup-china" }]
  });

  const result = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  assert.equal(result.ok, true);
  assert.equal(result.imported_negotiations, 1);
  assert.equal(result.imported_messages, 2);
  const negotiation = await store.findHhNegotiation("neg-import-001");
  assert.equal(negotiation.job_id, "job-zakup-china");
  const importedConversation = await store.findConversation("conv-hh-neg-import-001");
  assert.ok(importedConversation, "conversation should be created");
  const importedMessages = store.messages.filter((item) => item.conversation_id === "conv-hh-neg-import-001");
  assert.equal(importedMessages.length, 2);
  assert.equal(importedMessages[0].direction, "inbound");
  assert.equal(importedMessages[1].direction, "outbound");
  const importedCandidate = await store.getCandidate("cand-hh-neg-import-001");
  assert.equal(importedCandidate.display_name, "Ирина Соколова");
});

test("hh connector: syncApplicants imports active negotiations from phone_interview by default", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-phone-001", [
    { id: "msg-1", author: "applicant", text: "Готова созвониться", created_at: "2026-04-12T11:00:00Z" }
  ], {
    collection: "phone_interview",
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T11:00:00Z",
    vacancy: { id: "131345849", name: "Закупщик (Китай)" }
  });
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot,
    vacancyMappings: [{ hh_vacancy_id: "131345849", job_id: "job-zakup-china" }]
  });

  const result = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  assert.equal(result.imported_negotiations, 1);
  assert.equal(result.results.some((item) => item.collection === "phone_interview"), true);
  assert.ok(await store.findHhNegotiation("neg-phone-001"));
});

test("hh connector: syncApplicants is idempotent on repeated import", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-import-repeat", [
    { id: "msg-1", author: "applicant", text: "Привет", created_at: "2026-04-12T10:00:00Z" }
  ], {
    hh_vacancy_id: "132032392",
    updated_at: "2026-04-12T10:00:00Z",
    resume: { id: "resume-repeat", url: "https://api.hh.ru/resumes/resume-repeat" },
    vacancy: { id: "132032392", name: "Менеджер по продажам" }
  });
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot,
    vacancyMappings: [{ hh_vacancy_id: "132032392", job_id: "job-b2b-sales-manager" }]
  });

  const first = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });
  const second = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  assert.equal(first.imported_negotiations, 1);
  assert.equal(first.imported_messages, 1);
  assert.equal(second.imported_negotiations, 0);
  assert.equal(second.imported_messages, 0);
  const importedMessages = store.messages.filter((item) => item.conversation_id === "conv-hh-neg-import-repeat");
  assert.equal(importedMessages.length, 1);
});

test("hh connector: syncApplicants returns explicit error when no vacancy mappings are configured", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot
  });

  const result = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  assert.equal(result.ok, false);
  assert.equal(result.error, "no_active_hh_mappings");
  assert.equal(result.imported_negotiations, 0);
  assert.equal(result.results.length, 0);
});

test("hh connector: syncApplicants validates missing job (dangling mapping)", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-bad-job", [
    { id: "msg-1", author: "applicant", text: "Привет", created_at: "2026-04-12T10:00:00Z" }
  ], {
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T10:00:00Z",
    resume: { id: "resume-bad-job", url: "https://api.hh.ru/resumes/resume-bad-job" },
    vacancy: { id: "131345849", name: "Удаленная вакансия" }
  });
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot
  });

  const result = await connector.syncApplicants({
    windowStart: "2026-04-08T00:00:00Z",
    vacancyMappings: [{ hh_vacancy_id: "131345849", job_id: "job-does-not-exist" }]
  });

  assert.equal(result.ok, false);
  assert.equal(result.validation_errors.some((item) => item.code === "missing_job"), true);
  assert.equal(result.imported_negotiations, 0);
});

test("hh connector: syncApplicants rejects tenant-mismatch mapping", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-tenant-mismatch", [
    { id: "msg-1", author: "applicant", text: "Привет", created_at: "2026-04-12T10:00:00Z" }
  ], {
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T10:00:00Z",
    resume: { id: "resume-tenant", url: "https://api.hh.ru/resumes/resume-tenant" },
    vacancy: { id: "131345849", name: "Закупщик (Китай)" }
  });
  const tenantBoundJob = structuredClone(store.getJob("job-zakup-china"));
  tenantBoundJob.job_id = "job-tenant-bound";
  tenantBoundJob.client_id = "client-alpha-001";
  store.jobs.set(tenantBoundJob.job_id, tenantBoundJob);

  const connector = new HhConnector({
    store,
    hhClient,
    chatbot
  });

  const result = await connector.syncApplicants({
    windowStart: "2026-04-08T00:00:00Z",
    vacancyMappings: [{
      hh_vacancy_id: "131345849",
      job_id: "job-tenant-bound",
      client_id: "client-beta-001"
    }]
  });

  assert.equal(result.ok, false);
  assert.equal(result.validation_errors.some((item) => item.code === "tenant_mismatch"), true);
  assert.equal(result.imported_negotiations, 0);
});

test("hh connector: syncApplicants reports duplicate mappings and skips duplicate vacancy ids", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-duplicate", [
    { id: "msg-1", author: "applicant", text: "Добрый день", created_at: "2026-04-12T10:00:00Z" }
  ], {
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T10:00:00Z",
    resume: { id: "resume-dup", url: "https://api.hh.ru/resumes/resume-dup" },
    vacancy: { id: "131345849", name: "Закупщик (Китай)" }
  });
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot
  });

  const result = await connector.syncApplicants({
    windowStart: "2026-04-08T00:00:00Z",
    vacancyMappings: [
      { hh_vacancy_id: "131345849", job_id: "job-zakup-china" },
      { hh_vacancy_id: "131345849", job_id: "job-zakup-china" }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.validation_errors.some((item) => item.code === "duplicate_mapping"), true);
  assert.equal(result.imported_negotiations, 1);
  assert.ok(await store.findHhNegotiation("neg-duplicate"));
});

test("hh connector: syncApplicants reconciles job and template when vacancy mapping changes on rerun", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-remap-001", [
    { id: "msg-1", author: "applicant", text: "Есть опыт", created_at: "2026-04-12T10:00:00Z" }
  ], {
    hh_vacancy_id: "132032392",
    updated_at: "2026-04-12T10:00:00Z",
    resume: { id: "resume-remap", url: "https://api.hh.ru/resumes/resume-remap" },
    vacancy: { id: "132032392", name: "Менеджер по продажам" }
  });
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot,
    vacancyMappings: [{ hh_vacancy_id: "132032392", job_id: "job-zakup-china" }]
  });

  await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  connector.vacancyMappings = [{ hh_vacancy_id: "132032392", job_id: "job-b2b-sales-manager" }];
  const rerun = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  assert.equal(rerun.imported_negotiations, 0);
  const negotiation = await store.findHhNegotiation("neg-remap-001");
  assert.equal(negotiation.job_id, "job-b2b-sales-manager");
  const conversation = await store.findConversation("conv-hh-neg-remap-001");
  assert.equal(conversation.job_id, "job-b2b-sales-manager");
  const run = store.pipelineRuns.get("run-hh-neg-remap-001");
  assert.equal(run.job_id, "job-b2b-sales-manager");
  assert.equal(run.template_id, store.getJob("job-b2b-sales-manager").pipeline_template.template_id);
  const stepStates = store.getStepStates("run-hh-neg-remap-001");
  assert.equal(stepStates[0].step_id, store.getJob("job-b2b-sales-manager").pipeline_template.steps[0].id);
  assert.equal(stepStates[0].state, "active");
});

test("hh connector: syncApplicants continues import when one resume is unavailable", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-missing-resume", [
    { id: "msg-1", author: "applicant", text: "Первый кандидат", created_at: "2026-04-12T09:00:00Z" }
  ], {
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T09:30:00Z",
    resume: { id: "resume-missing", url: "https://api.hh.ru/resumes/resume-missing" },
    vacancy: { id: "131345849", name: "Закупщик (Китай)" }
  });
  hhClient.addNegotiation("neg-good-resume", [
    { id: "msg-2", author: "applicant", text: "Второй кандидат", created_at: "2026-04-12T09:30:00Z" }
  ], {
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T09:00:00Z",
    resume: { id: "resume-good", url: "https://api.hh.ru/resumes/resume-good" },
    vacancy: { id: "131345849", name: "Закупщик (Китай)" }
  });
  hhClient.seedResume({ id: "resume-good", first_name: "Мария", last_name: "Иванова" });
  const originalGetResume = hhClient.getResume.bind(hhClient);
  hhClient.getResume = async (resumeIdOrUrl) => {
    const resumeId = String(resumeIdOrUrl).split("/").at(-1);
    if (resumeId === "resume-missing") {
      const error = new Error("Negotiation not found");
      error.status = 404;
      throw error;
    }
    return originalGetResume(resumeIdOrUrl);
  };
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot,
    vacancyMappings: [{ hh_vacancy_id: "131345849", job_id: "job-zakup-china" }]
  });

  const result = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  assert.equal(result.imported_negotiations, 2);
  assert.ok(await store.findHhNegotiation("neg-missing-resume"));
  assert.ok(await store.findHhNegotiation("neg-good-resume"));
  const fallbackCandidate = await store.getCandidate("cand-hh-neg-missing-resume");
  assert.equal(fallbackCandidate.display_name, "resume-missing");
  const importedCandidate = await store.getCandidate("cand-hh-neg-good-resume");
  assert.equal(importedCandidate.display_name, "Мария Иванова");
});

test("hh connector: syncApplicants continues import when one negotiation messages fetch fails", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-messages-broken", [
    { id: "msg-1", author: "applicant", text: "Первый кандидат", created_at: "2026-04-12T09:00:00Z" }
  ], {
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T09:30:00Z",
    resume: { id: "resume-broken", url: "https://api.hh.ru/resumes/resume-broken" },
    vacancy: { id: "131345849", name: "Закупщик (Китай)" }
  });
  hhClient.addNegotiation("neg-messages-good", [
    { id: "msg-2", author: "applicant", text: "Второй кандидат", created_at: "2026-04-12T09:30:00Z" }
  ], {
    hh_vacancy_id: "131345849",
    updated_at: "2026-04-12T09:00:00Z",
    resume: { id: "resume-good-2", url: "https://api.hh.ru/resumes/resume-good-2" },
    vacancy: { id: "131345849", name: "Закупщик (Китай)" }
  });
  hhClient.seedResume({ id: "resume-broken", first_name: "Иван", last_name: "Петров" });
  hhClient.seedResume({ id: "resume-good-2", first_name: "Мария", last_name: "Иванова" });
  const originalGetMessages = hhClient.getMessages.bind(hhClient);
  hhClient.getMessages = async (negotiationId) => {
    if (negotiationId === "neg-messages-broken") {
      const error = new Error("Forbidden");
      error.status = 403;
      throw error;
    }
    return originalGetMessages(negotiationId);
  };
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot,
    vacancyMappings: [{ hh_vacancy_id: "131345849", job_id: "job-zakup-china" }]
  });

  const result = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  assert.equal(result.imported_negotiations, 2);
  assert.equal(result.imported_messages, 1);
  assert.ok(await store.findHhNegotiation("neg-messages-broken"));
  assert.ok(await store.findHhNegotiation("neg-messages-good"));
  assert.equal(store.messages.filter((item) => item.conversation_id === "conv-hh-neg-messages-broken").length, 0);
  assert.equal(store.messages.filter((item) => item.conversation_id === "conv-hh-neg-messages-good").length, 1);
});

test("hh connector: syncApplicants blocks stale planned messages when remap resets imported run", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.addNegotiation("neg-remap-queue", [
    { id: "msg-1", author: "applicant", text: "Есть опыт", created_at: "2026-04-12T10:00:00Z" }
  ], {
    hh_vacancy_id: "132032392",
    updated_at: "2026-04-12T10:00:00Z",
    resume: { id: "resume-remap-queue", url: "https://api.hh.ru/resumes/resume-remap-queue" },
    vacancy: { id: "132032392", name: "Менеджер по продажам" }
  });
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot,
    vacancyMappings: [{ hh_vacancy_id: "132032392", job_id: "job-zakup-china" }]
  });

  await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });
  store.plannedMessages.push({
    planned_message_id: "pm-remap-stale",
    conversation_id: "conv-hh-neg-remap-queue",
    candidate_id: "cand-hh-neg-remap-queue",
    pipeline_run_id: "run-hh-neg-remap-queue",
    step_id: "direct_china_suppliers",
    body: "Старый драфт",
    reason: "Сгенерировано до remap",
    review_status: "pending",
    moderation_policy: "window_to_reject",
    send_after: new Date(Date.now() + 60_000).toISOString(),
    auto_send_after: new Date(Date.now() + 60_000).toISOString()
  });

  connector.vacancyMappings = [{ hh_vacancy_id: "132032392", job_id: "job-b2b-sales-manager" }];
  await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  const staleMessage = store.plannedMessages.find((item) => item.planned_message_id === "pm-remap-stale");
  assert.equal(staleMessage.review_status, "blocked");
  assert.match(staleMessage.reason, /HH re-import remap/);
  const queue = await store.getQueueForRecruiter("rec-tok-demo-001");
  assert.ok(!queue.some((item) => item.planned_message_id === "pm-remap-stale"));
});

test("hh connector: syncApplicants keeps separate imported candidates per negotiation even for shared resume", async () => {
  const store = new InMemoryHiringStore(seed);
  const llmAdapter = new FakeLlmAdapter();
  const chatbot = createCandidateChatbot({ store, llmAdapter });
  const hhClient = await HhContractMock.create();
  hhClient.seedResume({
    id: "resume-shared",
    title: "Designer",
    first_name: "Анна",
    last_name: "Климова"
  });
  hhClient.addNegotiation("neg-design-1", [
    { id: "msg-1", author: "applicant", text: "Портфолио отправила", created_at: "2026-04-12T09:00:00Z" }
  ], {
    hh_vacancy_id: "131532142",
    updated_at: "2026-04-12T09:00:00Z",
    resume: { id: "resume-shared", url: "https://api.hh.ru/resumes/resume-shared" },
    vacancy: { id: "131532142", name: "Дизайнер 1" }
  });
  hhClient.addNegotiation("neg-design-2", [
    { id: "msg-2", author: "applicant", text: "Готова к тестовому", created_at: "2026-04-12T09:30:00Z" }
  ], {
    hh_vacancy_id: "131812494",
    updated_at: "2026-04-12T09:30:00Z",
    resume: { id: "resume-shared", url: "https://api.hh.ru/resumes/resume-shared" },
    vacancy: { id: "131812494", name: "Дизайнер 2" }
  });
  const connector = new HhConnector({
    store,
    hhClient,
    chatbot,
    vacancyMappings: [
      { hh_vacancy_id: "131532142", job_id: "job-zakup-china" },
      { hh_vacancy_id: "131812494", job_id: "job-zakup-china" }
    ]
  });

  const result = await connector.syncApplicants({ windowStart: "2026-04-08T00:00:00Z" });

  assert.equal(result.imported_negotiations, 2);
  assert.ok(await store.getCandidate("cand-hh-neg-design-1"));
  assert.ok(await store.getCandidate("cand-hh-neg-design-2"));
  assert.notEqual(
    (await store.findConversation("conv-hh-neg-design-1")).candidate_id,
    (await store.findConversation("conv-hh-neg-design-2")).candidate_id
  );
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
