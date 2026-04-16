# Parent Issue: complete `vacancy_id -> job_id` / `vacancy -> job_setup` migration

## Goal

Complete the migration in a safe rollout sequence:

- unify all external resource contracts around `job_id`
- rename the internal recruiter setup layer from `vacancy` to `job_setup`
- preserve `job_setup_id` as the internal runtime key
- use Neon branches and CI/CD gates to validate every risky step before merge and production deploy

## Why this is split

This change crosses schema, runtime naming, frontend/backend contracts, and deployment discipline. Doing it in one shot would mix identifier bugs, naming bugs, and rollout bugs into one failure domain.

The work is split into three child issues so each phase has a clean Definition of Done and can be validated independently.

## Child Issues

- [x] #142 Phase 1A: DB groundwork for `job_id` / `job_setup_id`
- [x] #144 Phase 1B: API and UI contract cutover to `job_id`
- [x] #145 Phase 1C: cleanup, rollout hardening, and legacy removal plan

## Delivery Rules

1. Use additive migrations first, never destructive rename-first rollout.
2. Treat `job_id` as the only canonical external identifier.
3. Treat `job_setup_id` as internal-only runtime/setup identity.
4. Keep `vacancy_id` only as a temporary compatibility alias.
5. Validate schema changes on an ephemeral Neon branch before merge.
6. Promote only the same SHA that passed sandbox/pre-prod smoke.

## Overall Acceptance Criteria

- canonical external contract is `job_id`
- internal setup/runtime naming is `job_setup`
- `job_setup_id` is preserved as internal runtime key
- CI blocks merge when migration validation fails
- production rollout is documented and executable through existing sandbox/Neon flow
- remaining `vacancy_id` usage is explicitly limited to compatibility and provider-specific adapters

## References

- `docs/recruiter-scoped-vacancy-access-design.md`
- `docs/neon-sandbox-runbook.md`
- `docs/release-process.md`
