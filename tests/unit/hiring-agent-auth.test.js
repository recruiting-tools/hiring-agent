import assert from "node:assert/strict";
import test from "node:test";
import {
  resetAccessContextCircuitBreaker
} from "../../packages/access-context/src/index.js";
import {
  createSession,
  createSignedSessionSnapshot,
  parseCookies,
  resolveSession,
  resolveSessionFromSignedSnapshot,
  sessionSnapshotCookieNameFromSessionCookieName
} from "../../services/hiring-agent/src/auth.js";
import { createHiringAgentApp } from "../../services/hiring-agent/src/app.js";
import { createHiringAgentServer } from "../../services/hiring-agent/src/http-server.js";

function createMockSql(handler) {
  return async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");

    return handler({ text, values });
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test.afterEach(() => {
  resetAccessContextCircuitBreaker();
});

test("auth: parseCookies parses cookie header into key/value map", () => {
  assert.deepEqual(
    parseCookies("session=abc123; theme=warm%20sand; ignored"),
    {
      session: "abc123",
      theme: "warm sand"
    }
  );
});

test("auth: resolveSession returns recruiter from sql row", async () => {
  const sql = createMockSql(({ text, values }) => {
    assert.match(text, /FROM management\.sessions s/);
    assert.match(text, /JOIN management\.recruiters r/);
    assert.match(text, /JOIN management\.tenants t/);
    assert.deepEqual(values, ["sess-001"]);

    return [{
      recruiter_id: "rec-1",
      tenant_id: "tenant-1",
      email: "rec@example.com",
      role: "recruiter",
      recruiter_status: "active",
      tenant_status: "active"
    }];
  });

  const recruiter = await resolveSession(sql, "sess-001");
  assert.deepEqual(recruiter, {
    recruiter_id: "rec-1",
    tenant_id: "tenant-1",
    email: "rec@example.com",
    role: "recruiter",
    recruiter_status: "active",
    tenant_status: "active"
  });
});

test("auth: resolveSession renews near-expiry session in background", async () => {
  const calls = [];
  const sql = createMockSql(({ text, values }) => {
    calls.push({ text, values });

    if (calls.length === 1) {
      return [{
        recruiter_id: "rec-1",
        tenant_id: "tenant-1",
        email: "rec@example.com",
        role: "recruiter",
        recruiter_status: "active",
        tenant_status: "active",
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }];
    }

    assert.match(text, /UPDATE management\.sessions/);
    assert.match(text, /SET expires_at = now\(\) \+ \$1::interval/);
    assert.deepEqual(values, ["30 days", "sess-001"]);
    return [];
  });

  const recruiter = await resolveSession(sql, "sess-001");
  assert.deepEqual(recruiter, {
    recruiter_id: "rec-1",
    tenant_id: "tenant-1",
    email: "rec@example.com",
    role: "recruiter",
    recruiter_status: "active",
    tenant_status: "active"
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
});

test("auth: resolveSession fails fast when management session lookup hangs", async () => {
  const pending = createDeferred();
  const sql = createMockSql(() => pending.promise);

  try {
    await assert.rejects(
      resolveSession(sql, "sess-timeout", { timeoutMs: 20 }),
      (error) => {
        assert.equal(error.code, "ERROR_ACCESS_CONTEXT_TIMEOUT");
        assert.equal(error.httpStatus, 503);
        assert.match(error.message, /timed out/i);
        return true;
      }
    );
  } finally {
    pending.resolve([]);
  }
});

test("auth: resolveSession retries one transient timeout before succeeding", async () => {
  let attempts = 0;
  const firstAttempt = createDeferred();
  const sql = createMockSql(() => {
    attempts += 1;
    if (attempts === 1) {
      return firstAttempt.promise;
    }

    return [{
      recruiter_id: "rec-1",
      tenant_id: "tenant-1",
      email: "rec@example.com",
      role: "recruiter",
      recruiter_status: "active",
      tenant_status: "active"
    }];
  });

  try {
    const recruiter = await resolveSession(sql, "sess-retry", {
      timeoutMs: 10,
      retryCount: 1,
      retryDelayMs: 1
    });

    assert.equal(attempts, 2);
    assert.equal(recruiter.recruiter_id, "rec-1");
  } finally {
    firstAttempt.resolve([]);
  }
});

test("auth: createSession stores 30 day ttl", async () => {
  const sql = createMockSql(({ text, values }) => {
    assert.match(text, /INSERT INTO management\.sessions/);
    assert.match(text, /VALUES \(\$1, \$2, now\(\) \+ \$3::interval\)/);
    assert.equal(values[1], "rec-1");
    assert.equal(values[2], "30 days");
    return [];
  });

  const token = await createSession(sql, "rec-1");
  assert.match(token, /^[a-f0-9]{64}$/);
});

test("auth: signed session snapshot resolves recruiter without database lookup", () => {
  const snapshot = createSignedSessionSnapshot({
    recruiter_id: "rec-1",
    tenant_id: "tenant-1",
    email: "rec@example.com",
    role: "recruiter",
    recruiter_status: "active",
    tenant_status: "active"
  }, "sess-001", {
    secret: "test-secret",
    now: 1_000
  });

  const recruiter = resolveSessionFromSignedSnapshot(snapshot, "sess-001", {
    secret: "test-secret",
    now: 2_000
  });

  assert.deepEqual(recruiter, {
    recruiter_id: "rec-1",
    tenant_id: "tenant-1",
    email: "rec@example.com",
    role: "recruiter",
    recruiter_status: "active",
    tenant_status: "active"
  });
});

test("auth: signed session snapshot is rejected when session token changes", () => {
  const snapshot = createSignedSessionSnapshot({
    recruiter_id: "rec-1",
    tenant_id: "tenant-1",
    email: "rec@example.com",
    role: "recruiter"
  }, "sess-001", {
    secret: "test-secret"
  });

  const recruiter = resolveSessionFromSignedSnapshot(snapshot, "sess-002", {
    secret: "test-secret"
  });

  assert.equal(recruiter, null);
});

test("auth: session snapshot cookie name follows session cookie name", () => {
  assert.equal(
    sessionSnapshotCookieNameFromSessionCookieName("session_sandbox_003"),
    "session_sandbox_003_auth"
  );
});

test("auth: GET / redirects to /login when cookie is missing", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://localhost:${port}/`, {
      redirect: "manual"
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/login");
  } finally {
    server.close();
  }
});
