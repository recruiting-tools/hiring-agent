#!/usr/bin/env node

const baseUrl = (process.env.SANDBOX_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const demoEmail = process.env.SANDBOX_DEMO_EMAIL ?? process.env.DEMO_EMAIL ?? "demo@hiring-agent.app";
const demoPassword = process.env.SANDBOX_DEMO_PASSWORD ?? process.env.DEMO_PASSWORD;
const recruiterToken = process.env.SANDBOX_DEMO_RECRUITER_TOKEN ?? process.env.DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";

if (!demoPassword) {
  console.error("ERROR: SANDBOX_DEMO_PASSWORD or DEMO_PASSWORD environment variable is required");
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getSetCookie(response) {
  const direct = response.headers.get("set-cookie");
  if (direct) return direct;
  const raw = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  return raw[0] ?? "";
}

async function main() {
  const root = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert(root.status === 302, `Expected GET / to return 302, got ${root.status}`);
  assert(root.headers.get("location") === "/login", `Expected redirect to /login, got ${root.headers.get("location")}`);

  const loginPage = await fetch(`${baseUrl}/login`);
  assert(loginPage.status === 200, `Expected GET /login to return 200, got ${loginPage.status}`);
  assert((loginPage.headers.get("content-type") ?? "").includes("text/html"), "Expected /login to return HTML");

  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: demoEmail, password: demoPassword }),
    redirect: "manual"
  });
  assert(loginResponse.status === 200, `Expected POST /auth/login to return 200, got ${loginResponse.status}`);

  const loginBody = await loginResponse.json();
  assert(loginBody.redirect === `/recruiter/${recruiterToken}`, `Unexpected login redirect: ${loginBody.redirect}`);

  const cookie = getSetCookie(loginResponse).split(";")[0];
  assert(cookie.startsWith("session="), "Expected session cookie after login");

  const moderationPage = await fetch(`${baseUrl}/recruiter/${recruiterToken}`, {
    headers: { cookie },
    redirect: "manual"
  });
  assert(moderationPage.status === 200, `Expected moderation page 200, got ${moderationPage.status}`);
  assert((await moderationPage.text()).includes("Очередь модерации"), "Expected moderation HTML to contain queue title");

  const queue = await fetch(`${baseUrl}/recruiter/${recruiterToken}/queue`);
  assert(queue.status === 200, `Expected queue JSON 200, got ${queue.status}`);
  const queueBody = await queue.json();
  assert(Array.isArray(queueBody.items), "Expected queue response to include items array");

  const health = await fetch(`${baseUrl}/health`);
  assert(health.status === 200, `Expected health 200, got ${health.status}`);

  console.log("Sandbox smoke passed.");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Queue items: ${queueBody.items.length}`);
}

main().catch((error) => {
  console.error(`Sandbox smoke failed: ${error.message}`);
  process.exit(1);
});
