# Iteration 5 — Multi-Tenant Isolation

Дата: 2026-04-12

Итерация 4 дала рекрутеру UI для модерации очереди. Проблема: `getQueueForRecruiter` возвращает ВСЕ pending-сообщения из всей базы — рекрутер компании Alpha видит сообщения компании Beta. Итерация 5 устраняет эту уязвимость: каждый рекрутер видит только данные своего клиента (`client_id`).

## Что делаем

1. **Management schema** — новая схема `management` с таблицей `clients`.

2. **`client_id` колонка** в трёх таблицах chatbot-схемы: `jobs`, `conversations`, `pipeline_runs`. Nullable для обратной совместимости (50 существующих тестов продолжают работать без изменений).

3. **Три изменения в `InMemoryHiringStore`**:
   - Конструктор принимает `seed.recruiters[]` (массив) в дополнение к `seed.recruiter` (один объект).
   - `getRecruiterByToken(token)` — ищет по всем рекрутерам в `this.recruiters`.
   - `getQueueForRecruiter(token)` — фильтрует сообщения по `job.client_id === recruiter.client_id`.

4. **Новый seed-файл** `tests/fixtures/iteration-5-seed.json` — 2 клиента × 2 рекрутера × 2 вакансии, кандидаты для каждой вакансии.

5. **DB migration** `006_iteration_5_multi_tenant.sql` — management schema + clients + `client_id` колонки.

6. **Обновление `PostgresHiringStore`**:
   - `seed()` принимает `seedData.recruiters[]` (и `seedData.clients[]`).
   - `getQueueForRecruiter` скоупится по `client_id` через JOIN.
   - `_loadJobsFromDb()` включает `client_id`.

## Чего не делаем

- JWT/OAuth — token в URL достаточно для итерации 5.
- Отдельный Neon-проект на клиента (итерация 7+).
- Строгая валидация `block`/`send-now` по `client_id` на уровне HTTP — изоляция через `getQueueForRecruiter` (рекрутер не видит чужие ID).
- Удаление старых колонок `recruiter.client_id` из chatbot-схемы (они уже корректны).
- UI-изменения (модерационная страница остаётся без изменений).

## Ключевой инвариант

```
getQueueForRecruiter(token)
  → recruiter.client_id = X
  → включить planned_message только если job.client_id == X
  → если job.client_id IS NULL → включить (backward compat)
  → если job.client_id != X → исключить
```

Backward compat: в старых seed-данных (50 тестов) `job.client_id` отсутствует. Такие джобы включаются в queue для любого рекрутера — это ожидаемое поведение для тестов, которые не тестируют изоляцию.

## Seed-данные — новый файл

Создать `tests/fixtures/iteration-5-seed.json`:

```json
{
  "clients": [
    { "client_id": "client-alpha-001", "name": "Alpha Corp" },
    { "client_id": "client-beta-001",  "name": "Beta Ltd"  }
  ],
  "recruiters": [
    {
      "recruiter_id":    "rec-alpha-001",
      "client_id":       "client-alpha-001",
      "email":           "alice@alpha.test",
      "recruiter_token": "rec-tok-alpha-001"
    },
    {
      "recruiter_id":    "rec-alpha-002",
      "client_id":       "client-alpha-001",
      "email":           "alex@alpha.test",
      "recruiter_token": "rec-tok-alpha-002"
    },
    {
      "recruiter_id":    "rec-beta-001",
      "client_id":       "client-beta-001",
      "email":           "bob@beta.test",
      "recruiter_token": "rec-tok-beta-001"
    },
    {
      "recruiter_id":    "rec-beta-002",
      "client_id":       "client-beta-001",
      "email":           "bella@beta.test",
      "recruiter_token": "rec-tok-beta-002"
    }
  ],
  "jobs": [
    {
      "job_id":    "job-alpha-dev",
      "client_id": "client-alpha-001",
      "title":     "Alpha Backend Developer",
      "description": "Alpha Corp, TypeScript, remote.",
      "pipeline_template": {
        "template_id":      "tpl-alpha-dev-v1",
        "template_version": 1,
        "name":             "alpha-dev-screening-v1",
        "steps": [
          {
            "id": "ts_experience", "step_index": 1, "kind": "question",
            "goal": "Проверить опыт TypeScript",
            "done_when": "кандидат называет проекты на TypeScript",
            "reject_when": "нет опыта TypeScript",
            "prompt_key": "step.ts_experience"
          },
          {
            "id": "remote_fit", "step_index": 2, "kind": "question",
            "goal": "Проверить готовность к удалёнке",
            "done_when": "кандидат подтверждает удалёнку",
            "reject_when": "кандидат не готов к удалёнке",
            "prompt_key": "step.remote_fit"
          }
        ]
      }
    },
    {
      "job_id":    "job-alpha-pm",
      "client_id": "client-alpha-001",
      "title":     "Alpha Product Manager",
      "description": "Alpha Corp, product, hybrid.",
      "pipeline_template": {
        "template_id":      "tpl-alpha-pm-v1",
        "template_version": 1,
        "name":             "alpha-pm-screening-v1",
        "steps": [
          {
            "id": "pm_experience", "step_index": 1, "kind": "question",
            "goal": "Проверить опыт PM",
            "done_when": "кандидат называет продукты которыми управлял",
            "reject_when": "нет опыта PM",
            "prompt_key": "step.pm_experience"
          }
        ]
      }
    },
    {
      "job_id":    "job-beta-sales",
      "client_id": "client-beta-001",
      "title":     "Beta Sales Manager",
      "description": "Beta Ltd, B2B sales, Moscow.",
      "pipeline_template": {
        "template_id":      "tpl-beta-sales-v1",
        "template_version": 1,
        "name":             "beta-sales-screening-v1",
        "steps": [
          {
            "id": "b2b_experience", "step_index": 1, "kind": "question",
            "goal": "Проверить опыт B2B продаж",
            "done_when": "кандидат описывает B2B опыт",
            "reject_when": "только B2C",
            "prompt_key": "step.b2b_experience"
          }
        ]
      }
    },
    {
      "job_id":    "job-beta-ops",
      "client_id": "client-beta-001",
      "title":     "Beta Operations Lead",
      "description": "Beta Ltd, operations, Moscow.",
      "pipeline_template": {
        "template_id":      "tpl-beta-ops-v1",
        "template_version": 1,
        "name":             "beta-ops-screening-v1",
        "steps": [
          {
            "id": "ops_experience", "step_index": 1, "kind": "question",
            "goal": "Проверить опыт operations",
            "done_when": "кандидат описывает управление операциями",
            "reject_when": "нет релевантного опыта",
            "prompt_key": "step.ops_experience"
          }
        ]
      }
    }
  ],
  "candidate_fixtures": [
    {
      "candidate_id":   "cand-alpha-dev-001",
      "job_id":         "job-alpha-dev",
      "conversation_id":"conv-alpha-dev-001",
      "pipeline_run_id":"run-alpha-dev-001",
      "display_name":   "Alice Dev",
      "resume_text":    "TypeScript developer, 5 years.",
      "inbound_text":   "Привет, я TS-разработчик, 5 лет опыта, работаю удалённо."
    },
    {
      "candidate_id":   "cand-beta-sales-001",
      "job_id":         "job-beta-sales",
      "conversation_id":"conv-beta-sales-001",
      "pipeline_run_id":"run-beta-sales-001",
      "display_name":   "Bob Sales",
      "resume_text":    "B2B sales manager, 4 years.",
      "inbound_text":   "Здравствуйте, 4 года в B2B продажах, промышленное оборудование."
    }
  ]
}
```

## DB Migration

Файл: `services/candidate-chatbot/migrations/006_iteration_5_multi_tenant.sql`

```sql
-- migration: 006_iteration_5_multi_tenant.sql

-- 1. Management schema + clients table
CREATE SCHEMA IF NOT EXISTS management;

CREATE TABLE IF NOT EXISTS management.clients (
  client_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add client_id to chatbot tables (nullable — backward compat)
ALTER TABLE chatbot.jobs
  ADD COLUMN IF NOT EXISTS client_id TEXT;

ALTER TABLE chatbot.conversations
  ADD COLUMN IF NOT EXISTS client_id TEXT;

ALTER TABLE chatbot.pipeline_runs
  ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Optional index for scoped queries
CREATE INDEX IF NOT EXISTS idx_jobs_client_id           ON chatbot.jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_conversations_client_id  ON chatbot.conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_client_id  ON chatbot.pipeline_runs(client_id);

-- 3. Seed demo clients
INSERT INTO management.clients (client_id, name)
VALUES
  ('client-alpha-001', 'Alpha Corp'),
  ('client-beta-001',  'Beta Ltd')
ON CONFLICT (client_id) DO NOTHING;

-- 4. Seed demo recruiters for both clients (idempotent)
INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token)
VALUES
  ('rec-alpha-001', 'client-alpha-001', 'alice@alpha.test', 'rec-tok-alpha-001'),
  ('rec-alpha-002', 'client-alpha-001', 'alex@alpha.test',  'rec-tok-alpha-002'),
  ('rec-beta-001',  'client-beta-001',  'bob@beta.test',    'rec-tok-beta-001'),
  ('rec-beta-002',  'client-beta-001',  'bella@beta.test',  'rec-tok-beta-002')
ON CONFLICT (recruiter_id) DO UPDATE SET
  client_id       = EXCLUDED.client_id,
  recruiter_token = EXCLUDED.recruiter_token;
```

Применяется через:
```bash
psql $V2_DEV_NEON_URL -f services/candidate-chatbot/migrations/006_iteration_5_multi_tenant.sql
```

## Изменения InMemoryHiringStore

### Конструктор — поддержка массивов

```js
constructor(seed) {
  // Support both single recruiter (old format) and array (new format)
  this.recruiters = seed.recruiters
    ? structuredClone(seed.recruiters)
    : (seed.recruiter ? [structuredClone(seed.recruiter)] : []);
  // backward compat alias
  this.recruiter = this.recruiters[0] ?? null;

  this.clients = seed.clients
    ? structuredClone(seed.clients)
    : (seed.client ? [structuredClone(seed.client)] : []);
  this.client = this.clients[0] ?? null;

  // ... остальное без изменений
}
```

### getRecruiterByToken — поиск по всем рекрутерам

```js
async getRecruiterByToken(token) {
  return this.recruiters.find(r => r.recruiter_token === token) ?? null;
}
```

### getQueueForRecruiter — фильтрация по client_id

```js
async getQueueForRecruiter(recruiterToken) {
  const recruiter = await this.getRecruiterByToken(recruiterToken);
  if (!recruiter) return null;

  const clientId = recruiter.client_id ?? null;
  const now = Date.now();

  return this.plannedMessages
    .filter(pm => ['pending', 'approved'].includes(pm.review_status))
    .filter(pm => {
      // Scope by client_id. Backward compat: if job has no client_id → include.
      const conv = this.conversations.get(pm.conversation_id);
      if (!conv) return false;
      const job = this.jobs.get(conv.job_id);
      if (!job) return false;
      // If both sides have client_id and they differ → exclude
      if (clientId && job.client_id && job.client_id !== clientId) return false;
      return true;
    })
    .map(pm => {
      const conv = this.conversations.get(pm.conversation_id);
      const candidate = this.candidates.get(pm.candidate_id);
      const job = conv ? this.jobs.get(conv.job_id) : null;
      const run = [...this.pipelineRuns.values()].find(r => r.pipeline_run_id === pm.pipeline_run_id);
      const stepStates = run ? this.getStepStates(run.pipeline_run_id) : [];
      const activeStep = stepStates.find(s => s.step_id === (run?.active_step_id ?? pm.step_id));
      let templateStep = null;
      if (job && activeStep) {
        try { templateStep = this.getTemplateStep(job.job_id, activeStep.step_id); } catch { }
      }
      return {
        planned_message_id:       pm.planned_message_id,
        conversation_id:          pm.conversation_id,
        candidate_display_name:   candidate?.display_name ?? 'Неизвестно',
        job_title:                job?.title ?? 'Неизвестно',
        active_step_goal:         templateStep?.goal ?? pm.step_id ?? '',
        body:                     pm.body,
        reason:                   pm.reason,
        review_status:            pm.review_status,
        auto_send_after:          pm.auto_send_after,
        seconds_until_auto_send:  Math.round((new Date(pm.auto_send_after) - now) / 1000)
      };
    })
    .sort((a, b) => new Date(a.auto_send_after) - new Date(b.auto_send_after));
}
```

### seedCandidateFixture — сохранение client_id на conversation

```js
seedCandidateFixture(fixture) {
  const job = this.getJob(fixture.job_id);
  // ...
  const conversation = {
    conversation_id:  fixture.conversation_id,
    job_id:           fixture.job_id,
    candidate_id:     fixture.candidate_id,
    channel:          'test',
    channel_thread_id:fixture.conversation_id,
    status:           'open',
    client_id:        job.client_id ?? null   // ← propagate from job
  };
  // ...
}
```

## Изменения PostgresHiringStore

### seed() — поддержка recruiters[] и clients[]

```js
async seed(seedData) {
  // Upsert clients
  for (const client of seedData.clients ?? (seedData.client ? [seedData.client] : [])) {
    await this.sql`
      INSERT INTO management.clients (client_id, name)
      VALUES (${client.client_id}, ${client.name})
      ON CONFLICT (client_id) DO NOTHING
    `;
  }

  // Upsert jobs (with client_id)
  for (const job of seedData.jobs) {
    await this.sql`
      INSERT INTO chatbot.jobs (job_id, title, description, client_id)
      VALUES (${job.job_id}, ${job.title}, ${job.description}, ${job.client_id ?? null})
      ON CONFLICT (job_id) DO NOTHING
    `;
    // ... pipeline_template as before
  }

  // Upsert candidate_fixtures (with client_id propagation)
  for (const fixture of seedData.candidate_fixtures) {
    // ...
    await this.sql`
      INSERT INTO chatbot.conversations (conversation_id, job_id, candidate_id, channel, channel_thread_id, status, client_id)
      VALUES (${fixture.conversation_id}, ${fixture.job_id}, ${fixture.candidate_id}, 'test', ${fixture.conversation_id}, 'open',
        (SELECT client_id FROM chatbot.jobs WHERE job_id = ${fixture.job_id}))
      ON CONFLICT (conversation_id) DO NOTHING
    `;
    // ...
  }

  // Upsert all recruiters
  for (const rec of seedData.recruiters ?? (seedData.recruiter ? [seedData.recruiter] : [])) {
    if (!rec.recruiter_token) continue;
    await this.sql`
      INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token)
      VALUES (${rec.recruiter_id}, ${rec.client_id}, ${rec.email}, ${rec.recruiter_token})
      ON CONFLICT (recruiter_id) DO UPDATE SET recruiter_token = EXCLUDED.recruiter_token
    `;
  }
}
```

### _loadJobsFromDb() — включить client_id

```js
async _loadJobsFromDb() {
  const jobs = await this.sql`SELECT job_id, title, description, client_id FROM chatbot.jobs`;
  // ...
  this._jobs.set(job.job_id, {
    job_id:      job.job_id,
    title:       job.title,
    description: job.description,
    client_id:   job.client_id ?? null,    // ← добавить
    pipeline_template: { ... }
  });
}
```

### getQueueForRecruiter — SQL с client_id фильтром

```sql
-- getQueueForRecruiter (PostgresHiringStore)
SELECT
  pm.planned_message_id,
  pm.conversation_id,
  cand.display_name   AS candidate_display_name,
  j.title             AS job_title,
  pm.step_id          AS active_step_goal,
  pm.body,
  pm.reason,
  pm.review_status,
  pm.auto_send_after,
  EXTRACT(EPOCH FROM (pm.auto_send_after - now()))::int AS seconds_until_auto_send
FROM chatbot.planned_messages pm
JOIN chatbot.conversations  c    ON c.conversation_id = pm.conversation_id
JOIN chatbot.candidates     cand ON cand.candidate_id = pm.candidate_id
JOIN chatbot.jobs           j    ON j.job_id = c.job_id
JOIN chatbot.recruiters     r    ON r.recruiter_token = $1
WHERE pm.review_status IN ('pending', 'approved')
  AND (j.client_id IS NULL OR j.client_id = r.client_id)
ORDER BY pm.auto_send_after ASC;
```

Если `r.client_id` = NULL (нет строки в recruiters) → WHERE r.recruiter_token вернёт 0 строк → getQueueForRecruiter вернёт null (через предварительный `getRecruiterByToken`).

## API-контракты — без изменений

Все HTTP-маршруты из итерации 4 (`GET /recruiter/:token/queue`, `POST .../block`, `POST .../send-now`) остаются неизменными. Изоляция прозрачна для клиента: рекрутер просто перестаёт видеть чужие сообщения.

## Тесты (TDD, писать первыми)

Файл: `tests/integration/multi-tenant.test.js`

```
1.  isolation: getRecruiterByToken finds recruiter from multi-recruiter seed
2.  isolation: getRecruiterByToken returns null for unknown token in multi-recruiter seed
3.  isolation: getQueueForRecruiter returns only messages for recruiter's own client
4.  isolation: recruiter A cannot see pending messages from recruiter B's jobs
5.  isolation: recruiter B cannot see pending messages from recruiter A's jobs
6.  isolation: two recruiters from same client both see shared client's pending messages
7.  isolation: GET /recruiter/:token/queue scopes to client when two clients have pending messages
8.  isolation: jobs without client_id are included in queue for any recruiter (backward compat)
9.  isolation: blockMessage by recruiter A does not make message visible to recruiter B
10. isolation: send-now by recruiter A does not make message visible to recruiter B
```

### Пример теста 4 (ключевой изоляционный тест)

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryHiringStore } from '../../services/candidate-chatbot/src/store.js';
import { readFileSync } from 'node:fs';

const seed5 = JSON.parse(readFileSync(
  new URL('../fixtures/iteration-5-seed.json', import.meta.url), 'utf8'
));

test('isolation: recruiter A cannot see pending messages from recruiter B jobs', async () => {
  const store = new InMemoryHiringStore(seed5);

  // Manually plant pending messages for both clients
  store.plannedMessages.push({
    planned_message_id: 'pm-alpha-001',
    conversation_id:    'conv-alpha-dev-001',
    candidate_id:       'cand-alpha-dev-001',
    pipeline_run_id:    'run-alpha-dev-001',
    step_id:            'ts_experience',
    body:               'Привет от Alpha',
    reason:             'test',
    review_status:      'pending',
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });
  store.plannedMessages.push({
    planned_message_id: 'pm-beta-001',
    conversation_id:    'conv-beta-sales-001',
    candidate_id:       'cand-beta-sales-001',
    pipeline_run_id:    'run-beta-sales-001',
    step_id:            'b2b_experience',
    body:               'Привет от Beta',
    reason:             'test',
    review_status:      'pending',
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  // Recruiter from Alpha should only see Alpha's message
  const alphaQueue = await store.getQueueForRecruiter('rec-tok-alpha-001');
  assert.ok(alphaQueue !== null);
  const alphaIds = alphaQueue.map(i => i.planned_message_id);
  assert.ok(alphaIds.includes('pm-alpha-001'), 'alpha message should be visible to alpha recruiter');
  assert.ok(!alphaIds.includes('pm-beta-001'), 'beta message must NOT be visible to alpha recruiter');
});
```

### Пример теста 6 (два рекрутера одного клиента)

```js
test('isolation: two recruiters from same client both see shared client messages', async () => {
  const store = new InMemoryHiringStore(seed5);

  store.plannedMessages.push({
    planned_message_id: 'pm-alpha-shared',
    conversation_id:    'conv-alpha-dev-001',
    candidate_id:       'cand-alpha-dev-001',
    pipeline_run_id:    'run-alpha-dev-001',
    step_id:            'ts_experience',
    body:               'Alpha shared message',
    reason:             'test',
    review_status:      'pending',
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const queue1 = await store.getQueueForRecruiter('rec-tok-alpha-001');
  const queue2 = await store.getQueueForRecruiter('rec-tok-alpha-002');

  assert.ok(queue1.some(i => i.planned_message_id === 'pm-alpha-shared'));
  assert.ok(queue2.some(i => i.planned_message_id === 'pm-alpha-shared'));
});
```

### Пример теста 8 (backward compat)

```js
import { readFileSync } from 'node:fs';

const seed1 = JSON.parse(readFileSync(
  new URL('../fixtures/iteration-1-seed.json', import.meta.url), 'utf8'
));

test('isolation: jobs without client_id are included in queue for any recruiter (backward compat)', async () => {
  // Old seed: jobs have no client_id, single recruiter
  const store = new InMemoryHiringStore(seed1);

  store.plannedMessages.push({
    planned_message_id: 'pm-no-client',
    conversation_id:    'conv-zakup-001',
    candidate_id:       'cand-zakup-good',
    pipeline_run_id:    'run-zakup-001',
    step_id:            'purchase_volume',
    body:               'No client_id job message',
    reason:             'test',
    review_status:      'pending',
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const queue = await store.getQueueForRecruiter('rec-tok-demo-001');
  assert.ok(queue !== null);
  assert.ok(queue.some(i => i.planned_message_id === 'pm-no-client'),
    'message for job without client_id must be included (backward compat)');
});
```

### Пример теста 7 (HTTP integration)

```js
import { createCandidateChatbot } from '../../services/candidate-chatbot/src/handlers.js';
import { createHttpServer } from '../../services/candidate-chatbot/src/http-server.js';
import { FakeLlmAdapter } from '../../services/candidate-chatbot/src/fake-llm-adapter.js';

async function req(server, method, path, body) {
  const port = server.address().port;
  const opts = { method, headers: { 'content-type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`http://localhost:${port}${path}`, opts);
  const json = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  return { status: r.status, body: json };
}

test('isolation: GET /recruiter/:token/queue scopes to client when two clients have pending messages', async () => {
  const store = new InMemoryHiringStore(seed5);

  // Plant one message per client
  store.plannedMessages.push({
    planned_message_id: 'pm-alpha-http',
    conversation_id:    'conv-alpha-dev-001',
    candidate_id:       'cand-alpha-dev-001',
    pipeline_run_id:    'run-alpha-dev-001',
    step_id:            'ts_experience',
    body:               'Alpha HTTP message',
    reason:             'test',
    review_status:      'pending',
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });
  store.plannedMessages.push({
    planned_message_id: 'pm-beta-http',
    conversation_id:    'conv-beta-sales-001',
    candidate_id:       'cand-beta-sales-001',
    pipeline_run_id:    'run-beta-sales-001',
    step_id:            'b2b_experience',
    body:               'Beta HTTP message',
    reason:             'test',
    review_status:      'pending',
    auto_send_after:    new Date(Date.now() + 5 * 60_000).toISOString()
  });

  const app = createCandidateChatbot({ store, llmAdapter: new FakeLlmAdapter() });
  const server = createHttpServer(app).listen(0);
  try {
    const { status, body } = await req(server, 'GET', '/recruiter/rec-tok-beta-001/queue');
    assert.equal(status, 200);
    const ids = body.items.map(i => i.planned_message_id);
    assert.ok(ids.includes('pm-beta-http'),  'beta message visible to beta recruiter');
    assert.ok(!ids.includes('pm-alpha-http'), 'alpha message NOT visible to beta recruiter');
  } finally {
    server.close();
  }
});
```

## Acceptance criteria

Итерация считается готовой, когда:

- `pnpm test` — все 50 предыдущих тестов зелёные. Никаких регрессий.
- `pnpm test:tenant` — все 10 тестов изоляции зелёные.
- `getQueueForRecruiter('rec-tok-alpha-001')` не возвращает сообщения для `job.client_id = 'client-beta-001'`.
- `getQueueForRecruiter('rec-tok-beta-001')` не возвращает сообщения для `job.client_id = 'client-alpha-001'`.
- Оба рекрутера одного клиента видят одни и те же pending-сообщения.
- Старые seed-данные (без `client_id` на job) не ломают ни одного теста.
- `pnpm test:postgres` (если `V2_DEV_NEON_URL` выставлен) — зелёные с новой миграцией.
- В браузере: `http://localhost:3000/recruiter/rec-tok-alpha-001` — видны только Alpha-кандидаты; `http://localhost:3000/recruiter/rec-tok-beta-001` — только Beta-кандидаты.

## Порядок работы (XP)

1. Создать `tests/fixtures/iteration-5-seed.json` (seed из этого документа).
2. Написать failing тест №1 (`getRecruiterByToken` в multi-recruiter seed).
3. Обновить конструктор `InMemoryHiringStore`: `this.recruiters = []` + нормализация `seed.recruiter` → `[seed.recruiter]`.
4. Обновить `getRecruiterByToken` для поиска по `this.recruiters` → тест №1 зелёный.
5. Написать failing тесты №3-5 (изоляция очереди).
6. Обновить `getQueueForRecruiter` с `client_id`-фильтром → тесты №3-5 зелёные.
7. Написать failing тест №6 (два рекрутера одного клиента видят одно).
8. Убедиться: `client_id` одинаковый у обоих → тест зелёный без дополнительной правки.
9. Написать failing тест №8 (backward compat без `client_id`).
10. Убедиться: условие `if (clientId && job.client_id && ...)` пропускает старые джобы → тест зелёный.
11. Написать failing тесты №7, 9, 10 (HTTP + block/send-now cross-client).
12. Тесты №7, 9, 10 зелёные (no additional code needed — scoping already correct).
13. Добавить failing тест №2 (`getRecruiterByToken` → null для неизвестного token).
14. Тест №2 зелёный.
15. Создать DB migration `006_iteration_5_multi_tenant.sql`.
16. Применить к dev Neon: `psql $V2_DEV_NEON_URL -f .../006_iteration_5_multi_tenant.sql`.
17. Обновить `PostgresHiringStore`:
    - `_loadJobsFromDb` добавляет `client_id`.
    - `seed()` принимает `clients[]` + `recruiters[]`.
    - `getQueueForRecruiter` SQL-запрос с `client_id` фильтром.
18. Добавить скрипт в корневой `package.json`:
    ```json
    "test:tenant": "node --test tests/integration/multi-tenant.test.js"
    ```
19. Полный прогон:
    ```bash
    pnpm test && pnpm test:tenant
    ```

## Зависимости

Новых npm-пакетов нет. Изменённые файлы:

```
services/candidate-chatbot/
  src/
    store.js             # конструктор + getRecruiterByToken + getQueueForRecruiter
    postgres-store.js    # seed() + _loadJobsFromDb() + getQueueForRecruiter SQL
  migrations/
    006_iteration_5_multi_tenant.sql    # новый
tests/
  integration/
    multi-tenant.test.js                # новый
  fixtures/
    iteration-5-seed.json               # новый
package.json                            # +test:tenant script
```
