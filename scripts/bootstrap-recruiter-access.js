#!/usr/bin/env node
// Legacy tenant-local recruiter bootstrap for candidate-chatbot only.
// Do not use this script for hiring-agent login on hiring-chat.recruiter-assistant.com.
// hiring-agent auth reads from management.recruiters and should be bootstrapped via bootstrap-demo-user.js

import pg from "pg";
import {
  bootstrapRecruiterAccess,
  createRecruiterAccess,
  listRecruiters,
  parseArgs
} from "./lib/recruiter-access.js";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "help";

if (command === "help" || args.help) {
  printHelp();
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL ?? process.env.SANDBOX_DATABASE_URL;

if (!connectionString) {
  console.error("ERROR: DATABASE_URL or SANDBOX_DATABASE_URL is required");
  process.exit(1);
}

console.warn("WARNING: bootstrap-recruiter-access.js updates chatbot.recruiters only.");
console.warn("WARNING: It does NOT create or update management.recruiters for hiring-agent login.");

const client = new pg.Client({ connectionString });
await client.connect();

try {
  if (command === "list") {
    const recruiters = await listRecruiters(client, {
      clientId: args["client-id"] ?? null
    });
    console.log(JSON.stringify(recruiters, null, 2));
    process.exit(0);
  }

  if (command === "set-password") {
    const result = await bootstrapRecruiterAccess(client, {
      lookup: {
        recruiterId: args["recruiter-id"] ?? null,
        email: args.email ?? null,
        token: args.token ?? null
      },
      nextEmail: args["set-email"] ?? null,
      nextToken: args["set-token"] ?? null,
      password: args.password ?? null,
      clientId: args["client-id"] ?? null
    });

    console.log(JSON.stringify({
      ok: true,
      database_name: result.database_name,
      recruiter_id: result.recruiter_id,
      client_id: result.client_id,
      client_name: result.client_name,
      email: result.email,
      recruiter_token: result.recruiter_token,
      password: result.password,
      visible_jobs: result.visible_jobs
    }, null, 2));
    process.exit(0);
  }

  if (command === "create") {
    const result = await createRecruiterAccess(client, {
      recruiterId: args["recruiter-id"] ?? null,
      clientId: args["client-id"] ?? null,
      email: args.email ?? null,
      token: args.token ?? null,
      password: args.password ?? null
    });

    console.log(JSON.stringify({
      ok: true,
      database_name: result.database_name,
      recruiter_id: result.recruiter_id,
      client_id: result.client_id,
      client_name: result.client_name,
      email: result.email,
      recruiter_token: result.recruiter_token,
      password: result.password,
      visible_jobs: result.visible_jobs
    }, null, 2));
    process.exit(0);
  }

  console.error(`ERROR: unknown command "${command}"`);
  printHelp();
  process.exit(1);
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
} finally {
  await client.end();
}

function printHelp() {
  console.log(`Usage:
  node scripts/bootstrap-recruiter-access.js list [--client-id CLIENT_ID]
  node scripts/bootstrap-recruiter-access.js create --recruiter-id ID --client-id CLIENT_ID --email EMAIL --token TOKEN
    [--password PASSWORD]
  node scripts/bootstrap-recruiter-access.js set-password (--recruiter-id ID | --email EMAIL | --token TOKEN)
    [--client-id CLIENT_ID]
    [--password PASSWORD]
    [--set-email EMAIL]
    [--set-token TOKEN]

Env:
  DATABASE_URL or SANDBOX_DATABASE_URL
`);
}
