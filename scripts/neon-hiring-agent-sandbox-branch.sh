#!/usr/bin/env bash

# Usage:
#   NEON_API_KEY=... ./scripts/neon-hiring-agent-sandbox-branch.sh
#
# Creates or reuses paired Neon branches for hiring-agent sandbox:
# - tenant data plane branch in project round-leaf-16031956
# - management control plane branch in project orange-silence-65083641
#
# Then prints connection strings and the exact repo commands to bootstrap
# both databases for a safe sandbox environment.

set -euo pipefail

ORG_ID="${ORG_ID:-org-bold-wave-46400152}"
TENANT_PROJECT_ID="${TENANT_PROJECT_ID:-round-leaf-16031956}"
MANAGEMENT_PROJECT_ID="${MANAGEMENT_PROJECT_ID:-orange-silence-65083641}"
TENANT_BRANCH_NAME="${TENANT_BRANCH_NAME:-sandbox}"
MANAGEMENT_BRANCH_NAME="${MANAGEMENT_BRANCH_NAME:-sandbox}"
TENANT_PARENT_BRANCH="${TENANT_PARENT_BRANCH:-main}"
MANAGEMENT_PARENT_BRANCH="${MANAGEMENT_PARENT_BRANCH:-main}"

if ! command -v neonctl >/dev/null 2>&1; then
  echo "ERROR: neonctl is required in PATH." >&2
  exit 1
fi

if [[ -z "${NEON_API_KEY:-}" ]]; then
  echo "ERROR: NEON_API_KEY must be set." >&2
  exit 1
fi

ensure_branch() {
  local project_id="$1"
  local branch_name="$2"
  local parent_branch="$3"

  if neonctl branches get "$branch_name" --project-id "$project_id" >/dev/null 2>&1; then
    echo "Branch ${branch_name} already exists in project ${project_id}."
    return
  fi

  echo "Creating branch ${branch_name} from ${parent_branch} in project ${project_id}..."
  neonctl branches create \
    --project-id "${project_id}" \
    --name "${branch_name}" \
    --parent "${parent_branch}"
}

connection_string() {
  local project_id="$1"
  local branch_name="$2"
  neonctl connection-string "${branch_name}" \
    --project-id "${project_id}" \
    --pooled
}

echo "Setting Neon org context for ${ORG_ID}..."
neonctl set-context --org-id "${ORG_ID}" >/dev/null

echo
ensure_branch "${TENANT_PROJECT_ID}" "${TENANT_BRANCH_NAME}" "${TENANT_PARENT_BRANCH}"
ensure_branch "${MANAGEMENT_PROJECT_ID}" "${MANAGEMENT_BRANCH_NAME}" "${MANAGEMENT_PARENT_BRANCH}"

echo
TENANT_DATABASE_URL="$(connection_string "${TENANT_PROJECT_ID}" "${TENANT_BRANCH_NAME}")"
MANAGEMENT_DATABASE_URL="$(connection_string "${MANAGEMENT_PROJECT_ID}" "${MANAGEMENT_BRANCH_NAME}")"

echo "Tenant sandbox connection string:"
printf '%s\n' "${TENANT_DATABASE_URL}"
echo
echo "Management sandbox connection string:"
printf '%s\n' "${MANAGEMENT_DATABASE_URL}"

echo
echo "Next steps:"
printf '%s\n' "export CHATBOT_DATABASE_URL='${TENANT_DATABASE_URL}'"
printf '%s\n' "export SANDBOX_DATABASE_URL='${TENANT_DATABASE_URL}'"
printf '%s\n' "export MANAGEMENT_DATABASE_URL='${MANAGEMENT_DATABASE_URL}'"
printf '%s\n' "node scripts/migrate-management.js"
printf '%s\n' "DATABASE_URL=\"\$CHATBOT_DATABASE_URL\" node scripts/migrate.js"
printf '%s\n' "pnpm seed:sandbox"
printf '%s\n' "pnpm bootstrap:management:tenants"
printf '%s\n' "pnpm bootstrap:management:recruiters"
printf '%s\n' "pnpm bootstrap:management:bindings"
printf '%s\n' "pnpm bootstrap:demo-user"
printf '%s\n' "MANAGEMENT_DATABASE_URL=\"\$MANAGEMENT_DATABASE_URL\" node scripts/seed-playbooks.js --force"
printf '%s\n' "APP_ENV=sandbox MANAGEMENT_DATABASE_URL=\"\$MANAGEMENT_DATABASE_URL\" pnpm dev:hiring-agent"

echo
echo "Notes:"
printf '%s\n' "- tenant branch project: ${TENANT_PROJECT_ID}/${TENANT_BRANCH_NAME}"
printf '%s\n' "- management branch project: ${MANAGEMENT_PROJECT_ID}/${MANAGEMENT_BRANCH_NAME}"
printf '%s\n' "- use separate sandbox secrets/runtime; do not point sandbox service at production management DB"
