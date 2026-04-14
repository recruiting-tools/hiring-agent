# Change Request: Communication Plan UX + Postgres Contract

## Date
- 2026-04-14

## Branch
- `feat/postgres-communication-plan-single-scenario`

## Problem
- `setup_communication` выдавал 2-3 варианта вместо одного прикладного плана.
- План не выглядел как рабочая таблица для рекрутера.
- Не было корректной обработки состояния “уже настроено”.
- Кнопка сохранения не фиксировала сценарий как явный контракт по вакансии в Postgres.
- Примеры первого сообщения не были привязаны к версии сценария.

## Requested UX
- Один сценарий в таблице: `Шаг | Кол-во напоминалок | Комментарий`.
- Кнопки:
  - `Сохранить настройку`
  - `Поправить`
  - `Сгенерировать примеры общения по этому сценарию коммуникаций`
- Если уже настроено: явно сообщить и показать текущий сценарий.

## Data Contract (chatbot.vacancies)
- `communication_plan JSONB` — сохраненный сценарий:
  - `{ scenario_title, goal, steps: [{ step, reminders_count, comment }] }`
- `communication_plan_draft JSONB` — черновик сценария (тот же контракт).
- `communication_examples JSONB` — примеры первого сообщения:
  - `[{ title, message }]`
- `communication_examples_plan_hash TEXT` — SHA-256 от плана, по которому сгенерированы примеры.
- `communication_plan_updated_at TIMESTAMPTZ` — отметка сохранения сценария.

## DB Validation
- Check constraints для `communication_plan` и `communication_plan_draft`:
  - JSON-object,
  - обязательные ключи `scenario_title`, `goal`, `steps`,
  - `steps` — массив длиной 4..7.
- Check constraint для `communication_examples`:
  - JSON-array.

## Behavioral Changes
- `setup_communication` возвращает структурированный `reply.kind = communication_plan`.
- При наличии сохраненного сценария (и отсутствии команды “Поправить”) показывается “Уже настроено...”.
- `Сохранить настройку` переносит `communication_plan_draft -> communication_plan`.
- Примеры показываются только если `communication_examples_plan_hash` совпадает с hash текущего плана.
- При несовпадении hash примеры не отображаются (защита от stale content).
- Текст третьей кнопки стабилен и не меняется по состоянию.
- Добавлены few-shot примеры в входные промпты для более стабильного структурированного JSON-ответа.
- Добавлен per-playbook model override:
  - `OPENROUTER_SETUP_COMMUNICATION_PLAN_MODEL`
  - `OPENROUTER_SETUP_COMMUNICATION_EXAMPLES_MODEL`

## Files Changed
- `services/hiring-agent/src/playbooks/communication-plan.js`
- `services/hiring-agent/src/app.js`
- `services/hiring-agent/src/http-server.js`
- `services/candidate-chatbot/migrations/012_vacancy_communication_plan.sql`
- `tests/unit/hiring-agent-communication-plan.test.js`
- `package.json`

## Verification
- `pnpm test:hiring-agent`
- Result: pass, failures: 0, skipped: 2 (env-dependent integration skips)
