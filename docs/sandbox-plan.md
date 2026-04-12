# Sandbox Plan

Дата: 2026-04-12
Статус: draft-for-review
Owner: platform / hiring-agent

## Goal

Сделать воспроизводимый `sandbox`-контур для `hiring-agent`, в котором новый функционал проходит:

- локальные и CI тесты;
- seeded demo database;
- smoke сценарии login -> inbox/queue -> pipeline -> send/block;
- облачный прогон на отдельном окружении;
- безопасные mock integrations без случайных live send.

## Non-goals

- не строим полную копию production data;
- не делаем live HH end-to-end обязательным для каждого изменения;
- не смешиваем sandbox с production login/seed;
- не используем sandbox как замену миграциям, тестам и code review.

## Existing Baseline

- `pnpm test:all` уже есть и покрывает chatbot, hh, cron, moderation, tenant, telegram;
- есть fixture seeds на несколько вакансий;
- есть `hh-contract-mock` и fixture library;
- есть demo login, но сейчас credential flow частично захардкожен в сид-скриптах;
- production readiness gate уже описан в `README.md`.

## Environment Model

Нужны три четких уровня:

1. `test harness`
   Локальный и CI слой: fixture data, mock integrations, contract/integration tests.

2. `sandbox branch + database`
   Постоянная demo-среда на отдельной Neon branch/database с seeded synthetic data.

3. `ephemeral feature branch`
   Короткоживущие ветки Neon для рискованных миграций и preview-проверок.

## Neon Branching Model

Neon branches используем как механизм изоляции окружений, а не как замену миграциям.

- `prod/main` branch: production only.
- `sandbox` branch: постоянная demo/regression branch.
- `pr-*` или `feature-*` branch: временные ветки от `sandbox` или `prod` для risky changes.

Практический эффект:

- можно тестировать миграции и seed изолированно;
- sandbox можно reset/recreate без ручной чистки;
- ephemeral branches можно удалять по TTL после merge/review;
- production не делит state с sandbox после точки branching.

Ограничение:

- branch != mergeable schema history;
- source of truth для схемы все равно остается в SQL migrations репозитория.

## Sandbox Runtime Rules

В `sandbox` окружении должно быть явно задано:

- `APP_ENV=sandbox`
- `EXTERNAL_MODE=mock`
- `LLM_MODE=fake` по умолчанию

Требования:

- HH работает через contract mock;
- outbound send не ходит в live каналы;
- demo данные синтетические;
- demo user создается через отдельный bootstrap flow, а не через prod-only magic.

## Seeded Demo Dataset

Sandbox seed должен быть идемпотентным и включать:

- 1 demo client;
- 1 demo recruiter;
- 3 вакансии из fixture seed;
- кандидатов в разных состояниях пайплайна;
- moderation queue со статусами `pending`, `approved`, `blocked`, `sent`;
- HH negotiations и poll state;
- feature flags с безопасными значениями, минимум `hh_send=false`, `hh_import=false` по умолчанию.

## Mandatory Regression Matrix

### Auth and UI

- `GET /` редиректит на `/login`;
- `GET /login` возвращает HTML;
- demo login успешен;
- неверный пароль дает `401`;
- после логина доступна moderation page.

### Moderation

- queue показывает `pending` и `approved`;
- `blocked` и `sent` не отображаются;
- `block` меняет статус корректно;
- `send-now` переводит сообщение в немедленную отправку.

### Pipeline

- есть кандидаты в `active`, `needs_clarification`, `rejected`;
- completed steps и missing information остаются детерминированными.

### HH and Messaging

- HH polling импортирует inbound;
- idempotency по `channel_message_id`;
- reversed order messages не ломает `last_sender`;
- send guard не допускает duplicate send;
- `hh_send=false` не позволяет реальную отправку.

### Isolation

- sandbox recruiter не видит чужие данные;
- sandbox credentials не зависят от production сидов;
- sandbox branch/database не переиспользует production mutable state.

## Release Gate

Новый функционал не идет в production, пока не выполнено:

- `pnpm test:all`
- `pnpm test:sandbox`
- `pnpm smoke:sandbox`
- sandbox seed применился успешно
- sandbox cloud smoke green
- для schema changes: migration успешно применена на ephemeral Neon branch и на `sandbox`

## Implementation Iterations

### Iteration 1

- [x] Зафиксировать sandbox terminology и architecture в `docs/`
- [x] Добавить `seed:sandbox`
- [x] Добавить `bootstrap:demo-user`
- [x] Убрать plaintext demo password из production seed path

### Iteration 2

- [x] Добавить `smoke:sandbox`
- [x] Проверять `/`, `/login`, `/auth/login`, moderation HTML, queue JSON
- [x] Явно задавать mock-only sandbox runtime flags

### Iteration 3

- [x] Добавить runbook по Neon branches
- [x] Завести постоянную branch `sandbox`
- [x] Завести naming convention для `pr-*` branches
- [x] Описать reset/recreate flow для sandbox branch

### Iteration 4

- [ ] Поднять cloud sandbox deploy target
- [ ] Подключить sandbox DB branch
- [ ] Добавить post-deploy smoke
- [ ] Добавить health metadata: `app_env`, `deploy_sha`, `seed_version`

### Iteration 5

- [ ] Встроить sandbox gate в release process
- [ ] Для risky changes сначала создавать ephemeral Neon branch
- [ ] Для review использовать coordinator flow `Codex implements -> Claude reviews`

## Deliverables

- `docs/sandbox-plan.md`
- `docs/neon-sandbox-runbook.md`
- `.env.sandbox.example`
- `scripts/seed-sandbox-db.js`
- `scripts/bootstrap-demo-user.js`
- `scripts/smoke-sandbox.js`
- package scripts: `seed:sandbox`, `bootstrap:demo-user`, `smoke:sandbox`, `test:sandbox`

## Acceptance Criteria

- sandbox можно развернуть без доступа к production данным;
- sandbox можно пересоздать из migrations + seed;
- demo login не зависит от захардкоженного prod сидирования;
- smoke script детерминированно проверяет основные flows;
- Neon branch topology описана и воспроизводима руками.

## Open Questions

- хотим ли отдельный Neon project для sandbox или достаточно branch внутри существующего проекта;
- нужен ли schema-only branch для полной изоляции от production data;
- делать ли `LLM_MODE=fake` жестко обязательным в sandbox или оставлять opt-in `real` для ручных экспериментов;
- нужен ли отдельный deploy target для `hiring-agent` UI и для background poll/sender workers.
