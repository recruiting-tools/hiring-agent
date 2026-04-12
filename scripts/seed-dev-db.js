#!/usr/bin/env node
// Seed the V2 dev Neon DB with iteration-1 fixtures.
// Usage: V2_DEV_NEON_URL=... node scripts/seed-dev-db.js

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import bcrypt from "bcryptjs";
import { PostgresHiringStore } from "../services/candidate-chatbot/src/postgres-store.js";

const DB_URL = process.env.V2_DEV_NEON_URL;
if (!DB_URL) {
  console.error("ERROR: V2_DEV_NEON_URL environment variable is required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = join(__dirname, "../tests/fixtures/iteration-1-seed.json");
const seed = JSON.parse(await readFile(seedPath, "utf8"));

console.log("Connecting to Neon dev DB...");
const store = new PostgresHiringStore({ connectionString: DB_URL });

try {
  await store.seed(seed);
  console.log(`Seeded ${seed.jobs.length} jobs and ${seed.candidate_fixtures.length} candidate fixtures.`);

  // Set demo password for the demo recruiter (recruiter_id from seed fixture)
  const demoEmail = process.env.DEMO_EMAIL ?? "demo@hiring-agent.app";
  const demoPassword = process.env.DEMO_PASSWORD ?? "demo1234";
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  // Update the seeded recruiter email and set password
  await store.sql`
    UPDATE chatbot.recruiters
    SET email = ${demoEmail}, password_hash = ${passwordHash}
    WHERE recruiter_id = 'recruiter-demo-001'
  `;
  console.log(`Set demo credentials: email=${demoEmail}`);
  console.log(`Demo password source: ${process.env.DEMO_PASSWORD ? "environment variable" : "default dev fallback"}`);
} finally {
  await store.close();
}

console.log("Done.");
