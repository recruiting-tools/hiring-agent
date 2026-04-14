import assert from "node:assert/strict";
import test from "node:test";
import { routePlaybook } from "../../services/hiring-agent/src/playbooks/router.js";

test("router: maps funnel request to candidate_funnel", async () => {
  assert.equal(await routePlaybook("Визуализируй воронку по кандидатам"), "candidate_funnel");
});

test("router: maps communication request to setup_communication", async () => {
  assert.equal(await routePlaybook("Подготовь план коммуникации по вакансии"), "setup_communication");
});

test("router: maps button click to setup_communication", async () => {
  assert.equal(await routePlaybook("настроить общение с кандидатами"), "setup_communication");
});

test("router: maps broadcast request to mass_broadcast", async () => {
  assert.equal(await routePlaybook("Отправь всем кандидатам ссылку на календарь"), "mass_broadcast");
});

test("router: maps vacancy request to view_vacancy", async () => {
  assert.equal(await routePlaybook("карточка вакансии"), "view_vacancy");
});

test("router: returns null for unsupported requests", async () => {
  assert.equal(await routePlaybook("Сделай что-нибудь умное"), null);
});
