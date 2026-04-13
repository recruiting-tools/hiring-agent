#!/bin/bash
# Deploy hiring-agent to GCP VM (34.31.217.176) via SSH.
# Usage: [VM_USER=username] [TARGET_PORT=3101] ./scripts/deploy-hiring-agent.sh
set -e

VM_HOST="${VM_HOST:-34.31.217.176}"
VM_USER="${VM_USER:-vladimir}"
TARGET_PORT="${TARGET_PORT:-3101}"
DEPLOY_REF="${DEPLOY_REF:-main}"
REPO_URL="${REPO_URL:-$(gh repo view --json sshUrl -q .sshUrl 2>/dev/null || git remote get-url origin)}"
SHA=$(git rev-parse HEAD)

echo "Deploying hiring-agent @ $SHA → $VM_USER@$VM_HOST (port $TARGET_PORT)..."

ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" bash -s << REMOTE
  set -e

  # ── Port conflict check ────────────────────────────────────────────────────
  # Fail fast if another process (not our own PM2 hiring-agent) owns the port.
  PORT=$TARGET_PORT
  if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    PORT_LINE=\$(ss -tlnp | grep ":$PORT ")
    PORT_PID=\$(echo "\$PORT_LINE" | grep -oP 'pid=\K[0-9]+' | head -1)
    PM2_PID=\$(pm2 pid hiring-agent 2>/dev/null | tr -d ' \n' || echo "")
    if [ -z "\$PM2_PID" ] || [ "\$PORT_PID" != "\$PM2_PID" ]; then
      echo "ERROR: Port \$PORT is already in use by another process (PID=\$PORT_PID):"
      echo "\$PORT_LINE"
      echo ""
      echo "Running services on this VM:"
      ss -tlnp | awk 'NR==1 || /LISTEN/' | head -20
      echo ""
      echo "Fix: set TARGET_PORT=<free_port> or stop the conflicting process first."
      exit 1
    fi
    echo "Port \$PORT is held by hiring-agent PM2 (PID=\$PM2_PID) — will restart."
  else
    echo "Port \$PORT is free."
  fi

  # ── Deploy ─────────────────────────────────────────────────────────────────
  if [ ! -d /opt/hiring-agent/.git ]; then
    echo "First deploy detected: cloning repository into /opt/hiring-agent"
    mkdir -p /opt
    rm -rf /opt/hiring-agent
    git clone "$REPO_URL" /opt/hiring-agent
  fi

  cd /opt/hiring-agent

  git fetch origin "$DEPLOY_REF"
  git checkout "$DEPLOY_REF"
  git pull origin "$DEPLOY_REF"

  run_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
      pnpm "\$@"
      return
    fi

    if command -v corepack >/dev/null 2>&1; then
      corepack enable >/dev/null 2>&1 || true
      corepack pnpm "\$@"
      return
    fi

    npm install -g pnpm
    pnpm "\$@"
  }

  run_pnpm install --frozen-lockfile

  # PM2 does not auto-read .env. Load key=value lines without shell-evaluating values,
  # because connection strings may contain characters like '&' that break `source .env`.
  if [ -f .env ]; then
    while IFS= read -r line || [ -n "\$line" ]; do
      [ -z "\$line" ] && continue
      case "\$line" in
        \#*) continue ;;
      esac
      export "\$line"
    done < .env
  fi

  # Override port from env if passed
  export PORT=\$PORT

  pm2 restart hiring-agent --update-env \
    || pm2 start services/hiring-agent/ecosystem.config.cjs --env production --update-env
  pm2 save

  echo "Waiting for service to become healthy..."
  for i in \$(seq 1 10); do
    STATUS=\$(curl -sf http://localhost:\$PORT/health | jq -r '.status' 2>/dev/null || echo "")
    [ "\$STATUS" = "ok" ] && { echo "Health check passed (attempt \$i)"; break; }
    echo "Attempt \$i/10: not ready (status=\${STATUS:-no-response}), waiting..."
    sleep 2
    [ "\$i" = "10" ] && { echo "HEALTH CHECK FAILED after 10 attempts"; exit 1; }
  done
REMOTE

echo "Deploy succeeded: $SHA"
