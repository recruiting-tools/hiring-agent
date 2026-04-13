#!/usr/bin/env node

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

const DB_URL = process.env.SANDBOX_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.V2_DEV_NEON_URL;
if (!DB_URL) {
  console.error("ERROR: SANDBOX_DATABASE_URL, DATABASE_URL, or V2_DEV_NEON_URL environment variable is required");
  process.exit(1);
}

const sandboxReset = process.env.SANDBOX_RESET === "1";
const demoEmail = process.env.SANDBOX_DEMO_EMAIL ?? process.env.DEMO_EMAIL ?? "demo@hiring-agent.app";
const demoRecruiterId = process.env.SANDBOX_DEMO_RECRUITER_ID ?? process.env.DEMO_RECRUITER_ID ?? "recruiter-demo-001";
const demoRecruiterToken = process.env.SANDBOX_DEMO_RECRUITER_TOKEN ?? process.env.DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";
const passwordResult = resolveBootstrapPassword({
  password: process.env.SANDBOX_DEMO_PASSWORD ?? process.env.DEMO_PASSWORD,
  generate: true
});

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

  const passwordHash = await bcrypt.hash(passwordResult.password, 10);
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
  const keychain = process.env.STORE_IN_KEYCHAIN !== "false"
    ? storePasswordInKeychain({
        password: passwordResult.password,
        account: demoEmail,
        serviceName: buildKeychainServiceName({
          app: "hiring-agent",
          environment: "sandbox",
          recruiterId: demoRecruiterId
        })
      })
    : { stored: false, reason: "disabled" };
  printCredentialSummary({
    label: "Sandbox recruiter login",
    loginUrl: process.env.SANDBOX_URL ?? "https://candidate-chatbot.recruiter-assistant.com/login",
    email: demoEmail,
    recruiterToken: demoRecruiterToken,
    password: passwordResult.password,
    passwordSource: passwordResult.source,
    keychain
  });
} finally {
  await store.close();
}
