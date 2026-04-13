import assert from "node:assert/strict";
import test from "node:test";
import {
  parseReadinessArgs,
  summarizeManagementReadiness
} from "../../scripts/lib/management-readiness.js";

test("management readiness: parseReadinessArgs parses flags", () => {
  const args = parseReadinessArgs([
    "--tenant-id", "client-prod-001",
    "--app-env=prod",
    "--recruiter-email", "vladimir@skillset.ae"
  ]);

  assert.equal(args["tenant-id"], "client-prod-001");
  assert.equal(args["app-env"], "prod");
  assert.equal(args["recruiter-email"], "vladimir@skillset.ae");
});

test("management readiness: summarize reports missing prerequisites", () => {
  const summary = summarizeManagementReadiness({
    schemaPresent: false,
    tenant: null,
    recruiter: null,
    binding: null,
    databaseConnection: null,
    appEnv: "prod"
  });

  assert.equal(summary.ok, false);
  assert.deepEqual(
    summary.failures.map((failure) => failure.code),
    [
      "management_schema_missing",
      "tenant_missing",
      "recruiter_missing",
      "binding_missing"
    ]
  );
});

test("management readiness: summarize reports healthy control-plane", () => {
  const summary = summarizeManagementReadiness({
    schemaPresent: true,
    tenant: {
      tenant_id: "client-prod-001"
    },
    recruiter: {
      recruiter_id: "rec-vk-001"
    },
    binding: {
      binding_id: "bind-client-prod-001-prod",
      db_alias: "prod-tenant-db",
      environment: "prod",
      binding_kind: "shared_db",
      is_primary: true
    },
    databaseConnection: {
      db_alias: "prod-tenant-db",
      status: "active",
      provider: "neon",
      region: "aws-us-east-2",
      connection_string: "postgres://example",
      secret_name: null
    },
    appEnv: "prod"
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.failures.length, 0);
  assert.equal(summary.binding.db_alias, "prod-tenant-db");
});
