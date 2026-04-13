# Recruiter Chat Shell — Implementation Plan

Coordinator file for `feature/recruiter-chat-shell`.  
Design spec: `docs/reports/2026-04-13-recruiter-chat-playbooks-plan.md`  
Branch: `feature/recruiter-chat-shell`  
Project path: `/Users/vova/Documents/GitHub/hiring-agent`

---

## Status Legend

- `[ ]` not started
- `[→]` in progress
- `[✓]` done
- `[!]` failed / blocked

---

## Iterations

### Iteration 1 — Service Skeleton
**Status:** `[✓]`  
**Worker result:** Bootstrap commit 747c56c created all service files. Tests pass: `pnpm test:hiring-agent` → 9/9 green (router, funnel-query unit, HTTP integration). Uses stateless-demo mode.

**Task for Codex:**
Create `services/hiring-agent/` directory with minimal working service:
- `services/hiring-agent/package.json` — use ESM (`"type": "module"`), Node 20, dependencies: `express` for HTTP, `postgres` for DB (same as candidate-chatbot uses neon/postgres). Dev deps: `node:test` built-in (no jest).
- `services/hiring-agent/src/server.js` — Express app with `GET /health` returning `{"ok":true}`. Export `app` and a `start(port)` function. No DB in this iteration.
- `services/hiring-agent/src/index.js` — entry point: `import { start } from './server.js'; start(process.env.PORT || 3001);`
- `services/hiring-agent/tests/server.test.js` — `node:test` test: starts server, hits `GET /health`, asserts 200 + `{"ok":true}`, closes server.

**Constraints:** no DB queries yet, no playbooks yet. Just the skeleton. Run `node --test services/hiring-agent/tests/server.test.js` to verify. Commit all files.

---

### Iteration 2 — Funnel Data Adapter
**Status:** `[✓]`  
**Worker result:** Codex DONE commit 9c81b46. Changed: package.json, pnpm-lock.yaml, services/hiring-agent/src/app.js, services/hiring-agent/src/http-server.js, services/hiring-agent/src/playbooks/candidate-funnel.js, new: services/hiring-agent/src/data/funnel-adapter.js, tests/integration/hiring-agent-funnel-adapter.test.js. pnpm test:hiring-agent: 9 passed, 1 skipped (DB test skips when DATABASE_URL unset).  
**Review verdict:** NEEDS_FIX (commit ecc6723, file docs/2026-04-13-iteration-2-review.md)  
- 🔴 BUG: `ORDER BY pt.template_id DESC` in funnel-adapter.js:37 — should be `ORDER BY pt.template_version DESC`  
- 🟡 GAP: job_id never passed from UI (http-server.js only sends `{ message }`) — jobId always undefined in DB adapter

**Task for Codex:**
Implement the funnel data adapter over existing `chatbot.pipeline_step_state` and `chatbot.pipeline_templates` tables.

File: `services/hiring-agent/src/data/funnel-adapter.js`

The adapter takes a DB client and optional `job_id` filter, queries the existing runtime tables, and returns an array with this stable contract (do not change this shape):
```js
[{ step_name: string, step_index: number, total: number, in_progress: number, completed: number, stuck: number, rejected: number }]
```

Mapping from `pipeline_step_state.state`:
- `completed` → completed
- `pending` + `awaiting_reply: false` → in_progress (not yet reached or actively pending)
- `pending` + `awaiting_reply: true` → stuck (waiting for candidate reply, no response for > 24h is optional for now)
- `rejected` (if state = 'rejected') → rejected

Step name comes from the pipeline_template steps_json: `steps_json[step_index - 1].goal` or fall back to step_id.

File: `services/hiring-agent/tests/funnel-adapter.test.js`
Integration test (requires `DATABASE_URL` env var pointing to dev DB — `V2_DEV_NEON_URL` or `DATABASE_URL`). Seeds minimal data (2-3 pipeline runs with known states), calls adapter, asserts correct aggregation shape. Clean up seeded data after test.

**Constraints:** Read-only queries only. Use the same DB schema as `services/candidate-chatbot/migrations/`. No new tables. Run test with real Postgres. Commit all files.

---

### Iteration 3 — Playbook Registry, Router, Entitlement
**Status:** `[✓]`  
**Worker result:** Bootstrap commit 747c56c created registry.js, router.js. Entitlement logic is inline in app.js (no DB check, any token accepted for demo). Tests pass.

**Task for Codex:**
Implement the playbook routing layer.

`services/hiring-agent/src/playbooks/registry.js` — hardcoded registry:
```js
export const REGISTRY = {
  'funnel-visualization': { title: 'Воронка кандидатов', status: 'enabled' },
  'communication-plan':   { title: 'План коммуникации',  status: 'disabled' },  // demo locked state
  'candidate-broadcast':  { title: 'Рассылка сегменту',  status: 'disabled' },
};
```

`services/hiring-agent/src/playbooks/router.js` — pattern matching, NOT LLM:
```js
// export function route(message) → { playbook_key: string|null }
// Patterns for 'funnel-visualization':
//   /воронк|funnel|статус кандидат|этапы|сколько.*кандидат/i
// Everything else → null (fallback)
```

`services/hiring-agent/src/entitlement.js`:
```js
// export function checkEntitlement(playbookKey, recruiterToken)
// → { status: 'enabled' | 'disabled' | 'not_found' }
// For PR 1: if playbook_key not in REGISTRY → 'not_found'
// If in REGISTRY: return REGISTRY[key].status (demo: 'funnel-visualization' enabled, others disabled)
// recruiterToken is accepted (no DB check in PR 1 — any token is fine for demo)
```

`services/hiring-agent/tests/router.test.js` — unit tests (no DB):
- Table of (message, expected_playbook_key) pairs covering funnel patterns + fallback
- Table of (playbook_key, token, expected_status) for entitlement: enabled, disabled, not_found

**Constraints:** No DB, no LLM calls, pure logic. Run `node --test services/hiring-agent/tests/router.test.js`. Commit all files.

---

### Iteration 4 — Chat Endpoint + Funnel Playbook + UI
**Status:** `[✓]`  
**Worker result:** Bootstrap commit 747c56c created chat endpoint (POST /api/chat), UI (GET /), and funnel playbook using demo data. Tests pass. DB integration deferred to Iteration 2 completion.

**Task for Codex:**
Wire everything together into a working recruiter chat.

`services/hiring-agent/src/playbooks/funnel-visualization.js`:
```js
// export async function execute({ db, jobId })
// Calls funnel-adapter, returns { type: 'render_funnel', data: [...] }
```

Update `services/hiring-agent/src/server.js` to add:

1. `POST /api/chat` endpoint:
   - Body: `{ message: string, recruiter_token: string, job_id?: string }`
   - Routes via router → checks entitlement → executes playbook or returns fallback/locked
   - Response for funnel: `{ type: 'render_funnel', data: [...] }`
   - Response for locked: `{ type: 'playbook_locked', playbook_title: string }`
   - Response for fallback: `{ type: 'text', text: 'Я умею показывать воронку кандидатов...' }`
   - DB connection from `DATABASE_URL` env var

2. `GET /` — serve a minimal chat HTML page (inline, no build step):
   - Input box + send button
   - Message history (client-side only, no persistence)
   - For `render_funnel`: renders a table with columns: Шаг | Всего | В процессе | Завершён | Ждёт | Отклонён
   - For `playbook_locked`: shows "🔒 <title> — не подключено"
   - For `text`: renders as plain message bubble
   - Auth: recruiter_token taken from URL query param `?token=rec-tok-demo-001` and sent with each request

`services/hiring-agent/tests/chat-endpoint.test.js` — HTTP integration test (requires DATABASE_URL):
- POST /api/chat with funnel message → `type === 'render_funnel'` and `data` is array
- POST /api/chat with communication plan message → `type === 'playbook_locked'`
- POST /api/chat with unknown message → `type === 'text'`

**Constraints:** No deploy, no new migrations. Single HTML file inline in server.js is fine (like candidate-chatbot does it). Run all tests: `node --test services/hiring-agent/tests/`. Commit all files.

---

## After All Iterations

1. Run full test suite: `pnpm test`
2. Verify smoke: start server locally with `V2_DEV_NEON_URL` and open `/?token=rec-tok-demo-001` in browser
3. Create PR against `main`

---

## Coordinator Notes

Last update: 2026-04-13  
Current iteration: ALL DONE  
Last worker: Claude reviewer — verdict OK (f1efd6f)  
Last verdict: All 4 iterations complete. Creating PR.
