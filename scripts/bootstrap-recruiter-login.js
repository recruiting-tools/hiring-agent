#!/usr/bin/env node

import bcrypt from "bcryptjs";
import pg from "pg";
import {
  buildKeychainServiceName,
  printCredentialSummary,
  resolveBootstrapPassword,
  storePasswordInKeychain
} from "./lib/recruiter-auth.js";

const DB_URL = process.env.DATABASE_URL ?? process.env.SANDBOX_DATABASE_URL;
const recruiterId = process.env.RECRUITER_ID ?? process.env.DEMO_RECRUITER_ID ?? process.env.SANDBOX_DEMO_RECRUITER_ID ?? "recruiter-demo-001";
const clientId = process.env.CLIENT_ID ?? process.env.DEMO_CLIENT_ID ?? process.env.SANDBOX_DEMO_CLIENT_ID ?? null;
const email = process.env.RECRUITER_EMAIL ?? process.env.DEMO_EMAIL ?? process.env.SANDBOX_DEMO_EMAIL ?? "demo@hiring-agent.app";
const recruiterToken = process.env.RECRUITER_TOKEN ?? process.env.DEMO_RECRUITER_TOKEN ?? process.env.SANDBOX_DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";
const loginUrl = process.env.LOGIN_URL ?? "https://candidate-chatbot.recruiter-assistant.com/login";
const environment = process.env.BOOTSTRAP_ENV ?? (process.env.SANDBOX_DATABASE_URL ? "sandbox" : "prod");

if (!DB_URL) {
  console.error("ERROR: DATABASE_URL or SANDBOX_DATABASE_URL environment variable is required");
  process.exit(1);
}

const passwordResult = resolveBootstrapPassword({
  password: process.env.RECRUITER_PASSWORD ?? process.env.DEMO_PASSWORD ?? process.env.SANDBOX_DEMO_PASSWORD,
  generate: true
});

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

try {
  const passwordHash = await bcrypt.hash(passwordResult.password, 10);
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
    console.log(`Updated recruiter ${recruiterId}`);
  } else {
    if (!clientId) {
      console.error("ERROR: recruiter does not exist and CLIENT_ID/DEMO_CLIENT_ID/SANDBOX_DEMO_CLIENT_ID was not provided");
      process.exit(1);
    }
    await client.query(`
      INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token, password_hash)
      VALUES ($1, $2, $3, $4, $5)
    `, [recruiterId, clientId, email, recruiterToken, passwordHash]);
    console.log(`Inserted recruiter ${recruiterId}`);
  }

  const shouldStoreInKeychain = process.env.STORE_IN_KEYCHAIN !== "false";
  const keychain = shouldStoreInKeychain
    ? storePasswordInKeychain({
        password: passwordResult.password,
        account: email,
        serviceName: buildKeychainServiceName({
          app: "hiring-agent",
          environment,
          recruiterId
        })
      })
    : { stored: false, reason: "disabled" };

  printCredentialSummary({
    label: "Recruiter login prepared",
    loginUrl,
    email,
    recruiterToken,
    password: passwordResult.password,
    passwordSource: passwordResult.source,
    keychain
  });
} finally {
  await client.end();
}
