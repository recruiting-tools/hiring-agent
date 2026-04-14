#!/usr/bin/env node
/**
 * demo-seed.js — snapshot seed for demo/sandbox environment.
 *
 * Creates demo vacancies, jobs, candidates, pipeline runs, and seeded planned
 * messages so the moderation UI is non-empty immediately after seeding.
 *
 * Usage:
 *   CHATBOT_DATABASE_URL=... node scripts/demo-seed.js
 *   CHATBOT_DATABASE_URL=... node scripts/demo-seed.js --reset   # truncate demo data first
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { resolveModerationDelayMs } from "../services/candidate-chatbot/src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_URL = process.env.CHATBOT_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.SANDBOX_DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: CHATBOT_DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(DB_URL);

const doReset = process.argv.includes("--reset");

const vacanciesPath = join(__dirname, "../tests/fixtures/demo-vacancies.json");
const archetypesPath = join(__dirname, "../data/demo-simulator/candidate-archetypes.json");
const templatesPath = join(__dirname, "../data/demo-simulator/dialog-templates.json");

const demoVacancies = JSON.parse(await readFile(vacanciesPath, "utf8"));
const archetypesData = JSON.parse(await readFile(archetypesPath, "utf8"));
const templates = JSON.parse(await readFile(templatesPath, "utf8"));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pick a weighted random archetype for a vacancy class */
function pickArchetype(vacancyClass) {
  const weights = archetypesData.vacancy_weights[vacancyClass] ?? archetypesData.vacancy_weights.blue_collar;
  const roll = Math.random();
  let cumulative = 0;
  for (const [id, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (roll <= cumulative) return id;
  }
  return Object.keys(weights)[0];
}

/** Pick a random item from an array */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Fill in simple template variables */
function fillTemplate(text, vars) {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

/** Generate a random integer between min and max (inclusive) */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Generate a plausible initial application message for a given archetype */
function generateApplicationMessage(archetypeId, vacancyClass) {
  const messages = templates.initial_application_messages[archetypeId]
    ?? templates.initial_application_messages.medium_needs_clarification;
  const raw = pick(messages);
  const experienceYears = randInt(1, 8);
  const expectedSalary = (Math.floor(randInt(80, 150) / 10) * 10) + "000";
  const midSalary = (Math.floor(randInt(70, 100) / 10) * 10) + "000";
  return fillTemplate(raw, { experience_years: experienceYears, expected_salary: expectedSalary, mid_salary: midSalary, company_type: "складе" });
}

/** Determine vacancy class for archetype weight selection */
function getVacancyClass(vacancyId) {
  const whitCollarIds = ["vac-demo-sales-skolkovo", "vac-demo-china-procurement"];
  return whitCollarIds.includes(vacancyId) ? "white_collar" : "blue_collar";
}

/** Generate a fake pipeline template for a demo job */
function buildPipelineTemplate(vacancyId, title) {
  const templateId = `tpl-demo-${vacancyId}`;
  const steps = [
    { id: "screening_intro", step_index: 1, kind: "question", goal: "Познакомиться с кандидатом и проверить ключевые требования", done_when: "кандидат подтвердил опыт и базовые условия", reject_when: "кандидат явно не соответствует ключевым требованиям", prompt_key: "step.screening_intro" },
    { id: "screening_conditions", step_index: 2, kind: "question", goal: "Проверить зарплатные ожидания и график", done_when: "кандидат подтвердил совместимость ожиданий с условиями", reject_when: "зарплата или график критически не совпадают", prompt_key: "step.screening_conditions" },
    { id: "target_action", step_index: 3, kind: "target", goal: "Пригласить кандидата на следующий шаг", done_when: "кандидат согласился прийти / позвонить / продолжить", reject_when: "кандидат отказался", prompt_key: "step.target_action" }
  ];
  return { template_id: templateId, template_version: 1, job_id: `job-demo-${vacancyId.replace("vac-demo-", "")}`, name: `${title} screening`, steps };
}

// ─── Reset ────────────────────────────────────────────────────────────────────

if (doReset) {
  console.log("Resetting demo data...");
  const demoJobIds = demoVacancies.map(v => v.job_id);
  const demoVacancyIds = demoVacancies.map(v => v.vacancy_id);

  // Delete in dependency order
  for (const jobId of demoJobIds) {
    await sql`DELETE FROM chatbot.pipeline_step_state WHERE pipeline_run_id IN (SELECT pipeline_run_id FROM chatbot.pipeline_runs WHERE job_id = ${jobId})`;
    await sql`DELETE FROM chatbot.pipeline_events WHERE pipeline_run_id IN (SELECT pipeline_run_id FROM chatbot.pipeline_runs WHERE job_id = ${jobId})`;
    await sql`DELETE FROM chatbot.planned_messages WHERE pipeline_run_id IN (SELECT pipeline_run_id FROM chatbot.pipeline_runs WHERE job_id = ${jobId})`;
    await sql`DELETE FROM chatbot.pipeline_runs WHERE job_id = ${jobId}`;
    await sql`DELETE FROM chatbot.messages WHERE conversation_id IN (SELECT conversation_id FROM chatbot.conversations WHERE job_id = ${jobId})`;
    await sql`DELETE FROM chatbot.conversations WHERE job_id = ${jobId}`;
    await sql`DELETE FROM chatbot.pipeline_templates WHERE job_id = ${jobId}`;
  }
  for (const vacancyId of demoVacancyIds) {
    await sql`DELETE FROM chatbot.vacancies WHERE vacancy_id = ${vacancyId}`;
  }
  for (const jobId of demoJobIds) {
    await sql`DELETE FROM chatbot.jobs WHERE job_id = ${jobId}`;
  }
  console.log("Reset complete.");
}

// ─── Seed vacancies + jobs ────────────────────────────────────────────────────

console.log(`Seeding ${demoVacancies.length} demo vacancies...`);

for (const vac of demoVacancies) {
  const tpl = buildPipelineTemplate(vac.vacancy_id, vac.title);

  // Upsert job
  await sql`
    INSERT INTO chatbot.jobs (job_id, title, description)
    VALUES (${vac.job_id}, ${vac.title}, ${vac.raw_text ?? ""})
    ON CONFLICT (job_id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description
  `;

  // Upsert pipeline template
  await sql`
    INSERT INTO chatbot.pipeline_templates (template_id, template_version, job_id, name, steps_json)
    VALUES (${tpl.template_id}, ${tpl.template_version}, ${vac.job_id}, ${tpl.name}, ${JSON.stringify(tpl.steps)})
    ON CONFLICT (template_id) DO NOTHING
  `;

  // Upsert vacancy
  await sql`
    INSERT INTO chatbot.vacancies (
      vacancy_id, job_id, title, raw_text,
      must_haves, nice_haves, work_conditions, application_steps, company_info, faq,
      extraction_status, status, hh_vacancy_id, moderation_settings
    )
    VALUES (
      ${vac.vacancy_id}, ${vac.job_id}, ${vac.title}, ${vac.raw_text ?? null},
      ${JSON.stringify(vac.must_haves ?? [])},
      ${JSON.stringify(vac.nice_haves ?? [])},
      ${JSON.stringify(vac.work_conditions ?? {})},
      ${JSON.stringify(vac.application_steps ?? [])},
      ${JSON.stringify(vac.company_info ?? {})},
      ${JSON.stringify(vac.faq ?? [])},
      ${vac.extraction_status}, ${vac.status},
      ${vac.hh_vacancy_id ?? null},
      ${JSON.stringify(vac.moderation_settings ?? {})}
    )
    ON CONFLICT (vacancy_id) DO UPDATE SET
      moderation_settings = EXCLUDED.moderation_settings,
      extraction_status   = EXCLUDED.extraction_status,
      status              = EXCLUDED.status,
      updated_at          = now()
  `;

  console.log(`  vacancy ${vac.vacancy_id} (${vac.status})`);
}

// ─── Seed candidates + pipeline runs ─────────────────────────────────────────

const CANDIDATE_COUNT_PER_ACTIVE_VACANCY = {
  "vac-demo-warehouse-picker": 14,
  "vac-demo-cook-hot-shop": 10,
  "vac-demo-sales-skolkovo": 8
};

// Only seed candidates for active vacancies
const activeVacancies = demoVacancies.filter(v => v.status === "active");
let totalCandidates = 0;
let totalPending = 0;

for (const vac of activeVacancies) {
  const count = CANDIDATE_COUNT_PER_ACTIVE_VACANCY[vac.vacancy_id] ?? 8;
  const vacancyClass = getVacancyClass(vac.vacancy_id);
  const tplId = `tpl-demo-${vac.vacancy_id.replace("vac-demo-", "")}`;
  const tplSteps = [
    { id: "screening_intro", step_index: 1 },
    { id: "screening_conditions", step_index: 2 },
    { id: "target_action", step_index: 3 }
  ];

  console.log(`  seeding ${count} candidates for ${vac.vacancy_id}...`);

  const namePool = [...templates.names.male, ...templates.names.female];
  const usedNames = new Set();

  for (let i = 0; i < count; i++) {
    const archetypeId = pickArchetype(vacancyClass);
    const archetype = archetypesData.archetypes.find(a => a.id === archetypeId);

    // Pick unique name
    let name;
    do { name = pick(namePool); } while (usedNames.has(name));
    usedNames.add(name);

    const candidateId = `cand-demo-${vac.vacancy_id.slice(9)}-${String(i + 1).padStart(3, "0")}`;
    const conversationId = `conv-demo-${vac.vacancy_id.slice(9)}-${String(i + 1).padStart(3, "0")}`;
    const runId = `run-demo-${vac.vacancy_id.slice(9)}-${String(i + 1).padStart(3, "0")}`;

    // Determine run status from archetype
    const isTerminal = archetype?.terminal ?? false;
    const wentDark = archetypeId === "went_dark";
    const runStatus = wentDark ? "active" : (isTerminal ? "rejected" : "active");
    const activeStepId = runStatus === "active" ? "screening_intro" : null;

    // Upsert candidate
    await sql`
      INSERT INTO chatbot.candidates (candidate_id, display_name, resume_text)
      VALUES (${candidateId}, ${name}, ${"Кандидат из demo seed. Архетип: " + archetypeId})
      ON CONFLICT (candidate_id) DO NOTHING
    `;

    // Upsert conversation
    await sql`
      INSERT INTO chatbot.conversations (conversation_id, job_id, candidate_id, channel, channel_thread_id, status)
      VALUES (${conversationId}, ${vac.job_id}, ${candidateId}, 'demo', ${conversationId}, 'open')
      ON CONFLICT (conversation_id) DO NOTHING
    `;

    // Upsert pipeline run
    await sql`
      INSERT INTO chatbot.pipeline_runs (pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status)
      VALUES (${runId}, ${vac.job_id}, ${candidateId}, ${tplId}, 1, ${activeStepId}, ${runStatus})
      ON CONFLICT (pipeline_run_id) DO NOTHING
    `;

    // Seed step state
    for (let si = 0; si < tplSteps.length; si++) {
      const step = tplSteps[si];
      const stepState = si === 0 && runStatus === "active" ? "active" : (runStatus === "rejected" && si === 0 ? "rejected" : "pending");
      await sql`
        INSERT INTO chatbot.pipeline_step_state (pipeline_run_id, step_id, step_index, state, awaiting_reply)
        VALUES (${runId}, ${step.id}, ${step.step_index}, ${stepState}, ${stepState === "active"})
        ON CONFLICT (pipeline_run_id, step_id) DO NOTHING
      `;
    }

    // Seed initial inbound message (application)
    if (!wentDark) {
      const appMessage = generateApplicationMessage(archetypeId, vacancyClass);
      const msgId = randomUUID();
      const msgTime = new Date(Date.now() - randInt(30, 1440) * 60 * 1000).toISOString();
      await sql`
        INSERT INTO chatbot.messages (message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at)
        VALUES (${msgId}, ${conversationId}, ${candidateId}, 'inbound', 'text', ${appMessage}, 'demo', ${msgId}, ${msgTime})
        ON CONFLICT DO NOTHING
      `;
    }

    // Seed planned messages for active non-terminal candidates (populates moderation queue)
    if (runStatus === "active" && !wentDark && !isTerminal && i < 3) {
      const delayMs = resolveModerationDelayMs(vac.moderation_settings);
      const sendAfter = new Date(Date.now() + delayMs).toISOString();
      const plannedMsgId = randomUUID();
      const idempotencyKey = `${runId}:screening_intro:seed-${i}`;
      const body = `Здравствуйте, ${name.split(" ")[0]}! Спасибо за отклик. Расскажите об опыте по данной позиции?`;
      await sql`
        INSERT INTO chatbot.planned_messages
          (planned_message_id, conversation_id, candidate_id, pipeline_run_id, step_id,
           body, reason, review_status, moderation_policy, send_after, auto_send_after, idempotency_key)
        VALUES (
          ${plannedMsgId}, ${conversationId}, ${candidateId}, ${runId}, 'screening_intro',
          ${body}, 'demo_seed_initial_greeting', 'pending', 'window_to_reject',
          ${sendAfter}, ${sendAfter}, ${idempotencyKey}
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
      totalPending++;
    }

    totalCandidates++;
  }
}

console.log(`\nDemo seed complete:`);
console.log(`  vacancies: ${demoVacancies.length} (${activeVacancies.length} active, ${demoVacancies.length - activeVacancies.length} draft)`);
console.log(`  candidates: ${totalCandidates}`);
console.log(`  pending moderation items: ${totalPending}`);
