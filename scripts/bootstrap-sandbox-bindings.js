#!/usr/bin/env node

import pg from "pg";

const args = parseArgs(process.argv.slice(2));
const sourceEnv = args["source-env"] ?? process.env.BINDINGS_SOURCE_ENV ?? "prod";
const targetEnv = args["target-env"] ?? process.env.BINDINGS_TARGET_ENV ?? "sandbox";
const managementDatabaseUrl = process.env.MANAGEMENT_DATABASE_URL;

if (!managementDatabaseUrl) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL environment variable is required");
  process.exit(1);
}

if (!sourceEnv || !targetEnv) {
  console.error("ERROR: source and target env are required");
  process.exit(1);
}

if (sourceEnv === targetEnv) {
  console.error("ERROR: source and target env must differ");
  process.exit(1);
}

const client = new pg.Client({ connectionString: managementDatabaseUrl });
await client.connect();

try {
  const rows = await client.query(`
    WITH source_bindings AS (
      SELECT tenant_id, binding_kind, db_alias, schema_name
      FROM management.tenant_database_bindings
      WHERE environment = $1
        AND is_primary = true
    ),
    target_bindings AS (
      SELECT tenant_id
      FROM management.tenant_database_bindings
      WHERE environment = $2
        AND is_primary = true
    )
    SELECT s.tenant_id, s.binding_kind, s.db_alias, s.schema_name
    FROM source_bindings s
    LEFT JOIN target_bindings t USING (tenant_id)
    WHERE t.tenant_id IS NULL
    ORDER BY s.tenant_id ASC
  `, [sourceEnv, targetEnv]);

  if (rows.rows.length === 0) {
    console.log(`No missing primary bindings for target env '${targetEnv}'.`);
    process.exit(0);
  }

  let updated = 0;
  for (const row of rows.rows) {
    const bindingId = `bind-${row.tenant_id}-${targetEnv}`;
    await client.query(`
      INSERT INTO management.tenant_database_bindings (
        binding_id,
        tenant_id,
        environment,
        binding_kind,
        db_alias,
        schema_name,
        is_primary
      )
      VALUES ($1, $2, $3, $4, $5, $6, true)
      ON CONFLICT (tenant_id, environment) WHERE is_primary = true
      DO UPDATE SET
        binding_kind = EXCLUDED.binding_kind,
        db_alias = EXCLUDED.db_alias,
        schema_name = EXCLUDED.schema_name,
        is_primary = EXCLUDED.is_primary
    `, [bindingId, row.tenant_id, targetEnv, row.binding_kind, row.db_alias, row.schema_name]);
    updated += 1;
    console.log(`Ensured binding: tenant=${row.tenant_id} env=${targetEnv} db_alias=${row.db_alias}`);
  }

  console.log(`Done. Ensured ${updated} primary binding(s) in '${targetEnv}' from '${sourceEnv}'.`);
} finally {
  await client.end();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      parsed[rawKey] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[rawKey] = true;
      continue;
    }

    parsed[rawKey] = next;
    index += 1;
  }
  return parsed;
}
