import { readFile } from "node:fs/promises";
import { FakeLlmAdapter } from "./fake-llm-adapter.js";
import { createCandidateChatbot } from "./handlers.js";
import { createHttpServer } from "./http-server.js";
import { InMemoryHiringStore } from "./store.js";

const seed = JSON.parse(await readFile(new URL("../../../tests/fixtures/iteration-1-seed.json", import.meta.url), "utf8"));
const store = new InMemoryHiringStore(seed);
const app = createCandidateChatbot({
  store,
  llmAdapter: new FakeLlmAdapter()
});

const port = Number(process.env.PORT ?? 3000);
createHttpServer(app).listen(port, () => {
  console.log(`candidate-chatbot listening on :${port}`);
});
