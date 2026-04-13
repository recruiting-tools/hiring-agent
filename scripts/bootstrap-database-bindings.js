#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import pg from "pg";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "help";

if (command === "help" || args.help) {
  printHelp();
  process.exit(0);
}

const MANAGEMENT_DB_URL = process.env.MANAGEMENT_DATABASE_URL;

if (!MANAGEMENT_DB_URL) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL environment variable is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: MANAGEMENT_DB_URL });
await client.connect();

try {
  if (command === "register-connection") {
    const dbAlias = args["db-alias"];
    const provider = args.provider ?? "neon";
    const region = args.region ?? null;
    const secretName = args["secret-name"] ?? null;
    const connectionString = args["connection-string"] ?? null;

    if (!dbAlias || (!secretName && !connectionString) || (secretName && connectionString)) {
      throw new Error("register-connection requires --db-alias and exactly one of --secret-name or --connection-string");
    }

    await client.query(`
      INSERT INTO management.database_connections (
        db_alias,
        secret_name,
        connection_string,
        provider,
        region,
        status
      )
      VALUES ($1, $2, $3, $4, $5, 'active')
      ON CONFLICT (db_alias) DO UPDATE SET
        secret_name = EXCLUDED.secret_name,
        connection_string = EXCLUDED.connection_string,
        provider = EXCLUDED.provider,
        region = EXCLUDED.region,
        status = EXCLUDED.status
    `, [dbAlias, secretName, connectionString, provider, region]);

    console.log(`Registered database connection ${dbAlias}`);
    process.exit(0);
  }

  if (command === "bind") {
    const tenantId = args["tenant-id"];
    const environment = args.environment;
    const bindingKind = args["binding-kind"] ?? "shared_db";
    const dbAlias = args["db-alias"];
    const schemaName = args["schema-name"] ?? null;
    const bindingId = args["binding-id"] ?? randomUUID();
    const isPrimary = args["primary"] !== "false";

    if (!tenantId || !environment || !dbAlias) {
      throw new Error("bind requires --tenant-id, --environment, and --db-alias");
    }

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
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (binding_id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        environment = EXCLUDED.environment,
        binding_kind = EXCLUDED.binding_kind,
        db_alias = EXCLUDED.db_alias,
        schema_name = EXCLUDED.schema_name,
        is_primary = EXCLUDED.is_primary
    `, [bindingId, tenantId, environment, bindingKind, dbAlias, schemaName, isPrimary]);

    console.log(`Bound tenant ${tenantId} to ${dbAlias} in ${environment}`);
    process.exit(0);
  }

  if (command === "bind-all") {
    const environment = args.environment;
    const bindingKind = args["binding-kind"] ?? "shared_db";
    const dbAlias = args["db-alias"];
    const schemaName = args["schema-name"] ?? null;

    if (!environment || !dbAlias) {
      throw new Error("bind-all requires --environment and --db-alias");
    }

    const tenants = await client.query(`
      SELECT tenant_id
      FROM management.tenants
      ORDER BY tenant_id
    `);

    for (const row of tenants.rows) {
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
      `, [randomUUID(), row.tenant_id, environment, bindingKind, dbAlias, schemaName]);
      console.log(`Bound tenant ${row.tenant_id} to ${dbAlias} in ${environment}`);
    }

    process.exit(0);
  }

  throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  await client.end();
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[rawKey] = true;
      continue;
    }

    args[rawKey] = next;
    index += 1;
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/bootstrap-database-bindings.js register-connection --db-alias ALIAS (--secret-name NAME | --connection-string URL) [--provider neon] [--region REGION]
  node scripts/bootstrap-database-bindings.js bind --tenant-id TENANT_ID --environment ENV --db-alias ALIAS [--binding-kind shared_db] [--schema-name NAME] [--binding-id ID] [--primary false]
  node scripts/bootstrap-database-bindings.js bind-all --environment ENV --db-alias ALIAS [--binding-kind shared_db] [--schema-name NAME]

Env:
  MANAGEMENT_DATABASE_URL
`);
}
