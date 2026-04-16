# HH Vacancy Cutover Plan

Date: 2026-04-13

Scope: cutover preparation for 4 HH vacancies into `hiring-agent`, with review-first workflow, Neon dry run, and moderated outbound sending.

## Vacancies In Scope

- `131345849` — China procurement
- `131532142` — designer
- `131812494` — designer
- `132032392` — sales

## Migration Boundary

- Import only candidates with dialog activity in the last 5 days.
- Freeze both start and end of the export window per run.
- For the current pass, start is `2026-04-08 00:00`.
- `export timestamp` means the timestamp captured at export start and held constant for that run.
- Import full message history for selected candidates into DB.
- Runtime prompt context may stay bounded even if DB stores full history.
- First target outcome: planned outbound messages visible in moderation UI before any real sending.

## Git And Neon Model

### Git branch

Use a dedicated feature branch and draft PR for:

- runtime changes
- migrations
- import/export scripts
- vacancy mappings/configs
- moderation UI
- tests

### Neon branch

Use a dedicated Neon branch to validate schema, import, and UI behavior on a safe copy.

- default project: `v2-dev-client`
- Neon project id: `<dev-project-id>`
- default parent branch: `sandbox`

Code review happens in GitHub PR. Data safety and migration validation happen in Neon branches.

## Source Systems

- Primary export source: live HH API for the 4 in-scope vacancy IDs.
- Secondary read-only source: legacy data only for stage/state cross-checking if needed.
- We do not depend on write access to legacy repos.

## Net-New Import Requirement

This cutover requires a new importer in this repo.

- planned entrypoint: `syncHHApplicants()` or equivalent
- planned responsibility:
  - call `listNegotiations()` per vacancy
  - filter by frozen window
  - upsert candidate, conversation, messages, pipeline state, HH negotiation, HH poll state
  - keep import idempotent

## Neon Dry Run Workstream

- Create `pr-<N>` Neon branch from `sandbox` in project `<dev-project-id>`.
- Run all migrations there.
- Keep `hh_import=false` and `hh_send=false` at start.
- Import only the in-scope dialogs.
- Validate row counts before and after import.
- Use this branch for UI review and dialog simulation.

## Moderation Workstream

- Replace hardcoded `10 minutes` with configurable `2 hours`.
- Planned config direction:
  - env var `MODERATION_AUTO_SEND_DELAY_HOURS`
  - wired through both `store.js` and `postgres-store.js`
- UI must show:
  - full message body
  - human-readable step goal
  - candidate
  - vacancy
  - send deadline
  - reason
  - review state
- Keep `block` and `send-now` working.

## Vacancy Mapping Table

| HH vacancy ID | Role | Target V2 job/config id | Notes |
| --- | --- | --- | --- |
| `131345849` | China procurement | `job-china-procurement-v1` | one vacancy → one V2 config |
| `131532142` | Designer | `job-wb-card-designer-v1` | dedicated HH mapping row |
| `131812494` | Designer | `job-wb-card-designer-v1` | second HH mapping row to same config initially |
| `132032392` | Sales | `job-sales-skolkovo-v1` | sales flow target |

## Vacancy Config Decision

- Executable configs must live in versioned repo data, not only prose docs.
- Initial storage format:
  - committed JSON seed/config files
  - one canonical mapping source for the 4 HH vacancy IDs

## Import Rules

- Export artifact must be a dated manifest with:
  - source environment
  - vacancy IDs
  - window start
  - window end
  - export timestamp
  - candidate count
  - message count
- Duplicate candidate policy:
  - same resume across different HH vacancy IDs remains separate conversation/import rows
  - do not deduplicate across vacancies in the first cutover slice

## Active Step Reconstruction

Planned deterministic reconstruction order:

1. explicit mapped legacy stage when available
2. else infer from imported HH collection and known outbound scripts
3. else infer from imported message history and submission artifacts
4. else place candidate into manual review instead of guessing

## Runtime Safety

- Verify HH message sorting by `created_at`.
- Separate import flow from reply-processing flow.
- Verify `awaiting_reply`, `hh_updated_at`, `next_poll_at`, `no_response_streak`.
- Add freeze-protection fallback only if explicitly implemented and tested.

## Testing Requirements

Add automated coverage for:

- configurable moderation delay
- readable step goal in moderation queue
- importer idempotency
- active-step reconstruction fallback to manual review

## Rollback Strategy

- Do not touch target environment until Neon dry run is accepted.
- Final import must produce a dated manifest and row-count report.
- If target import validation fails:
  - keep `hh_send=false`
  - keep old agent as active sender
  - remove imported rows via manifest keys or restore from Neon recovery point
- No live sending before post-import validation passes.

## Flag Procedure

- Before dry run:
  - `hh_import=false`
  - `hh_send=false`
- Before live polling after validated import:
  - enable `hh_import`
- Before any real outbound sending:
  - keep `hh_send=false` through UI review
  - enable `hh_send` only after explicit sign-off

Expected SQL shape:

```sql
UPDATE management.feature_flags
SET enabled = false, updated_at = now()
WHERE flag IN ('hh_import', 'hh_send');

UPDATE management.feature_flags
SET enabled = true, updated_at = now()
WHERE flag = 'hh_import';

UPDATE management.feature_flags
SET enabled = true, updated_at = now()
WHERE flag = 'hh_send';
```

## Execution Order

1. Finalize plan and open draft PR.
2. Implement minimum runtime and UI changes needed for dry run.
3. Create Neon branch and run migrations there.
4. Implement importer and import in-scope dialogs into Neon branch DB.
5. Simulate dialogs and review moderation UI there.
6. Fix issues from self-review and external review.
7. Re-run dry run until stable.
8. Perform final target-environment import.
9. Enable cutover with moderation-first sending.
10. Merge PR only after final checklist is green.

## Acceptance Criteria Before Human Review

- All 4 HH vacancy mappings exist.
- Source DB and Neon project are explicitly identified.
- Import filter by recent activity uses frozen absolute dates.
- Import is idempotent on Neon branch DB.
- Reconstruction rules for active step are documented and testable.
- Planned messages appear in moderation UI for simulated dialogs.
- UI shows full message text and readable step context.
- Premoderation timer is `2 hours`.
- No real HH sending occurs during dry run.

## Acceptance Criteria Before Merge

- Dry run completed on dedicated Neon branch.
- Row counts and sample dialogs checked after import.
- Simulated dialogs for procurement, designer, and sales reviewed.
- Self-review fixes applied.
- External review feedback applied or explicitly deferred.
- Rollback path documented and owned.
- Enable/disable procedure for `hh_import` and `hh_send` documented.

## Final Cutover Checklist

- Confirm target environment and Neon branch names.
- Confirm Neon project id `<dev-project-id>` and parent branch `sandbox` unless exception approved.
- Confirm exact export manifest timestamp and recent-activity window.
- Confirm all 4 HH vacancy mappings exist.
- Confirm recruiter auth exists for moderation UI.
- Confirm `hh_send=false` before import.
- Run final import and save manifest.
- Validate row counts and sample conversations.
- Validate moderation UI on imported candidates.
- Enable `hh_import` if polling is part of cutover.
- Enable `hh_send` only after manual sign-off on first planned messages.
- Monitor first real conversations after cutover.

## Temporary Artifact Note

This is a dated transition document and should be removable after the cutover is complete and the knowledge is absorbed into stable docs and code.
