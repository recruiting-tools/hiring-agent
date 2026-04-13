import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "../../scripts/lib/run-migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const managementMigrationsDir = join(__dirname, "../../migrations/management");

export async function prepareManagementDb(connectionString) {
  await runMigrations({
    connectionString,
    migrationsDir: managementMigrationsDir,
    trackerSchema: "management",
    trackerTable: "schema_migrations"
  });
}

export async function resetManagementDb(sql) {
  await sql`
    TRUNCATE TABLE
      management.sessions,
      management.tenant_database_bindings,
      management.database_connections,
      management.recruiters,
      management.tenants
    CASCADE
  `;
}

export async function seedManagementFixtures(sql, {
  tenantId,
  recruiterId,
  email,
  passwordHash = null,
  sessionToken,
  dbAlias,
  connectionString,
  appEnv = "prod"
}) {
  await sql`
    INSERT INTO management.tenants (tenant_id, slug, display_name, status)
    VALUES (${tenantId}, ${tenantId}, ${tenantId}, 'active')
  `;

  await sql`
    INSERT INTO management.recruiters (recruiter_id, tenant_id, email, password_hash, status, role)
    VALUES (${recruiterId}, ${tenantId}, ${email}, ${passwordHash}, 'active', 'recruiter')
  `;

  await sql`
    INSERT INTO management.database_connections (db_alias, connection_string, provider, region, status)
    VALUES (${dbAlias}, ${connectionString}, 'neon', 'test', 'active')
  `;

  await sql`
    INSERT INTO management.tenant_database_bindings (
      binding_id,
      tenant_id,
      environment,
      binding_kind,
      db_alias,
      schema_name,
      is_primary
    )
    VALUES (${`bind-${tenantId}-${appEnv}`}, ${tenantId}, ${appEnv}, 'shared_db', ${dbAlias}, ${null}, true)
  `;

  await sql`
    INSERT INTO management.sessions (session_token, recruiter_id, expires_at)
    VALUES (${sessionToken}, ${recruiterId}, now() + ${"30 days"}::interval)
  `;
}

export async function loadIteration5Seed() {
  return JSON.parse(await readFile(new URL("../fixtures/iteration-5-seed.json", import.meta.url), "utf8"));
}

export function createManagementSql(connectionString) {
  return postgres(connectionString, { max: 1 });
}
