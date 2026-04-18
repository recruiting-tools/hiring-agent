import assert from "node:assert/strict";
import test from "node:test";
import {
  resetAccessContextCircuitBreaker,
  withAccessContextResilience
} from "../../packages/access-context/src/index.js";

function createPendingOperation() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  const keepAlive = setTimeout(() => {}, 60_000);
  return {
    promise,
    resolve(value = null) {
      clearTimeout(keepAlive);
      resolve(value);
    }
  };
}

test.afterEach(() => {
  resetAccessContextCircuitBreaker();
});

test("access context resilience: retries one transient timeout before succeeding", async () => {
  let attempts = 0;
  const firstAttempt = createPendingOperation();

  try {
    const result = await withAccessContextResilience(
      () => {
        attempts += 1;
        if (attempts === 1) {
          return firstAttempt.promise;
        }
        return { ok: true };
      },
      {
        operationName: "session lookup",
        breakerKey: "test-retry-success",
        timeoutMs: 10,
        retryCount: 1,
        retryDelayMs: 1
      }
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 2);
  } finally {
    firstAttempt.resolve();
  }
});

test("access context resilience: opens circuit breaker after repeated transient failures", async () => {
  let attempts = 0;
  const pendingAttempts = [];
  const runFailingLookup = () => withAccessContextResilience(
    () => {
      attempts += 1;
      const pending = createPendingOperation();
      pendingAttempts.push(pending);
      return pending.promise;
    },
    {
      operationName: "binding lookup",
      breakerKey: "test-breaker",
      timeoutMs: 10,
      retryCount: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 50
    }
  );

  try {
    await assert.rejects(runFailingLookup(), (error) => {
      assert.equal(error.code, "ERROR_ACCESS_CONTEXT_TIMEOUT");
      return true;
    });

    await assert.rejects(runFailingLookup(), (error) => {
      assert.equal(error.code, "ERROR_ACCESS_CONTEXT_BACKEND_UNAVAILABLE");
      assert.equal(error.httpStatus, 503);
      assert.equal(error.details.operation, "binding lookup");
      assert.ok(error.details.retry_after_ms > 0);
      return true;
    });

    await assert.rejects(runFailingLookup(), (error) => {
      assert.equal(error.code, "ERROR_ACCESS_CONTEXT_BACKEND_UNAVAILABLE");
      return true;
    });

    assert.equal(attempts, 2);
  } finally {
    for (const pending of pendingAttempts) pending.resolve();
  }
});
