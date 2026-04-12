# Iteration 6 — Telegram Notifications

Дата: 2026-04-12

Итерация 5 закрыла multi-tenant изоляцию: рекрутер видит только своих кандидатов. Проблема: он не знает в реальном времени, когда кандидат прошёл ключевой шаг пайплайна. Итерация 6 добавляет Telegram-уведомления: при `step_completed` или `run_rejected` подписанный рекрутер мгновенно получает сообщение в Telegram.

## Что делаем

1. **`tg_chat_id` колонка** на `chatbot.recruiters` (BIGINT, nullable) — хранит Telegram chat ID рекрутера.

2. **`management.recruiter_subscriptions` таблица** — связывает рекрутера с комбинацией `job_id + step_index + event_type`, на которую он подписан.

3. **`TelegramNotifier` класс** (`src/telegram-notifier.js`) — обёртка над Telegram Bot API `sendMessage`. Интерфейс: `notify(chatId, message)`.

4. **`FakeTelegramClient`** (`src/fake-telegram-client.js`) — in-memory fake для тестов: записывает сообщения в `this.sent[]`, HTTP не делает.

5. **`NotificationDispatcher` класс** (`src/notification-dispatcher.js`) — принимает новые pipeline events из `applyLlmDecision`, проверяет подписки, вызывает telegram client. Stateless: нет внутреннего состояния.

6. **Расширения `InMemoryHiringStore`** (`src/store.js`):
   - `this.recruiterSubscriptions = seed.recruiter_subscriptions ?? []` в конструктор
   - `getRecruiterById(recruiterId)` — поиск по ID (не по token)
   - `findRunById(pipelineRunId)` — поиск run по ID
   - `addSubscription({ recruiter_id, job_id, step_index, event_type })` — добавляет подписку
   - `removeSubscription(recruiterId, jobId, stepIndex, eventType)` — удаляет подписку
   - `getSubscriptionsForStep(jobId, stepIndex, eventType)` — фильтр по трём полям

7. **Интеграция в `handlers.js`**: `createCandidateChatbot` принимает опциональный `notificationDispatcher`. После `applyLlmDecision` фиксируем дельту `pipelineEvents` и передаём в `dispatcher.dispatch(newEvents)`.

8. **Миграция** `007_iteration_6_telegram.sql`.

9. **Seed-файл** `tests/fixtures/iteration-6-seed.json` с рекрутерами и `tg_chat_id`.

## Чего не делаем

- Telegram Bot polling loop — нет `setInterval`/long-poll в этой итерации.
- Webhook-сервер для Telegram — вне скоупа.
- Команды бота (`/subscribe`, `/unsubscribe`) — бонус если останется время; ядро — event dispatch.
- Дедупликация / rate limiting уведомлений.
- Отдельный notification service — всё живёт в `candidate-chatbot`.
- Deploy в продакшн.
- `PostgresHiringStore` — обновить seed() и query-методы — BONUS, не блокирует acceptance criteria.

## Ключевой инвариант

```
applyLlmDecision(...)                      ← существующий код
  → добавляет pipeline events в store

handlers.js: newEvents = store.pipelineEvents.slice(beforeCount)
  → dispatcher.dispatch(newEvents)

NotificationDispatcher.dispatch([event]):
  event.event_type = 'step_completed'
  event.step_id    = 'tg_step_1'
  → run = store.findRunById(event.pipeline_run_id)
  → templateStep = store.getTemplateStep(run.job_id, event.step_id)
    → step_index = 1
  → subs = store.getSubscriptionsForStep(run.job_id, 1, 'step_completed')
    → [{ recruiter_id: 'rec-tg-001', ... }]
  → recruiter = store.getRecruiterById('rec-tg-001')
    → { tg_chat_id: 123456789, ... }
  → telegramClient.notify(123456789, 'Кандидат X прошёл шаг ...')

  Если tg_chat_id IS NULL   → skip (no error, no message)
  Если нет подписок          → skip (notifier не вызывается)
  Если step_index не совпадает → skip
  Если event_type не совпадает → skip
  Если event_type не в допустимых → пропускается молча
```

## DB Schema

### Migration 007

Файл: `services/candidate-chatbot/migrations/007_iteration_6_telegram.sql`

```sql
-- migration: 007_iteration_6_telegram.sql

-- 1. Add tg_chat_id to recruiters (nullable — recruiter may not have connected Telegram)
ALTER TABLE chatbot.recruiters
  ADD COLUMN IF NOT EXISTS tg_chat_id BIGINT;

-- 2. recruiter_subscriptions in management schema
CREATE TABLE IF NOT EXISTS management.recruiter_subscriptions (
  subscription_id  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  recruiter_id     TEXT NOT NULL,
  job_id           TEXT NOT NULL,
  step_index       INTEGER NOT NULL,
  event_type       TEXT NOT NULL DEFAULT 'step_completed'
    CHECK (event_type IN ('step_completed', 'run_rejected')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recruiter_id, job_id, step_index, event_type)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_recruiter
  ON management.recruiter_subscriptions(recruiter_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_job_step
  ON management.recruiter_subscriptions(job_id, step_index);

-- 3. Seed demo tg_chat_id for test recruiters (idempotent)
UPDATE chatbot.recruiters SET tg_chat_id = 123456789 WHERE recruiter_id = 'rec-tg-001';
UPDATE chatbot.recruiters SET tg_chat_id = 987654321 WHERE recruiter_id = 'rec-tg-002';
-- rec-tg-no-chat left NULL intentionally (tests null-skip path)
```

Применяется через:
```bash
psql $V2_DEV_NEON_URL -f services/candidate-chatbot/migrations/007_iteration_6_telegram.sql
```

> **Почему `run_rejected`, а не `step_rejected`?** Существующий `applyLlmDecision` в `store.js` создаёт события с `event_type: "run_rejected"` — это финальный исход для всего run, а не для отдельного шага. Шаги не имеют своего "rejected" события; отклонение сразу завершает pipeline run. Подписки используют тот же vocabulary.

## Интерфейсы классов

### TelegramNotifier

```js
// services/candidate-chatbot/src/telegram-notifier.js
export class TelegramNotifier {
  constructor(botToken) {
    this.botToken = botToken;
  }

  async notify(chatId, message) {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
    }
    return await res.json();
  }
}
```

### FakeTelegramClient

```js
// services/candidate-chatbot/src/fake-telegram-client.js
export class FakeTelegramClient {
  constructor() {
    this.sent = [];  // [{ chatId, message }]
  }

  async notify(chatId, message) {
    this.sent.push({ chatId, message });
  }

  sentTo(chatId) {
    return this.sent.filter(s => s.chatId === chatId);
  }

  clear() {
    this.sent = [];
  }
}
```

### NotificationDispatcher

```js
// services/candidate-chatbot/src/notification-dispatcher.js
export class NotificationDispatcher {
  constructor(store, telegramClient) {
    this.store = store;
    this.telegramClient = telegramClient;
  }

  // Called after applyLlmDecision — pass the newly emitted events
  async dispatch(newEvents) {
    for (const event of newEvents) {
      if (event.event_type === 'step_completed' || event.event_type === 'run_rejected') {
        await this._handleStepEvent(event);
      }
    }
  }

  async _handleStepEvent(event) {
    const run = this.store.findRunById(event.pipeline_run_id);
    if (!run) return;

    const job = this.store.getJob(run.job_id);
    const templateStep = event.step_id
      ? this.store.getTemplateStep(run.job_id, event.step_id)
      : null;
    const stepIndex = templateStep?.step_index ?? null;

    const subs = this.store.getSubscriptionsForStep(run.job_id, stepIndex, event.event_type);

    for (const sub of subs) {
      const recruiter = this.store.getRecruiterById(sub.recruiter_id);
      if (!recruiter?.tg_chat_id) continue;  // null tg_chat_id → skip gracefully

      const candidate = this.store.getCandidate(run.candidate_id);
      const message = this._buildMessage(event, job, candidate, templateStep);
      await this.telegramClient.notify(recruiter.tg_chat_id, message);
    }
  }

  _buildMessage(event, job, candidate, templateStep) {
    const candidateName = candidate?.display_name ?? 'Кандидат';
    const jobTitle = job?.title ?? 'Вакансия';
    const stepGoal = templateStep?.goal ?? event.step_id ?? '—';

    if (event.event_type === 'step_completed') {
      return `Кандидат ${candidateName} прошёл шаг «${stepGoal}» (${jobTitle})`;
    } else if (event.event_type === 'run_rejected') {
      return `Кандидат ${candidateName} отклонён на шаге «${stepGoal}» (${jobTitle})`;
    }
    return `Событие ${event.event_type} по кандидату ${candidateName} (${jobTitle})`;
  }
}
```

## Расширения InMemoryHiringStore

### Конструктор

```js
constructor(seed) {
  // ... существующий код без изменений ...
  this.recruiterSubscriptions = structuredClone(seed.recruiter_subscriptions ?? []);
}
```

### Новые методы

```js
getRecruiterById(recruiterId) {
  return this.recruiters.find(r => r.recruiter_id === recruiterId) ?? null;
}

findRunById(pipelineRunId) {
  return this.pipelineRuns.get(pipelineRunId) ?? null;
}

addSubscription(sub) {
  // sub: { recruiter_id, job_id, step_index, event_type }
  const existing = this.recruiterSubscriptions.find(
    s => s.recruiter_id === sub.recruiter_id &&
         s.job_id === sub.job_id &&
         s.step_index === sub.step_index &&
         s.event_type === sub.event_type
  );
  if (!existing) {
    this.recruiterSubscriptions.push({
      subscription_id: this.nextId('sub'),
      created_at: new Date().toISOString(),
      ...sub
    });
  }
}

removeSubscription(recruiterId, jobId, stepIndex, eventType = 'step_completed') {
  this.recruiterSubscriptions = this.recruiterSubscriptions.filter(
    s => !(s.recruiter_id === recruiterId &&
           s.job_id === jobId &&
           s.step_index === stepIndex &&
           s.event_type === eventType)
  );
}

getSubscriptionsForStep(jobId, stepIndex, eventType) {
  return this.recruiterSubscriptions.filter(
    s => s.job_id === jobId &&
         s.step_index === stepIndex &&
         s.event_type === eventType
  );
}
```

## Интеграция в handlers.js

После `applyLlmDecision` вызываем dispatcher. Количество событий до и после фиксируем вокруг вызова:

```js
// createCandidateChatbot добавляет параметр notificationDispatcher (опциональный):
export function createCandidateChatbot({ store, llmAdapter, validatorConfig, notificationDispatcher }) {
  return {
    async postWebhookMessage(request) {
      // ... существующий код ...

      const beforeEventCount = store.pipelineEvents.length;
      const plannedMessage = await store.applyLlmDecision({
        run, job, llmOutput: validation.output, conversation, pendingSteps
      });

      if (notificationDispatcher) {
        const newEvents = store.pipelineEvents.slice(beforeEventCount);
        await notificationDispatcher.dispatch(newEvents);
      }

      // ... return response (без изменений) ...
    }
    // ... остальные методы без изменений ...
  };
}
```

Тесты, которые не передают `notificationDispatcher`, продолжают работать без изменений — параметр опциональный.

## Seed — iteration-6-seed.json

Создать `tests/fixtures/iteration-6-seed.json`:

```json
{
  "clients": [
    { "client_id": "client-alpha-001", "name": "Alpha Corp" }
  ],
  "recruiters": [
    {
      "recruiter_id":    "rec-tg-001",
      "client_id":       "client-alpha-001",
      "email":           "tg-recruiter@alpha.test",
      "recruiter_token": "rec-tok-tg-001",
      "tg_chat_id":      123456789
    },
    {
      "recruiter_id":    "rec-tg-002",
      "client_id":       "client-alpha-001",
      "email":           "tg-recruiter2@alpha.test",
      "recruiter_token": "rec-tok-tg-002",
      "tg_chat_id":      987654321
    },
    {
      "recruiter_id":    "rec-tg-no-chat",
      "client_id":       "client-alpha-001",
      "email":           "no-chat@alpha.test",
      "recruiter_token": "rec-tok-tg-no-chat",
      "tg_chat_id":      null
    }
  ],
  "jobs": [
    {
      "job_id":    "job-tg-dev",
      "client_id": "client-alpha-001",
      "title":     "TG Test Developer",
      "description": "For telegram notification tests.",
      "pipeline_template": {
        "template_id":      "tpl-tg-dev-v1",
        "template_version": 1,
        "name":             "tg-dev-screening-v1",
        "steps": [
          {
            "id": "tg_step_1", "step_index": 1, "kind": "question",
            "goal": "Проверить навыки",
            "done_when": "кандидат описал навыки",
            "reject_when": "нет навыков",
            "prompt_key": "step.tg_step_1"
          },
          {
            "id": "tg_step_2", "step_index": 2, "kind": "question",
            "goal": "Проверить опыт",
            "done_when": "кандидат описал опыт",
            "reject_when": "нет опыта",
            "prompt_key": "step.tg_step_2"
          }
        ]
      }
    }
  ],
  "candidate_fixtures": [
    {
      "candidate_id":    "cand-tg-001",
      "job_id":          "job-tg-dev",
      "conversation_id": "conv-tg-001",
      "pipeline_run_id": "run-tg-001",
      "display_name":    "Tg Candidate",
      "resume_text":     "Developer candidate for tg tests.",
      "inbound_text":    "Привет, я разработчик."
    }
  ],
  "recruiter_subscriptions": []
}
```

Подписки добавляются в индивидуальных тестах через `store.addSubscription(...)` для ясности.

## Тесты (TDD, писать первыми)

Файл: `tests/integration/telegram-notifications.test.js`

```
1.  tg: step_completed fires notification to subscribed recruiter with tg_chat_id
2.  tg: step_completed does NOT fire notification when no subscriptions exist
3.  tg: step_completed does NOT fire for wrong step_index subscription
4.  tg: multiple subscribers for same job+step all receive notifications
5.  tg: recruiter with null tg_chat_id is skipped gracefully (no error thrown)
6.  tg: run_rejected fires notification for run_rejected subscription
7.  tg: step_completed subscription does NOT fire on run_rejected event
8.  tg: removing subscription prevents future notifications
9.  tg: notification message contains job title and candidate name
10. tg: existing postWebhookMessage works without notificationDispatcher (no crash)
```

### Тест 1 — step_completed отправляет уведомление

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryHiringStore } from '../../services/candidate-chatbot/src/store.js';
import { FakeTelegramClient } from '../../services/candidate-chatbot/src/fake-telegram-client.js';
import { NotificationDispatcher } from '../../services/candidate-chatbot/src/notification-dispatcher.js';
import { readFileSync } from 'node:fs';

const seed6 = JSON.parse(readFileSync(
  new URL('../fixtures/iteration-6-seed.json', import.meta.url), 'utf8'
));

test('tg: step_completed fires notification to subscribed recruiter with tg_chat_id', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chatId, 123456789);
});
```

### Тест 2 — нет подписок, нет уведомлений

```js
test('tg: step_completed does NOT fire notification when no subscriptions exist', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  // Подписки не добавляем
  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 0);
});
```

### Тест 3 — неправильный step_index

```js
test('tg: step_completed does NOT fire for wrong step_index subscription', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  // Подписан на step_index 2, но событие на step_index 1
  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   2,
    event_type:   'step_completed'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',   // step_index = 1
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 0);
});
```

### Тест 4 — несколько подписчиков

```js
test('tg: multiple subscribers all receive notifications', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({ recruiter_id: 'rec-tg-001', job_id: 'job-tg-dev', step_index: 1, event_type: 'step_completed' });
  store.addSubscription({ recruiter_id: 'rec-tg-002', job_id: 'job-tg-dev', step_index: 1, event_type: 'step_completed' });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 2);
  const chatIds = tg.sent.map(s => s.chatId);
  assert.ok(chatIds.includes(123456789));
  assert.ok(chatIds.includes(987654321));
});
```

### Тест 5 — null tg_chat_id не вызывает ошибку

```js
test('tg: recruiter with null tg_chat_id is skipped gracefully', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  // Подписан рекрутер без tg_chat_id
  store.addSubscription({
    recruiter_id: 'rec-tg-no-chat',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  // Не должен бросать исключение
  await assert.doesNotReject(() => dispatcher.dispatch([event]));
  assert.equal(tg.sent.length, 0);
});
```

### Тест 6 — run_rejected с подпиской на run_rejected

```js
test('tg: run_rejected fires notification for run_rejected subscription', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'run_rejected'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'run_rejected',
    step_id:         'tg_step_1',
    payload:         { reason: 'reject_when_matched' }
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chatId, 123456789);
});
```

### Тест 7 — step_completed подписка не срабатывает на run_rejected

```js
test('tg: step_completed subscription does NOT fire on run_rejected event', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'   // подписан только на completions
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'run_rejected',  // другой event_type
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 0);
});
```

### Тест 8 — removeSubscription отключает уведомления

```js
test('tg: removing subscription prevents future notifications', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'
  });

  // Первый fire → уведомление приходит
  const event1 = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });
  await dispatcher.dispatch([event1]);
  assert.equal(tg.sent.length, 1);

  // Удаляем подписку
  store.removeSubscription('rec-tg-001', 'job-tg-dev', 1, 'step_completed');
  tg.clear();

  // Второй fire → уведомления нет
  const event2 = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });
  await dispatcher.dispatch([event2]);
  assert.equal(tg.sent.length, 0);
});
```

### Тест 9 — содержимое сообщения

```js
test('tg: notification message contains job title and candidate name', async () => {
  const store = new InMemoryHiringStore(seed6);
  const tg = new FakeTelegramClient();
  const dispatcher = new NotificationDispatcher(store, tg);

  store.addSubscription({
    recruiter_id: 'rec-tg-001',
    job_id:       'job-tg-dev',
    step_index:   1,
    event_type:   'step_completed'
  });

  const event = store.addPipelineEvent({
    pipeline_run_id: 'run-tg-001',
    candidate_id:    'cand-tg-001',
    event_type:      'step_completed',
    step_id:         'tg_step_1',
    payload:         {}
  });

  await dispatcher.dispatch([event]);

  assert.equal(tg.sent.length, 1);
  assert.ok(tg.sent[0].message.includes('TG Test Developer'), 'message should include job title');
  assert.ok(tg.sent[0].message.includes('Tg Candidate'),     'message should include candidate name');
});
```

### Тест 10 — postWebhookMessage работает без notificationDispatcher

```js
import { createCandidateChatbot } from '../../services/candidate-chatbot/src/handlers.js';
import { FakeLlmAdapter } from '../../services/candidate-chatbot/src/fake-llm-adapter.js';

test('tg: existing postWebhookMessage works without notificationDispatcher (no crash)', async () => {
  const store = new InMemoryHiringStore(seed6);
  // notificationDispatcher не передаём
  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });

  const res = await app.postWebhookMessage({
    conversation_id:    'conv-tg-001',
    text:               'Я разработчик с 5 годами опыта',
    channel:            'test',
    channel_message_id: 'msg-001',
    occurred_at:        new Date().toISOString()
  });

  // Завершается нормально, без dispatcher
  assert.ok([200, 202].includes(res.status));
});
```

## Порядок работы (XP)

1. Создать `tests/fixtures/iteration-6-seed.json` (seed из этого документа).
2. Написать failing тесты 1-5 (`telegram-notifications.test.js`).
3. Создать `FakeTelegramClient` в `src/fake-telegram-client.js`.
4. Добавить в `InMemoryHiringStore`:
   - `this.recruiterSubscriptions = []` в конструктор
   - методы: `getRecruiterById`, `findRunById`, `addSubscription`, `removeSubscription`, `getSubscriptionsForStep`
5. Создать `NotificationDispatcher` в `src/notification-dispatcher.js`.
6. Тесты 1-5 → зелёные.
7. Написать failing тесты 6-8 → сделать зелёными (run_rejected, removeSubscription).
8. Написать failing тесты 9-10 → зелёные (message content, no-dispatcher).
9. Обновить `createCandidateChatbot` в `handlers.js`: добавить опциональный параметр `notificationDispatcher`, вызывать `dispatch(newEvents)` после `applyLlmDecision`.
10. Создать `TelegramNotifier` в `src/telegram-notifier.js` (реальная реализация, в тестах не используется).
11. Создать миграцию `007_iteration_6_telegram.sql`.
12. Добавить скрипт в корневой `package.json`:
    ```json
    "test:telegram": "node --test tests/integration/telegram-notifications.test.js"
    ```
13. Полный прогон:
    ```bash
    pnpm test && pnpm test:telegram
    ```
14. (Если `V2_DEV_NEON_URL` доступен) применить миграцию:
    ```bash
    psql $V2_DEV_NEON_URL -f services/candidate-chatbot/migrations/007_iteration_6_telegram.sql
    ```

## Acceptance Criteria

Итерация считается готовой, когда:

- `pnpm test` — все 62 предыдущих теста зелёные. Ноль регрессий.
- `pnpm test:telegram` — все 10 новых тестов зелёные.
- `NotificationDispatcher.dispatch([stepCompletedEvent])` при наличии подписки → `FakeTelegramClient.sent.length === 1`.
- Рекрутер с `tg_chat_id = null` не вызывает ошибок.
- Рекрутер без совпадающей подписки не получает уведомление.
- `removeSubscription` работает — после удаления уведомление не приходит.
- `createCandidateChatbot` без `notificationDispatcher` не ломает существующие тесты.
- `007_iteration_6_telegram.sql` применяется к dev Neon без ошибок.

## Зависимости

Новых npm-пакетов нет (Telegram API вызывается через `fetch`, доступен в Node.js 18+).

Изменённые/новые файлы:

```
services/candidate-chatbot/
  src/
    telegram-notifier.js          # новый — обёртка над Telegram Bot API
    fake-telegram-client.js       # новый — in-memory fake для тестов
    notification-dispatcher.js    # новый — event → subscription → dispatch
    store.js                      # обновить — recruiterSubscriptions + 5 методов
    handlers.js                   # обновить — опциональный notificationDispatcher
  migrations/
    007_iteration_6_telegram.sql  # новый
tests/
  integration/
    telegram-notifications.test.js  # новый (10 тестов)
  fixtures/
    iteration-6-seed.json           # новый
package.json                        # +test:telegram script
```
