#!/usr/bin/env bash
set -euo pipefail

slot="${1:-}"
ref="${2:-$(git rev-parse --abbrev-ref HEAD)}"

default_port_for_slot() {
  case "$1" in
    sandbox-1) echo "3201" ;;
    sandbox-2) echo "3202" ;;
    sandbox-3) echo "3203" ;;
    *) return 1 ;;
  esac
}

if [[ -z "$slot" ]]; then
  cat <<'EOF'
Usage:
  scripts/deploy-hiring-agent-sandbox-slot.sh <sandbox-1|sandbox-2|sandbox-3> [ref] [port]

Examples:
  scripts/deploy-hiring-agent-sandbox-slot.sh sandbox-1
  scripts/deploy-hiring-agent-sandbox-slot.sh sandbox-2 feature/my-branch
  scripts/deploy-hiring-agent-sandbox-slot.sh sandbox-3 feature/my-branch 3303
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

target_port="${3:-$(default_port_for_slot "$slot")}"

gh workflow run "Deploy hiring-agent to sandbox slot" \
  -f slot="$slot" \
  -f deploy_ref="$ref" \
  -f target_port="$target_port"

echo "Triggered deploy: slot=$slot ref=$ref port=$target_port"
