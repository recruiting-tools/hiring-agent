# 2026-04-13 auth fix for fix/deploy-prod-dispatch

## Summary

Fixed three auth regressions in `services/hiring-agent`:

1. Increased login cookie `Max-Age` from 7 days to 30 days.
2. Increased session persistence TTL in `chatbot.sessions.expires_at` from 7 days to 30 days.
3. Added conditional `Secure` cookie flag for login/logout only when `NODE_ENV === "production"`.
4. Added background session renewal in `resolveSession()` when a valid session is within 7 days of expiry.

## Verification

- Ran `pnpm test:hiring-agent`
- Result: passed (`16` passed, `1` skipped because `DATABASE_URL` is not set)

## Notes

- Session renewal is fire-and-forget and intentionally ignores renewal failures so request auth does not fail on a best-effort TTL refresh.
- Added regression coverage for the new TTL, renewal, and cookie flag behavior.
