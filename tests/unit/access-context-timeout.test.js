import assert from "node:assert/strict";
import test from "node:test";
import { resolveAccessContext } from "../../packages/access-context/src/index.js";

test("access context: resolveAccessContext fails fast when session lookup hangs", async () => {
  const managementStore = {
    getRecruiterSession() {
      return new Promise(() => {});
    }
  };

  await assert.rejects(
    resolveAccessContext({
      managementStore,
      poolRegistry: {},
      appEnv: "prod",
      sessionToken: "sess-timeout",
      timeoutMs: 20
    }),
    (error) => {
      assert.equal(error.code, "ERROR_ACCESS_CONTEXT_TIMEOUT");
      assert.equal(error.httpStatus, 503);
      assert.match(error.message, /timed out/i);
      return true;
    }
  );
});
