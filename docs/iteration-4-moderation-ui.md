# Iteration 4 — Moderation UI

Дата: 2026-04-12

Итерация 3 дала рабочий канал HH: поллинг входящих, хранение состояния переговоров, идемпотентная отправка через `sendHHWithGuard`, window-to-reject 10 минут. Итерация 4 строит простую веб-страницу для рекрутера: посмотреть что скоро уйдёт, заблокировать или ускорить отправку.

## Что делаем

1. **Три новых HTTP-маршрута** в `services/candidate-chatbot/src/http-server.js`:
   - `GET /recruiter/:token` — отдаёт HTML-страницу модерации (inline-строка, без файлов)
   - `GET /recruiter/:token/queue` — JSON: список pending/approved сообщений с таймером
   - `POST /recruiter/:token/queue/:id/block` — блокировать отправку (`review_status = 'blocked'`)
   - `POST /recruiter/:token/queue/:id/send-now` — выставить `auto_send_after` в прошлое → CronSender заберёт на следующем тике

2. **Четыре новых метода store** в `InMemoryHiringStore` (и затем в `PostgresHiringStore`):
   - `getRecruiterByToken(token)` → recruiter | null
   - `getQueueForRecruiter(recruiterToken)` → QueueItem[]
   - `blockMessage(plannedMessageId)` → void
   - `approveAndSendNow(plannedMessageId)` → void

3. **Обновление seed-данных** — добавить `recruiter_token` в объект рекрутера.

4. **DB migration** `003_iteration_4_moderation_ui.sql` — таблица `chatbot.recruiters` с полем `recruiter_token`.

5. **HTML-страница** — одна строка в коде, никаких файлов, никаких зависимостей: plain `fetch` + `setInterval` для обратного счётчика.

## Чего не делаем

- Системы авторизации, сессий, JWT — token в URL достаточно для итерации 4.
- Telegram-уведомлений (итерация 6).
- Multi-tenant изоляции (итерация 5) — один рекрутер видит все pending сообщения клиента.
- React/Vue/Svelte и любого build step.
- Pre-filter поллинга HH по `updated_at` (сдвинуто из итерации 3).
- Multi-vacancy поллинга (итерация 5).
- Пагинации или фильтров в UI (список < 100 элементов для итерации 4).

## Seed-данные — обновление

Добавить поле в `tests/fixtures/iteration-1-seed.json`:

```json
{
  "client": { ... },
  "recruiter": {
    "recruiter_id": "recruiter-demo-001",
    "client_id": "client-demo-001",
    "email": "recruiter@example.test",
    "recruiter_token": "rec-tok-demo-001"
  },
  ...
}
```

`recruiter_token` — непрозрачная строка, не JWT, не UUID. Для итерации 4 достаточно.

## DB Migration

```sql
-- migration: 003_iteration_4_moderation_ui.sql

CREATE TABLE IF NOT EXISTS chatbot.recruiters (
  recruiter_id    TEXT PRIMARY KEY,
  client_id       TEXT,
  email           TEXT,
  recruiter_token TEXT UNIQUE NOT NULL
);

-- Seed demo recruiter
INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token)
VALUES ('recruiter-demo-001', 'client-demo-001', 'recruiter@example.test', 'rec-tok-demo-001')
ON CONFLICT (recruiter_id) DO UPDATE SET recruiter_token = EXCLUDED.recruiter_token;
```

Применяется через:
```bash
psql $V2_DEV_NEON_URL -f services/candidate-chatbot/migrations/003_iteration_4_moderation_ui.sql
```

## API-контракты

### GET /recruiter/:token/queue

**Успех (200):**
```json
{
  "recruiter_id": "recruiter-demo-001",
  "items": [
    {
      "planned_message_id": "pm-0001",
      "conversation_id": "conv-zakup-001",
      "candidate_display_name": "Максим Волков",
      "job_title": "Закупщик (Китай)",
      "active_step_goal": "Понять масштаб закупок",
      "body": "Максим, уточните, пожалуйста...",
      "reason": "Закрыты шаги direct_china_suppliers, china_platforms. Остались purchase_volume.",
      "review_status": "pending",
      "auto_send_after": "2026-04-12T10:30:00.000Z",
      "seconds_until_auto_send": 312
    }
  ]
}
```

`seconds_until_auto_send` = `Math.round((new Date(auto_send_after) - Date.now()) / 1000)`. Отрицательное значение = сообщение просрочено (cron не тикнул), показываем «Отправка...».

В список включаются только `review_status IN ('pending', 'approved')`.
**Blocked и sent не включаются.**

**Ошибка — неизвестный token (404):**
```json
{ "error": "recruiter_not_found" }
```

---

### POST /recruiter/:token/queue/:id/block

**Тело запроса:** пустое (или `{}`).

**Успех (200):**
```json
{ "planned_message_id": "pm-0001", "review_status": "blocked" }
```

**Ошибка — неизвестный token (404):**
```json
{ "error": "recruiter_not_found" }
```

**Ошибка — неизвестный planned_message_id (404):**
```json
{ "error": "planned_message_not_found" }
```

**Ошибка — сообщение уже отправлено (409):**
```json
{ "error": "already_sent" }
```

---

### POST /recruiter/:token/queue/:id/send-now

**Тело запроса:** пустое (или `{}`).

**Успех (200):**
```json
{
  "planned_message_id": "pm-0001",
  "review_status": "approved",
  "auto_send_after": "2026-04-12T10:00:00.000Z",
  "queued_for_immediate_send": true
}
```

Внутри: `auto_send_after` выставляется в `new Date(Date.now() - 1000)` (секунда назад), `review_status = 'approved'`. CronSender на следующем тике (≤ 1 мин при нормальном интервале) отправит.

**Ошибка — неизвестный token (404):**
```json
{ "error": "recruiter_not_found" }
```

**Ошибка — неизвестный planned_message_id (404):**
```json
{ "error": "planned_message_not_found" }
```

**Ошибка — сообщение уже отправлено (409):**
```json
{ "error": "already_sent" }
```

---

### GET /recruiter/:token

Возвращает HTML-страницу с `Content-Type: text/html; charset=utf-8`.

Никакого тела запроса. Страница — inline-строка в коде (см. ниже).

## HTML-страница (структура)

```
┌──────────────────────────────────────────────────────────────┐
│  Очередь модерации                             [обновляется] │
│                                                              │
│  Кандидат         │ Вакансия     │ Шаг        │ Отправка    │
│ ─────────────────────────────────────────────────────────── │
│  Максим Волков    │ Закупщик     │ Масштаб    │ через 4:52  │
│                                                              │
│  "Максим, уточните, пожалуйста, объём закупок:              │
│   сколько партий в месяц или месячный бюджет?"              │
│                                                              │
│            [Заблокировать]     [Отправить сейчас]           │
│ ─────────────────────────────────────────────────────────── │
│  Иван Петров      │ Повар        │ Медкнижка  │ через 9:01  │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

**Технические детали HTML-страницы:**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Очередь модерации</title>
  <style>
    /* inline — ~30 строк, минимальный сброс + таблица */
    body { font-family: sans-serif; padding: 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    .body-preview { color: #555; font-size: 0.9em; max-width: 400px; }
    .countdown { font-weight: bold; }
    .overdue { color: #c00; }
    button { margin: 0 0.25rem; padding: 0.3rem 0.75rem; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Очередь модерации</h1>
  <div id="status"></div>
  <table id="queue">
    <thead>
      <tr>
        <th>Кандидат</th><th>Вакансия</th><th>Шаг</th>
        <th>Отправка</th><th>Сообщение</th><th>Действие</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
  <script>
    const TOKEN = location.pathname.split('/')[2];
    let items = [];

    async function fetchQueue() {
      const r = await fetch(`/recruiter/${TOKEN}/queue`);
      if (!r.ok) { document.getElementById('status').textContent = 'Ошибка загрузки'; return; }
      const data = await r.json();
      items = data.items;
      renderTable();
    }

    function renderTable() {
      const tbody = document.querySelector('#queue tbody');
      tbody.innerHTML = '';
      for (const item of items) {
        const tr = document.createElement('tr');
        tr.dataset.id = item.planned_message_id;
        tr.dataset.sendAfter = item.auto_send_after;
        tr.innerHTML = `
          <td>${item.candidate_display_name}</td>
          <td>${item.job_title}</td>
          <td>${item.active_step_goal}</td>
          <td class="countdown"></td>
          <td class="body-preview">${item.body.slice(0, 120)}${item.body.length > 120 ? '...' : ''}</td>
          <td>
            <button onclick="doBlock('${item.planned_message_id}')">Заблокировать</button>
            <button onclick="doSendNow('${item.planned_message_id}')">Отправить сейчас</button>
          </td>`;
        tbody.appendChild(tr);
      }
    }

    function updateCountdowns() {
      const now = Date.now();
      for (const tr of document.querySelectorAll('#queue tbody tr')) {
        const sendAfter = new Date(tr.dataset.sendAfter).getTime();
        const secs = Math.round((sendAfter - now) / 1000);
        const td = tr.querySelector('.countdown');
        if (secs <= 0) {
          td.textContent = 'Отправка...';
          td.className = 'countdown overdue';
        } else {
          const m = Math.floor(secs / 60), s = secs % 60;
          td.textContent = `через ${m}:${String(s).padStart(2,'0')}`;
          td.className = 'countdown';
        }
      }
    }

    async function doBlock(id) {
      await fetch(`/recruiter/${TOKEN}/queue/${id}/block`, { method: 'POST' });
      fetchQueue();
    }

    async function doSendNow(id) {
      await fetch(`/recruiter/${TOKEN}/queue/${id}/send-now`, { method: 'POST' });
      fetchQueue();
    }

    fetchQueue();
    setInterval(fetchQueue, 5000);       // обновлять список каждые 5 сек
    setInterval(updateCountdowns, 1000); // таймер каждую секунду
  </script>
</body>
</html>
```

Страница полностью self-contained. Никаких внешних CDN, никаких зависимостей сборки. Сервируется как inline-строка из `http-server.js`.

## Новые методы store

Добавляем в `InMemoryHiringStore` (для тестов) и `PostgresHiringStore` (для прода):

```
getRecruiterByToken(token: string)
  → { recruiter_id, client_id, email, recruiter_token } | null

getQueueForRecruiter(recruiterToken: string)
  → QueueItem[]
  // Только review_status IN ('pending', 'approved')
  // Обогащён: candidate_display_name, job_title, active_step_goal, seconds_until_auto_send
  // Сортировка: auto_send_after ASC (ближайшие к отправке — первые)

blockMessage(plannedMessageId: string)
  → void
  // SET review_status = 'blocked'
  // Если planned_message_id не существует — no-op (проверка в хендлере)
  // Если уже 'sent' — бросить Error('already_sent')

approveAndSendNow(plannedMessageId: string)
  → void
  // SET review_status = 'approved', auto_send_after = new Date(Date.now() - 1000)
  // Если planned_message_id не существует — no-op
  // Если уже 'sent' — бросить Error('already_sent')
```

**Реализация `getQueueForRecruiter` в InMemoryHiringStore:**
```js
async getQueueForRecruiter(recruiterToken) {
  const recruiter = await this.getRecruiterByToken(recruiterToken);
  if (!recruiter) return null; // null = token not found

  const now = Date.now();
  return this.plannedMessages
    .filter(pm => ['pending', 'approved'].includes(pm.review_status))
    .map(pm => {
      const conv = this.conversations.get(pm.conversation_id);
      const candidate = this.candidates.get(pm.candidate_id);
      const job = this.jobs.get(conv?.job_id);
      const run = [...this.pipelineRuns.values()].find(r => r.pipeline_run_id === pm.pipeline_run_id);
      const stepStates = run ? this.getStepStates(run.pipeline_run_id) : [];
      const activeStep = stepStates.find(s => s.step_id === (run?.active_step_id ?? pm.step_id));
      const templateStep = job && activeStep
        ? store.getTemplateStep(job.job_id, activeStep.step_id)
        : null;
      return {
        planned_message_id: pm.planned_message_id,
        conversation_id: pm.conversation_id,
        candidate_display_name: candidate?.display_name ?? 'Неизвестно',
        job_title: job?.title ?? 'Неизвестно',
        active_step_goal: templateStep?.goal ?? pm.step_id ?? '',
        body: pm.body,
        reason: pm.reason,
        review_status: pm.review_status,
        auto_send_after: pm.auto_send_after,
        seconds_until_auto_send: Math.round((new Date(pm.auto_send_after) - now) / 1000)
      };
    })
    .sort((a, b) => new Date(a.auto_send_after) - new Date(b.auto_send_after));
}
```

## Тесты (писать первыми — TDD)

Файл: `tests/integration/moderation-ui.test.js`

Использует: `InMemoryHiringStore` + прямые HTTP-вызовы к `createHttpServer(app)` (как в `candidate-chatbot.test.js`).

```
1.  moderation: GET /recruiter/:token/queue returns 404 for unknown token
2.  moderation: GET /recruiter/:token/queue returns only pending and approved messages
3.  moderation: GET /recruiter/:token/queue does not include blocked messages
4.  moderation: GET /recruiter/:token/queue does not include sent messages
5.  moderation: GET /recruiter/:token/queue response includes seconds_until_auto_send for each item
6.  moderation: GET /recruiter/:token/queue enriches items with candidate_display_name and job_title
7.  moderation: GET /recruiter/:token/queue sorts items by auto_send_after ascending
8.  moderation: POST /recruiter/:token/queue/:id/block sets review_status to blocked
9.  moderation: POST /recruiter/:token/queue/:id/block returns 404 for unknown token
10. moderation: POST /recruiter/:token/queue/:id/block returns 404 for unknown planned_message_id
11. moderation: POST /recruiter/:token/queue/:id/block returns 409 when message already sent
12. moderation: POST /recruiter/:token/queue/:id/send-now sets auto_send_after to past
13. moderation: POST /recruiter/:token/queue/:id/send-now sets review_status to approved
14. moderation: POST /recruiter/:token/queue/:id/send-now makes message immediately due in getPlannedMessagesDue
15. moderation: GET /recruiter/:token serves HTML page with Content-Type text/html
```

**Пример теста 1 (структура):**
```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryHiringStore } from '../../services/candidate-chatbot/src/store.js';
import { createCandidateChatbot } from '../../services/candidate-chatbot/src/handlers.js';
import { createHttpServer } from '../../services/candidate-chatbot/src/http-server.js';
import { FakeLlmAdapter } from '../../services/candidate-chatbot/src/fake-llm-adapter.js';
import { readFileSync } from 'node:fs';

const seed = JSON.parse(readFileSync(new URL('../fixtures/iteration-1-seed.json', import.meta.url), 'utf8'));

async function req(server, method, path, body) {
  const port = server.address().port;
  const opts = { method, headers: { 'content-type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`http://localhost:${port}${path}`, opts);
  const json = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  return { status: r.status, body: json };
}

test('moderation: GET /recruiter/:token/queue returns 404 for unknown token', async () => {
  const store = new InMemoryHiringStore(seed);
  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, 'GET', '/recruiter/wrong-token/queue');
    assert.equal(status, 404);
    assert.equal(body.error, 'recruiter_not_found');
  } finally {
    server.close();
  }
});
```

**Пример теста 2 (только pending/approved):**
```js
test('moderation: GET /recruiter/:token/queue returns only pending and approved messages', async () => {
  const store = new InMemoryHiringStore(seed);
  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });

  // Создаём несколько planned_messages с разными статусами через webhook
  // Затем вручную меняем статусы в store
  // pending — должен попасть в список
  // blocked — не должен
  // sent — не должен

  // Seed 3 messages manually:
  store.plannedMessages.push({
    planned_message_id: 'pm-test-pending',
    conversation_id: 'conv-zakup-001',
    candidate_id: 'cand-zakup-good',
    pipeline_run_id: 'run-zakup-001',
    step_id: 'purchase_volume',
    body: 'Уточните объём закупок',
    reason: 'test',
    review_status: 'pending',
    auto_send_after: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    send_after: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  });
  store.plannedMessages.push({
    planned_message_id: 'pm-test-blocked',
    // ...same fields, review_status: 'blocked'
    review_status: 'blocked',
    auto_send_after: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  });

  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, 'GET', '/recruiter/rec-tok-demo-001/queue');
    assert.equal(status, 200);
    const ids = body.items.map(i => i.planned_message_id);
    assert.ok(ids.includes('pm-test-pending'));
    assert.ok(!ids.includes('pm-test-blocked'));
  } finally {
    server.close();
  }
});
```

**Пример теста 12 (send-now):**
```js
test('moderation: POST /recruiter/:token/queue/:id/send-now makes message immediately due in getPlannedMessagesDue', async () => {
  const store = new InMemoryHiringStore(seed);
  // Добавляем pending message с auto_send_after далеко в будущем
  store.plannedMessages.push({
    planned_message_id: 'pm-future',
    conversation_id: 'conv-zakup-001',
    candidate_id: 'cand-zakup-good',
    pipeline_run_id: 'run-zakup-001',
    step_id: 'purchase_volume',
    body: 'Уточните',
    reason: 'test',
    review_status: 'pending',
    auto_send_after: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 мин в будущем
    send_after: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status } = await req(server, 'POST', '/recruiter/rec-tok-demo-001/queue/pm-future/send-now');
    assert.equal(status, 200);

    // Теперь сообщение должно быть немедленно due
    const due = await store.getPlannedMessagesDue(new Date());
    const found = due.find(m => m.planned_message_id === 'pm-future');
    assert.ok(found, 'message should be immediately due after send-now');
  } finally {
    server.close();
  }
});
```

## Реализация маршрутов в http-server.js

Добавить в `createHttpServer` после существующих маршрутов:

```js
// Recruiter moderation queue (JSON)
const queueMatch = request.url.match(/^\/recruiter\/([^/]+)\/queue$/);
if (queueMatch && request.method === 'GET') {
  const token = queueMatch[1];
  const result = await app.getModerationQueue(token);
  writeJson(response, result.status, result.body);
  return;
}

// Block a message
const blockMatch = request.url.match(/^\/recruiter\/([^/]+)\/queue\/([^/]+)\/block$/);
if (blockMatch && request.method === 'POST') {
  const [, token, id] = blockMatch;
  const result = await app.blockMessage(token, id);
  writeJson(response, result.status, result.body);
  return;
}

// Send now
const sendNowMatch = request.url.match(/^\/recruiter\/([^/]+)\/queue\/([^/]+)\/send-now$/);
if (sendNowMatch && request.method === 'POST') {
  const [, token, id] = sendNowMatch;
  const result = await app.sendMessageNow(token, id);
  writeJson(response, result.status, result.body);
  return;
}

// HTML page
const htmlMatch = request.url.match(/^\/recruiter\/([^/]+)$/);
if (htmlMatch && request.method === 'GET') {
  const token = htmlMatch[1];
  const recruiter = await store.getRecruiterByToken(token);
  if (!recruiter) {
    writeJson(response, 404, { error: 'recruiter_not_found' });
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(MODERATION_HTML); // константа с HTML выше
  return;
}
```

Метод `store` нужно пробросить в `createHttpServer`. Альтернатива — добавить `getModerationQueue/blockMessage/sendMessageNow` в `app` (в `createCandidateChatbot`), тогда `http-server` не знает о `store` напрямую. **Рекомендуемый подход**: расширить `app` тремя новыми методами, не менять сигнатуру `createHttpServer`. Это сохраняет чистоту границ.

Новые методы в `createCandidateChatbot` (`handlers.js`):

```js
async getModerationQueue(recruiterToken) {
  const items = await store.getQueueForRecruiter(recruiterToken);
  if (items === null) {
    return { status: 404, body: { error: 'recruiter_not_found' } };
  }
  const recruiter = await store.getRecruiterByToken(recruiterToken);
  return { status: 200, body: { recruiter_id: recruiter.recruiter_id, items } };
},

async blockMessage(recruiterToken, plannedMessageId) {
  const recruiter = await store.getRecruiterByToken(recruiterToken);
  if (!recruiter) return { status: 404, body: { error: 'recruiter_not_found' } };
  const pm = store.plannedMessages.find(m => m.planned_message_id === plannedMessageId);
  if (!pm) return { status: 404, body: { error: 'planned_message_not_found' } };
  if (pm.review_status === 'sent') return { status: 409, body: { error: 'already_sent' } };
  await store.blockMessage(plannedMessageId);
  return { status: 200, body: { planned_message_id: plannedMessageId, review_status: 'blocked' } };
},

async sendMessageNow(recruiterToken, plannedMessageId) {
  const recruiter = await store.getRecruiterByToken(recruiterToken);
  if (!recruiter) return { status: 404, body: { error: 'recruiter_not_found' } };
  const pm = store.plannedMessages.find(m => m.planned_message_id === plannedMessageId);
  if (!pm) return { status: 404, body: { error: 'planned_message_not_found' } };
  if (pm.review_status === 'sent') return { status: 409, body: { error: 'already_sent' } };
  await store.approveAndSendNow(plannedMessageId);
  const updated = store.plannedMessages.find(m => m.planned_message_id === plannedMessageId);
  return {
    status: 200,
    body: {
      planned_message_id: plannedMessageId,
      review_status: updated.review_status,
      auto_send_after: updated.auto_send_after,
      queued_for_immediate_send: true
    }
  };
}
```

**Замечание**: прямой доступ `store.plannedMessages.find(...)` из хендлера — нарушение инкапсуляции. Альтернатива: добавить метод `findPlannedMessage(id)` в store. В итерации 4 допустимо; если это раздражает — вынести в store.

## PostgresHiringStore — новые методы

```sql
-- getRecruiterByToken
SELECT recruiter_id, client_id, email, recruiter_token
FROM chatbot.recruiters
WHERE recruiter_token = $1;

-- getQueueForRecruiter
SELECT
  pm.planned_message_id,
  pm.conversation_id,
  c.candidate_id,
  cand.display_name AS candidate_display_name,
  j.title AS job_title,
  pm.step_id AS active_step_goal,  -- полный goal берётся из job JSON: j.pipeline_template → steps
  pm.body,
  pm.reason,
  pm.review_status,
  pm.auto_send_after,
  EXTRACT(EPOCH FROM (pm.auto_send_after - now()))::int AS seconds_until_auto_send
FROM chatbot.planned_messages pm
JOIN chatbot.conversations c ON c.conversation_id = pm.conversation_id
JOIN chatbot.candidates cand ON cand.candidate_id = pm.candidate_id
JOIN chatbot.jobs j ON j.job_id = c.job_id
WHERE pm.review_status IN ('pending', 'approved')
ORDER BY pm.auto_send_after ASC;

-- blockMessage
UPDATE chatbot.planned_messages
SET review_status = 'blocked'
WHERE planned_message_id = $1;

-- approveAndSendNow
UPDATE chatbot.planned_messages
SET review_status = 'approved',
    auto_send_after = now() - interval '1 second'
WHERE planned_message_id = $1;
```

Обогащение `active_step_goal` в PostgresHiringStore: job pipeline template хранится как JSONB (или TEXT). Нужно извлечь goal шага по `step_id`. Если job хранится как JSON-столбец: `j.pipeline_template_json → 'steps' → ... → 'goal'`. Если job хранится построчно: нужен отдельный JOIN. Реализацию уточнить по реальной схеме при написании Postgres-методов.

## Acceptance criteria

Итерация считается готовой, когда:

- `pnpm test` (все предыдущие тесты) — зелёные. Никаких регрессий.
- `pnpm test:moderation` (15 тестов модерации) — все зелёные.
- `GET /recruiter/rec-tok-demo-001/queue` возвращает список, где blocked и sent отсутствуют.
- `POST /recruiter/rec-tok-demo-001/queue/:id/block` меняет `review_status` на `blocked`; сообщение пропадает из списка.
- `POST /recruiter/rec-tok-demo-001/queue/:id/send-now` ставит `auto_send_after` в прошлое; `getPlannedMessagesDue(new Date())` немедленно возвращает сообщение.
- `GET /recruiter/rec-tok-demo-001` отдаёт HTML с Content-Type `text/html`.
- `GET /recruiter/wrong-token/queue` → 404.
- `pnpm test:postgres` (если `V2_DEV_NEON_URL` выставлен) — зелёные (включая новые методы `PostgresHiringStore`).
- Открыть `http://localhost:3000/recruiter/rec-tok-demo-001` в браузере — видна таблица с таймерами; кнопки Заблокировать и Отправить сейчас работают.

## Порядок работы (XP)

1. Обновить `tests/fixtures/iteration-1-seed.json` — добавить `recruiter_token: "rec-tok-demo-001"` в объект `recruiter`.
2. Написать failing тест №1 (`404 unknown token`).
3. Добавить `getRecruiterByToken` в `InMemoryHiringStore` → тест зелёный.
4. Написать failing тесты №2-7 (queue endpoint: pending only, no blocked, no sent, seconds_until, enrichment, sort).
5. Добавить `getQueueForRecruiter` в `InMemoryHiringStore` + `getModerationQueue` в handlers + маршрут в http-server → тесты зелёные.
6. Написать failing тесты №8-11 (block: sets blocked, 404 token, 404 id, 409 already sent).
7. Добавить `blockMessage` в store + `blockMessage` handler + маршрут → тесты зелёные.
8. Написать failing тесты №12-14 (send-now: past date, status approved, immediately due).
9. Добавить `approveAndSendNow` в store + `sendMessageNow` handler + маршрут → тесты зелёные.
10. Написать failing тест №15 (HTML route).
11. Добавить константу `MODERATION_HTML` и HTML-маршрут в http-server → тест зелёный.
12. Добавить DB migration `003_iteration_4_moderation_ui.sql`, применить к dev Neon.
13. Добавить `getRecruiterByToken`, `getQueueForRecruiter`, `blockMessage`, `approveAndSendNow` в `PostgresHiringStore`.
14. Добавить скрипт в корневой `package.json`:
    ```json
    "test:moderation": "node --test tests/integration/moderation-ui.test.js"
    ```
15. Полный прогон:
    ```bash
    pnpm test && pnpm test:hh && pnpm test:cron && pnpm test:moderation && pnpm test:unit
    ```
16. Ручная проверка в браузере: `http://localhost:3000/recruiter/rec-tok-demo-001`.

## Зависимости

Новых npm-пакетов нет. Всё уже есть в workspace:
- `node:http` — для маршрутизации
- `node:crypto` — не нужен в этой итерации
- Браузерный fetch + setInterval — нативные

Структура изменений:
```
services/candidate-chatbot/
  src/
    handlers.js          # + getModerationQueue, blockMessage, sendMessageNow
    http-server.js       # + 4 новых маршрута + MODERATION_HTML константа
    store.js             # + getRecruiterByToken, getQueueForRecruiter,
                         #   blockMessage, approveAndSendNow
    postgres-store.js    # + те же 4 метода для Postgres
  migrations/
    003_iteration_4_moderation_ui.sql   # новый
tests/
  integration/
    moderation-ui.test.js               # новый
  fixtures/
    iteration-1-seed.json               # обновить: +recruiter_token
```
