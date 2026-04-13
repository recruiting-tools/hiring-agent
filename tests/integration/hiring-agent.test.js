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
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const response = await loginResponse(server);
    const setCookie = response.headers.get("set-cookie");

    assert.match(setCookie, /Max-Age=2592000/);
    assert.doesNotMatch(setCookie, /;\s*Secure/i);
  } finally {
    server.close();
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
