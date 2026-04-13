# Management DB Rollout Checklist

Date: 2026-04-13
Scope: `hiring-agent` control-plane rollout from tenant-local auth to `management_db`

## Goal

This checklist describes the minimum rollout sequence required to turn on management-backed auth for `hiring-agent` without guessing at bootstrap order.

## Preconditions

- PR #15 is merged or the deploy branch is pinned intentionally
- target runtime has `MANAGEMENT_DATABASE_URL`
- target tenant DB connection string is known for binding registration
- target environment name is known: `local`, `dev`, `sandbox`, or `prod`

## Rollout Steps

1. Apply tenant DB migrations on the target tenant DB.
   Command:
   ```bash
   DATABASE_URL="$TENANT_DATABASE_URL" node scripts/migrate.js
   ```

2. Apply management DB migrations on the control-plane DB.
   Command:
   ```bash
   MANAGEMENT_DATABASE_URL="$MANAGEMENT_DATABASE_URL" node scripts/migrate-management.js
   ```

3. Bootstrap tenants into `management.tenants`.
   Notes:
   - this reads from the source tenant DB
   - for this phase the source DB may be passed through `SOURCE_DATABASE_URL`
   Command:
   ```bash
   MANAGEMENT_DATABASE_URL="$MANAGEMENT_DATABASE_URL" \
   SOURCE_DATABASE_URL="$TENANT_DATABASE_URL" \
   node scripts/bootstrap-management-tenants.js
   ```

4. Bootstrap recruiters into `management.recruiters`.
   Notes:
   - duplicate emails are skipped with warnings
   - source of truth is still the source tenant DB for this migration step
   Command:
   ```bash
   MANAGEMENT_DATABASE_URL="$MANAGEMENT_DATABASE_URL" \
   SOURCE_DATABASE_URL="$TENANT_DATABASE_URL" \
   node scripts/bootstrap-management-recruiters.js
   ```

5. Register the tenant DB connection in `management.database_connections`.
   Command:
   ```bash
   MANAGEMENT_DATABASE_URL="$MANAGEMENT_DATABASE_URL" \
   node scripts/bootstrap-database-bindings.js register-connection \
     --db-alias="$DB_ALIAS" \
     --connection-string="$TENANT_DATABASE_URL" \
     --provider=neon \
     --region="$DB_REGION" \
     --status=active
   ```

6. Create or refresh the primary tenant binding for the target environment.
   Command:
   ```bash
   MANAGEMENT_DATABASE_URL="$MANAGEMENT_DATABASE_URL" \
   node scripts/bootstrap-database-bindings.js bind-all \
     --environment="$APP_ENV" \
     --binding-kind=shared_db \
     --db-alias="$DB_ALIAS"
   ```

7. For sandbox or demo-style environments, create or refresh the demo auth user in `management.*`.
   Command:
   ```bash
   MANAGEMENT_DATABASE_URL="$MANAGEMENT_DATABASE_URL" \
   DEMO_EMAIL="$DEMO_EMAIL" \
   DEMO_PASSWORD="$DEMO_PASSWORD" \
   node scripts/bootstrap-demo-user.js
   ```

8. Verify control-plane rows exist before deploy.
   Checks:
   - target tenant exists in `management.tenants`
   - recruiter exists in `management.recruiters`
   - one primary binding exists for `(tenant_id, environment)`
   - the referenced `db_alias` exists in `management.database_connections`
   Command:
   ```bash
   MANAGEMENT_DATABASE_URL="$MANAGEMENT_DATABASE_URL" \
   node scripts/check-management-readiness.js \
     --tenant-id="$TENANT_ID" \
     --app-env="$APP_ENV" \
     --recruiter-id="$RECRUITER_ID"
   ```

9. Deploy `hiring-agent` with `MANAGEMENT_DATABASE_URL` present in runtime env.
   Expected:
   - process starts with `mode=management-auth`
   - no implicit fallback to demo mode

10. Run smoke checks after deploy.
    Checks:
    - `GET /health` returns `mode=management-auth`
    - `GET /login` loads
    - valid recruiter credentials produce a session cookie
    - `GET /api/jobs` returns only tenant-owned jobs
    - `POST /api/chat` with a foreign `job_id` returns `404 job_not_found`

## Rollback

If the management bootstrap path is incomplete:

- do not leave the service in non-demo mode without `MANAGEMENT_DATABASE_URL`
- fix missing bootstrap data and redeploy
- if the environment must stay available immediately, deploy with `APP_MODE=demo` only as a deliberate temporary fallback

## Known Phase-1 Limits

- `shared_schema` bindings are not supported
- `management.database_connections` still stores raw `connection_string`
- seed scripts `seed-dev-db.js`, `seed-sandbox-db.js`, and `seed-prod-db.js` remain tenant-operational and are not substitutes for this rollout flow
