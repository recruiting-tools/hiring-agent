#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <slug> [branch-name]" >&2
  echo "Example: $0 chat-markdown" >&2
  echo "Example: $0 chat-markdown fix/chat-markdown-contract" >&2
  exit 1
fi

SLUG="$1"
BRANCH_NAME="${2:-codex/${SLUG}-$(date +%Y%m%d-%H%M%S)}"
BASE_REF="${BASE_REF:-origin/main}"
WORKTREE_ROOT="${WORKTREE_ROOT:-/private/tmp}"

if [[ -z "${SLUG// }" ]]; then
  echo "ERROR: slug must be non-empty." >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}" \
  || git show-ref --verify --quiet "refs/remotes/origin/${BRANCH_NAME}"; then
  echo "ERROR: branch '${BRANCH_NAME}' already exists." >&2
  exit 1
fi

SAFE_BRANCH="$(echo "${BRANCH_NAME}" | tr '/:@' '-' | tr -cd 'A-Za-z0-9._-')"
WORKTREE_PATH="${WORKTREE_ROOT}/hiring-agent-${SAFE_BRANCH}"

if [[ -e "${WORKTREE_PATH}" ]]; then
  echo "ERROR: worktree path already exists: ${WORKTREE_PATH}" >&2
  exit 1
fi

git fetch --quiet origin main
git worktree add "${WORKTREE_PATH}" -b "${BRANCH_NAME}" "${BASE_REF}"

echo "Created isolated worktree: ${WORKTREE_PATH}"
echo "Branch: ${BRANCH_NAME}"
echo "Base: ${BASE_REF}"
echo
echo "Next:"
echo "  cd ${WORKTREE_PATH}"
echo "  git status --short --branch"
