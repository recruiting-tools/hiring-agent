import { HhApiClient } from "../../hh-connector/src/hh-api-client.js";
import { FakeHhClient } from "../../hh-connector/src/hh-client.js";
import { HhContractMock } from "../../hh-connector/src/hh-contract-mock.js";
import { CronSender } from "../../hh-connector/src/cron-sender.js";
import { HhConnector } from "../../hh-connector/src/hh-connector.js";
import { runPollOnce } from "../../hh-connector/src/poll-loop.js";
import { TokenRefresher } from "../../hh-connector/src/token-refresher.js";

const DEFAULT_HH_API_BASE_URL = "https://api.hh.ru";
const DEFAULT_HH_SEND_BATCH_SIZE = 25;
const MAX_HH_SEND_BATCH_SIZE = 100;

export async function createHhRuntime({ store, chatbot, env = process.env, now = () => new Date() } = {}) {
  const config = resolveHhRuntimeConfig(env);
  const hhOAuthClient = createHhOAuthClient({ store, config });
  const hhClient = await createHhClient({ config, hhOAuthClient });
  const tokenRefresher = hhOAuthClient
    ? new TokenRefresher({ store, hhApiClient: hhOAuthClient })
    : null;

  return {
    config,
    hhOAuthClient,
    hhClient,
    hhPollRunner: createHhPollRunner({ store, chatbot, hhClient, tokenRefresher }),
    hhImportRunner: new HhConnector({
      store,
      hhClient,
      chatbot,
      vacancyMappings: []
    }),
    hhSendRunner: createHhSendRunner({
      store,
      hhClient,
      tokenRefresher,
      batchSize: config.sendBatchSize,
      now
    })
  };
}

export function resolveHhRuntimeConfig(env = process.env) {
  const redirectUri = resolveHhRedirectUri(env.HH_REDIRECT_URI);
  const hasAnyOauthConfig = Boolean(env.HH_CLIENT_ID || env.HH_CLIENT_SECRET || redirectUri);

  if (hasAnyOauthConfig && !(env.HH_CLIENT_ID && env.HH_CLIENT_SECRET && redirectUri)) {
    throw new Error("Invalid HH OAuth configuration: set HH_CLIENT_ID, HH_CLIENT_SECRET and HH_REDIRECT_URI (/hh-callback)");
  }

  return {
    clientId: env.HH_CLIENT_ID ?? null,
    clientSecret: env.HH_CLIENT_SECRET ?? null,
    redirectUri,
    apiBaseUrl: resolveHhApiBaseUrl(env.HH_API_BASE_URL),
    useContractMock: env.HH_USE_CONTRACT_MOCK === "true" || env.HH_USE_MOCK === "true",
    sendBatchSize: resolveHhSendBatchSize(env.HH_SEND_BATCH_SIZE)
  };
}

export function resolveHhRedirectUri(raw) {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["/hh-callback", "/hh-callback/"].includes(parsed.pathname)) {
      throw new Error("Invalid HH callback path");
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function createHhOAuthClient({ store, config }) {
  if (!(config.clientId && config.clientSecret && config.redirectUri)) {
    return null;
  }
  return new HhApiClient({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    apiBaseUrl: config.apiBaseUrl,
    tokenStore: {
      getTokens: () => store.getHhOAuthTokens("hh"),
      setTokens: (tokens) => store.setHhOAuthTokens("hh", tokens)
    }
  });
}

async function createHhClient({ config, hhOAuthClient }) {
  if (config.useContractMock) {
    return HhContractMock.create();
  }
  return hhOAuthClient ?? new FakeHhClient();
}

function createHhPollRunner({ store, chatbot, hhClient, tokenRefresher }) {
  return {
    async pollAll() {
      if (tokenRefresher) {
        await tokenRefresher.refreshIfNeeded();
      }
      return runPollOnce({ store, hhClient, chatbot });
    }
  };
}

function createHhSendRunner({ store, hhClient, tokenRefresher, batchSize, now }) {
  return {
    async sendDue() {
      const startedAt = Date.now();
      console.info(JSON.stringify({ event: "hh_send_runner_enter" }));
      if (tokenRefresher) {
        const refreshResult = await tokenRefresher.refreshIfNeeded();
        console.info(JSON.stringify({
          event: "hh_send_runner_after_refresh",
          refresh_result: refreshResult,
          elapsed_ms: Date.now() - startedAt
        }));
      }
      const sender = new CronSender({ store, hhClient, batchSize, now });
      const results = await sender.tick();
      console.info(JSON.stringify({
        event: "hh_send_runner_after_tick",
        result_count: results.length,
        elapsed_ms: Date.now() - startedAt
      }));
      return {
        processed: results.length,
        sent: results.filter((item) => item.sent).length,
        skipped: results.filter((item) => item.skipped || item.duplicate).length,
        failed: results.filter((item) => !item.sent && !item.skipped && !item.duplicate).length,
        results
      };
    }
  };
}

function resolveHhApiBaseUrl(raw) {
  if (!raw) return DEFAULT_HH_API_BASE_URL;
  const trimmed = String(raw).trim();
  if (!trimmed) return DEFAULT_HH_API_BASE_URL;
  return new URL(trimmed).toString().replace(/\/$/, "");
}

function resolveHhSendBatchSize(raw) {
  const parsed = Number(raw ?? DEFAULT_HH_SEND_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HH_SEND_BATCH_SIZE;
  }
  return Math.min(Math.floor(parsed), MAX_HH_SEND_BATCH_SIZE);
}
