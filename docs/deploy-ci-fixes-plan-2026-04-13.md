# Deploy / CI Fixes Plan

Date: 2026-04-13
Status: Active
Independent of: tenant access layer refactor
Blocks: every CI deploy until SSH fix is landed

---

## Context

These fixes are independent of the tenant access refactor. They can and should
be done before or in parallel with it. Most are small, contained changes.

The SSH bug (#1) blocks ALL CI deploys right now — nothing else matters until
that's fixed.

---

## Fix 1: SSH key not available across GitHub Actions steps (BLOCKER)

**Status: NOT DONE**

**File**: `.github/workflows/deploy-hiring-agent.yml:46-52`

**Problem**: `eval "$(ssh-agent -s)"` and `ssh-add` run in "Load SSH key" step.
GitHub Actions steps run in separate shell processes — `SSH_AUTH_SOCK` does not
carry over. Subsequent SSH commands in "Check port", "Write .env" and "Deploy"
steps cannot find the key.

`deploy-hiring-agent.sh:14` also calls `ssh` without `-i ~/.ssh/vm_key`.

**Fix A** (minimal — write SSH config so `-i` is implicit everywhere):

Replace "Load SSH key" step with:
```yaml
- name: Load SSH key
  run: |
    mkdir -p ~/.ssh
    echo "${{ secrets.VM_SSH_KEY }}" > ~/.ssh/vm_key
    chmod 600 ~/.ssh/vm_key
    printf 'Host %s\n  IdentityFile ~/.ssh/vm_key\n  StrictHostKeyChecking accept-new\n' \
      "$VM_HOST" >> ~/.ssh/config
```

Remove the `eval ssh-agent` / `ssh-add` lines — not needed.
No changes to deploy script or other SSH steps required.

**Fix B** (cleaner — use webfactory action):
```yaml
- uses: webfactory/ssh-agent@v0.9.0
  with:
    ssh-private-key: ${{ secrets.VM_SSH_KEY }}
```

Recommendation: Fix A is 5 lines; Fix B is 3 lines and the most battle-tested.
Both work. Fix A is used here because it avoids a third-party action.

> Note: CI public key (`github-ci-hiring-agent`) was added to VM authorized_keys
> manually on 2026-04-13. The SSH key itself is no longer the blocker — the
> agent persistence is.

---

## Fix 2: First deploy fails — no git clone step

**Status: DONE manually, NOT in deploy script**

`/opt/hiring-agent` was cloned manually on 2026-04-13 during initial VM setup.
The deploy script still does `cd /opt/hiring-agent` without ensuring the repo
exists. A fresh VM rebuild would fail.

**Fix**: Add before `cd /opt/hiring-agent`:
```bash
if [ ! -d /opt/hiring-agent/.git ]; then
  echo "Cloning repo into /opt/hiring-agent..."
  sudo mkdir -p /opt/hiring-agent
  sudo chown "$VM_USER:$VM_USER" /opt/hiring-agent
  git clone https://github.com/recruiting-tools/hiring-agent.git /opt/hiring-agent
fi
```

Note: repo is `recruiting-tools/hiring-agent` (not `kobzevvv/hiring-agent`).
Clone will need a token for private repos — either a deploy key or GitHub token
injected from secrets.

---

## Fix 3: PM2 fallback starts without DATABASE_URL

**Status: NOT DONE**

**File**: `scripts/deploy-hiring-agent.sh:56-57`

**Problem**:
```bash
pm2 restart hiring-agent --update-env \
  || pm2 start services/hiring-agent/ecosystem.config.cjs --env production
```

The `source .env` at line 50 exports `DATABASE_URL` into the current shell.
`pm2 restart --update-env` picks it up. But if restart fails and falls through
to `pm2 start`, PM2 reads `ecosystem.config.cjs` which explicitly does NOT
include `DATABASE_URL`. The service starts in demo mode silently.

Note: after the tenant access refactor this changes to `MANAGEMENT_DATABASE_URL`,
but the structural bug (fallback losing env vars) remains.

**Fix**: Add `--update-env` to the fallback `pm2 start`:
```bash
pm2 restart hiring-agent --update-env \
  || pm2 start services/hiring-agent/ecosystem.config.cjs --env production --update-env
```

---

## Fix 4: Smoke test doesn't detect demo mode

**Status: NOT DONE**

**File**: `.github/workflows/deploy-hiring-agent.yml:78-83`

**Problem**: `status: "ok"` is returned in both `db-connected` and `demo` mode.
A failed database connection is not detected by CI.

**Fix**:
```bash
HEALTH=$(curl -sf https://hiring-chat.recruiter-assistant.com/health)
STATUS=$(echo "$HEALTH" | jq -r '.status')
MODE=$(echo "$HEALTH" | jq -r '.mode')
echo "Health: $STATUS / $MODE"
[ "$STATUS" = "ok" ] || { echo "SMOKE FAILED: status=$STATUS"; exit 1; }
[ "$MODE" = "db-connected" ] || { echo "SMOKE FAILED: mode=$MODE (expected db-connected)"; exit 1; }
```

Note: after tenant access refactor the mode value may rename. Update together.

---

## Fix 5: sleep 2 is flaky, no retry

**Status: NOT DONE**

**File**: `scripts/deploy-hiring-agent.sh:60`

**Fix**: Replace `sleep 2` + single health check with retry loop:
```bash
echo "Waiting for service to become healthy..."
for i in $(seq 1 10); do
  STATUS=$(curl -sf http://localhost:$PORT/health | jq -r '.status' 2>/dev/null || echo "")
  [ "$STATUS" = "ok" ] && { echo "Health check passed (attempt $i)"; break; }
  echo "Attempt $i/10: not ready (status=$STATUS), waiting..."
  sleep 2
  [ "$i" = "10" ] && { echo "HEALTH CHECK FAILED after 10 attempts"; exit 1; }
done
```

---

## Fix 6: scripts/lib/run-migrations.js untracked

**Status: DONE** — file is committed.

---

## Fix 7: sandbox-release-gate.yml orphaned branches

**Status: NOT DONE**

**File**: `.github/workflows/sandbox-release-gate.yml`

**Fix**: Tie cleanup to branch creation, not to check output:
```yaml
- name: Create Neon branch
  id: neon-branch
  run: |
    BRANCH_ID=$(neonctl branches create ...)
    echo "branch_id=$BRANCH_ID" >> $GITHUB_OUTPUT

- name: Cleanup Neon branch
  if: always() && steps.neon-branch.outputs.branch_id != ''
  run: neonctl branches delete ${{ steps.neon-branch.outputs.branch_id }}
```

---

## Fix 8: ecosystem.config.cjs — no PM2 timeout config

**Status: NOT DONE**

**File**: `services/hiring-agent/ecosystem.config.cjs`

**Fix**:
```js
module.exports = {
  apps: [{
    name: "hiring-agent",
    script: "./src/index.js",
    cwd: "/opt/hiring-agent/services/hiring-agent",
    listen_timeout: 8000,
    kill_timeout: 5000,
    env_production: {
      NODE_ENV: "production",
      PORT: 3101
    }
  }]
};
```

---

## Execution Order

```
[ ] 1. Fix SSH key (#1) — blocker, do this first
[ ] 2. Fix PM2 fallback (#3) — same PR as SSH fix
[ ] 3. Fix smoke test mode check (#4) — same PR
[ ] 4. Fix retry loop (#5) — same PR
[ ] 5. Fix first-deploy clone (#2) — separate PR, needs deploy key or token logic
[ ] 6. Fix sandbox cleanup (#7) — separate PR, low urgency
[ ] 7. PM2 timeouts (#8) — same PR as other ecosystem.config changes
[x] Fix 6 (run-migrations.js) — already done
```

---

## What NOT to fix here

These look related but belong to the tenant access refactor plan:

- Changing `PROD_DATABASE_URL` → `MANAGEMENT_DATABASE_URL` in workflow — Phase 7
  of tenant access roadmap
- Explicit `APP_MODE=demo` enforcement — Phase 6 of tenant access roadmap
- `candidate-chatbot` env var fallback chain — see candidate-chatbot plan below
