import assert from "node:assert/strict";
import test from "node:test";
import { handleAutoFetchStep } from "../../services/hiring-agent/src/playbooks/step-handlers/auto-fetch.js";
import { handleActionStep } from "../../services/hiring-agent/src/playbooks/step-handlers/action.js";
import { handleButtonsStep } from "../../services/hiring-agent/src/playbooks/step-handlers/buttons.js";
import { handleDataFetchStep } from "../../services/hiring-agent/src/playbooks/step-handlers/data-fetch.js";
import { handleDecisionStep } from "../../services/hiring-agent/src/playbooks/step-handlers/decision.js";
import { handleDisplayStep } from "../../services/hiring-agent/src/playbooks/step-handlers/display.js";
import { buildJsonPrompt, handleLlmExtractStep } from "../../services/hiring-agent/src/playbooks/step-handlers/llm-extract.js";
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
  assert.equal(result.context.job_setup_id, "vac-1");
  assert.equal(result.context.raw_job_setup_text, "Текст вакансии");
  assert.equal(result.context.raw_vacancy_text, "Текст вакансии");
  assert.equal(result.context.job_setup.title, "Sales manager");
  assert.equal(result.context.vacancy.title, "Sales manager");
});

test("playbook handler: auto_fetch falls back to job_id when vacancy_id is synthetic", async () => {
  let queryCount = 0;
  const tenantSql = createMockSql(({ text, values }) => {
    queryCount += 1;
    if (queryCount === 1) {
      assert.match(text, /WHERE vacancy_id = \$1/);
      assert.deepEqual(values, ["job-1"]);
      return [];
    }

    assert.match(text, /WHERE job_id = \$1/);
    assert.deepEqual(values, ["job-1"]);
    return [{
      vacancy_id: "vac-1",
      job_id: "job-1",
      raw_text: "Текст вакансии",
      title: "Sales manager"
    }];
  });

  const result = await handleAutoFetchStep({
    step: { next_step_order: 1 },
    context: { vacancy_id: "job-1", job_id: "job-1" },
    tenantSql
  });

  assert.equal(result.nextStepOrder, 1);
  assert.equal(result.context.vacancy_id, "vac-1");
  assert.equal(result.context.job_id, "job-1");
  assert.equal(result.context.job_setup_id, "vac-1");
  assert.equal(result.context.job_setup.title, "Sales manager");
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
  assert.equal(result.context.raw_job_setup_text, "Нужен плиточник с опытом");
  assert.equal(result.context.raw_vacancy_text, "Нужен плиточник с опытом");
});

test("playbook handler: create_vacancy user_input inserts draft vacancy with explicit communication defaults", async () => {
  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /INSERT INTO chatbot\.vacancies/);
    assert.match(text, /communication_plan_draft/);
    assert.match(text, /communication_examples/);
    assert.match(text, /'pending',\s*NULL,\s*NULL,\s*'\[\]'::jsonb,\s*NULL/);
    assert.deepEqual(values, ["rec-1", "Нужен менеджер по продажам", "Нужен менеджер по продажам"]);
    return [{
      vacancy_id: "vac-new-1",
      title: "Нужен менеджер по продажам",
      status: "draft"
    }];
  });

  const result = await handleUserInputStep({
    step: {
      user_message: "Опишите вакансию",
      context_key: "raw_vacancy_text",
      next_step_order: 2
    },
    session: {
      playbook_key: "create_vacancy",
      recruiter_id: "rec-1"
    },
    context: {},
    recruiterInput: "Нужен менеджер по продажам",
    tenantSql
  });

  assert.equal(result.nextStepOrder, 2);
  assert.equal(result.context.vacancy_id, "vac-new-1");
  assert.equal(result.context.job_setup_id, "vac-new-1");
  assert.equal(result.context.job_setup?.status, "draft");
  assert.equal(result.context.vacancy?.status, "draft");
});

test("playbook handler: create_vacancy user_input expands HH vacancy link into raw text", async () => {
  const recruiterInput = "https://hh.ru/vacancy/132102233?hhtmFrom=employer_vacancies";
  let fetchCalls = 0;
  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /INSERT INTO chatbot\.vacancies/);
    assert.equal(values[0], "rec-1");
    assert.equal(values[1], "Инженер-технолог");
    assert.match(values[2], /Источник HH: https:\/\/hh\.ru\/vacancy\/132102233\?hhtmFrom=employer_vacancies/);
    assert.match(values[2], /Компания: HR-Stalker/);
    assert.match(values[2], /Высшее профессиональное образование/);
    return [{
      vacancy_id: "vac-hh-1",
      title: "Инженер-технолог",
      status: "draft"
    }];
  });

  const result = await handleUserInputStep({
    step: {
      user_message: "Опишите вакансию",
      context_key: "raw_vacancy_text",
      next_step_order: 2
    },
    session: {
      playbook_key: "create_vacancy",
      recruiter_id: "rec-1"
    },
    context: {},
    recruiterInput,
    tenantSql,
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async text() {
          return [
            "<h1 data-qa=\"vacancy-title\">Инженер-технолог</h1>",
            "<a data-qa=\"vacancy-company-name\">HR-Stalker</a>",
            "<div data-qa=\"vacancy-salary\">110 000 ₽</div>",
            "<span data-qa=\"vacancy-experience\">1–3 года</span>",
            "<div data-qa=\"common-employment-text\">Проект или разовое задание</div>",
            "<p data-qa=\"work-schedule-by-days-text\">График: свободный</p>",
            [
              "<div class=\"g-user-content\" data-qa=\"vacancy-description\">",
              "<p><strong>Требования:</strong></p>",
              "<p>Высшее профессиональное образование</p>",
              "<ul><li>Опыт рецензирования</li></ul>",
              "</div>"
            ].join("")
          ].join("");
        }
      };
    }
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result.nextStepOrder, 2);
  assert.equal(result.context.vacancy_id, "vac-hh-1");
  assert.equal(result.context.job_setup_id, "vac-hh-1");
  assert.match(result.context.raw_job_setup_text, /Описание вакансии:/);
  assert.match(result.context.raw_job_setup_text, /- Опыт рецензирования/);
  assert.match(result.context.raw_vacancy_text, /Описание вакансии:/);
  assert.match(result.context.raw_vacancy_text, /- Опыт рецензирования/);
});

test("playbook handler: buttons prompt and accept known option", async () => {
  const step = {
    step_key: "create_vacancy.14",
    user_message: "Что хотите сделать?",
    context_key: "next_action",
    next_step_order: null,
    options: "Распланировать общение с кандидатами;Сравнить с другими вакансиями;Готово"
  };

  const prompt = await handleButtonsStep({ step, context: {}, recruiterInput: null });
  assert.deepEqual(prompt.reply, {
    kind: "buttons",
    message: "Что хотите сделать?",
    options: ["Распланировать общение с кандидатами", "Сравнить с другими вакансиями", "Готово"],
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
      playbook_key: "create_vacancy",
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
  assert.match(prompts[0], /ЛОГИЧЕСКИХ блокирующих требований/i);
  assert.match(prompts[0], /Одна из специальностей/i);
});

test("playbook handler: buildJsonPrompt reinforces logical count for create_vacancy must_haves", () => {
  const prompt = buildJsonPrompt({
    playbook_key: "create_vacancy",
    prompt_template: "Извлеки требования из {{context.raw_vacancy_text}}",
    db_save_column: "must_haves"
  }, {
    raw_vacancy_text: "Высшее образование. Одна из специальностей: A, B или C."
  });

  assert.match(prompt, /Каждый элемент массива должен соответствовать одному логическому must-have/i);
  assert.match(prompt, /Не раскладывай альтернативные специальности/i);
});

test("playbook handler: llm_extract parses fenced JSON responses", async () => {
  const result = await handleLlmExtractStep({
    step: {
      prompt_template: "Извлеки требования из {{context.raw_vacancy_text}}",
      context_key: "must_haves",
      next_step_order: 4
    },
    context: {
      raw_vacancy_text: "Нужен плиточник"
    },
    llmAdapter: {
      async generate() {
        return "```json\n[\"Опыт плиточника\"]\n```";
      }
    }
  });

  assert.equal(result.nextStepOrder, 4);
  assert.deepEqual(result.context.must_haves, ["Опыт плиточника"]);
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

test("playbook handler: llm_generate parses fenced JSON responses", async () => {
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
        return "```json\n[{\"q\":\"Есть ли обучение?\",\"a\":\"Да\"}]\n```";
      }
    }
  });

  assert.equal(result.nextStepOrder, 13);
  assert.deepEqual(result.context.faq, [{ q: "Есть ли обучение?", a: "Да" }]);
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

test("playbook handler: decision shows must-have list for seeded create_vacancy warning", async () => {
  const result = await handleDecisionStep({
    step: {
      next_step_order: 4,
      notes: "Rules: count < 2 → show must_haves; count >= 5 → show must_haves."
    },
    context: {
      must_haves: [
        "Опыт B2B продаж",
        "Ведение переговоров",
        "Работа с CRM",
        "Английский B2+",
        "Готовность к командировкам"
      ]
    }
  });

  assert.equal(result.nextStepOrder, 4);
  assert.deepEqual(result.reply, {
    kind: "display",
    content: [
      "Нашли 5 обязательных требований — это много. Все они действительно блокирующие?",
      "",
      "Список обязательных требований:",
      "• Опыт B2B продаж",
      "• Ведение переговоров",
      "• Работа с CRM",
      "• Английский B2+",
      "• Готовность к командировкам"
    ].join("\n"),
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

test("playbook handler: data_fetch loads candidate snapshot from client context", async () => {
  let callCount = 0;
  const tenantSql = createMockSql(({ text, values }) => {
    callCount += 1;

    if (callCount === 1) {
      assert.match(text, /WITH candidate_scope AS/i);
      assert.deepEqual(values, ["tenant-1", null, null, null, null, "conv-1", "conv-1", null, null]);
      return [{
        pipeline_run_id: "run-1",
        job_id: "job-1",
        candidate_id: "cand-1",
        conversation_id: "conv-1",
        run_status: "active",
        display_name: "Иван",
        resume_text: "Опыт B2B продаж",
        vacancy_id: "vac-1",
        vacancy_title: "Sales manager",
        current_step_id: "screen",
        current_step: "Первичный скрининг",
        awaiting_reply: true,
        last_reason: null,
        current_step_updated_at: new Date(Date.now() - 26 * 36e5).toISOString(),
        last_message_direction: "inbound",
        last_message_body: "Готов обсудить детали",
        last_message_at: new Date(Date.now() - 2 * 36e5).toISOString(),
        next_message_body: "Напомню завтра утром",
        next_message_review_status: "approved",
        next_message_send_after: new Date(Date.now() + 12 * 36e5).toISOString()
      }];
    }

    throw new Error(`Unexpected query: ${text}`);
  });

  const result = await handleDataFetchStep({
    step: {
      playbook_key: "check_candidate",
      step_key: "check_candidate.3",
      context_key: "candidate_snapshot",
      notes: JSON.stringify({ source: "candidate_snapshot" }),
      next_step_order: 4
    },
    context: {
      client_context: {
        conversation_id: "conv-1"
      }
    },
    tenantSql,
    tenantId: "tenant-1"
  });

  assert.equal(result.nextStepOrder, 4);
  assert.equal(result.context.candidate_snapshot.kind, "snapshot");
  assert.equal(result.context.candidate_snapshot.candidate_name, "Иван");
  assert.equal(result.context.candidate_snapshot.awaiting_reply, true);
});

test("playbook handler: data_fetch loads daily summary", async () => {
  let callCount = 0;
  const tenantSql = createMockSql(({ text, values }) => {
    callCount += 1;

    if (callCount === 1) {
      assert.match(text, /FROM chatbot\.messages m/);
      assert.match(text, /m\.direction = 'inbound'/);
      assert.deepEqual(values, ["tenant-1", null, null]);
      return [{ count: 7 }];
    }

    if (callCount === 2) {
      assert.match(text, /m\.direction = 'outbound'/);
      assert.deepEqual(values, ["tenant-1", null, null]);
      return [{ count: 12 }];
    }

    if (callCount === 3) {
      assert.match(text, /FROM chatbot\.planned_messages pm/);
      assert.deepEqual(values, ["tenant-1", null, null]);
      return [{ count: 3 }];
    }

    if (callCount === 4) {
      assert.match(text, /WITH active_steps AS/i);
      assert.deepEqual(values, ["tenant-1", null, null, 24]);
      return [{
        candidate_id: "cand-1",
        display_name: "Иван",
        vacancy_title: "Sales manager",
        current_step: "Скрининг",
        hours_waiting: 29.5
      }];
    }

    throw new Error(`Unexpected query: ${text}`);
  });

  const result = await handleDataFetchStep({
    step: {
      playbook_key: "today_summary",
      step_key: "today_summary.1",
      context_key: "today_summary",
      notes: JSON.stringify({ source: "today_summary", stalledHours: 24 }),
      next_step_order: 2
    },
    context: {},
    tenantSql,
    tenantId: "tenant-1"
  });

  assert.equal(result.nextStepOrder, 2);
  assert.deepEqual(result.context.today_summary, {
    kind: "summary",
    scope: "tenant",
    responses_today: 7,
    sent_today: 12,
    moderation_pending: 3,
    stalled_candidates: [{
      candidate_id: "cand-1",
      name: "Иван",
      vacancy_title: "Sales manager",
      current_step: "Скрининг",
      hours_waiting: 29.5
    }]
  });
});

test("playbook handler: data_fetch searches candidates by free text", async () => {
  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /WITH scoped_runs AS/i);
    assert.deepEqual(values, ["tenant-1", null, null]);
    return [
      {
        candidate_id: "cand-1",
        display_name: "Иван Петров",
        resume_text: "Java backend and Kafka integrations",
        status: "active",
        vacancy_title: "Backend engineer",
        current_step: "Техническое интервью",
        last_message_at: new Date().toISOString()
      },
      {
        candidate_id: "cand-2",
        display_name: "Мария Смирнова",
        resume_text: "Product marketing",
        status: "active",
        vacancy_title: "Marketing manager",
        current_step: "Скрининг",
        last_message_at: new Date().toISOString()
      }
    ];
  });

  const result = await handleDataFetchStep({
    step: {
      playbook_key: "candidate_search",
      step_key: "candidate_search.2",
      context_key: "candidate_search_results",
      notes: JSON.stringify({ source: "candidate_search", limit: 10 }),
      next_step_order: 3
    },
    context: {
      search_query: "java kafka"
    },
    tenantSql,
    tenantId: "tenant-1"
  });

  assert.equal(result.nextStepOrder, 3);
  assert.equal(result.context.candidate_search_results.length, 1);
  assert.equal(result.context.candidate_search_results[0].candidate_id, "cand-1");
  assert.equal(result.context.candidate_search_results[0].match_score, 100);
});

test("playbook handler: action rejects candidate and blocks queued messages", async () => {
  const calls = [];
  const tenantSql = createMockSql(({ text, values }) => {
    calls.push({ text, values });

    if (text.includes("FROM chatbot.pipeline_runs")) {
      assert.deepEqual(values, ["run-1"]);
      return [{
        pipeline_run_id: "run-1",
        job_id: "job-1",
        candidate_id: "cand-1",
        active_step_id: "screen",
        status: "active",
        display_name: "Иван",
        conversation_id: "conv-1"
      }];
    }

    if (text.includes("UPDATE chatbot.planned_messages")) {
      return [{ planned_message_id: "pm-1" }, { planned_message_id: "pm-2" }];
    }

    return [];
  });

  const result = await handleActionStep({
    step: {
      notes: JSON.stringify({ action: "reject_candidate" }),
      next_step_order: null
    },
    context: {
      pipeline_run_id: "run-1",
      rejection_reason: "Не подходит по графику"
    },
    tenantSql
  });

  assert.equal(result.reply.kind, "display");
  assert.match(result.reply.content, /Кандидат отклонён/);
  assert.match(result.reply.content, /Иван/);
  assert.match(result.reply.content, /Заблокировано сообщений в очереди: 2/);
  assert.ok(calls.some((call) => call.text.includes("INSERT INTO chatbot.pipeline_events")));
});

test("playbook handler: action schedules reminder in moderation queue", async () => {
  const tenantSql = createMockSql(({ text, values }) => {
    if (text.includes("FROM chatbot.conversations")) {
      assert.deepEqual(values, ["conv-1"]);
      return [{
        pipeline_run_id: "run-1",
        job_id: "job-1",
        candidate_id: "cand-1",
        active_step_id: "screen",
        status: "active",
        display_name: "Иван",
        conversation_id: "conv-1"
      }];
    }

    if (text.includes("INSERT INTO chatbot.planned_messages")) {
      assert.equal(values[1], "conv-1");
      assert.equal(values[5], "Напомню завтра утром про интервью.");
      assert.match(text, /'approved'/);
      return [{ planned_message_id: "pm-manual-1" }];
    }

    throw new Error(`Unexpected query: ${text}`);
  });

  const result = await handleActionStep({
    step: {
      notes: JSON.stringify({ action: "schedule_reminder" }),
      next_step_order: null
    },
    context: {
      conversation_id: "conv-1",
      reminder_text: "Напомню завтра утром про интервью.",
      reminder_delay: "Завтра утром"
    },
    tenantSql
  });

  assert.match(result.reply.content, /Напоминание поставлено в очередь/);
  assert.match(result.reply.content, /pm-manual-1/);
});

test("playbook handler: action edits vacancy field deterministically", async () => {
  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /SET must_haves/);
    assert.deepEqual(values, ['["Опыт B2B","CRM"]', "vac-1"]);
    return [];
  });

  const result = await handleActionStep({
    step: {
      notes: JSON.stringify({ action: "edit_vacancy_field" }),
      next_step_order: null
    },
    context: {
      vacancy_id: "vac-1",
      edit_field: "Обязательные требования",
      edit_value: "Опыт B2B; CRM"
    },
    tenantSql
  });

  assert.match(result.reply.content, /Поле вакансии обновлено/);
  assert.match(result.reply.content, /Обязательные требования/);
  assert.match(result.reply.content, /Опыт B2B; CRM/);
});

test("playbook handler: action pauses vacancy and blocks pending queue", async () => {
  const calls = [];
  const tenantSql = createMockSql(({ text, values }) => {
    calls.push({ text, values });

    if (text.includes("SELECT vacancy_id, job_id, title, status")) {
      assert.deepEqual(values, ["vac-1"]);
      return [{
        vacancy_id: "vac-1",
        job_id: "job-1",
        title: "Sales manager",
        status: "active"
      }];
    }

    if (text.includes("UPDATE chatbot.planned_messages pm")) {
      assert.deepEqual(values, ["job-1"]);
      return [{ planned_message_id: "pm-1" }];
    }

    return [];
  });

  const result = await handleActionStep({
    step: {
      notes: JSON.stringify({ action: "pause_vacancy" }),
      next_step_order: null
    },
    context: {
      vacancy_id: "vac-1"
    },
    tenantSql
  });

  assert.match(result.reply.content, /Вакансия поставлена на паузу/);
  assert.match(result.reply.content, /Заблокировано сообщений в очереди: 1/);
  assert.ok(calls.some((call) => call.text.includes("SET status = 'paused'")));
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
        job_id: input.jobId,
        job_setup_id: input.jobSetupId ?? input.vacancyId,
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
    return [{ vacancy_id: "vac-7", job_id: "job-7", raw_text: "raw text", title: "Ops manager" }];
  });

  const result = await dispatch({
    managementStore,
    tenantSql,
    tenantId: "tenant-1",
    recruiterId: "rec-1",
    vacancyId: "vac-7",
    jobId: "job-7",
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
  assert.deepEqual(calls[1][1].context, {
    vacancy_id: "vac-7",
    job_id: "job-7",
    job_setup_id: "vac-7"
  });
  assert.deepEqual(calls.at(-1), [
    "update",
    "sess-1",
    {
      currentStepOrder: 1,
      context: {
        vacancy_id: "vac-7",
        job_id: "job-7",
        job_setup_id: "vac-7",
        job_setup: { vacancy_id: "vac-7", job_id: "job-7", raw_text: "raw text", title: "Ops manager" },
        vacancy: { vacancy_id: "vac-7", job_id: "job-7", raw_text: "raw text", title: "Ops manager" },
        raw_job_setup_text: "raw text",
        raw_vacancy_text: "raw text"
      },
      vacancyId: "vac-7",
      jobId: "job-7",
      jobSetupId: "vac-7"
    }
  ]);
});

test("playbook runtime: seeds initial client context into new playbook session", async () => {
  const calls = [];
  const managementStore = {
    async getPlaybookSteps() {
      return [{
        step_key: "reject_candidate.1",
        step_order: 1,
        step_type: "display",
        user_message: "Подтвердите действие",
        options: "Да;Нет",
        next_step_order: null
      }];
    },
    async getActiveSession() {
      return null;
    },
    async abortActiveSessions() {},
    async createPlaybookSession(input) {
      calls.push(input);
      return {
        session_id: "sess-ctx-1",
        playbook_key: input.playbookKey,
        current_step_order: input.currentStepOrder,
        vacancy_id: input.vacancyId,
        job_id: input.jobId,
        job_setup_id: input.jobSetupId ?? input.vacancyId,
        context: input.context,
        call_stack: [],
        status: "active"
      };
    },
    async updateSession() {},
    async completeSession() {}
  };

  await dispatch({
    managementStore,
    tenantSql: null,
    tenantId: "tenant-1",
    recruiterId: "rec-1",
    vacancyId: "vac-1",
    jobId: "job-1",
    playbookKey: "reject_candidate",
    clientContext: {
      candidate_id: "cand-1",
      conversation_id: "conv-1",
      pipeline_run_id: "run-1"
    }
  });

  assert.deepEqual(calls[0].context, {
    vacancy_id: "vac-1",
    job_id: "job-1",
    job_setup_id: "vac-1",
    client_context: {
      candidate_id: "cand-1",
      conversation_id: "conv-1",
      pipeline_run_id: "run-1"
    },
    candidate_id: "cand-1",
    conversation_id: "conv-1",
    pipeline_run_id: "run-1"
  });
});

test("playbook runtime: check_candidate can resolve snapshot directly from client context", async () => {
  const managementStore = {
    async getPlaybookSteps() {
      return [
        {
          step_key: "check_candidate.1",
          step_order: 1,
          step_type: "decision",
          notes: JSON.stringify({
            rules: [
              {
                condition: "Boolean(context.conversation_id || context.client_context?.conversation_id)",
                next: 3
              },
              { default: true, next: 2 }
            ]
          })
        },
        {
          step_key: "check_candidate.2",
          step_order: 2,
          step_type: "user_input",
          user_message: "Укажите кандидата",
          context_key: "candidate_lookup_query",
          next_step_order: 3
        },
        {
          step_key: "check_candidate.3",
          step_order: 3,
          step_type: "data_fetch",
          context_key: "candidate_snapshot",
          notes: JSON.stringify({ source: "candidate_snapshot" }),
          next_step_order: 4
        },
        {
          step_key: "check_candidate.4",
          step_order: 4,
          step_type: "display",
          user_message: "{{context.candidate_snapshot | candidate_snapshot}}",
          next_step_order: null
        }
      ];
    },
    async getActiveSession() {
      return null;
    },
    async abortActiveSessions() {},
    async createPlaybookSession(input) {
      return {
        session_id: "sess-read-1",
        playbook_key: input.playbookKey,
        current_step_order: input.currentStepOrder,
        vacancy_id: input.vacancyId,
        job_id: input.jobId,
        job_setup_id: input.jobSetupId,
        context: input.context,
        call_stack: [],
        status: "active"
      };
    },
    async updateSession() {},
    async completeSession() {}
  };

  const tenantSql = createMockSql(({ text, values }) => {
    assert.match(text, /WITH candidate_scope AS/i);
    assert.deepEqual(values, ["tenant-1", null, null, null, null, "conv-1", "conv-1", null, null]);
    return [{
      pipeline_run_id: "run-1",
      job_id: "job-1",
      candidate_id: "cand-1",
      conversation_id: "conv-1",
      run_status: "active",
      display_name: "Иван",
      vacancy_id: "vac-1",
      vacancy_title: "Sales manager",
      current_step: "Скрининг",
      awaiting_reply: true,
      current_step_updated_at: new Date(Date.now() - 10 * 36e5).toISOString(),
      last_message_direction: "inbound",
      last_message_body: "Добрый день",
      last_message_at: new Date(Date.now() - 1 * 36e5).toISOString(),
      next_message_body: "Напомню позже",
      next_message_review_status: "approved",
      next_message_send_after: new Date(Date.now() + 2 * 36e5).toISOString()
    }];
  });

  const result = await dispatch({
    managementStore,
    tenantSql,
    tenantId: "tenant-1",
    recruiterId: "rec-1",
    playbookKey: "check_candidate",
    clientContext: {
      conversation_id: "conv-1"
    }
  });

  assert.equal(result.reply.kind, "display");
  assert.match(result.reply.content, /# Иван/);
  assert.match(result.reply.content, /Скрининг/);
});

test("playbook runtime: parses stringified session context before injecting vacancy_id", async () => {
  const calls = [];
  const managementStore = {
    async getPlaybookSteps(playbookKey) {
      assert.equal(playbookKey, "setup_communication");
      return [{
        stepKey: "setup_communication.0",
        stepOrder: 0,
        stepType: "user_input",
        userMessage: "Что уточнить по вакансии?",
        contextKey: "question",
        nextStepOrder: 1
      }];
    },
    async getActiveSession(params) {
      calls.push(["getActiveSession", params]);
      return {
        sessionId: "sess-existing",
        playbookKey: "setup_communication",
        jobId: "job-prod-004",
        jobSetupId: "job-prod-004",
        vacancyId: "job-prod-004",
        currentStepOrder: 0,
        context: "{\"vacancy_id\":\"job-prod-004\",\"job_id\":\"job-prod-004\",\"job_setup_id\":\"job-prod-004\"}",
        callStack: [],
        status: "active"
      };
    },
    async abortActiveSessions() {
      throw new Error("should not abort when active session exists");
    },
    async createPlaybookSession() {
      throw new Error("should not create a new session");
    },
    async updateSession(sessionId, patch) {
      calls.push(["update", sessionId, patch]);
    },
    async completeSession() {
      throw new Error("should not complete on awaiting input");
    }
  };

  const result = await dispatch({
    managementStore,
    tenantSql: null,
    tenantId: "tenant-1",
    recruiterId: "rec-1",
    vacancyId: "job-prod-004",
    playbookKey: "setup_communication",
    recruiterInput: null,
    llmAdapter: null
  });

  assert.equal(result.sessionId, "sess-existing");
  assert.deepEqual(result.reply, {
    kind: "user_input",
    message: "Что уточнить по вакансии?"
  });
  assert.deepEqual(calls.at(-1), [
    "update",
    "sess-existing",
    {
      currentStepOrder: 0,
      context: {
        vacancy_id: "job-prod-004",
        job_id: "job-prod-004",
        job_setup_id: "job-prod-004"
      },
      vacancyId: "job-prod-004",
      jobId: "job-prod-004",
      jobSetupId: "job-prod-004"
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
