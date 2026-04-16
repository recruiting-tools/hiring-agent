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
require_env HIRING_AGENT_PUBLIC_URL
require_env MANAGEMENT_DATABASE_URL
require_env OPENROUTER_API_KEY

setup_ssh_access

echo "Checking port $TARGET_PORT on VM..."
ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" bash -s <<'EOF'
echo "=== Listening ports ==="
ss -tlnp | awk 'NR==1 || /LISTEN/' || netstat -tlnp 2>/dev/null || true
echo "=== PM2 processes ==="
pm2 list 2>/dev/null || echo "(pm2 not running)"
EOF

write_remote_env_file "/opt/hiring-agent/.env" "$(printf 'NODE_ENV=production\nAPP_ENV=prod\nDEPLOY_SHA=%s\nMANAGEMENT_DATABASE_URL=%s\nOPENROUTER_API_KEY=%s\n' \
  "$GITHUB_SHA" "$MANAGEMENT_DATABASE_URL" "$OPENROUTER_API_KEY")"

bash ./scripts/deploy-hiring-agent.sh

ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" bash -s <<EOF
set -euo pipefail
HEALTH=\$(curl -sf "http://127.0.0.1:${TARGET_PORT}/health")
STATUS=\$(echo "\$HEALTH" | jq -r '.status // "failed"')
MODE=\$(echo "\$HEALTH" | jq -r '.mode // "unknown"')
DEPLOY_SHA=\$(echo "\$HEALTH" | jq -r '.deploy_sha // "unknown"')
APP_ENV=\$(echo "\$HEALTH" | jq -r '.app_env // "unknown"')
PORT=\$(echo "\$HEALTH" | jq -r '.port // "unknown"')
echo "Local health: \$STATUS / \$MODE / sha=\$DEPLOY_SHA / env=\$APP_ENV / port=\$PORT"
ss -tlnp | grep ":${TARGET_PORT} " || { echo "Expected listener on ${TARGET_PORT}"; exit 1; }
PM2_JSON=\$(pm2 jlist | jq -r '.[] | select(.name=="hiring-agent")')
echo "\$PM2_JSON" | jq -r '{name,pid,pm_exec_path:.pm2_env.pm_exec_path,pm_cwd:.pm2_env.pm_cwd,port:(.pm2_env.PORT // .pm2_env.env.PORT // ""),app_env:(.pm2_env.APP_ENV // .pm2_env.env.APP_ENV // ""),deploy_sha:(.pm2_env.DEPLOY_SHA // .pm2_env.env.DEPLOY_SHA // ""),management_database_url:(if (.pm2_env.MANAGEMENT_DATABASE_URL // .pm2_env.env.MANAGEMENT_DATABASE_URL // "") == "" then "missing" else "present" end)}'
[[ "\$STATUS" = "ok" ]]
[[ "\$MODE" = "management-auth" ]]
[[ "\$APP_ENV" = "prod" ]]
[[ "\$DEPLOY_SHA" = "$GITHUB_SHA" ]]
[[ "\$(echo "\$PM2_JSON" | jq -r '(.pm2_env.APP_ENV // .pm2_env.env.APP_ENV // "")')" = "prod" ]]
[[ "\$(echo "\$PM2_JSON" | jq -r '(.pm2_env.DEPLOY_SHA // .pm2_env.env.DEPLOY_SHA // "")')" = "$GITHUB_SHA" ]]
[[ "\$(echo "\$PM2_JSON" | jq -r 'if (.pm2_env.MANAGEMENT_DATABASE_URL // .pm2_env.env.MANAGEMENT_DATABASE_URL // "") == "" then "missing" else "present" end')" = "present" ]]
EOF

echo "::group::Websocket monitor"
corepack pnpm monitor:hiring-agent -- --base-url "${HIRING_AGENT_PUBLIC_URL%/}"
echo "::endgroup::"
