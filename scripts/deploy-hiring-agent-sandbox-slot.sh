#!/usr/bin/env bash
set -euo pipefail

slot="${1:-}"
ref="${2:-$(git rev-parse --abbrev-ref HEAD)}"
target_port="${3:-3101}"

if [[ -z "$slot" ]]; then
  cat <<'EOF'
Usage:
  scripts/deploy-hiring-agent-sandbox-slot.sh <sandbox-1|sandbox-2|sandbox-3> [ref] [port]

Examples:
  scripts/deploy-hiring-agent-sandbox-slot.sh sandbox-1
  scripts/deploy-hiring-agent-sandbox-slot.sh sandbox-2 feature/my-branch 3101
EOF
  exit 1
fi

case "$slot" in
  sandbox-1|sandbox-2|sandbox-3) ;;
  *)
    echo "Invalid slot: $slot"
    exit 1
    ;;
esac

gh workflow run "Deploy hiring-agent to sandbox slot" \
  -f slot="$slot" \
  -f deploy_ref="$ref" \
  -f target_port="$target_port"

echo "Triggered deploy: slot=$slot ref=$ref port=$target_port"
