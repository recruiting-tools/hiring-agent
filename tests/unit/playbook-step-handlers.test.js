import assert from "node:assert/strict";
import test from "node:test";
import { handleAutoFetchStep } from "../../services/hiring-agent/src/playbooks/step-handlers/auto-fetch.js";
import { handleButtonsStep } from "../../services/hiring-agent/src/playbooks/step-handlers/buttons.js";
import { handleDataFetchStep } from "../../services/hiring-agent/src/playbooks/step-handlers/data-fetch.js";
import { handleDecisionStep } from "../../services/hiring-agent/src/playbooks/step-handlers/decision.js";
import { handleDisplayStep } from "../../services/hiring-agent/src/playbooks/step-handlers/display.js";
import { handleLlmExtractStep } from "../../services/hiring-agent/src/playbooks/step-handlers/llm-extract.js";
import { handleLlmGenerateStep } from "../../services/hiring-agent/src/playbooks/step-handlers/llm-generate.js";
import { handleUserInputStep } from "../../services/hiring-agent/src/playbooks/step-handlers/user-input.js";
import { dispatch } from "../../services/hiring-agent/src/playbooks/runtime.js";

test("playbook handler: auto_fetch loads vacancy and raw text into context", async () => {
  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /FROM chatbot\.vacancies/);
    assert.deepEqual(values, ["vac-1"]);
    return [{
      vacancy_id: "vac-1",
      raw_text: "Текст вакансии",
      title: "Sales manager"
    }];
  });

  const result = await handleAutoFetchStep({
    step: { next_step_order: 1 },
    context: { vacancy_id: "vac-1" },
    tenantSql
  });

  assert.equal(result.nextStepOrder, 1);
  assert.equal(result.reply, null);
  assert.equal(result.context.raw_vacancy_text, "Текст вакансии");
  assert.equal(result.context.vacancy.title, "Sales manager");
});

test("playbook handler: user_input prompts first and stores recruiter input on resume", async () => {
  const step = {
    user_message: "Опишите вакансию",
    context_key: "raw_vacancy_text",
    next_step_order: 2
  };

  const prompt = await handleUserInputStep({ step, context: {}, recruiterInput: null });
  assert.deepEqual(prompt.reply, {
    kind: "user_input",
    message: "Опишите вакансию"
  });
  assert.equal(prompt.awaitingInput, true);
  assert.equal(prompt.nextStepOrder, null);

  const result = await handleUserInputStep({
    step,
    context: {},
    recruiterInput: "Нужен плиточник с опытом"
  });
  assert.equal(result.reply, null);
  assert.equal(result.nextStepOrder, 2);
  assert.equal(result.context.raw_vacancy_text, "Нужен плиточник с опытом");
});

test("playbook handler: buttons prompt and accept known option", async () => {
  const step = {
    step_key: "create_vacancy.14",
    user_message: "Что хотите сделать?",
    context_key: "next_action",
    next_step_order: null,
    options: "Настроить общение с кандидатами;Готово"
  };

  const prompt = await handleButtonsStep({ step, context: {}, recruiterInput: null });
  assert.deepEqual(prompt.reply, {
    kind: "buttons",
    message: "Что хотите сделать?",
    options: ["Настроить общение с кандидатами", "Готово"],
    step_key: "create_vacancy.14"
  });
  assert.equal(prompt.awaitingInput, true);

  const result = await handleButtonsStep({
    step,
    context: {},
    recruiterInput: "Готово"
  });
  assert.equal(result.reply, null);
  assert.equal(result.context.next_action, "Готово");
});

test("playbook handler: buttons can route different options to different next steps", async () => {
  const result = await handleButtonsStep({
    step: {
      step_key: "mass_broadcast.3",
      user_message: "Что делаем дальше?",
      context_key: "broadcast_action",
      next_step_order: 4,
      options: "Подтвердить;Изменить порог;Изменить критерий",
      routing: {
        "Подтвердить": 4,
        "Изменить порог": 2,
        "Изменить критерий": 1
      }
    },
    context: {},
    recruiterInput: "Изменить порог"
  });

  assert.equal(result.reply, null);
  assert.equal(result.context.broadcast_action, "Изменить порог");
  assert.equal(result.nextStepOrder, 2);
});

test("playbook handler: llm_extract retries once, appends JSON instruction, and saves vacancy column", async () => {
  let attempts = 0;
  const prompts = [];
  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /UPDATE chatbot\.vacancies/);
    assert.deepEqual(values, ["[\"Опыт 1 год\"]", "vac-42"]);
    return [];
  });

  const result = await handleLlmExtractStep({
    step: {
      prompt_template: "Извлеки требования из {{context.raw_vacancy_text}}",
      context_key: "must_haves",
      db_save_column: "must_haves",
      next_step_order: 3
    },
    context: {
      vacancy_id: "vac-42",
      raw_vacancy_text: "Нужен опыт от 1 года"
    },
    tenantSql,
    llmAdapter: {
      async generate(prompt) {
        prompts.push(prompt);
        attempts += 1;
        if (attempts === 1) {
          throw new Error("temporary");
        }
        return "[\"Опыт 1 год\"]";
      }
    }
  });

  assert.equal(result.nextStepOrder, 3);
  assert.equal(result.reply, null);
  assert.deepEqual(result.context.must_haves, ["Опыт 1 год"]);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Return valid JSON only, no markdown\./);
});

test("playbook handler: llm_extract uses model override for create_vacancy application_steps", async () => {
  const models = [];
  const result = await handleLlmExtractStep({
    step: {
      playbook_key: "create_vacancy",
      prompt_template: "Извлеки шаги из {{context.raw_vacancy_text}}",
      context_key: "application_steps",
      db_save_column: "application_steps",
      next_step_order: 9
    },
    context: {
      vacancy_id: "vac-99",
      raw_vacancy_text: "Нужен продажник с B2B опытом"
    },
    tenantSql: createMockSql(({ text }) => {
      assert.match(text, /UPDATE chatbot\.vacancies/);
      return [];
    }),
    llmConfig: {
      createVacancy: {
        applicationStepsExtractModel: "openai/gpt-5.4-mini"
      }
    },
    llmAdapter: {
      async generate(_prompt, options) {
        models.push(options?.model ?? null);
        return JSON.stringify([
          {
            name: "Проверка опыта продаж",
            type: "must_have_check",
            what: "Проверить релевантный опыт",
            script: "Уточнить кейсы",
            in_our_scope: true,
            is_target: false
          },
          {
            name: "Сверка условий",
            type: "condition_check",
            what: "Уточнить зарплату и формат",
            script: "Снять риски",
            in_our_scope: true,
            is_target: false
          },
          {
            name: "Приглашение на интервью",
            type: "target_action",
            what: "Предложить следующий шаг",
            script: "Согласовать слот",
            in_our_scope: true,
            is_target: true
          }
        ]);
      }
    }
  });

  assert.equal(result.nextStepOrder, 9);
  assert.equal(models[0], "openai/gpt-5.4-mini");
});

test("playbook handler: llm_generate stores parsed JSON and returns UI payload", async () => {
  const result = await handleLlmGenerateStep({
    step: {
      prompt_template: "Сгенерируй FAQ по {{context.raw_vacancy_text}}",
      context_key: "faq",
      next_step_order: 13
    },
    context: {
      raw_vacancy_text: "Текст вакансии"
    },
    llmAdapter: {
      async generate() {
        return "[{\"q\":\"Какая зарплата?\",\"a\":\"200 тыс.\"}]";
      }
    }
  });

  assert.equal(result.nextStepOrder, 13);
  assert.deepEqual(result.context.faq, [{ q: "Какая зарплата?", a: "200 тыс." }]);
  assert.deepEqual(result.reply, {
    kind: "llm_output",
    content: "[{\"q\":\"Какая зарплата?\",\"a\":\"200 тыс.\"}]",
    content_type: "text"
  });
});

test("playbook handler: display renders templated content and optional buttons", async () => {
  const result = await handleDisplayStep({
    step: {
      user_message: "Нашли:\n{{context.must_haves | bullet_list}}",
      options: "Уточнить;Продолжить"
    },
    context: {
      must_haves: ["Опыт B2B", "Готовность к выездам"]
    },
    recruiterInput: null
  });

  assert.deepEqual(result.reply, {
    kind: "display",
    content: "Нашли:\n• Опыт B2B\n• Готовность к выездам",
    content_type: "text",
    options: ["Уточнить", "Продолжить"]
  });
  assert.equal(result.awaitingInput, true);
});

test("playbook handler: display captures selected option and uses explicit routing", async () => {
  const result = await handleDisplayStep({
    step: {
      user_message: "Выберите вариант плана",
      context_key: "approved_plan_variant",
      options: "Вариант 1;Вариант 2;Уточнить",
      next_step_order: 3,
      routing: {
        "Вариант 1": 3,
        "Вариант 2": 3,
        "Уточнить": 1
      }
    },
    context: {},
    recruiterInput: "Уточнить"
  });

  assert.equal(result.reply, null);
  assert.equal(result.context.approved_plan_variant, "Уточнить");
  assert.equal(result.nextStepOrder, 1);
});

test("playbook handler: display re-prompts on unknown option", async () => {
  const result = await handleDisplayStep({
    step: {
      user_message: "Выберите вариант плана",
      options: "Вариант 1;Вариант 2"
    },
    context: {},
    recruiterInput: "Вариант 3"
  });

  assert.equal(result.awaitingInput, true);
  assert.deepEqual(result.reply.options, ["Вариант 1", "Вариант 2"]);
});

test("playbook handler: display marks html-filtered content as html", async () => {
  const result = await handleDisplayStep({
    step: {
      user_message: "Вот варианты:\n{{context.generated_messages | html}}"
    },
    context: {
      generated_messages: "<div class=\"message-variant\"><p>Привет</p></div>"
    },
    recruiterInput: null
  });

  assert.equal(result.reply.content_type, "html");
});

test("playbook handler: decision evaluates JSON rules and can return a message", async () => {
  const result = await handleDecisionStep({
    step: {
      next_step_order: 4,
      notes: JSON.stringify({
        rules: [
          {
            condition: "context.must_haves.length >= 5",
            next: 2,
            message: "Нашли много обязательных требований."
          },
          { default: true, next: 4 }
        ]
      })
    },
    context: {
      must_haves: ["1", "2", "3", "4", "5"]
    }
  });

  assert.equal(result.nextStepOrder, 2);
  assert.deepEqual(result.reply, {
    kind: "display",
    content: "Нашли много обязательных требований.",
    content_type: "text"
  });
});

test("playbook handler: decision can resolve next step via routing map outcome", async () => {
  const result = await handleDecisionStep({
    step: {
      next_step_order: 4,
      routing: {
        too_many: 2,
        ok: 4
      },
      notes: JSON.stringify({
        rules: [
          {
            condition: "context.must_haves.length >= 5",
            outcome: "too_many",
            message: "Нашли много обязательных требований."
          },
          { default: true, outcome: "ok" }
        ]
      })
    },
    context: {
      must_haves: ["1", "2", "3", "4", "5"]
    }
  });

  assert.equal(result.nextStepOrder, 2);
  assert.deepEqual(result.reply, {
    kind: "display",
    content: "Нашли много обязательных требований.",
    content_type: "text"
  });
});

test("playbook handler: data_fetch loads funnel data into context", async () => {
  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /with scoped_runs as/i);
    assert.deepEqual(values, ["job-1", "tenant-1"]);
    return [{
      step_name: "qualification",
      step_id: "qualification",
      step_index: 0,
      total: 5,
      in_progress: 2,
      completed: 2,
      stuck: 1,
      rejected: 0
    }];
  });

  const result = await handleDataFetchStep({
    step: {
      playbook_key: "candidate_funnel",
      step_key: "candidate_funnel.1",
      context_key: "funnel_data",
      notes: JSON.stringify({ source: "candidate_funnel" }),
      next_step_order: 2
    },
    context: {
      vacancy_id: "vac-1",
      vacancy: { vacancy_id: "vac-1", job_id: "job-1" }
    },
    tenantSql,
    tenantId: "tenant-1"
  });

  assert.equal(result.nextStepOrder, 2);
  assert.deepEqual(result.context.funnel_data, [{
    step_name: "qualification",
    step_id: "qualification",
    step_index: 0,
    total: 5,
    in_progress: 2,
    completed: 2,
    stuck: 1,
    rejected: 0
  }]);
});

test("playbook handler: data_fetch loads mass broadcast candidates into context", async () => {
  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /with scoped_runs as/i);
    assert.deepEqual(values, ["job-1", "tenant-1"]);
    return [{
      candidate_id: "cand-1",
      display_name: "Иван",
      resume_text: "Опыт Java и backend интеграций",
      status: "active",
      current_step: "Интервью",
      current_step_updated_at: new Date(Date.now() - 48 * 36e5).toISOString(),
      awaiting_reply: true,
      last_message_at: new Date(Date.now() - 30 * 36e5).toISOString()
    }];
  });

  const result = await handleDataFetchStep({
    step: {
      playbook_key: "mass_broadcast",
      step_key: "mass_broadcast.4",
      context_key: "candidates",
      notes: JSON.stringify({ source: "mass_broadcast_candidates", limit: 25 }),
      next_step_order: 5
    },
    context: {
      vacancy: { vacancy_id: "vac-1", job_id: "job-1" },
      selection_query: {
        type: "exact",
        exact_filter: {
          current_step: "Интервью",
          last_message_older_than_hours: 24
        }
      }
    },
    tenantSql,
    tenantId: "tenant-1"
  });

  assert.equal(result.nextStepOrder, 5);
  assert.deepEqual(result.context.candidates, [{
    candidate_id: "cand-1",
    name: "Иван",
    current_step: "Интервью",
    status: "active",
    hours_on_step: 48,
    last_message_at: result.context.candidates[0].last_message_at
  }]);
});

test("playbook runtime: creates a session, skips silent auto_fetch, and returns first interactive reply", async () => {
  const calls = [];
  const managementStore = {
    async getPlaybookSteps(playbookKey) {
      assert.equal(playbookKey, "setup_communication");
      return [
        { step_key: "setup_communication.0", step_order: 0, step_type: "auto_fetch", next_step_order: 1 },
        {
          step_key: "setup_communication.1",
          step_order: 1,
          step_type: "user_input",
          user_message: "Что уточнить по вакансии?",
          context_key: "clarification",
          next_step_order: 2
        }
      ];
    },
    async getActiveSession() {
      return null;
    },
    async abortActiveSessions(params) {
      calls.push(["abort", params]);
    },
    async createPlaybookSession(input) {
      calls.push(["create", input]);
      return {
        session_id: "sess-1",
        playbook_key: input.playbookKey,
        vacancy_id: input.vacancyId,
        current_step_order: input.currentStepOrder,
        context: input.context,
        call_stack: [],
        status: "active"
      };
    },
    async updateSession(sessionId, patch) {
      calls.push(["update", sessionId, patch]);
    },
    async completeSession() {
      throw new Error("should not complete");
    }
  };

  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /FROM chatbot\.vacancies/);
    assert.deepEqual(values, ["vac-7"]);
    return [{ vacancy_id: "vac-7", raw_text: "raw text", title: "Ops manager" }];
  });

  const result = await dispatch({
    managementStore,
    tenantSql,
    tenantId: "tenant-1",
    recruiterId: "rec-1",
    vacancyId: "vac-7",
    playbookKey: "setup_communication",
    recruiterInput: null,
    llmAdapter: { async generate() { throw new Error("unused"); } }
  });

  assert.equal(result.sessionId, "sess-1");
  assert.deepEqual(result.reply, {
    kind: "user_input",
    message: "Что уточнить по вакансии?"
  });
  assert.deepEqual(calls[0][0], "abort");
  assert.deepEqual(calls[1][0], "create");
  assert.deepEqual(calls.at(-1), [
    "update",
    "sess-1",
    {
      currentStepOrder: 1,
      context: {
        vacancy_id: "vac-7",
        vacancy: { vacancy_id: "vac-7", raw_text: "raw text", title: "Ops manager" },
        raw_vacancy_text: "raw text"
      },
      vacancyId: "vac-7"
    }
  ]);
});

function createMockSql(handler) {
  return async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    return handler({ text, values });
  };
}
