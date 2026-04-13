import assert from "node:assert/strict";
import test from "node:test";
import { createHiringAgentApp } from "../../services/hiring-agent/src/app.js";
import { createHiringAgentServer } from "../../services/hiring-agent/src/http-server.js";

async function req(server, method, path, body) {
  const port = server.address().port;
  const options = { method, headers: { "content-type": "application/json" } };
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
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Визуализируй воронку по кандидатам"
    });
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
    const { status, body } = await req(server, "POST", "/api/chat", {
      message: "Подготовь план коммуникации по вакансии"
    });
    assert.equal(status, 200);
    assert.equal(body.reply.kind, "playbook_locked");
    assert.equal(body.reply.playbook_key, "communication_plan");
  } finally {
    server.close();
  }
});

test("hiring-agent: GET / serves HTML shell", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  try {
    const { status, body, contentType } = await req(server, "GET", "/");
    assert.equal(status, 200);
    assert.ok(contentType?.includes("text/html"));
    assert.ok(body.includes("Playbook-driven chat shell"));
  } finally {
    server.close();
  }
});
