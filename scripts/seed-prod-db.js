#!/usr/bin/env node
// Seed the production Neon DB with 1 client, 1 job+pipeline, and demo recruiter.
// Usage: DATABASE_URL=... node scripts/seed-prod-db.js

import bcrypt from "bcryptjs";
import pg from "pg";
import {
  buildKeychainServiceName,
  printCredentialSummary,
  resolveBootstrapPassword,
  storePasswordInKeychain
} from "./lib/recruiter-auth.js";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

const demoEmail = process.env.DEMO_EMAIL ?? "demo@hiring-agent.app";
const recruiterToken = process.env.DEMO_RECRUITER_TOKEN ?? "rec-tok-prod-001";
const passwordResult = resolveBootstrapPassword({
  password: process.env.DEMO_PASSWORD,
  generate: true
});

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

try {
  console.log("Seeding production DB...");

  // 1. Client
  await client.query(`
    INSERT INTO management.clients (client_id, name)
    VALUES ('client-prod-001', 'Hiring Agent Demo')
    ON CONFLICT (client_id) DO NOTHING
  `);
  console.log("  client: client-prod-001");

  // 2. Job
  await client.query(`
    INSERT INTO chatbot.jobs (job_id, title, description, client_id)
    VALUES (
      'job-prod-001',
      'Менеджер по закупкам',
      'Ищем опытного менеджера по закупкам из Китая. Требования: опыт ВЭД от 3 лет, знание китайского рынка.',
      'client-prod-001'
    )
    ON CONFLICT (job_id) DO NOTHING
  `);
  console.log("  job: job-prod-001");

  // 3. Pipeline template for the job
  const steps = [
    {
      id: "step-intro",
      step_index: 0,
      goal: "Познакомиться с кандидатом, уточнить опыт ВЭД",
      message_template: "Здравствуйте! Меня зовут Алина, я рекрутер. Расскажите, пожалуйста, о вашем опыте работы с китайскими поставщиками?",
      completion_criteria: "Кандидат рассказал об опыте ВЭД"
    },
    {
      id: "step-experience",
      step_index: 1,
      goal: "Уточнить опыт работы с Китаем",
      message_template: "Отлично! Сколько лет вы работаете с китайским рынком? Какие категории товаров закупали?",
      completion_criteria: "Кандидат уточнил опыт и категории товаров"
    },
    {
      id: "step-invite",
      step_index: 2,
      goal: "Пригласить на собеседование",
      message_template: "Спасибо за информацию! Хотели бы пригласить вас на собеседование. Когда вам удобно?",
      completion_criteria: "Кандидат согласился на собеседование или отказался"
    }
  ];

  await client.query(`
    INSERT INTO chatbot.pipeline_templates (template_id, template_version, job_id, name, steps_json)
    VALUES ('tpl-prod-001', 1, 'job-prod-001', 'Закупщик из Китая', $1)
    ON CONFLICT (template_id) DO NOTHING
  `, [JSON.stringify(steps)]);
  console.log("  pipeline template: tpl-prod-001");

  // 4. Recruiter with demo credentials
  const passwordHash = await bcrypt.hash(passwordResult.password, 10);

  await client.query(`
    INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token, password_hash)
    VALUES ('recruiter-prod-001', 'client-prod-001', $1, $2, $3)
    ON CONFLICT (recruiter_id) DO UPDATE SET
      email = EXCLUDED.email,
      password_hash = EXCLUDED.password_hash,
      recruiter_token = EXCLUDED.recruiter_token
  `, [demoEmail, recruiterToken, passwordHash]);
  console.log(`  recruiter: ${demoEmail}`);

  console.log("Done. Production DB seeded.");
  const keychain = process.env.STORE_IN_KEYCHAIN !== "false"
    ? storePasswordInKeychain({
        password: passwordResult.password,
        account: demoEmail,
        serviceName: buildKeychainServiceName({
          app: "hiring-agent",
          environment: "prod",
          recruiterId: "recruiter-prod-001"
        })
      })
    : { stored: false, reason: "disabled" };
  printCredentialSummary({
    label: "Production recruiter login",
    loginUrl: "https://candidate-chatbot.recruiter-assistant.com/login",
    email: demoEmail,
    recruiterToken,
    password: passwordResult.password,
    passwordSource: passwordResult.source,
    keychain
  });
} finally {
  await client.end();
}
