import { readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { FakeLlmAdapter } from "./fake-llm-adapter.js";
import { GeminiAdapter } from "./gemini-adapter.js";
import { createCandidateChatbot } from "./handlers.js";
import { createHttpServer } from "./http-server.js";
import { HhApiClient } from "../../hh-connector/src/hh-api-client.js";
import { FakeHhClient } from "../../hh-connector/src/hh-client.js";
import { HhContractMock } from "../../hh-connector/src/hh-contract-mock.js";
import { InMemoryHiringStore } from "./store.js";
import { PostgresHiringStore } from "./postgres-store.js";
import { NotificationDispatcher } from "./notification-dispatcher.js";
import { FakeTelegramClient } from "./fake-telegram-client.js";
import { TelegramNotifier } from "./telegram-notifier.js";
import { runPollOnce } from "../../hh-connector/src/poll-loop.js";
import { TokenRefresher } from "../../hh-connector/src/token-refresher.js";
import { HhConnector } from "../../hh-connector/src/hh-connector.js";

let store;

if (process.env.USE_REAL_DB === "true") {
  // CHATBOT_DATABASE_URL is the canonical env for the tenant operational DB.
  // DATABASE_URL accepted as a convenience alias (CI, local overrides) but
  // CHATBOT_DATABASE_URL takes priority to prevent accidental cross-env connections.
  const connectionString = process.env.CHATBOT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("USE_REAL_DB=true requires CHATBOT_DATABASE_URL (or DATABASE_URL) to be set");
  }
  store = new PostgresHiringStore({ connectionString });
  if (process.env.NODE_ENV === "production") {
    // In production: load jobs from DB without overwriting with dev fixtures
    await store.loadJobsFromDb();
    console.log("Using PostgresHiringStore (production)");
  } else {
    // In dev/test: seed the DB with fixtures on startup
    const seed = JSON.parse(await readFile(new URL("../../../tests/fixtures/iteration-1-seed.json", import.meta.url), "utf8"));
    await store.seed(seed);
    console.log("Using PostgresHiringStore (real DB, seeded)");
  }
} else {
  const seed = JSON.parse(await readFile(new URL("../../../tests/fixtures/iteration-1-seed.json", import.meta.url), "utf8"));
  store = new InMemoryHiringStore(seed);
  console.log("Using InMemoryHiringStore (in-memory)");
}

const demoPassword = process.env.CANDIDATE_CHATBOT_DEMO_PASSWORD ?? process.env.DEMO_PASSWORD ?? null;
if (demoPassword && typeof store.setRecruiterPassword === "function") {
  const demoRecruiterToken = process.env.DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";
  const demoRecruiterEmail = process.env.DEMO_RECRUITER_EMAIL ?? "recruiter@example.test";
  const recruiter = await store.getRecruiterByToken(demoRecruiterToken)
    ?? await store.getRecruiterByEmail(demoRecruiterEmail);
  if (recruiter) {
    const hash = await bcrypt.hash(String(demoPassword), 10);
    await store.setRecruiterPassword(recruiter.recruiter_id, hash);
    console.log(`Demo password configured for ${recruiter.email}`);
  } else {
    console.warn(`Demo password provided but recruiter not found (token=${demoRecruiterToken}, email=${demoRecruiterEmail})`);
  }
}

const llmAdapter = process.env.GEMINI_API_KEY
  ? new GeminiAdapter({ apiKey: process.env.GEMINI_API_KEY })
  : new FakeLlmAdapter();

if (process.env.GEMINI_API_KEY) {
  console.log("Using GeminiAdapter (real LLM)");
} else {
  console.log("Using FakeLlmAdapter (fake LLM)");
}

const telegramClient = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramNotifier(process.env.TELEGRAM_BOT_TOKEN)
  : new FakeTelegramClient();

if (process.env.TELEGRAM_BOT_TOKEN) {
  console.log("Using TelegramNotifier (real Telegram)");
} else {
  console.log("Using FakeTelegramClient (fake Telegram)");
}

const notificationDispatcher = new NotificationDispatcher(store, telegramClient);

const app = createCandidateChatbot({ store, llmAdapter, notificationDispatcher });

const hhRedirectUri = resolveHhRedirectUri(process.env.HH_REDIRECT_URI);
const hasHhOAuthConfig = process.env.HH_CLIENT_ID || process.env.HH_CLIENT_SECRET || hhRedirectUri;
if (hasHhOAuthConfig && !(process.env.HH_CLIENT_ID && process.env.HH_CLIENT_SECRET && hhRedirectUri)) {
  throw new Error("Invalid HH OAuth configuration: set HH_CLIENT_ID, HH_CLIENT_SECRET and HH_REDIRECT_URI (/hh-callback)");
}

const hhOAuthClient = process.env.HH_CLIENT_ID && process.env.HH_CLIENT_SECRET && hhRedirectUri
  ? new HhApiClient({
      clientId: process.env.HH_CLIENT_ID,
      clientSecret: process.env.HH_CLIENT_SECRET,
      redirectUri: hhRedirectUri,
      tokenStore: {
        getTokens: () => store.getHhOAuthTokens("hh"),
        setTokens: (tokens) => store.setHhOAuthTokens("hh", tokens)
      }
    })
  : null;

const hhPollClient = process.env.HH_USE_MOCK === "true"
  ? await HhContractMock.create()
  : (hhOAuthClient ?? new FakeHhClient());

const tokenRefresher = hhOAuthClient
  ? new TokenRefresher({ store, hhApiClient: hhOAuthClient })
  : null;

const hhPollRunner = {
  async pollAll() {
    if (tokenRefresher) {
      await tokenRefresher.refreshIfNeeded();
    }
    return runPollOnce({ store, hhClient: hhPollClient, chatbot: app });
  }
};

const hhImportRunner = new HhConnector({
  store,
  hhClient: hhPollClient,
  chatbot: app,
  vacancyMappings: []
});

const port = Number(process.env.PORT ?? 3000);
createHttpServer(app, {
  store,
  hhOAuthClient,
  hhPollRunner,
  hhImportRunner,
  internalApiToken: process.env.INTERNAL_API_TOKEN ?? null
}).listen(port, () => {
  console.log(`candidate-chatbot listening on :${port}`);
});

function resolveHhRedirectUri(raw) {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["/hh-callback", "/hh-callback/"].includes(parsed.pathname)) {
      throw new Error("Invalid HH callback path");
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    console.error(error);
    return null;
  }
}
