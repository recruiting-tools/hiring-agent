import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FakeLlmAdapter } from "../../services/candidate-chatbot/src/fake-llm-adapter.js";
import { createCandidateChatbot } from "../../services/candidate-chatbot/src/handlers.js";
import { createHttpServer } from "../../services/candidate-chatbot/src/http-server.js";
import { InMemoryHiringStore } from "../../services/candidate-chatbot/src/store.js";

const seed = JSON.parse(await readFile(new URL("../fixtures/iteration-1-seed.json", import.meta.url), "utf8"));

function createRuntime() {
  const store = new InMemoryHiringStore(seed);
  const app = createCandidateChatbot({
    store,
    llmAdapter: new FakeLlmAdapter()
  });
  return { app, store };
}

test("internal hh poll: rejects request without bearer token", async () => {
  const { app, store } = createRuntime();
  const server = createHttpServer(app, {
    store,
    internalApiToken: "secret-123",
    hhPollRunner: { pollAll: async () => ({ polled: 0 }) }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/hh-poll`, { method: "POST" });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, "unauthorized");
  } finally {
    server.close();
  }
});

test("internal hh poll: skips when hh_import flag is disabled", async () => {
  const { app, store } = createRuntime();
  await store.setFeatureFlag("hh_import", false);
  let called = false;
  const server = createHttpServer(app, {
    store,
    internalApiToken: "secret-123",
    hhPollRunner: {
      async pollAll() {
        called = true;
        return { polled: 1 };
      }
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/hh-poll`, {
      method: "POST",
      headers: { authorization: "Bearer secret-123" }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.skipped, true);
    assert.equal(called, false);
  } finally {
    server.close();
  }
});

test("internal hh poll: runs poller when authorized and hh_import is enabled", async () => {
  const { app, store } = createRuntime();
  await store.setFeatureFlag("hh_import", true);
  let calls = 0;
  const server = createHttpServer(app, {
    store,
    internalApiToken: "secret-123",
    hhPollRunner: {
      async pollAll() {
        calls += 1;
        return { polled: 2 };
      }
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/hh-poll`, {
      method: "POST",
      headers: { authorization: "Bearer secret-123" }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.polled, 2);
    assert.equal(calls, 1);
  } finally {
    server.close();
  }
});

test("internal hh import: rejects request without bearer token", async () => {
  const { app, store } = createRuntime();
  const server = createHttpServer(app, {
    store,
    internalApiToken: "secret-123",
    hhImportRunner: { syncApplicants: async () => ({ ok: true }) }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/hh-import`, { method: "POST" });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, "unauthorized");
  } finally {
    server.close();
  }
});

test("internal hh import: skips when hh_import flag is disabled", async () => {
  const { app, store } = createRuntime();
  await store.setFeatureFlag("hh_import", false);
  let called = false;
  const server = createHttpServer(app, {
    store,
    internalApiToken: "secret-123",
    hhImportRunner: {
      async syncApplicants() {
        called = true;
        return { ok: true };
      }
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/hh-import`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-123",
        "content-type": "application/json"
      },
      body: JSON.stringify({ window_start: "2026-04-08T00:00:00Z" })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.skipped, true);
    assert.equal(called, false);
  } finally {
    server.close();
  }
});

test("internal hh import: passes import window to runner when authorized", async () => {
  const { app, store } = createRuntime();
  await store.setFeatureFlag("hh_import", true);
  const calls = [];
  const server = createHttpServer(app, {
    store,
    internalApiToken: "secret-123",
    hhImportRunner: {
      async syncApplicants(input) {
        calls.push(input);
        return { ok: true, imported_negotiations: 2, imported_messages: 5 };
      }
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/hh-import`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-123",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        window_start: "2026-04-08T00:00:00Z",
        window_end: "2026-04-13T00:00:00Z"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.imported_negotiations, 2);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      windowStart: "2026-04-08T00:00:00Z",
      windowEnd: "2026-04-13T00:00:00Z"
    });
  } finally {
    server.close();
  }
});

test("internal hh import: rejects invalid window_start", async () => {
  const { app, store } = createRuntime();
  await store.setFeatureFlag("hh_import", true);
  let called = false;
  const server = createHttpServer(app, {
    store,
    internalApiToken: "secret-123",
    hhImportRunner: {
      async syncApplicants() {
        called = true;
        return { ok: true };
      }
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/hh-import`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-123",
        "content-type": "application/json"
      },
      body: JSON.stringify({ window_start: "not-a-date" })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "invalid_window_start");
    assert.equal(called, false);
  } finally {
    server.close();
  }
});

test("internal hh import: rejects invalid window_end", async () => {
  const { app, store } = createRuntime();
  await store.setFeatureFlag("hh_import", true);
  let called = false;
  const server = createHttpServer(app, {
    store,
    internalApiToken: "secret-123",
    hhImportRunner: {
      async syncApplicants() {
        called = true;
        return { ok: true };
      }
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/hh-import`, {
      method: "POST",
      headers: {
        authorization: "Bearer secret-123",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        window_start: "2026-04-08T00:00:00Z",
        window_end: "not-a-date"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "invalid_window_end");
    assert.equal(called, false);
  } finally {
    server.close();
  }
});
