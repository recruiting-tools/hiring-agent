# `vacancy_id -> job_id` Rollout Runbook

Дата: 2026-04-16  
Статус: active

## Purpose

Зафиксировать финальный rollout и cleanup sequence для миграции:

- внешний canonical identifier: `job_id`
- внутренний recruiter setup/runtime key: `job_setup_id`
- `vacancy_id` только legacy compatibility alias

## Current Canonical Rules

- recruiter-facing API, UI state, websocket payloads и report links используют `job_id`
- internal runtime/setup identity использует `job_setup_id`
- `vacancy_id` остается только для:
  - чтения старых session/context payloads
  - legacy adapter paths
  - provider-specific semantics, где `vacancy` является внешним термином

## Remaining Legacy Surface

Допустимо оставить `vacancy_id` только в этих зонах:

- `chatbot.vacancies` storage/model как compatibility alias до cleanup release
- `management.playbook_sessions.vacancy_id` как переходное поле рядом с `job_setup_id`
- HH/provider adapters и fixture data, где upstream contract реально оперирует vacancy ids
- read compatibility для старых snapshot/session payloads
- legacy playbook key aliases `write_vacancy_text` / `vacancy-text` / `vacancy_text`, которые canonicalize-ятся в `view_vacancy`

Нельзя использовать `vacancy_id` как canonical key в новых:

- recruiter UI state
- `/api/jobs` payloads
- websocket canonical requests
- report links
- новых межсервисных contracts

## Release Sequence

### Release A: expand

- schema уже принимает `job_id` + `job_setup_id`
- приложение поддерживает mixed mode
- canonical recruiter path уже работает через `job_id`

### Release B: cutover hardening

- проверить, что canonical client paths не отправляют только `vacancy_id`
- убедиться, что `/api/jobs` всегда возвращает `job_id`
- убедиться, что report links строятся через `job_id`
- убедиться, что websocket/chat requests принимают `job_id` без `vacancy_id`

### Release C: cleanup

Делать только после выдержанного compatibility window.

Порядок:

1. Удалить legacy reads, которые больше не нужны canonical clients.
2. Удалить deprecated aliases из app-level serializers, если все сохранённые snapshot paths мигрированы.
3. Удалить legacy `vacancy_id` columns/views/adapters только отдельной forward migration.
4. После cleanup повторить sandbox and pre-prod smoke тем же SHA.

## Neon Validation Flow

Для любого cleanup/schema шага:

1. Создать ephemeral branch от `sandbox`.
2. Если change рискованный по данным или constraints, дополнительно создать ephemeral branch от `main`.
3. Прогнать migrations.
4. Прогнать validation queries.
5. Прогнать app smoke на том же SHA.
6. Только после этого выкатывать тот же SHA в `sandbox-3`, затем в prod.

## Validation Queries

Проверить, что canonical rows не потеряли `job_id`:

```sql
SELECT COUNT(*) AS rows_missing_job_id
FROM chatbot.vacancies
WHERE status <> 'archived'
  AND job_id IS NULL;
```

Проверить, что recruiter runtime key не потерян:

```sql
SELECT COUNT(*) AS rows_missing_job_setup_id
FROM management.playbook_sessions
WHERE status = 'active'
  AND COALESCE(job_setup_id, vacancy_id) IS NULL;
```

Проверить, что runtime sessions не расходятся по identity:

```sql
SELECT session_id, tenant_id, recruiter_id, job_id, job_setup_id, vacancy_id
FROM management.playbook_sessions
WHERE status = 'active'
  AND job_id IS NULL;
```

## Required Smoke Matrix

- `GET /api/jobs`: every recruiter-visible row has `job_id`
- recruiter selector persists and restores by `job_id`
- websocket request with only `jobId` succeeds
- communication plan markdown uses `job_id` report links
- `/chat/communication-examples?job_id=...` succeeds
- legacy `vacancy_id` path still resolves during compatibility window

## Final Cleanup Gate

Cleanup migration can ship only when:

- CI passed on PR SHA
- ephemeral Neon validation passed
- `sandbox-3` deploy of the same SHA passed
- auth/websocket/UI smoke passed on `sandbox-3`
- no canonical client path still requires `vacancy_id`
