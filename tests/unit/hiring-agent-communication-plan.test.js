import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runCommunicationPlanPlaybook } from "../../services/hiring-agent/src/playbooks/communication-plan.js";

test("communication plan: returns saved plan without LLM call", async () => {
  const savedPlan = {
    scenario_title: "Базовый скрининг",
    goal: "Договоренность о собеседовании",
    steps: [
      { step: "Приветствие и вопрос мотивации?", reminders_count: 1, comment: "Открыть диалог" },
      { step: "Проверка must-have", reminders_count: 1, comment: "Коротко по опыту" },
      { step: "Сверка условий", reminders_count: 1, comment: "Синхронизируем ожидания" },
      { step: "Приглашение на интервью", reminders_count: 2, comment: "Зафиксировать слот" }
    ]
  };

  const store = createVacancySql({
    vacancy_id: "vac-1",
    title: "Менеджер по продажам",
    communication_plan: savedPlan,
    communication_plan_draft: null,
    communication_examples: []
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-1",
    recruiterInput: "настроить общение с кандидатами",
    llmAdapter: {
      async generate() {
        throw new Error("LLM must not be called for saved plan preview");
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.is_configured, true);
  assert.deepEqual(
    result.reply.actions.map((item) => item.label),
    ["Запустить", "Сгенерировать примеры общения", "Поправить"]
  );
  assert.equal(result.reply.steps.length, 4);
});

test("communication plan: creates draft on initial generation", async () => {
  const store = createVacancySql({
    vacancy_id: "vac-2",
    title: "Менеджер по продажам",
    must_haves: ["B2B продажи"],
    nice_haves: ["CRM"],
    work_conditions: { schedule: "5/2" },
    application_steps: [{ name: "Первичный скрининг", in_our_scope: true, script: "Привет + вопрос" }],
    communication_plan: null,
    communication_plan_draft: null,
    communication_examples: []
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-2",
    recruiterInput: "настроить общение с кандидатами",
    llmAdapter: {
      async generate() {
        return JSON.stringify({
          scenario_title: "Фокус на мотивации",
          goal: "Назначить интервью",
          steps: [
            { step: "Приветствие + вопрос", reminders_count: 1, comment: "Открыть разговор" },
            { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Короткий скрининг" },
            { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП/графику" },
            { step: "Приглашение на интервью", reminders_count: 2, comment: "Фиксируем слот" }
          ]
        });
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.is_configured, false);
  assert.deepEqual(
    result.reply.actions.map((item) => item.label),
    ["Сохранить", "Запустить", "Сгенерировать примеры общения", "Поправить"]
  );
  assert.equal(store.getVacancy().communication_plan_draft.scenario_title, "Фокус на мотивации");
});

test("communication plan: repairs invalid stored communication state before generating draft", async () => {
  const store = createVacancySql({
    vacancy_id: "vac-2repair",
    title: "Менеджер по продажам",
    must_haves: ["B2B продажи"],
    application_steps: [{ name: "Первичный скрининг", in_our_scope: true, script: "Привет + вопрос" }],
    communication_plan: { stale: true },
    communication_plan_draft: { broken: true },
    communication_examples: { stale: true },
    communication_examples_plan_hash: "legacy-hash"
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-2repair",
    recruiterInput: "настроить общение с кандидатами",
    llmAdapter: {
      async generate() {
        return JSON.stringify({
          scenario_title: "Фокус на мотивации",
          goal: "Назначить интервью",
          steps: [
            { step: "Приветствие + вопрос", reminders_count: 1, comment: "Открыть разговор" },
            { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Короткий скрининг" },
            { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП/графику" },
            { step: "Приглашение на интервью", reminders_count: 2, comment: "Фиксируем слот" }
          ]
        });
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(store.getVacancy().communication_plan, null);
  assert.equal(store.getVacancy().communication_examples_plan_hash, null);
  assert.deepEqual(store.getVacancy().communication_examples, []);
  assert.equal(store.getVacancy().communication_plan_draft.scenario_title, "Фокус на мотивации");
});

test("communication plan: retries once when first LLM draft is invalid", async () => {
  const store = createVacancySql({
    vacancy_id: "vac-2a",
    title: "Менеджер по продажам",
    must_haves: ["B2B продажи"],
    nice_haves: ["CRM"],
    work_conditions: { schedule: "5/2" },
    application_steps: [{ name: "Первичный скрининг", in_our_scope: true, script: "Привет + вопрос" }],
    communication_plan: null,
    communication_plan_draft: null,
    communication_examples: []
  });

  const prompts = [];
  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-2a",
    recruiterInput: "настроить общение с кандидатами",
    llmAdapter: {
      async generate(prompt) {
        prompts.push(String(prompt));
        if (prompts.length === 1) {
          return JSON.stringify({
            scenario_title: "Сломанный сценарий",
            goal: "Назначить интервью",
            steps: [
              { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Без приветствия" },
              { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП/графику" },
              { step: "Финальное уточнение", reminders_count: 1, comment: "Без следующего этапа" },
              { step: "Завершение разговора", reminders_count: 0, comment: "Просто закрыть диалог" }
            ]
          });
        }

        return JSON.stringify({
          scenario_title: "Фокус на мотивации",
          goal: "Назначить интервью",
          steps: [
            { step: "Здравствуйте! Подскажите, вам сейчас интересны новые предложения?", reminders_count: 1, comment: "Открыть разговор и проверить интерес" },
            { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Короткий скрининг" },
            { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП/графику" },
            { step: "Приглашение на интервью", reminders_count: 2, comment: "Фиксируем слот" }
          ]
        });
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.scenario_title, "Фокус на мотивации");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Предыдущий ответ не прошел валидацию/i);
  assert.equal(store.getVacancy().communication_plan_draft.scenario_title, "Фокус на мотивации");
});

test("communication plan: returns non-500 reply when draft save hits draft constraint", async () => {
  const store = createVacancySql({
    vacancy_id: "vac-2b",
    title: "Менеджер по продажам",
    must_haves: ["B2B продажи"],
    nice_haves: ["CRM"],
    work_conditions: { schedule: "5/2" },
    application_steps: [{ name: "Первичный скрининг", in_our_scope: true, script: "Привет + вопрос" }],
    communication_plan: null,
    communication_plan_draft: null,
    communication_examples: [],
    failOnDraftUpdateConstraint: true
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-2b",
    recruiterInput: "настроить общение с кандидатами",
    llmAdapter: {
      async generate() {
        return JSON.stringify({
          scenario_title: "Фокус на мотивации",
          goal: "Назначить интервью",
          steps: [
            { step: "Приветствие + вопрос", reminders_count: 1, comment: "Открыть разговор" },
            { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Короткий скрининг" },
            { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП/графику" },
            { step: "Приглашение на интервью", reminders_count: 2, comment: "Фиксируем слот" }
          ]
        });
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.is_configured, false);
  assert.match(result.reply.note, /черновик не сохранился/i);
});

test("communication plan: save command can persist transient draft from previous reply", async () => {
  const store = createVacancySql({
    vacancy_id: "vac-2c",
    title: "Менеджер по продажам",
    communication_plan: null,
    communication_plan_draft: null,
    communication_examples: []
  });

  const transientReply = {
    kind: "communication_plan",
    scenario_title: "Транзиентный черновик",
    goal: "Назначить интервью",
    steps: [
      { step: "Здравствуйте! Вам сейчас интересны новые предложения?", reminders_count: 1, comment: "Открыть диалог" },
      { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Короткий скрининг" },
      { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП и графику" },
      { step: "Приглашение на интервью", reminders_count: 2, comment: "Фиксируем слот" }
    ],
    examples: [
      { title: "Деловой", message: "Здравствуйте! Что сейчас важно в новой роли?" }
    ],
    conversation_examples: []
  };

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-2c",
    recruiterInput: "настроить общение: сохранить настройку коммуникаций",
    clientContext: transientReply,
    llmAdapter: null
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.is_configured, true);
  assert.equal(store.getVacancy().communication_plan.scenario_title, "Транзиентный черновик");
  assert.equal(store.getVacancy().communication_examples.length, 1);
});

test("communication plan: save command moves draft to saved plan", async () => {
  const draft = {
    scenario_title: "Черновик",
    goal: "Назначить звонок",
    steps: [
      { step: "Приветствие и короткий вопрос?", reminders_count: 0, comment: "Коротко и тепло" },
      { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Уточнить контекст" },
      { step: "Проверка ожиданий", reminders_count: 1, comment: "ЗП и график" },
      { step: "Приглашение на звонок", reminders_count: 2, comment: "Подтвердить время" }
    ]
  };

  const store = createVacancySql({
    vacancy_id: "vac-3",
    title: "Менеджер по продажам",
    communication_plan: null,
    communication_plan_draft: draft,
    communication_examples: []
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-3",
    recruiterInput: "настроить общение: сохранить настройку коммуникаций",
    llmAdapter: null
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.is_configured, true);
  assert.equal(store.getVacancy().communication_plan.scenario_title, "Черновик");
  assert.equal(store.getVacancy().communication_plan_draft, null);
});

test("communication plan: start command generates and stores examples", async () => {
  const savedPlan = {
    scenario_title: "Сценарий",
    goal: "Собеседование",
    steps: [
      { step: "Приветствие и уточняющий вопрос?", reminders_count: 1, comment: "Установить контакт" },
      { step: "Квалификация", reminders_count: 1, comment: "Понять релевантность" },
      { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП и графику" },
      { step: "Приглашение на интервью", reminders_count: 2, comment: "Согласовать слот" }
    ]
  };

  const store = createVacancySql({
    vacancy_id: "vac-4",
    title: "Менеджер по продажам",
    communication_plan: savedPlan,
    communication_plan_draft: null,
    communication_examples: []
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-4",
    recruiterInput: "настроить общение: запустить сценарий коммуникаций",
    llmAdapter: {
      async generate() {
        return JSON.stringify([
          { title: "Деловой", message: "Добрый день! Что для вас ключевое в новой роли сейчас?" },
          { title: "Теплый", message: "Здравствуйте! Расскажите, что мотивирует вас рассматривать смену работы?" },
          { title: "Живой", message: "Привет! Что важно получить от следующего работодателя в первую очередь?" }
        ]);
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.examples.length, 3);
  assert.equal(store.getVacancy().communication_examples.length, 3);
  assert.equal(typeof store.getVacancy().communication_examples_plan_hash, "string");
  assert.deepEqual(
    result.reply.actions.map((item) => item.label),
    ["Запустить", "Сгенерировать примеры общения", "Поправить"]
  );
});

test("communication plan: start command tolerates examples constraint errors", async () => {
  const savedPlan = {
    scenario_title: "Сценарий",
    goal: "Собеседование",
    steps: [
      { step: "Приветствие и уточняющий вопрос?", reminders_count: 1, comment: "Установить контакт" },
      { step: "Квалификация", reminders_count: 1, comment: "Понять релевантность" },
      { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП и графику" },
      { step: "Приглашение на интервью", reminders_count: 2, comment: "Согласовать слот" }
    ]
  };

  const store = createVacancySql({
    vacancy_id: "vac-4aa",
    title: "Менеджер по продажам",
    communication_plan: savedPlan,
    communication_plan_draft: null,
    communication_examples: [],
    failOnExamplesUpdateConstraint: true
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-4aa",
    recruiterInput: "настроить общение: запустить сценарий коммуникаций",
    llmAdapter: {
      async generate() {
        return JSON.stringify([
          { title: "Деловой", message: "Добрый день! Что для вас ключевое в новой роли сейчас?" },
          { title: "Теплый", message: "Здравствуйте! Расскажите, что мотивирует вас рассматривать смену работы?" },
          { title: "Живой", message: "Привет! Что важно получить от следующего работодателя в первую очередь?" }
        ]);
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.examples.length, 3);
  assert.match(result.reply.note, /не удалось/i);
  assert.equal(store.getVacancy().communication_examples.length, 0);
});

test("communication plan: generate conversations command stores recruiter-candidate dialogs", async () => {
  const savedPlan = {
    scenario_title: "Сценарий",
    goal: "Собеседование",
    steps: [
      { step: "Приветствие и уточняющий вопрос?", reminders_count: 1, comment: "Установить контакт" },
      { step: "Квалификация", reminders_count: 1, comment: "Понять релевантность" },
      { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП и графику" },
      { step: "Приглашение на интервью", reminders_count: 2, comment: "Согласовать слот" }
    ]
  };

  const store = createVacancySql({
    vacancy_id: "vac-4b",
    title: "Менеджер по продажам",
    communication_plan: savedPlan,
    communication_plan_draft: null,
    communication_examples: [
      { title: "Деловой", message: "Добрый день! Что для вас ключевое в новой роли?" }
    ]
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-4b",
    recruiterInput: "настроить общение: сгенерировать примеры общения",
    llmAdapter: {
      async generate() {
        return JSON.stringify([
          {
            title: "Сильный опыт B2B",
            summary: "Кандидат 5 лет в B2B, мотивация на рост дохода",
            turns: [
              { speaker: "recruiter", message: "Здравствуйте! Готовы обсудить новую роль?" },
              { speaker: "candidate", message: "Да, рассматриваю варианты." },
              { speaker: "recruiter", message: "Какой у вас опыт B2B-продаж?" },
              { speaker: "candidate", message: "5 лет, сложные сделки до 6 месяцев." },
              { speaker: "recruiter", message: "Подходит. Готовы к интервью завтра?" },
              { speaker: "candidate", message: "Да, завтра после 14:00 удобно." }
            ]
          }
        ]);
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.conversation_examples.length, 1);
  assert.equal(result.reply.examples.length, 0);
  assert.equal(store.getVacancy().communication_examples.length, 1);
  assert.equal(typeof store.getVacancy().communication_examples_plan_hash, "string");
});

test("communication plan: generate conversations tolerates examples constraint errors", async () => {
  const savedPlan = {
    scenario_title: "Сценарий",
    goal: "Собеседование",
    steps: [
      { step: "Приветствие и уточняющий вопрос?", reminders_count: 1, comment: "Установить контакт" },
      { step: "Квалификация", reminders_count: 1, comment: "Понять релевантность" },
      { step: "Сверка условий", reminders_count: 1, comment: "Ожидания по ЗП и графику" },
      { step: "Приглашение на интервью", reminders_count: 2, comment: "Согласовать слот" }
    ]
  };

  const store = createVacancySql({
    vacancy_id: "vac-4bb",
    title: "Менеджер по продажам",
    communication_plan: savedPlan,
    communication_plan_draft: null,
    communication_examples: [
      { title: "Деловой", message: "Добрый день! Что для вас ключевое в новой роли?" }
    ],
    failOnExamplesUpdateConstraint: true
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-4bb",
    recruiterInput: "настроить общение: сгенерировать примеры общения",
    llmAdapter: {
      async generate() {
        return JSON.stringify([
          {
            title: "Сильный опыт B2B",
            summary: "Кандидат 5 лет в B2B, мотивация на рост дохода",
            turns: [
              { speaker: "recruiter", message: "Здравствуйте! Готовы обсудить новую роль?" },
              { speaker: "candidate", message: "Да, рассматриваю варианты." },
              { speaker: "recruiter", message: "Какой у вас опыт B2B-продаж?" },
              { speaker: "candidate", message: "5 лет, сложные сделки до 6 месяцев." },
              { speaker: "recruiter", message: "Подходит. Готовы к интервью завтра?" },
              { speaker: "candidate", message: "Да, завтра после 14:00 удобно." }
            ]
          }
        ]);
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.conversation_examples.length, 1);
  assert.match(result.reply.note, /не удалось/i);
  assert.equal(store.getVacancy().communication_examples.length, 1);
  assert.equal(store.getVacancy().communication_examples[0].title, "Деловой");
});

test("communication plan: generate conversations can continue from transient draft reply", async () => {
  const store = createVacancySql({
    vacancy_id: "vac-4c",
    title: "Менеджер по закупкам",
    communication_plan: null,
    communication_plan_draft: null,
    communication_examples: []
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-4c",
    recruiterInput: "настроить общение: сгенерировать примеры общения",
    clientContext: {
      kind: "communication_plan",
      scenario_title: "Первичный скрининг Менеджера по закупкам",
      goal: "Договориться о следующем этапе интервью",
      steps: [
        { step: "Приветствие и вопрос о текущем интересе к вакансии?", reminders_count: 1, comment: "Открыть диалог и понять мотивацию кандидата" },
        { step: "Проверка опыта в закупках и работе с поставщиками", reminders_count: 1, comment: "Уточнить релевантность опыта" },
        { step: "Сверка по категориям закупок и масштабу задач", reminders_count: 1, comment: "Понять, с какими задачами кандидат уже работал" },
        { step: "Приглашение на следующий этап интервью", reminders_count: 2, comment: "Предложить слот и зафиксировать дальнейший шаг" }
      ]
    },
    llmAdapter: {
      async generate() {
        return JSON.stringify([
          {
            title: "Категорийный закупщик",
            summary: "Опыт в непрямых закупках и переговорах",
            turns: [
              { speaker: "recruiter", message: "Здравствуйте! Готовы обсудить вакансию менеджера по закупкам?" },
              { speaker: "candidate", message: "Да, тема интересна." },
              { speaker: "recruiter", message: "С какими категориями закупок вы работали в последние два года?" },
              { speaker: "candidate", message: "Непрямые закупки, логистика и упаковка." },
              { speaker: "recruiter", message: "Подходит. Удобно перейти к интервью в четверг?" },
              { speaker: "candidate", message: "Да, четверг после 15:00 подойдёт." }
            ]
          }
        ]);
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.scenario_title, "Первичный скрининг Менеджера по закупкам");
  assert.equal(result.reply.conversation_examples.length, 1);
  assert.equal(store.getVacancy().communication_examples.length, 1);
});

test("communication plan: save clears stale examples from previous plan", async () => {
  const oldPlan = {
    scenario_title: "Старый план",
    goal: "Старое интервью",
    steps: [
      { step: "Приветствие и вопрос?", reminders_count: 1, comment: "Контакт" },
      { step: "Проверка опыта", reminders_count: 1, comment: "Быстрый скрининг" },
      { step: "Сверка условий", reminders_count: 1, comment: "Ожидания" },
      { step: "Приглашение на интервью", reminders_count: 2, comment: "Слот" }
    ]
  };

  const newDraft = {
    scenario_title: "Новый план",
    goal: "Новый звонок",
    steps: [
      { step: "Приветствие и мотивационный вопрос?", reminders_count: 1, comment: "Открыть диалог" },
      { step: "Квалификация", reminders_count: 1, comment: "Проверка релевантности" },
      { step: "Сверка условий", reminders_count: 1, comment: "Синхронизировать ожидания" },
      { step: "Приглашение на звонок", reminders_count: 2, comment: "Подтвердить время" }
    ]
  };

  const store = createVacancySql({
    vacancy_id: "vac-5",
    title: "Менеджер по продажам",
    communication_plan: oldPlan,
    communication_plan_draft: newDraft,
    communication_examples: [
      { title: "Старый", message: "Старое сообщение" }
    ],
    communication_examples_plan_hash: computePlanHashForTest(oldPlan)
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-5",
    recruiterInput: "настроить общение: сохранить настройку коммуникаций",
    llmAdapter: null
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.examples.length, 0);
  assert.equal(store.getVacancy().communication_examples.length, 0);
  assert.equal(store.getVacancy().communication_examples_plan_hash, null);
});

test("communication plan: uses playbook-specific model overrides", async () => {
  const store = createVacancySql({
    vacancy_id: "vac-6",
    title: "Менеджер по продажам",
    must_haves: ["B2B"],
    application_steps: [{ name: "Скрининг", in_our_scope: true, script: "Привет + вопрос" }]
  });

  const planModelCalls = [];
  const examplesModelCalls = [];
  const llmAdapter = {
    async generate(prompt, options) {
      if (String(prompt).includes("Формат JSON:") && String(prompt).includes("\"scenario_title\"")) {
        planModelCalls.push(options?.model ?? null);
        return JSON.stringify({
          scenario_title: "План",
          goal: "Собеседование",
          steps: [
            { step: "Приветствие и вопрос?", reminders_count: 1, comment: "Контакт" },
            { step: "Проверка опыта", reminders_count: 1, comment: "Скрининг" },
            { step: "Сверка условий", reminders_count: 1, comment: "Ожидания" },
            { step: "Приглашение на интервью", reminders_count: 2, comment: "Слот" }
          ]
        });
      }

      examplesModelCalls.push(options?.model ?? null);
      return JSON.stringify([
        { title: "A", message: "Здравствуйте! Что для вас главное в новой роли?" },
        { title: "B", message: "Добрый день! Что для вас важно в формате работы?" },
        { title: "C", message: "Привет! Что мотивирует рассматривать смену работы?" }
      ]);
    }
  };

  await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-6",
    recruiterInput: "настроить общение с кандидатами",
    llmAdapter,
    llmConfig: {
      planModel: "openai/gpt-5.4-mini",
      examplesModel: "google/gemini-2.5-flash"
    }
  });

  await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-6",
    recruiterInput: "настроить общение: запустить сценарий коммуникаций",
    llmAdapter,
    llmConfig: {
      planModel: "openai/gpt-5.4-mini",
      examplesModel: "google/gemini-2.5-flash"
    }
  });

  assert.deepEqual(planModelCalls, ["openai/gpt-5.4-mini"]);
  assert.deepEqual(examplesModelCalls, ["google/gemini-2.5-flash"]);
});

test("communication plan: plan prompt includes recruiter request and vacancy materials", async () => {
  const store = createVacancySql({
    vacancy_id: "vac-6b",
    title: "Менеджер по закупкам",
    raw_text: "Нужен опыт в категорийных закупках, тендерах и переговорах с поставщиками.",
    source_materials: {
      contract_data: {
        payment_terms: "60 дней",
        incoterms: "FCA"
      }
    },
    must_haves: ["Категорийные закупки"],
    application_steps: [{ name: "Скрининг", in_our_scope: true, script: "Привет + вопрос" }]
  });

  const prompts = [];
  await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "vac-6b",
    recruiterInput: "поправить сценарий с учетом условий контракта",
    llmAdapter: {
      async generate(prompt) {
        prompts.push(String(prompt));
        return JSON.stringify({
          scenario_title: "План",
          goal: "Собеседование",
          steps: [
            { step: "Здравствуйте! Вам интересно обсудить роль?", reminders_count: 1, comment: "Контакт" },
            { step: "Проверка опыта", reminders_count: 1, comment: "Скрининг" },
            { step: "Сверка условий", reminders_count: 1, comment: "Ожидания" },
            { step: "Приглашение на интервью", reminders_count: 2, comment: "Слот" }
          ]
        });
      }
    }
  });

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Последний запрос рекрутера:/);
  assert.match(prompts[0], /поправить сценарий с учетом условий контракта/i);
  assert.match(prompts[0], /Материалы вакансии:/);
  assert.match(prompts[0], /Нужен опыт в категорийных закупках/i);
  assert.match(prompts[0], /contract_data/i);
});

test("communication plan: resolves vacancy by job_id when selector passes job value", async () => {
  const savedPlan = {
    scenario_title: "Сохраненный сценарий",
    goal: "Назначить интервью",
    steps: [
      { step: "Приветствие и вопрос?", reminders_count: 1, comment: "Открываем диалог" },
      { step: "Проверка опыта", reminders_count: 1, comment: "Скрининг" },
      { step: "Сверка условий", reminders_count: 1, comment: "Ожидания" },
      { step: "Приглашение на интервью", reminders_count: 2, comment: "Слот" }
    ]
  };

  const store = createVacancySql({
    vacancy_id: "vac-7",
    job_id: "job-sales-1",
    title: "Менеджер по продажам",
    communication_plan: savedPlan,
    communication_plan_draft: null
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "job-sales-1",
    jobId: "job-sales-1",
    recruiterInput: "настроить общение с кандидатами",
    llmAdapter: {
      async generate() {
        throw new Error("LLM must not be called");
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(result.reply.is_configured, true);
  assert.equal(result.reply.scenario_title, "Сохраненный сценарий");
});

test("communication plan: creates draft vacancy from job when vacancy row is missing", async () => {
  const store = createVacancySql({
    noInitialVacancy: true,
    jobRecord: {
      job_id: "job-sales-2",
      title: "Менеджер по продажам",
      description: "B2B продажи, входящие лиды, CRM"
    }
  });

  const result = await runCommunicationPlanPlaybook({
    tenantSql: store.sql,
    vacancyId: "job-sales-2",
    jobId: "job-sales-2",
    recruiterInput: "настроить общение с кандидатами",
    llmAdapter: {
      async generate() {
        return JSON.stringify({
          scenario_title: "Базовый сценарий",
          goal: "Назначить интервью",
          steps: [
            { step: "Приветствие и вопрос?", reminders_count: 1, comment: "Открыть диалог" },
            { step: "Проверка релевантного опыта", reminders_count: 1, comment: "Скрининг" },
            { step: "Сверка условий", reminders_count: 1, comment: "Ожидания" },
            { step: "Приглашение на интервью", reminders_count: 2, comment: "Фиксируем слот" }
          ]
        });
      }
    }
  });

  assert.equal(result.reply.kind, "communication_plan");
  assert.equal(store.getVacancy().job_id, "job-sales-2");
  assert.equal(store.getVacancy().title, "Менеджер по продажам");
  assert.equal(result.reply.is_configured, false);
});

function createVacancySql(initialVacancy) {
  const {
    jobRecord = null,
    noInitialVacancy = false,
    failOnDraftUpdateConstraint = false,
    failOnExamplesUpdateConstraint = false,
    ...initialVacancyData
  } = structuredClone(initialVacancy ?? {});

  let sequence = 1;
  let vacancy = noInitialVacancy ? null : {
    must_haves: [],
    nice_haves: [],
    work_conditions: {},
    application_steps: [],
    communication_plan: null,
    communication_plan_draft: null,
    communication_examples: [],
    communication_examples_plan_hash: null,
    ...initialVacancyData
  };

  return {
    getVacancy() {
      return structuredClone(vacancy);
    },
    async sql(strings, ...values) {
      const text = strings.reduce((acc, chunk, index) => (
        acc + chunk + (index < values.length ? `$${index + 1}` : "")
      ), "");

      if (text.includes("SELECT *") && text.includes("FROM chatbot.vacancies") && text.includes("WHERE vacancy_id")) {
        if (!vacancy) return [];
        return String(values[0]) === String(vacancy.vacancy_id)
          ? [structuredClone(vacancy)]
          : [];
      }

      if (text.includes("SELECT *") && text.includes("FROM chatbot.vacancies") && text.includes("WHERE job_id")) {
        if (!vacancy) return [];
        return String(values[0]) === String(vacancy.job_id)
          ? [structuredClone(vacancy)]
          : [];
      }

      if (text.includes("SELECT job_id, title, description") && text.includes("FROM chatbot.jobs")) {
        if (!jobRecord) return [];
        return String(values[0]) === String(jobRecord.job_id)
          ? [structuredClone(jobRecord)]
          : [];
      }

      if (text.includes("INSERT INTO chatbot.vacancies")) {
        assert.match(text, /communication_plan/);
        assert.match(text, /communication_plan_draft/);
        assert.match(text, /communication_examples/);
        assert.match(text, /communication_examples_plan_hash/);
        assert.match(text, /'pending',\s*NULL,\s*NULL,\s*'\[\]'::jsonb,\s*NULL/);
        vacancy = {
          must_haves: [],
          nice_haves: [],
          work_conditions: {},
          application_steps: [],
          communication_plan: null,
          communication_plan_draft: null,
          communication_examples: [],
          communication_examples_plan_hash: null,
          vacancy_id: `vac-generated-${sequence++}`,
          title: values[0],
          raw_text: values[1],
          job_id: values[2]
        };
        assertVacancyCommunicationConstraints(vacancy);
        return [structuredClone(vacancy)];
      }

      if (
        text.includes("SET")
        && text.includes("communication_plan =")
        && text.includes("communication_plan_draft =")
        && text.includes("communication_examples =")
        && text.includes("communication_examples_plan_hash =")
        && text.includes("RETURNING *")
      ) {
        if (!vacancy) throw new Error("No vacancy to update");
        vacancy.communication_plan = values[0] ? JSON.parse(values[0]) : null;
        vacancy.communication_plan_draft = values[1] ? JSON.parse(values[1]) : null;
        vacancy.communication_examples = values[2] ? JSON.parse(values[2]) : [];
        vacancy.communication_examples_plan_hash = values[3] ?? null;
        assertVacancyCommunicationConstraints(vacancy);
        return [structuredClone(vacancy)];
      }

      if (text.includes("SET") && text.includes("communication_plan =") && text.includes("communication_plan_draft = NULL")) {
        if (failOnExamplesUpdateConstraint) {
          throw new Error('new row for relation "vacancies" violates check constraint "chk_vacancies_communication_examples_array"');
        }
        if (!vacancy) throw new Error("No vacancy to update");
        vacancy.communication_plan = values[0] ? JSON.parse(values[0]) : null;
        vacancy.communication_plan_draft = null;
        vacancy.communication_examples = values[1] ? JSON.parse(values[1]) : [];
        vacancy.communication_examples_plan_hash = values[2] ?? null;
        assertVacancyCommunicationConstraints(vacancy);
        return [];
      }

      if (text.includes("SET") && text.includes("communication_plan_draft") && text.includes("WHERE vacancy_id")) {
        if (failOnDraftUpdateConstraint) {
          throw new Error('new row for relation "vacancies" violates check constraint "chk_vacancies_communication_plan_draft_contract"');
        }
        if (!vacancy) throw new Error("No vacancy to update");
        vacancy.communication_plan_draft = values[0] ? JSON.parse(values[0]) : null;
        assertVacancyCommunicationConstraints(vacancy);
        return [];
      }

      if (text.includes("SET") && text.includes("communication_examples")) {
        if (failOnExamplesUpdateConstraint) {
          throw new Error('new row for relation "vacancies" violates check constraint "chk_vacancies_communication_examples_array"');
        }
        if (!vacancy) throw new Error("No vacancy to update");
        vacancy.communication_examples = values[0] ? JSON.parse(values[0]) : [];
        vacancy.communication_examples_plan_hash = values[1] ?? null;
        assertVacancyCommunicationConstraints(vacancy);
        return [];
      }

      throw new Error(`Unexpected SQL query in test: ${text}`);
    }
  };
}

function computePlanHashForTest(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function assertVacancyCommunicationConstraints(vacancy) {
  if (!vacancy) return;

  if (!matchesCommunicationPlanContract(vacancy.communication_plan)) {
    throw new Error('new row for relation "vacancies" violates check constraint "chk_vacancies_communication_plan_contract"');
  }

  if (!matchesCommunicationPlanContract(vacancy.communication_plan_draft)) {
    throw new Error('new row for relation "vacancies" violates check constraint "chk_vacancies_communication_plan_draft_contract"');
  }

  if (!Array.isArray(vacancy.communication_examples)) {
    throw new Error('new row for relation "vacancies" violates check constraint "chk_vacancies_communication_examples_array"');
  }
}

function matchesCommunicationPlanContract(plan) {
  if (plan == null) return true;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return false;
  if (!Object.hasOwn(plan, "scenario_title")) return false;
  if (!Object.hasOwn(plan, "goal")) return false;
  if (!Object.hasOwn(plan, "steps")) return false;
  return Array.isArray(plan.steps) && plan.steps.length >= 4 && plan.steps.length <= 7;
}
