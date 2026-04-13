#!/usr/bin/env node

import pg from "pg";
import {
  parseReadinessArgs,
  summarizeManagementReadiness
} from "./lib/management-readiness.js";

const args = parseReadinessArgs(process.argv.slice(2));

if (args.help || args._[0] === "help") {
  printHelp();
  process.exit(0);
}

const managementDatabaseUrl = process.env.MANAGEMENT_DATABASE_URL;
const tenantId = args["tenant-id"] ?? null;
const recruiterId = args["recruiter-id"] ?? null;
const recruiterEmail = args["recruiter-email"] ?? null;
const appEnv = args["app-env"] ?? process.env.APP_ENV ?? null;

if (!managementDatabaseUrl) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL environment variable is required");
  process.exit(1);
}

if (!tenantId) {
  console.error("ERROR: --tenant-id is required");
  process.exit(1);
}

if (!appEnv) {
  console.error("ERROR: --app-env or APP_ENV is required");
  process.exit(1);
}

if (recruiterId && recruiterEmail) {
  console.error("ERROR: use only one recruiter lookup: --recruiter-id or --recruiter-email");
  process.exit(1);
}

const client = new pg.Client({ connectionString: managementDatabaseUrl });
await client.connect();

try {
  const schemaPresent = await hasRequiredSchema(client);
  const tenant = schemaPresent ? await getTenant(client, tenantId) : null;
  const recruiter = schemaPresent
    ? await getRecruiter(client, { tenantId, recruiterId, recruiterEmail })
    : null;
  const binding = schemaPresent ? await getBinding(client, { tenantId, appEnv }) : null;
  const databaseConnection = schemaPresent && binding
    ? await getDatabaseConnection(client, binding.db_alias)
    : null;

  const summary = summarizeManagementReadiness({
    schemaPresent,
    tenant,
    recruiter,
    binding,
    databaseConnection,
    appEnv
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
} finally {
  await client.end();
}

async function hasRequiredSchema(client) {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'management'
      AND table_name IN ('tenants', 'recruiters', 'database_connections', 'tenant_database_bindings')
  `);

  return result.rows.length === 4;
}

async function getTenant(client, tenantId) {
  const result = await client.query(`
    SELECT tenant_id, slug, display_name, status
    FROM management.tenants
    WHERE tenant_id = $1
    LIMIT 1
  `, [tenantId]);
  return result.rows[0] ?? null;
}

async function getRecruiter(client, { tenantId, recruiterId, recruiterEmail }) {
  const values = [tenantId];
  let recruiterFilter = "";

  if (recruiterId) {
    recruiterFilter = `AND recruiter_id = $${values.push(recruiterId)}`;
  } else if (recruiterEmail) {
    recruiterFilter = `AND email = $${values.push(recruiterEmail)}`;
  }

  const result = await client.query(`
    SELECT recruiter_id, tenant_id, email, status, role
    FROM management.recruiters
    WHERE tenant_id = $1
      ${recruiterFilter}
    ORDER BY recruiter_id
    LIMIT 1
  `, values);
  return result.rows[0] ?? null;
}

async function getBinding(client, { tenantId, appEnv }) {
  const result = await client.query(`
    SELECT binding_id, tenant_id, environment, binding_kind, db_alias, is_primary
    FROM management.tenant_database_bindings
    WHERE tenant_id = $1
      AND environment = $2
      AND is_primary = true
    LIMIT 1
  `, [tenantId, appEnv]);
  return result.rows[0] ?? null;
}

async function getDatabaseConnection(client, dbAlias) {
  const result = await client.query(`
    SELECT db_alias, secret_name, connection_string, provider, region, status
    FROM management.database_connections
    WHERE db_alias = $1
    LIMIT 1
  `, [dbAlias]);
  return result.rows[0] ?? null;
}

function printHelp() {
  console.log(`Usage:
  MANAGEMENT_DATABASE_URL=... node scripts/check-management-readiness.js \
    --tenant-id TENANT_ID \
    --app-env prod \
    [--recruiter-id RECRUITER_ID | --recruiter-email EMAIL]

Checks required management auth control-plane rows for one tenant and exits non-zero if any prerequisite is missing.
`);
}
