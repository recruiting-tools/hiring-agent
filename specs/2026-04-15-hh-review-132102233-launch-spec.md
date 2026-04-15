# HH Vacancy 132102233 Launch Spec

## Purpose

This document describes the exact vacancy-specific data, playbook, and launch-time settings required to run hh response review for vacancy `132102233` on top of the hiring-agent hh review architecture.

Use this document to answer:
- what data must be configured before launch
- what rules apply to this vacancy
- what the agent should ask candidates
- when outreach must stop
- what a successful run looks like
- how a human-led production session should migrate this vacancy into the hiring-agent toolchain
- what is already covered by current sandbox tooling versus what must still be done in production

This document should be treated as a concrete `hiring agent` playbook binding for one vacancy.

## Current Delivery Context

As of `2026-04-15`, the repo already contains:

- architecture baseline for hh review
- sandbox-first step-1 tooling and fixture smoke
- launchd / cron helpers for repeated sandbox validation
- deterministic hh mock data for vacancy `132102233`

What is not yet delivered as production-ready product behavior:

- live hh review playbook execution inside the production hiring-agent runtime
- persisted production screening state for this vacancy
- safe live-send orchestration for hh negotiation messages under production policy
- production operator UI/API flow that fully replaces the manual hh.ru review loop

This means the correct near-term production mode is:

- human-led review session
- vacancy-specific configuration captured in this spec
- migration of the vacancy into hiring-agent concepts and data shape first
- live operational use only for the parts that are already safe and implemented
- remaining gaps closed iteratively after sandbox validation

## What Changed In The HH Review Sandbox Chain

Useful confirmed updates from the current repo state:

1. `POST /internal/hh-import` is now the main manual import lever for bringing an hh vacancy into the system.
2. The import path uses `HH_VACANCY_JOB_MAP` to translate hh vacancy ids into internal `job_id` targets.
3. The import endpoint accepts a time window:
   - `window_start` is required
   - `window_end` is optional
4. `POST /internal/hh-poll` remains the incremental follow-up lever for new messages in already imported negotiations.
5. The sandbox hh mock endpoint `/api/hh/vacancies/<vacancy_id>/responses` now supports:
   - `unread_only=true`
   - `updated_after`
   - `updated_before`
6. The mock fixtures now include `unread`.
7. `scripts/smoke_hh_step1.py` already checks these filters in sandbox.

Operational meaning:

- manual session handoff into the system now goes through import window + vacancy mapping
- sandbox can validate "new/unread/updated in window" behavior before production rollout

## Vacancy Identity

Required fields:
- `vacancy_id`: `132102233`
- `account_id`: hh employer/account identifier used by Clawd
- `mode`: `pre_routing` initially unless a mapped internal `job_slug` already exists
- `job_slug`: optional at launch, required later if this vacancy should merge into the normal pipeline
- `tenant`: production hiring-agent tenant that will own this vacancy workflow
- `owner_session_type`: `manual_migration` for the first production session

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

## Production Migration Goal

The first production session for this vacancy should not try to "turn on full automation".

Its actual goal is narrower:

1. register the vacancy in our system with the same business meaning the human already uses manually
2. bind that vacancy to a hiring-agent compatible playbook/config shape
3. make the required screening data explicit and versioned
4. ensure the operator can run the same review logic repeatably without relying on memory
5. keep live-send and state mutation only in the parts that are already proven safe

This is a migration from:

- ad hoc manual hh review

to:

- production vacancy config
- explicit playbook binding
- reusable hiring-agent tooling/playbook language
- iterative replacement of manual steps by safe system steps

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

## Canonical Vacancy Playbook Payload

The production session should capture the vacancy in a structured payload equivalent to:

- `playbook_id`: `hh_review_132102233`
- `playbook_version`: `v1`
- `channel`: `hh`
- `vacancy_id`: `132102233`
- `opening_message_template`:
  - asks for diploma / SNILS / Gosuslugi / signing readiness / price acceptance / review-conditions acceptance
- `question_order`:
  1. профильное образование и диплом
  2. СНИЛС
  3. привязанные Госуслуги
  4. готовность официально подписывать участие через Госуслуги
  5. согласие на стоимость `7500 = 2500 + 2500 + 2500`
  6. понимание, что ревью может быть критичным
  7. переход в Telegram `@kobzevvv`
- `qualification_checks`:
  - `has_relevant_degree`
  - `has_diploma`
  - `has_snils`
  - `has_gosuslugi`
  - `accepts_gosuslugi_signing`
  - `accepts_price_7500`
  - `accepts_hard_review_conditions`
- `handoff_channel`:
  - `type`: `telegram`
  - `value`: `@kobzevvv`
- `quota_policy`:
  - `max_useful_contacts`: `6`
  - `pause_outreach_when_reached`: `true`
  - `reserve_candidates_when_paused`: `true`
  - `resume_outreach_if_qualified_count_drops_below`: `4`

The exact storage schema can still evolve, but this business payload should remain stable.

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

## Human-Led Production Session Plan

This is the plan for a session that currently reviews candidates manually and now wants to move this vacancy onto our system.

### Phase 1. Register and bind

Do in production first:

1. Identify the production `tenant` that owns vacancy `132102233`.
2. Confirm the hh `account_id` / employer binding used by Clawd for that vacancy.
3. Decide whether the vacancy stays in `pre_routing` mode or is immediately linked to a `job_slug`.
4. Create or update the vacancy record in our production system so the vacancy exists as a first-class object, not just an hh id in operator notes.
5. Save the vacancy-specific playbook/config from this document as versioned data.

The key migration rule:

- the human process must become explicit system config before we try to automate the review loop itself

### Phase 2. Enable hiring-agent prerequisites

Before the session relies on hiring-agent playbooks, verify production prerequisites:

1. management DB is reachable
2. tenant chatbot DB is reachable
3. production tenant has required playbooks enabled
4. playbook definitions are present and not stale
5. runtime environment points to production DBs and intended model env vars
6. migration `services/candidate-chatbot/migrations/009_hh_oauth_and_flags.sql` is applied in the target environment
7. feature flag `hh_import` can actually be read and enabled in production
8. internal auth token for `/internal/hh-import` and `/internal/hh-poll` is present

Repo assets relevant to this:

- playbook seeding: `/Users/vova/Documents/GitHub/hiring-agent/scripts/seed-playbooks.js`
- tenant playbook access: `/Users/vova/Documents/GitHub/hiring-agent/scripts/admin-playbooks.js`
- general workflow rules: `/Users/vova/Documents/GitHub/hiring-agent/AI-AGENT.md`
- release/runtime notes: `/Users/vova/Documents/GitHub/hiring-agent/README.md`

Critical production note:

- if migration `009_hh_oauth_and_flags.sql` is not applied, `hh_import` cannot be enabled correctly and import/poll cutover is blocked

### Phase 3. Mirror the current manual review contract

For the first production run, the operator should be able to answer these questions from system state:

1. which responses belong to vacancy `132102233`
2. which candidates were already reviewed
3. what answers were collected for each required check
4. who is qualified for handoff
5. who is rejected and why
6. who is on hold because the useful-contact quota is already full

If the runtime cannot yet answer those questions from persisted production state, the gap is still open and manual tracking remains necessary.

### Phase 4. Replace manual steps one by one

Only after the above is stable:

1. use system read-paths for vacancy responses and negotiation details
2. persist screening state instead of keeping notes outside the system
3. enable safe hh outbound send path with idempotency and auditability
4. generate repeatable run reports after each pass

This sequence matters because read-path and state-path failures are easier to contain than send-path failures.

## What The Operator Must Enter For This Vacancy

When migrating this vacancy by hand, the operator should explicitly provide and save:

- `tenant`
- `vacancy_id = 132102233`
- `account_id`
- `mode = pre_routing` unless `job_slug` is already agreed
- optional `job_slug`
- `responsible_owner`
- `playbook_id = hh_review_132102233`
- `playbook_version = v1`
- opening message text approved for hh
- qualification checks listed in this document
- rejection reason codes listed in this document
- Telegram handoff target `@kobzevvv`
- quota policy `6 / pause / reserve / resume at 4`
- launch mode `manual_assisted`
- first pass setting `unread_only = false`
- incremental pass setting `unread_only = true`

## Production Commands And Operational Hooks

The repo already contains supporting operational scripts, but they are not themselves the production hh-review feature.

Use them as follows:

- `POST /internal/hh-import`
  - primary manual import entrypoint for handing a vacancy into the system
- `POST /internal/hh-poll`
  - follow-up incremental polling for already imported vacancy/job mappings
- `node scripts/seed-playbooks.js`
  - ensure playbook definitions exist in management DB
- `node scripts/admin-playbooks.js list <tenant>`
  - inspect which playbooks the target tenant can use
- `node scripts/admin-playbooks.js enable <tenant> <playbook>`
  - enable needed playbook access for the tenant
- `scripts/hh-review-step1-sandbox-loop.sh`
  - sandbox iteration loop for read-path work only
- `scripts/hh-review-install-loop-launchd.sh`
  - local macOS repeated validation helper for sandbox checks
- `scripts/hh-review-mock-start.sh`
  - local deterministic hh mock server for non-production smoke
- `scripts/smoke_hh_step1.py`
  - smoke for the current step-1 read contract

Important boundary:

- sandbox loop and hh mock scripts validate development iterations
- they do not replace production cutover checks against the real runtime

## Manual Session Handoff Procedure

For the current system shape, the operator session should hand the vacancy over like this.

### 1. Set vacancy-to-job mapping

The import path expects a mapping from hh vacancy to internal job:

```bash
export HH_VACANCY_JOB_MAP='[
  {"hh_vacancy_id":"<hh_vacancy_id>","job_id":"<job_id>","collections":["response","phone_interview"]}
]'
```

Interpretation:

- `hh_vacancy_id` is the hh vacancy being imported
- `job_id` is the internal job target shown in recruiter queue/UI
- `collections` determines which hh collections are imported for that vacancy

### 2. Set internal auth and environment mode

```bash
export INTERNAL_API_TOKEN="<token>"
export HH_USE_MOCK="true"
```

Use `HH_USE_MOCK=true` only in sandbox/local validation, not for real production cutover against live hh.

### 3. Verify import gating

Before any import, confirm:

- runtime has `hh_import=true`
- internal API token is configured
- vacancy mapping env is present and parses correctly

If `hh_import` is disabled, import returns:

- `skipped: true`

### 4. Run the initial import window

`window_start` is mandatory:

```bash
curl -X POST http://127.0.0.1:3000/internal/hh-import \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "window_start":"2026-04-15T00:00:00.000Z",
    "window_end":"2026-04-16T00:00:00.000Z"
  }'
```

Use this as the first catch-up import for the vacancy handoff session.

### 5. Poll for new activity after import

After the initial import, incremental updates should go through:

```bash
curl -X POST http://127.0.0.1:3000/internal/hh-poll \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN"
```

### 6. Hand the operator the queue URL

After mapping/import, the operator should work from the internal queue:

- `/recruiter/<recruiter_token>/queue?job_id=<job_id>`
- or `/recruiter/<recruiter_token>` with vacancy selected manually

This is the actual "transfer vacancy into the system" moment:

- hh vacancy id becomes an internal `job_id` scoped workflow in recruiter UI

## Short TL;DR For The Session

If another session needs the shortest possible instruction set, give it this:

- vacancies enter the system only through `HH_VACANCY_JOB_MAP -> job_id`
- without `INTERNAL_API_TOKEN`, `import` and `poll` do not pass
- `window_start` is mandatory for `POST /internal/hh-import`
- `hh_import=true` must be enabled or import is skipped
- in sandbox/mock, use `unread_only=true` to validate unread/new response behavior

## Production Readiness For Manual Migration

This vacancy can be considered "migrated onto our system" only when all of the following are true:

1. The vacancy exists as explicit production config under the correct tenant.
2. The playbook/config for vacancy `132102233` is versioned and recoverable.
3. The operator no longer needs private memory to know what to ask and when to stop.
4. The quota policy is encoded in system data, not only in a note.
5. The handoff target `@kobzevvv` is encoded in system data, not only in a note.
6. Production read-paths for vacancy responses and negotiation details are available or there is an explicitly documented gap.
7. Any still-manual production step is named explicitly, with owner and rollback path.

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

For the current production migration stage, interpret this checklist in two tiers:

- `migration-ready`
  - vacancy config, playbook payload, quota policy, and operator contract are explicit and saved
- `automation-ready`
  - live hh read/state/send/report surfaces are implemented and validated

## Launch Sequence

### First launch

1. create or save the vacancy playbook
2. save vacancy stop-policy
3. bind the vacancy to the correct production tenant/account context
4. verify playbook availability for that tenant
5. verify hh auth health
6. run a catch-up pass over all current responses
7. review the generated report
8. confirm that sent messages, state persistence, and quota behavior match expectations

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
- whether this vacancy will be expressed as a dedicated hh-review playbook or as a generic hiring-agent screening playbook with hh channel config
- which production surface is the source of truth for screening state until full hh-review productization lands

## Outcome

Once this vacancy-specific data is configured on top of the architecture spec, Clawd can run hh review for vacancy `132102233` in a controlled, repeatable way.

For the current stage, the expected immediate outcome is slightly narrower:

- the vacancy is translated into hiring-agent concepts cleanly
- the production session has an explicit migration/runbook
- sandbox tooling continues validating the implementation gap
- future automation can replace manual review incrementally without redefining the business rules again
