#!/usr/bin/env bash

set -euo pipefail

ORG_ID="org-bold-wave-46400152"
PROJECT_ID="round-leaf-16031956"
PARENT_BRANCH="sandbox"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <branch-name>" >&2
  echo "Example: $0 pr-my-feature" >&2
  exit 1
fi

BRANCH_NAME="$1"

if ! command -v neonctl >/dev/null 2>&1; then
  echo "ERROR: neonctl is required in PATH." >&2
  exit 1
fi

if [[ -z "${NEON_API_KEY:-}" ]]; then
  echo "ERROR: NEON_API_KEY must be set with V2 org access." >&2
  exit 1
fi

echo "Setting Neon context for org ${ORG_ID} and project ${PROJECT_ID}..."
neonctl set-context \
  --org-id "${ORG_ID}" \
  --project-id "${PROJECT_ID}"

echo
echo "Creating branch ${BRANCH_NAME} from ${PARENT_BRANCH}..."
neonctl branches create \
  --project-id "${PROJECT_ID}" \
  --name "${BRANCH_NAME}" \
  --parent "${PARENT_BRANCH}"

echo
echo "Feature branch connection string:"
FEATURE_DATABASE_URL="$(
  neonctl connection-string "${BRANCH_NAME}" \
    --project-id "${PROJECT_ID}"
)"
printf '%s\n' "${FEATURE_DATABASE_URL}"

echo
echo "Next steps:"
printf '%s\n' "export FEATURE_DATABASE_URL='${FEATURE_DATABASE_URL}'"
printf '%s\n' "DATABASE_URL=\"\$FEATURE_DATABASE_URL\" node scripts/migrate.js"
printf '%s\n' "DATABASE_URL=\"\$FEATURE_DATABASE_URL\" pnpm test:sandbox"
printf '%s\n' "When finished, delete the branch: neonctl branches delete --project-id ${PROJECT_ID} --name ${BRANCH_NAME}"
