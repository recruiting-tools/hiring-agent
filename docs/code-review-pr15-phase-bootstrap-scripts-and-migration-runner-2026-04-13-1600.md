# Code Review: PR #15 — Bootstrap Scripts, Migration Runner, Updated Tests

Date: 2026-04-13
Reviewer: Claude
Scope: Second pass — files not covered in the first review

Files reviewed:
- `scripts/lib/run-migrations.js`
- `scripts/migrate-management.js`
- `scripts/migrate.js` (refactored)
- `scripts/bootstrap-management-tenants.js`
- `scripts/bootstrap-management-recruiters.js`
- `scripts/bootstrap-database-bindings.js`
- `packages/access-context/package.json`
- `services/hiring-agent/src/playbooks/candidate-funnel.js`
- `tests/unit/hiring-agent-auth.test.js`
- `tests/integration/hiring-agent-funnel-adapter.test.js`

Previous review: `docs/code-review-pr15-phase1-management-schema-and-access-context-2026-04-13-1545.md`

---

## `scripts/lib/run-migrations.js`

### What works

- `quoteIdentifier` properly escapes double-quotes in schema/table names ✓
- Each migration runs inside a transaction; on failure it rolls back and throws ✓
- Migration tracker record is inside the same transaction as the SQL — they commit together ✓
- `IF NOT EXISTS` on tracker table means safe to re-run ✓
- `.sort()` on filenames guarantees lexicographic order ✓

### Issue: `CONCURRENTLY` detection is too broad

```js
const needsTransaction = !sql.includes("CONCURRENTLY");
```

Any file containing the string `CONCURRENTLY` anywhere — including in a comment or a string literal — skips the transaction wrapper. Example:

```sql
-- TODO: switch to CREATE INDEX CONCURRENTLY once load allows
CREATE TABLE ...;
```

This migration would run without a transaction even though the actual statement doesn't use CONCURRENTLY.

More robust: check with a regex that only matches as a keyword at a statement boundary, or — simplest — keep a static list of no-transaction migrations instead of a content scan.

Low severity while the migration set is small and reviewed manually, but the assumption is fragile as the set grows.

### Issue: No concurrent deploy protection

The check-then-insert sequence:

```js
const alreadyApplied = await client.query("SELECT 1 FROM ... WHERE filename = $1", [filename]);
if (alreadyApplied.rows.length > 0) { continue; }
// ... (gap here)
await client.query(sql); // second process can run the same migration
await client.query("INSERT INTO ... (filename) VALUES ($1)", [filename]);
```

Two parallel deploy processes could both pass the `SELECT 1` check and both run the same migration. The `INSERT` would fail on the second process (PK violation), but the migration SQL itself would have run twice.

Standard fix: use a PostgreSQL advisory lock at the start:

```js
await client.query("SELECT pg_advisory_lock(1)");
// ... run all migrations ...
await client.query("SELECT pg_advisory_unlock(1)");
```

Or take an exclusive lock on the tracker table:

```js
await client.query(`LOCK TABLE ${trackerTable} IN EXCLUSIVE MODE`);
```

For now this is not a practical risk because deploys are serial (PM2 + single VM), but worth knowing when moving to parallel deployment.

---

## `scripts/migrate-management.js` and `scripts/migrate.js`

Both are clean. `migrate.js` correctly shed its inline migration runner in favor of the shared `runMigrations` helper — good refactor, no issues.

---

## `scripts/bootstrap-management-tenants.js`

### Issue: Reads `management.clients` from the source tenant DB

```js
const clients = await sourceClient.query(`
  SELECT client_id, name
  FROM management.clients
  ORDER BY client_id
`);
```

The tenant DB (round-leaf Neon project) has a `chatbot.*` schema. Whether it also has a `management.clients` table is not evident from the rest of the codebase. If this table doesn't exist in the source DB, the bootstrap fails at runtime with no helpful message.

Before running this script in production, verify that `management.clients` exists in the source DB. If it doesn't, the query should probably be `SELECT DISTINCT client_id FROM chatbot.jobs` or similar — wherever `client_id` values are authoritative.

This is a bootstrapping concern, not a runtime concern, but it's a silent failure mode that will only surface when the script is first run against production data.

---

## `scripts/bootstrap-management-recruiters.js`

### Issue: Will fail on duplicate emails across tenants

```js
await managementClient.query(`
  INSERT INTO management.recruiters (recruiter_id, tenant_id, email, ...)
  VALUES ($1, $2, $3, ...)
  ON CONFLICT (recruiter_id) DO UPDATE SET ...
`);
```

`management.recruiters.email` has a global `UNIQUE` constraint. If two recruiters in the source DB have the same email (even with different `recruiter_id`s), the second insert will throw a unique constraint violation and the script will exit mid-run.

This may not happen in the current data, but the script gives no warning and no recovery path. Minimum fix: catch the unique violation per-row and print a warning instead of crashing:

```js
try {
  await managementClient.query(`INSERT ...`, [...]);
  console.log(`Upserted recruiter ${row.recruiter_id}`);
} catch (error) {
  if (error.code === "23505") {
    console.warn(`SKIP: recruiter ${row.recruiter_id} — email ${row.email} already belongs to another recruiter`);
  } else {
    throw error;
  }
}
```

---

## `scripts/bootstrap-database-bindings.js`

### Bug: `bind-all` is not idempotent — will crash on re-run

The `bind-all` command inserts a binding per tenant with `is_primary = true`:

```js
await client.query(`
  INSERT INTO management.tenant_database_bindings (binding_id, ..., is_primary)
  VALUES ($1, ..., true)
`, [randomUUID(), ...]);
```

Each call generates a new `randomUUID()` for `binding_id`, so there's no conflict on the primary key. But the partial unique index:

```sql
CREATE UNIQUE INDEX idx_management_primary_binding
  ON management.tenant_database_bindings (tenant_id, environment)
  WHERE is_primary = true;
```

allows at most one primary binding per `(tenant_id, environment)`. Running `bind-all` a second time will crash with a unique constraint violation on the second tenant row.

The `bind` command and `register-connection` both use `ON CONFLICT ... DO UPDATE`, but `bind-all` does not. This is inconsistent and a practical hazard when re-running bootstrap during environment setup.

Fix: replace the INSERT with an upsert. Postgres requires a named constraint or unique index for `ON CONFLICT` with a `WHERE` clause:

```js
await client.query(`
  INSERT INTO management.tenant_database_bindings (binding_id, tenant_id, environment, binding_kind, db_alias, schema_name, is_primary)
  VALUES ($1, $2, $3, $4, $5, $6, true)
  ON CONFLICT (tenant_id, environment) WHERE is_primary = true DO UPDATE SET
    binding_kind = EXCLUDED.binding_kind,
    db_alias = EXCLUDED.db_alias,
    schema_name = EXCLUDED.schema_name
`, [...]);
```

This is a blocker for safe environment re-initialization.

### Observation: `--primary false` parsing

```js
const isPrimary = args["primary"] !== "false";
```

Values `0`, `no`, `n`, `false` (as a boolean flag) all evaluate to `true` because they're not the string `"false"`. Only `--primary=false` or `--primary false` works as intended. This is a minor CLI UX issue.

---

## `tests/unit/hiring-agent-auth.test.js`

### What was added

- `resolveSession` SQL query shape test ✓
- Session renewal in background ✓
- `createSession` TTL check ✓
- `GET / → 302 to /login` when no cookie ✓

### Note on the 302 redirect test

The last test:

```js
test("auth: GET / redirects to /login when cookie is missing", async () => {
  const server = createHiringAgentServer(createHiringAgentApp()).listen(0);
  // no cookie → expects 302
```

This test passes, but currently it passes because of the TypeError-as-flow-control bug identified in the previous review. In demo mode with no cookie, the code falls through to `resolveAccessContext({ managementStore: null })` which throws a TypeError, which the catch block treats as unauthorized → 302.

After fixing that bug (explicit early return from the demo block), this test will continue to pass with the correct behavior. The test itself is valid — it describes the right expectation. Just noting that it doesn't distinguish "works correctly" from "works accidentally."

---

## `tests/integration/hiring-agent-funnel-adapter.test.js`

The update adds `tenantId: "tenant-test-001"` to match the new `getFunnelData` signature. The test seeds `client_id = 'tenant-test-001'` consistently across jobs, runs, and step states. Cleanup in `finally` is thorough.

One note: the funnel adapter uses `chatbot.jobs.client_id = ${tenantId}` for tenant filtering. This test validates that path through a real Postgres query. ✓

---

## `services/hiring-agent/src/playbooks/candidate-funnel.js`

Minor refactor — `executeWithDb` and `buildReplyFromRows` are clean additions. The summary calculation:

```js
total: normalizedRows.reduce((max, row) => Math.max(max, row.total), 0),
```

Takes the maximum `total` across all steps (the funnel entry count). This is intentional — the widest step is the top of the funnel. Correct for a funnel visualization.

---

## `packages/access-context/package.json`

Minimal and appropriate. Private workspace package, ESM, single export. No issues.

---

## Summary

| Severity | Item | File | Action |
|----------|------|------|--------|
| **Bug** | `bind-all` not idempotent — crashes on re-run with unique violation | `bootstrap-database-bindings.js` | Fix before merge |
| Medium | `bootstrap-management-tenants.js` reads `management.clients` — may not exist in source DB | `bootstrap-management-tenants.js` | Verify or document |
| Medium | `bootstrap-management-recruiters.js` crashes on duplicate email, no recovery | `bootstrap-management-recruiters.js` | Add per-row error handling |
| Low | `run-migrations.js` CONCURRENTLY check is substring match — fragile | `run-migrations.js` | Follow-up |
| Low | `run-migrations.js` no concurrent-deploy lock | `run-migrations.js` | Follow-up |
| Note | Auth 302 test passes via TypeError bug; still correct after fix | `hiring-agent-auth.test.js` | No action, awareness only |

One blocker before merge: `bind-all` idempotency. The two medium items are bootstrapping risks that should be resolved before first production run.
