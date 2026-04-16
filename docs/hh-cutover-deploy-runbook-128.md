# HH Cutover Deployment Runbook (Issue #128)

Goal: prevent HH sync/send rollout from entering production without checked prerequisites.

## Pre-deploy prerequisites (mandatory)

- Production candidate DB (`PROD_DATABASE_URL`) and management DB (`MANAGEMENT_DATABASE_URL`) secrets are present in GitHub Actions.
- Required migration set applied to candidate DB:
  - `009_hh_oauth_and_flags.sql`
  - `010_step_follow_up_count.sql`
- Required management tables exist:
  - `management.feature_flags`
  - `management.oauth_tokens`
  - `management.schema_migrations`
- Feature flags are intentionally off before rollout:
  - `hh_send = false`
  - `hh_import = false`
- HH runtime config is present:
  - `HH_CLIENT_ID`
  - `HH_CLIENT_SECRET`
  - `HH_REDIRECT_URI`
  - `HH_VACANCY_JOB_MAP` is non-empty and valid JSON list with `hh_vacancy_id`/`job_id`

## Run sequence

1. Run `deploy-prod` workflow for the release commit.
2. Ensure workflow runs in order:
   - `Run database migrations`
   - `Run management database migrations`
   - `Run HH cutover readiness guard`
   - `Deploy to Cloud Run`
   - `Post-deploy smoke`
3. On `Run HH cutover readiness guard`, confirm the JSON summary ends with:
   - `"ok": true` when any HH feature flags are enabled.
   - if HH flags are false, missing non-critical HH readiness details are allowed for next-step prep.
4. Keep `hh_send/hh_import` disabled until explicit switch and manual approval.
5. For first real send:
   - authorize HH employer in `/hh-callback/`
   - verify at least one record appears in `management.oauth_tokens`
   - update `hh_import`/`hh_send` only after business-data smoke.

## Health and monitoring checks

- `/health` still remains the baseline deploy health endpoint.
- Track deploy metadata in Cloud Run logs:
  - `APP_ENV`, `DEPLOY_SHA`, `deploy_time`, `service`
- Post-change monitor:
  - `GET /health`
  - `SELECT flag, enabled FROM management.feature_flags WHERE flag IN ('hh_send','hh_import')`
  - `SELECT filename FROM public.schema_migrations ORDER BY filename DESC LIMIT 20`

## Rollback sequence

If readiness check fails:
- if failure is in prod runtime:
  - set `hh_send = false`, `hh_import = false` immediately,
  - keep Cloud Run deployment as-is to preserve traceability,
  - re-run migration/data readiness fixes,
  - run `deploy-prod` again.
- if failure is transient infra/network:
  - rerun `deploy-prod` after remediation,
  - keep HH flags disabled until repeated readiness succeeds.
- if a bad HH import started:
  - disable feature flags,
  - stop any manual retry jobs,
  - patch imported state via recovery script or support procedure.

## Decision gates (mandatory)

- `deploy-prod` must fail fast on readiness guard when HH flags are enabled and readiness checks fail.
- Production HH send/import may only be enabled after explicit operational sign-off that all prerequisite checks passed.
