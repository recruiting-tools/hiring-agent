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
    /"salary_range"/
  );
  assert.equal(
    interpolate("{{context.must_haves | json}}", context),
    "[\"Опыт B2B продаж\",\"Готовность к командировкам\"]"
  );
});

test("interpolate: renders application step arrays as a compact table", () => {
  const result = interpolate("{{context.application_steps | table}}", {
    application_steps: [
      { name: "Проверить опыт", type: "must_have_check", in_our_scope: true, is_target: false },
      { name: "Назначить пробный день", type: "target_action", in_our_scope: true, is_target: true }
    ]
  });

  assert.match(result, /\| name \| type \| in_our_scope \| is_target \|/);
  assert.match(result, /\| Проверить опыт \| must_have_check \| true \| false \|/);
  assert.match(result, /\| Назначить пробный день \| target_action \| true \| true \|/);
});

test("interpolate: missing values resolve to empty strings", () => {
  const result = interpolate("{{context.missing.value}}", {});
  assert.equal(result, "");
});
