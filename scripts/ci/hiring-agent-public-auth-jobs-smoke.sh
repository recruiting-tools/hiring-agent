#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: $name"
    exit 1
  fi
}

require_env HIRING_AGENT_BASE_URL
require_env HIRING_AGENT_SMOKE_EMAIL
require_env HIRING_AGENT_SMOKE_PASSWORD
require_env MONITOR_EMAIL
require_env MONITOR_PASSWORD
require_env EXPECTED_APP_ENV
require_env EXPECTED_PORT
require_env SESSION_COOKIE_NAME

echo "::group::Public health"
HEALTH="$(curl -sf "${HIRING_AGENT_BASE_URL%/}/health" 2>/dev/null || echo '{}')"
STATUS="$(echo "$HEALTH" | jq -r '.status // "failed"')"
MODE="$(echo "$HEALTH" | jq -r '.mode // "unknown"')"
DEPLOY_SHA="$(echo "$HEALTH" | jq -r '.deploy_sha // "unknown"')"
APP_ENV="$(echo "$HEALTH" | jq -r '.app_env // "unknown"')"
echo "Health: $STATUS / $MODE / sha=$DEPLOY_SHA / env=$APP_ENV"
echo "$HEALTH" | jq .
[[ "$STATUS" = "ok" ]]
[[ "$MODE" = "management-auth" ]]
[[ "$APP_ENV" = "$EXPECTED_APP_ENV" ]]
if [[ -n "${EXPECTED_DEPLOY_SHA:-}" ]]; then
  [[ "$DEPLOY_SHA" = "$EXPECTED_DEPLOY_SHA" ]]
fi
echo "::endgroup::"

echo "::group::Websocket monitor"
corepack pnpm monitor:hiring-agent -- --base-url "${HIRING_AGENT_BASE_URL%/}" --expected-env "$EXPECTED_APP_ENV" --expected-port "$EXPECTED_PORT" --require-auth-ws
echo "::endgroup::"

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "::group::Authenticated jobs smoke"
curl -sf -c "$COOKIE_JAR" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${HIRING_AGENT_SMOKE_EMAIL}\",\"password\":\"${HIRING_AGENT_SMOKE_PASSWORD}\"}" \
  "${HIRING_AGENT_BASE_URL%/}/auth/login" >/tmp/hiring-agent-login.json

grep -q "$SESSION_COOKIE_NAME" "$COOKIE_JAR" || { echo "Expected session cookie $SESSION_COOKIE_NAME"; cat "$COOKIE_JAR"; exit 1; }
echo "Session cookie present: $SESSION_COOKIE_NAME"

JOBS_JSON="$(curl -sf -b "$COOKIE_JAR" "${HIRING_AGENT_BASE_URL%/}/api/jobs")"
echo "$JOBS_JSON" | jq .
echo "$JOBS_JSON" | jq -e '(.jobs // .vacancies // []) | type == "array"' >/dev/null
echo "::endgroup::"
