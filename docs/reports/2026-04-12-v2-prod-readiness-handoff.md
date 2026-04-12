# V2 Production Readiness Handoff

Date: 2026-04-12

Scope: HH integration groundwork, legacy pipeline migration research, V2 evaluation report, and missing logic identified before production rollout.

## Current Git Reality

- Current branch: `main`
- Branch state: `main...origin/main [ahead 46]`
- Important: the work from this evaluation/documentation pass is **not committed yet**
- Practical implication: these changes can still be moved into a dedicated feature branch and reviewed via PR before anything new is merged

## What Is Already Done

### 1. HH API foundation

- Fixture library added under `tests/fixtures/hh-api/`
- Stateful HH mock added in `services/hh-connector/src/hh-contract-mock.js`
- `hh-client.js` switched to a compatible mock-backed client
- Integration tests added for fixtures, pagination, shared `resume_id`, state changes, expired-token `401`
- Real HTTP client added in `services/hh-connector/src/hh-api-client.js`
- Supported methods: token exchange, token refresh, `getMe`, negotiations, resume, messages, `sendMessage`, `changeState`
- Access token refresh-before-use and one retry after `401` already implemented

### 2. OAuth + poll plumbing

- Migration `009_hh_oauth_and_flags.sql` added
- Store support added for `management.oauth_tokens` and `management.feature_flags`
- `GET /hh-callback/` added
- `POST /internal/hh-poll` added with bearer auth and `hh_import` gating
- `token-refresher.js` added
- App wiring in `services/candidate-chatbot/src/index.js` already creates HH client / refresher / poll runner when env vars are present

### 3. Reports and legacy-pipeline research

- Legacy baseline report built from real old DB data:
  - [docs/reports/2026-04-12-legacy-pipeline-baseline.md](/Users/vova/Documents/GitHub/hiring-agent/docs/reports/2026-04-12-legacy-pipeline-baseline.md)
- V2 evaluation report built from 3 real legacy jobs:
  - `job_id=4` WB designer
  - `job_id=9` China procurement
  - `job_id=26` sales / Skolkovo
- Compare block added for session:
  - `c3835db7-34bc-46a3-93a1-e64f06f0d4a3`
- Candidate sets intentionally include `strong`, `medium`, `hidden_from_resume`, `weak_or_risky`
- Evaluation report published and readable via instant-publish

### 4. Dialogue quality improvements already reflected in report

- Softer CTA wording for next steps and homework send
- Concrete homework flow examples for homework jobs:
  - offer
  - send
  - submission detection
  - acknowledgement
  - notify manager
- Projected dialogs now model the end of the homework flow instead of stopping at CTA
- Separate appendix added for candidate-initiated exit handling:
  - hard refusal
  - likely refusal that needs confirmation
  - context-sensitive exit without awkward reopen CTA

## What Is Still Missing Before Production

### A. Core product behavior gaps

- Real import of HH negotiations/resumes/messages into our store is still incomplete
- No full live HH sync smoke against real candidate traffic yet
- No production-ready handling of homework submission ingestion into canonical candidate state
- No production-ready candidate-initiated refusal classifier wired into runtime decision logic
- No step-level persistence model yet for homework send/submission events in V2 runtime

### B. Pipeline modeling gaps

- `follow_up_count` should be a first-class field on each step
- Default should be `1`
- Homework-related steps likely need `2`
- This should not live as an appendix; it belongs in step data itself
- Follow-up timing policy per step is not fully modeled yet
- Cross-cutting branches still need explicit runtime representation:
  - candidate refusal / stop messaging
  - went dark / follow-up persistence
  - optional-stage skip logic

### C. Runtime/ops gaps

- No production CI/CD path yet for this feature slice
- No PR-based workflow artifacts yet for these changes
- No production checklist proving:
  - HH OAuth live
  - token refresh live
  - poll endpoint live
  - import idempotency live
  - moderation / delivery safety live

## Highest-Priority Next Steps

1. Move current uncommitted work to a dedicated branch and stop continuing on `main`.
2. Add explicit step schema fields for:
   - `follow_up_count`
   - `follow_up_delay_hours` or equivalent
   - `candidate_exit_behavior`
   - `submission_detection_rule` for homework-like steps
3. Translate the 3 validated legacy vacancies into actual V2 step data, not just report examples.
4. Implement runtime handling for:
   - homework sent
   - homework submitted
   - candidate hard refusal
   - ambiguous refusal requiring one clarification
   - went-dark follow-up limits per step
5. Run live end-to-end HH flow on a few real candidates and verify imported state transitions.
6. Open a PR with CI checks before any merge.

## Review Carefully

- `follow_up_count` is not encoded in real step data yet.
  Risk: went-dark behavior will remain implicit and drift between vacancies.
- We currently describe cross-cutting branches in reports, not in production runtime structures.
  Risk: refusal, AI-interview handoff, homework/form/NDA submission, and silent-drop logic may be implemented inconsistently.
- Homework should likely generalize into a broader class of `external_action` steps.
  Examples:
  - AI interview link generation
  - homework / practical assignment send
  - NDA send
  - external form completion
  - calendar booking
  Risk: if we special-case homework now, we may need to refactor soon.
- Submission detection is currently modeled as heuristics in report examples, not as canonical structured rules in runtime state.
  Risk: the bot may miss returned artifacts or keep pushing the candidate after they already completed the requested action.
- Candidate-initiated exit logic still needs a product decision on confidence thresholds and persistence:
  - when exactly to stop messaging without confirmation
  - when to ask one clarification
  - whether to store an explicit `candidate_opt_out` or `candidate_declined_step` state
- There is still no final agreed schema for step metadata.
  Fields that likely need explicit review:
  - `follow_up_count`
  - `follow_up_delay_hours`
  - `external_action_type`
  - `link_generation_mode`
  - `submission_detection_rule`
  - `candidate_exit_behavior`
  - `optional` / `skippable`
- The evaluation dialogs are still heuristic projections, not generated by the production model.
  Risk: copy quality and branch handling may still diverge after real LLM integration.
- We are currently using real legacy jobs as migration anchors, but not yet translating them into executable V2 configs.
  Risk: we may overfit the report instead of codifying the actual runtime representation.

## Explicit Product Decisions Captured From Review

- Candidate refusal / stop-contact logic is a separate cross-cutting branch, not part of normal job goals
- Went-dark / follow-up persistence is **not** an appendix; it must become a per-step column/field
- Homework flow should be modeled to completion, including submission detection
- Homework is only one instance of a wider standard pattern: request external action, generate/send link, then detect completion/submission
- We should optimize for strong concrete examples first, and postpone higher abstractions until patterns settle

## Files Most Relevant For Continuation

- [scripts/generate-evaluation-report.js](/Users/vova/Documents/GitHub/hiring-agent/scripts/generate-evaluation-report.js)
- [docs/reports/2026-04-12-v2-evaluation-report.md](/Users/vova/Documents/GitHub/hiring-agent/docs/reports/2026-04-12-v2-evaluation-report.md)
- [docs/reports/2026-04-12-legacy-pipeline-baseline.md](/Users/vova/Documents/GitHub/hiring-agent/docs/reports/2026-04-12-legacy-pipeline-baseline.md)
- [services/candidate-chatbot/src/prompt-builder.js](/Users/vova/Documents/GitHub/hiring-agent/services/candidate-chatbot/src/prompt-builder.js)
- [tests/fixtures/iteration-1-seed.json](/Users/vova/Documents/GitHub/hiring-agent/tests/fixtures/iteration-1-seed.json)
- [services/hh-connector/src/hh-api-client.js](/Users/vova/Documents/GitHub/hiring-agent/services/hh-connector/src/hh-api-client.js)
- [services/hh-connector/src/token-refresher.js](/Users/vova/Documents/GitHub/hiring-agent/services/hh-connector/src/token-refresher.js)
- [services/candidate-chatbot/src/http-server.js](/Users/vova/Documents/GitHub/hiring-agent/services/candidate-chatbot/src/http-server.js)

## Published Evaluation Report

- https://instant-publish-owxonetuhq-uc.a.run.app/p/hiring-agent-v2-evaluation-2026-04-12?password=cAeBPskY&hint=markdown
