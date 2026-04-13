#!/usr/bin/env node
// Seed the tenant operational sandbox DB.
// This script intentionally keeps writing tenant-local auth rows in chatbot.recruiters
// for candidate-chatbot compatibility. It is not the control-plane bootstrap path for hiring-agent.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import bcrypt from "bcryptjs";
import { PostgresHiringStore } from "../services/candidate-chatbot/src/postgres-store.js";

const DB_URL = process.env.SANDBOX_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.V2_DEV_NEON_URL;
if (!DB_URL) {
  console.error("ERROR: SANDBOX_DATABASE_URL, DATABASE_URL, or V2_DEV_NEON_URL environment variable is required");
  process.exit(1);
}

const sandboxReset = process.env.SANDBOX_RESET === "1";
const demoEmail = process.env.SANDBOX_DEMO_EMAIL ?? process.env.DEMO_EMAIL ?? "demo@hiring-agent.app";
const demoPassword = process.env.SANDBOX_DEMO_PASSWORD ?? process.env.DEMO_PASSWORD;
const demoRecruiterId = process.env.SANDBOX_DEMO_RECRUITER_ID ?? process.env.DEMO_RECRUITER_ID ?? "recruiter-demo-001";
const demoRecruiterToken = process.env.SANDBOX_DEMO_RECRUITER_TOKEN ?? process.env.DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";

if (!demoPassword) {
  console.error("ERROR: SANDBOX_DEMO_PASSWORD or DEMO_PASSWORD environment variable is required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = join(__dirname, "../tests/fixtures/iteration-1-seed.json");
const seed = JSON.parse(await readFile(seedPath, "utf8"));

const store = new PostgresHiringStore({ connectionString: DB_URL });

try {
  if (sandboxReset) {
    console.log("Resetting sandbox DB...");
    await store.reset();
  }

  console.log("Seeding sandbox DB with synthetic fixtures...");
  await store.seed(seed);

  const passwordHash = await bcrypt.hash(demoPassword, 10);
  await store.sql`
    UPDATE chatbot.recruiters
    SET email = ${demoEmail},
        recruiter_token = ${demoRecruiterToken},
        password_hash = ${passwordHash}
    WHERE recruiter_id = ${demoRecruiterId}
  `;

  try {
    await store.sql`
      INSERT INTO management.feature_flags (flag, enabled)
      VALUES ('hh_send', false)
      ON CONFLICT (flag) DO UPDATE SET enabled = EXCLUDED.enabled
    `;
    await store.sql`
      INSERT INTO management.feature_flags (flag, enabled)
      VALUES ('hh_import', false)
      ON CONFLICT (flag) DO UPDATE SET enabled = EXCLUDED.enabled
    `;
    console.log("Sandbox feature flags enforced: hh_send=false, hh_import=false");
  } catch (error) {
    console.warn(`Skipping feature flag seed: ${error.message}`);
  }

  console.log(`Seeded ${seed.jobs.length} jobs and ${seed.candidate_fixtures.length} candidate fixtures.`);
  console.log(`Demo login email: ${demoEmail}`);
  console.log(`Demo recruiter token: ${demoRecruiterToken}`);
  console.log("Demo password source: environment variable");
} finally {
  await store.close();
}
