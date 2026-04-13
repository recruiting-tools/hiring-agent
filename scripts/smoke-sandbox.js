#!/usr/bin/env node

const baseUrlEnv = process.env.BASE_URL ?? process.env.SANDBOX_URL ?? process.env.SANDBOX_BASE_URL;
if (!baseUrlEnv) {
  console.error("Error: SANDBOX_URL env var is required for cloud smoke");
  process.exit(1);
}

const baseUrl = baseUrlEnv.replace(/\/$/, "");
const demoEmail = process.env.SANDBOX_DEMO_EMAIL ?? process.env.DEMO_EMAIL ?? "demo@hiring-agent.app";
const demoPassword = process.env.SANDBOX_DEMO_PASSWORD ?? process.env.DEMO_PASSWORD;
const recruiterToken = process.env.SANDBOX_DEMO_RECRUITER_TOKEN ?? process.env.DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";
const secondaryDemoEmail = process.env.SANDBOX_SECONDARY_DEMO_EMAIL ?? null;
const secondaryDemoPassword = process.env.SANDBOX_SECONDARY_DEMO_PASSWORD ?? demoPassword;
const secondaryRecruiterToken = process.env.SANDBOX_SECONDARY_DEMO_RECRUITER_TOKEN ?? "rec-tok-sandbox-beta-001";

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
  const queueIds = queueBody.items.map((item) => item.planned_message_id);
  assert(queueIds.includes("pm-sandbox-primary"), "Expected primary queue to include sandbox primary moderation item");
  assert(!queueIds.includes("pm-sandbox-secondary"), "Expected primary queue to exclude secondary tenant moderation item");

  if (secondaryDemoEmail) {
    const secondaryLoginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: secondaryDemoEmail, password: secondaryDemoPassword }),
      redirect: "manual"
    });
    assert(secondaryLoginResponse.status === 200, `Expected secondary POST /auth/login to return 200, got ${secondaryLoginResponse.status}`);
    const secondaryLoginBody = await secondaryLoginResponse.json();
    assert(
      secondaryLoginBody.redirect === `/recruiter/${secondaryRecruiterToken}`,
      `Unexpected secondary login redirect: ${secondaryLoginBody.redirect}`
    );

    const secondaryQueue = await fetch(`${baseUrl}/recruiter/${secondaryRecruiterToken}/queue`);
    assert(secondaryQueue.status === 200, `Expected secondary queue JSON 200, got ${secondaryQueue.status}`);
    const secondaryQueueBody = await secondaryQueue.json();
    assert(Array.isArray(secondaryQueueBody.items), "Expected secondary queue response to include items array");
    const secondaryQueueIds = secondaryQueueBody.items.map((item) => item.planned_message_id);
    assert(secondaryQueueIds.includes("pm-sandbox-secondary"), "Expected secondary queue to include sandbox secondary moderation item");
    assert(!secondaryQueueIds.includes("pm-sandbox-primary"), "Expected secondary queue to exclude primary tenant moderation item");
  }

  const health = await fetch(`${baseUrl}/health`);
  assert(health.status === 200, `Expected health 200, got ${health.status}`);
  const healthBody = await health.json();
  assert(healthBody.app_env === "sandbox", `Expected /health app_env to be sandbox, got ${healthBody.app_env}`);
  assert(Object.hasOwn(healthBody, "deploy_sha"), "Expected /health to include deploy_sha");
  assert(typeof healthBody.deploy_sha === "string", "Expected /health deploy_sha to be a string");
  assert(Object.hasOwn(healthBody, "seed_version"), "Expected /health to include seed_version");
  assert(!Object.hasOwn(healthBody, "commit"), "Expected /health commit field to be absent");

  console.log("Sandbox smoke passed.");
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Queue items: ${queueBody.items.length}`);
}

main().catch((error) => {
  console.error(`Sandbox smoke failed: ${error.message}`);
  process.exit(1);
});
