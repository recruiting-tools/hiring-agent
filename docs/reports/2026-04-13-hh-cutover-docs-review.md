# Review: HH Cutover Investigation and Remediation Plan

Date: 2026-04-13
Reviewer: Claude (code review pass)
Status: findings — not approved as-is

---

## Summary

The investigation document **proves the production gap clearly** with concrete, verifiable evidence. The production DB state, deployed SHA, and deploy workflow audit are solid. However, the investigation has one material factual gap (two migrations missing, not one) and two structural gaps (dev/sandbox env state unverified, specific HH vacancy IDs not enumerated).

The remediation plan has the right workstreams but the suggested execution order has a missing step and leaves a decision open that should be made first. Both documents need a minor patch before they are execution-ready.

---

## Investigation Document

### What it proves well

1. **SHA audit chain is tight.** Three deploy run SHAs are recorded, the live revision `candidate-chatbot-v2-00014-vwz` is identified with `DEPLOY_SHA=54660cc...`, and the DB secret name (`V2_PROD_NEON_URL`) is named explicitly. The `deploy-prod.yml` workflow confirms the deploy process does not run migrations — this cross-reference stands up.

2. **DB query results are specific.** The investigation lists the actual rows in `management.clients`, `chatbot.jobs`, `chatbot.recruiters`, and all runtime tables at zero. These are not inferred — they are read directly from the live production DB against the same secret the running service uses. This is the correct level of evidence.

3. **Release process gap is correctly identified.** `deploy-prod.yml` (lines 46–54) confirms: smoke checks only test `/`, `/login`, `/health`. No migration step. No business-data assertion. The investigation conclusion matches the source.

4. **Expected result is well-scoped.** The seven-point acceptance criteria at the end are concrete and testable, not vague. This is the right structure for a follow-up PR.

### Gaps

#### Gap 1 — Two migrations missing, not one (material)

The investigation states `009_hh_oauth_and_flags.sql` is the only missing migration. This is incorrect.

Production `schema_migrations` tops out at `008_auth.sql`. The repo currently contains:

```
009_hh_oauth_and_flags.sql
010_step_follow_up_count.sql
```

Both are unapplied on production. Migration `010` adds `follow_up_count` to `chatbot.pipeline_step_state`. Its absence means runtime code depending on that column would fail at the DB layer for any pipeline step that exercises follow-up logic.

This is not a minor addendum — production is two migrations behind, not one. The investigation section "Migration State In Production DB" must be updated.

Additionally: because `009` is unapplied, the `management.feature_flags` table does not exist in production. The `hh_send` and `hh_import` flags are therefore not just disabled — they physically cannot be enabled. Any attempt to flip a flag before applying `009` will throw an error.

#### Gap 2 — Dev/sandbox environment state not verified

The investigation correctly notes that the planned cutover dry run was supposed to target a Neon branch in dev project `<dev-project-id>`. But the doc does not show what data actually exists there. The investigation closes with "the import was never executed, or was executed only on a non-production Neon branch/project" as co-equal hypotheses.

This is the most important question for the remediation plan (it determines whether there is recoverable import data or whether the import must be run fresh against production). The investigation should query the dev project's main branch and any `pr-*` branches for the same tables it queried on production, and commit that evidence.

Without this, the remediation team does not know whether they are promoting existing data or executing a fresh import.

#### Gap 3 — Specific HH vacancy IDs not enumerated

The investigation states "the 4 HH vacancy IDs from PR #2 are not present as production jobs" but does not list what those IDs are. The reader cannot verify this claim without checking PR #2 independently.

The investigation should extract and record the specific vacancy IDs from PR #2's scope so they can be used directly as the reconciliation target in Workstream 5 of the remediation plan.

#### Minor — Potential data integrity issue not flagged

In the recruiters table, `<demo-recruiter-id>` references `client_id = '<demo-client-id>'`. That client ID does not appear in the clients table snapshot (which shows `client-alpha-001`, `client-beta-001`, `client-prod-001`). This is either a foreign key violation worth flagging or an error in the investigation's representation of the data. Should be confirmed and noted either way.

---

## Remediation Plan

### What is right

- The five workstreams are correctly scoped and non-overlapping.
- The non-goal section correctly prevents "just issue a password" scope creep.
- Each workstream has exit criteria. This is necessary for a plan at this risk level.
- The open questions section is honest about genuine unknowns.

### Execution Order Issues

#### Issue 1 — Idempotent import script is missing from the execution order (blocking)

Suggested execution order step 4 says "Execute idempotent production import." But the plan never includes a step to *write* that script. Workstream 3 defines what the script must do (idempotent, logs counts, skipped items, etc.), but the execution order jumps from "patch release pipeline" directly to "execute import" without a step for authoring and testing the import script against the dev branch first.

The corrected execution order should be:

```
1. Confirm whether expected data exists on a non-production Neon branch/project.
2. Write the idempotent import script; dry-run it against dev/sandbox.
3. Apply missing migrations to production (009 and 010).
4. Patch release pipeline so the same mistake cannot recur.
5. Execute idempotent production import.
6. Run business-data smoke and manual recruiter verification.
```

Note: step 4 (pipeline patch) is deliberately not blocking for the immediate production fix — it should happen in parallel or immediately after, not as a prerequisite to steps 3 and 5.

#### Issue 2 — Workstreams 2 and 3 have unclear ordering relative to each other

Workstream 2 says: add a hard check that fails release if production DB is behind repo migrations.
Workstream 3 says: define one supported promotion path from validated dry run to production.

Workstream 3's output (the promotion path) is what gets codified in Workstream 2's CI check. These need to be ordered: WS3 must be designed before WS2 implements it in CI. Currently the plan does not make this dependency explicit, which risks the CI check being designed before the promotion path is defined, then having to be redone.

#### Issue 3 — Open Question 4 should be a decision, not a question

"Do we want production deploy to block on business-data verification for cutover-class changes?" is listed as open. But Workstream 4 cannot be designed without this decision — if the answer is "yes," business-data smoke becomes an automated release gate in CI; if "no," it becomes an explicit operator sign-off step. The current plan describes Workstream 4's exit criteria without committing to either design.

This should be answered before the remediation begins, not left to be resolved during execution.

Recommendation: given the observed failure mode (merged code shipped while production data was empty), the answer should be yes for cutover-class changes, with a flag or label mechanism in the deploy workflow to distinguish routine deploys from data-cutover deploys.

#### Issue 4 — Migration 010 not in plan

The plan references `009_hh_oauth_and_flags.sql` as the migration to apply (implicit in Workstream 5, step 1). Migration `010_step_follow_up_count.sql` is not mentioned. Both must be in scope for "Apply missing production migrations."

---

## Changes Required Before Execution

| # | Document | Change |
|---|---|---|
| 1 | Investigation | Update "Migration State" section: production is missing both `009` and `010`, not only `009`. Add implication that `feature_flags` table does not exist at all. |
| 2 | Investigation | Add evidence section: dev/sandbox Neon project data state (query `<dev-project-id>` the same way production was queried). |
| 3 | Investigation | Add the specific HH vacancy IDs from PR #2 scope to the evidence record. |
| 4 | Investigation | Confirm or explain `<demo-client-id>` / `<demo-recruiter-id>` foreign key situation. |
| 5 | Remediation plan | Update execution order to include "author and dry-run import script" as an explicit step between pipeline patch and import execution. |
| 6 | Remediation plan | Make WS3→WS2 dependency explicit: define promotion path before codifying it in CI. |
| 7 | Remediation plan | Convert Open Question 4 into a decision with rationale. |
| 8 | Remediation plan | Add migration `010` to Workstream 5 step 1 scope. |

---

## Overall Verdict

The investigation proves the production gap correctly at the level of evidence available. The failure chain hypothesis is sound and supported by the workflow source. The gap in migration count (009 only vs 009+010) is a factual error that needs correction before the plan is executed, because the wrong number of migrations drives the wrong remediation scope.

The remediation plan has the right structure. The execution order needs one inserted step and one dependency clarification. Open Question 4 needs a decision. Once these are addressed, the plan is execution-ready.
