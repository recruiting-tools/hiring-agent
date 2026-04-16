# Neon Sandbox Runbook

Дата: 2026-04-12  
Статус: active

## Purpose

Публично-безопасный runbook для Neon branches, без реальных project id, branch id и endpoint hostnames.

## Recommended Topology

- `main`: production parent branch
- `sandbox`: постоянная demo/regression branch
- `pr-<N>`: короткоживущая branch для risky migration, preview и smoke before merge

## Suggested Environment Variables

- `NEON_ORG_ID=<neon-org-id>`
- `NEON_DEV_PROJECT_ID=<dev-project-id>`
- `NEON_MANAGEMENT_PROJECT_ID=<management-project-id>`
- `SANDBOX_PARENT_BRANCH=main`
- `SANDBOX_BRANCH_NAME=sandbox`
- `NEON_API_KEY=<secret>`
- `SANDBOX_DATABASE_URL=<sandbox-connection-string>`

## Principles

- schema source of truth живет в migrations репозитория
- `sandbox` branch создается от production parent branch, но дальше живет изолированно
- drift в `sandbox` не чинится вручную, branch пересобирается через delete + recreate
- preview branches живут недолго и удаляются после merge/review

## Suggested CLI Workflow

Показать проекты:

```bash
neonctl projects list \
  --org-id "$NEON_ORG_ID"
```

Показать branches:

```bash
neonctl branches list \
  --org-id "$NEON_ORG_ID" \
  --project-id "$NEON_DEV_PROJECT_ID"
```

Получить connection string для `sandbox`:

```bash
neonctl connection-string "$SANDBOX_BRANCH_NAME" \
  --org-id "$NEON_ORG_ID" \
  --project-id "$NEON_DEV_PROJECT_ID" \
  --pooled
```

Создать ephemeral branch `pr-123` от `sandbox`:

```bash
neonctl branches create \
  --org-id "$NEON_ORG_ID" \
  --project-id "$NEON_DEV_PROJECT_ID" \
  --name pr-123 \
  --parent "$SANDBOX_BRANCH_NAME"
```

Удалить ephemeral branch:

```bash
neonctl branches delete pr-123 \
  --org-id "$NEON_ORG_ID" \
  --project-id "$NEON_DEV_PROJECT_ID"
```

После получения connection string:

```bash
export SANDBOX_DATABASE_URL="postgres://<user>:<password>@<host>/<db>?sslmode=require"
DATABASE_URL="$SANDBOX_DATABASE_URL" pnpm exec node scripts/migrate.js
pnpm seed:sandbox
pnpm smoke:sandbox
```

## Reset/Recreate Sandbox

Если `sandbox` branch получила drift или broken seed:

1. Удалить текущую `sandbox` branch
2. Пересоздать `sandbox` от `main`
3. Получить новый connection string
4. Прогнать migrations и seed

```bash
neonctl branches delete "$SANDBOX_BRANCH_NAME" \
  --org-id "$NEON_ORG_ID" \
  --project-id "$NEON_DEV_PROJECT_ID"

neonctl branches create \
  --org-id "$NEON_ORG_ID" \
  --project-id "$NEON_DEV_PROJECT_ID" \
  --name "$SANDBOX_BRANCH_NAME" \
  --parent "$SANDBOX_PARENT_BRANCH"

neonctl connection-string "$SANDBOX_BRANCH_NAME" \
  --org-id "$NEON_ORG_ID" \
  --project-id "$NEON_DEV_PROJECT_ID" \
  --pooled
```

Если после recreate Neon выдает новый endpoint hostname, обновите соответствующие secret values и локальные `.env` overrides до следующего deploy.
