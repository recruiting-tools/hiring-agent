## Checklist

- [ ] `pnpm gate:sandbox` green locally
- [ ] For schema changes: tested on ephemeral Neon branch first (`./scripts/create-feature-branch.sh`)
- [ ] No `EXTERNAL_MODE` / `LLM_MODE` env vars added (dead vars — use `HH_USE_MOCK=true` instead)
- [ ] All messages go through `planned_messages → cron`, no direct send calls

## CI callback (optional)

If this PR was created by an automated session that should be notified of CI results:

Session ID: `SESSION_ID`

<!-- ci-callback: https://RELAY_URL/api/sessions/SESSION_ID/reply -->

How to get `SESSION_ID`:

```bash
curl -s http://localhost:3000/api/sessions/my-id
```

Recommended:
- keep the full `SESSION_ID` in the PR body
- optional: add a short suffix like `--s-019d92d2` to the branch name for human traceability
- use the PR body as the source of truth; branch names are only a hint
