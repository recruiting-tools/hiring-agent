# Code Review — Iteration 2: Funnel Postgres Adapter

Reviewed commit: `9c81b46` | Branch: `feature/recruiter-chat-shell`
Reviewer: Claude | Date: 2026-04-13

---

## Verdict: NEEDS_FIX

One real bug (template ordering), one functional gap (job_id not passed from UI). Everything else is OK.

---

## Issues

### 🔴 BUG: `ORDER BY pt.template_id DESC` is unreliable

**File:** `services/hiring-agent/src/data/funnel-adapter.js:37`

```sql
order by pt.template_id desc
limit 1
```

`template_id` is `TEXT PRIMARY KEY` (from migration 001). In production it's a UUID or arbitrary string. Ordering text UUIDs DESC to find the "latest" template is non-deterministic — it gives alphabetically-last, not chronologically-latest.

**Fix:** Use `ORDER BY pt.template_version DESC` (int, already in schema) or `ORDER BY pt.created_at DESC` (timestamptz, also in schema).

`template_version DESC` is most semantically correct since it tracks schema evolution per job.

---

### 🟡 FUNCTIONAL GAP: `job_id` is never passed from the web UI

**File:** `services/hiring-agent/src/http-server.js:291-296`

The frontend JavaScript sends:
```js
body: JSON.stringify({ message })
```

No `job_id` is included. So `postChatMessage({ ..., job_id: jobId })` always receives `jobId = undefined`, and the DB adapter runs without a job filter — it returns a global funnel across all jobs in the database.

The `jobId` parameter is wired correctly in `app.js` and `candidate-funnel.js`, but it's dead code from the UI path. This means:
1. The job filter feature is untested end-to-end
2. The demo UI will show all candidates across all jobs (could be confusing or leak data)

**Fix:** Either (a) add a `job_id` field to the UI form, or (b) document that job_id comes only from the API, not the demo UI.

---

## What's Correct

### SQL query logic (`funnel-adapter.js`)

- **CTE pattern** for scoped_runs before lateral joins: correct and defensive against legacy rows.
- **State mapping** is accurate:
  - `active + awaiting_reply=false` → `in_progress` ✓
  - `active + awaiting_reply=true` → `stuck` ✓
  - `completed` → `completed` ✓
  - `pending` → counted in `total` only (not in any bucket) ✓
  - `rejected` → `rejected` ✓
- **Missing step names**: `coalesce(step_meta.step_name, pss.step_id)` gracefully falls back to step_id ✓
- **NULL-safe JSONB lateral**: `jsonb_typeof(pt.steps_json) = 'array'` guard + LEFT JOIN LATERAL combo correctly handles missing templates ✓
- **`count(*)::int`** for all aggregates — correct Postgres type cast ✓

### app.js

- `postgres(databaseUrl)` created once per app instance — correct pattern for `postgres.js` connection pool ✓
- `sql ? executeWithDb(...) : runCandidateFunnelPlaybook(...)` fallback logic is clean ✓
- `job_id: jobId` destructured from request body — correct, though never populated from UI (see gap above)
- No explicit `sql.end()`: acceptable for long-running service; connection pool stays alive for the process lifetime ✓

### candidate-funnel.js — `buildReplyFromRows`

- `summary.total = Math.max(max, row.total)` — correct funnel interpretation (max candidates who reached any step) ✓
- `summary.qualified = qualificationRow?.completed ?? 0` — correct for current step_id convention; fragile but consistent with existing design ✓
- `summary.waiting = in_progress + stuck` across all steps ✓
- Branches correctly separate `rejected / stuck / in_progress` ✓
- Output shape matches `render_funnel` contract from the demo path ✓

### Integration test (`hiring-agent-funnel-adapter.test.js`)

- Seed data is valid against the real schema (confirmed against migration 001):
  - `chatbot.jobs (job_id, title)` ✓
  - `chatbot.pipeline_templates (template_id, template_version, job_id, name, steps_json)` ✓
  - `chatbot.pipeline_runs (pipeline_run_id, job_id, template_version, status)` ✓
  - `chatbot.pipeline_step_state (pipeline_run_id, step_id, step_index, state, awaiting_reply)` ✓
- Cleanup order is correct (step_state → runs → templates → jobs, respecting FK order) ✓
- `sql.end()` called in finally block — no test connection leak ✓
- Expected counts are mathematically correct:
  - screening: total=3, completed=1(run-1), stuck=1(run-2: active+awaiting=true), rejected=1(run-3), in_progress=0 ✓
  - qualification: total=3, in_progress=1(run-1: active+awaiting=false), pending=2(run-2,3) counted in total only ✓
- `test.skip` when DATABASE_URL is unset — correct CI behavior ✓

### No regressions in stateless-demo path

- The 9 existing unit tests use the demo path (DATABASE_URL not set → sql=null)
- `runCandidateFunnelPlaybook` is unchanged
- Demo fallback in `app.js` is the same conditional as before ✓

---

## Minor Notes (not blocking)

- `coalesce(pss.awaiting_reply, false)` — redundant since `awaiting_reply` is `NOT NULL DEFAULT false` in the schema. Harmless.
- `GROUP BY pss.step_id, pss.step_index, coalesce(step_meta.step_name, pss.step_id)` — theoretically two steps with same coalesced name would merge. Not a real-world concern with well-formed templates.
- `summary.rejected` sums rejections across all steps, which could double-count if a candidate gets a `rejected` state row at multiple steps. Unlikely in the data model but worth noting.
