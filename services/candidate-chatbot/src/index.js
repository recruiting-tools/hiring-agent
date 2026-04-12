import { readFile } from "node:fs/promises";
import { FakeLlmAdapter } from "./fake-llm-adapter.js";
import { GeminiAdapter } from "./gemini-adapter.js";
import { createCandidateChatbot } from "./handlers.js";
import { createHttpServer } from "./http-server.js";
import { InMemoryHiringStore } from "./store.js";
import { PostgresHiringStore } from "./postgres-store.js";
import { NotificationDispatcher } from "./notification-dispatcher.js";
import { FakeTelegramClient } from "./fake-telegram-client.js";
import { TelegramNotifier } from "./telegram-notifier.js";

let store;

if (process.env.USE_REAL_DB === "true") {
  const connectionString = process.env.V2_PROD_NEON_URL || process.env.V2_DEV_NEON_URL;
  if (!connectionString) {
    throw new Error("USE_REAL_DB=true requires V2_PROD_NEON_URL or V2_DEV_NEON_URL to be set");
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

const port = Number(process.env.PORT ?? 3000);
createHttpServer(app, { store }).listen(port, () => {
  console.log(`candidate-chatbot listening on :${port}`);
});
