import { AccessContextError, toAccessContextError } from "./access-context-error.js";
import { withAccessContextResilience } from "./resilience.js";

export async function resolveAccessContext({
  managementStore,
  poolRegistry,
  appEnv,
  sessionToken,
  metadataCache = null,
  timeoutMs = null
}) {
  if (!sessionToken) {
    throw new AccessContextError("ERROR_UNAUTHENTICATED", "Session token is required", { httpStatus: 401 });
  }

  const session = await withAccessContextResilience(
    () => managementStore.getRecruiterSession(sessionToken),
    {
      operationName: "management session lookup",
      timeoutMs,
      message: "Management session lookup timed out"
    }
  );
  if (!session) {
    throw new AccessContextError("ERROR_UNAUTHENTICATED", "Session not found or expired", { httpStatus: 401 });
  }

  if (session.recruiter_status === "suspended" || session.recruiter_status === "disabled") {
    throw new AccessContextError("ERROR_RECRUITER_SUSPENDED", `Recruiter ${session.recruiter_id} is not active`, {
      httpStatus: 403
    });
  }

  if (session.tenant_status === "suspended" || session.tenant_status === "archived") {
    throw new AccessContextError("ERROR_TENANT_SUSPENDED", `Tenant ${session.tenant_id} is not active`, {
      httpStatus: 403
    });
  }

  const binding = await withAccessContextResilience(
    async () => {
      const cachedBinding = metadataCache?.getBinding({
        appEnv,
        tenantId: session.tenant_id
      });
      if (cachedBinding) return cachedBinding;

      const resolvedBinding = await managementStore.getPrimaryBinding({
        tenantId: session.tenant_id,
        appEnv
      });
      if (resolvedBinding && resolvedBinding.binding_kind !== "shared_schema") {
        metadataCache?.setBinding({
          appEnv,
          tenantId: session.tenant_id,
          binding: resolvedBinding
        });
      }
      return resolvedBinding;
    },
    {
      operationName: "tenant binding lookup",
      timeoutMs,
      message: `Tenant binding lookup timed out for tenant ${session.tenant_id}`
    }
  );
  if (!binding) {
    throw new AccessContextError(
      "ERROR_BINDING_MISSING",
      `Primary tenant DB binding is missing for tenant ${session.tenant_id} in ${appEnv}`,
      { httpStatus: 503 }
    );
  }

  if (binding.binding_kind === "shared_schema") {
    throw new AccessContextError(
      "ERROR_BINDING_MISSING",
      "shared_schema bindings are not supported in phase 1",
      { httpStatus: 503 }
    );
  }

  const databaseConnection = await withAccessContextResilience(
    async () => {
      const cachedConnection = metadataCache?.getDatabaseConnection({
        appEnv,
        dbAlias: binding.db_alias
      });
      if (cachedConnection) return cachedConnection;

      const resolvedConnection = await managementStore.getDatabaseConnection(binding.db_alias);
      if (resolvedConnection?.connection_string) {
        metadataCache?.setDatabaseConnection({
          appEnv,
          dbAlias: binding.db_alias,
          databaseConnection: resolvedConnection
        });
      }
      return resolvedConnection;
    },
    {
      operationName: "database connection lookup",
      timeoutMs,
      message: `Database connection lookup timed out for alias ${binding.db_alias}`
    }
  );
  if (!databaseConnection) {
    throw new AccessContextError(
      "ERROR_DATABASE_CONNECTION_UNAVAILABLE",
      `Database connection ${binding.db_alias} was not found`,
      { httpStatus: 503 }
    );
  }

  if (!databaseConnection.connection_string) {
    throw new AccessContextError(
      "ERROR_DATABASE_CONNECTION_UNAVAILABLE",
      `Database connection ${binding.db_alias} has no usable connection string`,
      { httpStatus: 503 }
    );
  }

  try {
    const tenantSql = poolRegistry.getOrCreate({
      appEnv,
      dbAlias: binding.db_alias,
      connectionString: databaseConnection.connection_string
    });

    void managementStore.renewSessionIfNeeded(sessionToken, session.expires_at).catch(() => {});

    return {
      principalType: "recruiter",
      recruiterId: session.recruiter_id,
      tenantId: session.tenant_id,
      recruiterEmail: session.email,
      role: session.role,
      appEnv,
      binding: {
        bindingId: binding.binding_id,
        dbAlias: binding.db_alias,
        bindingKind: binding.binding_kind,
        schemaName: binding.schema_name
      },
      tenantSql
    };
  } catch (error) {
    throw toAccessContextError(error);
  }
}
