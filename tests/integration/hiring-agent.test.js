import assert from "node:assert/strict";
import test from "node:test";
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
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const { status, body } = await req(server, "GET", "/health");
    assert.equal(status, 200);
    assert.equal(body.service, "hiring-agent");
    assert.equal(body.mode, "stateless-demo");
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
    assert.ok(body.includes("Playbook-driven chat shell"));
    assert.ok(body.includes("demo@local"));
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
