#!/usr/bin/env node

import pg from "pg";

const MANAGEMENT_DB_URL = process.env.MANAGEMENT_DATABASE_URL;
const SOURCE_DB_URL = process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.CHATBOT_DATABASE_URL;

if (!MANAGEMENT_DB_URL) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL environment variable is required");
  process.exit(1);
}

if (!SOURCE_DB_URL) {
  console.error("ERROR: SOURCE_DATABASE_URL, DATABASE_URL, or CHATBOT_DATABASE_URL is required");
  process.exit(1);
}

const managementClient = new pg.Client({ connectionString: MANAGEMENT_DB_URL });
const sourceClient = new pg.Client({ connectionString: SOURCE_DB_URL });

await managementClient.connect();
await sourceClient.connect();

try {
  const sourceTableCheck = await sourceClient.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'management'
        AND table_name = 'clients'
    ) AS exists
  `);

  if (!sourceTableCheck.rows[0]?.exists) {
    throw new Error("Source DB does not contain management.clients; cannot bootstrap tenants from this source");
  }

  const clients = await sourceClient.query(`
    SELECT client_id, name
    FROM management.clients
    ORDER BY client_id
  `);

  for (const row of clients.rows) {
    await managementClient.query(`
      INSERT INTO management.tenants (tenant_id, slug, display_name, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (tenant_id) DO UPDATE SET
        slug = EXCLUDED.slug,
        display_name = EXCLUDED.display_name
    `, [
      row.client_id,
      slugify(row.client_id),
      row.name
    ]);
    console.log(`Upserted tenant ${row.client_id}`);
  }
} finally {
  await sourceClient.end();
  await managementClient.end();
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
