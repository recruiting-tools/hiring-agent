# HH Review Step 1 XP Playbook (Sandbox-First)

This playbook is the executable version of **Step 1** from the project plan.

## Scope for Step 1

- `GET /api/hh/vacancies/:vacancy_id/responses`
- `GET /api/hh/negotiations/:negotiation_id`
- persistent normalized snapshots
- vacancy cursor model
- same-vacancy sync exclusion

No send / screening state persistence / playbooks in Step 1.

## Iteration Template

For every iteration in sandbox, fill:

- `goal`
- `files changed`
- `checks run`
- `result`
- `risks`
- `next action`

Before each iteration:
1. sync from `main` as described in the project plan
2. run target scenario tests only for the changed behavior
3. only after targeted tests pass, run sandbox smoke checks

Targeted tests per iteration:
- iterate only the test set needed for changed code (e.g., endpoint contract or cursor logic)
- avoid full-suite runs as default to reduce iteration latency
- keep a failure budget low: no silent skips in required checks

One-command iteration runner:
```bash
cd /Users/vova/Documents/GitHub/hiring-agent
TEST_CMD="pytest -k 'step1'" SMOKE_CMD="python scripts/smoke_step1.py --base-url http://127.0.0.1:19090 --vacancy 132102233" /Users/vova/Documents/GitHub/hiring-agent/scripts/hh-review-step1-sandbox-loop.sh
```

### Iteration 1.0 — read endpoint + stable list contract

Objective:
- deliver deterministic vacancy response listing, including ordering and pagination fields.

Definition of done:
- endpoint returns normalized items with fields specified in Step 1 spec
- order is deterministic for same filter window by `last_activity_at desc, negotiation_id desc`
- tests assert:
  - response item schema includes required fields
  - ordering invariant is stable
  - pagination metadata `has_more` and `source_synced_at` exists
- smoke check only if endpoint depends on hh integration is available:
  - 1 request for `132102233` works and returns 200

Allowed risk posture:
- do not assert exact item count in smoke
- do not assert full raw hh JSON

### Iteration 1.1 — persistence + cursor safety

Objective:
- implement snapshot and cursor writes that are atomic enough for reruns.

Definition of done:
- `hh_negotiation_snapshot`, `hh_negotiation_message_snapshot`, `hh_vacancy_sync_cursor` persisted
- sync failure leaves cursor unchanged
- tests assert:
  - failed sync keeps prior cursor state
  - dedupe path does not create duplicates when no changes
- local fault-injection test or synthetic failure run is executed before moving on.

### Iteration 1.2 — sync concurrency safety

Objective:
- prevent concurrent cursor corruption on the same vacancy.

Definition of done:
- same-vacancy sync exclusion is present and deterministic (lease/lock/Advisory lock)
- tests assert:
  - two overlapping sync invocations resolve to one successful completion path
  - only one cursor finalization for the same window
- smoke:
  - if possible, run two quick concurrent read calls in sandbox and verify non-divergent cursor status

### Iteration 1.3 — negotiation normalization + replay hardening

Objective:
- deliver negotiation detail shape stable and resilient to fixture variants.

Definition of done:
- `GET /api/hh/negotiations/:negotiation_id` returns canonical thread shape
- message ids and direction are stable
- tests assert:
  - missing fields are tolerated (nullable behavior)
  - duplicate raw messages collapse by canonical id
  - synthetic replay fixtures cover edge cases (one message, multiple, duplicates, reordered fields)
- live smoke:
  - open one known `132102233` negotiation id and verify resume/thread normalization

## Invariants to protect across all iterations

- no cursor advancement on any failed sync completion
- no outbound send logic in Step 1
- no hardcoded dependency on one live vacancy list snapshot
- no strict raw payload snapshots with brittle field ordering
- all failures log correlation id for traceability

## Bounded smoke rules for Step 1

- smoke is an availability and shape smoke only; it does not validate full business semantics.
- expected variance from run to run:
  - candidate count
  - ordering of equal timestamps
  - optional presence of fields that are nullable/absent in hh
- accepted if:
  - endpoint returns schema-compliant payload
  - sync returns non-empty/empty according to current external state
  - no auth/transport regression is introduced

## Iteration closure checklist (before moving to Step 2)

- all Step 1 acceptance criteria green in local/fixture suite
- at least one live smoke call per endpoint touched
- iteration log contains scope transition and rationale
- freeze note includes: what changed, what was skipped, and rollback path

## Exit rule for Step 1

Do not enter Step 2 until:
- Step 1 acceptance criteria are green in the last green iteration
- no open critical issue in cursor/sync/normalization path
- fixture set is updated or explicitly marked as unchanged
