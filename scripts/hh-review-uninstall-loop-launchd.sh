#!/usr/bin/env bash
set -euo pipefail

LAUNCHAGENT_DIR="${LAUNCHAGENT_DIR:-$HOME/Library/LaunchAgents}"
LABEL="${HH_REVIEW_LAUNCHD_LABEL:-com.clawd.hhreview.step1}"
PLIST_PATH="$LAUNCHAGENT_DIR/$LABEL.plist"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "plist not found: $PLIST_PATH"
  exit 1
fi

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "removed launchd agent: $PLIST_PATH"
