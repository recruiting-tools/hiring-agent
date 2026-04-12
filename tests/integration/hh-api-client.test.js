import assert from "node:assert/strict";
import test from "node:test";
import { HhApiClient } from "../../services/hh-connector/src/hh-api-client.js";

function makeTokenStore(initialTokens) {
  let current = structuredClone(initialTokens);
  return {
    async getTokens() {
      return current ? structuredClone(current) : null;
    },
    async setTokens(nextTokens) {
      current = structuredClone(nextTokens);
    }
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    async json() {
      return structuredClone(body);
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

test("hh api client: listNegotiations sends bearer token and query params", async () => {
  const calls = [];
  const tokenStore = makeTokenStore({
    access_token: "access-001",
    refresh_token: "refresh-001",
    expires_at: "2099-01-01T00:00:00.000Z"
  });
  const client = new HhApiClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://example.test/hh-callback",
    tokenStore,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { found: 0, page: 0, pages: 1, per_page: 20, items: [] });
    }
  });

  const result = await client.listNegotiations("response", { vacancy_id: "vac-001", page: 1, per_page: 50 });

  assert.equal(result.items.length, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/negotiations\/response\?/);
  assert.match(calls[0].url, /vacancy_id=vac-001/);
  assert.match(calls[0].url, /page=1/);
  assert.match(calls[0].url, /per_page=50/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer access-001");
});

test("hh api client: refreshes token before request when it expires within one hour", async () => {
  const calls = [];
  const tokenStore = makeTokenStore({
    access_token: "access-soon-expired",
    refresh_token: "refresh-001",
    expires_at: "2026-04-12T10:30:00.000Z"
  });
  const client = new HhApiClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://example.test/hh-callback",
    tokenStore,
    now: () => new Date("2026-04-12T10:00:00.000Z"),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/token")) {
        return jsonResponse(200, {
          access_token: "access-refreshed",
          refresh_token: "refresh-refreshed",
          expires_in: 7200,
          token_type: "bearer"
        });
      }
      return jsonResponse(200, { id: "employer-001" });
    }
  });

  const me = await client.getMe();
  const stored = await tokenStore.getTokens();

  assert.equal(me.id, "employer-001");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.hh.ru/token");
  assert.equal(calls[1].init.headers.Authorization, "Bearer access-refreshed");
  assert.equal(stored.access_token, "access-refreshed");
  assert.equal(stored.refresh_token, "refresh-refreshed");
});

test("hh api client: retries original request once after 401 by refreshing token", async () => {
  const calls = [];
  const tokenStore = makeTokenStore({
    access_token: "access-stale",
    refresh_token: "refresh-001",
    expires_at: "2026-04-12T12:00:00.000Z"
  });
  const client = new HhApiClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://example.test/hh-callback",
    tokenStore,
    now: () => new Date("2026-04-12T10:00:00.000Z"),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/token")) {
        return jsonResponse(200, {
          access_token: "access-fresh",
          refresh_token: "refresh-fresh",
          expires_in: 7200,
          token_type: "bearer"
        });
      }
      if (calls.filter((call) => call.url.includes("/me")).length === 1) {
        return jsonResponse(401, { error: "expired_token", description: "Access token expired" });
      }
      return jsonResponse(200, { id: "employer-001" });
    }
  });

  const me = await client.getMe();

  assert.equal(me.id, "employer-001");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.headers.Authorization, "Bearer access-stale");
  assert.equal(calls[2].init.headers.Authorization, "Bearer access-fresh");
});

test("hh api client: exchangeCodeForTokens stores normalized expires_at", async () => {
  const tokenStore = makeTokenStore(null);
  const client = new HhApiClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://example.test/hh-callback",
    tokenStore,
    now: () => new Date("2026-04-12T10:00:00.000Z"),
    fetchImpl: async () => jsonResponse(200, {
      access_token: "access-001",
      refresh_token: "refresh-001",
      expires_in: 3600,
      token_type: "bearer"
    })
  });

  const tokens = await client.exchangeCodeForTokens("oauth-code-123");
  const stored = await tokenStore.getTokens();

  assert.equal(tokens.access_token, "access-001");
  assert.equal(stored.expires_at, "2026-04-12T11:00:00.000Z");
});

test("hh api client: surfaces non-retriable HH errors with status and body", async () => {
  const tokenStore = makeTokenStore({
    access_token: "access-001",
    refresh_token: "refresh-001",
    expires_at: "2099-01-01T00:00:00.000Z"
  });
  const client = new HhApiClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://example.test/hh-callback",
    tokenStore,
    fetchImpl: async () => jsonResponse(403, {
      error: "forbidden",
      description: "Employer account has no paid access"
    })
  });

  await assert.rejects(
    client.getMe(),
    (error) => error.status === 403 && error.body?.error === "forbidden"
  );
});
