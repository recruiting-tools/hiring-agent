# Hiring-Agent Deploy Hardening Task

Date: 2026-04-13
Status: Proposed
Scope: `hiring-agent` production and VM deploy path

## Why this task exists

The current deploy path works, but it is still too dependent on mutable VM state:

- existing PM2 process state
- ad-hoc runtime tools installed on the VM
- shell-based env loading
- weak deploy-time observability

This creates a bad operational profile:

- failures are slow to diagnose
- a green `pm2` status is not enough to prove the app is actually serving
- the same workflow can behave differently depending on hidden VM state

The goal of this task is not “make deploy pass once”.
The goal is:

- explicit runtime contract
- deterministic deploy behavior
- faster failure diagnosis
- lower reliance on debugging by SSH after CI failure

## Current strengths

- deploy now writes `MANAGEMENT_DATABASE_URL` explicitly
- local and public `/health` checks exist
- PM2 startup uses a clean `delete + start`
- deploy dumps PM2 and socket state on health failure
- post-deploy smoke checks `mode=management-auth`

These are good foundations. The remaining work is about hardening.

## Findings

### 1. VM state is still part of the deploy contract

Files:

- [.github/workflows/deploy-hiring-agent.yml](/private/tmp/hiring-agent-followup/.github/workflows/deploy-hiring-agent.yml:1)
- [scripts/deploy-hiring-agent.sh](/private/tmp/hiring-agent-followup/scripts/deploy-hiring-agent.sh:1)

The workflow deploys directly into `/opt/hiring-agent` on a long-lived VM and reuses:

- existing git checkout
- existing PM2 installation and state
- existing Node toolchain
- existing nginx routing outside the deploy workflow

This is workable, but it means deploy behavior depends on machine history, not only on repo state.

### 2. The deploy script still mixes transport, provisioning, release, and runtime restart

File:

- [scripts/deploy-hiring-agent.sh](/private/tmp/hiring-agent-followup/scripts/deploy-hiring-agent.sh:1)

One shell script currently owns:

- repo clone/update
- package manager bootstrapping
- env loading
- PM2 restart
- local health polling
- failure diagnostics

This makes the script convenient, but harder to reason about and harder to test.

### 3. The runtime toolchain is not pinned strongly enough

Files:

- [scripts/deploy-hiring-agent.sh](/private/tmp/hiring-agent-followup/scripts/deploy-hiring-agent.sh:53)
- [package.json](/private/tmp/hiring-agent-followup/package.json:4)

The script falls back through:

- `pnpm`
- `corepack pnpm`
- `npm install -g pnpm`

This is resilient, but it means the deploy host may mutate globally during deploy and may use whatever Node/pnpm version happens to be present.

The deploy path should prefer a pinned, explicit runtime bootstrap.

### 4. `/health` is useful, but still too weak as deploy evidence

Files:

- [services/hiring-agent/src/http-server.js](/private/tmp/hiring-agent-followup/services/hiring-agent/src/http-server.js:596)
- [.github/workflows/deploy-hiring-agent.yml](/private/tmp/hiring-agent-followup/.github/workflows/deploy-hiring-agent.yml:80)

Right now deploy mostly proves:

- process is up
- app is in `management-auth` mode

It does not prove:

- which git SHA is actually serving
- which `APP_ENV` is active
- whether PM2 started the intended entrypoint revision
- whether the control-plane DB is reachable beyond lazy startup

For CI/CD, `/health` should expose enough metadata to remove guesswork.

### 5. VM docs are now partly stale relative to the actual runtime

Files:

- [docs/deploy-vm-services.md](/private/tmp/hiring-agent-followup/docs/deploy-vm-services.md:147)
- [services/hiring-agent/ecosystem.config.cjs](/private/tmp/hiring-agent-followup/services/hiring-agent/ecosystem.config.cjs:1)

The doc still describes:

- `systemd` for `hiring-agent`
- port `3100`
- service path under `/home/vova/hiring-agent`

Actual production runtime now uses:

- PM2
- port `3101`
- repo at `/opt/hiring-agent`

This is dangerous because runbooks are part of deploy reliability.

### 6. There is no explicit release artifact boundary

Files:

- [scripts/deploy-hiring-agent.sh](/private/tmp/hiring-agent-followup/scripts/deploy-hiring-agent.sh:44)
- [docs/deploy-vm-services.md](/private/tmp/hiring-agent-followup/docs/deploy-vm-services.md:130)

The deploy process pulls the repo on the VM and installs from source in place.

That means:

- release input is not a built artifact
- workspace layout changes can affect runtime unexpectedly
- rollback is tied to git state on the VM

This is acceptable short-term, but not ideal for reliability or speed.

## Recommended direction

### Option A: Harden current VM + PM2 deploy path

This is the recommended near-term option.

Keep:

- single VM
- nginx on VM
- PM2
- git-based deploy

But make the flow explicit and stricter.

Pros:

- lowest migration cost
- fastest path to reliable deploys
- no infra redesign needed

Cons:

- still stateful VM deploy
- still source-based release, not artifact-based

### Option B: Move to release bundles on the same VM

Keep VM + nginx, but deploy a self-contained release bundle into versioned directories such as:

- `/opt/hiring-agent/releases/<sha>/`
- `/opt/hiring-agent/current -> releases/<sha>`

Pros:

- clearer rollback
- less accidental dependency on dirty working tree
- better release traceability

Cons:

- needs bundle/build logic
- more scripting work now

### Option C: Move off VM deploy entirely

Examples:

- Cloud Run
- systemd service with immutable bundle delivery

This is a larger architecture change and not needed immediately.

## Decision

Recommended now:

1. implement Option A fully
2. prepare code structure so Option B is easy later
3. do not spend time on Option C in this slice

## Concrete task

### Phase 1. Make deploy state explicit

1. Add release metadata to `/health`.

Target fields:

- `deploy_sha`
- `app_env`
- `started_at`
- `port`

Acceptance:

- local VM health and public health both expose the same release metadata
- post-deploy smoke validates `deploy_sha == github.sha`

2. Emit pre-restart and post-restart PM2 state in workflow logs.

Target data:

- current git SHA on VM
- PM2 process config
- effective `PORT`
- whether `MANAGEMENT_DATABASE_URL` is present

Acceptance:

- a failed run tells us what config was intended and what process actually started

3. Add a dedicated “verify runtime on VM” step before public smoke.

Checks:

- `curl http://127.0.0.1:$PORT/health`
- `pm2 jlist`
- `ss -tlnp | grep :$PORT`

Acceptance:

- failures are classified as either VM-local or public-routing

### Phase 2. Reduce hidden VM dependencies

4. Replace ad-hoc package manager fallback with an explicit bootstrap contract.

Recommended MVP:

- require `corepack` + pinned `pnpm` via `packageManager`
- fail with a clear error if neither `pnpm` nor `corepack` is present
- remove `npm install -g pnpm` from deploy path

Acceptance:

- deploy does not mutate global package manager state on the VM

5. Add a VM preflight step for required binaries.

Check:

- `node`
- `corepack`
- `pm2`
- `jq`
- `git`

Acceptance:

- missing runtime dependencies fail before git pull or restart

6. Split deploy script into explicit sections or helper scripts.

Recommended shape:

- `scripts/vm/preflight-hiring-agent.sh`
- `scripts/vm/release-hiring-agent.sh`
- `scripts/vm/verify-hiring-agent.sh`

Acceptance:

- each script has one responsibility
- each script can be run manually over SSH for debugging

### Phase 3. Improve release safety

7. Add a backup of previous revision metadata before switching runtime.

MVP:

- write previous and target SHA to a release log file on VM

Better:

- keep last successful SHA in `/opt/hiring-agent/.last-successful-deploy`

Acceptance:

- operator can see current and previous deployed revisions without reading workflow logs

8. Add explicit rollback command path.

MVP:

- `DEPLOY_REF=<old_sha> ./scripts/deploy-hiring-agent.sh`

Better:

- `scripts/rollback-hiring-agent.sh <sha>`

Acceptance:

- rollback path is documented and tested once

### Phase 4. Clean up docs and operational surface

9. Rewrite VM deploy runbook for actual reality.

Update:

- `PM2`, not `systemd`
- `/opt/hiring-agent`, not `/home/vova/hiring-agent`
- `3101`, not `3100`
- `MANAGEMENT_DATABASE_URL`, not old DB contract

Acceptance:

- docs match the live production setup

10. Add one explicit troubleshooting matrix.

Examples:

- `public smoke fails, local health passes` -> nginx/DNS/TLS layer
- `pm2 online, no local listener` -> wrong entrypoint / stale process / startup bug
- `health mode != management-auth` -> wrong runtime env

Acceptance:

- common failures can be triaged without opening code first

## Suggested acceptance checklist

- [ ] workflow logs show target SHA, VM SHA before deploy, VM SHA after deploy
- [ ] `/health` returns `deploy_sha`, `app_env`, `mode`, `port`
- [ ] workflow checks local VM health before public smoke
- [ ] deploy fails fast if required VM binaries are missing
- [ ] deploy does not install global `pnpm`
- [ ] rollback procedure is documented
- [ ] VM deploy docs match real production runtime

## Out of scope

- migrating `hiring-agent` off the VM
- changing nginx topology
- changing `management_db` architecture
- full artifact-based deployment in this PR

## Recommended next implementation slice

If we want maximum value with minimal churn, the next PR should contain only:

1. richer `/health` metadata
2. VM preflight checks
3. local VM verification step before public smoke
4. docs update for actual PM2 + `/opt/hiring-agent` + `3101`

That slice is small, high-signal, and should materially reduce future deploy debugging time.
