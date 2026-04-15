# HH Review Step 1 sandbox loop

This is the practical way to remove manual pauses between iterations.

## What this does

- checks out `master` and refreshes from remotes when available;
- rebases `sandbox/hh-review-step1-playbook` on latest `main`;
- runs targeted tests;
- runs smoke checks;
- logs every action to `LOG_FILE`;
- returns to original branch.

## Default behavior

Create env file or use inline vars:

- `REPO_DIR` — repo path (`/Users/vova/Documents/GitHub/hiring-agent`)
- `MAIN_BRANCH` — `master` (or `main`)
- `MAIN_BRANCH` — auto-detected (`main`, then `master`) when not set
- `SANDBOX_BRANCH` — `sandbox/hh-review-step1-playbook`
- `TEST_CMD` — target test command for changed scenario
- `SMOKE_CMD` — bounded smoke command
- `LOG_FILE` — e.g. `/tmp/hh-review-step1-loop.log`
- `HH_MOCK_PORT` — mock server port (default `19090`)

## Example manual run (one iteration)

```bash
cd /Users/vova/Documents/GitHub/hiring-agent
TEST_CMD="pytest specs/tests/test_hh_step1.py" \
SMOKE_CMD="python scripts/smoke_hh_step1.py --base-url http://127.0.0.1:19090 --vacancy 132102233" \
./scripts/hh-review-step1-sandbox-loop.sh
```

### Mock-first local smoke (recommended)

Start mock:

```bash
./scripts/hh-review-mock-start.sh
```

Run loop iteration:

```bash
cd /Users/vova/Documents/GitHub/hiring-agent
TEST_CMD="pytest specs/tests/test_hh_step1.py" \
SMOKE_CMD="python scripts/smoke_hh_step1.py --base-url http://127.0.0.1:19090 --vacancy 132102233" \
./scripts/hh-review-step1-sandbox-loop.sh
```

Stop mock:

```bash
./scripts/hh-review-mock-stop.sh
```

## Cron-style run

If you want periodic checks only as CI-like guard, use cron:

```cron
*/15 * * * * /bin/zsh -lc 'cd /Users/vova/Documents/GitHub/hiring-agent && TEST_CMD="pytest specs/tests/test_hh_step1.py" SMOKE_CMD="python scripts/smoke_hh_step1.py --base-url http://127.0.0.1:19090 --vacancy 132102233" LOG_FILE="/tmp/hh-review-step1-loop.log" ./scripts/hh-review-step1-sandbox-loop.sh' >> /tmp/hh-review-step1-loop-cron.log 2>&1
```

Installer helper:
```bash
TEST_CMD="pytest specs/tests/test_hh_step1.py" \
SMOKE_CMD="python scripts/smoke_hh_step1.py --base-url http://127.0.0.1:19090 --vacancy 132102233" \
CRON_EXPR="*/15 * * * *" \
./scripts/hh-review-install-loop-cron.sh
```

### Safer on macOS (launchd preferred)

Prefer launchd over cron on newer macOS, especially for longer commands.

Install (macOS):

```bash
TEST_CMD="pytest specs/tests/test_hh_step1.py" \
SMOKE_CMD="python scripts/smoke_hh_step1.py --base-url http://127.0.0.1:19090 --vacancy 132102233" \
HH_REVIEW_LAUNCHD_INTERVAL="900" \
./scripts/hh-review-install-loop-launchd.sh
```

Uninstall:

```bash
./scripts/hh-review-uninstall-loop-launchd.sh
```

Generated files:
- LaunchAgent plist: `$HOME/Library/LaunchAgents/com.clawd.hhreview.step1.plist`
- env config: `/Users/vova/Documents/GitHub/hiring-agent/.hh-review-step1-launchd.env`
- output log: `/tmp/hh-review-step1-launchd.out.log`
- error log: `/tmp/hh-review-step1-launchd.err.log`

Check status:

```bash
launchctl list | grep com.clawd.hhreview.step1
tail -f /tmp/hh-review-step1-launchd.out.log
```

## Run discipline

- This loop is intended for iteration boundaries, not full replacement of human review.
- Keep `TEST_CMD` and `SMOKE_CMD` minimal and scenario-scoped to keep feedback fast.
- If `merge` or `rebase` fails, stop and fix merge blockers manually before next iteration.

## Mock data references

- `scripts/hh-mock-data/vacancy_132102233_responses.json`
- `scripts/hh-mock-data/negotiation_*.json`
