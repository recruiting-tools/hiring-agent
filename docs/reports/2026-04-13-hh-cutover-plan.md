# HH Vacancy Cutover Plan

Date: 2026-04-13

Scope: full cutover preparation for 4 HH vacancies into `hiring-agent`, with review-first workflow, Neon DB branching for dry runs, and moderated outbound sending.

## Vacancies In Scope

- `131345849` — менеджер по закупкам из Китая
- `131532142` — дизайнер
- `131812494` — дизайнер
- `132032392` — менеджер по продажам

## Migration Boundary

- Import only candidates whose dialogs had activity in the last 5 days.
- Freeze the export window with absolute dates during each run.
- For the current planning pass, use `2026-04-08 00:00` through the export timestamp.
- For selected candidates, import the full dialog history, not only recent messages.
- Initial cutover target is reviewable planned messages in UI with premoderation before any real send.

## Why Use Both Git Branches And Neon Branches

### Git branch

Use a dedicated feature branch and draft PR to review:

- runtime changes
- schema migrations
- import/export scripts
- vacancy pipeline configs
- moderation UI changes
- tests and smoke flows

### Neon branch

Use a dedicated Neon branch to validate on a production-like Postgres copy:

- migrations
- idempotent imports
- HH negotiation state
- moderation queue behavior
- simulated dialog continuations

Rule: code review happens in GitHub PR; migration safety and data validation happen in Neon branches.

## Target Operating Model

1. Feature branch in git contains all code and docs for the cutover slice.
2. Draft PR is opened immediately and remains the main review surface.
3. A dedicated Neon branch is created from the target Postgres environment for dry run work.
4. All migrations and imports are first executed on the Neon branch.
5. UI and runtime behavior are reviewed against the Neon branch environment.
6. Only after successful dry run and reviewer sign-off do we repeat the final import on the target environment and merge the PR.

## Workstreams

### 1. Code And Review Workstream

- Create a dedicated feature branch.
- Open a draft PR early.
- Keep the plan, assumptions, and acceptance criteria in dated docs inside the repo.
- Commit in small logical slices:
  - plan/docs
  - runtime/schema
  - moderation UI
  - import/export
  - vacancy configs
  - tests

### 2. Neon Dry Run Workstream

- Create a dedicated Neon branch for this cutover.
- Run all pending migrations there.
- Seed or configure the target recruiter/test auth as needed.
- Import only the in-scope HH dialogs.
- Validate row counts before and after import.
- Use this branch as the environment for UI review and dialog simulation.

### 3. Vacancy Configuration Workstream

- Ensure all 4 HH vacancies map cleanly to V2 jobs.
- Keep the two designer HH vacancies as separate vacancy mappings even if they share one template.
- Finalize executable pipeline templates for:
  - China procurement
  - Designer
  - Sales
- Confirm all links, scripts, and step metadata needed by runtime and UI.

### 4. Moderation Workstream

- Change premoderation timer from hardcoded `10 minutes` to configurable `2 hours`.
- Show full planned message body in UI, not only preview.
- Show human-readable step goal in UI, not only `step_id`.
- Show candidate, vacancy, send deadline, reason, and review state.
- Keep `block` and `send-now` paths working.

### 5. Import / Export Workstream

- Export candidate set from the legacy side by:
  - HH vacancy ID
  - recent activity window
- Import into V2:
  - candidate
  - conversation
  - messages
  - pipeline run
  - step state
  - HH negotiation
  - HH poll state
- Keep the import idempotent.
- Reconstruct the active step in a deterministic way.

### 6. Runtime Safety Workstream

- Verify HH message sorting by `created_at`.
- Separate import flow from reply-processing flow.
- Add freeze-protection fallback:
  - if pre-filter skips a negotiation but local DB still has unanswered inbound, process it anyway
- Verify `awaiting_reply`, `hh_updated_at`, `next_poll_at`, `no_response_streak`.
- Keep `hh_send=false` during dry run until UI review is complete.

### 7. Simulation And QA Workstream

- Simulate several continuations per vacancy on the Neon branch DB.
- Confirm planned messages appear in moderation UI.
- Review copy quality, branching, homework detection, AI interview handling, and sales handoff.
- Fix obvious issues before handing over for human review.

## Execution Order

1. Finalize plan and open draft PR.
2. Implement the minimum runtime and UI changes needed for dry run.
3. Create Neon branch and run migrations there.
4. Export and import in-scope dialogs into the Neon branch DB.
5. Run simulated dialogs and moderation review on that environment.
6. Fix issues found in self-review and external review.
7. Re-run dry run if needed until behavior is stable.
8. Perform final target-environment import.
9. Enable cutover with premoderation-first sending.
10. Merge PR only after the cutover checklist is green.

## Acceptance Criteria Before Human Review

- All 4 HH vacancies are mapped in V2.
- Import filter by recent activity works with absolute date boundaries.
- Import is idempotent on the Neon branch DB.
- Planned messages appear in moderation UI for simulated dialogs.
- UI shows full message text and readable step context.
- Premoderation timer is `2 hours`.
- No real HH sending occurs during dry run.

## Acceptance Criteria Before Merge

- Dry run completed on a dedicated Neon branch.
- Row counts and sample dialogs checked after import.
- Simulated dialogs for procurement, designer, and sales reviewed.
- Self-review fixes applied.
- External review feedback applied or explicitly deferred.
- Final cutover checklist prepared for the target environment.

## Explicitly Out Of Scope For This Slice

- broad HH architecture cleanup not required for these 4 vacancies
- unrelated abstractions beyond what is needed for this cutover
- production rollout for vacancies outside the scoped HH IDs

## Temporary Artifact Note

This is a dated transition document and should be removable after the cutover is completed and the operational knowledge is absorbed into stable docs and code.
