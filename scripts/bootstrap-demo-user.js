#!/usr/bin/env node

import bcrypt from "bcryptjs";
import pg from "pg";

const DB_URL = process.env.DATABASE_URL ?? process.env.SANDBOX_DATABASE_URL;
const recruiterId = process.env.DEMO_RECRUITER_ID ?? process.env.SANDBOX_DEMO_RECRUITER_ID ?? "recruiter-demo-001";
const clientId = process.env.DEMO_CLIENT_ID ?? process.env.SANDBOX_DEMO_CLIENT_ID ?? null;
const email = process.env.DEMO_EMAIL ?? process.env.SANDBOX_DEMO_EMAIL ?? "demo@hiring-agent.app";
const password = process.env.DEMO_PASSWORD ?? process.env.SANDBOX_DEMO_PASSWORD;
const recruiterToken = process.env.DEMO_RECRUITER_TOKEN ?? process.env.SANDBOX_DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";

if (!DB_URL) {
  console.error("ERROR: DATABASE_URL or SANDBOX_DATABASE_URL environment variable is required");
  process.exit(1);
}

if (!password) {
  console.error("ERROR: DEMO_PASSWORD or SANDBOX_DEMO_PASSWORD environment variable is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await client.query(
    "SELECT recruiter_id FROM chatbot.recruiters WHERE recruiter_id = $1",
    [recruiterId]
  );

  if (existing.rows.length > 0) {
    await client.query(`
      UPDATE chatbot.recruiters
      SET email = $2, recruiter_token = $3, password_hash = $4
      WHERE recruiter_id = $1
    `, [recruiterId, email, recruiterToken, passwordHash]);
    console.log(`Updated demo recruiter ${recruiterId}`);
  } else {
    if (!clientId) {
      console.error("ERROR: recruiter does not exist and DEMO_CLIENT_ID/SANDBOX_DEMO_CLIENT_ID was not provided");
      process.exit(1);
    }
    await client.query(`
      INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token, password_hash)
      VALUES ($1, $2, $3, $4, $5)
    `, [recruiterId, clientId, email, recruiterToken, passwordHash]);
    console.log(`Inserted demo recruiter ${recruiterId}`);
  }

  console.log(`Demo login email: ${email}`);
  console.log(`Demo recruiter token: ${recruiterToken}`);
  console.log("Demo password source: environment variable");
} finally {
  await client.end();
}
