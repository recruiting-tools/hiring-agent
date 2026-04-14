import assert from "node:assert/strict";
import test from "node:test";
import { routePlaybook } from "../../services/hiring-agent/src/playbooks/router.js";

test("router: maps funnel request to candidate_funnel", async () => {
  assert.equal(await routePlaybook("Визуализируй воронку по кандидатам"), "candidate_funnel");
});

test("router: maps communication request to communication_plan", async () => {
  assert.equal(await routePlaybook("Подготовь план коммуникации по вакансии"), "communication_plan");
});

test("router: maps broadcast request to candidate_broadcast", async () => {
  assert.equal(await routePlaybook("Отправь всем кандидатам ссылку на календарь"), "candidate_broadcast");
});

test("router: returns null for unsupported requests", async () => {
  assert.equal(await routePlaybook("Сделай что-нибудь умное"), null);
});
