## Checklist

- [ ] `pnpm gate:sandbox` green locally
- [ ] For schema changes: tested on ephemeral Neon branch first (`./scripts/create-feature-branch.sh`)
- [ ] No `EXTERNAL_MODE` / `LLM_MODE` env vars added (dead vars — use `HH_USE_MOCK=true` instead)
- [ ] All messages go through `planned_messages → cron`, no direct send calls

## CI callback (optional)

If this PR was created by an automated session that should be notified of CI results:

<!-- ci-callback: https://RELAY_URL/api/sessions/SESSION_ID/reply -->
