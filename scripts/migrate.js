#!/usr/bin/env node
// Apply all migrations/*.sql to the target DATABASE_URL.
// Tracks applied migrations in a schema_migrations table (idempotent).
// Usage: DATABASE_URL=... node scripts/migrate.js

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runMigrations } from "./lib/run-migrations.js";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../services/candidate-chatbot/migrations");

await runMigrations({
  connectionString: DB_URL,
  migrationsDir
});
