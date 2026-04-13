import assert from "node:assert/strict";
import test from "node:test";
import { resolveHiringAgentRuntime } from "../../services/hiring-agent/src/index.js";

test("hiring-agent runtime: APP_MODE=demo allows startup without management db", () => {
  const runtime = resolveHiringAgentRuntime({
    APP_MODE: "demo",
    PORT: "4100",
    APP_ENV: "local"
  });

  assert.equal(runtime.demoMode, true);
  assert.equal(runtime.port, 4100);
  assert.equal(runtime.appEnv, "local");
  assert.equal(runtime.startupMode, "demo");
  assert.equal(runtime.managementSql, null);
});

test("hiring-agent runtime: non-demo mode requires MANAGEMENT_DATABASE_URL", () => {
  assert.throws(
    () => resolveHiringAgentRuntime({
      APP_ENV: "sandbox"
    }),
    /MANAGEMENT_DATABASE_URL is required unless APP_MODE=demo/
  );
});

test("hiring-agent runtime: management mode uses MANAGEMENT_DATABASE_URL", () => {
  const runtime = resolveHiringAgentRuntime({
    APP_ENV: "prod",
    MANAGEMENT_DATABASE_URL: "postgres://example"
  });

  assert.equal(runtime.demoMode, false);
  assert.equal(runtime.appEnv, "prod");
  assert.equal(runtime.startupMode, "management-auth");
  assert.equal(typeof runtime.managementSql, "function");
  assert.ok(runtime.managementStore);
});
