import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPlaybookRegistryCache,
  findPlaybook,
  getPlaybookRegistry
} from "../../services/hiring-agent/src/playbooks/registry.js";

test.beforeEach(() => {
  clearPlaybookRegistryCache();
});

function createFakeManagementSql(rowsByTable) {
  return async (strings) => {
    const text = strings.join("");
    if (text.includes("management.tenant_playbook_access")) {
      return rowsByTable.access || [];
    }

    if (text.includes("management.playbook_definitions")) {
      return rowsByTable.definitions;
    }

    throw new Error(`Unexpected query: ${text}`);
  };
}

const baseDefinitions = [
  {
    playbook_key: "create_vacancy",
    name: "Создать новую вакансию",
    trigger_description: "create vacancy",
    status: "available",
    sort_order: 1,
    step_count: 14
  },
  {
    playbook_key: "candidate_funnel",
    name: "Визуализация воронки",
    trigger_description: "funnel",
    status: "available",
    sort_order: 2,
    step_count: 1
  },
  {
    playbook_key: "assistant_capabilities",
    name: "Что ты умеешь",
    trigger_description: "capabilities",
    status: "available",
    sort_order: 3,
    step_count: 1
  },
  {
    playbook_key: "quick_start",
    name: "Быстрый старт",
    trigger_description: "quick start",
    status: "available",
    sort_order: 4,
    step_count: 1
  }
];

test("registry: returns static fallback playbooks without management db", async () => {
  const fallback = await getPlaybookRegistry();
  const capabilities = fallback.find((item) => item.playbook_key === "assistant_capabilities");
  const quickStart = fallback.find((item) => item.playbook_key === "quick_start");

  assert.equal(capabilities?.enabled, true);
  assert.equal(quickStart?.enabled, true);
});

test("registry: create_vacancy ignores tenant override lock and remains enabled", async () => {
  const managementSql = createFakeManagementSql({
    definitions: baseDefinitions,
    access: [{ playbook_key: "create_vacancy", enabled: false }]
  });

  const registry = await getPlaybookRegistry(managementSql, "tenant-1");
  const createVacancy = registry.find((item) => item.playbook_key === "create_vacancy");
  const funnel = registry.find((item) => item.playbook_key === "candidate_funnel");

  assert.equal(createVacancy.enabled, true);
  assert.equal(funnel.enabled, true);
});

test("registry: returns enabled by default when tenant access row missing", async () => {
  const managementSql = createFakeManagementSql({
    definitions: baseDefinitions,
    access: []
  });

  const playbook = await findPlaybook("create_vacancy", managementSql, "tenant-2");
  assert.ok(playbook);
  assert.equal(playbook.enabled, true);
});

test("registry: disables tenant playbook when tenant override is false", async () => {
  const managementSql = createFakeManagementSql({
    definitions: baseDefinitions,
    access: [{ playbook_key: "quick_start", enabled: false }]
  });

  const playbook = await findPlaybook("quick_start", managementSql, "tenant-3");
  assert.ok(playbook);
  assert.equal(playbook.enabled, false);
});
