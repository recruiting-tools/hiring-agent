#!/usr/bin/env node
// Apply all migrations/*.sql to the target DATABASE_URL.
// Tracks applied migrations in a schema_migrations table (idempotent).
// Usage: DATABASE_URL=... node scripts/migrate.js

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../services/candidate-chatbot/migrations");

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

try {
  // Ensure migrations tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Read migration files in sorted order
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const alreadyApplied = await client.query(
      "SELECT 1 FROM public.schema_migrations WHERE filename = $1",
      [filename]
    );
    if (alreadyApplied.rows.length > 0) {
      console.log(`  skip  ${filename} (already applied)`);
      continue;
    }

    const sql = await readFile(join(migrationsDir, filename), "utf8");
    console.log(`  apply ${filename}...`);
    // CONCURRENTLY index creation cannot run inside a transaction
    const needsTransaction = !sql.includes("CONCURRENTLY");
    try {
      if (needsTransaction) await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO public.schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      if (needsTransaction) await client.query("COMMIT");
      console.log(`  done  ${filename}`);
    } catch (err) {
      if (needsTransaction) await client.query("ROLLBACK");
      throw new Error(`Migration ${filename} failed: ${err.message}`);
    }
  }

  console.log("All migrations applied.");
} finally {
  await client.end();
}
