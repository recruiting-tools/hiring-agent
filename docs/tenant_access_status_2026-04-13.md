# Tenant Access Status

Date: 2026-04-13
Status: Active
Scope: PR #15 `feat/tenant-access-layers`

## Purpose

This document summarizes the current state of the tenant / recruiter access migration for `hiring-agent`.

It answers:

- what is already implemented
- what was explicitly deferred
- what still blocks production readiness
- what should be done next

## Current Decision Set

These decisions are already fixed for the current implementation slice:

- `management_db` is the control plane for `hiring-agent`
- `tenant_id` is the canonical control-plane term
- legacy tenant DB tables still use `client_id`
- mapping during migration is `client_id = tenant_id`
- recruiter email is globally unique in `management.recruiters`
- explicit demo mode is required via `APP_MODE=demo`
- non-demo startup requires `MANAGEMENT_DATABASE_URL`
- phase 1 supports `shared_db` and `dedicated_db`
- phase 1 does not support `shared_schema`
- tenant DB routing uses `management.database_connections`
- MVP stores raw `connection_string` there
- `seed-dev-db.js`, `seed-sandbox-db.js`, and `seed-prod-db.js` remain tenant-operational seed scripts in this PR
- `bootstrap-demo-user.js` is the canonical demo auth bootstrap path for `hiring-agent`

## Implemented

### 1. Specs and Roadmap

Added:

- [tenat_recruiter_access_via_layers_13_apr.md](/Users/vova/Documents/GitHub/hiring-agent/docs/tenat_recruiter_access_via_layers_13_apr.md)
- [tenant_recruiter_access_implementation_roadmap_13_apr.md](/Users/vova/Documents/GitHub/hiring-agent/docs/tenant_recruiter_access_implementation_roadmap_13_apr.md)
- [management_db_rollout_checklist_2026-04-13.md](/Users/vova/Documents/GitHub/hiring-agent/docs/management_db_rollout_checklist_2026-04-13.md)

These documents now define:

- control plane vs data plane
- canonical entities
- runtime access resolution
- migration ordering
- bootstrap/tooling boundary
- explicit demo-mode policy

### 2. Management Schema

Added:

- [001_tenant_recruiter_access.sql](/Users/vova/Documents/GitHub/hiring-agent/migrations/management/001_tenant_recruiter_access.sql)

Created schema:

- `management.tenants`
- `management.recruiters`
- `management.sessions`
- `management.database_connections`
- `management.tenant_database_bindings`

Implemented constraints:

- status checks for tenants and recruiters
- role check for recruiters
- exactly-one-source check for database connections
- environment and binding-kind checks for bindings
- primary-binding partial unique index
- sessions cleanup indexes

### 3. Management Migration Entry Point

Added:

- [scripts/migrate-management.js](/Users/vova/Documents/GitHub/hiring-agent/scripts/migrate-management.js)
- [scripts/lib/run-migrations.js](/Users/vova/Documents/GitHub/hiring-agent/scripts/lib/run-migrations.js)

Current split:

- tenant DB migrations: `scripts/migrate.js`
- management DB migrations: `scripts/migrate-management.js`

### 4. Shared Access Context Package

Added:

- [packages/access-context](/Users/vova/Documents/GitHub/hiring-agent/packages/access-context)

Implemented:

- structured access-context errors
- management store
- pool registry
- `resolveAccessContext()`

Implemented error handling:

- `ERROR_UNAUTHENTICATED`
- `ERROR_RECRUITER_SUSPENDED`
- `ERROR_TENANT_SUSPENDED`
- `ERROR_BINDING_MISSING`
- `ERROR_DATABASE_CONNECTION_UNAVAILABLE`

### 5. Hiring Agent Runtime Contract

Updated:

- [services/hiring-agent/src/index.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/index.js)

Implemented:

- explicit runtime resolver
- `APP_MODE=demo` for demo startup
- `MANAGEMENT_DATABASE_URL` required outside demo
- startup mode logging

### 6. Hiring Agent Auth Path

Updated:

- [services/hiring-agent/src/auth.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/auth.js)
- [services/hiring-agent/src/http-server.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/http-server.js)

Current behavior:

- auth sessions read from `management.sessions`
- recruiter lookup reads from `management.recruiters`
- session renewal still works
- management-backed session / recruiter lookups now reuse shared `createManagementStore()` queries instead of keeping a second SQL copy in `auth.js`
- invalid JSON now returns `400 invalid_json`
- demo-mode unauthorized path is explicit and no longer relies on accidental TypeError handling

### 7. Tenant-Scoped Reads

Updated:

- [services/hiring-agent/src/app.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/app.js)
- [services/hiring-agent/src/data/funnel-adapter.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/data/funnel-adapter.js)
- [services/hiring-agent/src/playbooks/candidate-funnel.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/playbooks/candidate-funnel.js)

Implemented:

- `tenantSql` and `tenantId` flow through request path
- `job_id` is pre-validated against tenant ownership before funnel query
- funnel query itself is tenant-scoped via `client_id = tenantId`

### 8. Bootstrap Tooling

Added:

- [scripts/bootstrap-management-tenants.js](/Users/vova/Documents/GitHub/hiring-agent/scripts/bootstrap-management-tenants.js)
- [scripts/bootstrap-management-recruiters.js](/Users/vova/Documents/GitHub/hiring-agent/scripts/bootstrap-management-recruiters.js)
- [scripts/bootstrap-database-bindings.js](/Users/vova/Documents/GitHub/hiring-agent/scripts/bootstrap-database-bindings.js)

Updated:

- [scripts/bootstrap-demo-user.js](/Users/vova/Documents/GitHub/hiring-agent/scripts/bootstrap-demo-user.js)
- [scripts/neon-sandbox-branch.sh](/Users/vova/Documents/GitHub/hiring-agent/scripts/neon-sandbox-branch.sh)

Current bootstrap truth:

- demo user bootstrap now writes to `management.*`
- old env names still work as transitional fallback
- preferred env name is `MANAGEMENT_DATABASE_URL`
- rerun safety is now handled for `bind-all`
- tenant bootstrap now fails explicitly if source `management.clients` is missing
- recruiter bootstrap now skips duplicate-email rows with warnings instead of aborting the whole run

### 9. Deploy / Dev Wiring

Updated:

- [package.json](/Users/vova/Documents/GitHub/hiring-agent/package.json)
- [services/hiring-agent/ecosystem.config.cjs](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/ecosystem.config.cjs)
- [.github/workflows/deploy-hiring-agent.yml](/Users/vova/Documents/GitHub/hiring-agent/.github/workflows/deploy-hiring-agent.yml)
- [scripts/deploy-hiring-agent.sh](/Users/vova/Documents/GitHub/hiring-agent/scripts/deploy-hiring-agent.sh)

Current contract:

- local dev defaults to demo unless caller sets `APP_MODE` differently
- deploy writes `MANAGEMENT_DATABASE_URL` into VM `.env`
- post-deploy smoke expects `mode=management-auth`

### 10. Test Coverage

Added / updated tests:

- [tests/unit/access-context.test.js](/Users/vova/Documents/GitHub/hiring-agent/tests/unit/access-context.test.js)
- [tests/unit/hiring-agent-runtime.test.js](/Users/vova/Documents/GitHub/hiring-agent/tests/unit/hiring-agent-runtime.test.js)
- [tests/unit/hiring-agent-auth.test.js](/Users/vova/Documents/GitHub/hiring-agent/tests/unit/hiring-agent-auth.test.js)
- [tests/integration/hiring-agent.test.js](/Users/vova/Documents/GitHub/hiring-agent/tests/integration/hiring-agent.test.js)
- [tests/integration/access-context-postgres.test.js](/Users/vova/Documents/GitHub/hiring-agent/tests/integration/access-context-postgres.test.js)
- [tests/helpers/management-fixtures.js](/Users/vova/Documents/GitHub/hiring-agent/tests/helpers/management-fixtures.js)

Covered now:

- runtime boot contract
- access-context resolver happy path
- suspended recruiter
- disabled recruiter
- suspended/archived tenant
- missing binding
- missing connection row
- missing connection string
- invalid JSON request handling
- demo unauthorized path
- tenant job ownership pre-validation
- management-backed HTTP request path
- management-backed isolation between two recruiter sessions with different tenants
- opt-in Postgres management fixture path

## Explicitly Deferred

These items were considered but intentionally not done in this slice:

- Secret Manager lookup for `db_alias -> secret_name -> connection_string`
- `shared_schema` binding implementation
- candidate-chatbot full migration to management-backed auth
- generalized RBAC beyond `recruiter` and `admin`
- migration from raw `connection_string` to `secret_name`
- dual-read or token-migration auth cutover strategy
- cross-service packaging cleanup beyond current workspace package
- full docs cleanup across older plans/runbooks

## Not Done Yet

These are the main remaining items before calling the migration slice production-ready.

### 1. Legacy Seed Scripts Still Write Old Auth Data

Current state:

- `seed-dev-db.js`
- `seed-sandbox-db.js`
- `seed-prod-db.js`

These still update `chatbot.recruiters` directly.

Accepted decision in this PR:

- these scripts remain tenant-operational seed scripts
- they are not the canonical control-plane bootstrap path for `hiring-agent`
- `bootstrap-demo-user.js` is the control-plane-oriented demo auth/bootstrap path

What still remains:

- decide later whether to split or replace these scripts as part of a broader `candidate-chatbot` auth migration

Why this stays deferred:

- changing `seed-dev/sandbox/prod` now would couple this PR more tightly to `candidate-chatbot` runtime and legacy fixtures
- that is a broader operational migration than the control-plane slice itself

### 2. End-to-End Management Login Bootstrap on Real DB

Current state:

- management fixtures exist
- management bootstrap scripts exist
- management-backed HTTP path exists
- rollout checklist now exists in [management_db_rollout_checklist_2026-04-13.md](/Users/vova/Documents/GitHub/hiring-agent/docs/management_db_rollout_checklist_2026-04-13.md)

What remains:

- run and verify the full flow on real environment data:
  - migrate management DB
  - bootstrap tenants
  - bootstrap recruiters
  - register connection
  - bind tenant
  - login through `hiring-agent`

### 3. Main Branch Sync and Deploy Validation

Current state:

- branch contains management-db wiring
- `main` also received parallel deploy fixes

What remains:

- reconcile branch against latest `main`
- verify deploy workflow still works after `MANAGEMENT_DATABASE_URL` contract
- verify VM `.env` contains the new key
- verify post-deploy smoke passes with `management-auth`

### 4. Postgres Integration Coverage Still Opt-In

Current state:

- `tests/integration/access-context-postgres.test.js` is present
- it skips cleanly without `V2_DEV_NEON_URL`

What remains:

- decide where this should run in CI or local gates
- if kept opt-in, document that expectation explicitly in release workflow

## Production Readiness Assessment

### Ready

- control-plane schema draft
- management migration tooling
- explicit demo mode contract
- runtime tenant access resolution
- tenant ownership guard for `job_id`
- deploy/runtime env rename to `MANAGEMENT_DATABASE_URL`

### Not Ready

- verified end-to-end real-environment bootstrap
- execution of the rollout checklist on a real environment

## Recommended Next Steps

1. Run the real management bootstrap path on the target environment.
2. After the above, run deploy and smoke against VM with `MANAGEMENT_DATABASE_URL`.

## Quick Readiness Checklist

- [x] management schema exists
- [x] management migration script exists
- [x] access-context package exists
- [x] `hiring-agent` requires explicit demo mode
- [x] `hiring-agent` uses management-backed auth path
- [x] tenant job ownership is validated before funnel query
- [x] deploy writes `MANAGEMENT_DATABASE_URL`
- [x] smoke expects `management-auth`
- [x] legacy seed scripts explicitly remain tenant-operational in this PR
- [x] production rollout checklist for management DB initialization is written
- [x] branch is reconciled with latest `main`
- [ ] production bootstrap path verified end-to-end
