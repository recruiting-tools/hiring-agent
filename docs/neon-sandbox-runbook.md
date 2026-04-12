# Neon Sandbox Runbook

Дата: 2026-04-12
Статус: active

## Purpose

Этот runbook фиксирует рабочую схему Neon branches для `hiring-agent`: production parent branch, постоянная `sandbox` branch и временные `pr-<N>` branches для preview и risky migrations.

## Neon Project Topology

| Project name | Project ID | Branch name | Branch ID | Endpoint hostname |
| --- | --- | --- | --- | --- |
| `v2-dev-client` | `round-leaf-16031956` | `main` | `br-soft-block-an1vqw6o` | `ep-restless-rice-annryvpb-pooler.c-6.us-east-1.aws.neon.tech` |
| `v2-dev-client` | `round-leaf-16031956` | `sandbox` | `br-dry-river-anv7f0z0` | `ep-cold-heart-anca4sk3-pooler.c-6.us-east-1.aws.neon.tech` |
| `v2-management-db` | `orange-silence-65083641` | n/a | n/a | n/a |
| `hiring-agent-prod` | `shiny-darkness-67314937` | production branch only | n/a | n/a |

Org ID: `org-bold-wave-46400152`

## Recommended Topology

- `main`: production parent branch
- `sandbox`: постоянная demo/regression branch
- `pr-<N>`: короткоживущая branch для risky migration, preview и smoke before merge

## Principles

- schema source of truth живет в migrations репозитория;
- `sandbox` branch создается от production parent branch, но дальше живет изолированно;
- drift в `sandbox` не чинится вручную, branch пересобирается через delete + recreate;
- preview branches живут недолго и удаляются после merge/review.

## What Neon Branches Give Us

- быстрые изолированные копии схемы и данных;
- безопасный прогон миграций;
- удобный reset flow для `sandbox`;
- отдельные connection strings/endpoints под каждую branch;
- возможность временных веток под feature rollout.

## What Neon Branches Do Not Replace

- migrations;
- seed scripts;
- smoke tests;
- release gate;
- review процесса.

## Suggested Environment Variables

- `PROD_DATABASE_URL`
- `SANDBOX_DATABASE_URL`
- `SANDBOX_PARENT_BRANCH=main`
- `SANDBOX_BRANCH_NAME=sandbox`
- `NEON_PROJECT_ID=round-leaf-16031956`
- `NEON_API_KEY=<secret>`

## Naming Conventions

- `sandbox` = постоянная branch для demo/regression.
- `pr-<N>` = временная branch, привязанная к конкретному PR number.
- TTL для `pr-<N>` = удалить branch после merge или close PR.

## Sandbox Lifecycle

### Create sandbox branch

1. Создать branch `sandbox` от production branch.
2. Получить новый endpoint / connection string.
3. Прогнать migrations.
4. Выполнить `pnpm seed:sandbox`.
5. Выполнить `pnpm smoke:sandbox`.

### Reset sandbox branch

1. Остановить sandbox deploy или перевести его в maintenance window.
2. Delete + recreate branch от production parent.
3. Обновить connection string при необходимости.
4. Прогнать migrations.
5. Заново выполнить `pnpm seed:sandbox`.
6. Заново выполнить `pnpm smoke:sandbox`.

### Create ephemeral preview branch

1. Создать `pr-123` branch от `sandbox`.
2. Прогнать migrations конкретной ветки кода.
3. Прогнать targeted tests и smoke.
4. После merge удалить branch.

## Operational Rules

- не подключать production сервисы к `sandbox` или `pr-*` branch;
- не использовать production credentials в sandbox;
- synthetic demo data only;
- feature flags `hh_send` и `hh_import` по умолчанию отключены в sandbox;
- любая live интеграция должна быть явным opt-in.

## Recommended Process For Schema Changes

1. Разработчик поднимает ephemeral Neon branch.
2. Прогоняет migrations и targeted tests.
3. После merge изменения выкатываются на постоянную `sandbox` branch.
4. После зеленого sandbox gate изменения идут в production.

## Suggested CLI Workflow

Проверить проекты в нужной организации:

```bash
/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl projects list \
  --org-id org-bold-wave-46400152
```

Показать branch list для dev project `v2-dev-client`:

```bash
/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl branches list \
  --project-id round-leaf-16031956
```

Получить pooled connection string для постоянной `sandbox` branch:

```bash
/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl connection-string sandbox \
  --project-id round-leaf-16031956 \
  --pooled
```

Создать ephemeral branch `pr-123` от `sandbox`:

```bash
/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl branches create \
  --project-id round-leaf-16031956 \
  --name pr-123 \
  --parent br-dry-river-anv7f0z0
```

Получить connection string для `pr-123`:

```bash
/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl connection-string pr-123 \
  --project-id round-leaf-16031956 \
  --pooled
```

Удалить ephemeral branch `pr-123` после merge/close:

```bash
/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl branches delete pr-123 \
  --project-id round-leaf-16031956
```

После получения connection string:

```bash
export SANDBOX_DATABASE_URL="postgres://<user>:<password>@ep-cold-heart-anca4sk3-pooler.c-6.us-east-1.aws.neon.tech/<db>?sslmode=require"
DATABASE_URL="$SANDBOX_DATABASE_URL" pnpm exec node scripts/migrate.js
pnpm seed:sandbox
pnpm smoke:sandbox
```

`neonctl` использует `NEON_API_KEY` из shell автоматически.

## Reset/Recreate Sandbox

Если `sandbox` branch получила drift или broken seed, пересоздаем branch вместо ручного ремонта:

1. Удалить текущую `sandbox` branch.
2. Пересоздать `sandbox` от `main`.
3. Получить новый connection string.
4. Прогнать migrations и seed.

```bash
/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl branches delete sandbox \
  --project-id round-leaf-16031956

/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl branches create \
  --project-id round-leaf-16031956 \
  --name sandbox \
  --parent br-soft-block-an1vqw6o

/Users/vova/.nvm/versions/node/v24.13.0/bin/neonctl connection-string sandbox \
  --project-id round-leaf-16031956 \
  --pooled

export SANDBOX_DATABASE_URL="postgres://<user>:<password>@ep-cold-heart-anca4sk3-pooler.c-6.us-east-1.aws.neon.tech/<db>?sslmode=require"
DATABASE_URL="$SANDBOX_DATABASE_URL" pnpm exec node scripts/migrate.js
pnpm seed:sandbox
pnpm smoke:sandbox
```

Если после recreate Neon выдаст новый endpoint hostname, обновить `SANDBOX_DATABASE_URL` в `.env.sandbox.example` и в инфраструктурных secret values до следующего deploy.

## Recovery

Если `sandbox` branch сломалась после миграции или неконсистентного seed:

- не чинить руками по месту;
- delete + recreate branch от parent;
- перепривязать sandbox deploy;
- прогнать migrations + seed + smoke.
