# 2026-04-13 Hiring Agent Auth + Frontend

## Scope

Implemented Tasks 1-4 from `docs/hiring-agent-frontend-prod-plan.md` for `services/hiring-agent` only.

## Changes

- Added cookie/session auth helpers in `services/hiring-agent/src/auth.js`.
- Extended `services/hiring-agent/src/http-server.js` with:
  - `GET /login`
  - `POST /auth/login`
  - `GET /logout`
  - auth-gated `GET /`
  - auth-gated `POST /api/chat`
  - auth-gated `GET /api/jobs`
- Replaced URL token/job handling in frontend with session cookie auth and server-rendered recruiter email.
- Added recruiter header, logout button, job selector, sessionStorage chat history, and 401 handling in chat UI.
- Added `getJobs(clientId)` to `services/hiring-agent/src/app.js`.
- Added unit coverage for cookie parsing, session resolution, and unauthenticated redirect.
- Updated `test:hiring-agent` script and verified it passes locally.

## Verification

Ran:

```bash
pnpm test:hiring-agent
```

Result: pass, with existing DB-dependent funnel adapter integration still skipped when `DATABASE_URL` is not set.
