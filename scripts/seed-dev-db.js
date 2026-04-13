#!/usr/bin/env node
// Seed the V2 dev Neon DB with iteration-1 fixtures.
// Usage: V2_DEV_NEON_URL=... node scripts/seed-dev-db.js

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import bcrypt from "bcryptjs";
import { PostgresHiringStore } from "../services/candidate-chatbot/src/postgres-store.js";
import {
  buildKeychainServiceName,
  printCredentialSummary,
  resolveBootstrapPassword,
  storePasswordInKeychain
} from "./lib/recruiter-auth.js";

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
  const passwordResult = resolveBootstrapPassword({
    password: process.env.DEMO_PASSWORD,
    fallbackPassword: "demo1234"
  });
  const passwordHash = await bcrypt.hash(passwordResult.password, 10);

  // Update the seeded recruiter email and set password
  await store.sql`
    UPDATE chatbot.recruiters
    SET email = ${demoEmail}, password_hash = ${passwordHash}
    WHERE recruiter_id = 'recruiter-demo-001'
  `;
  const keychain = process.env.STORE_IN_KEYCHAIN !== "false"
    ? storePasswordInKeychain({
        password: passwordResult.password,
        account: demoEmail,
        serviceName: buildKeychainServiceName({
          app: "hiring-agent",
          environment: "dev",
          recruiterId: "recruiter-demo-001"
        })
      })
    : { stored: false, reason: "disabled" };
  printCredentialSummary({
    label: "Dev recruiter login",
    email: demoEmail,
    recruiterToken: "rec-tok-demo-001",
    password: passwordResult.password,
    passwordSource: passwordResult.source,
    keychain
  });
} finally {
  await store.close();
}

console.log("Done.");
