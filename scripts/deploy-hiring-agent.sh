#!/bin/bash
# Deploy hiring-agent to GCP VM (34.31.217.176) via SSH.
# Usage: [VM_USER=username] [TARGET_PORT=3101] ./scripts/deploy-hiring-agent.sh
set -e

VM_HOST="${VM_HOST:-34.31.217.176}"
VM_USER="${VM_USER:-vladimir}"
TARGET_PORT="${TARGET_PORT:-3101}"
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
  cd /opt/hiring-agent

  git fetch origin main
  git checkout main
  git pull origin main

  pnpm install --frozen-lockfile

  # PM2 does not auto-read .env — source it so DATABASE_URL reaches the process
  set -a
  [ -f .env ] && source .env
  set +a

  # Override port from env if passed
  export PORT=\$PORT

  pm2 restart hiring-agent --update-env \
    || pm2 start services/hiring-agent/ecosystem.config.cjs --env production
  pm2 save

  sleep 2
  STATUS=\$(curl -sf http://localhost:\$PORT/health | jq -r '.status' 2>/dev/null || echo "failed")
  echo "Health: \$STATUS"
  [ "\$STATUS" = "ok" ] || { echo "HEALTH CHECK FAILED"; exit 1; }
REMOTE

echo "Deploy succeeded: $SHA"
