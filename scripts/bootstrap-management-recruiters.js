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
  const recruiters = await sourceClient.query(`
    SELECT recruiter_id, client_id, email, password_hash
    FROM chatbot.recruiters
    WHERE email IS NOT NULL
    ORDER BY recruiter_id
  `);

  let duplicateEmailCount = 0;

  for (const row of recruiters.rows) {
    try {
      await managementClient.query(`
        INSERT INTO management.recruiters (
          recruiter_id,
          tenant_id,
          email,
          password_hash,
          status,
          role
        )
        VALUES ($1, $2, $3, $4, 'active', 'recruiter')
        ON CONFLICT (recruiter_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash
      `, [
        row.recruiter_id,
        row.client_id,
        row.email,
        row.password_hash
      ]);
      console.log(`Upserted recruiter ${row.recruiter_id}`);
    } catch (error) {
      if (error?.code === "23505") {
        duplicateEmailCount += 1;
        console.warn(`Skipping recruiter ${row.recruiter_id}: duplicate email ${row.email}`);
        continue;
      }
      throw error;
    }
  }

  if (duplicateEmailCount > 0) {
    console.warn(`Skipped ${duplicateEmailCount} recruiter rows due to duplicate email conflicts.`);
  }
} finally {
  await sourceClient.end();
  await managementClient.end();
}
