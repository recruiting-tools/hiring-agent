# Code Review: PR #15 — Phase 1, 2, 3 (Management Schema + Access Context + Hiring Agent Auth)

Date: 2026-04-13
Reviewer: Claude
Scope: First three phases only — Phase 1 (Control-Plane Schema), Phase 2 (Shared Access Context Package), Phase 3 (Management-Backed Auth for Hiring Agent)

Files reviewed:
- `migrations/management/001_tenant_recruiter_access.sql`
- `packages/access-context/src/` (all files)
- `services/hiring-agent/src/index.js`
- `services/hiring-agent/src/auth.js`
- `services/hiring-agent/src/app.js`
- `services/hiring-agent/src/http-server.js`
- `tests/unit/access-context.test.js`
- `tests/integration/access-context-postgres.test.js`
- `tests/integration/hiring-agent.test.js`
- `tests/helpers/management-fixtures.js`

---

## Phase 1 — Control-Plane Schema (`001_tenant_recruiter_access.sql`)

### What works

All constraints from the spec are present:
- `tenants.status` CHECK ✓
- `recruiters.status` and `recruiters.role` CHECK constraints ✓
- `database_connections.exactly_one_connection_source` CHECK ✓
- `sessions.expires_at` index for cleanup ✓
- `sessions.recruiter_id` index (bonus, not in spec, reasonable) ✓
- Partial unique index for primary binding per `(tenant_id, environment)` ✓
- All `IF NOT EXISTS` — migration is safe to re-run ✓

### Issue: `database_connections.status` has no CHECK constraint

The column has `DEFAULT 'active'` but nothing prevents inserting an arbitrary status string. Other tables have CHECK constraints for their status columns. Low severity but inconsistent.

```sql
-- missing from database_connections:
CONSTRAINT database_connections_status_check CHECK (status IN ('active', 'inactive', 'disabled'))
```

### Observation: `binding_kind = 'shared_schema'` is allowed at DB level

The migration allows `shared_schema` as a valid `binding_kind` even though Phase 1 explicitly doesn't support it. This is fine — rejecting it at the DB level would block future migrations. The runtime correctly rejects it with an error. No action needed, just worth knowing.

---

## Phase 2 — Shared Access Context Package (`packages/access-context/`)

### What works

- `pool-registry.js`: pool keying by `${appEnv}:${dbAlias}`, reuse on cache hit, `closeAll()` with timeout ✓
- `management-store.js`: single JOIN query across sessions/recruiters/tenants with expiry filter ✓
- Session renewal is fire-and-forget (`void ... .catch(() => {})`) — correct pattern ✓
- Error hierarchy is clean: `AccessContextError` with typed codes and HTTP status ✓
- Sequential resolution in `resolve-access-context.js` matches spec ✓

### Bug: Wrong error code when `getDatabaseConnection` returns null

File: `packages/access-context/src/resolve-access-context.js`, lines 51–57

```js
const databaseConnection = await managementStore.getDatabaseConnection(binding.db_alias);
if (!databaseConnection) {
  throw new AccessContextError(
    "ERROR_TENANT_NOT_FOUND",       // ← wrong
    `Database connection ${binding.db_alias} was not found`,
    { httpStatus: 503 }
  );
}
```

When `getDatabaseConnection` returns null it means the `db_alias` row doesn't exist in `management.database_connections`. This is a database configuration problem, not a missing tenant. The correct code is `ERROR_DATABASE_CONNECTION_UNAVAILABLE`.

The fix:

```js
throw new AccessContextError(
  "ERROR_DATABASE_CONNECTION_UNAVAILABLE",
  `Database connection ${binding.db_alias} was not found`,
  { httpStatus: 503 }
);
```

Using `ERROR_TENANT_NOT_FOUND` here would make debugging a missing DB connection binding much harder — the error code misleads you to look at tenant data instead of `database_connections`.

### Observation: Session renewal threshold logic

In `management-store.js`:

```js
const renewalThreshold = Date.now() + SESSION_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
if (expiresAt.getTime() >= renewalThreshold) return;
```

This reads: "skip renewal if expiry is at or after (now + 7 days)". So renewal only runs when less than 7 days remain. Logic is correct. Not a bug, just worth confirming on first read.

---

## Phase 3 — Management-Backed Auth for Hiring Agent

### What works

- `index.js`: `APP_MODE=demo` is now the only explicit demo path ✓
- `index.js`: fails startup with a clear error if `MANAGEMENT_DATABASE_URL` is missing outside demo ✓
- `http-server.js`: all protected routes go through `requireAccessContext` ✓
- `app.js`: `getTenantJobById` validates `job_id` against `tenant_id` before running funnel ✓
- `app.js`: `getJobs` filters by `client_id = ${tenantId}` ✓

### Bug: Demo mode falls through to TypeError when session cookie is absent

File: `services/hiring-agent/src/http-server.js`, lines 710–755

In demo mode (`managementStore = null`):
1. Request arrives with no session cookie
2. `!options.managementStore` is true → enters demo block
3. `resolveSession(null, undefined)` → `!token` → returns `null`
4. `recruiter` is null → doesn't return
5. Falls through to `resolveAccessContext({ managementStore: null, ... })`
6. Inside: `managementStore.getRecruiterSession(...)` → **TypeError: Cannot read properties of null**
7. Gets caught in the `catch` block — treated as unauthorized → 401 or 302

The unauthenticated demo path "works" accidentally through a TypeError being used as flow control. The fix is to return early from `requireAccessContext` when in demo mode and no recruiter was found:

```js
if (!options.managementStore || !options.poolRegistry) {
  const recruiter = await resolveSession(null, cookies.session);
  if (recruiter) {
    return { recruiterId: ..., tenantSql: null };
  }
  // explicit return instead of falling through
  if (unauthorizedStatus === 302) {
    response.writeHead(302, { location: "/login" });
    response.end();
  } else {
    writeJson(response, 401, { error: "unauthorized" });
  }
  return null;
}
```

### Issue: Duplicate session resolution logic between `auth.js` and `management-store.js`

`auth.js` has its own `resolveSession()` that runs the same session → recruiter → tenant JOIN:

```js
// auth.js
const rows = await sql`
  SELECT r.recruiter_id, r.tenant_id, r.email, r.role, r.status AS recruiter_status,
         t.status AS tenant_status, s.expires_at
  FROM management.sessions s
  JOIN management.recruiters r ON ...
  JOIN management.tenants t ON ...
  WHERE s.session_token = ${token} AND s.expires_at > now()
`;
```

`management-store.js` has an identical query in `getRecruiterSession()`. These can drift independently.

`auth.js::resolveSession()` is only used in the demo fallback path inside `requireAccessContext`. In management auth mode the resolver uses `managementStore.getRecruiterSession()` from the package.

For Phase 1 this duplication is low risk (the demo path is non-production), but it should be unified in a follow-up. Not a blocker.

### Issue: `readJsonBody` has no size limit and no JSON parse guard

File: `services/hiring-agent/src/http-server.js`, lines 758–763

```js
async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}
```

Two problems:
1. No maximum body size — a large payload buffers entirely in memory before being processed
2. `JSON.parse` throws on malformed input — not caught, bubbles up as a 500 instead of 400

The second is more operationally annoying. A recruiter with a browser extension mangling requests gets a 500 error with no useful message. Minimum fix:

```js
try {
  return rawBody ? JSON.parse(rawBody) : {};
} catch {
  throw Object.assign(new Error("invalid json"), { httpStatus: 400 });
}
```

Body size limit is not critical for an internal tool but worth noting for a production-facing service.

---

## Test Coverage Assessment

### Unit tests (`tests/unit/access-context.test.js`)

Covered:
- pool reuse by key ✓
- happy path access context ✓
- suspended recruiter → 403 ✓
- missing binding → 503 ✓

Not covered:
- `disabled` recruiter status (only `suspended` is tested — both branches exist in the resolver)
- suspended tenant status
- null `connection_string` on a found DB connection record
- `shared_schema` binding kind rejection

### Integration tests (`tests/integration/access-context-postgres.test.js`)

Covered:
- session resolves to tenant SQL, can query jobs ✓
- missing binding returns `ERROR_BINDING_MISSING` ✓

Not covered:
- Tenant isolation: Alpha recruiter cannot read Beta's jobs by passing Beta's `job_id`

### Integration tests (`tests/integration/hiring-agent.test.js`)

Covered:
- Management-backed `/api/jobs` resolves tenant SQL ✓
- Suspended recruiter gets 403 ✓
- Foreign `job_id` gets 404 ✓
- Owned `job_id` returns funnel ✓

Not covered:
- Request with no session cookie → 401 or redirect to login (unauthenticated path)
- Cross-tenant `job_id` isolation via two distinct tenants

---

## Summary

| Severity | Item | File | Action |
|----------|------|------|--------|
| **Bug** | Wrong error code `ERROR_TENANT_NOT_FOUND` for missing DB connection | `resolve-access-context.js:51` | Fix before merge |
| **Bug** | Demo mode TypeError as flow control when no session cookie | `http-server.js:710` | Fix before merge |
| Medium | Duplicate session query in `auth.js` vs `management-store.js` | `auth.js:34` | Follow-up |
| Medium | `readJsonBody` no JSON parse guard → 500 on bad input | `http-server.js:758` | Fix or follow-up |
| Low | `database_connections.status` no CHECK constraint | `001_tenant_recruiter_access.sql` | Follow-up |
| Low | Missing unit tests: disabled recruiter, suspended tenant, null connection_string | `access-context.test.js` | Follow-up |
| Low | Missing isolation test: Alpha cannot access Beta jobs | integration tests | Follow-up |

Two items should be fixed before merge (both are bugs). Everything else can follow in Phase 3 cleanup.
