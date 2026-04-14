import assert from "node:assert/strict";
import test from "node:test";
import { resolveHiringAgentRuntime } from "../../services/hiring-agent/src/index.js";

test("hiring-agent runtime: APP_MODE=demo allows startup without management db", () => {
  const runtime = resolveHiringAgentRuntime({
    APP_MODE: "demo",
    PORT: "4100",
    APP_ENV: "local",
    OPENROUTER_SETUP_COMMUNICATION_PLAN_MODEL: "openai/gpt-5.4-mini",
    OPENROUTER_SETUP_COMMUNICATION_EXAMPLES_MODEL: "google/gemini-2.5-flash"
  });

  assert.equal(runtime.demoMode, true);
  assert.equal(runtime.port, 4100);
  assert.equal(runtime.appEnv, "local");
  assert.equal(runtime.deploySha, "unknown");
  assert.match(runtime.startedAt, /T/);
  assert.equal(runtime.startupMode, "demo");
  assert.equal(runtime.managementSql, null);
  assert.equal(runtime.communicationPlanLlmConfig.planModel, "openai/gpt-5.4-mini");
  assert.equal(runtime.communicationPlanLlmConfig.examplesModel, "google/gemini-2.5-flash");
});

test("hiring-agent runtime: non-demo mode requires MANAGEMENT_DATABASE_URL", () => {
  assert.throws(
    () => resolveHiringAgentRuntime({
      APP_ENV: "sandbox"
    }),
    /MANAGEMENT_DATABASE_URL is required unless APP_MODE=demo/
  );
});

test("hiring-agent runtime: non-demo mode requires APP_ENV", () => {
  assert.throws(
    () => resolveHiringAgentRuntime({
      MANAGEMENT_DATABASE_URL: "postgres://example"
    }),
    /APP_ENV is required unless APP_MODE=demo/
  );
});

test("hiring-agent runtime: management mode uses MANAGEMENT_DATABASE_URL", () => {
  const runtime = resolveHiringAgentRuntime({
    APP_ENV: "prod",
    MANAGEMENT_DATABASE_URL: "postgres://example",
    DEPLOY_SHA: "sha-123"
  });

  assert.equal(runtime.demoMode, false);
  assert.equal(runtime.appEnv, "prod");
  assert.equal(runtime.deploySha, "sha-123");
  assert.match(runtime.startedAt, /T/);
  assert.equal(runtime.startupMode, "management-auth");
  assert.equal(typeof runtime.managementSql, "function");
  assert.ok(runtime.managementStore);
  assert.equal(runtime.communicationPlanLlmConfig.planModel, "openai/gpt-5.4-mini");
  assert.equal(runtime.communicationPlanLlmConfig.examplesModel, "google/gemini-2.5-flash");
});
