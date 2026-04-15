#!/usr/bin/env node

const baseUrlEnv = (
  process.env.HIRING_AGENT_BASE_URL
  ?? process.env.BASE_URL
  ?? process.env.SANDBOX_URL
  ?? process.env.SANDBOX_BASE_URL
);
const email = process.env.HIRING_AGENT_SMOKE_EMAIL ?? process.env.SANDBOX_DEMO_EMAIL ?? process.env.DEMO_EMAIL;
const password = process.env.HIRING_AGENT_SMOKE_PASSWORD ?? process.env.SANDBOX_DEMO_PASSWORD ?? process.env.DEMO_PASSWORD;
const createVacancySource = (
  process.env.HIRING_AGENT_CREATE_VACANCY_SOURCE
  ?? "https://hh.ru/vacancy/132102233?hhtmFrom=employer_vacancies"
).trim();

if (!baseUrlEnv) {
  console.error("ERROR: HIRING_AGENT_BASE_URL, BASE_URL or SANDBOX_URL is required.");
  process.exit(1);
}

if (!email || !password) {
  console.error("ERROR: HIRING_AGENT_SMOKE_EMAIL/HIRING_AGENT_SMOKE_PASSWORD or sandbox demo creds are required.");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getSessionCookie(response) {
  const direct = response.headers.get("set-cookie");
  if (direct) {
    return direct.split(";")[0];
  }

  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  return raw[0]?.split(";")[0] ?? "";
}

async function postJson(url, body, { cookie = "" } = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

async function main() {
  const baseUrl = baseUrlEnv.replace(/\/$/, "");

  const loginResponse = await postJson(`${baseUrl}/auth/login`, {
    email,
    password
  });
  assert(loginResponse.status === 200, `Expected POST /auth/login to return 200, got ${loginResponse.status}`);
  const cookie = getSessionCookie(loginResponse);
  assert(cookie.startsWith("session"), `Expected auth cookie after login, got ${cookie || "empty"}`);

  const startResponse = await postJson(`${baseUrl}/api/chat`, {
    message: "создать вакансию"
  }, { cookie });
  assert(startResponse.status === 200, `Expected start chat 200, got ${startResponse.status}`);
  const startBody = await startResponse.json();
  assert(startBody.playbook_key === "create_vacancy", `Expected create_vacancy playbook, got ${startBody.playbook_key}`);
  assert(startBody.reply?.kind === "user_input", `Expected first reply.kind=user_input, got ${startBody.reply?.kind}`);

  const materialsResponse = await postJson(`${baseUrl}/api/chat`, {
    message: createVacancySource,
    playbook_key: "create_vacancy"
  }, { cookie });
  assert(materialsResponse.status === 200, `Expected materials chat 200, got ${materialsResponse.status}`);
  const materialsBody = await materialsResponse.json();

  assert(materialsBody.reply?.kind === "display", `Expected materials reply.kind=display, got ${materialsBody.reply?.kind}`);
  assert(materialsBody.playbook_key === "create_vacancy", `Expected playbook to remain create_vacancy, got ${materialsBody.playbook_key}`);
  assert(typeof materialsBody.vacancy_id === "string" && materialsBody.vacancy_id.length > 0, "Expected vacancy_id after draft creation");
  assert(
    /обязательн(ые|ых) требован/i.test(materialsBody.reply?.content ?? ""),
    `Expected must-haves review in reply, got: ${materialsBody.reply?.content ?? "empty"}`
  );
  assert(
    Array.isArray(materialsBody.reply?.options) && materialsBody.reply.options.includes("Продолжить"),
    "Expected must-haves review options to include «Продолжить»"
  );

  console.log("Create vacancy smoke passed.");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Vacancy ID: ${materialsBody.vacancy_id}`);
  console.log(`Vacancy title: ${materialsBody.vacancy_title ?? "n/a"}`);
}

main().catch((error) => {
  console.error(`Create vacancy smoke failed: ${error.message}`);
  process.exit(1);
});
