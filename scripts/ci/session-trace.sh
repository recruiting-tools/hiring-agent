#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-}"
EVENT_NAME="${GITHUB_EVENT_NAME:-}"
EVENT_PATH="${GITHUB_EVENT_PATH:-}"
HEAD_SHA="${GITHUB_SHA:-}"
REF_NAME="${GITHUB_REF_NAME:-}"
HEAD_BRANCH="${GITHUB_HEAD_REF:-${REF_NAME}}"
SERVER_URL="${GITHUB_SERVER_URL:-https://github.com}"
RUN_ID="${GITHUB_RUN_ID:-}"
RUN_URL="${SERVER_URL}/${REPO}/actions/runs/${RUN_ID}"
STRICT_TRACE="${TRACE_STRICT:-false}"

pr_number=""
pr_title=""
pr_url=""
pr_body=""
session_id=""
callback_url=""

require_tool() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "::error::Required tool missing: ${tool}"
    exit 1
  fi
}

require_tool jq

extract_from_body() {
  local body="$1"

  local explicit_session
  explicit_session=$(
    BODY="$body" node <<'EOF'
const body = process.env.BODY ?? "";
const match = body.match(/^Session ID:\s*(.+)$/im);
const rawValue = match?.[1] ?? "";
const normalized = rawValue
  .trim()
  .replace(/^`+/, "")
  .replace(/`+$/, "")
  .trim();
process.stdout.write(normalized);
EOF
  )

  local callback
  callback=$(printf '%s\n' "$body" | sed -nE 's/.*ci-callback: ([^ >]+).*/\1/p' | head -1)

  local derived_session=""
  if [[ -n "$callback" ]]; then
    derived_session=$(printf '%s\n' "$callback" | sed -nE 's#.*\/api\/sessions\/([^/]+)\/reply.*#\1#p' | head -1)
  fi

  session_id="${explicit_session:-$derived_session}"
  callback_url="$callback"
}

load_pr_from_event() {
  [[ -f "$EVENT_PATH" ]] || return 0

  pr_number=$(jq -r '.pull_request.number // empty' "$EVENT_PATH")
  pr_title=$(jq -r '.pull_request.title // empty' "$EVENT_PATH")
  pr_url=$(jq -r '.pull_request.html_url // empty' "$EVENT_PATH")
  pr_body=$(jq -r '.pull_request.body // empty' "$EVENT_PATH")
}

load_pr_from_commit() {
  [[ -n "${GH_TOKEN:-}" ]] || return 0
  [[ -n "$REPO" && -n "$HEAD_SHA" ]] || return 0
  require_tool gh

  local pr_json
  pr_json=$(gh api "repos/${REPO}/commits/${HEAD_SHA}/pulls" 2>/dev/null | jq '.[0] // empty')
  [[ -n "$pr_json" ]] || return 0

  pr_number=$(printf '%s' "$pr_json" | jq -r '.number // empty')
  pr_title=$(printf '%s' "$pr_json" | jq -r '.title // empty')
  pr_url=$(printf '%s' "$pr_json" | jq -r '.html_url // empty')
  pr_body=$(printf '%s' "$pr_json" | jq -r '.body // empty')
}

write_output() {
  local key="$1"
  local value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  fi
}

if [[ "$EVENT_NAME" == "pull_request" || "$EVENT_NAME" == "pull_request_target" ]]; then
  load_pr_from_event
else
  load_pr_from_commit
fi

extract_from_body "$pr_body"

echo "::group::Session trace"
echo "event=${EVENT_NAME:-unknown}"
echo "run_url=$RUN_URL"
echo "sha=${HEAD_SHA:-unknown}"
echo "branch=${HEAD_BRANCH:-unknown}"
if [[ -n "$pr_number" ]]; then
  echo "pr=#${pr_number} ${pr_title}"
  echo "pr_url=${pr_url}"
else
  echo "pr=not-associated"
fi
if [[ -n "$session_id" ]]; then
  echo "session_id=${session_id}"
else
  echo "session_id=missing"
fi
if [[ -n "$callback_url" ]]; then
  echo "ci_callback=${callback_url}"
else
  echo "ci_callback=missing"
fi
echo "::endgroup::"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Session Trace"
    echo
    echo "| Field | Value |"
    echo "| --- | --- |"
    echo "| Event | \`${EVENT_NAME:-unknown}\` |"
    echo "| Branch | \`${HEAD_BRANCH:-unknown}\` |"
    echo "| SHA | \`${HEAD_SHA:-unknown}\` |"
    if [[ -n "$pr_number" ]]; then
      echo "| PR | [#${pr_number}](${pr_url}) |"
      echo "| PR Title | ${pr_title} |"
    else
      echo "| PR | none |"
      echo "| PR Title | n/a |"
    fi
    if [[ -n "$session_id" ]]; then
      echo "| Session ID | \`${session_id}\` |"
    else
      echo "| Session ID | missing |"
    fi
    if [[ -n "$callback_url" ]]; then
      echo "| CI Callback | \`${callback_url}\` |"
    else
      echo "| CI Callback | missing |"
    fi
    echo "| Run | [actions/runs/${RUN_ID}](${RUN_URL}) |"
  } >> "$GITHUB_STEP_SUMMARY"
fi

write_output "pr_number" "$pr_number"
write_output "session_id" "$session_id"
write_output "callback_url" "$callback_url"

if [[ -n "$pr_number" && -z "$session_id" ]]; then
  echo "::warning::Missing Session ID in PR body for PR #${pr_number}. Add 'Session ID: <id>' or a valid ci-callback marker."
  if [[ "$STRICT_TRACE" == "true" ]]; then
    echo "::error::Session trace is required for PR workflows."
    exit 1
  fi
fi
