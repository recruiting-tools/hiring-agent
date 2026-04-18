import assert from "node:assert/strict";
import test from "node:test";
import {
  AccessContextError,
  createAccessContextMetadataCache,
  createPoolRegistry,
  resolveAccessContext
} from "../../packages/access-context/src/index.js";

test("pool registry reuses sql client by appEnv and dbAlias", () => {
  const created = [];
  const registry = createPoolRegistry({
    sqlFactory(connectionString) {
      const sql = {
        connectionString,
        async end() {}
      };
      created.push(sql);
      return sql;
    }
  });

  const a = registry.getOrCreate({
    appEnv: "prod",
    dbAlias: "shared-prod",
    connectionString: "postgres://first"
  });
  const b = registry.getOrCreate({
    appEnv: "prod",
    dbAlias: "shared-prod",
    connectionString: "postgres://second"
  });

  assert.equal(a, b);
  assert.equal(created.length, 1);
});

test("resolveAccessContext returns tenant-scoped context for active recruiter", async () => {
  let renewed = false;
  const tenantSql = { tag: "tenant-sql" };
  const context = await resolveAccessContext({
    appEnv: "prod",
    sessionToken: "sess-1",
    managementStore: {
      async getRecruiterSession() {
        return {
          recruiter_id: "rec-1",
          email: "rec@example.test",
          recruiter_status: "active",
          role: "recruiter",
          tenant_id: "tenant-1",
          tenant_status: "active",
          expires_at: new Date()
        };
      },
      async getPrimaryBinding() {
        return {
          binding_id: "bind-1",
          db_alias: "db-1",
          binding_kind: "shared_db",
          schema_name: null
        };
      },
      async getDatabaseConnection() {
        return {
          db_alias: "db-1",
          connection_string: "postgres://tenant"
        };
      },
      async renewSessionIfNeeded() {
        renewed = true;
      }
    },
    poolRegistry: {
      getOrCreate() {
        return tenantSql;
      }
    }
  });

  assert.equal(context.recruiterId, "rec-1");
  assert.equal(context.tenantId, "tenant-1");
  assert.equal(context.binding.dbAlias, "db-1");
  assert.equal(context.tenantSql, tenantSql);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewed, true);
});

test("resolveAccessContext caches binding and database metadata but not session lookup", async () => {
  let sessionLookups = 0;
  let bindingLookups = 0;
  let databaseLookups = 0;
  const tenantSql = { tag: "tenant-sql" };
  const metadataCache = createAccessContextMetadataCache({ ttlMs: 60_000 });

  const managementStore = {
    async getRecruiterSession() {
      sessionLookups += 1;
      return {
        recruiter_id: "rec-1",
        email: "rec@example.test",
        recruiter_status: "active",
        role: "recruiter",
        tenant_id: "tenant-1",
        tenant_status: "active",
        expires_at: new Date()
      };
    },
    async getPrimaryBinding() {
      bindingLookups += 1;
      return {
        binding_id: "bind-1",
        db_alias: "db-1",
        binding_kind: "shared_db",
        schema_name: null
      };
    },
    async getDatabaseConnection() {
      databaseLookups += 1;
      return {
        db_alias: "db-1",
        connection_string: "postgres://tenant"
      };
    },
    async renewSessionIfNeeded() {}
  };

  const poolRegistry = {
    getOrCreate() {
      return tenantSql;
    }
  };

  const first = await resolveAccessContext({
    appEnv: "prod",
    sessionToken: "sess-1",
    managementStore,
    metadataCache,
    poolRegistry
  });
  const second = await resolveAccessContext({
    appEnv: "prod",
    sessionToken: "sess-1",
    managementStore,
    metadataCache,
    poolRegistry
  });

  assert.equal(first.tenantSql, tenantSql);
  assert.equal(second.tenantSql, tenantSql);
  assert.equal(sessionLookups, 2);
  assert.equal(bindingLookups, 1);
  assert.equal(databaseLookups, 1);
});

test("resolveAccessContext metadata cache expires after ttl", async () => {
  let nowMs = 1_000;
  let bindingLookups = 0;
  let databaseLookups = 0;
  const metadataCache = createAccessContextMetadataCache({
    ttlMs: 50,
    now: () => nowMs
  });

  const managementStore = {
    async getRecruiterSession() {
      return {
        recruiter_id: "rec-1",
        email: "rec@example.test",
        recruiter_status: "active",
        role: "recruiter",
        tenant_id: "tenant-1",
        tenant_status: "active",
        expires_at: new Date()
      };
    },
    async getPrimaryBinding() {
      bindingLookups += 1;
      return {
        binding_id: "bind-1",
        db_alias: "db-1",
        binding_kind: "shared_db",
        schema_name: null
      };
    },
    async getDatabaseConnection() {
      databaseLookups += 1;
      return {
        db_alias: "db-1",
        connection_string: "postgres://tenant"
      };
    },
    async renewSessionIfNeeded() {}
  };

  const poolRegistry = {
    getOrCreate() {
      return { tag: "tenant-sql" };
    }
  };

  await resolveAccessContext({
    appEnv: "prod",
    sessionToken: "sess-1",
    managementStore,
    metadataCache,
    poolRegistry
  });
  await resolveAccessContext({
    appEnv: "prod",
    sessionToken: "sess-1",
    managementStore,
    metadataCache,
    poolRegistry
  });
  nowMs += 51;
  await resolveAccessContext({
    appEnv: "prod",
    sessionToken: "sess-1",
    managementStore,
    metadataCache,
    poolRegistry
  });

  assert.equal(bindingLookups, 2);
  assert.equal(databaseLookups, 2);
});

test("resolveAccessContext rejects suspended recruiter", async () => {
  await assert.rejects(
    resolveAccessContext({
      appEnv: "prod",
      sessionToken: "sess-1",
      managementStore: {
        async getRecruiterSession() {
          return {
            recruiter_id: "rec-1",
            recruiter_status: "suspended",
            tenant_id: "tenant-1",
            tenant_status: "active"
          };
        }
      },
      poolRegistry: {}
    }),
    (error) => {
      assert.ok(error instanceof AccessContextError);
      assert.equal(error.code, "ERROR_RECRUITER_SUSPENDED");
      assert.equal(error.httpStatus, 403);
      return true;
    }
  );
});

test("resolveAccessContext rejects disabled recruiter", async () => {
  await assert.rejects(
    resolveAccessContext({
      appEnv: "prod",
      sessionToken: "sess-1",
      managementStore: {
        async getRecruiterSession() {
          return {
            recruiter_id: "rec-1",
            recruiter_status: "disabled",
            tenant_id: "tenant-1",
            tenant_status: "active"
          };
        }
      },
      poolRegistry: {}
    }),
    (error) => {
      assert.ok(error instanceof AccessContextError);
      assert.equal(error.code, "ERROR_RECRUITER_SUSPENDED");
      assert.equal(error.httpStatus, 403);
      return true;
    }
  );
});

test("resolveAccessContext rejects missing binding", async () => {
  await assert.rejects(
    resolveAccessContext({
      appEnv: "prod",
      sessionToken: "sess-1",
      managementStore: {
        async getRecruiterSession() {
          return {
            recruiter_id: "rec-1",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-1",
            tenant_status: "active",
            expires_at: new Date()
          };
        },
        async getPrimaryBinding() {
          return null;
        }
      },
      poolRegistry: {}
    }),
    (error) => {
      assert.ok(error instanceof AccessContextError);
      assert.equal(error.code, "ERROR_BINDING_MISSING");
      assert.equal(error.httpStatus, 503);
      return true;
    }
  );
});

test("resolveAccessContext rejects suspended tenant", async () => {
  await assert.rejects(
    resolveAccessContext({
      appEnv: "prod",
      sessionToken: "sess-1",
      managementStore: {
        async getRecruiterSession() {
          return {
            recruiter_id: "rec-1",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-1",
            tenant_status: "suspended",
            expires_at: new Date()
          };
        }
      },
      poolRegistry: {}
    }),
    (error) => {
      assert.ok(error instanceof AccessContextError);
      assert.equal(error.code, "ERROR_TENANT_SUSPENDED");
      assert.equal(error.httpStatus, 403);
      return true;
    }
  );
});

test("resolveAccessContext rejects missing database connection with infrastructure error", async () => {
  await assert.rejects(
    resolveAccessContext({
      appEnv: "prod",
      sessionToken: "sess-1",
      managementStore: {
        async getRecruiterSession() {
          return {
            recruiter_id: "rec-1",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-1",
            tenant_status: "active",
            expires_at: new Date()
          };
        },
        async getPrimaryBinding() {
          return {
            binding_id: "bind-1",
            db_alias: "db-1",
            binding_kind: "shared_db",
            schema_name: null
          };
        },
        async getDatabaseConnection() {
          return null;
        }
      },
      poolRegistry: {}
    }),
    (error) => {
      assert.ok(error instanceof AccessContextError);
      assert.equal(error.code, "ERROR_DATABASE_CONNECTION_UNAVAILABLE");
      assert.equal(error.httpStatus, 503);
      return true;
    }
  );
});

test("resolveAccessContext rejects database connection without connection string", async () => {
  await assert.rejects(
    resolveAccessContext({
      appEnv: "prod",
      sessionToken: "sess-1",
      managementStore: {
        async getRecruiterSession() {
          return {
            recruiter_id: "rec-1",
            recruiter_status: "active",
            role: "recruiter",
            tenant_id: "tenant-1",
            tenant_status: "active",
            expires_at: new Date()
          };
        },
        async getPrimaryBinding() {
          return {
            binding_id: "bind-1",
            db_alias: "db-1",
            binding_kind: "shared_db",
            schema_name: null
          };
        },
        async getDatabaseConnection() {
          return {
            db_alias: "db-1",
            connection_string: null
          };
        }
      },
      poolRegistry: {}
    }),
    (error) => {
      assert.ok(error instanceof AccessContextError);
      assert.equal(error.code, "ERROR_DATABASE_CONNECTION_UNAVAILABLE");
      assert.equal(error.httpStatus, 503);
      return true;
    }
  );
});
