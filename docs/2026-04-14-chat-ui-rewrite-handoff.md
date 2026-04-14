## Iteration 2 handoff

- Source of truth used for the replacement: `docs/2026-04-14-frontend-phase1-implementation-plan.md` from commit `0f9d84a`.
- Scope changed: replaced only the `CHAT_HTML` constant in `services/hiring-agent/src/http-server.js`.
- Notes:
  - The plan file is not present in the current worktree, so the exact block was extracted from commit history.
  - The markdown source escaped the final template-literal backtick as `\`; the runtime file was corrected to a valid closing backtick after transplant.
