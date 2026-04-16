# Child Issue 1: DB groundwork for `job_id` / `job_setup_id`

Parent issue: #146

## Goal

Prepare storage and internal read/write paths so the system can resolve:

- `job_id` as the canonical external identifier
- `job_setup_id` as the internal recruiter setup/runtime key
- legacy `vacancy_id` only as a temporary compatibility alias

This issue is intentionally limited to additive groundwork. It should not remove legacy paths yet.

## Scope

- management schema groundwork for `job_id` + `job_setup_id`
- access-context compatibility changes
- additive SQL migration and backfill
- tests for resolution and persistence invariants

## Non-goals

- full frontend selector cutover
- websocket/http contract cutover
- legacy field deletion

## Step Plan

1. Audit current schema and runtime writes that still persist `vacancy_id`.
2. Introduce additive schema changes so setup/runtime rows can carry:
   - canonical `job_id`
   - internal `job_setup_id`
   - legacy `vacancy_id` as compatibility alias
3. Backfill new fields from existing rows where a deterministic mapping already exists.
4. Update management/access store APIs to read and write the new fields consistently.
5. Keep old call sites working by resolving `vacancy_id` to `job_setup_id` internally during the transition window.
6. Add tests for:
   - create/update preserving `job_id`
   - legacy `vacancy_id` lookups still resolving
   - runtime rows no longer depending on `vacancy_id` as the only key
7. Run targeted tests and migration checks.

## Definition of Done

- additive migration exists in repo
- store layer can persist and read `job_id` + `job_setup_id`
- legacy `vacancy_id` still works only as compatibility input
- tests cover both new and legacy paths

## References

- `docs/recruiter-scoped-vacancy-access-design.md`
- `docs/database-map.md`
