#!/usr/bin/env bash
set -euo pipefail

LAUNCHAGENT_DIR="${LAUNCHAGENT_DIR:-$HOME/Library/LaunchAgents}"
LABEL="${HH_REVIEW_LAUNCHD_LABEL:-com.clawd.hhreview.step1}"
PLIST_PATH="$LAUNCHAGENT_DIR/$LABEL.plist"
LOG_DIR="${HH_REVIEW_LAUNCHD_LOG_DIR:-/tmp}"
START_INTERVAL="${HH_REVIEW_LAUNCHD_INTERVAL:-900}"

REPO_DIR="${REPO_DIR:-/Users/vova/Documents/GitHub/hiring-agent}"
TEST_CMD="${TEST_CMD:-}"
SMOKE_CMD="${SMOKE_CMD:-}"
CONFIG_FILE="${CONFIG_FILE:-$REPO_DIR/.hh-review-step1-launchd.env}"

if [[ -z "$TEST_CMD" || -z "$SMOKE_CMD" ]]; then
  echo "Set TEST_CMD and SMOKE_CMD before installing launchd."
  echo "Example: TEST_CMD=\"pytest specs/tests/test_hh_step1.py\" SMOKE_CMD=\"python scripts/smoke_hh_step1.py --base-url http://127.0.0.1:19090 --vacancy 132102233\" $0"
  exit 1
fi

mkdir -p "$LOG_DIR"
mkdir -p "$LAUNCHAGENT_DIR"

cat > "$CONFIG_FILE" <<EOF
TEST_CMD="$TEST_CMD"
SMOKE_CMD="$SMOKE_CMD"
REPO_DIR="$REPO_DIR"
LOG_FILE="$LOG_DIR/hh-review-step1-loop.log"
EOF

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$REPO_DIR/scripts/hh-review-step1-launchd-runner.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>$START_INTERVAL</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/hh-review-step1-launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/hh-review-step1-launchd.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load -w "$PLIST_PATH"

echo "installed launchd agent: $PLIST_PATH"
echo "interval: ${START_INTERVAL}s"
echo "config:  $CONFIG_FILE"
echo "run: launchctl list | grep $LABEL"
echo "tail: tail -f $LOG_DIR/hh-review-step1-launchd.out.log"
