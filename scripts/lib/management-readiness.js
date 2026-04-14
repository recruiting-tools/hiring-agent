export function summarizeManagementReadiness({
  schemaPresent,
  tenant,
  recruiter,
  binding,
  databaseConnection,
  appEnv
}) {
  const failures = [];

  if (!schemaPresent) {
    failures.push({
      code: "management_schema_missing",
      message: "management schema is missing required control-plane tables"
    });
  }

  if (!tenant) {
    failures.push({
      code: "tenant_missing",
      message: "tenant row is missing in management.tenants"
    });
  }

  if (!recruiter) {
    failures.push({
      code: "recruiter_missing",
      message: "recruiter row is missing in management.recruiters"
    });
  }

  if (!binding) {
    failures.push({
      code: "binding_missing",
      message: `primary tenant binding is missing for app_env=${appEnv}`
    });
  }

  if (binding && !databaseConnection) {
    failures.push({
      code: "database_connection_missing",
      message: `database connection ${binding.db_alias} is missing`
    });
  }

  if (databaseConnection && databaseConnection.status !== "active") {
    failures.push({
      code: "database_connection_inactive",
      message: `database connection ${databaseConnection.db_alias} is not active`
    });
  }

  if (databaseConnection && !databaseConnection.connection_string && !databaseConnection.secret_name) {
    failures.push({
      code: "database_connection_unusable",
      message: `database connection ${databaseConnection.db_alias} has neither connection_string nor secret_name`
    });
  }

  return {
    ok: failures.length === 0,
    app_env: appEnv,
    tenant_id: tenant?.tenant_id ?? null,
    recruiter_id: recruiter?.recruiter_id ?? null,
    binding: binding
      ? {
        binding_id: binding.binding_id,
        db_alias: binding.db_alias,
        environment: binding.environment,
        binding_kind: binding.binding_kind,
        is_primary: binding.is_primary
      }
      : null,
    database_connection: databaseConnection
      ? {
        db_alias: databaseConnection.db_alias,
        status: databaseConnection.status,
        provider: databaseConnection.provider,
        region: databaseConnection.region,
        has_connection_string: Boolean(databaseConnection.connection_string),
        has_secret_name: Boolean(databaseConnection.secret_name)
      }
      : null,
    failures
  };
}

export function parseReadinessArgs(argv) {
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
