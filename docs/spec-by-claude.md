# Hiring Agent — EP Approach Plan

*Версия: Claude Sonnet 4.6 | 2026-04-12*

---

## TL;DR — Моя оценка твоего плана

Твой план концептуально верный. Проблема не в архитектуре — проблема в том, что у тебя нет **красной нитки** от первого `{{text}}` до работающего продукта. EP-подход правильный, но нужно вычленить самый маленький возможный скелет и сделать его рабочим до того, как добавлять что-либо ещё.

**Ключевой инсайт**: вся система — это **state machine поверх таблицы в базе**, но не линейная. Кандидат находится на шаге `N`, но одним ответом может закрыть шаги N, N+1, N+2 сразу. А первое сообщение часто выгодно сделать «батчем» — задать несколько ключевых вопросов сразу, чтобы не гонять туда-сюда. State machine при этом не ломается: шаги просто помечаются `completed` без отдельного сообщения под каждый.

**Что изменю в плане:**
1. Убираю recruiter-facing web страницу из ранних итераций — сначала сделать рабочую переписку
2. Добавляю явный `pipeline_step_state` как первоклассную концепцию (не статус кандидата, а статус *прохождения конкретного шага*)
3. Рекомендую сохранить `sendHHWithGuard()` из candidate-routing — она доказала надёжность
4. HH-connector оставить отдельным сервисом (уже правильно изолирован)
5. Предлагаю другой подход к moderation queue — не "одобрить до отправки", а **"window to reject"** (уходит через N минут, рекрутер может заблокировать)

---

## Что берём из текущего кода

| Источник | Что берём | Почему |
|---|---|---|
| `candidate-routing` | `sendHHWithGuard()` логика | Проверена боем, предотвращает дубли |
| `candidate-routing` | Channel abstraction (`src/channel.ts`) | Убирает routing if-блоки |
| `candidate-routing` | DB migrations с idempotency check | Безопасный деплой |
| `recruiter-mcp` | Role-based tool registration | Изоляция рекрутеров |
| `recruiter-mcp` | Runtime context через `/whoami` | Правильная точка авторизации |
| `recruiting-agent` | Playbooks pattern | Легко добавлять сценарии |
| `recruiting-agent` | Markdown response rendering | Хорошо работает |
| `recruiter-data-layer` | Multi-tenant Neon (один проект = один клиент) | Идеальная изоляция данных |
| `recruiter-data-layer` | Management DB pattern | Централизованный реестр клиентов |

**Что НЕ берём:**
- D1 (Cloudflare) — уже мёртвая тема, везде Neon
- WebSocket для чата рекрутера — достаточно обычного HTTP polling или SSE
- Sync jobs из data-layer — слишком сложно, пока не нужно
- LinkedIn интеграция — в сторону

---

## Архитектура (рафинированная)

```
┌─────────────────────────────────────────────────────────────────┐
│                        CANDIDATE SIDE                           │
│                                                                 │
│  HH.ru  ──────►  hh-connector  ──────►  candidate chatbot      │
│  Email  ──────────────────────────────►  (new, simple)         │
└──────────────────────────────────────────────┬──────────────────┘
                                               │ read/write
                                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    HIRING DATA LAYER                            │
│                                                                 │
│  Neon per-client DB                                             │
│  • jobs + pipeline_steps                                        │
│  • candidate_messages_*                                         │
│  • pipeline_step_state (the core state machine)                 │
│  • moderation_queue                                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │ MCP tools
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      HIRING MCP                                 │
│                                                                 │
│  • text2sql для отчётов                                         │
│  • действия: send_message, get_candidates, update_step_state    │
│  • авторизация: recruiter видит только свои вакансии            │
│  • playbooks: сценарии для агента                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      HIRING AGENT                               │
│                                                                 │
│  • Chat UI для рекрутера (React/Next.js или простой HTML)       │
│  • Принимает ответ в Markdown                                   │
│  • История диалогов                                             │
│  • Авторизация пользователей                                    │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              Telegram Bot (уведомления рекрутера)
```

### Ключевые принципы нового кода

1. **Candidate chatbot — тупой и надёжный.** Он не принимает решений. Он читает `pipeline_step_state`, смотрит на текущий шаг, составляет промпт, отправляет в LLM, кладёт результат в `moderation_queue`. Всё.

2. **Один путь отправки.** Сообщение кандидату уходит **только** через `moderation_queue → cron → sendHHWithGuard`. Никаких прямых вызовов send из агента. Это решает проблему дублей.

3. **State machine явная.** Нет поля `status TEXT` со значениями типа `"waiting_for_answer"`. Есть таблица `pipeline_step_state` с колонкой `step_index INTEGER` и `awaiting_reply BOOLEAN`.

4. **Дешёвая модель для чатбота.** Gemini 2.5 Flash (или другой дешёвый вариант). Контекст передаётся чистым: системный промпт шага + последние N сообщений + резюме. Без лишнего.

---

## DB Schema (финальная версия)

### Management DB (общая для всех клиентов)

```sql
-- schema: public
CREATE TABLE clients (
  client_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  neon_conn    TEXT NOT NULL,  -- connection string к клиентской базе
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE recruiters (
  recruiter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID REFERENCES clients,
  email        TEXT UNIQUE NOT NULL,
  tg_chat_id   BIGINT,  -- для Telegram уведомлений
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

### Client DB (отдельная база у каждого клиента)

```sql
-- schema: chatbot
-- Вакансии и воронка

CREATE TABLE jobs (
  job_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id   UUID NOT NULL,  -- из management db
  title          TEXT NOT NULL,
  description    TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  archived_at    TIMESTAMPTZ
);

CREATE TABLE pipeline_steps (
  step_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID REFERENCES jobs,
  step_index     INTEGER NOT NULL,  -- порядок шага
  goal           TEXT NOT NULL,     -- "проверить наличие медкнижки"
  prompt_template TEXT NOT NULL,    -- инструкция для LLM на этом шаге
  requires_api_call TEXT,           -- null или 'generate_interview_link' и тп
  UNIQUE(job_id, step_index)
);

-- Кандидаты

CREATE TABLE candidates (
  candidate_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_email TEXT,        -- может отсутствовать (HH без email)
  display_name   TEXT,
  resume_text    TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Все внешние идентификаторы кандидата (email, hh_id, hh_negotiation_id, apply_id...)
-- Джоин по email приоритетен, но не единственный путь
CREATE TABLE candidate_identity_map (
  candidate_id   UUID REFERENCES candidates,
  identity_type  TEXT NOT NULL, -- 'email', 'hh_applicant_id', 'hh_negotiation_id', 'apply_application_id'
  identity_value TEXT NOT NULL,
  channel        TEXT NOT NULL,
  can_send       BOOLEAN NOT NULL DEFAULT true, -- false для синтетических email
  created_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (identity_type, identity_value)
);

-- Диалоги (один канал × один кандидат × одна вакансия)
CREATE TABLE conversations (
  conversation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID REFERENCES jobs,
  candidate_id      UUID REFERENCES candidates,
  channel           TEXT NOT NULL,  -- 'hh', 'email', 'apply'
  channel_thread_id TEXT,           -- hh negotiation id, email thread id
  status            TEXT NOT NULL DEFAULT 'open',
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (channel, channel_thread_id)
);

-- Pipeline runs (один прогон = один кандидат × одна вакансия × один template)
CREATE TABLE pipeline_runs (
  pipeline_run_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID REFERENCES jobs,
  candidate_id     UUID REFERENCES candidates,
  template_id      UUID,          -- ссылка на шаблон pipeline
  template_version INTEGER NOT NULL,
  active_step_id   TEXT,
  state_json       JSONB NOT NULL DEFAULT '{}', -- full state snapshot
  status           TEXT NOT NULL DEFAULT 'active',
  -- active | completed | rejected | paused | manual_review
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Pipeline step state — проекция/read model поверх pipeline_events
-- Source of truth для аудита — pipeline_events; эту таблицу можно пересобрать
CREATE TABLE pipeline_step_state (
  pipeline_run_id  UUID REFERENCES pipeline_runs,
  step_id          TEXT NOT NULL,
  step_index       INTEGER NOT NULL,
  state            TEXT NOT NULL DEFAULT 'pending',
  -- pending | active | completed | rejected | skipped | manual_review
  awaiting_reply   BOOLEAN NOT NULL DEFAULT false,
  extracted_facts  JSONB NOT NULL DEFAULT '{}', -- что узнали из ответов кандидата
  last_reason      TEXT,
  completed_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (pipeline_run_id, step_id)
);

-- Иммутабельный лог событий (audit, можно пересобрать проекцию)
CREATE TABLE pipeline_events (
  event_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id  UUID REFERENCES pipeline_runs,
  candidate_id     UUID REFERENCES candidates,
  event_type       TEXT NOT NULL,
  -- step_completed | step_rejected | step_skipped | run_completed | run_rejected | message_planned | tool_called
  step_id          TEXT,
  payload          JSONB NOT NULL DEFAULT '{}',
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (idempotency_key)
);

-- Все сообщения (inbound + outbound + system) в одной таблице
CREATE TABLE messages (
  message_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID REFERENCES conversations,
  candidate_id      UUID REFERENCES candidates,
  direction         TEXT NOT NULL CHECK (direction IN ('inbound','outbound','system')),
  message_type      TEXT NOT NULL DEFAULT 'text', -- 'text','resume','resume_text','homework','system'
  body              TEXT,
  channel           TEXT NOT NULL,
  channel_message_id TEXT,          -- внешний id (hh_message_id и тп)
  occurred_at       TIMESTAMPTZ NOT NULL,   -- время у отправителя
  received_at       TIMESTAMPTZ,            -- время нашего получения
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (channel, channel_message_id)
);

-- Очередь исходящих (planned messages / moderation queue)
CREATE TABLE planned_messages (
  planned_message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    UUID REFERENCES conversations,
  candidate_id       UUID REFERENCES candidates,
  pipeline_run_id    UUID,          -- ссылка на прогон pipeline
  step_id            TEXT,
  body               TEXT NOT NULL,
  reason             TEXT,          -- для рекрутера, не отправлять кандидату
  review_status      TEXT NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | auto_approved | blocked
  moderation_policy  TEXT NOT NULL DEFAULT 'window_to_reject',
  -- window_to_reject | explicit_approval | manual_only
  send_after         TIMESTAMPTZ NOT NULL,
  auto_send_after    TIMESTAMPTZ,
  idempotency_key    TEXT NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (idempotency_key)
);

-- Попытки доставки (audit отправок)
CREATE TABLE message_delivery_attempts (
  attempt_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_message_id UUID REFERENCES planned_messages,
  channel            TEXT NOT NULL,
  status             TEXT NOT NULL,
  -- sending | delivered | failed | skipped_duplicate | blocked_by_guard
  channel_message_id TEXT,   -- id присвоенный каналом после успешной отправки
  error              TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);
```

---

## XP Sprint Plan

Принцип: каждый спринт начинается с **падающего теста**, который описывает желаемое поведение. Код пишется чтобы тест прошёл — и не больше.

---

### Iteration 0 — Repo reset и guardrails для агентов (до начала кода)

**Цель**: новый агент открывает репо и видит только V2. Нет путаницы с V1.

**Делаем:**
- [ ] Новый репо `hiring-agent-v2` (монорепо с workspaces)
- [ ] `CLAUDE.md` → `README.md` symlink с разделом `## Claude Code Instructions`:
  - V1 repos are reference only — do not edit or import without explicit decision
  - Список сервисов V2 и их роли
  - Единственный домен: `recruiter-assistant.com`
- [ ] `docs/legacy-map.md` — что берём из каких V1 репо и почему
- [ ] `docs/architecture-decisions.md` — ключевые решения (single send path, window-to-reject, event log + projection, etc.)
- [ ] Базовый `pnpm test` проходит пустой sanity тест

**Acceptance**: агент, открыв репо, не полезет редактировать `candidate-routing`.

---

### Iteration 1 — Скелет (день 1)

**Цель**: сервис запускается, принимает webhook, возвращает `{{text}}`.

```typescript
// Падающий тест:
test('webhook returns a real message, not a placeholder', async () => {
  const res = await POST('/webhook/message', { 
    candidate_id: testCandidate.id, 
    text: 'Здравствуйте!' 
  });
  expect(res.body.message).not.toContain('{{');
  expect(res.body.message).not.toContain('}}');
});
```

**Делаем:**
- [ ] Neon schema (SQL выше)
- [ ] Seed: 1 клиент, 1 рекрутер, 1 вакансия (повар/официант), 5 шагов pipeline
- [ ] `POST /webhook/message` → достаёт текущий шаг → возвращает `{{text}}`
- [ ] Тест падает → фиксируем

**Итог итерации**: тест зафиксирован как красный.

---

### Iteration 1 — Первое зелёное: LLM отвечает (день 1-2)

**Цель**: реальный ответ на первое сообщение кандидата.

**Делаем:**
- [ ] Интеграция с Gemini Flash (дешёвая модель)
- [ ] `buildPrompt(step, conversationHistory, resumeText)` → строка для LLM
- [ ] Webhook: достаёт шаг → строит промпт → вызывает LLM → кладёт в `moderation_queue`
- [ ] Отдельный endpoint `GET /queue/pending` для просмотра очереди
- [ ] Тест зеленеет

**Критическое**: на этом этапе сообщение НЕ уходит кандидату. Только в очередь.

---

### Iteration 2 — State machine: продвижение по шагам (день 2-3)

**Падающие тесты:**
```typescript
test('pipeline advances when candidate answers correctly', ...)
test('pipeline stays at step when answer incomplete', ...)
test('pipeline rejects candidate when they decline', ...)
```

**Делаем:**
- [ ] LLM оценивает **все незакрытые шаги** разом — не только текущий
- [ ] Structured output: список закрытых шагов + следующее сообщение
- [ ] Обновление `pipeline_step_state` для всех закрытых шагов одной транзакцией
- [ ] Для `STAY` — уточняющий вопрос только по нераскрытым шагам
- [ ] Для `REJECT` — вежливый отказ (шаблон)
- [ ] Тесты зеленеют, включая сценарий «один ответ закрыл 3 шага»

**Ключевой промпт (batch-оценка всех незакрытых шагов):**
```
Ты — рекрутер компании {company_name}.
Вакансия: {job_title}

История переписки:
{conversation_history}

Резюме кандидата:
{resume_text}

Шаги которые нужно закрыть (в порядке приоритета):
{pending_steps}   ← все незакрытые, не только текущий

Для каждого шага определи: закрыт ли он уже ответами кандидата?
Напиши одно следующее сообщение — спроси только то что ещё не выяснено.
Если кандидат явно не подходит — вежливо откажи.

Ответь в JSON:
{
  "step_result": "done|needs_clarification|reject|manual_review",
  "completed_step_ids": ["medical_book", "red_fish_experience"],
  "rejected_step_id": null,
  "extracted_facts": {"has_medical_book": true, "fish_experience_years": 3},
  "missing_information": [],
  "next_message": "текст следующего сообщения кандидату",
  "confidence": 0.85,
  "guard_flags": []
}
```

**Обязательный детерминированный validator после LLM** (не пропускать):
- JSON parse + schema validation
- Нет `{{placeholder}}` в `next_message`
- Нет дубля последнего outgoing сообщения
- Длина сообщения в пределах лимита
- Если `reject` — сообщение должно быть вежливым, без агрессии
- Если `needs_clarification` — сообщение спрашивает именно недостающее из `missing_information`
- Если tool step — нет фейковых URL, ждём реального результата tool call

Validator провалился → `guard_flags` в `pipeline_events`, рекрутеру уведомление, сообщение не уходит.

**Логика первого сообщения (outreach):**
- История пустая → LLM видит все шаги сразу
- Генерирует одно сообщение с батчем ключевых вопросов (не все подряд — только те что разумно задать сразу)
- Это естественно: «Привет! Расскажите про опыт с рыбой, есть ли медкнижка, готовы ли к AI-интервью?»

---

### Iteration 3 — HH интеграция (день 3-4)

**Цель**: реальные сообщения от HH.ru, реальная отправка.

**HH connector schema** (`repository_hh_connect`):
```sql
CREATE TABLE repository_hh_connect.hh_negotiations (
  hh_negotiation_id TEXT PRIMARY KEY,
  job_id            UUID NOT NULL,
  candidate_id      UUID,
  hh_vacancy_id     TEXT NOT NULL,
  hh_collection     TEXT NOT NULL DEFAULT 'response',
  channel_thread_id TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE repository_hh_connect.hh_poll_state (
  hh_negotiation_id TEXT PRIMARY KEY REFERENCES repository_hh_connect.hh_negotiations,
  last_polled_at    TIMESTAMPTZ,
  hh_updated_at     TIMESTAMPTZ,  -- их timestamp (для pre-filter)
  last_sender       TEXT CHECK (last_sender IN ('applicant','employer')),
  awaiting_reply    BOOLEAN NOT NULL DEFAULT false,
  no_response_streak INTEGER NOT NULL DEFAULT 0,
  next_poll_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Делаем:**
- [ ] `hh-connector` (отдельный модуль): polling с pre-filter оптимизацией
- [ ] `awaiting_reply` boolean вместо `last_message_from TEXT`
- [ ] Fallback: если pre-filter говорит "пропустить", проверяем DB на незакрытые входящие
- [ ] Сортировка сообщений по `created_at` перед определением last sender (известный баг!)
- [ ] `sendHHWithGuard()` — взять логику из `candidate-routing`, адаптировать
- [ ] Cron: каждую минуту проверяет `planned_messages WHERE review_status IN ('pending','approved') AND auto_send_after < now()`
- [ ] **Window to reject** = 10 минут по умолчанию (настраивается per-job)
- [ ] Alert если `awaiting_reply=true` и нет delivered outbound > 2 часов

---

### Iteration 4 — Moderation UI (день 4-5)

**Цель**: простая веб-страница для рекрутера.

**Делаем:**
- [ ] `GET /recruiter/queue` — список сообщений в очереди (pending + недавно отправленные)
- [ ] `POST /recruiter/queue/:id/block` — заблокировать отправку
- [ ] Простой HTML (можно без фреймворка): таблица с таймером до отправки, кнопка "Заблокировать"
- [ ] Страница на статичной ссылке `/recruiter/{recruiter_token}/queue`

**UX модерации:**
```
┌─────────────────────────────────────────────────────┐
│  Кандидат: Иванов Иван (Повар, вакансия #12)        │
│  Шаг 3: Проверка медкнижки                          │
│  Отправка через: 7 мин                              │
│                                                     │
│  "Иван, уточните, пожалуйста, есть ли у вас         │
│   действующая медицинская книжка? Это обязательное  │
│   условие для данной позиции."                      │
│                                                     │
│  [Заблокировать]  [Отправить сейчас]                │
└─────────────────────────────────────────────────────┘
```

---

### Iteration 5 — Multi-tenant + изоляция (день 5-6)

**Цель**: 2 компании × 2 рекрутера × 1 вакансия — никто не видит чужих данных.

**Делаем:**
- [ ] Management DB с таблицей `clients`
- [ ] Middleware для hiring MCP: `recruiter_id → client_id → neon_conn`
- [ ] Все запросы к candidate-facing API через `job_id` (не `recruiter_id`)
- [ ] Seed: создать 4 тестовые компании, кандидаты через разные вакансии

**Интеграционный тест:**
```typescript
test('recruiter A cannot see recruiter B candidates', async () => {
  const tokenA = await getToken(recruiterA);
  const tokenB = await getToken(recruiterB);
  const candidatesForB = await GET('/candidates', { token: tokenA });
  expect(candidatesForB).not.toContain(candidateOfB.id);
});
```

---

### Iteration 6 — Telegram уведомления (день 6-7)

**Цель**: рекрутер подписывается на событие "кандидат дошёл до шага домашнего задания".

**Делаем:**
- [ ] Telegram Bot (простой, через polling или webhook)
- [ ] `recruiter.tg_chat_id` в management DB
- [ ] Event system: при изменении `pipeline_step_state` → проверить subscriptions
- [ ] `recruiter_subscriptions` таблица: `recruiter_id, job_id, step_index, event_type`
- [ ] Команды бота: `/subscribe job_id step_index` и `/unsubscribe`

---

### Pipeline template format (фиксируем до начала кодинга)

Каждый шаг имеет явные критерии завершения — LLM не придумывает сам:

```json
{
  "name": "food-production-screening-v1",
  "steps": [
    {
      "id": "medical_book",
      "kind": "question",
      "goal": "Проверить наличие медкнижки",
      "done_when": "кандидат явно подтвердил наличие действующей медкнижки или готовность оформить до выхода",
      "reject_when": "кандидат отказывается от медкнижки",
      "prompt_key": "step.medical_book"
    },
    {
      "id": "red_fish_experience",
      "kind": "question",
      "goal": "Проверить опыт работы с красной рыбой",
      "done_when": "кандидат описал релевантный опыт или подтвердил его отсутствие",
      "reject_when": "вакансия требует опыт и кандидат явно его не имеет",
      "prompt_key": "step.red_fish_experience"
    },
    {
      "id": "create_ai_interview_link",
      "kind": "tool",
      "tool": "create_ai_interview_link",
      "goal": "Сгенерировать ссылку на AI-интервью",
      "done_when": "tool вернул interview_url",
      "prompt_key": "step.send_ai_interview_link"
    }
  ]
}
```

`kind: "tool"` шаги не задают вопрос — они вызывают API и используют результат в сообщении. LLM не может выдумать URL — только подставить из tool result.

---

### Iteration 7 — Pipeline generator (день 7-8)

**Цель**: по описанию вакансии — генерировать `pipeline_steps`.

**Делаем:**
- [ ] 3-4 шаблонных сценария (повар, официант, менеджер по продажам, курьер)
- [ ] LLM генерирует шаги по шаблону + описанию вакансии
- [ ] Рекрутер может редактировать через hiring agent (или UI)
- [ ] Сохранение как JSON → затем в `pipeline_steps`

**Формат шаблона:**
```json
[
  {
    "step_index": 1,
    "goal": "проверить наличие медкнижки",
    "prompt_template": "Спроси кандидата есть ли медкнижка. Если да — переходи дальше. Если нет — уточни, готовы ли оформить. Если категорически против — вежливо откажи."
  },
  ...
]
```

---

### Iteration 8 — Analytics / text2sql (день 8-9)

**Цель**: воронка кандидатов простым запросом к hiring agent.

**Делаем:**
- [ ] **Mart**: `output_data_marts.candidate_funnel` — отдельная read-only таблица/view (LLM никогда не видит сырые operational tables)
  - колонки: `tenant_id`, `job_id`, `job_title`, `candidate_id`, `candidate_name`, `channel`, `pipeline_run_status`, `active_step_id`, `active_step_goal`, `awaiting_reply`, `pending_review_count`, `last_inbound_at`
- [ ] Tool в hiring MCP: `ask_funnel_question(question)` — внутри text2sql только поверх marts, tenant scope инжектируется в tool, не моделью, с row limit и query timeout
- [ ] Тест: "сколько кандидатов на вакансии X дошло до шага 3?"

---

### Iteration 9 — API call steps (день 9-10)

**Цель**: шаг pipeline может генерировать ссылку на AI-интервью через API.

**Делаем:**
- [ ] `pipeline_steps.requires_api_call` — имя вызываемого API
- [ ] Step executor: перед генерацией сообщения выполняет API call
- [ ] Первый кейс: `generate_interview_link` → `interview-engine` API → ссылка подставляется в сообщение
- [ ] Тест: шаг с `requires_api_call` генерирует сообщение с реальной ссылкой

---

## Репозитории — стратегия

### Новый монорепо: `hiring-agent-v2`

Рекомендую один репозиторий с воркспейсами:
```
hiring-agent-v2/
├── services/
│   ├── candidate-chatbot/    # новый, простой
│   ├── hh-connector/         # берём из candidate-routing, очищаем
│   ├── hiring-mcp/           # эволюция recruiter-mcp
│   └── hiring-agent/         # эволюция recruiting-agent
├── packages/
│   ├── db-schema/            # SQL migrations, shared types
│   └── prompts/              # prompt templates, playbooks
└── tests/
    └── integration/          # сценарии с кандидатами
```

### Что делать со старыми репо

| Репо | Статус | Что сделать |
|---|---|---|
| `candidate-routing` | Legacy, работает | Freeze: read-only, не деплоить новое |
| `recruiter-mcp` | Частично работает | Параллельная разработка `hiring-mcp` |
| `recruiting-agent` | Глючит после рефакторинга | Заморозить, взять playbooks паттерн |
| `recruiter-data-layer` | Недоработан | Выделить только multi-tenant Neon логику |
| `hh-connector` (отдельный) | Сохранить | Адаптировать `sendHHWithGuard` |
| `interview-engine` | Работает | Не трогать, использовать как API |
| `apply-via-resume` | Работает | Не трогать, интегрировать позже |

**Принцип**: пока `hiring-agent-v2` не закроет все кейсы `candidate-routing` — старый продолжает работать. Миграция клиентов по одному.

---

## CLAUDE.md / Memory — рекомендация

**Да, сделать reset.** Вот почему и как:

### Проблема
В `~/.claude/projects/*/memory/` и в CLAUDE.md разных репо накопилось много контекста про старую архитектуру. Агент (особенно при параллельной работе) будет путаться между `candidate-routing` и `candidate-chatbot`, между старыми и новыми таблицами.

### Что сделать

1. **Глобальный `~/.claude/CLAUDE.md`** — оставить как есть (там общие правила, они не про конкретный проект)

2. **Старые memory файлы** — архивировать, не удалять:
```bash
mv ~/.claude/projects/-Users-vova-Documents-GitHub-recruiting-agent/memory/ \
   ~/.claude/projects/-Users-vova-Documents-GitHub-recruiting-agent/memory-archived-2026-04/
```

3. **В новом репо** (`hiring-agent-v2`) сделать чистый `CLAUDE.md` → `README.md` symlink с разделом `## Claude Code Instructions` где чётко написано:
   - Какая архитектура
   - Где какой сервис
   - Что НЕЛЬЗЯ трогать (старые репо в read-only)
   - Как запускать тесты

4. **Метка в старых репо** — добавить в их `README.md`:
```markdown
> ⚠️ LEGACY: этот репозиторий заморожен. Активная разработка в `hiring-agent-v2`.
> Не деплоить новые версии. Читать можно, изучать паттерны можно.
```

5. **Разметка для агентов** — в начале каждой сессии явно указывать с чем работаем:
```
/context: работаем только с hiring-agent-v2, старые репо read-only
```

---

## Параллельная разработка — как не запутаться

**Принцип**: два продукта работают одновременно. Переключение по готовности, не по дате.

```
Production (сейчас):       candidate-routing v5  ──► клиенты
                                    │
                                    │ (параллельно)
                                    ▼
Development:               hiring-agent-v2  ──► staging с тестовыми кандидатами
                                    │
                                    │ когда iteration 5+ готова
                                    ▼
Pilot migration:           1 клиент переходит на v2 ──► наблюдаем
                                    │
                                    │ когда всё ок
                                    ▼
Full migration:            все клиенты на v2, старые репо архивируются
```

**Правило**: пока нет iteration 5 (multi-tenant + изоляция) — в production ничего не попадает.

---

## Первый шаг прямо сейчас

Если начинать завтра, вот точный порядок действий:

```bash
# 1. Новый репо
gh repo create hiring-agent-v2 --private --clone
cd hiring-agent-v2

# 2. Минимальная структура
mkdir -p services/candidate-chatbot/{src,tests}
mkdir -p packages/db-schema/migrations

# 3. Первый failing тест (буквально первый файл)
cat > services/candidate-chatbot/tests/webhook.test.ts << 'EOF'
test('webhook returns a real message, not a placeholder', async () => {
  // TODO: implement
  expect('{{text}}').not.toContain('{{');  // этот тест ПАДАЕТ намеренно
});
EOF

# 4. Seed вакансии (3 сценария для начала)
# - Повар с медкнижкой (5 шагов)
# - Менеджер продаж (6 шагов)  
# - Курьер (3 шага)
```

**Самый маленький рабочий сервис** — это:
- 1 вакансия (повар)
- 1 тестовый кандидат (ты, пишущий в webhook)
- 5 шагов pipeline в seed данных
- Webhook возвращает реальный текст от Gemini Flash
- Сообщение лежит в `moderation_queue` (не отправляется)

Это можно сделать за один день. Дальше — итерация за итерацией.

---

## Multi-Agent System угол зрения

Ты правильно заметил что это по сути Multi Agent System. Вот как это видно:

- **Hiring Agent** (дорогая модель, Claude) — работает с рекрутером. Понимает сложные запросы, планирует, генерирует вакансии и pipeline
- **Candidate Chatbot** (дешёвая модель, Gemini Flash) — работает с кандидатом. Тупой, надёжный, следует строгим инструкциям шага
- **Pipeline Step Executor** — не LLM, детерминированный код. Решает когда вызвать API (генерация ссылки на интервью), когда переключить шаг

Ключевая граница: Hiring Agent **не знает** про конкретных кандидатов в реальном времени. Он работает с данными агрегированно (воронка, статистика) и настраивает систему (создаёт вакансии, редактирует pipeline). Candidate Chatbot — полностью автономный по кандидату.

Это и есть правильная MAS архитектура: дорогая модель → настройка, дешёвая модель → исполнение.

---

*Следующий шаг: создать GitHub repo `hiring-agent-v2`, положить туда этот файл как `SPEC.md`, и начать с Iteration 0.*

---

## Инфраструктура и домены — сохранить что работает

### Текущая карта деплоя (не трогать)

| Сервис | Где живёт | Адрес |
|---|---|---|
| `recruiting-agent` (hiring agent) | GCP VM `recruiter-agent-frontend-and-api-vm` us-central1-a, IP `34.31.217.176` | `agent.recruiter-asisstant.com` |
| `candidate-routing` (chatbot) | Cloud Run europe-west1, проект `project-5d8dd8a0-67af-44ba-b6e` | внутренний endpoint |
| `apply-via-resume` | Cloudflare Workers | отдельный субдомен |
| лендинги | Firebase Hosting | `recruiter-asisstant.com/linkedin/`, `/hh-ru/` |

> ⚠️ `recruiter-asisstant.com` (двойная s) — куплен по ошибке, отменить/не продлевать. Единственный рабочий домен: `recruiter-assistant.com`.

### Ограничение: Cloudflare — только DNS, не в пути к кандидату

**Правило**: Cloudflare используется исключительно как DNS-провайдер (серое облако, no-proxy). Трафик от кандидатов через Cloudflare не идёт.

Причина: у части аудитории (RU/CIS рынок) Cloudflare заблокирован или нестабилен. Кандидат — критически важный участник, его запрос должен доходить всегда.

| Способ использования | Статус |
|---|---|
| Cloudflare DNS (gray cloud) для домена | ✅ OK |
| Cloudflare Workers вызванный с сервера (server→CF) | ✅ OK |
| Cloudflare Workers/CDN в пути браузера кандидата | ❌ Нельзя |
| Любой Cloudflare в пути webhook от HH.ru | ❌ Нельзя |
| Google Cloud (Cloud Run, VM) для публичных эндпоинтов | ✅ OK |
| Google APIs вызываемые с сервера | ✅ OK |

**Практически это значит:**
- `candidate-chatbot` webhook → Cloud Run напрямую (не через Cloudflare Workers)
- `apply-via-resume` (Cloudflare Workers) — проверить: кандидат загружает резюме через браузер → **это нарушение правила**. Если на текущем трафике не горит, в v2 переехать на Cloud Run
- `hiring-agent` (чат рекрутера) — рекрутер не кандидат, Cloudflare в его пути допустим если нужно, но зачем — VM уже работает

### Полная карта доменов — v1 и v2

**Единственный рабочий домен: `recruiter-assistant.com`** (правильное написание).

> ⚠️ `recruiter-asisstant.com` (двойная s) — куплен по ошибке, **отменить/не продлевать**. До отмены лендинги перенести на `recruiter-assistant.com`. Firebase Hosting переключить на правильный домен.

#### v1 (оставляем работать, не трогаем)

| Субдомен | Сервис | Инфра | Cloudflare proxy? |
|---|---|---|---|
| `agent.recruiter-assistant.com` | recruiting-agent (старый) | GCP VM | нет — DNS only |
| `apply.recruiter-assistant.com` | apply-via-resume | Cloudflare Workers | Workers route |
| `mcp.recruiter-assistant.com` | recruiter-mcp (старый) | GCP VM | нет — DNS only |
| `i.recruiter-assistant.com` | static CDN | Cloudflare Worker | Workers route |
| `recruiter-asisstant.com/linkedin` | лендинг LinkedIn | Firebase Hosting | нет — ⚠️ перенести на `recruiter-assistant.com/linkedin` |
| `recruiter-asisstant.com/hh-ru` | лендинг HH.ru | Firebase Hosting | нет — ⚠️ перенести на `recruiter-assistant.com/hh-ru` |

#### v2 (новые субдомены, не пересекаются с v1)

| Субдомен | Сервис v2 | Инфра | Cloudflare proxy? |
|---|---|---|---|
| `hiring-chat.recruiter-assistant.com` | hiring-agent (новый) | GCP VM, systemd | нет — DNS only |
| `candidate-chatbot.recruiter-assistant.com` | candidate-chatbot API | Cloud Run europe-west1 | нет — DNS only |
| `hiring-mcp` | (нет публичного домена) | GCP VM, внутренний | — |
| `hiring-chat.recruiter-assistant.com/moderation` | moderation queue UI | часть hiring-agent | — |

> `chat.` и `api.` — **заняты** (верифицировано в DNS). Используем `hiring-chat.` и `candidate-chatbot.` — гарантированно свободны.

> `i.recruiter-assistant.com` и `apply.recruiter-assistant.com` идут через Cloudflare Workers — это нарушение правила "не в пути кандидата". Пометить как tech debt, исправить после миграции v2.

#### После полной миграции на v2

```
agent.recruiter-assistant.com  →  редирект на chat.recruiter-assistant.com
mcp.recruiter-assistant.com    →  убрать (hiring-mcp внутренний)
```

**Почему Cloud Run для candidate-chatbot:**
- `candidate-routing` уже на Cloud Run europe-west1 — значит регион, billing, IAM настроены
- Cloud Run = zero-to-scale, без управления процессами, дешевле idle-сервисов на VM
- Webhook от HH.ru приходит наружу → нужен публичный HTTPS эндпоинт → Cloud Run идеален

**Почему VM для hiring-agent:**
- Уже работает, systemd настроен, SSH деплой отлажен
- Рекрутерский чат — не публичный API, не нужен auto-scale
- Не менять то что не сломано

---

## CI/CD — переиспользовать recruiting-ci-cd

### Что брать из текущего пайплайна

Файлы `.github/workflows/pipeline.yml` и `scripts/deploy-ci.sh` реализуют рабочий паттерн:
```
manual trigger → static tests → merge PRs → build → SCP → systemd restart → health check
```

**Сохранить:**
- Manual trigger через `workflow_dispatch` (правильно для prod деплоя)
- Разделение на таргеты: Cloud Run vs VM vs Cloudflare Workers
- Secrets через GitHub Secrets (не хардкодить)
- Health check после деплоя

**Добавить для v2:**
- Integration test step перед деплоем (запуск сценариев с тестовыми кандидатами)
- Smoke test после деплоя: webhook принимает сообщение → очередь не пустая

### Структура workflows для monorepo

```yaml
# .github/workflows/deploy-candidate-chatbot.yml
on:
  workflow_dispatch:
    inputs:
      environment: { type: choice, options: [staging, production] }

jobs:
  test:
    # статические тесты + integration тесты против staging Neon DB

  deploy-cloud-run:
    needs: test
    # gcloud run deploy candidate-chatbot --region europe-west1

  smoke-test:
    needs: deploy-cloud-run
    # POST /webhook/test-message → проверить что модель ответила
```

### Staging vs Production

Используем **Neon branching** (уже есть возможность в data layer):
- `main` branch Neon = production
- `staging` branch Neon = staging (бесплатно, копия схемы)
- В GitHub Actions: `environment: staging` → `NEON_BRANCH=staging`

Это позволяет тестировать миграции схемы без риска для prod данных.

---

## Чек-лист "не наступить на старые грабли"

Вещи которые уже решены в текущей инфраструктуре и нужно просто перенести:

- [ ] **GCP IAM роли** для Cloud Run — уже настроены в проекте `project-5d8dd8a0-67af-44ba-b6e`, переиспользовать
- [ ] **Cloudflare DNS** для `recruiter-asisstant.com` — добавить A/CNAME только для `chat.` и `api.`
- [ ] **GitHub Secrets** — скопировать ключи из recruiting-ci-cd в новый репо (VM SSH key, GCP SA JSON, Neon conn strings)
- [ ] **Systemd unit файл** для hiring-agent — взять из текущего VM деплоя `recruiter-agent`, адаптировать имя сервиса
- [ ] **europe-west1 регион** — зафиксировать для всех новых Cloud Run сервисов (latency для RU аудитории, billing уже настроен)
- [ ] **Firebase Hosting** — лендинги не трогать, они независимы

---

*Следующий шаг: создать GitHub repo `hiring-agent-v2`, положить туда этот файл как `SPEC.md`, и начать с Iteration 0.*
