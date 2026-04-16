# Job Setup Post-Epic RFC

**Status:** proposed
**Follows:** `#155 job_setup cleanup release`

## Goal

Дожать cleanup после `job_id` / `job_setup` cutover без risky storage surgery в tenant DB.

К этому моменту:
- внешний canonical contract уже `job_id`
- внутренний runtime key уже `job_setup_id`
- runtime context уже умеет работать через `job_setup`

Остаточный долг сейчас в основном не в storage, а в prompt/context surface и legacy compatibility mirrors.

## What Is Still Legacy

Остались три класса легаси:

1. Prompt/context naming
- `raw_vacancy_text` ещё используется в seeded playbooks, tests и части runtime paths
- `context.vacancy` ещё встречается в prompt templates и interpolation tests

2. Compatibility mirrors
- `context.vacancy`
- `context.raw_vacancy_text`

Они ещё нужны, но уже не должны быть canonical authoring surface.

3. Storage cleanup candidates
- остаточный `vacancy_id` в management/runtime storage
- возможный будущий cleanup `chatbot.vacancies.vacancy_id`

Это уже отдельный release class, потому что там выше rollback risk.

## Proposed Release Order

### Phase 1. Canonical Prompt Surface

Цель:
- сделать `context.job_setup` и `raw_job_setup_text` canonical authoring surface для playbooks, prompts, docs и tests
- сохранить `context.vacancy` и `raw_vacancy_text` как compatibility mirrors

В scope:
- `data/playbooks-seed.json`
- prompt/interpolation tests
- runtime docs/specs
- targeted integration tests around `create_vacancy`

Не делаем:
- physical storage cleanup
- removal of compatibility mirrors

### Phase 2. Compatibility Mirror Retirement

Цель:
- перестать писать новый код и новые prompts через `context.vacancy` / `raw_vacancy_text`
- начать удалять runtime reads, которые still mention these keys directly

В scope:
- `services/hiring-agent/src/app.js`
- helper reads in non-playbook code
- remaining tests that still assert old keys first

Предусловие:
- seeded playbooks и prompt templates уже canonicalized

### Phase 3. Storage Cleanup RFC / Migration

Цель:
- оценить, нужен ли вообще physical drop legacy fields

Вопросы:
- нужен ли `vacancy_id` как stable provider/storage mapping key в tenant DB
- можно ли безопасно удалить fallback fields в management/session storage
- какие persisted payloads ещё могут зависеть от старого shape

Выход:
- отдельный migration RFC, а не patch-in-place

## Recommended Next Task

Первый безопасный follow-up:

**Title**
`canonicalize playbook prompt/context surface to job_setup`

**Step plan**
1. Перевести seeded playbooks с `raw_vacancy_text` на `raw_job_setup_text`.
2. Перевести prompt templates с `context.vacancy` на `context.job_setup`.
3. Обновить interpolation/unit/integration tests под новый canonical shape.
4. Оставить compatibility mirrors нетронутыми.
5. Прогнать `pnpm test:hiring-agent`.

## Acceptance Criteria

- новые prompt templates не используют `context.vacancy` как canonical source
- новые prompt templates не используют `raw_vacancy_text` как canonical source
- `context.job_setup` и `raw_job_setup_text` documented as canonical internal surface
- compatibility mirrors всё ещё работают для persisted old contexts

## Non-Goals

- не меняем recruiter-facing naming `create_vacancy` / `view_vacancy`
- не трогаем HH/provider vacancy semantics
- не делаем destructive SQL cleanup в этом шаге
