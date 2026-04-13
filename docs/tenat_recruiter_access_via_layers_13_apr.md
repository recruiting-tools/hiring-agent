# Tenant / Recruiter Access Via Layers

Date: 2026-04-13
Status: Draft
Owner: hiring-agent

## Purpose

This document defines the target access model for tenant-aware recruiter access across `hiring-agent`, `candidate-chatbot`, and future MCP-facing entrypoints.

The goal is to separate:

- who the user is
- which tenant they belong to
- which physical database holds that tenant's data
- which environment the service is running in

This spec replaces the current mixed model where runtime env vars, demo fallbacks, bootstrap scripts, and tenant access rules are partially encoded in the same layer.

## Problem Statement

The current codebase mixes four concerns:

1. runtime infrastructure configuration
2. application mode selection
3. tenant and recruiter identity
4. operational data access

This leads to several failure modes:

- services choose databases differently
- app code knows environment-specific secret names
- user access is partially enforced in HTTP handlers and partially not enforced in SQL
- demo fallback can mask missing production configuration
- multi-tenant schema exists, but not all writes and reads enforce tenant invariants

## Decision

We adopt a layered access model:

1. `management_db` is the control plane.
2. `tenant_db` is the data plane.
3. `recruiter_id` identifies a user inside a tenant.
4. `tenant_id` identifies the data ownership boundary.
5. runtime services start with access to `management_db` only.
6. operational tenant data access is resolved dynamically per authenticated recruiter session.

This means:

- `DATABASE_URL` must not depend on the logged-in user directly.
- tenant data access may depend on the authenticated recruiter indirectly through tenant resolution.
- app code must not hardcode or fallback between `V2_DEV_NEON_URL`, `V2_PROD_NEON_URL`, `SANDBOX_DATABASE_URL`, and similar env names.

## Terms

### Tenant

The customer or account boundary that owns jobs, candidates, conversations, and pipelines.

Canonical identifier:

- `tenant_id`

Legacy mapping:

- current `client_id` is the same concept and should be migrated toward `tenant_id`

### Recruiter

A user inside a tenant.

Canonical identifier:

- `recruiter_id`

Properties:

- belongs to exactly one `tenant_id`
- authenticates via email/password, SSO, API token, or MCP auth header
- may have roles and feature flags

### Management DB

The control-plane database used for:

- recruiter identity
- sessions
- tenant metadata
- tenant-to-database bindings
- feature flags
- control-plane integrations

### Tenant DB

The operational database holding tenant business data:

- jobs
- candidates
- conversations
- pipeline runs
- pipeline events
- planned messages
- marts and analytics projections

### Environment

The deployment context:

- `local`
- `dev`
- `sandbox`
- `prod`

Environment is a runtime property of the service. It is not a tenant property and not a user property.

## Non-Goals

- full RBAC design
- SSO protocol design
- immediate rename of every `client_id` occurrence in one pass
- forcing every tenant to have a dedicated physical database today

## Architecture Overview

There are two planes.

### Control Plane

Single `management_db`.

Responsible for:

- who is authenticated
- which tenant the user belongs to
- which tenant DB binding is active in the current environment
- which secret or DB alias should be used to open the tenant data connection

### Data Plane

One or more tenant DBs.

A tenant may be hosted in:

- a shared database
- a shared database with isolated schema
- a dedicated database

The runtime contract must support all three without changing auth semantics.

## Layer Model

### Layer 1: Infrastructure Config

This layer answers:

- where are secrets stored
- how to connect to the control plane
- which environment is this service running in

Allowed app-visible config:

- `MANAGEMENT_DATABASE_URL`
- `APP_ENV`
- optional non-data-plane service secrets such as OAuth, LLM, Telegram

Current baseline:

- `management_db` is currently in a different Neon project from the shared tenant DB
- this is acceptable as the initial implementation state
- the architecture does not require control plane and data plane to live in the same Neon project

Not allowed in app business logic:

- `V2_DEV_NEON_URL`
- `V2_PROD_NEON_URL`
- `SANDBOX_DATABASE_URL`
- any environment-specific tenant DB secret names

Those names may exist in deploy tooling or secret manager, but must be resolved before app business code uses them.

### Layer 2: Identity and Access Resolution

This layer answers:

- who is the recruiter
- which tenant do they belong to
- which tenant DB binding applies in the current environment

Inputs:

- cookie session
- bearer token
- MCP auth header
- future service-to-service principal

Output:

```json
{
  "principal_type": "recruiter",
  "recruiter_id": "rec-123",
  "tenant_id": "tenant-456",
  "role": "recruiter",
  "app_env": "prod",
  "tenant_binding": {
    "binding_kind": "shared_db",
    "db_alias": "tenant-db-eu-prod",
    "schema_name": null
  }
}
```

### Layer 3: Tenant-Scoped Data Access

This layer answers:

- what data may this request read or mutate

Rules:

- every operational query must execute against the resolved tenant DB
- every read and write must still preserve tenant scoping inside that DB
- request payload identifiers such as `job_id` must be validated against tenant ownership

If a shared DB is used, tenant filters remain mandatory.

If a dedicated DB is used, tenant filters may still be kept for correctness and easier migrations.

## Canonical Data Model

### Management Schema

#### `management.tenants`

- `tenant_id text primary key`
- `slug text unique not null`
- `display_name text not null`
- `status text not null`
- `created_at timestamptz not null default now()`

Allowed `status` values:

- `active`
- `suspended`
- `archived`

Migration requirement:

- enforce allowed values with a database `CHECK` constraint or enum

#### `management.recruiters`

- `recruiter_id text primary key`
- `tenant_id text not null references management.tenants(tenant_id)`
- `email text not null`
- `password_hash text null`
- `status text not null default 'active'`
- `role text not null default 'recruiter'`
- `created_at timestamptz not null default now()`
- global unique constraint on `(email)`

Allowed `status` values:

- `active`
- `suspended`
- `disabled`

Allowed `role` values:

- `recruiter`
- `admin`

Migration requirement:

- enforce both fields with database `CHECK` constraints or enums

Decision:

- recruiter email is globally unique in phase 1
- login flow remains `email -> recruiter`
- if duplicate email across tenants becomes a real requirement later, auth must be redesigned explicitly rather than left ambiguous

#### `management.sessions`

- `session_token text primary key`
- `recruiter_id text not null references management.recruiters(recruiter_id)`
- `created_at timestamptz not null default now()`
- `expires_at timestamptz not null`

Required indexes:

- primary key on `session_token`
- secondary index on `expires_at` for cleanup jobs

Session policy:

- phase 1 keeps rolling session renewal behavior
- if a valid session is within the renewal window before expiry, the auth layer extends `expires_at`
- renewal window and TTL should remain runtime constants until explicitly moved into config
- expired sessions may be removed by a periodic cleanup job in `management_db`

#### `management.database_connections`

- `db_alias text primary key`
- `secret_name text null`
- `connection_string text null`
- `provider text not null`
- `region text null`
- `status text not null default 'active'`
- `created_at timestamptz not null default now()`

Rules:

- exactly one of `secret_name` or `connection_string` must be present
- production target state prefers `secret_name`
- MVP may use `connection_string` directly to avoid per-request secret-manager lookups

Migration requirement:

- enforce this with a database `CHECK` constraint, for example:

```sql
CONSTRAINT exactly_one_connection_source CHECK (
  ((secret_name IS NOT NULL)::int + (connection_string IS NOT NULL)::int) = 1
)
```

#### `management.tenant_database_bindings`

- `binding_id text primary key`
- `tenant_id text not null references management.tenants(tenant_id)`
- `environment text not null`
- `binding_kind text not null`
- `db_alias text not null references management.database_connections(db_alias)`
- `schema_name text null`
- `is_primary boolean not null default true`
- `created_at timestamptz not null default now()`

Unique constraints:

- at most one primary binding per `(tenant_id, environment)`

Migration requirement:

- enforce this with a partial unique index, for example:

```sql
CREATE UNIQUE INDEX idx_primary_binding
ON management.tenant_database_bindings (tenant_id, environment)
WHERE is_primary = true;
```

`binding_kind` values:

- `shared_db`
- `shared_schema`
- `dedicated_db`

Phase-1 support:

- `shared_db`
- `dedicated_db`

Not supported in phase 1:

- `shared_schema`

Reason:

- `shared_schema` requires dynamic schema qualification in query execution and current service code is not structured for that yet

Allowed `environment` values:

- `local`
- `dev`
- `sandbox`
- `prod`

Migration requirement:

- enforce allowed values with a database `CHECK` constraint or enum

### Tenant Schema

Operational tables stay in tenant DB:

- `chatbot.jobs`
- `chatbot.candidates`
- `chatbot.conversations`
- `chatbot.pipeline_runs`
- `chatbot.pipeline_events`
- `chatbot.pipeline_step_state`
- `chatbot.planned_messages`

Canonical ownership field:

- `tenant_id`

Transition note:

- existing `client_id` may remain during migration
- new code should conceptually treat it as tenant ownership
- new management tables must use `tenant_id` from day one
- legacy tenant DB tables may continue using `client_id` during migration
- explicit mapping for the migration period: `client_id = tenant_id`

## Invariants

The following invariants must hold after migration.

1. Every authenticated recruiter resolves to exactly one `recruiter_id`.
2. Every `recruiter_id` belongs to exactly one `tenant_id`.
3. Every request executes in exactly one `APP_ENV`.
4. For a given `tenant_id + APP_ENV`, there is exactly one primary tenant DB binding.
5. Every operational request is executed with a resolved tenant access context.
6. Every `job_id`, `conversation_id`, `pipeline_run_id`, and similar business identifier must be validated against tenant ownership before use.
7. Missing data-plane configuration must fail closed in non-demo environments.
8. Demo mode must be explicit and must never activate only because a DB env var is absent.

## Runtime Resolution Flow

### Web Request

1. service starts with `MANAGEMENT_DATABASE_URL`
2. request arrives with session cookie
3. service resolves session in `management.sessions`
4. service loads recruiter from `management.recruiters`
5. service derives `tenant_id`
6. service resolves tenant DB binding from `management.tenant_database_bindings` using `tenant_id + APP_ENV`
7. service resolves `db_alias -> connection details`
8. service opens or reuses a pool for that tenant DB
9. service executes tenant-scoped business logic

Step 7 details:

- MVP: read `connection_string` from `management.database_connections` directly
- target: resolve `secret_name -> connection_string` through a cached secret-resolution path

### MCP Request

1. MCP gateway passes auth header
2. auth layer resolves recruiter principal
3. recruiter resolves to `tenant_id`
4. tenant binding resolves to tenant DB
5. MCP tool execution runs only within that tenant access context

This matches the target model where auth is passed in headers and the agent should receive tenant-safe access implicitly.

### Connection Details Resolution

There are two implementation modes.

#### MVP Mode

- `management.database_connections` stores `connection_string`
- service reads connection details from `management_db`
- no Secret Manager lookup occurs on request path

This is the recommended first implementation because it keeps request latency predictable and avoids adding a new control-plane dependency during access-layer refactor.

#### Target Mode

- `management.database_connections` stores `secret_name`
- runtime resolves `secret_name -> connection_string`
- resolved connection string is cached in-process together with the pool registry

Rules for target mode:

- Secret Manager lookup must not happen on every request
- lookup occurs only on first use, cache miss, or explicit cache invalidation
- pool creation is tied to cached resolved connection details

For the current phase, MVP mode is approved.

### Resolver Error Contract

`resolveAccessContext()` must fail with structured errors rather than returning partial context.

Minimum contract:

- `ERROR_UNAUTHENTICATED` -> HTTP `401`
- `ERROR_RECRUITER_SUSPENDED` -> HTTP `403`
- `ERROR_TENANT_SUSPENDED` -> HTTP `403`
- `ERROR_TENANT_NOT_FOUND` -> HTTP `503`
- `ERROR_BINDING_MISSING` -> HTTP `503`
- `ERROR_DATABASE_CONNECTION_UNAVAILABLE` -> HTTP `503`

Rationale:

- missing or invalid auth is a caller problem
- missing tenant or binding is a configuration or rollout problem
- suspended recruiter is an authorization decision at user level
- suspended tenant is an authorization decision, not an infrastructure failure
- missing or failed tenant DB connection is an infrastructure failure for the resolved tenant path

## Connection Management

Services must maintain two connection classes.

### Control-Plane Pool

One process-wide pool:

- `managementDb`

### Data-Plane Pool Registry

A pool registry keyed by resolved binding:

- key example: `prod:tenant-db-eu-prod`
- optional schema-qualified variant: `prod:tenant-db-eu-prod:tenant_alpha`

Rules:

- pools are reused across requests
- app code must not create a new pool per request
- pool resolution belongs to infra/runtime support code, not feature handlers
- for MVP, pools may live for the full process lifetime
- if connection details change, process restart is the supported refresh mechanism
- explicit pool eviction can be added later if tenant churn or connection rotation makes it necessary

## App Config Contract

### Required Runtime Config

- `MANAGEMENT_DATABASE_URL`
- `APP_ENV`

### Optional Runtime Config

- `SESSION_SECRET`
- `GEMINI_API_KEY`
- `HH_CLIENT_ID`
- `HH_CLIENT_SECRET`
- `TELEGRAM_BOT_TOKEN`

### Forbidden Business Logic Inputs

Business logic modules must not directly inspect:

- `V2_DEV_NEON_URL`
- `V2_PROD_NEON_URL`
- `SANDBOX_DATABASE_URL`
- `USE_REAL_DB` as a tenant data routing mechanism

If environment-specific secret names exist in deploy scripts, that is acceptable. They must be resolved before control passes into app runtime composition.

For the current implementation phase:

- `MANAGEMENT_DATABASE_URL` is required at startup
- tenant data-plane connection details are resolved dynamically from `management_db`
- direct GCP Secret Manager access from the request path is not required for MVP

## Demo Mode

Demo mode is allowed only as an explicit mode.

Allowed example:

- `APP_MODE=demo`

Disallowed behavior:

- if `DATABASE_URL` is missing, silently run with fake recruiter and fake data

Production and sandbox rules:

- missing control-plane config must fail startup
- unresolved tenant binding must fail request
- demo fallback is not allowed

## Query Scoping Rules

### Rule 1

The HTTP layer must not trust raw `job_id` from the client.

The app must validate:

- the requested job exists
- the job belongs to the request tenant

### Rule 2

Read-side adapters must accept tenant context explicitly.

Preferred shape:

```js
getFunnelData(sql, { tenantId, jobId })
```

Not:

```js
getFunnelData(sql, jobId)
```

### Rule 3

Operational writes must stamp tenant ownership consistently.

Every insert path for:

- jobs
- conversations
- pipeline_runs
- candidates if tenant-owned

must set tenant ownership fields explicitly.

### Rule 4

No permissive tenant fallback predicates.

Patterns like this are transition-only:

```sql
j.client_id IS NULL OR j.client_id = r.client_id
```

Target state:

```sql
j.tenant_id = $tenant_id
```

## Naming Decision

Target canonical name:

- `tenant_id`

Transition:

- existing `client_id` remains temporarily
- new specs and new APIs should prefer `tenant`

Rationale:

- `tenant` names the architectural concept
- `client` is overloaded and unclear in code involving auth, jobs, and customer accounts

`recruiter_id` remains separate and must not be merged with `tenant_id`.

Why they must remain separate:

- one tenant has multiple recruiters
- recruiters need roles and audit trails
- tenant ownership and user identity change at different rates
- merging them breaks the multi-user model

## Why Not User-Specific DATABASE_URL

The logged-in user should not normally select a unique physical DB connection directly.

That would be the wrong abstraction for the current target architecture.

Correct resolution order:

1. recruiter identity
2. tenant membership
3. tenant DB binding for environment
4. tenant-scoped data access

This keeps:

- auth semantics clean
- infra ownership centralized
- future dedicated DB support possible
- MCP access model aligned with web access model

## Migration Plan

### Phase 1: Spec and Naming Freeze

- adopt this layered model
- stop adding new app code that reads environment-specific tenant DB vars directly
- define canonical `tenant_id` vocabulary in docs and new modules

### Phase 2: Control Plane Formalization

- introduce `management.tenants`
- move or mirror recruiter/session ownership into `management_db`
- introduce `management.database_connections`
- introduce `management.tenant_database_bindings`

Phase 2 decisions:

- keep `management_db` and shared tenant DB in separate Neon projects initially
- do not collapse them into one project as part of this refactor
- for MVP, `management.database_connections` may store raw `connection_string`
- secret indirection remains the target model and can be adopted after runtime resolution is stable

### Phase 3: Runtime Resolver

- add `resolveAccessContext()` in shared runtime code
- input: request auth principal
- output: `recruiter_id`, `tenant_id`, binding metadata, pooled tenant DB client

### Phase 4: Enforce Tenant Scoping in Hiring Agent

- change `hiring-agent` handlers to pass tenant context to adapters
- validate `job_id` ownership before funnel queries
- remove raw `job_id` access without tenant filter

Dependency note:

- strict tenant-filter enforcement must not ship before the required ownership backfill exists in the tenant DB
- if legacy rows still contain `client_id = NULL`, Phase 4 and Phase 5 must be executed together or with a guarded compatibility window

### Phase 5: Normalize Tenant Ownership in Tenant DB

- backfill missing `client_id` or `tenant_id` in operational tables
- make ownership fields non-null where required
- remove permissive legacy predicates

Ordering rule:

- ownership backfill is required before strict `tenant_id`-based filters become mandatory in production paths
- schema hardening and strict query enforcement are a coordinated rollout, not independent steps

### Phase 6: Kill Silent Demo Fallback

- require explicit demo mode
- fail startup in prod and sandbox if control-plane config is missing

### Phase 7: Deploy Contract Cleanup

- VM deploys and Cloud Run deploys both provide a clean runtime contract
- runtime app code sees only:
  - `MANAGEMENT_DATABASE_URL`
  - `APP_ENV`
  - service secrets

## Impact on Current Code

The following current patterns are incompatible with the target spec:

- `hiring-agent` booting into demo mode when `DATABASE_URL` is absent
- `candidate-chatbot` fallback chain across `DATABASE_URL`, `V2_PROD_NEON_URL`, and `V2_DEV_NEON_URL`
- data adapters filtering only by `job_id` without tenant scoping
- startup-time seeding tied to runtime mode
- relying on script-level uniqueness checks for recruiter email without DB-level constraint

## Required Refactors

### Shared Runtime Module

Introduce a shared module, example:

- `packages/access-context/src/index.js`

Responsibilities:

- resolve session or auth principal
- load recruiter
- load tenant
- load binding
- return pooled tenant DB connection

Implementation note:

- because `hiring-agent` and `candidate-chatbot` are separately deployed services, this logic should live in a shared workspace package, not in one service folder
- if introducing `packages/` is temporarily too expensive, a short-lived duplication is acceptable, but the target structure is a shared package

### Hiring Agent

- auth reads from control plane
- request handlers call `resolveAccessContext`
- adapters accept tenant context explicitly

### Candidate Chatbot

- store composition must separate control-plane concerns from operational DB concerns
- dev seeding moves to explicit scripts

## Open Questions

1. Should tenant DB binding support per-tenant schema isolation immediately, or only dedicated/shared DB in phase 1?
2. Do MCP tool calls always carry recruiter principal identity, or do some flows require service principals with delegated tenant scope?
3. What exact MCP auth header contract should be adopted for recruiter-scoped requests in phase 1?

Current MCP placeholder contract:

- phase-1 assumption: MCP requests carry a recruiter-scoped bearer token or equivalent auth header supplied by the gateway
- exact header format remains open
- auth resolution semantics must match web auth semantics even if transport format differs

## Recommended Immediate Decisions

To unblock implementation, adopt these defaults now:

1. `tenant_id` is the canonical term in specs.
2. `client_id` remains in legacy schema during migration.
3. `recruiter_id` remains a separate user identity.
4. `management_db` is the only startup-required DB.
5. `management_db` and shared tenant DB remain in separate Neon projects initially.
6. tenant DB is resolved dynamically from control-plane bindings.
7. MVP stores raw tenant `connection_string` in `management.database_connections`; secret indirection is the target follow-up.
8. demo mode must be explicit.
9. `hiring-agent` is the first service to move to access-context-based resolution.
10. recruiter email is globally unique in `management.recruiters`.
11. new management tables use `tenant_id` from day one; legacy tenant DB tables keep `client_id` during migration, with explicit mapping `client_id = tenant_id`.

## Summary

The target architecture is:

- one control plane
- tenant-aware recruiter auth
- environment-aware tenant DB bindings
- tenant-scoped operational access
- no app-level dependency on environment-specific tenant DB secret names

This matches the intended future where agent and MCP access inherit authorization from headers, while still preserving a clean and auditable runtime model.
