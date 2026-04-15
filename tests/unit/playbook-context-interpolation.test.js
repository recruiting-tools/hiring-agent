import assert from "node:assert/strict";
import test from "node:test";
import { interpolate } from "../../services/hiring-agent/src/playbooks/context-interpolation.js";

test("interpolate: replaces dotted context paths", () => {
  const result = interpolate("Vacancy: {{context.vacancy.title}}", {
    vacancy: { title: "Senior Recruiter" }
  });

  assert.equal(result, "Vacancy: Senior Recruiter");
});

test("interpolate: supports list and object filters used by seeded playbooks", () => {
  const context = {
    must_haves: ["Опыт B2B продаж", "Готовность к командировкам"],
    work_conditions: {
      salary_range: { min: 200000, max: 260000 },
      remote: false
    },
    application_steps: [
      { name: "Проверить B2B опыт", in_our_scope: true },
      { name: "Собеседование с руководителем", in_our_scope: false }
    ],
    faq: [
      { q: "Какая зарплата?", a: "200-260 тыс. руб." },
      { q: "Есть ли удаленка?", a: "Нет." }
    ]
  };

  assert.equal(
    interpolate("{{context.must_haves | bullet_list}}", context),
    "• Опыт B2B продаж\n• Готовность к командировкам"
  );
  assert.equal(
    interpolate("{{context.application_steps | names_only}}", context),
    "Проверить B2B опыт, Собеседование с руководителем"
  );
  assert.equal(
    interpolate("{{context.application_steps | in_scope_only}}", context),
    "Проверить B2B опыт"
  );
  assert.equal(
    interpolate("{{context.faq | qa_list}}", context),
    "Q: Какая зарплата?\nA: 200-260 тыс. руб.\n\nQ: Есть ли удаленка?\nA: Нет."
  );
  assert.match(
    interpolate("{{context.work_conditions | formatted}}", context),
    /Зарплата: 200.*₽–260.*₽/
  );
  assert.match(
    interpolate("{{context.work_conditions | formatted}}", context),
    /Удалёнка: нет/
  );
  assert.equal(
    interpolate("{{context.must_haves | json}}", context),
    "[\"Опыт B2B продаж\",\"Готовность к командировкам\"]"
  );
  assert.match(
    interpolate("{{context.must_haves | must_haves_review}}", context),
    /Нашли следующие обязательные требования:/
  );
});

test("interpolate: renders application step arrays as a compact table", () => {
  const result = interpolate("{{context.application_steps | table}}", {
    application_steps: [
      {
        name: "Проверить опыт",
        type: "must_have_check",
        what: "Понять, был ли похожий опыт.",
        script: "Попросить короткий пример.",
        in_our_scope: true,
        is_target: false
      },
      {
        name: "Назначить пробный день",
        type: "target_action",
        what: "Согласовать следующий шаг.",
        script: "Предложить 2-3 слота.",
        in_our_scope: true,
        is_target: true
      }
    ]
  });

  assert.match(result, /\| Этап \| Тип \| Что проверяем \| Как спрашиваем \| Цель \|/);
  assert.match(result, /\| Проверить опыт \| Must-have \| Понять, был ли похожий опыт\. \| Попросить короткий пример\. \| Нет \|/);
  assert.match(result, /\| Назначить пробный день \| Целевое действие \| Согласовать следующий шаг\. \| Предложить 2-3 слота\. \| Да \|/);
});

test("interpolate: missing values resolve to empty strings", () => {
  const result = interpolate("{{context.missing.value}}", {});
  assert.equal(result, "");
});

test("interpolate: supports seeded html, funnel_table, and vacancy_card filters", () => {
  const context = {
    generated_messages: "<div class=\"message-variant\"><p>Привет</p></div>",
    funnel_data: [
      { step_name: "Первый контакт", total: 5, in_progress: 2, completed: 2, stuck: 1, rejected: 0 }
    ],
    vacancy: {
      title: "Оператор склада",
      must_haves: ["Опыт от 1 года"],
      application_steps: [{ name: "Созвон", type: "screening", in_our_scope: true, is_target: false }]
    }
  };

  assert.equal(
    interpolate("{{context.generated_messages | html}}", context),
    "<div class=\"message-variant\"><p>Привет</p></div>"
  );
  assert.match(
    interpolate("{{context.funnel_data | funnel_table}}", context),
    /\| Этап \| Всего \| В работе \| Завершено \| Зависли \| Отказ \|/
  );
  assert.match(
    interpolate("{{context.vacancy | vacancy_card}}", context),
    /# Оператор склада/
  );
});
