#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const currentDate = new Date().toISOString().slice(0, 10);
const sessionId = "c3835db7-34bc-46a3-93a1-e64f06f0d4a3";
const targetJobIds = [4, 9, 26];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

function getLegacyDbUrl() {
  loadEnvFile(path.resolve(repoRoot, "../recruiting-agent/.env"));
  return process.env.LEGACY_ROUTING_DB_URL
    || process.env.RECRUITER_QUERY_DB_URL
    || process.env.NEON_DATABASE_URL
    || null;
}

function truncate(value, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function normalizeMultiline(value) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .join("\n");
}

function parsePipelineGoals(pipelineTemplate) {
  const text = normalizeMultiline(pipelineTemplate);
  const parts = text.split(/^## /m).map((part) => part.trim()).filter(Boolean);
  return parts.map((part) => {
    const [header, ...rest] = part.split("\n");
    const bullets = rest
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => line.replace(/^-+\s*/, "").trim());
    return { header, bullets };
  });
}

function classifyCandidate(candidate) {
  const status = String(candidate.status ?? "");
  const summary = String(candidate.candidate_summary ?? "");
  const resumeScore = Number(candidate.must_haves_from_resume ?? 0);
  const hasPositiveSummarySignal = /confirmed|подтвержден|✅/i.test(summary);
  const hasNegativeSummarySignal = /❌|не подходит|no match/i.test(summary);
  const advancedStatuses = new Set([
    "SCREENING_DONE",
    "INTERVIEW_OFFERED",
    "AI_INTERVIEW_SENT",
    "INTERVIEW_PASSED",
    "HOMEWORK_SENT",
    "HOMEWORK_SUBMITTED",
    "PRESENTING_TO_CLIENT"
  ]);

  if (resumeScore <= 0 && hasPositiveSummarySignal) return "hidden_from_resume";
  if (/NO_RESPONSE|went_dark/i.test(status)) return "weak_or_risky";
  if (hasNegativeSummarySignal) return "weak_or_risky";
  if (resumeScore >= 1 && advancedStatuses.has(status)) return "strong";
  if (resumeScore >= 1) return "strong";
  return "medium";
}

function chooseEvaluationCandidates(candidates) {
  const byBucket = new Map();
  for (const candidate of candidates) {
    const bucket = classifyCandidate(candidate);
    candidate.bucket = bucket;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(candidate);
  }

  const plan = [
    ["strong", 2],
    ["medium", 2],
    ["hidden_from_resume", 1],
    ["weak_or_risky", 1]
  ];

  const chosen = [];
  const chosenIds = new Set();

  for (const [bucket, count] of plan) {
    const pool = byBucket.get(bucket) ?? [];
    for (const candidate of pool.slice(0, count)) {
      chosen.push(candidate);
      chosenIds.add(candidate.id);
    }
  }

  for (const candidate of candidates) {
    if (chosen.length >= 6) break;
    if (chosenIds.has(candidate.id)) continue;
    chosen.push(candidate);
    chosenIds.add(candidate.id);
  }

  return chosen.slice(0, 6);
}

async function fetchSessionCompare() {
  const url = `http://localhost:3000/api/sessions/${sessionId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    return {
      session_id: data.session_id,
      project_path: data.project_path,
      messages_total: data.messages_total,
      first_user: data.messages?.find((m) => m.type === "user")?.content ?? null,
      first_assistant_text: extractAssistantText(
        data.messages?.find((m) => m.type === "assistant")?.content
      )
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function extractAssistantText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (part?.type === "text" && part.text) return part.text;
    if (part?.type === "thinking" && part.thinking) return truncate(part.thinking, 400);
  }
  return null;
}

async function main() {
  const connectionString = getLegacyDbUrl();
  if (!connectionString) {
    throw new Error("Legacy routing DB URL not found. Set LEGACY_ROUTING_DB_URL or RECRUITER_QUERY_DB_URL.");
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const jobsRes = await pool.query(`
      SELECT
        j.id,
        j.slug,
        j.title,
        j.created_at,
        js.interviewer_name,
        js.interview_language,
        js.practical_q,
        js.practical_f1,
        js.practical_f2,
        js.theory_q1,
        js.theory_f1,
        js.theory_q2,
        js.theory_f2,
        js.closing_type,
        js.screening_enabled,
        js.hh_sync_enabled,
        js.follow_up_persistence,
        js.must_have_prompt,
        js.pipeline_template,
        js.hh_greeting
      FROM routing.jobs j
      LEFT JOIN routing.job_settings js ON js.job_id = j.id
      WHERE j.id = ANY($1::int[])
      ORDER BY j.id
    `, [targetJobIds]);

    const candidatesRes = await pool.query(`
      SELECT
        c.job_id,
        c.id,
        c.name,
        c.status,
        c.source,
        c.must_haves_from_resume,
        c.candidate_summary,
        c.resume_text,
        c.updated_at
      FROM routing.candidates c
      WHERE c.job_id = ANY($1::int[])
        AND c.status NOT IN ('ARCHIVED', 'REJECTED', 'DUPLICATE')
      ORDER BY c.job_id, COALESCE(c.must_haves_from_resume, 0) DESC, c.updated_at DESC, c.id DESC
    `, [targetJobIds]);

    const selectedCandidates = [];
    for (const jobId of targetJobIds) {
      const jobCandidates = candidatesRes.rows.filter((row) => row.job_id === jobId);
      selectedCandidates.push(...chooseEvaluationCandidates(jobCandidates));
    }

    const candidateIds = selectedCandidates.map((row) => row.id);
    const messageStatsRes = candidateIds.length > 0
      ? await pool.query(`
          SELECT
            m.candidate_id,
            COUNT(*) AS messages_count,
            MIN(m.created_at) AS first_message_at,
            MAX(m.created_at) AS last_message_at
          FROM routing.messages m
          WHERE m.candidate_id = ANY($1::int[])
            AND COALESCE(m.hidden, 0) = 0
          GROUP BY m.candidate_id
        `, [candidateIds])
      : { rows: [] };

    const dialogExamplesRes = candidateIds.length > 0
      ? await pool.query(`
          WITH ranked AS (
            SELECT
              c.job_id,
              c.id AS candidate_id,
              c.name,
              m.direction,
              m.body,
              m.created_at,
              ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY m.created_at ASC) AS rn
            FROM routing.candidates c
            JOIN routing.messages m ON m.candidate_id = c.id
            WHERE c.id = ANY($1::int[])
              AND COALESCE(m.hidden, 0) = 0
          )
          SELECT * FROM ranked WHERE rn <= 4 ORDER BY job_id, candidate_id, rn
        `, [candidateIds])
      : { rows: [] };

    const sessionCompare = await fetchSessionCompare();
    const jobById = new Map(jobsRes.rows.map((row) => [row.id, row]));
    const messageStatsByCandidate = new Map(messageStatsRes.rows.map((row) => [row.candidate_id, row]));

    const reportLines = [];
    reportLines.push(`# Legacy Pipeline Baseline`);
    reportLines.push("");
    reportLines.push(`Date: ${currentDate}`);
    reportLines.push("");
    reportLines.push(`Source DB: legacy routing schema from sibling \`recruiting-agent\``);
    reportLines.push(`Compared session: \`${sessionId}\``);
    reportLines.push("");
    reportLines.push(`## Scope`);
    reportLines.push("");
    reportLines.push(`Chosen legacy vacancies with real pipeline settings:`);
    for (const job of jobsRes.rows) {
      reportLines.push(`- job_id=${job.id}, slug=\`${job.slug}\`, title=${job.title}`);
    }
    reportLines.push("");

    reportLines.push(`## Session Compare`);
    reportLines.push("");
    if (sessionCompare.error) {
      reportLines.push(`Could not load session compare data: ${sessionCompare.error}`);
    } else {
      reportLines.push(`- project_path: \`${sessionCompare.project_path}\``);
      reportLines.push(`- messages_total: ${sessionCompare.messages_total}`);
      reportLines.push(`- first user prompt: ${truncate(sessionCompare.first_user, 280)}`);
      if (sessionCompare.first_assistant_text) {
        reportLines.push(`- first assistant content: ${truncate(sessionCompare.first_assistant_text, 280)}`);
      }
    }
    reportLines.push("");

    for (const jobId of targetJobIds) {
      const job = jobById.get(jobId);
      if (!job) continue;

      reportLines.push(`## Job ${job.id}: ${job.title}`);
      reportLines.push("");
      reportLines.push(`- slug: \`${job.slug}\``);
      reportLines.push(`- interview_language: ${job.interview_language ?? "n/a"}`);
      reportLines.push(`- interviewer_name: ${job.interviewer_name ?? "n/a"}`);
      reportLines.push(`- closing_type: ${job.closing_type ?? "n/a"}`);
      reportLines.push(`- screening_enabled: ${job.screening_enabled ?? "n/a"}`);
      reportLines.push(`- hh_sync_enabled: ${job.hh_sync_enabled ?? "n/a"}`);
      reportLines.push(`- follow_up_persistence: ${job.follow_up_persistence ?? "n/a"}`);
      reportLines.push("");
      reportLines.push(`### Interview Prompts`);
      reportLines.push("");
      reportLines.push(`- practical_q: ${truncate(job.practical_q, 260)}`);
      if (job.practical_f1) reportLines.push(`- practical_f1: ${truncate(job.practical_f1, 220)}`);
      if (job.practical_f2) reportLines.push(`- practical_f2: ${truncate(job.practical_f2, 220)}`);
      reportLines.push(`- theory_q1: ${truncate(job.theory_q1, 260)}`);
      if (job.theory_f1) reportLines.push(`- theory_f1: ${truncate(job.theory_f1, 220)}`);
      if (job.theory_q2) reportLines.push(`- theory_q2: ${truncate(job.theory_q2, 260)}`);
      if (job.theory_f2) reportLines.push(`- theory_f2: ${truncate(job.theory_f2, 220)}`);
      reportLines.push("");
      if (job.must_have_prompt) {
        reportLines.push(`### Must-Haves`);
        reportLines.push("");
        reportLines.push("```text");
        reportLines.push(truncate(normalizeMultiline(job.must_have_prompt), 900));
        reportLines.push("```");
        reportLines.push("");
      }

      reportLines.push(`### Parsed Pipeline Goals`);
      reportLines.push("");
      const goals = parsePipelineGoals(job.pipeline_template);
      for (const goal of goals) {
        reportLines.push(`- ${goal.header}`);
        for (const bullet of goal.bullets.slice(0, 6)) {
          reportLines.push(`  - ${truncate(bullet, 220)}`);
        }
      }
      reportLines.push("");

      reportLines.push(`### Candidate Sample`);
      reportLines.push("");
      const sampleCandidates = selectedCandidates.filter((row) => row.job_id === jobId);
      for (const candidate of sampleCandidates) {
        const stats = messageStatsByCandidate.get(candidate.id);
        reportLines.push(`- ${candidate.name} [${candidate.status}] bucket=${candidate.bucket} must_haves_from_resume=${candidate.must_haves_from_resume ?? "n/a"} messages=${stats?.messages_count ?? 0}`);
        reportLines.push(`  - summary: ${truncate(candidate.candidate_summary, 220)}`);
        reportLines.push(`  - resume: ${truncate(candidate.resume_text, 260)}`);
      }
      reportLines.push("");

      reportLines.push(`### Dialog Examples`);
      reportLines.push("");
      const examples = dialogExamplesRes.rows
        .filter((row) => row.job_id === jobId)
        .slice(0, 8);
      for (const row of examples) {
        reportLines.push(`- [${row.name}] ${row.direction}: ${truncate(row.body, 220)}`);
      }
      reportLines.push("");
    }

    reportLines.push(`## Initial Translation Notes`);
    reportLines.push("");
    reportLines.push(`- job 26 is much simpler than the other two: it is a 3-step screening-and-handoff flow, not a long exploratory interview.`);
    reportLines.push(`- job 9 and job 4 are closer to the current goals-pipeline model: they contain explicit staged goals, pending bullets and homework transition.`);
    reportLines.push(`- the old system mixes three layers in one template: greeting copy, screening logic, and operational handoff. In V2 these should be separated into pipeline steps, FAQ/context, and sending policy.`);
    reportLines.push(`- for realistic replay, top candidates already exist in legacy DB and can be reused as evaluation fixtures instead of inventing synthetic resumes.`);
    reportLines.push("");

    const reportPath = path.join(repoRoot, "docs", "reports", `${currentDate}-legacy-pipeline-baseline.md`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");
    console.log(reportPath);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
