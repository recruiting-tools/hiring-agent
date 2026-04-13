#!/usr/bin/env bash

# Usage:
#   NEON_API_KEY=... ./scripts/neon-sandbox-branch.sh
#
# Creates the persistent Neon `sandbox` branch from `main` in project
# `round-leaf-16031956`, prints the branch connection string, and shows the
# next repo commands to run migrations and seed the sandbox.

set -euo pipefail

ORG_ID="org-bold-wave-46400152"
PROJECT_ID="round-leaf-16031956"
BRANCH_NAME="sandbox"
PARENT_BRANCH="main"

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
echo "Sandbox connection string:"
SANDBOX_DATABASE_URL="$(
  neonctl connection-string "${BRANCH_NAME}" \
    --project-id "${PROJECT_ID}"
)"
printf '%s\n' "${SANDBOX_DATABASE_URL}"

echo
echo "Next steps:"
printf '%s\n' "export SANDBOX_DATABASE_URL='${SANDBOX_DATABASE_URL}'"
printf '%s\n' "DATABASE_URL=\"\$SANDBOX_DATABASE_URL\" node scripts/migrate.js"
printf '%s\n' "SANDBOX_DATABASE_URL=\"\$SANDBOX_DATABASE_URL\" pnpm seed:sandbox"
printf '%s\n' "MANAGEMENT_DATABASE_URL=\"\$SANDBOX_DATABASE_URL\" pnpm bootstrap:demo-user"
printf '%s\n' "SANDBOX_DATABASE_URL=\"\$SANDBOX_DATABASE_URL\" pnpm smoke:sandbox"
