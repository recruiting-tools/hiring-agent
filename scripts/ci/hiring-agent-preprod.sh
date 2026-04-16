#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./hiring-agent-common.sh
source "$SCRIPT_DIR/hiring-agent-common.sh"

require_env VM_HOST
require_env VM_USER
require_env VM_SSH_KEY
require_env TARGET_PORT
require_env DEPLOY_REF
require_env DEPLOY_DIR
require_env PM2_APP_NAME
require_env APP_BASE_PATH
require_env SESSION_COOKIE_NAME
require_env SANDBOX_PUBLIC_URL
require_env HIRING_AGENT_PUBLIC_HOST
require_env SANDBOX_DEMO_EMAIL
require_env SANDBOX_DEMO_PASSWORD
require_env SANDBOX_DEMO_RECRUITER_ID
require_env SANDBOX_DEMO_CLIENT_ID
require_env MANAGEMENT_DATABASE_URL
require_env OPENROUTER_API_KEY

expected_url="https://${HIRING_AGENT_PUBLIC_HOST}${APP_BASE_PATH}"
[[ "${SANDBOX_PUBLIC_URL%/}" = "$expected_url" ]] || {
  echo "Invalid SANDBOX_PUBLIC_URL: expected '$expected_url' but got '${SANDBOX_PUBLIC_URL%/}'"
  exit 1
}

setup_ssh_access
ensure_sandbox_nginx_routes

write_remote_env_file "$DEPLOY_DIR/.env" "$(printf 'NODE_ENV=production\nAPP_ENV=sandbox\nAPP_BASE_PATH=%s\nSESSION_COOKIE_NAME=%s\nDEPLOY_SHA=%s\nMANAGEMENT_DATABASE_URL=%s\nOPENROUTER_API_KEY=%s\n' \
  "$APP_BASE_PATH" "$SESSION_COOKIE_NAME" "$GITHUB_SHA" "$MANAGEMENT_DATABASE_URL" "$OPENROUTER_API_KEY")"

DEMO_RECRUITER_ID="$SANDBOX_DEMO_RECRUITER_ID" \
DEMO_CLIENT_ID="$SANDBOX_DEMO_CLIENT_ID" \
DEMO_EMAIL="$SANDBOX_DEMO_EMAIL" \
DEMO_PASSWORD="$SANDBOX_DEMO_PASSWORD" \
node scripts/bootstrap-demo-user.js

bash ./scripts/deploy-hiring-agent.sh

ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" bash -s <<EOF
set -euo pipefail
cd "$DEPLOY_DIR"
MANAGEMENT_DATABASE_URL=\$(awk -F= '
  /^MANAGEMENT_DATABASE_URL=/ {
    sub(/^MANAGEMENT_DATABASE_URL=/, "")
    print
    exit
  }
' ./.env)
[[ -n "\${MANAGEMENT_DATABASE_URL:-}" ]] || { echo "ERROR: MANAGEMENT_DATABASE_URL missing in .env"; exit 1; }
export MANAGEMENT_DATABASE_URL
node ./scripts/bootstrap-sandbox-bindings.js --source-env prod --target-env sandbox
HEALTH=\$(curl -sf "http://127.0.0.1:${TARGET_PORT}/health")
STATUS=\$(echo "\$HEALTH" | jq -r '.status // "failed"')
MODE=\$(echo "\$HEALTH" | jq -r '.mode // "unknown"')
DEPLOY_SHA=\$(echo "\$HEALTH" | jq -r '.deploy_sha // "unknown"')
APP_ENV=\$(echo "\$HEALTH" | jq -r '.app_env // "unknown"')
echo "Sandbox health: \$STATUS / \$MODE / sha=\$DEPLOY_SHA / env=\$APP_ENV"
[[ "\$STATUS" = "ok" ]]
[[ "\$MODE" = "management-auth" ]]
[[ "\$APP_ENV" = "sandbox" ]]
[[ "\$DEPLOY_SHA" = "$GITHUB_SHA" ]]
EOF

HIRING_AGENT_BASE_URL="$SANDBOX_PUBLIC_URL" \
HIRING_AGENT_SMOKE_EMAIL="$SANDBOX_DEMO_EMAIL" \
HIRING_AGENT_SMOKE_PASSWORD="$SANDBOX_DEMO_PASSWORD" \
MONITOR_EMAIL="$SANDBOX_DEMO_EMAIL" \
MONITOR_PASSWORD="$SANDBOX_DEMO_PASSWORD" \
EXPECTED_APP_ENV="sandbox" \
EXPECTED_PORT="$TARGET_PORT" \
EXPECTED_DEPLOY_SHA="$GITHUB_SHA" \
SESSION_COOKIE_NAME="$SESSION_COOKIE_NAME" \
bash "$SCRIPT_DIR/hiring-agent-public-auth-jobs-smoke.sh"
