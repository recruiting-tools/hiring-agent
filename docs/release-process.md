# Release Process

Короткий operational чеклист для агент-сессий держим в [`README.md`](../README.md) → раздел `PR From Session (Коротко)`.
Этот документ оставляем как расширенную схему процесса.

## Current CI/CD Map (2026-04-14)

| Workflow | File | Trigger | Purpose |
|---|---|---|---|
| `Sandbox Release Gate` | `.github/workflows/sandbox-release-gate.yml` | push в non-main, PR в `main` | test gate + migration check + hiring-agent sandbox chat smoke + callback в сессию |
| `PR Hygiene` | `.github/workflows/pr-hygiene.yml` | PR в `main` | блокирует merge если branch отстал от `main` |
| `Single PR Owner` | `.github/workflows/pr-single-owner.yml` | PR в `main` | блокирует merge если в PR >1 commit author |
| `PR Merge Bot` | `.github/workflows/pr-merge-bot.yml` | label/sync/schedule | auto-merge PR с label `automerge`, когда все required checks зелёные |
| `Deploy to Production` | `.github/workflows/deploy-prod.yml` | push в `main` | deploy `candidate-chatbot` в Cloud Run + smoke |
| `Deploy hiring-agent to VM` | `.github/workflows/deploy-hiring-agent.yml` | push в `main` (path-filter), manual dispatch | deploy `hiring-agent` на VM (prod) + VM/public smoke |
| `Deploy hiring-agent to sandbox slot` | `.github/workflows/deploy-hiring-agent-sandbox-slot.yml` | manual dispatch | deploy выбранного ref в `sandbox-1/2/3` |

## Flow

```text
feature branch
  -> pnpm gate:sandbox (локально)
  -> PR в main (+ ci-callback при необходимости)
  -> CI checks: gate + hygiene + single-owner
  -> merge
  -> main deploy workflows (Cloud Run / VM)
```

## `job_id` Migration Gate

Для миграции `vacancy_id -> job_id` считаем release готовым только если canonical recruiter path уже не зависит от `vacancy_id`:

- `/api/jobs` и UI selector работают по `job_id`
- websocket/chat canonical requests проходят с `job_id` без обязательного `vacancy_id`
- report links строятся через `job_id`

Подробный rollout, validation queries и cleanup sequence держим в [`docs/job-id-migration-runbook.md`](./job-id-migration-runbook.md).

## Команды (локально, до PR)

```bash
pnpm gate:sandbox          # test:sandbox + smoke:sandbox — обязательно перед PR

# Если есть schema changes:
./scripts/create-feature-branch.sh pr-my-feature   # создать ephemeral Neon branch
# прогнать миграцию вручную
# удалить branch
```

## Required Checks For Merge

| Check name | Source workflow | Блокирует merge |
|-------|---------|-----------------|
| `gate` | `Sandbox Release Gate` | да |
| `up-to-date-with-main` | `PR Hygiene` | да |
| `single-owner` | `Single PR Owner` | да |

Advisory checks:

- `impact-check` (риск-анализ по изменённым зонам)
- `migration-check` (ephemeral Neon branch при schema-change в `services/candidate-chatbot/migrations/`)

Для cleanup release по `job_id` migration перед merge дополнительно проверить:

- validation queries из `docs/job-id-migration-runbook.md`
- recruiter smoke matrix на том же SHA

## Sandbox Slots (`sandbox-1/2/3`)

`Deploy hiring-agent to sandbox slot` использует **GitHub Environments**:

- `sandbox-1`
- `sandbox-2`
- `sandbox-3`

На уровне каждого environment заданы:

- `SANDBOX_PUBLIC_URL`
- `VM_HOST`
- `VM_USER`

Общие для всех слотов секреты берутся из repo secrets:

- `VM_SSH_KEY`
- `MANAGEMENT_DATABASE_URL`
- `OPENROUTER_API_KEY`

Текущая модель: слоты могут смотреть на одну и ту же sandbox DB/control-plane.
Это допустимо для быстрых UI/Playwright прогонов, но для рискованных миграций
используй отдельную ephemeral Neon branch.

## QA Credentials Policy (Sessions + MCP Playwright)

В git храним только шаблоны и имена env-переменных, не реальные пароли.

- шаблон: `.env.sandbox.example`
- рабочие значения: GitHub Secrets / локальный `.env.local` / shell env

Минимальные env для автотест-сессии:

- `SANDBOX_PUBLIC_URL` (или target URL конкретного слота)
- `SANDBOX_DEMO_EMAIL`
- `SANDBOX_DEMO_PASSWORD`

Для MCP Playwright в сессии используем те же креды, что и для `smoke:sandbox`.
Новый пароль публикуется только в секретах и в runtime env, не в repo.

## CI callback для сессий

Чтобы сессия получила уведомление о результате CI, включи в тело PR:

```html
<!-- ci-callback: https://RELAY_URL/api/sessions/SESSION_ID/reply -->
```

После завершения `sandbox-gate` CI отправит POST на этот URL:
```json
{ "message": "CI sandbox-gate: success | failure\nRun: https://github.com/..." }
```

`RELAY_URL` — публичный endpoint session manager relay (настраивается отдельно).

### Быстро добавить callback в существующий PR

```bash
PR_NUM=<номер_pr>
RELAY_URL=<https://...>
SESSION_ID=<session_id>

BODY="$(gh pr view "$PR_NUM" --json body -q .body)"
printf "%s\n\n<!-- ci-callback: %s/api/sessions/%s/reply -->\n" \
  "$BODY" "$RELAY_URL" "$SESSION_ID" | gh pr edit "$PR_NUM" --body-file -
```

Проверка:
1. Запусти/дождись `sandbox-gate`.
2. Убедись, что в сессию пришло сообщение с `success|failure` и ссылкой на run.

Ограничение:
- Этот callback в текущем workflow отправляет CI-результаты.
- Review comments/threads из GitHub требуют отдельного webhook relay (это не покрывается одним `ci-callback` маркером).

## Secrets (GitHub repo settings)

| Secret | Описание |
|--------|----------|
| `SANDBOX_DATABASE_URL` | Neon sandbox branch connection string |
| `SESSION_SECRET` | Demo session secret |
| `NEON_API_KEY` | Neon API key для ephemeral branches |
| `WORKLOAD_IDENTITY_PROVIDER` | OIDC provider для GitHub Actions |
| `SERVICE_ACCOUNT` | GCP service account email для deploy |
| `DEPLOY_PUBLIC_URL` | Prod Cloud Run URL для post-deploy smoke |
| `PROD_DATABASE_URL` | candidate-chatbot production DB URL |
| `MANAGEMENT_DATABASE_URL` | control-plane DB для `hiring-agent` |
| `OPENROUTER_API_KEY` | LLM routing key для `hiring-agent` |
| `VM_SSH_KEY` | SSH private key для VM deploy workflows |
| `HH_CLIENT_ID` | HH OAuth client id |
| `HH_CLIENT_SECRET` | HH OAuth client secret |
| `HH_REDIRECT_URI` | HH OAuth redirect URI |
| `HH_VACANCY_JOB_MAP` | HH vacancy → job mapping (JSON) |
| `HIRING_AGENT_SANDBOX_URL` | Base URL sandbox-окружения hiring-agent для chat smoke (`https://...`) |
| `HIRING_AGENT_SANDBOX_DEMO_EMAIL` | Demo login email для hiring-agent sandbox smoke |
| `HIRING_AGENT_SANDBOX_DEMO_PASSWORD` | Demo login password для hiring-agent sandbox smoke |

### HH production cutover gating

Перед включением HH sync/send в проде проверь:
- `pnpm check:hh-cutover-readiness` (локальная/операторская валидация)
- `docs/hh-cutover-deploy-runbook-128.md` как первичный source of truth по prereq/gating/rollback

## Impact check

`scripts/impact-check.js` запускается в CI перед тестами. Выводит список зон риска
(например: schema change → "run ephemeral Neon branch first"). Не блокирует.
