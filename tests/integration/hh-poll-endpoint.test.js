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
