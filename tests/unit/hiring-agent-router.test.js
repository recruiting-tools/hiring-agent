import assert from "node:assert/strict";
import test from "node:test";
import { routePlaybook } from "../../services/hiring-agent/src/playbooks/router.js";

test("router: maps funnel request to candidate_funnel", async () => {
  assert.equal(await routePlaybook("Визуализируй воронку по кандидатам"), "candidate_funnel");
});

test("router: maps communication request to setup_communication", async () => {
  assert.equal(await routePlaybook("Подготовь план коммуникации по вакансии"), "setup_communication");
});

test("router: maps capabilities request to assistant_capabilities", async () => {
  assert.equal(await routePlaybook("Расскажи, что ты вообще умеешь?"), "assistant_capabilities");
});

test("router: maps quick start request to quick_start", async () => {
  assert.equal(await routePlaybook("Мне нужен быстрый старт"), "quick_start");
});

test("router: maps button click to setup_communication", async () => {
  assert.equal(await routePlaybook("настроить общение с кандидатами"), "setup_communication");
});

test("router: maps inflected phrase via DB keywords", async () => {
  const fakeManagementSql = async () => ([
    {
      playbook_key: "view_vacancy",
      keywords: ["посмотреть вакансию"],
      step_count: 2
    }
  ]);
  assert.equal(await routePlaybook("посмотри вакансию", fakeManagementSql), "view_vacancy");
});

test("router: refreshes stale DB keyword cache on miss", async () => {
  const primeCacheSql = async () => ([
    {
      playbook_key: "candidate_funnel",
      keywords: ["воронка"],
      step_count: 2
    }
  ]);
  assert.equal(await routePlaybook("покажи воронку", primeCacheSql), "candidate_funnel");

  let refreshCalls = 0;
  const refreshedSql = async () => {
    refreshCalls += 1;
    return ([
      {
        playbook_key: "view_vacancy",
        keywords: ["посмотреть вакансию"],
        step_count: 2
      }
    ]);
  };

  assert.equal(await routePlaybook("посмотри вакансию", refreshedSql), "view_vacancy");
  assert.equal(refreshCalls, 1);
});

test("router: maps broadcast request to mass_broadcast", async () => {
  assert.equal(await routePlaybook("Отправь всем кандидатам ссылку на календарь"), "mass_broadcast");
});

test("router: maps simple mailing request to mass_broadcast", async () => {
  assert.equal(await routePlaybook("сделай рассылку"), "mass_broadcast");
});

test("router: maps access revocation request to account_access", async () => {
  assert.equal(await routePlaybook("хочу отключить hh"), "account_access");
});

test("router: maps data wipe request to data_retention", async () => {
  assert.equal(await routePlaybook("очистить данные аккаунта"), "data_retention");
});

test("router: maps vacancy request to view_vacancy", async () => {
  const fakeManagementSql = async () => ([
    {
      playbook_key: "view_vacancy",
      keywords: ["карточка вакансии"],
      step_count: 2
    }
  ]);
  assert.equal(await routePlaybook("карточка вакансии", fakeManagementSql), "view_vacancy");
});

test("router: maps vacancy text request to view_vacancy in static fallback mode", async () => {
  assert.equal(await routePlaybook("покажи текст текущей вакансии"), "view_vacancy");
});

test("router: canonicalizes legacy write_vacancy_text to view_vacancy", async () => {
  const fakeManagementSql = async () => ([
    {
      playbook_key: "write_vacancy_text",
      keywords: ["текст вакансии"],
      step_count: 0
    }
  ]);
  assert.equal(await routePlaybook("покажи текст вакансии", fakeManagementSql), "view_vacancy");
});

test("router: canonicalizes legacy vacancy-text to view_vacancy", async () => {
  const fakeManagementSql = async () => ([
    {
      playbook_key: "vacancy-text",
      keywords: ["текст вакансии"],
      step_count: 0
    }
  ]);
  assert.equal(await routePlaybook("покажи текст вакансии", fakeManagementSql), "view_vacancy");
});

test("router: returns null for unsupported requests", async () => {
  assert.equal(await routePlaybook("Сделай что-нибудь умное"), null);
});
