#!/usr/bin/env node

import postgres from "postgres";
import { parseReadinessArgs } from "./lib/management-readiness.js";

const args = parseReadinessArgs(process.argv.slice(2));

if (args.help || args._[0] === "help") {
  printHelp();
  process.exit(0);
}

const managementDatabaseUrl = process.env.MANAGEMENT_DATABASE_URL;
const recruiterEmail = readString(args["recruiter-email"]);
const tenantId = readString(args["tenant-id"]);
const appEnv = readString(args["app-env"]) ?? process.env.APP_ENV ?? null;
const vacancyId = readString(args["vacancy-id"]);
const dryRun = args["dry-run"] === true;

if (!managementDatabaseUrl) {
  console.error("ERROR: MANAGEMENT_DATABASE_URL environment variable is required");
  process.exit(1);
}

if (!appEnv) {
  console.error("ERROR: --app-env or APP_ENV is required");
  process.exit(1);
}

if (!recruiterEmail && !tenantId) {
  console.error("ERROR: provide --recruiter-email or --tenant-id");
  process.exit(1);
}

const managementSql = postgres(managementDatabaseUrl, { max: 1 });

try {
  const binding = await resolveBinding({ managementSql, recruiterEmail, tenantId, appEnv });
  if (!binding) {
    console.error("ERROR: tenant binding was not found");
    process.exit(1);
  }

  const tenantSql = postgres(binding.connection_string, { max: 1 });
  try {
    const vacancyRows = vacancyId
      ? await tenantSql`
        SELECT vacancy_id, communication_plan, communication_plan_draft, communication_examples, communication_examples_plan_hash
        FROM chatbot.vacancies
        WHERE vacancy_id = ${vacancyId}
        LIMIT 1
      `
      : await tenantSql`
        SELECT vacancy_id, communication_plan, communication_plan_draft, communication_examples, communication_examples_plan_hash
        FROM chatbot.vacancies
        WHERE communication_plan IS NOT NULL
           OR communication_plan_draft IS NOT NULL
           OR communication_examples_plan_hash IS NOT NULL
        ORDER BY updated_at DESC, created_at DESC
      `;

    const changes = [];
    for (const row of vacancyRows) {
      const nextState = normalizeCommunicationState(row);
      if (!needsUpdate(row, nextState)) continue;
      changes.push({
        vacancy_id: row.vacancy_id,
        nextState
      });
    }

    if (!dryRun) {
      for (const item of changes) {
        await tenantSql`
          UPDATE chatbot.vacancies
          SET
            communication_plan = ${item.nextState.communication_plan ? tenantSql.json(item.nextState.communication_plan) : null}::jsonb,
            communication_plan_draft = ${item.nextState.communication_plan_draft ? tenantSql.json(item.nextState.communication_plan_draft) : null}::jsonb,
            communication_examples = ${tenantSql.json(item.nextState.communication_examples)}::jsonb,
            communication_examples_plan_hash = ${item.nextState.communication_examples_plan_hash},
            updated_at = now()
          WHERE vacancy_id = ${item.vacancy_id}
        `;
      }
    }

    console.log(JSON.stringify({
      ok: true,
      app_env: appEnv,
      tenant_id: binding.tenant_id,
      recruiter_email: recruiterEmail ?? null,
      vacancy_id: vacancyId ?? null,
      dry_run: dryRun,
      scanned: vacancyRows.length,
      repaired: changes.length,
      repaired_vacancy_ids: changes.map((item) => item.vacancy_id)
    }, null, 2));
  } finally {
    await tenantSql.end({ timeout: 5 });
  }
} finally {
  await managementSql.end({ timeout: 5 });
}

async function resolveBinding({ managementSql, recruiterEmail, tenantId, appEnv }) {
  if (tenantId) {
    const rows = await managementSql`
      SELECT b.tenant_id, b.db_alias, dc.connection_string
      FROM management.tenant_database_bindings b
      JOIN management.database_connections dc ON dc.db_alias = b.db_alias
      WHERE b.tenant_id = ${tenantId}
        AND b.environment = ${appEnv}
        AND b.is_primary = true
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  const rows = await managementSql`
    SELECT r.tenant_id, b.db_alias, dc.connection_string
    FROM management.recruiters r
    JOIN management.tenant_database_bindings b
      ON b.tenant_id = r.tenant_id
     AND b.environment = ${appEnv}
     AND b.is_primary = true
    JOIN management.database_connections dc ON dc.db_alias = b.db_alias
    WHERE r.email = ${recruiterEmail}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function normalizeCommunicationState(row) {
  const communicationPlan = normalizePlan(row.communication_plan);
  const communicationPlanDraft = normalizePlan(row.communication_plan_draft);
  const communicationExamples = Array.isArray(row.communication_examples) ? row.communication_examples : [];
  const communicationExamplesPlanHash = (
    typeof row.communication_examples_plan_hash === "string"
    && row.communication_examples_plan_hash.trim().length > 0
    && communicationExamples.length > 0
  )
    ? row.communication_examples_plan_hash.trim()
    : null;

  return {
    communication_plan: communicationPlan,
    communication_plan_draft: communicationPlanDraft,
    communication_examples: communicationExamples,
    communication_examples_plan_hash: communicationExamplesPlanHash
  };
}

function normalizePlan(rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) return null;
  const rows = Array.isArray(rawPlan.steps) ? rawPlan.steps : [];
  if (rows.length < 4 || rows.length > 7) return null;

  const steps = rows
    .map((row) => {
      const step = cleanText(row?.step, "");
      if (step) {
        const remindersRaw = Number(
          row?.reminders_count ?? row?.reminders ?? row?.reminder_count ?? 0
        );
        if (!Number.isFinite(remindersRaw)) return null;
        const remindersCount = Math.round(remindersRaw);
        if (remindersCount < 0 || remindersCount > 3) return null;

        return {
          step,
          reminders_count: remindersCount,
          comment: cleanText(row?.comment, "—")
        };
      }

      const legacyGoal = cleanText(row?.goal, "");
      const legacyMessage = cleanText(row?.message ?? row?.text, "");
      if (!legacyGoal && !legacyMessage) return null;

      return {
        step: legacyGoal || legacyMessage,
        reminders_count: 0,
        comment: legacyMessage || "—"
      };
    })
    .filter(Boolean);

  if (steps.length !== rows.length) return null;

  return {
    scenario_title: cleanText(rawPlan.scenario_title, "Рабочий сценарий коммуникации"),
    goal: cleanText(rawPlan.goal, "Договоренность о следующем шаге"),
    steps
  };
}

function cleanText(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : fallback;
}

function needsUpdate(row, nextState) {
  return (
    serializeJson(row.communication_plan) !== serializeJson(nextState.communication_plan)
    || serializeJson(row.communication_plan_draft) !== serializeJson(nextState.communication_plan_draft)
    || serializeJson(row.communication_examples) !== serializeJson(nextState.communication_examples)
    || String(row.communication_examples_plan_hash ?? "") !== String(nextState.communication_examples_plan_hash ?? "")
  );
}

function serializeJson(value) {
  return JSON.stringify(value ?? null);
}

function readString(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function printHelp() {
  console.log(`Usage:
  MANAGEMENT_DATABASE_URL=... node scripts/repair-vacancy-communication-state.js \\
    --app-env prod \\
    (--recruiter-email EMAIL | --tenant-id TENANT_ID) \\
    [--vacancy-id VACANCY_ID] \\
    [--dry-run]

Repairs legacy communication_plan / communication_plan_draft shapes and normalizes
communication_examples state in the resolved tenant DB.
`);
}
