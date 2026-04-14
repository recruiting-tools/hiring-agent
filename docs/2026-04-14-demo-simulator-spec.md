# Demo Simulator Spec

Date: 2026-04-14

Status: ready for implementation

## Goal

Сделать demo-режим, в котором продукт выглядит живым без ручного вмешательства:

- в системе есть правдоподобные вакансии;
- по ним появляются hh-подобные кандидаты;
- часть кандидатов переписывается с системой;
- часть уходит в `planned_messages`;
- moderation queue почти всегда не пустая;
- у разных вакансий может быть разный timeout до автосенда.

Это нужно не для тестов в узком смысле, а для продуктового demo / sandbox / smoke flows.

## What we want to demo

1. `candidate-chatbot` получает новые отклики и сообщения
2. система строит сообщения кандидату и кладёт их в moderation queue
3. recruiter открывает `/recruiter/:token` и видит:
   - таймер до автосенда
   - тело сообщения
   - причину
   - кандидата
   - вакансию
4. recruiter может:
   - заблокировать сообщение
   - отправить сразу
5. очередь не умирает после 1–2 действий, а продолжает быть живой

## Core idea

Нужны два слоя:

### 1. Snapshot seed

Одноразово создаёт начальный мир:

- demo вакансии
- кандидаты
- conversations
- pipeline runs
- часть pending moderation items

### 2. Background simulator

Фоновый цикл, который поддерживает мир живым:

- периодически создаёт новых кандидатов
- периодически добавляет входящие сообщения существующим кандидатам
- периодически двигает диалоги до нового `planned_message`
- поддерживает минимальное количество pending items в moderation queue

Без второго слоя demo быстро умирает: queue просмотрели, пару сообщений заблокировали, и всё пусто.

## Scope

### In scope

- hh-like synthetic candidates and dialogs
- vacancy-specific moderation delay
- queue target maintenance
- sandbox/demo use
- deterministic generation with seed

### Out of scope

- real HH API traffic in demo mode
- production auto-seeding
- full recruiter-side business analytics
- bi-directional realistic candidate psychology beyond a bounded template system

## Demo datasets

Simulator работает поверх заранее seeded demo-вакансий.

Минимальный набор:

1. `vac-demo-warehouse-picker`
2. `vac-demo-cook-hot-shop`
3. `vac-demo-sales-skolkovo`
4. `vac-demo-unlaunched-ops-manager`

Опционально позже:

5. `vac-demo-electrician-shifts`
6. `vac-demo-tile-worker`
7. `vac-demo-china-procurement`

## Product schema rule

Никакой отдельной runtime-схемы для demo не создаём.

Simulator пишет в те же сущности, что и продукт:

- `chatbot.jobs`
- `chatbot.vacancies`
- `chatbot.candidates`
- `chatbot.conversations`
- `chatbot.messages`
- `chatbot.pipeline_runs`
- `chatbot.pipeline_step_state`
- `chatbot.planned_messages`

Если нужен служебный генераторный формат, он существует только как input для tooling, не как новая runtime schema.

## Vacancy-level moderation timeout

Сейчас delay глобальный:

- [config.js](/Users/vova/Documents/GitHub/hiring-agent/services/candidate-chatbot/src/config.js)
- `MODERATION_AUTO_SEND_DELAY_HOURS`

Для demo нужен timeout на уровне вакансии.

### Requirement

У разных demo вакансий должен быть разный `auto_send_after`.

Примеры:

- `warehouse-picker`: `120` минут
- `cook-hot-shop`: `90` минут
- `sales-skolkovo`: `180` минут

### Proposed model

Добавить в `chatbot.vacancies` новое поле:

```sql
ALTER TABLE chatbot.vacancies
ADD COLUMN moderation_settings JSONB NOT NULL DEFAULT '{}';
```

Пример:

```json
{
  "auto_send_delay_minutes": 120
}
```

### Resolution order

При создании `planned_messages`:

1. если у вакансии есть `moderation_settings.auto_send_delay_minutes` — использовать его
2. иначе fallback на глобальный env (`MODERATION_AUTO_SEND_DELAY_HOURS`)

### Why JSONB, not scalar column

Потому что потом сюда же можно добавить:

- `moderation_policy`
- `queue_target`
- `demo_simulator_enabled`
- `max_auto_retries`

## Demo simulator runtime

### New script

Предлагаемый entrypoint:

- `scripts/demo-simulator.js`

### Optional helper files

- `data/demo-simulator/vacancy-archetypes.json`
- `data/demo-simulator/candidate-archetypes.json`
- `data/demo-simulator/dialog-templates.json`

### Process mode

Запускается как долгоживущий loop:

```bash
DEMO_SIMULATOR=1 CHATBOT_DATABASE_URL=... node scripts/demo-simulator.js
```

или как bounded tick:

```bash
node scripts/demo-simulator.js --tick
```

`--tick` нужен для тестов и cron-like orchestration.

## Simulator invariants

Это главное. Simulator не должен просто “рандомно шуметь”.

Он должен поддерживать инварианты.

### Queue invariants

- глобально в moderation queue всегда `>= 5` pending items
- по каждой активной demo vacancy желательно `>= 1` pending item
- не больше `N` pending items на одну вакансию, например `4`

### Candidate invariants

Для массовой вакансии:

- всего открытых кандидатов `20–40`
- active conversations `8–15`
- went dark `5–10`
- rejected `5–10`
- target-action reached `1–3`

### Activity invariants

За последние `30` минут demo времени должно быть хотя бы:

- `1` новый кандидат
- `1` новый inbound message
- `1` новый planned message

Тогда система выглядит живой.

## Actor model

Simulator работает через bounded candidate archetypes.

### Candidate archetypes

1. `strong_fit`
2. `medium_needs_clarification`
3. `salary_mismatch`
4. `schedule_mismatch`
5. `docs_problem`
6. `no_experience_but_motivated`
7. `hidden_gem`
8. `went_dark`
9. `chaotic_responder`

### Per-vacancy archetype weighting

Пример для blue-collar вакансии:

```json
{
  "strong_fit": 0.20,
  "medium_needs_clarification": 0.22,
  "salary_mismatch": 0.12,
  "schedule_mismatch": 0.10,
  "docs_problem": 0.08,
  "no_experience_but_motivated": 0.10,
  "hidden_gem": 0.05,
  "went_dark": 0.10,
  "chaotic_responder": 0.03
}
```

## Event types the simulator generates

### 1. `candidate_created`

Создаёт:

- `candidate`
- `conversation`
- `pipeline_run`
- initial `pipeline_step_state`

### 2. `candidate_applied`

Создаёт первое входящее сообщение в hh-like стиле:

- короткое
- без идеальной структуры
- иногда с salary
- иногда только “Здравствуйте, заинтересовала вакансия”

### 3. `candidate_replied`

Добавляет входящее сообщение в уже существующий conversation.

### 4. `candidate_went_dark`

Не пишет ничего, но кандидат остаётся в активном или подвешенном состоянии.

### 5. `candidate_closed`

Закрывает жизненный цикл:

- `rejected`
- `completed`
- `no_response`

Кандидата не удаляем.

## Execution strategy

Каждый tick делает:

1. Load active demo vacancies
2. Measure current state
3. If queue below target:
   - pick conversations likely to produce new `planned_message`
   - inject inbound messages
   - run candidate-chatbot webhook flow
4. If too few active candidates:
   - spawn new candidates
5. If no recent activity:
   - create at least one synthetic inbound event

Псевдокод:

```js
for each vacancy:
  ensureCandidatePopulation(vacancy)
  ensureRecentActivity(vacancy)
  ensurePendingQueue(vacancy)

global:
  ensureGlobalQueueTarget()
```

## How simulator should interact with the app

Лучше не писать напрямую в таблицы всё подряд.

### Allowed direct writes

Можно напрямую создавать:

- demo candidates
- conversations
- pipeline_runs
- pipeline_step_state
- seed messages

### Preferred app entrypoint for dialogue progression

Когда надо “кандидат ответил”, лучше идти через существующий app contract:

- `POST /webhook/message`

или напрямую через handler `postWebhookMessage`.

Почему:

- это создаёт реальные `planned_messages`
- это проверяет настоящий pipeline logic
- moderation queue становится продуктово правдивой

## HH mocking strategy for demo

Для demo не нужен реальный HH sync.

Нужно ощущение hh-подобного потока.

### Recommended approach

Сделать simulator с источником `hh_like`, который создаёт:

- hh-like candidate names
- hh-like short application texts
- hh-like conversation cadence

При этом реальные HH API fixtures можно использовать как reference material, но не как обязательный runtime dependency.

### Optional future integration

Позже можно сделать режим:

- simulator populates `hh-contract-mock`
- `hh-connector` sync-ит оттуда

Но это уже next iteration. Для первого demo достаточно synthetic hh-like source.

## Demo vacancy classes

### Class A: blue-collar

Properties:

- много откликов
- короткие ответы
- много mismatch и went-dark
- queue replenishment быстрый

Examples:

- warehouse
- cook
- electrician
- tile worker

### Class B: recruiter-driven richer vacancy

Properties:

- меньше кандидатов
- длиннее переписка
- больше уточняющих шагов
- часть диалогов доходит до target action

Examples:

- sales-skolkovo
- china-procurement

### Class C: empty draft

Properties:

- нет кандидатов
- нет conversations
- есть rich raw materials
- используется для `create_vacancy`

Example:

- `vac-demo-unlaunched-ops-manager`

## Files to add

### Spec / config

- `data/demo-simulator/vacancies.json`
- `data/demo-simulator/candidate-archetypes.json`
- `data/demo-simulator/dialog-templates.json`

### Scripts

- `scripts/demo-seed.js`
- `scripts/demo-simulator.js`

### Optional reusable library

- `services/candidate-chatbot/src/demo/simulator.js`
- `services/candidate-chatbot/src/demo/archetypes.js`

If kept in `services/`, it must still remain non-production support code.

## Config

### Environment variables

```bash
DEMO_SIMULATOR=1
DEMO_SIMULATOR_TICK_SECONDS=30
DEMO_GLOBAL_QUEUE_TARGET=6
DEMO_QUEUE_TARGET_PER_VACANCY=2
DEMO_MAX_PENDING_PER_VACANCY=4
DEMO_TARGET_ACTIVE_CANDIDATES_PER_JOB=30
DEMO_DEFAULT_MODERATION_DELAY_MINUTES=120
```

### Vacancy-level overrides

Stored in `chatbot.vacancies.moderation_settings`:

```json
{
  "auto_send_delay_minutes": 120,
  "queue_target": 2,
  "simulator_enabled": true
}
```

## Testing strategy

Нужно 3 слоя.

### 1. Unit tests

Проверять:

- invariant resolver
- candidate spawning
- queue target calculations
- moderation delay resolution order

### 2. Integration tests

Проверять:

- simulator tick creates candidate activity
- simulator tick replenishes queue when empty
- vacancy-specific moderation timeout correctly affects `auto_send_after`

### 3. Browser smoke / demo tests

Через Playwright:

1. открыть moderation page
2. увидеть хотя бы `N` items
3. заблокировать один
4. через следующий tick увидеть, что queue replenished

## Rollout plan

### Phase 1

- добавить spec and configs
- реализовать `demo-seed.js`
- добавить `moderation_settings` в vacancies
- поддержать vacancy-level timeout в planned message creation

### Phase 2

- реализовать `demo-simulator.js --tick`
- покрыть integration tests

### Phase 3

- сделать long-running loop mode
- добавить browser smoke на moderation queue

## Minimal definition of done

Считать задачу выполненной, когда:

- seeded demo dataset содержит `3+` активные demo vacancies и `1` draft vacancy
- moderation timeout можно задать на уровне вакансии
- один `demo-simulator tick` умеет:
  - создать нового кандидата или reply
  - сгенерировать новый `planned_message`, если queue просела
- moderation queue после ручного разбора не умирает навсегда
- есть тест, что `auto_send_after` берётся из vacancy settings, а не только из глобального env

## Recommendation

Первую реализацию стоит сделать максимально прагматично:

- без real HH sync
- без LLM-heavy realism
- через bounded archetypes и deterministic templates
- через реальный `postWebhookMessage` path для генерации moderation queue

Это даст живой demo, который:

- воспроизводим,
- понятен,
- не зависит от внешних систем,
- и хорошо показывает moderation UI как часть продукта.
