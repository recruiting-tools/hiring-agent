#!/bin/bash
# Deploy hiring-agent to GCP VM (34.31.217.176) via SSH.
# Usage: [VM_USER=username] ./scripts/deploy-hiring-agent.sh
set -e

VM_HOST="${VM_HOST:-34.31.217.176}"
VM_USER="${VM_USER:-vladimir}"
REPO_DIR="/opt/hiring-agent"
SHA=$(git rev-parse HEAD)

echo "Deploying hiring-agent @ $SHA → $VM_USER@$VM_HOST..."

ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" bash -s << 'REMOTE'
  set -e
  cd /opt/hiring-agent

  git fetch origin main
  git checkout main
  git pull origin main

  pnpm install --frozen-lockfile

  # PM2 does not auto-read .env — source it so DATABASE_URL reaches the process
  set -a
  [ -f .env ] && source .env
  set +a

  pm2 restart hiring-agent --update-env \
    || pm2 start services/hiring-agent/ecosystem.config.cjs --env production
  pm2 save

  sleep 2
  STATUS=$(curl -sf http://localhost:3100/health | jq -r '.status' 2>/dev/null || echo "failed")
  echo "Health: $STATUS"
  [ "$STATUS" = "ok" ] || { echo "HEALTH CHECK FAILED"; exit 1; }
REMOTE

echo "Deploy succeeded: $SHA"
