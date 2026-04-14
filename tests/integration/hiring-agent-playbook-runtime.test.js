import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { dispatch } from "../../services/hiring-agent/src/playbooks/runtime.js";

const MANAGEMENT_DB_URL = process.env.PLAYBOOK_MANAGEMENT_DATABASE_URL;
const CHATBOT_DB_URL = process.env.PLAYBOOK_CHATBOT_DATABASE_URL;
const TENANT_ID = process.env.PLAYBOOK_TEST_TENANT_ID ?? "tenant-alpha-001";
const RECRUITER_ID = process.env.PLAYBOOK_TEST_RECRUITER_ID ?? "rec-alpha-001";

if (!MANAGEMENT_DB_URL || !CHATBOT_DB_URL) {
  test.skip("playbook runtime integration: PLAYBOOK_MANAGEMENT_DATABASE_URL and PLAYBOOK_CHATBOT_DATABASE_URL not set", () => {});
} else {
  test("playbook runtime integration: create_vacancy full flow completes against seeded playbook data", async (t) => {
    const managementSql = postgres(MANAGEMENT_DB_URL, { max: 1 });
    const tenantSql = postgres(CHATBOT_DB_URL, { max: 1 });
    let sessionId = null;
    let vacancyId = null;

    try {
      const recruiterRows = await managementSql`
        SELECT recruiter_id
        FROM management.recruiters
        WHERE recruiter_id = ${RECRUITER_ID}
        LIMIT 1
      `;
      const tenantRows = await managementSql`
        SELECT tenant_id
        FROM management.tenants
        WHERE tenant_id = ${TENANT_ID}
        LIMIT 1
      `;

      if (!recruiterRows[0] || !tenantRows[0]) {
        t.skip(`Seeded recruiter/tenant not found for ${RECRUITER_ID}/${TENANT_ID}`);
        return;
      }

      const llmAdapter = createFakePlaybookLlm();

      const start = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        playbookKey: "create_vacancy",
        recruiterInput: null,
        llmAdapter
      });

      sessionId = start.sessionId;
      assert.equal(start.reply.kind, "user_input");
      assert.match(start.reply.message, /Загрузите материалы по вакансии/i);

      const materials = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        playbookKey: "create_vacancy",
        recruiterInput: "Плиточник. Опыт от 1 года. Свой инструмент. Русский язык. Оплата 4000 за смену.",
        llmAdapter
      });

      sessionId = materials.sessionId;
      vacancyId = materials.vacancyId;
      assert.ok(vacancyId);
      assert.equal(materials.reply.kind, "display");
      assert.match(materials.reply.content, /желательные критерии/i);

      const vacancyAfterExtract = await tenantSql`
        SELECT must_haves, nice_haves
        FROM chatbot.vacancies
        WHERE vacancy_id = ${vacancyId}
        LIMIT 1
      `;
      assert.deepEqual(vacancyAfterExtract[0].must_haves, [
        "Опыт плиточника от 1 года",
        "Свой инструмент",
        "Разговорный русский язык"
      ]);
      assert.deepEqual(vacancyAfterExtract[0].nice_haves, [
        "Опыт на коммерческих объектах"
      ]);

      const workConditions = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        vacancyId,
        playbookKey: "create_vacancy",
        recruiterInput: "Продолжить",
        llmAdapter
      });
      assert.equal(workConditions.reply.kind, "display");
      assert.match(workConditions.reply.content, /условия работы/i);

      const applicationSteps = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        vacancyId,
        playbookKey: "create_vacancy",
        recruiterInput: "Продолжить",
        llmAdapter
      });
      assert.equal(applicationSteps.reply.kind, "display");
      assert.match(applicationSteps.reply.content, /этапы коммуникации/i);

      const companyInfo = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        vacancyId,
        playbookKey: "create_vacancy",
        recruiterInput: "Всё верно",
        llmAdapter
      });
      assert.equal(companyInfo.reply.kind, "display");
      assert.match(companyInfo.reply.content, /информацию о компании/i);

      const faqGeneration = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        vacancyId,
        playbookKey: "create_vacancy",
        recruiterInput: "Продолжить",
        llmAdapter
      });
      assert.equal(faqGeneration.reply.kind, "llm_output");

      const faqDisplay = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        vacancyId,
        playbookKey: "create_vacancy",
        recruiterInput: null,
        llmAdapter
      });
      assert.equal(faqDisplay.reply.kind, "display");
      assert.match(faqDisplay.reply.content, /частые вопросы/i);

      const finalButtons = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        vacancyId,
        playbookKey: "create_vacancy",
        recruiterInput: "Всё верно",
        llmAdapter
      });
      assert.equal(finalButtons.reply.kind, "buttons");
      assert.deepEqual(finalButtons.reply.options, [
        "Настроить общение с кандидатами",
        "Готово"
      ]);

      const completed = await dispatch({
        managementSql,
        tenantSql,
        tenantId: TENANT_ID,
        recruiterId: RECRUITER_ID,
        vacancyId,
        playbookKey: "create_vacancy",
        recruiterInput: "Готово",
        llmAdapter
      });
      assert.equal(completed.reply.kind, "completed");

      const finalVacancy = await tenantSql`
        SELECT must_haves, nice_haves, work_conditions, application_steps, company_info, faq
        FROM chatbot.vacancies
        WHERE vacancy_id = ${vacancyId}
        LIMIT 1
      `;
      assert.equal(finalVacancy[0].faq.length, 1);
      assert.equal(finalVacancy[0].application_steps.length, 2);
    } finally {
      if (sessionId) {
        await managementSql`
          DELETE FROM management.playbook_sessions
          WHERE session_id = ${sessionId}
        `;
      }

      if (vacancyId) {
        await tenantSql`
          DELETE FROM chatbot.vacancies
          WHERE vacancy_id = ${vacancyId}
        `;
      }

      await managementSql.end({ timeout: 5 }).catch(() => {});
      await tenantSql.end({ timeout: 5 }).catch(() => {});
    }
  });
}

function createFakePlaybookLlm() {
  return {
    async generate(prompt) {
      if (prompt.includes("ОБЯЗАТЕЛЬНЫЕ требования")) {
        return JSON.stringify([
          "Опыт плиточника от 1 года",
          "Свой инструмент",
          "Разговорный русский язык"
        ]);
      }

      if (prompt.includes("ЖЕЛАТЕЛЬНЫЕ требования")) {
        return JSON.stringify([
          "Опыт на коммерческих объектах"
        ]);
      }

      if (prompt.includes("определи шаги")) {
        return JSON.stringify([
          {
            name: "Проверить опыт плиточника",
            type: "must_have_check",
            what: "Подтвердить опыт кандидата.",
            script: "Коротко уточнить последние объекты и стаж.",
            in_our_scope: true,
            is_target: false
          },
          {
            name: "Назначить пробный день",
            type: "target_action",
            what: "Договориться о пробном дне.",
            script: "Подвести к согласованию даты выхода.",
            in_our_scope: true,
            is_target: true
          }
        ]);
      }

      if (prompt.includes("информацию о компании")) {
        return JSON.stringify({
          name: "СтройПро",
          description: "Строительная компания",
          notes: null
        });
      }

      if (prompt.includes("частых вопросов")) {
        return JSON.stringify([
          {
            q: "Какая оплата?",
            a: "4000 руб. за смену."
          }
        ]);
      }

      if (prompt.includes("выдели условия работы")) {
        return JSON.stringify({
          pay_per_shift: 4000,
          currency: "RUB",
          schedule: "5/2"
        });
      }

      throw new Error(`Unexpected prompt: ${prompt.slice(0, 120)}`);
    }
  };
}
