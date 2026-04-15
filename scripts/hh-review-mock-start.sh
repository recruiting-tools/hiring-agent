#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/Users/vova/Documents/GitHub/hiring-agent}"
HOST="${HH_MOCK_HOST:-127.0.0.1}"
PORT="${HH_MOCK_PORT:-19090}"
PID_FILE="${HH_MOCK_PID_FILE:-/tmp/hh-review-mock.pid}"
LOG_FILE="${HH_MOCK_LOG_FILE:-/tmp/hh-review-mock.log}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --repo-dir)
      REPO_DIR="${2:-}"
      shift 2
      ;;
    --pid-file)
      PID_FILE="${2:-}"
      shift 2
      ;;
    --log-file)
      LOG_FILE="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--host HOST] [--port PORT] [--repo-dir PATH] [--pid-file PATH] [--log-file PATH]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1"
      echo "Usage: $0 [--host HOST] [--port PORT] [--repo-dir PATH] [--pid-file PATH] [--log-file PATH]"
      exit 2
      ;;
  esac
done

cd "$REPO_DIR"

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if ps -p "$pid" >/dev/null 2>&1; then
    echo "Mock already running with pid $pid"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

python3 scripts/hh-mock-server.py --host "$HOST" --port "$PORT" >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "hh mock started, pid=$(cat "$PID_FILE"), host=$HOST, port=$PORT, log=$LOG_FILE"
