#!/usr/bin/env node
// Apply all management-db migrations/*.sql to MANAGEMENT_DATABASE_URL.
// Tracks applied migrations in management.schema_migrations (idempotent).
// Usage: MANAGEMENT_DATABASE_URL=... node scripts/migrate-management.js

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations } from "./lib/run-migrations.js";

const DB_URL = process.env.MANAGEMENT_DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL environment variable is required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../migrations/management");

await runMigrations({
  connectionString: DB_URL,
  migrationsDir,
  trackerSchema: "management",
  trackerTable: "schema_migrations"
});
