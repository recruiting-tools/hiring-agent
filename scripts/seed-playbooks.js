#!/usr/bin/env node
/**
 * Seed management.playbook_definitions and management.playbook_steps
 * from data/playbooks-seed.json into the management DB.
 *
 * Idempotent:
 *   - definitions: ON CONFLICT DO UPDATE
 *   - steps: DELETE + INSERT per playbook_key (full replace)
 *
 * Safety: aborts if there are active playbook sessions for the affected
 * playbooks, because step replacement would corrupt in-flight sessions.
 * Use --force to override (e.g. in dev/CI with no real users).
 *
 * Usage:
 *   MANAGEMENT_DATABASE_URL=<url> node scripts/seed-playbooks.js
 *   MANAGEMENT_DATABASE_URL=<url> node scripts/seed-playbooks.js --dry-run
 *   MANAGEMENT_DATABASE_URL=<url> node scripts/seed-playbooks.js --force
 */

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const seedPath = join(__dir, "../data/playbooks-seed.json");

const MANAGEMENT_URL = process.env.MANAGEMENT_DATABASE_URL;
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

// JSON5-style: strip // comments before parsing
const raw = readFileSync(seedPath, "utf-8").replace(/\/\/[^\n]*/g, "");
const seed = JSON.parse(raw);

if (DRY_RUN) {
  console.log("[dry-run] Would seed:");
  console.log(`  ${seed.definitions.length} playbook definitions`);
  console.log(`  ${seed.steps.length} playbook steps`);
  process.exit(0);
}

if (!MANAGEMENT_URL) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL environment variable is required");
  process.exit(1);
}

const db = new pg.Client({ connectionString: MANAGEMENT_URL });
await db.connect();

try {
  await db.query("BEGIN");

  // ── 1. Upsert definitions ────────────────────────────────────────────────

  for (const def of seed.definitions) {
    await db.query(
      `INSERT INTO management.playbook_definitions
         (playbook_key, name, trigger_description, keywords, status, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (playbook_key) DO UPDATE SET
         name                = EXCLUDED.name,
         trigger_description = EXCLUDED.trigger_description,
         keywords            = EXCLUDED.keywords,
         status              = EXCLUDED.status,
         sort_order          = EXCLUDED.sort_order`,
      [
        def.playbook_key,
        def.name,
        def.trigger_description ?? null,
        def.keywords ?? [],
        def.status ?? "available",
        def.sort_order ?? 0,
      ]
    );
    console.log(`  upserted definition: ${def.playbook_key}`);
  }

  // ── 2. Guard: abort if active sessions exist (--force to override) ──────

  const playbookKeys = [...new Set(seed.steps.map((s) => s.playbook_key))];

  const { rows: activeSessions } = await db.query(
    `SELECT playbook_key, COUNT(*) AS n
     FROM management.playbook_sessions
     WHERE playbook_key = ANY($1) AND status = 'active'
     GROUP BY playbook_key`,
    [playbookKeys]
  );

  if (activeSessions.length > 0 && !FORCE) {
    const summary = activeSessions.map((r) => `  ${r.playbook_key}: ${r.n} active`).join("\n");
    console.error(`ERROR: active playbook sessions exist for affected playbooks:\n${summary}`);
    console.error("Step replacement would corrupt in-flight sessions.");
    console.error("Use --force to override (dev/CI only, no real users).");
    process.exit(1);
  }

  if (activeSessions.length > 0 && FORCE) {
    console.warn(`WARNING: --force override, replacing steps despite active sessions.`);
  }

  // ── 3. Replace steps per playbook ────────────────────────────────────────

  await db.query(
    `DELETE FROM management.playbook_steps WHERE playbook_key = ANY($1)`,
    [playbookKeys]
  );

  for (const step of seed.steps) {
    await db.query(
      `INSERT INTO management.playbook_steps
         (step_key, playbook_key, step_order, name, step_type,
          user_message, prompt_template, context_key, db_save_column,
          next_step_order, options, routing, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        step.step_key,
        step.playbook_key,
        step.step_order,
        step.name,
        step.step_type,
        step.user_message ?? null,
        step.prompt_template ?? null,
        step.context_key ?? null,
        step.db_save_column ?? null,
        step.next_step_order ?? null,
        step.options ?? null,
        step.routing ? JSON.stringify(step.routing) : null,
        step.notes ?? null,
      ]
    );
  }

  console.log(`  inserted ${seed.steps.length} steps across ${playbookKeys.length} playbooks`);

  await db.query("COMMIT");
  console.log("\nDone.");
} catch (err) {
  await db.query("ROLLBACK");
  console.error("Error, rolled back:", err.message);
  process.exit(1);
} finally {
  await db.end();
}
