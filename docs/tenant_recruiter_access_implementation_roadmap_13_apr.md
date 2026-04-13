# Tenant / Recruiter Access Implementation Roadmap

Date: 2026-04-13
Status: Draft
Depends on: `docs/tenat_recruiter_access_via_layers_13_apr.md`

## Purpose

This document turns the access-layer spec into an execution plan.

It answers:

- what to build first
- in what order to migrate
- what can ship safely without downtime
- which code paths move first

## Scope

First target service:

- `hiring-agent`

Supporting changes:

- control-plane schema in `management_db`
- shared access-context package
- tenant ownership backfill in shared tenant DB

Out of scope for first rollout:

- full `candidate-chatbot` migration to control-plane access resolution
- Secret Manager indirection for tenant DB resolution
- schema-per-tenant support

Phase-1 binding support:

- `shared_db`
- `dedicated_db`

Not in phase 1:

- `shared_schema`

## Delivery Strategy

Roll out in small slices:

1. introduce control-plane metadata
2. introduce runtime resolver behind a compatibility layer
3. backfill tenant ownership
4. switch `hiring-agent` reads to strict tenant-aware access
5. remove legacy fallbacks

The first production-safe target is:

- `hiring-agent` authenticates via `management_db`
- resolves tenant DB dynamically
- validates `job_id` ownership
- reads funnel data only inside tenant scope

## Phase 0: Freeze New Drift

Goal:

- stop making the current state worse

Actions:

- do not add new app code that reads `V2_DEV_NEON_URL`, `V2_PROD_NEON_URL`, or `SANDBOX_DATABASE_URL`
- do not add new demo fallback based on missing DB env vars
- do not add new tenant-sensitive queries that filter only by `job_id`

Acceptance:

- spec is approved
- new work follows spec vocabulary: `tenant`, `recruiter`, `management_db`, `tenant_db`

Tooling boundary:

- the prohibition on environment-specific tenant DB vars applies to service business logic and shared runtime code
- bootstrap, migration, and admin scripts are deploy tooling and may read tenant DB env vars directly when needed
- this exception must not leak into request-path runtime modules

## Phase 1: Control-Plane Schema in Management DB

Goal:

- create the minimum metadata required to resolve tenant DB access

Create tables:

- `management.tenants`
- `management.recruiters`
- `management.sessions`
- `management.database_connections`
- `management.tenant_database_bindings`

MVP schema decisions:

- new management tables use `tenant_id` from day one
- legacy tenant DB tables keep `client_id` during migration, with explicit mapping `client_id = tenant_id`
- `management.database_connections.connection_string` is allowed
- `management.database_connections.secret_name` remains nullable for now
- `management.recruiters.email` is globally unique
- `management.recruiters.status`, `management.recruiters.role`, and `management.tenant_database_bindings.environment` use DB-enforced allowed values
- `management.recruiters` may mirror data from current tenant DB recruiter rows initially

Initial data setup:

- create one `tenant` row per current `client_id`
- create one `database_connections` row for the current shared tenant DB
- create one primary `tenant_database_binding` per tenant for each active environment
- mirror current recruiters into `management.recruiters`

Migration entrypoint:

- add `scripts/migrate-management.js`
- it runs management migrations against `MANAGEMENT_DATABASE_URL`
- tenant DB migrations remain separate from management migrations

Acceptance:

- for any existing recruiter, `management_db` can answer:
  - who is this recruiter
  - which tenant do they belong to
  - which DB alias should be used in `dev` and `prod`

## Phase 2: Shared Access Context Package

Goal:

- centralize access resolution

Create workspace package:

- `packages/access-context`

Suggested files:

- `packages/access-context/src/index.js`
- `packages/access-context/src/resolve-access-context.js`
- `packages/access-context/src/pool-registry.js`
- `packages/access-context/src/management-store.js`

Responsibilities:

- read session or auth principal from request metadata
- load recruiter from `management_db`
- resolve tenant
- resolve binding for `APP_ENV`
- resolve or create tenant DB pool
- return access context object

Required error contract:

- `ERROR_UNAUTHENTICATED` -> HTTP `401`
- `ERROR_RECRUITER_SUSPENDED` -> HTTP `403`
- `ERROR_TENANT_SUSPENDED` -> HTTP `403`
- `ERROR_TENANT_NOT_FOUND` -> HTTP `503`
- `ERROR_BINDING_MISSING` -> HTTP `503`
- `ERROR_DATABASE_CONNECTION_UNAVAILABLE` -> HTTP `503`

Suggested return shape:

```js
{
  principalType: "recruiter",
  recruiterId: "rec-alpha-001",
  tenantId: "tenant-alpha-001",
  appEnv: "prod",
  binding: {
    dbAlias: "shared-tenant-db-prod",
    bindingKind: "shared_db",
    schemaName: null
  },
  tenantSql
}
```

MVP pool rules:

- one process-wide `managementDb` pool
- one in-process map of tenant DB pools
- pool key: `${appEnv}:${dbAlias}`
- no eviction initially
- process restart is the supported config refresh path

Acceptance:

- a service can call `resolveAccessContext(...)` without knowing tenant DB env vars

## Phase 3: Management-Backed Auth for Hiring Agent

Goal:

- move `hiring-agent` auth off tenant DB recruiter/session tables

Files likely to change:

- `services/hiring-agent/src/index.js`
- `services/hiring-agent/src/auth.js`
- `services/hiring-agent/src/http-server.js`
- new imports from `packages/access-context`

Changes:

- replace startup dependency on `DATABASE_URL` with `MANAGEMENT_DATABASE_URL`
- replace demo fallback boot path with explicit app mode handling
- session lookup reads from `management.sessions`
- recruiter lookup reads from `management.recruiters`
- authenticated request resolves full access context before business logic runs

Compatibility bridge:

- selected strategy: hard cutover with session invalidation
- when `hiring-agent` switches to management-backed auth, existing tenant-DB-backed sessions are considered invalid
- users must log in again after rollout
- do not implement dual-read or token migration in phase 1
- keep the old tenant DB auth tables only as migration source data, not as active runtime read paths

Rationale:

- the product appears to be at an early stage and forced re-login is operationally acceptable
- hard cutover is much simpler and safer than dual-read or token migration

Acceptance:

- `hiring-agent` can serve authenticated requests using only `MANAGEMENT_DATABASE_URL`
- request context contains `tenantSql`, `tenantId`, and `recruiterId`

## Phase 4: Tenant Ownership Backfill in Tenant DB

Goal:

- make strict tenant filtering possible

Tables to backfill first:

- `chatbot.jobs`
- `chatbot.conversations`
- `chatbot.pipeline_runs`
- any other operational table used by `hiring-agent`

Backfill rules:

- if `jobs.client_id` is null, populate from known tenant mapping
- if `conversations.client_id` is null, populate from `jobs.client_id`
- if `pipeline_runs.client_id` is null, populate from `jobs.client_id`

After data backfill:

- add validation queries to confirm no null ownership remains in required tables
- only then prepare `NOT NULL` migrations for the strict path

Important rollout rule:

- strict tenant-aware query enforcement must not be enabled before the required backfill is complete

Acceptance:

- all rows used by `hiring-agent` funnel queries have non-null tenant ownership

## Phase 5: Strict Tenant-Scoped Reads in Hiring Agent

Goal:

- eliminate cross-tenant read risk

Files likely to change:

- `services/hiring-agent/src/app.js`
- `services/hiring-agent/src/data/funnel-adapter.js`
- `services/hiring-agent/src/playbooks/candidate-funnel.js`
- tests covering auth and funnel queries

Required code changes:

- `postChatMessage(...)` accepts tenant context, not just `job_id`
- `getFunnelData(...)` accepts `{ tenantId, jobId }`
- `job_id` is validated against tenant ownership before running funnel query
- all tenant DB reads include tenant filter

Target adapter signature:

```js
getFunnelData(sql, { tenantId, jobId })
```

Target validation pattern:

1. check `job_id` belongs to `tenantId`
2. if not, return `404` or `403`
3. only then query funnel data

Acceptance:

- a recruiter cannot access another tenant's funnel by sending a foreign `job_id`

## Phase 6: Remove Silent Demo Fallback

Goal:

- make runtime failures obvious

Changes:

- `hiring-agent` startup fails if `MANAGEMENT_DATABASE_URL` is missing outside explicit demo mode
- explicit demo mode uses a dedicated code path such as `APP_MODE=demo`
- health endpoint reflects real mode and must not claim healthy DB mode when no control-plane DB exists

Acceptance:

- prod and sandbox no longer start in fake mode because of missing env

## Phase 7: Cleanup and Hardening

Goal:

- reduce migration debt after the first safe rollout

Actions:

- remove old recruiter/session reads from tenant DB paths
- harden ownership columns with `NOT NULL` where ready
- keep global `email` uniqueness enforced in `management.recruiters`
- standardize deploy inputs so app runtime sees:
  - `MANAGEMENT_DATABASE_URL`
  - `APP_ENV`
  - non-DB service secrets

Optional follow-up:

- migrate `management.database_connections` from raw `connection_string` to `secret_name`
- add cached Secret Manager resolution

Acceptance:

- no production service relies on environment-specific tenant DB env vars in business logic

## Concrete First Slice

This is the recommended first implementation slice to actually code.

### Slice A: Metadata + Resolver Skeleton

Build:

- `management.tenants`
- `management.database_connections`
- `management.tenant_database_bindings`
- `packages/access-context` with stub resolver and pool registry

Do not switch request traffic yet.

### Slice B: Hiring Agent Auth Switch

Build:

- `MANAGEMENT_DATABASE_URL` boot path
- `management.recruiters`
- `management.sessions`
- `resolveAccessContext()` wired into request handling

Keep existing tenant DB query logic temporarily, but route DB access through resolved `tenantSql`.

### Slice C: Ownership Backfill + Strict Funnel Query

Build:

- backfill `client_id` in `jobs`, `conversations`, `pipeline_runs`
- update funnel adapter to require tenant context
- add `job_id` ownership validation

This slice closes the main security gap.

## Migration Order

Recommended order of actual commits:

1. add `scripts/migrate-management.js` and management schema migrations
2. add `packages/access-context`
3. add management data bootstrap scripts
4. switch `hiring-agent` startup to `MANAGEMENT_DATABASE_URL`
5. switch `hiring-agent` auth/session lookup to management DB
6. backfill tenant ownership in tenant DB
7. enforce strict tenant-scoped funnel reads
8. remove silent demo fallback

## Bootstrap and Admin Scripts

Add or refactor scripts for:

- creating tenant rows from existing client rows
- registering `database_connections`
- creating tenant bindings per environment
- mirroring recruiters into `management.recruiters`
- rotating recruiter passwords in `management_db`

Suggested script names:

- `scripts/bootstrap-management-tenants.js`
- `scripts/bootstrap-database-bindings.js`
- `scripts/bootstrap-management-recruiters.js`

These scripts should always target `MANAGEMENT_DATABASE_URL` as their control-plane destination.

Exception:

- bootstrap scripts that import existing recruiters or tenant ownership from legacy tenant DBs may also read tenant DB env vars directly
- this is allowed because these scripts are tooling, not request-path business logic

## Testing Plan

### Unit Tests

Add tests for:

- access context resolution
- binding selection by `tenant_id + APP_ENV`
- pool registry reuse
- explicit demo mode behavior
- rolling session renewal behavior

### Integration Tests

Add tests for:

- recruiter session resolves to tenant DB
- `job_id` from foreign tenant is rejected
- funnel query returns only tenant-owned data
- integration fixtures seed both `management_db` and `tenant_db`

Suggested fixture split:

- management fixtures: tenants, recruiters, sessions, database bindings
- tenant fixtures: jobs, conversations, pipeline runs, funnel state

### Migration Verification

Before strict rollout:

- query count of null ownership rows
- query for orphan recruiters
- query for tenants without bindings
- query for recruiters without valid tenant reference

## Operational Notes

Current initial deployment assumption:

- `management_db` remains in its current Neon project
- shared tenant DB remains in its current separate Neon project
- runtime bridges them through management metadata

This avoids a risky data-platform move during the access-layer refactor.

## Risks

1. Hard cutover invalidates existing user sessions and requires re-login immediately after rollout.
2. Backfill mistakes on `client_id` can cause false-deny or false-allow behavior.
3. If `management_db` becomes unavailable, auth resolution blocks tenant access across all services.
4. If pool registry keys are wrong, tenants may share connections incorrectly.

## Mitigations

1. Announce the auth cutover and treat session invalidation as an expected rollout event.
2. Validate ownership backfill with SQL audits before enabling strict filters.
3. Keep resolver and pool code centralized in one package.
4. Use tenant-aware integration tests before rollout.

## Definition of Done for First Milestone

The first milestone is complete when:

- `hiring-agent` boots with `MANAGEMENT_DATABASE_URL`
- authenticated requests resolve `tenantId` and tenant DB binding dynamically
- funnel queries require tenant context
- foreign `job_id` access is rejected
- `hiring-agent` no longer silently falls back to demo mode in sandbox or prod
