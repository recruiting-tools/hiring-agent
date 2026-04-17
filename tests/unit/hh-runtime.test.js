import assert from "node:assert/strict";
import test from "node:test";
import { createHhRuntime, resolveHhRedirectUri, resolveHhRuntimeConfig } from "../../services/candidate-chatbot/src/hh-runtime.js";

test("hh runtime config: returns safe defaults when HH env is absent", () => {
  const config = resolveHhRuntimeConfig({});

  assert.equal(config.clientId, null);
  assert.equal(config.clientSecret, null);
  assert.equal(config.redirectUri, null);
  assert.equal(config.apiBaseUrl, "https://api.hh.ru");
  assert.equal(config.useContractMock, false);
  assert.equal(config.sendBatchSize, 25);
});

test("hh runtime config: rejects partial HH OAuth configuration", () => {
  assert.throws(
    () => resolveHhRuntimeConfig({
      HH_CLIENT_ID: "client-only",
      HH_REDIRECT_URI: "https://example.test/hh-callback/"
    }),
    /Invalid HH OAuth configuration/
  );
});

test("hh runtime config: normalizes base url, mock mode, and batch size", () => {
  const config = resolveHhRuntimeConfig({
    HH_CLIENT_ID: "client-id",
    HH_CLIENT_SECRET: "client-secret",
    HH_REDIRECT_URI: "https://example.test/hh-callback/",
    HH_API_BASE_URL: "https://mock.hh.test/",
    HH_USE_CONTRACT_MOCK: "true",
    HH_SEND_BATCH_SIZE: "999"
  });

  assert.equal(config.redirectUri, "https://example.test/hh-callback/");
  assert.equal(config.apiBaseUrl, "https://mock.hh.test");
  assert.equal(config.useContractMock, true);
  assert.equal(config.sendBatchSize, 100);
});

test("hh runtime config: legacy HH_USE_MOCK still enables contract mock", () => {
  const config = resolveHhRuntimeConfig({ HH_USE_MOCK: "true" });
  assert.equal(config.useContractMock, true);
});

test("hh redirect uri: rejects non-callback paths", () => {
  assert.equal(resolveHhRedirectUri("https://example.test/not-hh"), null);
});

test("hh runtime: wires custom api base url and sender batch size into runtime", async () => {
  const dueCalls = [];
  const store = {
    async getHhOAuthTokens() {
      return null;
    },
    async setHhOAuthTokens() {},
    async getPlannedMessagesDue(now, limit) {
      dueCalls.push({ now, limit });
      return [];
    }
  };

  const runtime = await createHhRuntime({
    store,
    chatbot: {},
    env: {
      HH_CLIENT_ID: "client-id",
      HH_CLIENT_SECRET: "client-secret",
      HH_REDIRECT_URI: "https://example.test/hh-callback/",
      HH_API_BASE_URL: "https://mock.hh.test/",
      HH_SEND_BATCH_SIZE: "7"
    },
    now: () => new Date("2026-04-17T12:00:00.000Z")
  });

  assert.equal(runtime.hhClient, runtime.hhOAuthClient);
  assert.equal(runtime.hhOAuthClient.apiBaseUrl, "https://mock.hh.test");

  const result = await runtime.hhSendRunner.sendDue();
  assert.equal(result.processed, 0);
  assert.equal(dueCalls.length, 1);
  assert.equal(dueCalls[0].limit, 7);
});
