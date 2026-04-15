#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/Users/vova/Documents/GitHub/hiring-agent}"
CONFIG_FILE="${CONFIG_FILE:-$REPO_DIR/.hh-review-step1-launchd.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
  set +a
fi

if [[ -z "${TEST_CMD:-}" ]] || [[ -z "${SMOKE_CMD:-}" ]]; then
  echo "Required variables missing: TEST_CMD and SMOKE_CMD"
  echo "Set them in $CONFIG_FILE or environment and rerun."
  exit 10
fi

"$REPO_DIR/scripts/hh-review-step1-sandbox-loop.sh"
