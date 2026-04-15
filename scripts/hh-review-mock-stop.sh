#!/usr/bin/env bash
set -euo pipefail

PID_FILE="${HH_MOCK_PID_FILE:-/tmp/hh-review-mock.pid}"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Mock pid file not found: $PID_FILE"
  exit 0
fi

pid="$(cat "$PID_FILE")"
if ps -p "$pid" >/dev/null 2>&1; then
  kill "$pid"
  echo "stopped pid $pid"
else
  echo "process not running: $pid"
fi
rm -f "$PID_FILE"
