import assert from "node:assert/strict";
import test from "node:test";
import {
  AccessContextError,
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
