import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

export async function runMigrations({
  connectionString,
  migrationsDir,
  trackerSchema = "public",
  trackerTable = "schema_migrations"
}) {
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(trackerSchema)}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${quoteIdentifier(trackerSchema)}.${quoteIdentifier(trackerTable)} (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const alreadyApplied = await client.query(
        `SELECT 1 FROM ${quoteIdentifier(trackerSchema)}.${quoteIdentifier(trackerTable)} WHERE filename = $1`,
        [filename]
      );
      if (alreadyApplied.rows.length > 0) {
        console.log(`  skip  ${filename} (already applied)`);
        continue;
      }

      const sql = await readFile(join(migrationsDir, filename), "utf8");
      console.log(`  apply ${filename}...`);
      const needsTransaction = !sql.includes("CONCURRENTLY");

      try {
        if (needsTransaction) await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO ${quoteIdentifier(trackerSchema)}.${quoteIdentifier(trackerTable)} (filename) VALUES ($1)`,
          [filename]
        );
        if (needsTransaction) await client.query("COMMIT");
        console.log(`  done  ${filename}`);
      } catch (error) {
        if (needsTransaction) await client.query("ROLLBACK");
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${filename} failed: ${message}`);
      }
    }

    console.log("All migrations applied.");
  } finally {
    await client.end();
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}
