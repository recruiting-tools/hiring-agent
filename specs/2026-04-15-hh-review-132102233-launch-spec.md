# HH Vacancy 132102233 Launch Spec

## Purpose

This document describes the exact vacancy-specific data, playbook, and launch-time settings required to run hh response review for vacancy `132102233` on top of the hiring-agent hh review architecture.

Use this document to answer:
- what data must be configured before launch
- what rules apply to this vacancy
- what the agent should ask candidates
- when outreach must stop
- what a successful run looks like

This document should be treated as a concrete `hiring agent` playbook binding for one vacancy.

## Vacancy Identity

Required fields:
- `vacancy_id`: `132102233`
- `account_id`: hh employer/account identifier used by Clawd
- `mode`: `pre_routing` initially unless a mapped internal `job_slug` already exists
- `job_slug`: optional at launch, required later if this vacancy should merge into the normal pipeline

## Operational Goal

For this vacancy, the operator needs to:

1. review incoming responses
2. ask the same screening questions to suitable candidates
3. collect only enough useful contacts
4. stop extra outreach when the quota is filled
5. produce a report after each pass

## Required Launch Inputs

These inputs must be filled before the run is considered production-ready.

### A. Ownership and routing

- hh account / employer connection is active
- vacancy is readable by recruiter-safe hh endpoints
- sender identity for hh outbound messages is known
- optional `job_slug` for later internal linkage
- responsible human owner for manual escalation

### B. Playbook payload

- opening message text
- question order
- qualification checks
- rejection rules
- Telegram handoff text
- FAQ answers for common candidate objections
- playbook id / version binding used by the hiring agent

### C. Stop-policy

- `max_useful_contacts`
- `pause_outreach_when_reached`
- `reserve_candidates_when_paused`
- `resume_outreach_if_qualified_count_drops_below`

### D. Run defaults

- default `operator_mode`
- whether first runs are `dry_run` or live-send
- default `collections`
- default `unread_only`
- poll / review cadence

## Vacancy-Specific Screening Rubric

Required checks:
- профильное высшее образование
- diploma explicitly confirmed
- SNILS available
- Gosuslugi linked
- ready to sign participation through Gosuslugi
- accepts `7500 = 2500 + 2500 + 2500`
- understands that review can be critical and negative
- ready to move to Telegram `@kobzevvv`

Minimum rejection buckets:
- `rejected_no_diploma`
- `rejected_no_gosuslugi`
- `rejected_no_snils`
- `rejected_price_mismatch`
- `rejected_declined_signing`
- `rejected_declined_review_conditions`

Intermediate buckets:
- `needs_first_message`
- `waiting_candidate_reply`
- `needs_manual_review`
- `held_contact_limit_reached`

Positive bucket:
- `qualified_for_handoff`

## Opening Message Requirements

The first message should ask only the required checks and explain the context briefly:
- профильное образование + диплом
- СНИЛС
- привязанные Госуслуги
- готовность официально участвовать через подписание на Госуслугах
- готовность к оплате `7500`
- понимание, что ревью может быть любым по жёсткости

If all answers are positive:
- send Telegram `@kobzevvv`

If quota is already reached:
- do not hand off immediately
- place the candidate into reserve
- persist explicit hold reason

## Suggested Launch Configuration For Vacancy 132102233

These values reflect the current understanding from the manual pass and can be adjusted before launch.

- `max_useful_contacts`: `6`
- `pause_outreach_when_reached`: `true`
- `reserve_candidates_when_paused`: `true`
- `resume_outreach_if_qualified_count_drops_below`: `4`
- `operator_mode`: `manual_assisted` for first launch
- `dry_run`: `false` only after endpoint safety is validated
- `collections`: `response`
- `unread_only`: `false` for the first full catch-up pass, then `true` for incremental passes

## Data The System Must Persist For This Vacancy

### Vacancy-level config

- playbook version
- stop-policy
- current review cursor
- active run lock if any
- latest report artifact

### Per-negotiation state

- `negotiation_id`
- `resume_id`
- latest hh status / collection
- last activity timestamp
- structured screening checks
- decision reason code
- hold / reserve state
- outbound handoff state
- linked internal candidate id if created

### Per-run artifact

- `run_id`
- time window processed
- candidates seen
- candidates contacted
- candidates replied
- candidates qualified
- candidates rejected
- candidates held due to quota
- send failures and blockers

## Launch Readiness Checklist

The run for vacancy `132102233` is launch-ready only when all of the following are true:

1. `GET /api/hh/vacancies/132102233/responses` works without internal job mapping.
2. `GET /api/hh/negotiations/:negotiation_id` returns resume, thread, and message ids.
3. `POST /api/hh/negotiations/:negotiation_id/messages` supports idempotent live send and dry-run preview.
4. Screening state read/write is available.
5. Playbook for vacancy `132102233` is saved and versioned.
6. Stop-policy for quota `6` is saved.
7. Report generation from a persisted run works.
8. hh auth health and failure visibility are available to operators.

## Launch Sequence

### First launch

1. create or save the vacancy playbook
2. save vacancy stop-policy
3. verify hh auth health
4. run a catch-up pass over all current responses
5. review the generated report
6. confirm that sent messages, state persistence, and quota behavior match expectations

### Ongoing passes

1. use the saved vacancy cursor
2. process only changed negotiations
3. continue screening based on structured state
4. stop outreach when useful-contact quota is reached
5. generate a report after each pass

## Open Launch Decisions Still Needed

Before calling this vacancy fully configured, the team should explicitly confirm:
- whether the vacancy remains in `pre_routing` mode or should be linked to a `job_slug`
- whether first production runs should remain `manual_assisted` or allow `auto_send`
- whether any candidates above quota should receive a reserve message or simply be held silently
- whether Telegram handoff should always happen immediately after qualification or only while quota is still open

## Outcome

Once this vacancy-specific data is configured on top of the architecture spec, Clawd can run hh review for vacancy `132102233` in a controlled, repeatable way.
