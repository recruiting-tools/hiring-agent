# Iteration 2 — Real DB and Real LLM

Дата: 2026-04-12

Итерация 1 дала рабочий скелет с in-memory хранилищем и fake LLM. Итерация 2 заменяет оба заглушки на реальные: Neon Postgres как хранилище и Gemini Flash как LLM. Все тесты из итерации 1 остаются зелёными — просто теперь они могут запускаться против реальной базы, а вручную можно прогнать через `pnpm dev:candidate-chatbot` с реальным LLM.

## Что делаем

1. **DB migrations** — создаём схему клиентской базы в Neon dev проекте (`V2_DEV_NEON_URL`).
2. **PostgresHiringStore** — реализует тот же интерфейс что `InMemoryHiringStore`, но читает/пишет в Postgres.
3. **Seed script** — заполняет dev базу данными из `tests/fixtures/iteration-1-seed.json`.
4. **GeminiAdapter** — реализует тот же интерфейс что `FakeLlmAdapter.evaluate()`, строит промпт из шага и возвращает structured output через JSON mode Gemini Flash.
5. **Prompt builder** — функция `buildPrompt(step, context)` собирает системный промпт из полей `goal`, `done_when`, `reject_when` шага плюс резюме и историю.
6. **Integration tests против реального Neon** — тесты из итерации 1 должны пройти с реальной базой через переключаемый runtime (env var `USE_REAL_DB=true`).

## Чего не делаем

- Реальная HH-интеграция (итерация 3).
- Cron отправки `planned_messages`.
- Management DB (клиенты и рекрутеры) — в dev берём из seed, мультитенантность в итерации 4.
- Tool-call шаги с внешними API.
- Деплой на GCP / Cloud Run.
- Telegram уведомления.

## Схема DB (client DB, один клиент)

Создаём только таблицы нужные для итерации 2 (подмножество полной схемы из spec-by-claude.md):

```sql
-- migration: 001_iteration_2_client_schema.sql

CREATE SCHEMA IF NOT EXISTS chatbot;

CREATE TABLE chatbot.jobs (
  job_id         TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.pipeline_templates (
  template_id      TEXT PRIMARY KEY,
  template_version INTEGER NOT NULL,
  job_id           TEXT REFERENCES chatbot.jobs,
  name             TEXT NOT NULL,
  steps_json       JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.candidates (
  candidate_id   TEXT PRIMARY KEY,
  canonical_email TEXT,
  display_name   TEXT,
  resume_text    TEXT,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.conversations (
  conversation_id   TEXT PRIMARY KEY,
  job_id            TEXT REFERENCES chatbot.jobs,
  candidate_id      TEXT REFERENCES chatbot.candidates,
  channel           TEXT NOT NULL,
  channel_thread_id TEXT,
  status            TEXT NOT NULL DEFAULT 'open',
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.pipeline_runs (
  pipeline_run_id  TEXT PRIMARY KEY,
  job_id           TEXT REFERENCES chatbot.jobs,
  candidate_id     TEXT REFERENCES chatbot.candidates,
  template_id      TEXT,
  template_version INTEGER NOT NULL,
  active_step_id   TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.pipeline_step_state (
  pipeline_run_id  TEXT REFERENCES chatbot.pipeline_runs,
  step_id          TEXT NOT NULL,
  step_index       INTEGER NOT NULL,
  state            TEXT NOT NULL DEFAULT 'pending',
  awaiting_reply   BOOLEAN NOT NULL DEFAULT false,
  extracted_facts  JSONB NOT NULL DEFAULT '{}',
  last_reason      TEXT,
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (pipeline_run_id, step_id)
);

CREATE TABLE chatbot.pipeline_events (
  event_id         TEXT PRIMARY KEY,
  pipeline_run_id  TEXT REFERENCES chatbot.pipeline_runs,
  candidate_id     TEXT REFERENCES chatbot.candidates,
  event_type       TEXT NOT NULL,
  step_id          TEXT,
  payload          JSONB NOT NULL DEFAULT '{}',
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.messages (
  message_id         TEXT PRIMARY KEY,
  conversation_id    TEXT REFERENCES chatbot.conversations,
  candidate_id       TEXT REFERENCES chatbot.candidates,
  direction          TEXT NOT NULL CHECK (direction IN ('inbound','outbound','system')),
  message_type       TEXT NOT NULL DEFAULT 'text',
  body               TEXT,
  channel            TEXT NOT NULL,
  channel_message_id TEXT,
  occurred_at        TIMESTAMPTZ,
  received_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chatbot.planned_messages (
  planned_message_id TEXT PRIMARY KEY,
  conversation_id    TEXT REFERENCES chatbot.conversations,
  candidate_id       TEXT REFERENCES chatbot.candidates,
  pipeline_run_id    TEXT REFERENCES chatbot.pipeline_runs,
  step_id            TEXT,
  body               TEXT NOT NULL,
  reason             TEXT,
  review_status      TEXT NOT NULL DEFAULT 'pending',
  moderation_policy  TEXT NOT NULL DEFAULT 'window_to_reject',
  send_after         TIMESTAMPTZ,
  auto_send_after    TIMESTAMPTZ,
  idempotency_key    TEXT UNIQUE,
  created_at         TIMESTAMPTZ DEFAULT now()
);
```

Миграция применяется через:
```bash
psql $V2_DEV_NEON_URL -f services/candidate-chatbot/migrations/001_iteration_2_client_schema.sql
```

## PostgresHiringStore

Новый файл `services/candidate-chatbot/src/postgres-store.js`. Экспортирует `PostgresHiringStore` с теми же публичными методами что `InMemoryHiringStore`:

```
findConversation(conversationId)
findActiveRunForConversation(conversation)
findRunForConversation(conversation)
getPendingSteps(pipelineRunId)
getStepStates(pipelineRunId)
getTemplateStep(jobId, stepId)
getHistory(conversationId)
getLastOutboundBody(conversationId)
addInboundMessage(request, conversation)
addPipelineEvent(event)
applyLlmDecision({ run, job, llmOutput, conversation })
markManualReview({ run, candidateId, reason, rawOutput })
getPendingQueue()
rebuildStepStateFromEvents(pipelineRunId)
```

Использует `@neondatabase/serverless` (уже есть в npm) с `neon(connectionString)` для HTTP-режима (serverless-friendly) или `Pool` из `pg` для локального dev.

**Важно**: все write-операции в `applyLlmDecision` должны выполняться в одной транзакции. Если одна из записей (events, step_state, planned_messages) упадёт — откат всего. Это предотвращает частичное применение LLM-решения.

## GeminiAdapter

Новый файл `services/candidate-chatbot/src/gemini-adapter.js`:

```js
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiAdapter {
  constructor({ apiKey, model = "gemini-2.0-flash" }) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async evaluate({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage }) {
    const prompt = buildPrompt({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage });
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      generationConfig: { responseMimeType: "application/json" }
    });
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
  }
}
```

Prompt builder собирает:
- Системный промпт: роль рекрутера, задача скрининга, инструкция по JSON output
- Вакансию: `job.title`, `job.description`
- Текущие открытые шаги: для каждого `goal`, `done_when`, `reject_when`
- Резюме кандидата (если есть)
- Последние сообщения диалога (последние 10, или все если меньше)
- Входящее сообщение кандидата
- Схему ожидаемого JSON output (step_result, completed_step_ids, и т.д.)

## Переключение runtime (store + adapter)

`services/candidate-chatbot/src/index.js` читает env:

```js
const store = process.env.USE_REAL_DB === "true"
  ? new PostgresHiringStore({ connectionString: process.env.V2_DEV_NEON_URL })
  : new InMemoryHiringStore(seed);

const llmAdapter = process.env.GEMINI_API_KEY
  ? new GeminiAdapter({ apiKey: process.env.GEMINI_API_KEY })
  : new FakeLlmAdapter();
```

По умолчанию — in-memory + fake (safe). С реальным DB и LLM нужны явные env vars.

## Тесты

### Integration tests (текущие — должны оставаться зелёными)

Все 11 тестов из `tests/integration/candidate-chatbot.test.js` продолжают работать с `InMemoryHiringStore` + `FakeLlmAdapter`. Ничего не меняем, они не зависят от DB.

### Новые integration tests против реального Neon

Добавляем `tests/integration/candidate-chatbot-postgres.test.js` — запускается только при `V2_DEV_NEON_URL` в env. Те же сценарии, но через `PostgresHiringStore`:

1. `postgres store: webhook creates planned message in DB`
2. `postgres store: multiple steps completed in single transaction`
3. `postgres store: reject writes run_rejected event`
4. `postgres store: manual_review does not create planned_message in DB`
5. `postgres store: rebuildStepStateFromEvents matches live step_state`

### Тест промпта (unit)

`tests/unit/prompt-builder.test.js`:

1. `prompt contains all pending step goals`
2. `prompt does not include completed step goals`
3. `prompt includes candidate resume`
4. `prompt includes last N messages from history`
5. `json schema is embedded in prompt`

## Seed script

`scripts/seed-dev-db.js` — читает `tests/fixtures/iteration-1-seed.json`, применяет к `V2_DEV_NEON_URL`. Добавить в package.json:

```json
"scripts": {
  "seed:dev": "node scripts/seed-dev-db.js"
}
```

## Acceptance criteria

Итерация считается готовой, когда:

- `pnpm test` (in-memory) проходит — все 11 зелёные.
- `V2_DEV_NEON_URL=... pnpm test:postgres` проходит — все 5 postgres-тестов зелёные.
- `pnpm test:unit` (prompt builder) проходит.
- `V2_DEV_NEON_URL=... node scripts/seed-dev-db.js` заполняет базу без ошибок.
- `USE_REAL_DB=true GEMINI_API_KEY=... pnpm dev:candidate-chatbot` стартует и принимает webhook с реальным LLM.
- Ручной curl к `POST /webhook/message` с `conv-zakup-001` возвращает осмысленный вопрос от Gemini (не заглушку) и создаёт запись в `planned_messages` таблице.
- В коде нет SQL-запросов вне `PostgresHiringStore` — вся работа с базой инкапсулирована.
- Транзакционность: если принудительно убить соединение в середине `applyLlmDecision`, база не содержит частично применённого состояния.

## Порядок работы (XP)

1. Написать failing тест `postgres store: webhook creates planned message in DB` (только скелет `PostgresHiringStore` с нужным интерфейсом).
2. Написать миграцию, применить к dev Neon, тест зелёный.
3. Добавить следующий failing тест (транзакция, reject, manual_review), реализовать.
4. После 5 postgres-тестов — написать unit тесты для prompt builder.
5. Реализовать `GeminiAdapter`, прогнать вручную.
6. Обновить `index.js` для переключения runtime.

## Зависимости

Добавить в `services/candidate-chatbot/package.json`:

```json
{
  "@google/generative-ai": "^0.21.0",
  "@neondatabase/serverless": "^0.10.0"
}
```

`pg` уже должен быть доступен через pnpm workspace или добавить явно для локального dev.
