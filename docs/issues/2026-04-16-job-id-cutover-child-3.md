# Child Issue 3: cleanup, rollout hardening, and legacy removal plan

Parent issue: #146

## Goal

Finish the migration safely after the new contract has been running: tighten validation, reduce legacy surface, and codify the production rollout path.

## Scope

- cleanup tasks after compatibility window
- docs/runbook updates for Neon branch validation and deploy order
- legacy compatibility deprecation checklist
- final validation and smoke matrix

## Non-goals

- first-wave additive schema changes
- first-wave API cutover implementation

## Step Plan

1. Enumerate the remaining legacy `vacancy_id` entry points after child issues 1 and 2 land.
2. Add explicit deprecation notes and a removal checklist with release sequencing.
3. Tighten constraints where safe:
   - `job_id` required on canonical rows
   - no new canonical writes that omit `job_id`
4. Update release runbooks for:
   - ephemeral Neon branch validation
   - sandbox deploy of the same SHA
   - production promotion only after smoke
5. Define the final cleanup migration sequence for dropping old aliases/views/columns.
6. Add regression coverage proving no canonical client path still depends on `vacancy_id`.

## Definition of Done

- cleanup plan is explicit and sequenced
- release docs reflect Neon branch and CI/CD usage for this migration
- remaining legacy surface is intentionally limited and documented

## References

- `docs/release-process.md`
- `docs/neon-sandbox-runbook.md`
- `docs/sandbox-plan.md`
