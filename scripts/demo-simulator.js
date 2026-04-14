#!/usr/bin/env node
/**
 * demo-simulator.js — background simulator that keeps the demo world alive.
 *
 * Maintains invariants:
 *   - >= DEMO_GLOBAL_QUEUE_TARGET pending moderation items globally
 *   - >= DEMO_QUEUE_TARGET_PER_VACANCY pending items per active demo vacancy
 *   - Recent activity: at least 1 new inbound message in the last 30 min
 *
 * Usage:
 *   CHATBOT_DATABASE_URL=... node scripts/demo-simulator.js --tick   # single tick (CI/cron)
 *   CHATBOT_DATABASE_URL=... node scripts/demo-simulator.js          # long-running loop
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

const TICK_SECONDS = Number(process.env.DEMO_SIMULATOR_TICK_SECONDS ?? "30");
const GLOBAL_QUEUE_TARGET = Number(process.env.DEMO_GLOBAL_QUEUE_TARGET ?? "6");
const QUEUE_TARGET_PER_VACANCY = Number(process.env.DEMO_QUEUE_TARGET_PER_VACANCY ?? "2");
const MAX_PENDING_PER_VACANCY = Number(process.env.DEMO_MAX_PENDING_PER_VACANCY ?? "4");
const TARGET_ACTIVE_CANDIDATES = Number(process.env.DEMO_TARGET_ACTIVE_CANDIDATES_PER_JOB ?? "30");
const RECENT_ACTIVITY_WINDOW_MIN = 30;

const isSingleTick = process.argv.includes("--tick");

const vacanciesPath = join(__dirname, "../tests/fixtures/demo-vacancies.json");
const archetypesPath = join(__dirname, "../data/demo-simulator/candidate-archetypes.json");
const templatesPath = join(__dirname, "../data/demo-simulator/dialog-templates.json");

const demoVacancies = JSON.parse(await readFile(vacanciesPath, "utf8"));
const archetypesData = JSON.parse(await readFile(archetypesPath, "utf8"));
const templates = JSON.parse(await readFile(templatesPath, "utf8"));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function fillTemplate(text, vars) {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

function pickArchetype(vacancyId) {
  const whitCollarIds = ["vac-demo-sales-skolkovo", "vac-demo-china-procurement"];
  const vacancyClass = whitCollarIds.includes(vacancyId) ? "white_collar" : "blue_collar";
  const weights = archetypesData.vacancy_weights[vacancyClass];
  const roll = Math.random();
  let cumulative = 0;
  for (const [id, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (roll <= cumulative) return id;
  }
  return Object.keys(weights)[0];
}

function generateName() {
  const all = [...templates.names.male, ...templates.names.female];
  return pick(all);
}

function generateApplicationMessage(archetypeId) {
  const msgs = templates.initial_application_messages[archetypeId]
    ?? templates.initial_application_messages.medium_needs_clarification;
  const raw = pick(msgs);
  return fillTemplate(raw, {
    experience_years: randInt(1, 7),
    expected_salary: (Math.floor(randInt(80, 150) / 10) * 10) + "000",
    mid_salary: (Math.floor(randInt(70, 100) / 10) * 10) + "000",
    company_type: "складе"
  });
}

// ─── State queries ────────────────────────────────────────────────────────────

async function countPendingForVacancy(vacancyId, jobId) {
  const rows = await sql`
    SELECT COUNT(*) AS cnt
    FROM chatbot.planned_messages pm
    JOIN chatbot.pipeline_runs pr ON pr.pipeline_run_id = pm.pipeline_run_id
    WHERE pm.review_status = 'pending'
      AND pr.job_id = ${jobId}
  `;
  return Number(rows[0]?.cnt ?? 0);
}

async function countGlobalPending() {
  // Only count pending items for demo jobs
  const demoJobIds = demoVacancies.filter(v => v.status === "active").map(v => v.job_id);
  const rows = await sql`
    SELECT COUNT(*) AS cnt
    FROM chatbot.planned_messages pm
    JOIN chatbot.pipeline_runs pr ON pr.pipeline_run_id = pm.pipeline_run_id
    WHERE pm.review_status = 'pending'
      AND pr.job_id = ANY(${demoJobIds})
  `;
  return Number(rows[0]?.cnt ?? 0);
}

async function countActiveCandidates(jobId) {
  const rows = await sql`
    SELECT COUNT(*) AS cnt
    FROM chatbot.pipeline_runs
    WHERE job_id = ${jobId} AND status = 'active'
  `;
  return Number(rows[0]?.cnt ?? 0);
}

async function hasRecentActivity(jobId) {
  const since = new Date(Date.now() - RECENT_ACTIVITY_WINDOW_MIN * 60 * 1000).toISOString();
  const rows = await sql`
    SELECT COUNT(*) AS cnt
    FROM chatbot.messages m
    JOIN chatbot.conversations c ON c.conversation_id = m.conversation_id
    WHERE c.job_id = ${jobId}
      AND m.direction = 'inbound'
      AND m.received_at > ${since}
  `;
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function pickActiveCandidateForQueue(jobId) {
  // Find an active conversation that has an open pipeline run but no pending planned message
  const rows = await sql`
    SELECT pr.pipeline_run_id, pr.candidate_id, pr.active_step_id,
           c.conversation_id
    FROM chatbot.pipeline_runs pr
    JOIN chatbot.conversations c ON c.candidate_id = pr.candidate_id AND c.job_id = pr.job_id
    WHERE pr.job_id = ${jobId}
      AND pr.status = 'active'
      AND pr.active_step_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM chatbot.planned_messages pm
        WHERE pm.pipeline_run_id = pr.pipeline_run_id
          AND pm.review_status = 'pending'
      )
    ORDER BY RANDOM()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function spawnCandidate(vac) {
  const archetypeId = pickArchetype(vac.vacancy_id);
  const name = generateName();
  const candidateId = `cand-sim-${randomUUID().slice(0, 8)}`;
  const conversationId = `conv-sim-${randomUUID().slice(0, 8)}`;
  const runId = `run-sim-${randomUUID().slice(0, 8)}`;
  const tplId = `tpl-demo-${vac.vacancy_id.replace("vac-demo-", "")}`;

  await sql`
    INSERT INTO chatbot.candidates (candidate_id, display_name, resume_text)
    VALUES (${candidateId}, ${name}, ${"Симулятор. Архетип: " + archetypeId})
    ON CONFLICT (candidate_id) DO NOTHING
  `;

  await sql`
    INSERT INTO chatbot.conversations (conversation_id, job_id, candidate_id, channel, channel_thread_id, status)
    VALUES (${conversationId}, ${vac.job_id}, ${candidateId}, 'demo', ${conversationId}, 'open')
    ON CONFLICT (conversation_id) DO NOTHING
  `;

  await sql`
    INSERT INTO chatbot.pipeline_runs (pipeline_run_id, job_id, candidate_id, template_id, template_version, active_step_id, status)
    VALUES (${runId}, ${vac.job_id}, ${candidateId}, ${tplId}, 1, 'screening_intro', 'active')
    ON CONFLICT (pipeline_run_id) DO NOTHING
  `;

  for (const [idx, stepId] of ["screening_intro", "screening_conditions", "target_action"].entries()) {
    await sql`
      INSERT INTO chatbot.pipeline_step_state (pipeline_run_id, step_id, step_index, state, awaiting_reply)
      VALUES (${runId}, ${stepId}, ${idx + 1}, ${idx === 0 ? "active" : "pending"}, ${idx === 0})
      ON CONFLICT (pipeline_run_id, step_id) DO NOTHING
    `;
  }

  // Add initial inbound message
  const appMessage = generateApplicationMessage(archetypeId);
  const msgId = randomUUID();
  await sql`
    INSERT INTO chatbot.messages (message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at)
    VALUES (${msgId}, ${conversationId}, ${candidateId}, 'inbound', 'text', ${appMessage}, 'demo', ${msgId}, now())
    ON CONFLICT DO NOTHING
  `;

  console.log(`  [spawn] ${name} (${archetypeId}) → job ${vac.job_id}`);
  return { candidateId, conversationId, runId, archetypeId, name };
}

async function injectInboundMessage(jobId) {
  // Find a random active conversation for this job
  const rows = await sql`
    SELECT c.conversation_id, c.candidate_id, cd.display_name
    FROM chatbot.conversations c
    JOIN chatbot.candidates cd ON cd.candidate_id = c.candidate_id
    JOIN chatbot.pipeline_runs pr ON pr.candidate_id = c.candidate_id AND pr.job_id = c.job_id
    WHERE c.job_id = ${jobId}
      AND pr.status = 'active'
    ORDER BY RANDOM()
    LIMIT 1
  `;
  if (!rows.length) return false;

  const { conversation_id, candidate_id } = rows[0];
  const body = pick([
    "Добрый день, у меня есть вопрос по вакансии.",
    "Здравствуйте, я ещё рассматриваю ваше предложение.",
    "Хорошо, расскажу подробнее о своём опыте.",
    "Когда можно подойти на собеседование?",
    "Можно уточнить детали по зарплате?",
    "Я ознакомился с условиями — всё устраивает.",
    "Медкнижку готов оформить — сколько времени это займёт у вас?",
    "График подходит. Когда можно выйти на работу?"
  ]);
  const msgId = randomUUID();
  await sql`
    INSERT INTO chatbot.messages (message_id, conversation_id, candidate_id, direction, message_type, body, channel, channel_message_id, occurred_at)
    VALUES (${msgId}, ${conversation_id}, ${candidate_id}, 'inbound', 'text', ${body}, 'demo', ${msgId}, now())
    ON CONFLICT DO NOTHING
  `;
  console.log(`  [inbound] conversation ${conversation_id}: "${body.slice(0, 60)}..."`);
  return true;
}

async function replenishQueue(vac, needed) {
  let added = 0;
  for (let attempt = 0; attempt < needed * 3 && added < needed; attempt++) {
    const candidate = await pickActiveCandidateForQueue(vac.job_id);
    if (!candidate) break;

    const delayMs = resolveModerationDelayMs(vac.moderation_settings);
    const sendAfter = new Date(Date.now() + delayMs).toISOString();
    const plannedMsgId = randomUUID();
    const idempotencyKey = `${candidate.pipeline_run_id}:${candidate.active_step_id}:sim-${Date.now()}`;
    const firstName = (await sql`SELECT display_name FROM chatbot.candidates WHERE candidate_id = ${candidate.candidate_id}`)[0]?.display_name?.split(" ")[0] ?? "кандидат";

    const body = pick([
      `Здравствуйте, ${firstName}! Расскажите подробнее о вашем опыте?`,
      `${firstName}, добрый день! Уточните, пожалуйста, ваши зарплатные ожидания.`,
      `Здравствуйте, ${firstName}! Подходит ли вам предложенный график работы?`,
      `${firstName}, спасибо за отклик! Когда вы могли бы выйти на работу?`,
      `Добрый день, ${firstName}! Есть ли у вас необходимые документы (паспорт, СНИЛС)?`
    ]);

    try {
      await sql`
        INSERT INTO chatbot.planned_messages
          (planned_message_id, conversation_id, candidate_id, pipeline_run_id, step_id,
           body, reason, review_status, moderation_policy, send_after, auto_send_after, idempotency_key)
        VALUES (
          ${plannedMsgId}, ${candidate.conversation_id}, ${candidate.candidate_id},
          ${candidate.pipeline_run_id}, ${candidate.active_step_id ?? "screening_intro"},
          ${body}, 'simulator_queue_replenishment', 'pending', 'window_to_reject',
          ${sendAfter}, ${sendAfter}, ${idempotencyKey}
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
      console.log(`  [queue+] ${vac.vacancy_id}: planned message for run ${candidate.pipeline_run_id}`);
      added++;
    } catch (err) {
      // idempotency conflict or missing unique index — skip
    }
  }
  return added;
}

// ─── Tick ────────────────────────────────────────────────────────────────────

async function tick() {
  const tickStart = Date.now();
  console.log(`\n[tick] ${new Date().toISOString()}`);

  const activeVacancies = demoVacancies.filter(
    v => v.status === "active" && v.moderation_settings?.simulator_enabled !== false
  );

  let globalPending = await countGlobalPending();
  console.log(`  global pending: ${globalPending} / target ${GLOBAL_QUEUE_TARGET}`);

  for (const vac of activeVacancies) {
    // 1. Ensure candidate population
    const activeCandidates = await countActiveCandidates(vac.job_id);
    if (activeCandidates < TARGET_ACTIVE_CANDIDATES) {
      const toSpawn = Math.min(2, TARGET_ACTIVE_CANDIDATES - activeCandidates);
      for (let i = 0; i < toSpawn; i++) {
        await spawnCandidate(vac);
      }
    }

    // 2. Ensure recent activity
    const hasActivity = await hasRecentActivity(vac.job_id);
    if (!hasActivity) {
      await injectInboundMessage(vac.job_id);
    }

    // 3. Ensure pending queue per vacancy
    const pendingCount = await countPendingForVacancy(vac.vacancy_id, vac.job_id);
    if (pendingCount < QUEUE_TARGET_PER_VACANCY && pendingCount < MAX_PENDING_PER_VACANCY) {
      const needed = Math.min(QUEUE_TARGET_PER_VACANCY - pendingCount, MAX_PENDING_PER_VACANCY - pendingCount);
      const added = await replenishQueue(vac, needed);
      globalPending += added;
    }
  }

  // 4. Global queue top-up
  if (globalPending < GLOBAL_QUEUE_TARGET) {
    const topUpVac = pick(activeVacancies);
    if (topUpVac) {
      const pendingCount = await countPendingForVacancy(topUpVac.vacancy_id, topUpVac.job_id);
      if (pendingCount < MAX_PENDING_PER_VACANCY) {
        await replenishQueue(topUpVac, 1);
      }
    }
  }

  const elapsed = Date.now() - tickStart;
  console.log(`[tick done] ${elapsed}ms`);
}

// ─── Main loop ────────────────────────────────────────────────────────────────

if (isSingleTick) {
  await tick();
  process.exit(0);
} else {
  console.log(`Demo simulator started (tick every ${TICK_SECONDS}s)`);
  await tick();
  setInterval(tick, TICK_SECONDS * 1000);
}
