#!/usr/bin/env node

import pg from "pg";
import { parseReadinessArgs } from "./lib/management-readiness.js";

const args = parseReadinessArgs(process.argv.slice(2));

if (args.help || args._[0] === "help") {
  printHelp();
  process.exit(0);
}

const candidateDatabaseUrl = process.env.DATABASE_URL || process.env.CHATBOT_DATABASE_URL;
const managementDatabaseUrl = process.env.MANAGEMENT_DATABASE_URL;
const strictMode = args.strict !== "false" && process.env.HH_CUTOVER_STRICT !== "false";
const checkOnlyEnabled = args["check-only-enabled"] !== "false";
const requiredMappings = parseMappings(process.env.HH_VACANCY_JOB_MAP);
const requireTokenForSend = true;

if (!candidateDatabaseUrl) {
  console.error("ERROR: DATABASE_URL (or CHATBOT_DATABASE_URL) env is required");
  process.exit(1);
}

if (!managementDatabaseUrl) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL env is required");
  process.exit(1);
}

const candidateDbClient = new pg.Client({ connectionString: candidateDatabaseUrl });
const managementDbClient = new pg.Client({ connectionString: managementDatabaseUrl });

await candidateDbClient.connect();
await managementDbClient.connect();

try {
  const migrationRequired = ["009_hh_oauth_and_flags.sql", "010_step_follow_up_count.sql"];
  const candidateMigrationRows = await queryAppliedMigrations(candidateDbClient, "public", "schema_migrations");
  const managementMigrationRows = await queryAppliedMigrations(managementDbClient, "management", "schema_migrations");

  const managementSchemaVersion = {
    hasFeatureFlags: await tableExists(managementDbClient, "management", "feature_flags"),
    hasOAuthTokens: await tableExists(managementDbClient, "management", "oauth_tokens"),
    hasSchemaMigrations: await tableExists(managementDbClient, "management", "schema_migrations"),
    schemaMigrations: managementMigrationRows
  };

  const candidateSchemaVersion = {
    hasPipelineStepState: await tableExists(candidateDbClient, "chatbot", "pipeline_step_state"),
    hasPlannedMessages: await tableExists(candidateDbClient, "chatbot", "planned_messages"),
    hasSchemaMigrations: await tableExists(candidateDbClient, "public", "schema_migrations")
  };

  const featureFlags = managementSchemaVersion.hasFeatureFlags
    ? await getFeatureFlags(managementDbClient)
    : { hh_send: false, hh_import: false };
  const hhSendEnabled = featureFlags["hh_send"] === true;
  const hhImportEnabled = featureFlags["hh_import"] === true;
  const hhFeatureEnabled = hhSendEnabled || hhImportEnabled;

  const oauthTokenExists = managementSchemaVersion.hasOAuthTokens
    ? await hasHhToken(managementDbClient)
    : false;
  const configSecrets = {
    hhClientId: Boolean(process.env.HH_CLIENT_ID),
    hhClientSecret: Boolean(process.env.HH_CLIENT_SECRET),
    hhRedirectUri: Boolean(process.env.HH_REDIRECT_URI),
    hhVacancyJobMap: Boolean(process.env.HH_VACANCY_JOB_MAP),
    hasVacancyMapping: requiredMappings.length > 0
  };

  const missingCandidateMigrations = migrationRequired.filter((migration) => !candidateMigrationRows.includes(migration));
  const failures = [];

  if (!candidateSchemaVersion.hasSchemaMigrations) {
    failures.push({
      code: "candidate_schema_migrations_missing",
      message: "candidate DB missing public.schema_migrations tracker"
    });
  }

  if (!managementSchemaVersion.hasSchemaMigrations) {
    failures.push({
      code: "management_schema_migrations_missing",
      message: "management DB missing management.schema_migrations tracker"
    });
  }

  if (!managementSchemaVersion.hasFeatureFlags) {
    failures.push({
      code: "feature_flags_table_missing",
      message: "management.feature_flags table missing"
    });
  }

  if (!managementSchemaVersion.hasOAuthTokens) {
    failures.push({
      code: "oauth_tokens_table_missing",
      message: "management.oauth_tokens table missing"
    });
  }

  if (candidateSchemaVersion.hasSchemaMigrations && missingCandidateMigrations.length > 0) {
    failures.push({
      code: "candidate_cutover_migrations_missing",
      message: `candidate DB missing required HH migrations: ${missingCandidateMigrations.join(", ")}`
    });
  }

  if (hhFeatureEnabled) {
    if (!configSecrets.hhClientId || !configSecrets.hhClientSecret || !configSecrets.hhRedirectUri) {
      failures.push({
        code: "hh_oauth_secrets_missing",
        message: "hh_send/hh_import enabled but HH OAuth secrets are not all set"
      });
    }

    if (!configSecrets.hhVacancyJobMap || !configSecrets.hasVacancyMapping) {
      failures.push({
        code: "hh_vacancy_map_missing",
        message: "hh_send/hh_import enabled but HH_VACANCY_JOB_MAP is not populated"
      });
    }

    if (requireTokenForSend && hhSendEnabled && !oauthTokenExists) {
      failures.push({
        code: "hh_send_without_tokens",
        message: "hh_send enabled but no HH OAuth token found for provider=hh"
      });
    }
  }

  const ok = failures.length === 0;
  const status = {
    ok,
    strict_mode: Boolean(strictMode),
    check_only_enabled: Boolean(checkOnlyEnabled),
    hh_send_enabled: hhSendEnabled,
    hh_import_enabled: hhImportEnabled,
    feature_flags: featureFlags,
    candidate_schema: candidateSchemaVersion,
    management_schema: managementSchemaVersion,
    config_secrets: {
      hh_client_id_set: configSecrets.hhClientId,
      hh_client_secret_set: configSecrets.hhClientSecret,
      hh_redirect_uri_set: configSecrets.hhRedirectUri,
      hh_vacancy_map_set: configSecrets.hhVacancyJobMap,
      hh_vacancy_mapping_count: requiredMappings.length
    },
    oauth: {
      hh_token_present: oauthTokenExists
    },
    failures
  };

  console.log(JSON.stringify(status, null, 2));
  if (!ok && hhFeatureEnabled && strictMode) {
    console.error(`ERROR: HH cutover guard failed with ${failures.length} issues`);
    process.exit(1);
  }

  if (!ok && !hhFeatureEnabled && checkOnlyEnabled) {
    console.warn("WARN: HH features disabled; readiness check did not fail deployment");
  }

  process.exit(0);
} finally {
  await candidateDbClient.end();
  await managementDbClient.end();
}

async function queryAppliedMigrations(client, schema, table) {
  const exists = await tableExists(client, schema, table);
  if (!exists) {
    return [];
  }

  const result = await client.query(
    `
    SELECT filename
    FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
    ORDER BY filename
    `
  );
  return result.rows.map((row) => row.filename);
}

async function tableExists(client, schema, tableName) {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = $1
      AND table_name = $2
    LIMIT 1
    `,
    [schema, tableName]
  );
  return result.rows.length === 1;
}

async function getFeatureFlags(client) {
  const result = await client.query(`
    SELECT flag, enabled
    FROM management.feature_flags
    WHERE flag IN ('hh_send', 'hh_import')
    ORDER BY flag
  `);
  const flags = {};
  for (const row of result.rows) {
    flags[row.flag] = row.enabled === true;
  }
  return flags;
}

async function hasHhToken(client) {
  const result = await client.query(`
    SELECT 1
    FROM management.oauth_tokens
    WHERE provider = 'hh'
      AND (access_token IS NOT NULL OR refresh_token IS NOT NULL)
    LIMIT 1
  `);
  return result.rows.length === 1;
}

function parseMappings(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item?.hh_vacancy_id && item?.job_id);
  } catch {
    return [];
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

function printHelp() {
  console.log(`Usage:
  MANAGEMENT_DATABASE_URL=... DATABASE_URL=... node scripts/check-hh-cutover-readiness.js

Checks HH cutover prerequisites in management + candidate DB and exits non-zero
when HH features are enabled and preconditions are missing.

Env:
  DATABASE_URL            candidate DB (legacy alias for CHATBOT_DATABASE_URL)
  MANAGEMENT_DATABASE_URL  control-plane management DB
  HH_CLIENT_ID            HH OAuth client id
  HH_CLIENT_SECRET        HH OAuth client secret
  HH_REDIRECT_URI         HH OAuth redirect URI
  HH_VACANCY_JOB_MAP      JSON array of vacancy<->job mappings

Args:
  --strict (default: true)
  --check-only-enabled (default: true)
`);
}
