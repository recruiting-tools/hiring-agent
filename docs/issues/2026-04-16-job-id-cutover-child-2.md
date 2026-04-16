# Child Issue 2: API and UI contract cutover to `job_id`

Parent issue: #146

## Goal

Switch recruiter-facing contracts to `job_id` as the only canonical external identifier while still tolerating legacy inputs during the rollout window.

## Scope

- `/api/jobs` returns `job_id`-first contract
- selector and persisted state move from `vacancy_id` to `job_id`
- `/api/chat`, websocket payloads, report/read endpoints use `job_id` first
- legacy `vacancy_id` accepted only as compatibility input

## Non-goals

- ACL rollout
- final removal of legacy aliases
- HH provider contract renames

## Step Plan

1. Audit current recruiter-facing routes and frontend state that still send or persist `vacancy_id`.
2. Normalize backend request parsing so `job_id` is primary and `vacancy_id` is only a fallback alias.
3. Update `/api/jobs` payload shape so `job_id` is mandatory and `job_setup_id` is optional debug/internal metadata.
4. Move selector state and local persistence to `job_id`.
5. Update websocket/chat/report flows to send `job_id` canonically.
6. Add contract and integration tests for mixed-mode requests:
   - `job_id` works as primary input
   - `vacancy_id` still resolves via compatibility path
7. Run sandbox smoke to confirm recruiter flow still works after cutover.

## Definition of Done

- recruiter UI stores selected job by `job_id`
- backend routes are `job_id`-first
- websocket and chat requests use `job_id`
- legacy `vacancy_id` is no longer required by any canonical client path

## References

- `docs/recruiter-scoped-vacancy-access-design.md`
- `docs/hiring-agent-ui-replication-spec.md`
