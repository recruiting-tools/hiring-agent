import assert from "node:assert/strict";
import test from "node:test";
import { createPoolRegistry, createManagementStore, resolveAccessContext } from "../../packages/access-context/src/index.js";
import { PostgresHiringStore } from "../../services/candidate-chatbot/src/postgres-store.js";
import {
  createManagementSql,
  loadIteration5Seed,
  prepareManagementDb,
  resetManagementDb,
  seedManagementFixtures
} from "../helpers/management-fixtures.js";

const DB_URL = process.env.CHATBOT_DATABASE_URL;
process.env.POSTGRES_STORE_RESET_ALLOWED = "true";

if (!DB_URL) {
  console.log("Skipping access context postgres tests: CHATBOT_DATABASE_URL not set");
  process.exit(0);
}

const seed = await loadIteration5Seed();

async function seedTenantDb() {
  const store = new PostgresHiringStore({ connectionString: DB_URL });
  await store.reset();
  await store.seed(seed);
  await store.close();
}

test("access context postgres: resolves recruiter session to tenant-scoped sql", async () => {
  await prepareManagementDb(DB_URL);
  await seedTenantDb();

  const managementSql = createManagementSql(DB_URL);
  const poolRegistry = createPoolRegistry();

  try {
    await resetManagementDb(managementSql);
    await seedManagementFixtures(managementSql, {
      tenantId: "client-alpha-001",
      recruiterId: "rec-alpha-001",
      email: "alice@alpha.test",
      sessionToken: "sess-alpha-001",
      dbAlias: "tenant-db-dev",
      connectionString: DB_URL,
      appEnv: "dev"
    });

    const accessContext = await resolveAccessContext({
      managementStore: createManagementStore(managementSql),
      poolRegistry,
      appEnv: "dev",
      sessionToken: "sess-alpha-001"
    });

    assert.equal(accessContext.recruiterId, "rec-alpha-001");
    assert.equal(accessContext.tenantId, "client-alpha-001");
    assert.equal(accessContext.binding.dbAlias, "tenant-db-dev");

    const jobs = await accessContext.tenantSql`
      SELECT job_id
      FROM chatbot.jobs
      WHERE client_id = ${accessContext.tenantId}
      ORDER BY job_id ASC
    `;

    assert.deepEqual(
      jobs.map((row) => row.job_id),
      ["job-alpha-dev", "job-alpha-pm"]
    );
  } finally {
    await managementSql.end({ timeout: 5 }).catch(() => {});
    await poolRegistry.closeAll();
  }
});

test("access context postgres: missing binding returns ERROR_BINDING_MISSING", async () => {
  await prepareManagementDb(DB_URL);
  await seedTenantDb();

  const managementSql = createManagementSql(DB_URL);

  try {
    await resetManagementDb(managementSql);
    await seedManagementFixtures(managementSql, {
      tenantId: "client-alpha-001",
      recruiterId: "rec-alpha-001",
      email: "alice@alpha.test",
      sessionToken: "sess-alpha-missing-binding",
      dbAlias: "tenant-db-dev",
      connectionString: DB_URL,
      appEnv: "prod"
    });

    await managementSql`
      DELETE FROM management.tenant_database_bindings
      WHERE tenant_id = ${"client-alpha-001"}
        AND environment = ${"prod"}
    `;

    await assert.rejects(
      resolveAccessContext({
        managementStore: createManagementStore(managementSql),
        poolRegistry: createPoolRegistry(),
        appEnv: "prod",
        sessionToken: "sess-alpha-missing-binding"
      }),
      (error) => {
        assert.equal(error.code, "ERROR_BINDING_MISSING");
        assert.equal(error.httpStatus, 503);
        return true;
      }
    );
  } finally {
    await managementSql.end({ timeout: 5 }).catch(() => {});
  }
});
