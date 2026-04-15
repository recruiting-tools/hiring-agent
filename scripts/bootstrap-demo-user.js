#!/usr/bin/env node

import bcrypt from "bcryptjs";
import pg from "pg";

const MANAGEMENT_DB_URL =
  process.env.MANAGEMENT_DATABASE_URL
  ?? process.env.SANDBOX_DATABASE_URL
  ?? process.env.DATABASE_URL;

const recruiterId = process.env.DEMO_RECRUITER_ID ?? process.env.SANDBOX_DEMO_RECRUITER_ID ?? "recruiter-demo-001";
const tenantId = process.env.DEMO_CLIENT_ID ?? process.env.SANDBOX_DEMO_CLIENT_ID ?? null;
const email = process.env.DEMO_EMAIL ?? process.env.SANDBOX_DEMO_EMAIL ?? "demo@hiring-agent.app";
const password = process.env.DEMO_PASSWORD ?? process.env.SANDBOX_DEMO_PASSWORD;
const recruiterToken = process.env.DEMO_RECRUITER_TOKEN ?? process.env.SANDBOX_DEMO_RECRUITER_TOKEN ?? "rec-tok-demo-001";
const secondaryRecruiterId = process.env.SANDBOX_SECONDARY_DEMO_RECRUITER_ID ?? null;
const secondaryTenantId = process.env.SANDBOX_SECONDARY_DEMO_CLIENT_ID ?? null;
const secondaryEmail = process.env.SANDBOX_SECONDARY_DEMO_EMAIL ?? null;
const secondaryPassword = process.env.SANDBOX_SECONDARY_DEMO_PASSWORD ?? password;

if (!MANAGEMENT_DB_URL) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL, SANDBOX_DATABASE_URL, or DATABASE_URL environment variable is required");
  process.exit(1);
}

if (!password) {
  console.error("ERROR: DEMO_PASSWORD or SANDBOX_DEMO_PASSWORD environment variable is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: MANAGEMENT_DB_URL });
await client.connect();

try {
  await upsertDemoRecruiter(client, {
    recruiterId,
    tenantId,
    email,
    password,
    recruiterToken,
    label: "Demo"
  });

  if (secondaryRecruiterId && secondaryEmail) {
    await upsertDemoRecruiter(client, {
      recruiterId: secondaryRecruiterId,
      tenantId: secondaryTenantId,
      email: secondaryEmail,
      password: secondaryPassword,
      label: "Secondary demo"
    });
  }

  console.log(`Demo login email: ${email}`);
  if (secondaryEmail) {
    console.log(`Secondary demo login email: ${secondaryEmail}`);
  }
  console.log("Demo password source: environment variable");

  if (!process.env.MANAGEMENT_DATABASE_URL) {
    console.warn("WARNING: bootstrap-demo-user used legacy DB env fallback; prefer MANAGEMENT_DATABASE_URL");
  }
} finally {
  await client.end();
}

async function upsertDemoRecruiter(client, { recruiterId, tenantId, email, password, recruiterToken, label }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await client.query(
    "SELECT recruiter_id, tenant_id, recruiter_token FROM management.recruiters WHERE recruiter_id = $1",
    [recruiterId]
  );

  if (existing.rows.length > 0) {
    const existingTenantId = existing.rows[0].tenant_id;
    await client.query(`
      UPDATE management.recruiters
      SET email = $2,
          password_hash = $3,
          recruiter_token = $4,
          status = 'active',
          role = 'recruiter'
      WHERE recruiter_id = $1
    `, [recruiterId, email, passwordHash, recruiterToken]);
    console.log(`Updated ${label.toLowerCase()} recruiter ${recruiterId}`);
    console.log(`${label} tenant: ${existingTenantId}`);
    console.log(`${label} token: ${existing.rows[0].recruiter_token ?? recruiterToken}`);
    return;
  }

  if (!tenantId) {
    console.error(`ERROR: recruiter ${recruiterId} does not exist and tenant id was not provided for ${label.toLowerCase()} bootstrap`);
    process.exit(1);
  }

  await client.query(`
    INSERT INTO management.tenants (tenant_id, slug, display_name, status)
    VALUES ($1, $2, $3, 'active')
    ON CONFLICT (tenant_id) DO NOTHING
  `, [tenantId, tenantId, tenantId]);

  await client.query(`
    INSERT INTO management.recruiters (recruiter_id, tenant_id, email, password_hash, recruiter_token, status, role)
    VALUES ($1, $2, $3, $4, $5, 'active', 'recruiter')
  `, [recruiterId, tenantId, email, passwordHash, recruiterToken]);
  console.log(`Inserted ${label.toLowerCase()} recruiter ${recruiterId}`);
  console.log(`${label} tenant: ${tenantId}`);
  console.log(`${label} token: ${recruiterToken}`);
}
