import assert from "node:assert/strict";
import test from "node:test";
import { parseCookies, resolveSession } from "../../services/hiring-agent/src/auth.js";
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
    assert.match(text, /FROM chatbot\.sessions s/);
    assert.match(text, /JOIN chatbot\.recruiters r/);
    assert.deepEqual(values, ["sess-001"]);

    return [{
      recruiter_id: "rec-1",
      client_id: "client-1",
      recruiter_token: "rec-tok-1",
      email: "rec@example.com"
    }];
  });

  const recruiter = await resolveSession(sql, "sess-001");
  assert.deepEqual(recruiter, {
    recruiter_id: "rec-1",
    client_id: "client-1",
    recruiter_token: "rec-tok-1",
    email: "rec@example.com"
  });
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
