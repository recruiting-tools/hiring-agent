#!/usr/bin/env node
// Admin CLI for managing per-tenant playbook access.
//
// Usage:
//   MANAGEMENT_DATABASE_URL=<url> node scripts/admin-playbooks.js <command> [args...]
//
// Commands:
//   list                         — list all playbook definitions
//   list <tenant>                — list playbooks for tenant (with enabled status)
//   enable <tenant> <playbook>   — enable a playbook for a tenant
//   disable <tenant> <playbook>  — disable a playbook for a tenant
//   enable-all <tenant>          — enable all available playbooks for a tenant
//
// <tenant> accepts either tenant_id or slug.
//
// Examples:
//   node scripts/admin-playbooks.js list
//   node scripts/admin-playbooks.js list innovabeyond
//   node scripts/admin-playbooks.js enable innovabeyond funnel
//   node scripts/admin-playbooks.js disable innovabeyond funnel
//   node scripts/admin-playbooks.js enable-all innovabeyond

import pg from "pg";

const MANAGEMENT_URL = process.env.MANAGEMENT_DATABASE_URL;

if (!MANAGEMENT_URL) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL environment variable is required");
  process.exit(1);
}

const [, , command, arg1, arg2] = process.argv;

if (!command) {
  printUsage();
  process.exit(1);
}

const db = new pg.Client({ connectionString: MANAGEMENT_URL });
await db.connect();

try {
  switch (command) {
    case "list":
      if (arg1) {
        await cmdListForTenant(arg1);
      } else {
        await cmdListAll();
      }
      break;
    case "enable":
      assertArgs("enable", arg1, arg2);
      await cmdSetEnabled(arg1, arg2, true);
      break;
    case "disable":
      assertArgs("disable", arg1, arg2);
      await cmdSetEnabled(arg1, arg2, false);
      break;
    case "enable-all":
      assertArgs("enable-all", arg1);
      await cmdEnableAll(arg1);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
} finally {
  await db.end();
}

// ---------------------------------------------------------------------------

async function cmdListAll() {
  const { rows } = await db.query(`
    SELECT
      d.playbook_key,
      d.name,
      d.status,
      d.sort_order,
      COUNT(s.step_key)::int AS step_count
    FROM management.playbook_definitions d
    LEFT JOIN management.playbook_steps s
      ON s.playbook_key = d.playbook_key
    GROUP BY d.playbook_key, d.name, d.status, d.sort_order
    ORDER BY d.sort_order, d.playbook_key
  `);
  if (rows.length === 0) {
    console.log("No playbooks found. Run: pnpm seed:playbooks");
    return;
  }
  console.log(`\n${"KEY".padEnd(30)} ${"NAME".padEnd(40)} ${"STATUS".padEnd(12)} ${"STEPS".padEnd(5)} RUNNABLE`);
  console.log("-".repeat(100));
  for (const r of rows) {
    const runnable = r.step_count > 0 ? "yes" : "no";
    console.log(`${r.playbook_key.padEnd(30)} ${r.name.padEnd(40)} ${r.status.padEnd(12)} ${String(r.step_count).padEnd(5)} ${runnable}`);
  }
  console.log(`\nTotal: ${rows.length} playbooks`);
}

async function cmdListForTenant(tenantRef) {
  const tenant = await resolveTenant(tenantRef);

  const { rows } = await db.query(
    `SELECT
       d.playbook_key,
       d.name,
       d.status,
       COUNT(s.step_key)::int AS step_count,
       COALESCE(a.enabled, false) AS enabled,
       a.enabled_at,
       a.enabled_by
     FROM management.playbook_definitions d
     LEFT JOIN management.playbook_steps s
       ON s.playbook_key = d.playbook_key
     LEFT JOIN management.tenant_playbook_access a
       ON a.tenant_id = $1 AND a.playbook_key = d.playbook_key
     GROUP BY d.playbook_key, d.name, d.status, d.sort_order, a.enabled, a.enabled_at, a.enabled_by
     ORDER BY d.sort_order, d.playbook_key`,
    [tenant.tenant_id]
  );

  console.log(`\nPlaybooks for tenant: ${tenant.display_name} (${tenant.tenant_id})\n`);
  console.log(`${"KEY".padEnd(30)} ${"NAME".padEnd(35)} ${"ENABLED".padEnd(8)} ${"STEPS".padEnd(5)} RUNNABLE  ENABLED_AT`);
  console.log("-".repeat(110));
  for (const r of rows) {
    const flag = r.enabled ? "YES    " : "no     ";
    const when = r.enabled_at ? new Date(r.enabled_at).toISOString().slice(0, 10) : "";
    const runnable = r.step_count > 0 ? "yes" : "no";
    console.log(`${r.playbook_key.padEnd(30)} ${r.name.padEnd(35)} ${flag} ${String(r.step_count).padEnd(5)} ${runnable.padEnd(8)} ${when}`);
  }
  const enabledCount = rows.filter((r) => r.enabled).length;
  console.log(`\n${enabledCount}/${rows.length} playbooks enabled`);
}

async function cmdSetEnabled(tenantRef, playbookKey, enabled) {
  const tenant = await resolveTenant(tenantRef);
  const playbook = await resolvePlaybook(playbookKey);

  await db.query(
    `INSERT INTO management.tenant_playbook_access
       (tenant_id, playbook_key, enabled, enabled_at, enabled_by)
     VALUES ($1, $2, $3, now(), 'admin')
     ON CONFLICT (tenant_id, playbook_key) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       enabled_at = CASE WHEN EXCLUDED.enabled AND NOT management.tenant_playbook_access.enabled
                         THEN now()
                         ELSE management.tenant_playbook_access.enabled_at END,
       enabled_by = 'admin'`,
    [tenant.tenant_id, playbook.playbook_key, enabled]
  );

  const action = enabled ? "ENABLED" : "DISABLED";
  console.log(`${action}: ${playbook.playbook_key} (${playbook.name}) for ${tenant.display_name}`);
}

async function cmdEnableAll(tenantRef) {
  const tenant = await resolveTenant(tenantRef);

  const { rows: playbooks } = await db.query(
    `SELECT playbook_key, name FROM management.playbook_definitions
     WHERE status = 'available'
     ORDER BY sort_order, playbook_key`
  );

  for (const p of playbooks) {
    await db.query(
      `INSERT INTO management.tenant_playbook_access
         (tenant_id, playbook_key, enabled, enabled_at, enabled_by)
       VALUES ($1, $2, true, now(), 'admin')
       ON CONFLICT (tenant_id, playbook_key) DO UPDATE SET
         enabled = true,
         enabled_at = COALESCE(management.tenant_playbook_access.enabled_at, now()),
         enabled_by = 'admin'`,
      [tenant.tenant_id, p.playbook_key]
    );
    console.log(`  enabled: ${p.playbook_key}`);
  }

  console.log(`\nAll ${playbooks.length} available playbooks enabled for ${tenant.display_name}`);
}

// ---------------------------------------------------------------------------

async function resolveTenant(ref) {
  const { rows } = await db.query(
    `SELECT tenant_id, slug, display_name FROM management.tenants
     WHERE tenant_id = $1 OR slug = $1`,
    [ref]
  );
  if (rows.length === 0) {
    console.error(`Tenant not found: ${ref}`);
    console.error("Use tenant_id or slug. Run: node scripts/admin-playbooks.js list");
    process.exit(1);
  }
  return rows[0];
}

async function resolvePlaybook(key) {
  const { rows } = await db.query(
    `SELECT playbook_key, name FROM management.playbook_definitions WHERE playbook_key = $1`,
    [key]
  );
  if (rows.length === 0) {
    console.error(`Playbook not found: ${key}`);
    console.error("Run: node scripts/admin-playbooks.js list");
    process.exit(1);
  }
  return rows[0];
}

function assertArgs(cmd, ...args) {
  const missing = args.filter((a) => !a);
  if (missing.length > 0) {
    console.error(`Command '${cmd}' requires more arguments.`);
    printUsage();
    process.exit(1);
  }
}

function printUsage() {
  console.log(`
Usage: MANAGEMENT_DATABASE_URL=<url> node scripts/admin-playbooks.js <command>

Commands:
  list                         List all playbook definitions
  list <tenant>                List playbooks for tenant (id or slug)
  enable <tenant> <playbook>   Enable playbook for tenant
  disable <tenant> <playbook>  Disable playbook for tenant
  enable-all <tenant>          Enable all available playbooks for tenant
`);
}
