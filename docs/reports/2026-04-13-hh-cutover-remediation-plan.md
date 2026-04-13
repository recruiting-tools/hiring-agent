# HH Cutover Remediation Plan

Date: 2026-04-13
Status: draft plan

## Goal

Close the gap between merged HH cutover code and production reality, then make the path repeatable.

## Workstreams

### 1. Establish source and target truth

1. Identify exactly where the HH cutover dry run or partial import was executed.
2. Record the exact Neon project, branch, and connection string owner for:
   - dev
   - sandbox
   - any `pr-*` validation branch used for HH cutover
   - production
3. Compare data in those environments against production:
   - clients
   - jobs
   - recruiters
   - HH negotiations
   - conversations/messages
   - pipeline state

Exit criteria:

- we can name the environment that currently holds the expected migrated data, or conclude it was never imported anywhere durable

### 2. Repair production migration discipline

1. Decide whether production deploy must run migrations automatically or via an explicit pre-deploy job.
2. Add a production-safe migration step that targets the same DB secret used by the running service.
3. Add a hard check that fails release if production DB is behind repo migrations.

Exit criteria:

- production cannot serve new code while required migrations are unapplied

### 3. Repair production data promotion

1. Define one supported promotion path from validated dry run to production.
2. Remove ambiguity between:
   - dev Neon project branch validation
   - sandbox validation
   - production import execution
3. Script the cutover/import so it can be rerun idempotently against production.
4. Persist an execution log:
   - source vacancy IDs
   - target client/job IDs
   - imported counts
   - skipped/reconciled items

Exit criteria:

- a merge alone is not confused with a completed production data cutover

### 4. Repair production verification

1. Extend smoke checks beyond `/health` and `/login`.
2. Decide explicitly whether cutover-class checks are:
   - automated release gates
   - manual operator sign-off gates
3. Add a release-readiness check that asserts:
   - target recruiter exists
   - target jobs exist
   - imported counts are above zero for the scoped cutover
   - demo-only state is not the only visible state
4. Make this check run against the same production DB secret as runtime.

Exit criteria:

- release is considered successful only when business data is present, not only when HTTP endpoints answer

### 5. Re-run the HH cutover correctly

1. Apply missing production migrations.
2. Create or verify the real recruiter tenant in production.
3. Import the in-scope HH vacancies and recent dialogs into production.
4. Verify recruiter UI against the intended tenant.
5. Rotate or issue final recruiter credentials only after the tenant is confirmed correct.

Exit criteria:

- recruiter can log in and see the intended migrated vacancies and candidate data

## Suggested Execution Order

1. Confirm whether expected data exists on a non-production Neon branch/project.
2. Decide the production verification mode for cutover-class releases: automated gate or manual sign-off.
3. Build or verify the idempotent production import path and execution logging.
4. Patch release pipeline so the same mistake cannot recur during the fix.
5. Apply missing migrations to production.
6. Execute idempotent production import.
7. Run business-data smoke and manual recruiter verification.

## Open Questions

1. Was the HH import ever run against any persistent Neon branch, or only planned in PR scope?
2. If it was run, which exact project/branch contains the imported records now?
3. Should production migrations happen inside GitHub Actions, or as an explicit gated operator step with logging?
4. Do we want production deploy to block on business-data verification for cutover-class changes?

## Non-goal

This plan does not assume the fix is "just create another recruiter password". The observed state shows the missing artifact is production data readiness, not only access issuance.
