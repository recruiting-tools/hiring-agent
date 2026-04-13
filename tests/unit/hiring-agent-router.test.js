import assert from "node:assert/strict";
import test from "node:test";
import { routePlaybook } from "../../services/hiring-agent/src/playbooks/router.js";

test("router: maps funnel request to candidate_funnel", () => {
  assert.equal(routePlaybook("Визуализируй воронку по кандидатам"), "candidate_funnel");
});

test("router: maps communication request to communication_plan", () => {
  assert.equal(routePlaybook("Подготовь план коммуникации по вакансии"), "communication_plan");
});

test("router: maps broadcast request to candidate_broadcast", () => {
  assert.equal(routePlaybook("Отправь всем кандидатам ссылку на календарь"), "candidate_broadcast");
});

test("router: returns null for unsupported requests", () => {
  assert.equal(routePlaybook("Сделай что-нибудь умное"), null);
});
