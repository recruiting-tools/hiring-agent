# Iteration 3 — HH Integration

Дата: 2026-04-12

Итерация 2 дала рабочий кандидат-чатбот с реальной базой (Neon) и реальным LLM (Gemini Flash). Итерация 3 подключает реальный канал: HH.ru. Поллинг переговоров, инбаунд-сообщения, отправка через cron с окном на отклонение 10 минут.

## Что делаем

1. **hh-connector модуль** (`services/hh-connector/`) — поллинг HH-переговоров, запись инбаунда в DB, обновление `hh_poll_state`.
2. **`awaiting_reply` в `hh_poll_state`** — отслеживает последнего отправителя на уровне HH-канала (независимо от pipeline state).
3. **`CronSender`** — читает `planned_messages` WHERE `review_status IN ('pending','approved')` AND `auto_send_after <= now()`, отправляет через HH API.
4. **`sendHHWithGuard()`** — идемпотентная отправка с проверкой `message_delivery_attempts` перед каждым вызовом HH API.
5. **Window-to-reject** = 10 минут по умолчанию (уже хранится в `planned_messages.auto_send_after`), рекрутер может заблокировать установкой `review_status = 'blocked'`.
6. **Alert-запрос** — метод store, возвращающий переговоры, где `awaiting_reply = true` и последнее delivered outbound > N минут назад.
7. **DB migration** — три новые таблицы в схеме `chatbot` + колонка `sent_at` в `planned_messages`.
8. **FakeHhClient** — мок HH-клиента для всех тестов (без реальных credentials).

## Чего не делаем

- Реальные HH.ru API credentials и живой поллинг.
- Scheduled cron-процесс (строим модуль `CronSender`, не планировщик/daemon).
- HTTP-сервер для `hh-connector` (модуль, не сервис с портом).
- Moderation UI для рекрутера (итерация 4).
- Telegram-уведомления по alert.
- Pre-filter оптимизация поллинга (HH-поле `updated_at` для пропуска неизменившихся переговоров — оставляем на итерацию 4).
- Multi-vacancy поллинг (итерация 4).

## Схема DB (добавляем к chatbot схеме)

```sql
-- migration: 002_iteration_3_hh_integration.sql

-- HH переговоры → наши conversations
CREATE TABLE chatbot.hh_negotiations (
  hh_negotiation_id TEXT PRIMARY KEY,          -- ID переговора в HH API
  job_id            TEXT REFERENCES chatbot.jobs,
  candidate_id      TEXT REFERENCES chatbot.candidates,
  hh_vacancy_id     TEXT NOT NULL,             -- HH vacancy ID (строка вида '12345678')
  hh_collection     TEXT NOT NULL DEFAULT 'response',  -- HH collection: response/invited/etc
  channel_thread_id TEXT NOT NULL,             -- = conversations.channel_thread_id
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Состояние поллинга для каждой переговорки
CREATE TABLE chatbot.hh_poll_state (
  hh_negotiation_id  TEXT PRIMARY KEY REFERENCES chatbot.hh_negotiations,
  last_polled_at     TIMESTAMPTZ,
  hh_updated_at      TIMESTAMPTZ,              -- timestamp последнего сообщения из HH (для будущего pre-filter)
  last_sender        TEXT CHECK (last_sender IN ('applicant', 'employer')),
  awaiting_reply     BOOLEAN NOT NULL DEFAULT false,  -- true = мы отправили последними, ждём кандидата
  no_response_streak INTEGER NOT NULL DEFAULT 0,      -- сколько раз подряд кандидат не ответил
  next_poll_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Попытки доставки — источник истины для idempotency guard
CREATE TABLE chatbot.message_delivery_attempts (
  attempt_id         TEXT PRIMARY KEY,
  planned_message_id TEXT NOT NULL REFERENCES chatbot.planned_messages,
  hh_negotiation_id  TEXT NOT NULL REFERENCES chatbot.hh_negotiations,
  status             TEXT NOT NULL CHECK (status IN ('sending', 'delivered', 'failed', 'duplicate')),
  hh_message_id      TEXT,                     -- ID в HH после успешной отправки
  attempted_at       TIMESTAMPTZ DEFAULT now(),
  error_body         TEXT                      -- тело ошибки если status='failed'
);

-- Добавляем sent_at в planned_messages (null = не отправлено)
ALTER TABLE chatbot.planned_messages ADD COLUMN sent_at TIMESTAMPTZ;
```

Применяется через:
```bash
psql $V2_DEV_NEON_URL -f services/candidate-chatbot/migrations/002_iteration_3_hh_integration.sql
```

## Интерфейсы

### FakeHhClient (мок для тестов)

Новый файл `services/hh-connector/src/hh-client.js`:

```js
export class FakeHhClient {
  constructor() {
    this._negotiations = new Map(); // hh_negotiation_id → { messages: [] }
    this._sentMessages = [];        // лог всех вызовов sendMessage
  }

  // Seed: создаём переговорку с набором сообщений
  addNegotiation(hhNegotiationId, messages = []) {
    this._negotiations.set(hhNegotiationId, { messages: [...messages] });
  }

  // Seed: добавить сообщение в существующую переговорку
  addMessage(hhNegotiationId, { id, author, text, created_at }) {
    const neg = this._negotiations.get(hhNegotiationId);
    if (!neg) throw new Error(`Unknown negotiation: ${hhNegotiationId}`);
    neg.messages.push({ id, author, text, created_at });
  }

  // Интерфейс HH API (все методы async)
  async getMessages(hhNegotiationId) {
    // Возвращает копию массива — НЕ сортирует (HH API не гарантирует порядок)
    const neg = this._negotiations.get(hhNegotiationId);
    if (!neg) return [];
    return neg.messages.map(m => ({ ...m }));
  }

  async sendMessage(hhNegotiationId, text) {
    const hh_message_id = `hh-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._sentMessages.push({ hhNegotiationId, text, hh_message_id });
    this.addMessage(hhNegotiationId, {
      id: hh_message_id,
      author: 'employer',
      text,
      created_at: new Date().toISOString()
    });
    return { hh_message_id };
  }

  // Тест-хелпер: сколько сообщений было отправлено
  sentCount() {
    return this._sentMessages.length;
  }

  // Тест-хелпер: последнее отправленное
  lastSent() {
    return this._sentMessages.at(-1) ?? null;
  }
}
```

### HhConnector

Новый файл `services/hh-connector/src/hh-connector.js`:

```js
export class HhConnector {
  constructor({ store, hhClient, chatbot }) {
    this.store = store;
    this.hhClient = hhClient;
    this.chatbot = chatbot; // createCandidateChatbot({ store, llmAdapter })
  }

  // Поллинг всех переговоров, у которых next_poll_at <= now()
  async pollAll() {
    const due = await this.store.getHhNegotiationsDue();
    for (const neg of due) {
      await this.pollNegotiation(neg.hh_negotiation_id);
    }
  }

  // Поллинг одной переговорки
  async pollNegotiation(hhNegotiationId) {
    // 1. Получить сообщения из HH (порядок не гарантирован)
    const messages = await this.hhClient.getMessages(hhNegotiationId);

    // 2. Сортируем по created_at перед любой логикой (известный баг HH API)
    const sorted = [...messages].sort((a, b) =>
      new Date(a.created_at) - new Date(b.created_at)
    );

    // 3. Узнать что уже видели
    const pollState = await this.store.getHhPollState(hhNegotiationId);
    const lastSeenAt = pollState?.hh_updated_at ?? null;

    // 4. Фильтр: только новые сообщения (после lastSeenAt)
    const newMessages = lastSeenAt
      ? sorted.filter(m => new Date(m.created_at) > new Date(lastSeenAt))
      : sorted;

    // 5. Обработка новых сообщений от кандидата
    const negotiation = await this.store.findHhNegotiation(hhNegotiationId);
    for (const msg of newMessages) {
      if (msg.author === 'applicant') {
        await this.chatbot.postWebhookMessage({
          conversation_id: negotiation.channel_thread_id,
          text: msg.text,
          channel: 'hh',
          channel_message_id: msg.id,
          occurred_at: msg.created_at
        });
      }
    }

    // 6. Обновить poll_state
    const lastMsg = sorted.at(-1);
    await this.store.upsertHhPollState(hhNegotiationId, {
      last_polled_at: new Date().toISOString(),
      hh_updated_at: lastMsg?.created_at ?? lastSeenAt,
      last_sender: lastMsg?.author ?? null,
      awaiting_reply: lastMsg?.author === 'employer',
      next_poll_at: new Date(Date.now() + 60_000).toISOString()
    });
  }
}
```

### CronSender

Новый файл `services/hh-connector/src/cron-sender.js`:

```js
import { sendHHWithGuard } from './send-guard.js';

export class CronSender {
  constructor({ store, hhClient, windowMinutes = 10 }) {
    this.store = store;
    this.hhClient = hhClient;
    this.windowMinutes = windowMinutes;
  }

  // Одна итерация: найти все сообщения к отправке, отправить каждое
  async tick() {
    const due = await this.store.getPlannedMessagesDue(new Date());
    const results = [];
    for (const msg of due) {
      const negotiation = await this.store.findHhNegotiationByChannelThreadId(
        msg.channel_thread_id
      );
      if (!negotiation) {
        // Не HH-разговор или переговорка ещё не заведена — пропускаем
        results.push({ planned_message_id: msg.planned_message_id, skipped: true, reason: 'no_negotiation' });
        continue;
      }
      const result = await sendHHWithGuard({
        store: this.store,
        hhClient: this.hhClient,
        plannedMessage: msg,
        hhNegotiationId: negotiation.hh_negotiation_id
      });
      results.push({ planned_message_id: msg.planned_message_id, ...result });
    }
    return results;
  }
}
```

### sendHHWithGuard

Новый файл `services/hh-connector/src/send-guard.js`:

```js
import { randomUUID } from 'node:crypto';

export async function sendHHWithGuard({ store, hhClient, plannedMessage, hhNegotiationId }) {
  // 1. Проверить существующую успешную попытку (идемпотентность)
  const existing = await store.getSuccessfulDeliveryAttempt(plannedMessage.planned_message_id);
  if (existing) {
    return { sent: false, duplicate: true, hh_message_id: existing.hh_message_id };
  }

  // 2. Записать попытку как 'sending'
  const attempt = await store.recordDeliveryAttempt({
    attempt_id: randomUUID(),
    planned_message_id: plannedMessage.planned_message_id,
    hh_negotiation_id: hhNegotiationId,
    status: 'sending'
  });

  try {
    // 3. Отправить в HH
    const { hh_message_id } = await hhClient.sendMessage(hhNegotiationId, plannedMessage.body);

    // 4. Зафиксировать успех
    await store.markDeliveryAttemptDelivered({ attempt_id: attempt.attempt_id, hh_message_id });
    await store.markPlannedMessageSent({
      planned_message_id: plannedMessage.planned_message_id,
      sent_at: new Date().toISOString(),
      hh_message_id
    });

    return { sent: true, hh_message_id };
  } catch (err) {
    await store.markDeliveryAttemptFailed({ attempt_id: attempt.attempt_id, error_body: err.message });
    return { sent: false, error: err.message };
  }
}
```

## Новые методы store

Добавляем в `InMemoryHiringStore` (для тестов) и `PostgresHiringStore` (для прода):

```
// HH Negotiations
findHhNegotiation(hhNegotiationId)
  → negotiation | null

upsertHhNegotiation({ hh_negotiation_id, job_id, candidate_id, hh_vacancy_id, hh_collection, channel_thread_id })
  → negotiation

findHhNegotiationByChannelThreadId(channelThreadId)
  → negotiation | null                          // по conversations.channel_thread_id

getHhNegotiationsDue()
  → [negotiation]                               // WHERE next_poll_at <= now()

// HH Poll State
getHhPollState(hhNegotiationId)
  → pollState | null

upsertHhPollState(hhNegotiationId, { last_polled_at, hh_updated_at, last_sender, awaiting_reply, next_poll_at })
  → pollState

// Cron Sender
getPlannedMessagesDue(now: Date)
  → [{ ...planned_message, channel_thread_id }] // JOIN conversations; WHERE review_status IN ('pending','approved') AND auto_send_after <= now; NOT review_status='sent'

// Delivery Attempts (sendHHWithGuard)
recordDeliveryAttempt({ attempt_id, planned_message_id, hh_negotiation_id, status })
  → attempt

getSuccessfulDeliveryAttempt(plannedMessageId)
  → attempt | null                              // WHERE status='delivered' LIMIT 1

markDeliveryAttemptDelivered({ attempt_id, hh_message_id })
  → void

markDeliveryAttemptFailed({ attempt_id, error_body })
  → void

markPlannedMessageSent({ planned_message_id, sent_at, hh_message_id })
  → void                                        // SET review_status='sent', sent_at=sent_at

// Alert
getAwaitingReplyStaleConversations(staleMinutes: number)
  → [{ hh_negotiation_id, channel_thread_id, last_sent_at, awaiting_since_minutes }]
  // WHERE hh_poll_state.awaiting_reply=true AND
  //       last delivered outbound message > staleMinutes ago
```

**Важно**: `getPlannedMessagesDue` должен возвращать `channel_thread_id` через JOIN с `chatbot.conversations`, чтобы `CronSender` мог найти нужную HH-переговорку без дополнительного запроса.

## Тесты (писать первыми — TDD)

Файлы: `tests/integration/hh-connector.test.js` и `tests/integration/cron-sender.test.js`

Используют: `InMemoryHiringStore` + `FakeHhClient` + `FakeLlmAdapter`. Никакой реальной DB, никакого HH API.

### hh-connector.test.js

```
1.  hh connector: pollNegotiation writes inbound message to chatbot.messages when applicant sends
2.  hh connector: pollNegotiation triggers chatbot pipeline (creates planned_message) for new applicant message
3.  hh connector: pollNegotiation is idempotent — duplicate poll does not create duplicate inbound message
4.  hh connector: pollNegotiation sorts messages by created_at before determining last_sender
5.  hh connector: pollNegotiation sets awaiting_reply=true when employer sent last
6.  hh connector: pollNegotiation sets awaiting_reply=false after applicant message
7.  hh connector: pollAll only polls negotiations where next_poll_at <= now
```

**Тест 4 (sorted messages) — пример структуры:**
```js
test("hh connector: pollNegotiation sorts messages by created_at before determining last_sender", async () => {
  const store = new InMemoryHiringStore(seed);
  // seed HH negotiation mapping
  await store.upsertHhNegotiation({
    hh_negotiation_id: "neg-001",
    job_id: "job-zakup-001",
    candidate_id: "cand-001",
    hh_vacancy_id: "hh-vac-001",
    hh_collection: "response",
    channel_thread_id: "conv-zakup-001"
  });

  const hhClient = new FakeHhClient();
  // Сообщения в обратном порядке (как может вернуть HH API)
  hhClient.addNegotiation("neg-001", [
    { id: "m2", author: "employer", text: "reply", created_at: "2026-04-12T10:01:00Z" },
    { id: "m1", author: "applicant", text: "hello", created_at: "2026-04-12T10:00:00Z" }
  ]);

  const chatbot = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const connector = new HhConnector({ store, hhClient, chatbot });

  await connector.pollNegotiation("neg-001");

  const pollState = await store.getHhPollState("neg-001");
  // Последнее сообщение по created_at — employer, значит awaiting_reply=true
  assert.equal(pollState.last_sender, "employer");
  assert.equal(pollState.awaiting_reply, true);
});
```

### cron-sender.test.js

```
8.  cron sender: tick sends message when auto_send_after has passed
9.  cron sender: tick does not send message before auto_send_after
10. cron sender: tick skips messages with review_status=blocked
11. cron sender: tick skips planned_message with no matching hh_negotiation
12. cron sender: sendHHWithGuard records delivery_attempt with status=delivered on success
13. cron sender: sendHHWithGuard returns duplicate=true when already delivered (idempotency)
14. cron sender: sendHHWithGuard records failed attempt and returns error when HH throws
15. cron sender: tick sets sent_at on planned_message after successful delivery
16. cron sender: tick sets review_status=sent on planned_message after successful delivery
```

**Тест 13 (idempotency) — пример структуры:**
```js
test("cron sender: sendHHWithGuard returns duplicate=true when already delivered", async () => {
  const store = new InMemoryHiringStore(seed);
  // ... seed negotiations, planned_message ...
  const hhClient = new FakeHhClient();
  hhClient.addNegotiation("neg-001", []);

  // Первый вызов
  const result1 = await sendHHWithGuard({ store, hhClient, plannedMessage, hhNegotiationId: "neg-001" });
  assert.equal(result1.sent, true);
  assert.equal(hhClient.sentCount(), 1);

  // Второй вызов с тем же planned_message_id
  const result2 = await sendHHWithGuard({ store, hhClient, plannedMessage, hhNegotiationId: "neg-001" });
  assert.equal(result2.sent, false);
  assert.equal(result2.duplicate, true);
  assert.equal(hhClient.sentCount(), 1); // HH API не был вызван второй раз
});
```

### stale-reply-alert — часть cron-sender.test.js

```
17. alert: getAwaitingReplyStaleConversations returns negotiation when awaiting_reply=true and last sent > 2h ago
18. alert: getAwaitingReplyStaleConversations does not return negotiation when last sent < 2h ago
```

## Acceptance criteria

Итерация считается готовой, когда:

- `pnpm test` (21 existing in-memory тестов) — все зелёные.
- `pnpm test:hh` (7 hh-connector тестов) — все зелёные.
- `pnpm test:cron` (11 cron-sender тестов) — все зелёные.
- `sendHHWithGuard` идемпотентен: два вызова с одним `planned_message_id` делают ровно один HTTP-вызов к HH.
- `pollNegotiation` идемпотентен: два поллинга без новых HH-сообщений не создают дублей в `chatbot.messages`.
- Сортировка по `created_at` перед определением `last_sender` — работает даже если HH API вернул сообщения не по порядку.
- `awaiting_reply = true` когда employer отправил последним; `false` после ответа кандидата.
- `getAwaitingReplyStaleConversations(120)` возвращает только переговорки с `awaiting_reply=true` И последним outbound > 120 минут назад.
- `pnpm test:postgres` (если `V2_DEV_NEON_URL` выставлен) — 5 postgres-тестов зелёные (без регрессий).
- `pnpm test:unit` — 5 unit-тестов prompt builder зелёные.

## Порядок работы (XP)

1. Написать failing тест №1: `hh connector: pollNegotiation writes inbound message`.
2. Создать `services/hh-connector/src/`: `FakeHhClient` + скелет `HhConnector` + добавить HH-методы в `InMemoryHiringStore` → тест зелёный.
3. Добавить failing тесты №2-7 (pipeline trigger, idempotency, sorted messages, awaiting_reply), реализовать в `HhConnector`.
4. Написать DB migration `002_iteration_3_hh_integration.sql`, применить к dev Neon.
5. Добавить HH-методы в `PostgresHiringStore`.
6. Написать failing тест №8: `cron sender: tick sends message when auto_send_after has passed`.
7. Создать `cron-sender.js` + `send-guard.js` + delivery attempt методы в store → тест зелёный.
8. Добавить failing тесты №9-16 (no-send before window, blocked, no negotiation, idempotency, failure, sent_at) → реализовать.
9. Написать тесты №17-18 (stale reply alert), реализовать `getAwaitingReplyStaleConversations`.
10. Добавить скрипты в корневой `package.json`:
    ```json
    "test:hh":   "node --test tests/integration/hh-connector.test.js",
    "test:cron": "node --test tests/integration/cron-sender.test.js"
    ```
11. Полный прогон: `pnpm test && pnpm test:hh && pnpm test:cron && pnpm test:unit` — все зелёные.

## Зависимости

Новых npm-пакетов не нужно. Уже есть в workspace:
- `@neondatabase/serverless` — для новых методов в `PostgresHiringStore`
- `node:crypto` — для `randomUUID()` в `send-guard.js`

Структура нового модуля:
```
services/hh-connector/
  src/
    hh-client.js       # FakeHhClient
    hh-connector.js    # HhConnector class
    cron-sender.js     # CronSender class
    send-guard.js      # sendHHWithGuard() function
```

Общий `package.json` в `services/hh-connector/package.json` не нужен — модуль подхватывается через pnpm workspace и использует зависимости корня.
