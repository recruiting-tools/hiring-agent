# Binding Fix 13 Apr

Date: 2026-04-13

## Symptom

Login to `https://<hiring-agent-host>/login` succeeds, but the first authenticated request returns:

```json
{"error":"ERROR_BINDING_MISSING","message":"Primary tenant DB binding is missing for tenant client-prod-001 in local"}
```

## Confirmed Root Cause

The service resolves tenant DB access by `(tenant_id, APP_ENV)`.

Relevant code:

- [packages/access-context/src/resolve-access-context.js](/Users/vova/Documents/GitHub/hiring-agent/packages/access-context/src/resolve-access-context.js:30)
- [services/hiring-agent/src/index.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/index.js:11)

What happens:

1. `resolveAccessContext()` loads the recruiter session.
2. It asks `managementStore.getPrimaryBinding({ tenantId, appEnv })`.
3. If no binding exists for that exact environment, it throws `ERROR_BINDING_MISSING`.

The production management DB currently has a primary binding for:

- `tenant_id = client-prod-001`
- `environment = prod`

But the live PM2 process was started without `APP_ENV`, so runtime fell back to:

- `appEnv = "local"`

That fallback comes from:

```js
const appEnv = env.APP_ENV ?? "local";
```

in [services/hiring-agent/src/index.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/index.js:11).

Result: the service searched for a binding in `local`, while only `prod` existed.

## Evidence

Application behavior:

- `POST /auth/login` succeeded after recruiter rows were added to `management.recruiters`.
- Authenticated access failed with `ERROR_BINDING_MISSING ... in local`.

Runtime state on VM:

- `/opt/hiring-agent/.env` contains `APP_ENV=prod`.
- `pm2 env 0` did not include `APP_ENV`.
- `GET /health` showed `mode=management-auth`, so the app was using management auth, but still defaulting `APP_ENV` internally.

Management DB state:

- `management.tenant_database_bindings` contains a primary binding for `client-prod-001` in `prod`.
- No corresponding `local` binding exists.

## Why This Happened

There are two problems:

1. Runtime configuration problem.
   The live PM2 process did not receive `APP_ENV`, even though the VM `.env` file had it.

2. Guardrail problem in application startup.
   In non-demo mode, missing `APP_ENV` does not fail startup. It silently defaults to `local`, which converts a deploy/configuration mistake into a runtime tenant-binding error.

## Immediate Fix

1. Restart `hiring-agent` with `APP_ENV=prod` actually present in the PM2 process environment.
2. Verify with `pm2 env 0` that `APP_ENV: prod` is visible.
3. Verify `GET /health`.
4. Re-test login and authenticated endpoints.

## Permanent Fix Plan

### 1. Remove silent fallback in non-demo mode

Change startup logic so that:

- `APP_MODE=demo` may continue to use a relaxed setup
- non-demo mode must require `APP_ENV`

Expected outcome:

- service fails fast at startup if `APP_ENV` is missing
- misconfiguration is caught during deploy, not during recruiter login

Relevant file:

- [services/hiring-agent/src/index.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/index.js:11)

### 2. Expose `appEnv` in `/health`

`/health` should always show the active environment used for binding resolution.

Expected outcome:

- health output makes it obvious whether the process thinks it is in `prod`, `sandbox`, or `local`

Relevant file:

- [services/hiring-agent/src/app.js](/Users/vova/Documents/GitHub/hiring-agent/services/hiring-agent/src/app.js:8)

### 3. Harden deploy verification

After deploy/restart, explicitly verify:

- `APP_ENV` is present in PM2 env
- `MANAGEMENT_DATABASE_URL` is present
- authenticated request resolves a tenant binding successfully

Relevant file:

- [scripts/deploy-hiring-agent.sh](/Users/vova/Documents/GitHub/hiring-agent/scripts/deploy-hiring-agent.sh:66)

### 4. Add regression coverage

Add tests for:

- startup failure when `APP_ENV` is missing in non-demo mode
- health output exposing the effective environment

Relevant files:

- [tests/unit/hiring-agent-runtime.test.js](/Users/vova/Documents/GitHub/hiring-agent/tests/unit/hiring-agent-runtime.test.js:18)
- [tests/integration/hiring-agent.test.js](/Users/vova/Documents/GitHub/hiring-agent/tests/integration/hiring-agent.test.js:47)

## Recommended Acceptance Criteria

1. Starting `hiring-agent` without `APP_ENV` in non-demo mode fails immediately.
2. `GET /health` shows both `mode=management-auth` and `app_env=prod`.
3. Production recruiter login succeeds.
4. Authenticated recruiter requests resolve tenant DB access without `ERROR_BINDING_MISSING`.
5. Deploy script output clearly shows the effective `APP_ENV`.

## Summary

This is not a missing-data bug in the binding table itself.

The binding exists for `prod`.

The real failure is that the live process resolved environment as `local` because `APP_ENV` was missing from runtime env, and application startup allowed that misconfiguration instead of failing fast.
