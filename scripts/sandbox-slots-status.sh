#!/usr/bin/env bash
set -euo pipefail

WORKFLOW_NAME="${WORKFLOW_NAME:-Deploy hiring-agent to sandbox slot}"
LIMIT="${LIMIT:-200}"
SLOTS=("sandbox-1" "sandbox-2" "sandbox-3")

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required"
  exit 1
fi

runs_json="$(gh run list --workflow "$WORKFLOW_NAME" --limit "$LIMIT" --json status,displayTitle,headBranch,startedAt,createdAt,url 2>/dev/null || echo "[]")"

printf "%-10s %-8s %-28s %-26s %s\n" "SLOT" "STATE" "REF" "STARTED_AT_UTC" "RUN"
printf "%-10s %-8s %-28s %-26s %s\n" "----------" "--------" "----------------------------" "--------------------------" "------------------------------"

for slot in "${SLOTS[@]}"; do
  run="$(jq -c --arg slot "$slot" '
    [ .[]
      | select((.status == "in_progress" or .status == "queued"))
      | select(.displayTitle | contains("slot=" + $slot + " "))
    ]
    | sort_by(.createdAt)
    | reverse
    | .[0]
  ' <<<"$runs_json")"

  if [[ "$run" == "null" ]]; then
    printf "%-10s %-8s %-28s %-26s %s\n" "$slot" "free" "-" "-" "-"
    continue
  fi

  state="$(jq -r '.status' <<<"$run")"
  ref="$(jq -r '.headBranch // "-"' <<<"$run")"
  started="$(jq -r '.startedAt // .createdAt // "-"' <<<"$run")"
  url="$(jq -r '.url // "-"' <<<"$run")"
  printf "%-10s %-8s %-28s %-26s %s\n" "$slot" "$state" "$ref" "$started" "$url"
done
