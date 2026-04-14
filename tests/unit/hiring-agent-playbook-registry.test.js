import assert from "node:assert/strict";
import test from "node:test";
import { getPlaybookRegistry } from "../../services/hiring-agent/src/playbooks/registry.js";
import { routePlaybook } from "../../services/hiring-agent/src/playbooks/router.js";

test("registry: candidate_funnel remains enabled without DB steps", async () => {
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
        }
      ];
    }

    throw new Error(`Unexpected query: ${text}`);
  };

  const playbooks = await getPlaybookRegistry(managementSql);
  assert.equal(playbooks.find((item) => item.playbook_key === "candidate_funnel")?.enabled, true);
  assert.equal(playbooks.find((item) => item.playbook_key === "setup_communication")?.enabled, true);
});

test("router: candidate_funnel remains routable without DB steps", async () => {
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
    }
  ]);

  assert.equal(await routePlaybook("покажи воронку по кандидатам", managementSql), "candidate_funnel");
  assert.equal(await routePlaybook("настроить общение с кандидатами", managementSql), "setup_communication");
});
