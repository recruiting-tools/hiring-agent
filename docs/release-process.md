# Release Process

## Flow

```
feature branch
  → pnpm gate:sandbox (локально, до PR)
  → gh pr create (с ci-callback URL)
  → CI: sandbox-gate (автоматически)
      → impact-check (advisory)
      → gate: pnpm test:sandbox + pnpm smoke:sandbox
      → migration-check (ephemeral Neon branch если есть .sql)
      → notify-session (POST ci-callback URL из PR body)
  → merge в main
  → CI: deploy-prod (автоматически)
      → deploy к Cloud Run
      → post-deploy smoke
```

## Команды (локально, до PR)

```bash
pnpm gate:sandbox          # test:sandbox + smoke:sandbox — обязательно перед PR

# Если есть schema changes:
./scripts/create-feature-branch.sh pr-my-feature   # создать ephemeral Neon branch
# прогнать миграцию вручную
# удалить branch
```

## CI checks (GitHub Actions)

| Check | Trigger | Блокирует merge |
|-------|---------|-----------------|
| `sandbox-gate / gate` | push + PR to main | да |
| `sandbox-gate / migration-check` | push + PR to main | нет (advisory) |
| `deploy-prod` | push to main | только post-deploy smoke |

Branch protection rule: merge в main требует `sandbox-gate / gate: success`.

## CI callback для сессий

Чтобы сессия получила уведомление о результате CI, включи в тело PR:

```
<!-- ci-callback: https://RELAY_URL/api/sessions/SESSION_ID/reply -->
```

После завершения `sandbox-gate` CI отправит POST на этот URL:
```json
{ "message": "CI sandbox-gate: success | failure\nRun: https://github.com/..." }
```

`RELAY_URL` — публичный endpoint session manager relay (настраивается отдельно).

## Secrets (GitHub repo settings)

| Secret | Описание |
|--------|----------|
| `SANDBOX_DATABASE_URL` | Neon sandbox branch connection string |
| `SESSION_SECRET` | Demo session secret |
| `NEON_API_KEY` | Neon API key для ephemeral branches |
| `GOOGLE_CREDENTIALS` | GCP service account JSON для deploy |
| `DEPLOY_PUBLIC_URL` | Prod Cloud Run URL для post-deploy smoke |

## Impact check

`scripts/impact-check.js` запускается в CI перед тестами. Выводит список зон риска
(например: schema change → "run ephemeral Neon branch first"). Не блокирует.
