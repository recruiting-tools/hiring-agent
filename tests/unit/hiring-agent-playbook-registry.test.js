import assert from "node:assert/strict";
import test from "node:test";
import { getPlaybookRegistry } from "../../services/hiring-agent/src/playbooks/registry.js";
import { routePlaybook } from "../../services/hiring-agent/src/playbooks/router.js";

test("registry: only working zero-step management playbooks remain enabled", async () => {
  const managementSql = async (strings) => {
    const text = strings.join("");

    if (text.includes("d.trigger_description")) {
      return [
        {
          playbook_key: "candidate_funnel",
          name: "Визуализация воронки",
          trigger_description: "funnel",
          status: "available",
          sort_order: 1,
          step_count: 0
        },
        {
          playbook_key: "setup_communication",
          name: "Настроить общение с кандидатами",
          trigger_description: "communication",
          status: "available",
          sort_order: 2,
          step_count: 0
        },
        {
          playbook_key: "create_vacancy",
          name: "Создать новую вакансию",
          trigger_description: "create vacancy",
          status: "available",
          sort_order: 3,
          step_count: 0
        },
        {
          playbook_key: "account_access",
          name: "Управление доступом к hh.ru",
          trigger_description: "revoke hh",
          status: "available",
          sort_order: 4,
          step_count: 0
        },
        {
          playbook_key: "data_retention",
          name: "Очистка данных аккаунта",
          trigger_description: "wipe data",
          status: "available",
          sort_order: 5,
          step_count: 0
        }
      ];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const playbooks = await getPlaybookRegistry(managementSql);
  assert.equal(playbooks.find((item) => item.playbook_key === "candidate_funnel")?.enabled, true);
  assert.equal(playbooks.find((item) => item.playbook_key === "setup_communication")?.enabled, true);
  assert.equal(playbooks.find((item) => item.playbook_key === "create_vacancy")?.enabled, false);
  assert.equal(playbooks.find((item) => item.playbook_key === "view_vacancy"), undefined);
  assert.equal(playbooks.find((item) => item.playbook_key === "account_access")?.enabled, true);
  assert.equal(playbooks.find((item) => item.playbook_key === "data_retention")?.enabled, true);
});

test("router: only working zero-step management playbooks remain routable", async () => {
  const managementSql = async () => ([
    {
      playbook_key: "candidate_funnel",
      keywords: ["воронк"],
      step_count: 0
    },
    {
      playbook_key: "setup_communication",
      keywords: ["настроить общение"],
      step_count: 0
    },
    {
      playbook_key: "create_vacancy",
      keywords: ["создать вакансию"],
      step_count: 0
    },
    {
      playbook_key: "account_access",
      keywords: ["отключить hh"],
      step_count: 0
    },
    {
      playbook_key: "data_retention",
      keywords: ["очистить данные"],
      step_count: 0
    }
  ]);

  assert.equal(await routePlaybook("покажи воронку по кандидатам", managementSql), "candidate_funnel");
  assert.equal(await routePlaybook("настроить общение с кандидатами", managementSql), "setup_communication");
  assert.equal(await routePlaybook("создать вакансию", managementSql), null);
  assert.equal(await routePlaybook("отключить hh", managementSql), "account_access");
  assert.equal(await routePlaybook("очистить данные", managementSql), "data_retention");
});
