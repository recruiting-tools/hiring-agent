#!/bin/bash
# Deploy hiring-agent to GCP VM (34.31.217.176) via SSH.
# Usage: [VM_USER=username] [TARGET_PORT=3101] ./scripts/deploy-hiring-agent.sh
set -euo pipefail

VM_HOST="${VM_HOST:-hiring-agent-vm}"
VM_USER="${VM_USER:-vova}"
TARGET_PORT="${TARGET_PORT:-3101}"
DEPLOY_REF="${DEPLOY_REF:-main}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/hiring-agent}"
PM2_APP_NAME="${PM2_APP_NAME:-hiring-agent}"
REPO_URL="${REPO_URL:-$(gh repo view --json sshUrl -q .sshUrl 2>/dev/null || git remote get-url origin)}"
SHA=$(git rev-parse HEAD)

echo "Deploying $PM2_APP_NAME @ $SHA → $VM_USER@$VM_HOST (port $TARGET_PORT, dir $DEPLOY_DIR)..."

ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" \
  TARGET_PORT="$TARGET_PORT" \
  DEPLOY_REF="$DEPLOY_REF" \
  DEPLOY_DIR="$DEPLOY_DIR" \
  PM2_APP_NAME="$PM2_APP_NAME" \
  REPO_URL="$REPO_URL" \
  SHA="$SHA" \
  bash -s <<'REMOTE'
  set -euo pipefail

  require_bin() {
    if ! command -v "$1" >/dev/null 2>&1; then
      echo "ERROR: required binary '$1' is missing on VM"
      exit 1
    fi
  }

  echo "--- vm preflight ---"
  require_bin git
  require_bin node
  require_bin pm2
  require_bin jq
  if ! command -v pnpm >/dev/null 2>&1 && ! command -v corepack >/dev/null 2>&1; then
    echo "ERROR: neither pnpm nor corepack is available on VM"
    exit 1
  fi
  echo "node: $(node --version)"
  echo "pm2: $(pm2 --version | tail -1)"
  echo "git: $(git --version)"
  echo "jq: $(jq --version)"
  if command -v pnpm >/dev/null 2>&1; then
    echo "pnpm: $(pnpm --version)"
  else
    echo "pnpm: unavailable, will use corepack pnpm"
  fi

  # ── Port conflict check ────────────────────────────────────────────────────
  # Fail fast if another process (not our own PM2 hiring-agent) owns the port.
  PORT=$TARGET_PORT
  if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
    PORT_LINE=$(ss -tlnp | grep ":$PORT ")
    PORT_PID=$(echo "$PORT_LINE" | grep -oP 'pid=\K[0-9]+' | head -1)
    PM2_PID=$(pm2 pid "$PM2_APP_NAME" 2>/dev/null | tr -d ' \n' || echo "")
    if [ -z "$PM2_PID" ] || [ "$PORT_PID" != "$PM2_PID" ]; then
      echo "ERROR: Port $PORT is already in use by another process (PID=$PORT_PID):"
      echo "$PORT_LINE"
      echo ""
      echo "Running services on this VM:"
      ss -tlnp | awk 'NR==1 || /LISTEN/' | head -20
      echo ""
      echo "Fix: set TARGET_PORT=<free_port> or stop the conflicting process first."
      exit 1
    fi
    echo "Port $PORT is held by PM2 app '$PM2_APP_NAME' (PID=$PM2_PID) — will restart."
  else
    echo "Port $PORT is free."
  fi

  # ── Deploy ─────────────────────────────────────────────────────────────────
  if [ ! -d "$DEPLOY_DIR/.git" ]; then
    echo "First deploy detected: cloning repository into $DEPLOY_DIR"
    mkdir -p /opt
    rm -rf "$DEPLOY_DIR"
    git clone "$REPO_URL" "$DEPLOY_DIR"
  fi

  cd "$DEPLOY_DIR"

  git fetch origin "$DEPLOY_REF"
  git checkout "$DEPLOY_REF"
  git reset --hard "origin/$DEPLOY_REF"

  run_pnpm() {
    if command -v pnpm >/dev/null 2>&1; then
      pnpm "$@"
      return
    fi

    if command -v corepack >/dev/null 2>&1; then
      corepack enable >/dev/null 2>&1 || true
      corepack pnpm "$@"
      return
    fi

    npm install -g pnpm
    pnpm "\$@"
  }

  run_pnpm install --frozen-lockfile

  # PM2 does not auto-read .env. Load key=value lines without shell-evaluating values,
  # because connection strings may contain characters like '&' that break `source .env`.
  if [ -f .env ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      [ -z "$line" ] && continue
      case "$line" in
        \#*) continue ;;
      esac
      export "$line"
    done < .env
  fi

  # Override port from env if passed
  export PORT=$PORT
  export DEPLOY_SHA="$SHA"
  export PM2_APP_NAME="$PM2_APP_NAME"
  export APP_CWD="$DEPLOY_DIR/services/hiring-agent"

  pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
  pm2 start services/hiring-agent/ecosystem.config.cjs --env production --update-env
  pm2 save

  PM2_JSON=$(pm2 jlist | jq -r --arg app "$PM2_APP_NAME" '.[] | select(.name==$app)')
  PM2_APP_ENV=$(printf '%s' "$PM2_JSON" | jq -r '(.pm2_env.APP_ENV // .pm2_env.env.APP_ENV // "")')
  PM2_DEPLOY_SHA=$(printf '%s' "$PM2_JSON" | jq -r '(.pm2_env.DEPLOY_SHA // .pm2_env.env.DEPLOY_SHA // "")')
  PM2_MANAGEMENT_DB=$(printf '%s' "$PM2_JSON" | jq -r 'if (.pm2_env.MANAGEMENT_DATABASE_URL // .pm2_env.env.MANAGEMENT_DATABASE_URL // "") == "" then "missing" else "present" end')

  [ "$PM2_APP_ENV" = "${APP_ENV:-}" ] || {
    echo "ERROR: PM2 runtime APP_ENV mismatch: expected='${APP_ENV:-}' actual='${PM2_APP_ENV:-}'"
    exit 1
  }
  [ "$PM2_DEPLOY_SHA" = "$DEPLOY_SHA" ] || {
    echo "ERROR: PM2 runtime DEPLOY_SHA mismatch: expected='$DEPLOY_SHA' actual='${PM2_DEPLOY_SHA:-}'"
    exit 1
  }
  [ "$PM2_MANAGEMENT_DB" = "present" ] || {
    echo "ERROR: PM2 runtime MANAGEMENT_DATABASE_URL is missing"
    exit 1
  }

  echo "Waiting for service to become healthy..."
  for i in $(seq 1 10); do
    HEALTH_BODY=$(curl -sf http://localhost:$PORT/health 2>/dev/null || echo "")
    STATUS=$(printf '%s' "$HEALTH_BODY" | jq -r '.status' 2>/dev/null || echo "")
    [ "$STATUS" = "ok" ] && { echo "Health check passed (attempt $i)"; break; }
    echo "Attempt $i/10: not ready (status=${STATUS:-no-response}), waiting..."
    sleep 2
    [ "$i" = "10" ] && {
      echo "HEALTH CHECK FAILED after 10 attempts"
      echo "--- deploy sha ---"
      git rev-parse HEAD
      echo "--- effective env ---"
      env | egrep '^(PORT|NODE_ENV|APP_MODE|APP_ENV|MANAGEMENT_DATABASE_URL)=' \
        | sed 's/^MANAGEMENT_DATABASE_URL=.*/MANAGEMENT_DATABASE_URL=[set]/'
      echo "--- pm2 jlist ---"
      pm2 jlist | jq -r --arg app "$PM2_APP_NAME" '.[] | select(.name==$app) | {
        name,
        pid,
        pm_exec_path: .pm2_env.pm_exec_path,
        pm_cwd: .pm2_env.pm_cwd,
        port: (.pm2_env.PORT // .pm2_env.env.PORT // ""),
        node_env: (.pm2_env.NODE_ENV // .pm2_env.env.NODE_ENV // ""),
        app_env: (.pm2_env.APP_ENV // .pm2_env.env.APP_ENV // ""),
        deploy_sha: (.pm2_env.DEPLOY_SHA // .pm2_env.env.DEPLOY_SHA // ""),
        app_mode: (.pm2_env.APP_MODE // .pm2_env.env.APP_MODE // ""),
        management_database_url: (if (.pm2_env.MANAGEMENT_DATABASE_URL // .pm2_env.env.MANAGEMENT_DATABASE_URL // "") == "" then "missing" else "present" end)
      }'
      echo "--- sockets ---"
      ss -tlnp | awk 'NR==1 || /LISTEN/'
      echo "--- local health body ---"
      printf '%s\n' "${HEALTH_BODY:-}"
      echo "--- pm2 logs ---"
      pm2 logs "$PM2_APP_NAME" --lines 80 --nostream || true
      exit 1
    }
  done
REMOTE

echo "Deploy succeeded: $SHA"
