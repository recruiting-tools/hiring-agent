# Hiring Agent HH Review Architecture Spec

## Purpose

This document defines the production-safe architecture required for Clawd to process hh.ru responses without direct hh.ru UI work, DB spelunking, or operator memory.

This architecture should become reusable tooling and playbook infrastructure for the `hiring agent`, not a one-off flow for a single vacancy.

It is intentionally vacancy-agnostic.
Vacancy-specific launch data belongs in a separate launch spec.

## Review Findings

### Critical gaps in the prior tooling draft

1. Raw read/send endpoints were described, but the ingestion model was missing.
Without sync cursor semantics and update rules, the agent cannot reliably answer "what is new since the previous pass?".

2. Screening state was named, but not modeled tightly enough.
Without structured statuses, evidence, timestamps, and decision reasons, repeated passes are not automatable.

3. Message sending lacked safety rules.
Without idempotency guarantees, locks, dry-run behavior, quota enforcement, and audit history, duplicate or conflicting sends are likely.

4. Report generation was under-specified.
Without a persisted run model, reports cannot be reproduced and may differ depending on reconstruction logic.

5. Raw hh entities and internal recruiter entities had no defined linkage lifecycle.
Pre-routing mode is useful, but we still need explicit linkage and deduplication rules.

6. Operational safety was missing.
Auth failure handling, hh token health, retries, rate limits, locking, and recovery are mandatory for an independent agent.

## Target Outcome

An independent agent should be able to:

1. discover all new or updated hh responses for a vacancy
2. inspect resume, response letter, and thread
3. decide what action is needed next
4. persist structured screening state
5. send safe outbound messages when policy allows
6. generate a reproducible report after each pass

At the platform level, the same capability should later support:
- hh vacancy review
- mapped-job screening flows
- repeated recruiter playbooks across multiple vacancies
- future channel adapters that follow the same run/state/playbook model

## Scope

This spec covers:
- product/API behavior
- state model
- run model
- sync semantics
- safety guarantees
- acceptance criteria

This spec does not require:
- direct DB access by the agent
- raw hh credentials exposed to the agent
- a full rewrite of the production recruiting pipeline before urgent review works

## Hiring Agent Productization Principle

Everything defined here should be implemented as reusable `hiring agent` primitives:
- tools the agent can call safely
- playbooks the agent can load as data
- state the agent can update incrementally
- run artifacts the agent can report from

This means:
- no vacancy-specific logic hardcoded into agent execution
- no hh-specific wording embedded into the run engine
- vacancy behavior should come from playbook + policy + channel adapter

## Shared Capability Layers

To make this useful beyond one vacancy, the platform should be split into four layers:

### 1. Channel adapter layer

Responsibilities:
- fetch raw responses/messages from hh
- normalize hh entities into internal canonical shapes
- send outbound messages through hh safely

Examples:
- vacancy response listing
- negotiation thread read
- negotiation message send

### 2. Hiring agent tooling layer

Responsibilities:
- provide recruiter-safe tools the agent can call
- persist screening state
- persist run items and reports
- enforce policy and idempotency

Examples:
- `list_responses`
- `get_candidate_thread`
- `update_screening_state`
- `send_candidate_message`
- `start_review_run`
- `generate_run_report`

### 3. Playbook layer

Responsibilities:
- define screening checks
- define message templates
- define question order
- define rejection rules
- define handoff rules
- define stop-policy

Playbooks must be data-driven and versioned.

### 4. Vacancy configuration layer

Responsibilities:
- bind a concrete vacancy to a playbook
- set thresholds and stop-policy values
- choose launch mode
- define the human escalation owner

## Functional Requirements

### FR-1. Vacancy-scoped raw hh review without job mapping

The system must support pre-routing mode where the agent works directly with an hh vacancy before an internal `job` is fully configured.

### FR-2. Deterministic incremental processing

The system must support repeated passes over the same vacancy and correctly distinguish:
- newly arrived responses
- newly updated threads
- candidates already processed earlier
- candidates intentionally held because quota was reached

### FR-3. Structured screening memory

The system must store machine-readable screening facts plus evidence, not only raw thread text.

### FR-4. Safe outbound messaging

The system must support hh outbound messaging with idempotency, concurrency protection, dry-run support, and audit logging.

### FR-5. Vacancy-local playbook loading

The system must support vacancy-specific screening logic and message templates, but the platform should treat that as data, not hardcoded workflow.

### FR-6. Run artifact and reporting

Each review pass must create a durable run artifact that can later reproduce what was seen, decided, and sent.

### FR-7. Hiring agent reusable tool surface

The platform must expose the hh review flow as reusable `hiring agent` tools and playbooks, so the same execution model can be reused by other vacancies and later by other channels.

## Domain Model

### Core entities

`hh_vacancy_review_target`
- `vacancy_id`
- `account_id`
- `mode`: `pre_routing` | `mapped_job`
- optional `job_slug`
- active playbook version
- active stop-policy

`hh_negotiation_snapshot`
- `negotiation_id`
- `vacancy_id`
- `resume_id`
- candidate name
- current hh status / collection
- unread flag if available
- response created timestamp
- last thread activity timestamp
- raw hh payload hash
- last synced at

`hh_negotiation_screening_state`
- `negotiation_id`
- `vacancy_id`
- overall status
- per-check statuses
- evidence summary
- last inbound message at
- last outbound message at
- last reviewed at
- last reviewed by
- active hold reason if any
- linked internal candidate id if created

`hh_review_run`
- `run_id`
- `vacancy_id`
- playbook version used
- operator mode
- started at
- completed at
- baseline timestamp/cursor
- result summary
- report artifact path/id

`hh_review_run_item`
- `run_id`
- `negotiation_id`
- classification before action
- action taken
- send result if any
- classification after action
- explanation / reason code

## Screening State Model

### Overall statuses

Allowed values:
- `new_unreviewed`
- `needs_first_message`
- `waiting_candidate_reply`
- `needs_manual_review`
- `qualified_for_handoff`
- `held_contact_limit_reached`
- `rejected`
- `closed`

### Per-check field shape

Each screening check must store:
- `status`: `unknown` | `yes` | `no` | `ambiguous`
- `source`: `resume` | `response_letter` | `thread_message` | `manual_override`
- `evidence_text`
- `evidence_message_id` optional
- `updated_at`

### Decision fields

The state must also capture:
- `decision_reason_code`
- `decision_note`
- `next_action`
- `hold_until` optional
- `playbook_version`

Minimum reason code family:
- `awaiting_required_answers`
- `already_answered_sufficiently`
- `contact_quota_reached`
- `qualified_send_handoff`
- `rejected_*`
- `reserve_after_quota`

## Sync and Freshness Semantics

### Required behavior

The system must support vacancy review passes based on a stable baseline, not a best-effort scan.

Each run must record:
- `cursor_started_from`
- `cursor_ended_at`
- `updated_after` used for hh reads
- total negotiations returned by hh
- total negotiations actually processed

### Incremental change definition

A negotiation counts as changed if any of the following happened after the previous run cursor:
- new response created
- new inbound or outbound thread message appeared
- hh collection/status changed
- resume payload changed
- unread state changed, if hh exposes it

### Sync strategy

Minimum acceptable implementation:
- poll hh by vacancy with `updated_after`
- persist last successful cursor per vacancy
- on each run, read all changed negotiations since previous cursor
- update local snapshots before agent reasoning begins

Recommended safety margin:
- overlap the polling window by a small backfill interval
- deduplicate by `negotiation_id + message_id + updated_at`

## Required Recruiter-Safe APIs

These APIs are the first concrete channel adapter for the hiring agent.
At the hiring-agent layer, they should map to stable tool intents rather than exposing hh quirks directly everywhere.

### 1. List vacancy responses without job mapping

`GET /api/hh/vacancies/:vacancy_id/responses`

Query params:
- `collection` optional, default `response`
- `page`
- `per_page`
- `updated_after`
- `updated_before` optional
- `unread_only`
- `include_thread_preview` optional
- `include_screening_state` optional

Response item fields:
- `negotiation_id`
- `vacancy_id`
- `candidate_name`
- `resume_id`
- `collection`
- `hh_status`
- `unread`
- `response_created_at`
- `last_activity_at`
- `resume_preview`
- `response_letter_preview`
- `existing_candidate_id` if linked
- `screening_status` if known
- `decision_reason_code` if known

Behavior requirements:
- stable pagination order by `last_activity_at desc, negotiation_id desc`
- deterministic response for the same cursor window
- normalized schema regardless of hh raw payload quirks

### 2. Read full candidate thread by hh negotiation id

`GET /api/hh/negotiations/:negotiation_id`

Returns:
- vacancy info
- candidate profile summary
- full structured resume payload
- full thread messages with canonical ids and direction
- timestamps
- raw hh metadata
- linked screening state if it exists
- linked internal candidate if it exists

### 3. Send message by hh negotiation id

`POST /api/hh/negotiations/:negotiation_id/messages`

Body:
- `message`
- `dry_run` optional
- `idempotency_key` required for non-dry-run
- `tag` optional
- `run_id` optional but strongly recommended

Response:
- `status`: `preview` | `sent` | `duplicate_suppressed` | `blocked`
- rendered preview
- hh send result if sent
- block reason if blocked

Behavior requirements:
- same `idempotency_key` must not create multiple sends
- send must be blocked if the negotiation is locked by another active run
- send must be blocked if vacancy stop-policy forbids more outreach
- every attempted send must be written to an audit log

### 4. Persist screening state by negotiation

`GET /api/hh/negotiations/:negotiation_id/screening-state`

`POST /api/hh/negotiations/:negotiation_id/screening-state`

Write payload must support:
- full upsert of structured checks
- partial patch of selected fields
- reason code + note
- provenance: agent / operator / system
- playbook version used for the decision

Behavior requirements:
- optimistic concurrency via `version` or `updated_at` precondition
- write history preserved in audit trail
- latest state easy to read without replaying all events

### 5. Vacancy-local playbook

`GET /api/hh/vacancies/:vacancy_id/playbook`

`POST /api/hh/vacancies/:vacancy_id/playbook`

Playbook must store:
- opening message
- question order
- FAQ answers
- qualification checks
- rejection rules
- handoff condition
- max useful contacts desired
- reserve behavior after quota
- report template hints

Behavior requirements:
- versioned documents, not mutable blind overwrite
- every run must record which playbook version was used

### 6. Review run execution

`POST /api/hh/vacancies/:vacancy_id/review-run`

Body:
- `playbook_version` or inline checklist
- `max_contacts`
- `unread_only`
- `collections`
- `operator_mode`: `manual_assisted` | `auto_send`
- `dry_run`
- `updated_after` optional override

Returns:
- `run_id`
- baseline cursor
- candidate counts
- preliminary report artifact reference

Behavior requirements:
- one active run lock per vacancy
- run artifact must survive partial failure
- run can be resumed or safely retried

### 7. Post-pass reporting

`GET /api/hh/vacancies/:vacancy_id/reports/latest`

`POST /api/hh/vacancies/:vacancy_id/reports/generate`

Report must include:
- vacancy id
- run id
- baseline time window
- playbook version
- stop-policy in effect
- new responses since previous pass
- candidates reviewed this run
- who was contacted
- who replied
- who qualified
- who was rejected and why
- who was held because quota was reached
- system/tooling blockers observed during the run

Behavior requirements:
- report generated from persisted run state, not inferred later from logs
- report content reproducible for the same `run_id`

### 8. Vacancy stop-policy

Config fields:
- `max_useful_contacts`
- `pause_outreach_when_reached`
- `reserve_candidates_when_paused`
- `resume_outreach_if_qualified_count_drops_below`

Behavior requirements:
- qualification count and reserve count must be computed explicitly
- when stop-policy is active, the agent may still review and classify candidates
- when stop-policy is active, handoff and further outreach may be blocked by policy

## Hiring Agent Tooling Surface

The hiring agent should eventually consume a canonical tool surface like this:

`start_review_run`
- inputs: vacancy target, playbook version, run mode
- output: `run_id`, baseline cursor, policy snapshot

`list_changed_candidates`
- inputs: `run_id`, filters
- output: normalized candidate/negotiation summaries

`get_candidate_context`
- inputs: `negotiation_id`
- output: resume, thread, prior screening state, linked candidate state

`update_candidate_screening`
- inputs: `negotiation_id`, structured checks, decision, evidence
- output: new screening state version

`send_candidate_message`
- inputs: `negotiation_id`, message template/body, idempotency key, run id
- output: preview/sent/blocked result

`complete_review_run`
- inputs: `run_id`
- output: final counts, report id, next cursor

hh-specific endpoints remain underneath this layer, but the agent-facing abstraction should stabilize around these intents.

## Playbook Model

Each hiring-agent playbook should contain:
- metadata: `playbook_id`, version, owner, status
- target channel capabilities required
- screening checks
- decision matrix
- message templates
- FAQ snippets
- stop-policy defaults
- report hints
- escalation rules

Playbook inheritance is optional later, but v1 should at least support:
- versioning
- immutable published versions
- vacancy binding to an explicit version

## Canonical Candidate Review Schema

To avoid building only an hh-specific system, the internal schema should distinguish:

- channel entity: hh negotiation
- candidate identity: person/resume/internal candidate
- review state: structured checks + status
- run state: what happened in this pass
- playbook state: which rules were used

This separation is what will let the same hiring agent work across multiple channels later.

## Internal Entity Linkage Rules

Pre-routing mode does not remove the need for internal linkage. It only delays it.

Minimum rules:
- keep `negotiation_id` as the primary raw conversation key
- keep `resume_id` as a secondary dedupe signal
- never collapse two active negotiations only because names match
- preserve the raw hh negotiation even after internal candidate creation

The platform must define:
- when a raw hh negotiation is linked to an existing internal candidate
- when a new internal candidate is created
- what key is used to deduplicate repeated imports
- whether linkage happens before or after qualification

## Run Lifecycle

### Start

1. acquire vacancy run lock
2. load active playbook and stop-policy
3. compute baseline cursor
4. sync changed negotiations from hh
5. create run record

### Process each negotiation

1. load normalized snapshot + current screening state
2. determine whether the candidate already answered required checks
3. classify into one of the allowed statuses
4. if outbound message is needed, evaluate stop-policy first
5. if allowed, preview or send message with idempotency key
6. persist updated screening state
7. append run item artifact

### Complete

1. finalize counts
2. persist final cursor
3. generate report artifact
4. release vacancy run lock

## Non-Functional Requirements

### Safety

- no agent access to raw hh credentials
- all outbound messaging must be auditable
- duplicate sends must be suppressed
- concurrent runs on the same vacancy must be prevented

### Reliability

- partial hh sync failure must not corrupt the current cursor
- failed sends must be classified as retriable vs terminal
- rerunning the same pass must not duplicate outbound actions

### Observability

Must expose:
- hh auth/token health
- last successful sync per vacancy
- last successful send per negotiation
- active run lock state
- send failure counts
- report generation failures

### Security and access control

- vacancy-scoped authorization for recruiter-safe endpoints
- audit log for read-sensitive and write-sensitive actions
- redaction policy for fields not needed by the agent

## Acceptance Criteria

The feature is complete only when all of the following are true:

1. An agent can process an hh vacancy end-to-end without direct hh.ru UI access.
2. Two consecutive runs correctly distinguish old vs new activity.
3. A rerun with the same idempotency keys does not duplicate messages.
4. Stop-policy prevents extra outreach after quota is reached, while still allowing reserve classification.
5. Each candidate decision is persisted with structured reason codes and evidence.
6. A generated report can be reproduced from a persisted `run_id`.
7. A partial hh failure does not silently lose the cursor or produce a false "all processed" report.

## Implementation Priority

### Phase 1: Minimum independent-agent surface

1. expose raw hh vacancy response listing
2. expose raw hh negotiation read/send
3. persist screening state
4. persist run cursor and run artifact
5. generate pass report from run data

### Phase 2: Production safety

1. add vacancy run locking
2. add send idempotency enforcement
3. add stop-policy enforcement
4. add audit trail and observability
5. add versioned playbook storage

### Phase 3: Workflow quality

1. add scheduled pass runner
2. add shortlist scoring / prioritization
3. add reserve queue management
4. add resume/internal-candidate linkage automation
5. promote hh review into generic hiring-agent tooling and reusable playbooks

## Outcome

With the above additions, Clawd can handle hh vacancy review through safe API methods, repeated incremental passes, structured decision memory, quota-aware outreach, and reproducible reports.
