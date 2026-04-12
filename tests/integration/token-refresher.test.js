import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryHiringStore } from "../../services/candidate-chatbot/src/store.js";
import { TokenRefresher } from "../../services/hh-connector/src/token-refresher.js";

const seed = {
  clients: [],
  recruiters: [],
  jobs: [],
  candidate_fixtures: []
};

test("token refresher: refreshes HH token when it expires within one hour", async () => {
  const store = new InMemoryHiringStore(seed);
  await store.setHhOAuthTokens("hh", {
    access_token: "access-old",
    refresh_token: "refresh-old",
    expires_at: "2026-04-12T10:30:00.000Z"
  });

  let refreshCalls = 0;
  const refresher = new TokenRefresher({
    store,
    hhApiClient: {
      async refreshAccessToken() {
        refreshCalls += 1;
        return store.setHhOAuthTokens("hh", {
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_at: "2026-04-12T12:00:00.000Z"
        });
      }
    },
    now: () => new Date("2026-04-12T10:00:00.000Z")
  });

  const result = await refresher.refreshIfNeeded();
  const stored = await store.getHhOAuthTokens("hh");

  assert.equal(result.refreshed, true);
  assert.equal(refreshCalls, 1);
  assert.equal(stored.access_token, "access-new");
});

test("token refresher: does nothing when token is not close to expiry", async () => {
  const store = new InMemoryHiringStore(seed);
  await store.setHhOAuthTokens("hh", {
    access_token: "access-still-good",
    refresh_token: "refresh-old",
    expires_at: "2026-04-12T14:00:00.000Z"
  });

  const refresher = new TokenRefresher({
    store,
    hhApiClient: {
      async refreshAccessToken() {
        throw new Error("should not refresh");
      }
    },
    now: () => new Date("2026-04-12T10:00:00.000Z")
  });

  const result = await refresher.refreshIfNeeded();

  assert.equal(result.refreshed, false);
});

test("token refresher: disables HH flags when refresh fails", async () => {
  const store = new InMemoryHiringStore(seed);
  await store.setFeatureFlag("hh_send", true);
  await store.setFeatureFlag("hh_import", true);
  await store.setHhOAuthTokens("hh", {
    access_token: "access-old",
    refresh_token: "refresh-old",
    expires_at: "2026-04-12T10:30:00.000Z"
  });

  const refresher = new TokenRefresher({
    store,
    hhApiClient: {
      async refreshAccessToken() {
        const error = new Error("Refresh token revoked");
        error.status = 401;
        throw error;
      }
    },
    now: () => new Date("2026-04-12T10:00:00.000Z")
  });

  const result = await refresher.refreshIfNeeded();
  const hhSend = await store.getFeatureFlag("hh_send");
  const hhImport = await store.getFeatureFlag("hh_import");

  assert.equal(result.refreshed, false);
  assert.equal(result.disabled, true);
  assert.match(result.error, /Refresh token revoked/);
  assert.equal(hhSend.enabled, false);
  assert.equal(hhImport.enabled, false);
});
