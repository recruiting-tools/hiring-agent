import assert from "node:assert/strict";
import test from "node:test";
import WsClient from "ws";
import { createHiringAgentApp } from "../../services/hiring-agent/src/app.js";
import { createHiringAgentServer } from "../../services/hiring-agent/src/http-server.js";

async function req(server, method, path, body, cookie) {
  const port = server.address().port;
  const options = { method, headers: { "content-type": "application/json" } };
  if (cookie) options.headers.cookie = cookie;
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`http://localhost:${port}${path}`, options);
  const isJson = response.headers.get("content-type")?.includes("json");
  const responseBody = isJson ? await response.json() : await response.text();
  return {
    status: response.status,
    body: responseBody,
    contentType: response.headers.get("content-type")
  };
}

async function login(server) {
  const port = server.address().port;
  const response = await fetch(`http://localhost:${port}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "demo@local",
      password: "demo"
    })
  });

  return response.headers.get("set-cookie");
}

async function loginResponse(server) {
  const port = server.address().port;
  return fetch(`http://localhost:${port}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "demo@local",
      password: "demo"
    })
  });
}

test("hiring-agent: GET /health returns stateless demo status", async () => {
  const server = createHiringAgentServer(createHiringAgentApp({
    demoMode: true,
    appEnv: "local",
    deploySha: "test-sha-demo",
    startedAt: "2026-04-13T00:00:00.000Z",
    port: 0
  })).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/health");
    assert.equal(status, 200);
    assert.equal(body.service, "hiring-agent");
    assert.equal(body.mode, "stateless-demo");
    assert.equal(body.app_env, "local");
    assert.equal(body.deploy_sha, "test-sha-demo");
    assert.equal(body.started_at, "2026-04-13T00:00:00.000Z");
    assert.equal(typeof body.port, "number");
  } finally {
    server.close();
  }
});

test("hiring-agent: GET /health exposes configured app env in management mode", async () => {
  const server = createHiringAgentServer(createHiringAgentApp({
    demoMode: false,
    appEnv: "prod",
    deploySha: "test-sha-prod",
    startedAt: "2026-04-13T00:00:00.000Z",
    port: 3101
  })).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/health");
    assert.equal(status, 200);
    assert.equal(body.mode, "management-auth");
    assert.equal(body.app_env, "prod");
    assert.equal(body.deploy_sha, "test-sha-prod");
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /api/chat returns funnel payload for funnel request", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам"
    }, sessionCookie);
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "render_funnel");
    assert.equal(body.reply.playbook_key, "candidate_funnel");
    assert.equal(body.reply.summary.total, 12);
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /api/chat returns locked payload for disabled playbook", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Подготовь план коммуникации по вакансии"
    }, sessionCookie);
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "playbook_locked");
    assert.equal(body.reply.playbook_key, "communication_plan");
  } finally {
    server.close();
  }
});

test("hiring-agent: GET / serves HTML shell after auth", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const sessionCookie = await login(server);
    const { status, body, contentType } = await req(server, "GET", "/", undefined, sessionCookie);
    assert.equal(status, 200);
    assert.ok(contentType?.includes("text/html"));
    assert.ok(body.includes("Hiring Agent"));
    assert.ok(body.includes("vacancy-select"));
  } finally {
    server.close();
  }
});

test("hiring-agent: POST /auth/login sets 30 day cookie without secure outside production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const response = await loginResponse(server);
    const setCookie = response.headers.get("set-cookie");

    assert.match(setCookie, /Max-Age=2592000/);
    assert.doesNotMatch(setCookie, /;\s*Secure/i);
  } finally {
    server.close();
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("hiring-agent: auth cookies include secure in production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const loginSetCookie = (await loginResponse(server)).headers.get("set-cookie");
    assert.match(loginSetCookie, /;\s*Secure/i);

    const port = server.address().port;
    const logoutResponse = await fetch(`http://localhost:${port}/logout`, {
      method: "GET",
      redirect: "manual"
    });
    const logoutSetCookie = logoutResponse.headers.get("set-cookie");
    assert.match(logoutSetCookie, /;\s*Secure/i);
  } finally {
    server.close();
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("hiring-agent: invalid JSON request body returns 400", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);

  try {
    const port = server.address().port;
    const response = await fetch(`http://localhost:${port}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid"
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "invalid_json");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed GET /api/jobs resolves tenant sql via access context", async () => {
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    assert.match(text, /FROM chatbot\.jobs/);
    assert.deepEqual(values, ["tenant-alpha-001"]);
    return [{ job_id: "job-1", title: "Alpha role" }];
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/jobs", undefined, "session=sess-alpha");
    assert.equal(status, 200);
    assert.deepEqual(body.jobs, [{ job_id: "job-1", title: "Alpha role" }]);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed GET /api/jobs keeps two recruiter sessions isolated", async () => {
  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "sandbox",
    managementStore: {
      async getRecruiterSession(sessionToken) {
        if (sessionToken === "sess-alpha") {
          return {
            recruiter_id: "rec-alpha-001",
            email: "alpha@example.test",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-alpha-001",
            tenant_status: "active",
            expires_at: new Date()
          };
        }

        if (sessionToken === "sess-beta") {
          return {
            recruiter_id: "rec-beta-001",
            email: "beta@example.test",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-beta-001",
            tenant_status: "active",
            expires_at: new Date()
          };
        }

        return null;
      },
      async getPrimaryBinding({ tenantId }) {
        return {
          binding_id: `bind-${tenantId}`,
          db_alias: `db-${tenantId}`,
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection(dbAlias) {
        return {
          db_alias: dbAlias,
          connection_string: `postgres://${dbAlias}`
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate({ dbAlias }) {
        return async (strings, ...values) => {
          const text = strings.reduce((result, chunk, index) => (
            result + chunk + (index < values.length ? `$${index + 1}` : "")
          ), "");
          assert.match(text, /FROM chatbot\.jobs/);

          if (dbAlias === "db-tenant-alpha-001") {
            assert.deepEqual(values, ["tenant-alpha-001"]);
            return [{ job_id: "job-alpha-1", title: "Alpha role" }];
          }

          assert.deepEqual(values, ["tenant-beta-001"]);
          return [{ job_id: "job-beta-1", title: "Beta role" }];
        };
      }
    }
  }).listen(0);

  try {
    const alpha = await req(server, "GET", "/api/jobs", undefined, "session=sess-alpha");
    const beta = await req(server, "GET", "/api/jobs", undefined, "session=sess-beta");

    assert.equal(alpha.status, 200);
    assert.deepEqual(alpha.body.jobs, [{ job_id: "job-alpha-1", title: "Alpha role" }]);
    assert.equal(beta.status, 200);
    assert.deepEqual(beta.body.jobs, [{ job_id: "job-beta-1", title: "Beta role" }]);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed access denies suspended recruiter", async () => {
  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "suspended",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      }
    },
    poolRegistry: {
      getOrCreate() {
        throw new Error("should not be called");
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/jobs", undefined, "session=sess-alpha");
    assert.equal(status, 403);
    assert.equal(body.error, "ERROR_RECRUITER_SUSPENDED");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed access denies archived tenant", async () => {
  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "archived",
          expires_at: new Date()
        };
      }
    },
    poolRegistry: {
      getOrCreate() {
        throw new Error("should not be called");
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/jobs", undefined, "session=sess-alpha");
    assert.equal(status, 403);
    assert.equal(body.error, "ERROR_TENANT_SUSPENDED");
  } finally {
    server.close();
  }
});

test("hiring-agent: demo mode missing session returns 401 explicitly", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);

  try {
    const { status, body } = await req(server, "GET", "/api/jobs");
    assert.equal(status, 401);
    assert.equal(body.error, "unauthorized");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat returns guidance when no job_id provided", async () => {
  const tenantSql = async () => {
    throw new Error("tenantSql must not be called when job_id is missing");
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return { binding_id: "bind-1", db_alias: "db-alpha", binding_kind: "shared_db", schema_name: null };
      },
      async getDatabaseConnection() {
        return { db_alias: "db-alpha", connection_string: "postgres://alpha" };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: { getOrCreate() { return tenantSql; } }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам"
      // no job_id
    }, "session=sess-alpha");
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "fallback_text");
    assert.ok(body.reply.text.includes("Выберите вакансию"));
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat rejects foreign job_id before funnel query", async () => {
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    assert.match(text, /WHERE job_id = \$1/);
    assert.deepEqual(values, ["job-foreign", "tenant-alpha-001"]);
    return [];
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-foreign"
    }, "session=sess-alpha");
    assert.equal(status, 404);
    assert.equal(body.error, "job_not_found");
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat isolates foreign job_id between two recruiters", async () => {
  const tenantSqlByToken = {
    "sess-alpha": async (strings, ...values) => {
      const text = strings.reduce((result, chunk, index) => (
        result + chunk + (index < values.length ? `$${index + 1}` : "")
      ), "");

      if (text.includes("WHERE job_id =")) {
        if (values[0] === "job-beta-1") return [];
        return [{ job_id: "job-alpha-1", title: "Alpha role" }];
      }

      return [{
        step_name: "intro",
        total: 3,
        completed: 2,
        in_progress: 1,
        stuck: 0,
        rejected: 0
      }];
    },
    "sess-beta": async (strings, ...values) => {
      const text = strings.reduce((result, chunk, index) => (
        result + chunk + (index < values.length ? `$${index + 1}` : "")
      ), "");

      if (text.includes("WHERE job_id =")) {
        if (values[0] === "job-alpha-1") return [];
        return [{ job_id: "job-beta-1", title: "Beta role" }];
      }

      return [{
        step_name: "intro",
        total: 2,
        completed: 1,
        in_progress: 1,
        stuck: 0,
        rejected: 0
      }];
    }
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "sandbox",
    managementStore: {
      async getRecruiterSession(sessionToken) {
        if (sessionToken === "sess-alpha") {
          return {
            recruiter_id: "rec-alpha-001",
            email: "alpha@example.test",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-alpha-001",
            tenant_status: "active",
            expires_at: new Date()
          };
        }

        if (sessionToken === "sess-beta") {
          return {
            recruiter_id: "rec-beta-001",
            email: "beta@example.test",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-beta-001",
            tenant_status: "active",
            expires_at: new Date()
          };
        }

        return null;
      },
      async getPrimaryBinding({ tenantId }) {
        return {
          binding_id: `bind-${tenantId}`,
          db_alias: `db-${tenantId}`,
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection(dbAlias) {
        return {
          db_alias: dbAlias,
          connection_string: `postgres://${dbAlias}`
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate({ dbAlias }) {
        if (dbAlias === "db-tenant-alpha-001") return tenantSqlByToken["sess-alpha"];
        return tenantSqlByToken["sess-beta"];
      }
    }
  }).listen(0);

  try {
    const alphaForeign = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-beta-1"
    }, "session=sess-alpha");
    const betaForeign = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-alpha-1"
    }, "session=sess-beta");
    const betaOwn = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-beta-1"
    }, "session=sess-beta");

    assert.equal(alphaForeign.status, 404);
    assert.equal(alphaForeign.body.error, "job_not_found");
    assert.equal(betaForeign.status, 404);
    assert.equal(betaForeign.body.error, "job_not_found");
    assert.equal(betaOwn.status, 200);
    assert.equal(betaOwn.body.reply.kind, "render_funnel");
    assert.equal(betaOwn.body.reply.summary.total, 2);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed chat accepts owned job_id and returns funnel", async () => {
  let callIndex = 0;
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    callIndex += 1;

    if (callIndex === 1) {
      assert.match(text, /WHERE job_id = \$1/);
      assert.deepEqual(values, ["job-owned", "tenant-alpha-001"]);
      return [{ job_id: "job-owned", title: "Owned role" }];
    }

    if (text === "and pipeline_runs.job_id = $1") {
      assert.deepEqual(values, ["job-owned"]);
      return { fragment: true };
    }

    assert.match(text, /with scoped_runs as/);
    return [{
      step_name: "Screening",
      step_id: "screening",
      step_index: 0,
      total: 3,
      in_progress: 1,
      completed: 1,
      stuck: 0,
      rejected: 1
    }];
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  try {
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам",
      job_id: "job-owned"
    }, "session=sess-alpha");
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "render_funnel");
    assert.equal(body.reply.summary.total, 3);
  } finally {
    server.close();
  }
});

test("hiring-agent: WebSocket returns funnel chunks for authenticated session", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  const port = server.address().port;
  try {
    const sessionCookie = await login(server);

    const messages = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, { headers: { cookie: sessionCookie } });
      const received = [];
      let settled = false;

      const finish = (err) => {
        if (settled) return;
        settled = true;
        ws.close();
        if (err) reject(err); else resolve(received);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "message", text: "Визуализируй воронку по кандидатам" }));
      });
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          received.push(msg);
          if (msg.type === "done") finish();
        } catch (err) {
          finish(err);
        }
      });
      ws.on("error", finish);
      setTimeout(() => finish(new Error("timeout")), 5000);
    });

    const chunk = messages.find((m) => m.type === "chunk");
    const done = messages.find((m) => m.type === "done");
    assert.ok(chunk, "should receive chunk message");
    assert.ok(typeof chunk.text === "string" && chunk.text.length > 0, "chunk text should be non-empty");
    assert.ok(done, "should receive done message");
    assert.ok(Array.isArray(done.actions), "done.actions should be an array");
  } finally {
    server.close();
  }
});

test("hiring-agent: WebSocket closes with 4001 when session cookie is missing", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  const port = server.address().port;
  try {
    const closeCode = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`);
      ws.on("close", (code) => resolve(code));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 5000);
    });

    assert.equal(closeCode, 4001);
  } finally {
    server.close();
  }
});

test("hiring-agent: management-backed WebSocket uses tenant sql resolved at connection time", async () => {
  let callIndex = 0;
  const tenantSql = async (strings, ...values) => {
    const text = strings.reduce((result, chunk, index) => (
      result + chunk + (index < values.length ? `$${index + 1}` : "")
    ), "");
    callIndex += 1;

    if (callIndex === 1) {
      assert.match(text, /WHERE job_id = \$1/);
      assert.deepEqual(values, ["job-ws-owned", "tenant-alpha-001"]);
      return [{ job_id: "job-ws-owned", title: "WS test role" }];
    }

    if (text === "and pipeline_runs.job_id = $1") {
      assert.deepEqual(values, ["job-ws-owned"]);
      return { fragment: true };
    }

    assert.match(text, /with scoped_runs as/);
    return [{
      step_name: "Interview",
      step_id: "interview",
      step_index: 0,
      total: 5,
      in_progress: 2,
      completed: 2,
      stuck: 0,
      rejected: 1
    }];
  };

  const app = createHiringAgentApp({ demoMode: false });
  const server = createHiringAgentServer(app, {
    appEnv: "prod",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-alpha-001",
          email: "alpha@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-alpha-001",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-alpha",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-alpha",
          connection_string: "postgres://alpha"
        };
      },
      async renewSessionIfNeeded() {}
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  }).listen(0);

  const port = server.address().port;
  try {
    const messages = await new Promise((resolve, reject) => {
      const ws = new WsClient(`ws://localhost:${port}/ws`, {
        headers: { cookie: "session=sess-alpha" }
      });
      const received = [];
      let settled = false;

      const settle = (val, isErr) => {
        if (settled) return;
        settled = true;
        ws.close();
        isErr ? reject(val) : resolve(val);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "message",
          text: "Визуализируй воронку по кандидатам",
          vacancyId: "job-ws-owned"
        }));
      });
      ws.on("message", (data) => {
        const msg = JSON.parse(data);
        received.push(msg);
        if (msg.type === "done") settle(received, false);
      });
      ws.on("error", (err) => settle(err, true));
      ws.on("close", (code) => {
        if (code === 4001) settle(new Error("Unauthorized 4001"), true);
        else settle(received, false);
      });
      setTimeout(() => settle(new Error("timeout"), true), 5000);
    });

    const chunk = messages.find((m) => m.type === "chunk");
    const done = messages.find((m) => m.type === "done");
    assert.ok(chunk, "should receive chunk message");
    assert.ok(typeof chunk.text === "string" && chunk.text.length > 0, "chunk text should be non-empty");
    assert.ok(done, "should receive done message");
    assert.ok(Array.isArray(done.actions), "done.actions should be an array");
    // Verify tenant sql was actually called (callIndex > 0 means tenantSql was used, not demo data)
    assert.ok(callIndex > 0, "tenant sql should have been called at least once");
  } finally {
    server.close();
  }
});
