import { readFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { FakeLlmAdapter } from "./fake-llm-adapter.js";
import { GeminiAdapter } from "./gemini-adapter.js";
import { createCandidateChatbot } from "./handlers.js";
import { createHttpServer } from "./http-server.js";
import { InMemoryHiringStore } from "./store.js";
import { PostgresHiringStore } from "./postgres-store.js";
import { NotificationDispatcher } from "./notification-dispatcher.js";
import { FakeTelegramClient } from "./fake-telegram-client.js";
import { TelegramNotifier } from "./telegram-notifier.js";
import { createHhRuntime } from "./hh-runtime.js";

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
const {
  hhOAuthClient,
  hhPollRunner,
  hhImportRunner,
  hhSendRunner
} = await createHhRuntime({
  store,
  chatbot: app,
  env: process.env
});

const port = Number(process.env.PORT ?? 3000);
createHttpServer(app, {
  store,
  hhOAuthClient,
  hhPollRunner,
  hhImportRunner,
  hhSendRunner,
  internalApiToken: process.env.INTERNAL_API_TOKEN ?? null
}).listen(port, () => {
  console.log(`candidate-chatbot listening on :${port}`);
});
