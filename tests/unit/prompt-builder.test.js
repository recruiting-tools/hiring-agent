import assert from "node:assert/strict";
import test from "node:test";
import { buildPrompt } from "../../services/candidate-chatbot/src/prompt-builder.js";

const job = {
  job_id: "job-test",
  title: "Test Engineer",
  description: "We need a test engineer with 5+ years of experience."
};

const candidate = {
  candidate_id: "cand-test",
  display_name: "Ivan Ivanov",
  resume_text: "5 years of QA experience, worked at Yandex and Mail.ru on automated testing."
};

const allSteps = [
  {
    step_id: "test_exp",
    step_index: 1,
    state: "active",
    awaiting_reply: true,
    extracted_facts: {}
  },
  {
    step_id: "automation_skills",
    step_index: 2,
    state: "pending",
    awaiting_reply: false,
    extracted_facts: {}
  },
  {
    step_id: "salary_fit",
    step_index: 3,
    state: "completed",
    awaiting_reply: false,
    extracted_facts: { salary: "150000" }
  }
];

const templateSteps = [
  {
    id: "test_exp",
    step_index: 1,
    kind: "question",
    goal: "Проверить опыт тестирования от 3 лет",
    done_when: "кандидат называет опыт тестирования и конкретные проекты",
    reject_when: "у кандидата нет опыта тестирования"
  },
  {
    id: "automation_skills",
    step_index: 2,
    kind: "question",
    goal: "Проверить навыки автоматизации тестирования",
    done_when: "кандидат называет конкретные фреймворки и опыт написания автотестов",
    reject_when: "кандидат работал только с ручным тестированием и не готов к автоматизации"
  },
  {
    id: "salary_fit",
    step_index: 3,
    kind: "question",
    goal: "Проверить зарплатные ожидания",
    done_when: "кандидат называет ожидания в пределах вилки",
    reject_when: "ожидания сильно выше вилки"
  }
];

const history = [
  { direction: "outbound", body: "Здравствуйте! Расскажите о вашем опыте.", occurred_at: "2026-04-12T08:00:00Z" },
  { direction: "inbound", body: "Работал 5 лет в Яндексе.", occurred_at: "2026-04-12T08:01:00Z" },
  { direction: "outbound", body: "Какие инструменты использовали?", occurred_at: "2026-04-12T08:02:00Z" }
];

const inboundMessage = {
  body: "Использовал Selenium, Cypress и Playwright.",
  occurred_at: "2026-04-12T08:03:00Z"
};

const pendingSteps = allSteps.filter((s) => s.state !== "completed");
const pendingTemplateSteps = templateSteps.filter((s) => s.id !== "salary_fit");

test("prompt contains all pending step goals", () => {
  const prompt = buildPrompt({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage });

  assert.ok(prompt.includes("Проверить опыт тестирования от 3 лет"), "should include test_exp goal");
  assert.ok(prompt.includes("Проверить навыки автоматизации тестирования"), "should include automation_skills goal");
});

test("prompt does not include completed step goals", () => {
  const prompt = buildPrompt({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage });

  assert.doesNotMatch(prompt, /Проверить зарплатные ожидания/, "completed step goal must not appear");
});

test("prompt includes candidate resume", () => {
  const prompt = buildPrompt({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage });

  assert.ok(prompt.includes("5 years of QA experience"), "resume text must be in prompt");
  assert.ok(prompt.includes("Yandex"), "resume content must be present");
});

test("prompt includes last N messages from history", () => {
  // Build a longer history to test the cap — use padded unique IDs to avoid substring collisions
  const longHistory = Array.from({ length: 15 }, (_, i) => ({
    direction: i % 2 === 0 ? "outbound" : "inbound",
    body: `MsgBody-${String(i + 1).padStart(3, "0")}`,
    occurred_at: `2026-04-12T08:${String(i).padStart(2, "0")}:00Z`
  }));

  const prompt = buildPrompt({ job, candidate, pendingSteps, pendingTemplateSteps, history: longHistory, inboundMessage });

  // Last 10 messages (indices 5-14 = MsgBody-006 through MsgBody-015) should be in prompt
  assert.ok(prompt.includes("MsgBody-006"), "message 6 (10th from end) should be included");
  assert.ok(prompt.includes("MsgBody-015"), "message 15 (last) should be included");
  // Messages older than last 10 (MsgBody-001 through MsgBody-005) should not be in prompt
  assert.ok(!prompt.includes("MsgBody-001"), "message 1 (too old) should not be included");
  assert.ok(!prompt.includes("MsgBody-005"), "message 5 (too old) should not be included");
});

test("json schema is embedded in prompt", () => {
  const prompt = buildPrompt({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage });

  assert.ok(prompt.includes("step_result"), "JSON schema key step_result must appear");
  assert.ok(prompt.includes("completed_step_ids"), "JSON schema key completed_step_ids must appear");
  assert.ok(prompt.includes("next_message"), "JSON schema key next_message must appear");
  assert.ok(prompt.includes("confidence"), "JSON schema key confidence must appear");
});

test("prompt accepts prebuilt conversationContext", () => {
  const prompt = buildPrompt({
    conversationContext: {
      job,
      candidate,
      pendingSteps,
      pendingTemplateSteps,
      history,
      inboundMessage
    }
  });

  assert.ok(prompt.includes("Проверить опыт тестирования от 3 лет"));
  assert.ok(prompt.includes("Использовал Selenium, Cypress и Playwright."));
});
