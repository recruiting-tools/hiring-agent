#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${SCRIPT_PATH:-/Users/vova/Documents/GitHub/hiring-agent/scripts/hh-review-step1-sandbox-loop.sh}"
REPO_DIR="${REPO_DIR:-/Users/vova/Documents/GitHub/hiring-agent}"
TEST_CMD="${TEST_CMD:-}"
SMOKE_CMD="${SMOKE_CMD:-}"
LOG_FILE="${LOG_FILE:-/tmp/hh-review-step1-loop.log}"
CRON_EXPR="${CRON_EXPR:-*/15 * * * *}"

if [[ -z "$TEST_CMD" ]] || [[ -z "$SMOKE_CMD" ]]; then
  echo "Set TEST_CMD and SMOKE_CMD before installing cron."
  echo "Example:"
  echo "  TEST_CMD=\"pytest specs/tests/test_hh_step1.py\" SMOKE_CMD=\"python scripts/smoke_hh_step1.py --base-url http://127.0.0.1:19090 --vacancy 132102233\" $0"
  exit 1
fi

CRON_CMD="/bin/zsh -lc 'cd $REPO_DIR && TEST_CMD=\"$TEST_CMD\" SMOKE_CMD=\"$SMOKE_CMD\" LOG_FILE=\"$LOG_FILE\" $SCRIPT_PATH >> \"$LOG_FILE\" 2>&1'"
CRON_TAG="# HH_REVIEW_STEP1_SANDBOX_LOOP"

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab not available"
  exit 2
fi

CURRENT="$(crontab -l 2>/dev/null | sed '/^#/d' | sed '/HH_REVIEW_STEP1_SANDBOX_LOOP/d')"
printf "%s\n%s %s %s\n" "$CURRENT" "$CRON_EXPR" "$CRON_CMD $CRON_TAG" | crontab -
echo "installed cron entry:"
echo "$CRON_EXPR $CRON_CMD $CRON_TAG"
echo "view with: crontab -l"
