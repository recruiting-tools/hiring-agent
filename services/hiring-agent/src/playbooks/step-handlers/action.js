import { randomUUID } from "node:crypto";

export async function handleActionStep({ step, context, tenantSql }) {
  if (!tenantSql) {
    throw new Error("tenantSql is required for action steps");
  }

  const config = parseActionConfig(step.notes);

  switch (config.action) {
    case "reject_candidate":
      return executeRejectCandidate({ context, tenantSql, step });
    case "schedule_reminder":
      return executeScheduleReminder({ context, tenantSql, step });
    case "edit_vacancy_field":
      return executeEditVacancyField({ context, tenantSql, step });
    case "pause_vacancy":
      return executePauseVacancy({ context, tenantSql, step });
    default:
      throw new Error(`Unsupported action step: ${config.action ?? "unknown"}`);
  }
}

function parseActionConfig(notes) {
  if (!notes) {
    throw new Error("Action step notes JSON is required");
  }

  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {}

  throw new Error("Action step notes must be valid JSON object");
}

async function executeRejectCandidate({ context, tenantSql, step }) {
  const target = await resolveCandidateTarget({ context, tenantSql });
  const rejectionReason = String(context.rejection_reason ?? "").trim() || "Отказ вручную из recruiter playbook";

  if (target.status === "rejected") {
    return complete(step, context, [
      "Кандидат уже был переведён в rejected ранее.",
      `candidate_id: ${target.candidate_id}`,
      `pipeline_run_id: ${target.pipeline_run_id}`
    ].join("\n"));
  }

  const activeStepId = target.active_step_id ?? null;

  await tenantSql`
    UPDATE chatbot.pipeline_step_state
    SET awaiting_reply = false,
        updated_at = now()
    WHERE pipeline_run_id = ${target.pipeline_run_id}
      AND state = 'active'
  `;

  if (activeStepId) {
    await tenantSql`
      UPDATE chatbot.pipeline_step_state
      SET state = 'rejected',
          awaiting_reply = false,
          last_reason = ${rejectionReason},
          updated_at = now()
      WHERE pipeline_run_id = ${target.pipeline_run_id}
        AND step_id = ${activeStepId}
    `;
  }

  await tenantSql`
    UPDATE chatbot.pipeline_runs
    SET status = 'rejected',
        active_step_id = ${activeStepId},
        updated_at = now()
    WHERE pipeline_run_id = ${target.pipeline_run_id}
  `;

  await tenantSql`
    INSERT INTO chatbot.pipeline_events (
      event_id,
      pipeline_run_id,
      candidate_id,
      event_type,
      step_id,
      payload,
      idempotency_key
    ) VALUES (
      ${`evt-${randomUUID()}`},
      ${target.pipeline_run_id},
      ${target.candidate_id},
      'run_rejected',
      ${activeStepId},
      ${JSON.stringify({
        reason: "manual_reject",
        recruiter_reason: rejectionReason
      })}::jsonb,
      ${`manual-reject-${target.pipeline_run_id}-${normalizeIdempotencyFragment(rejectionReason)}`}
    )
  `;

  const blockedRows = await tenantSql`
    UPDATE chatbot.planned_messages
    SET review_status = 'blocked',
        reason = CASE
          WHEN reason IS NULL OR reason = '' THEN ${`Blocked after manual rejection: ${rejectionReason}`}
          ELSE reason || ${` | Blocked after manual rejection: ${rejectionReason}`}
        END
    WHERE review_status IN ('pending', 'approved')
      AND (
        pipeline_run_id = ${target.pipeline_run_id}
        OR conversation_id = ${target.conversation_id}
        OR candidate_id = ${target.candidate_id}
      )
    RETURNING planned_message_id
  `;

  return complete(step, context, [
    "Кандидат отклонён.",
    `Кандидат: ${target.display_name ?? target.candidate_id}`,
    `Причина: ${rejectionReason}`,
    `Pipeline run: ${target.pipeline_run_id}`,
    `Заблокировано сообщений в очереди: ${blockedRows.length}`
  ].join("\n"));
}

async function executeScheduleReminder({ context, tenantSql, step }) {
  const target = await resolveCandidateTarget({ context, tenantSql, requireConversation: true });
  const reminderBody = String(context.reminder_text ?? "").trim();
  if (!reminderBody) {
    throw new Error("reminder_text is required for schedule_reminder");
  }

  const reminderDelay = String(context.reminder_delay ?? "").trim();
  const delayPreset = REMINDER_DELAY_PRESETS[reminderDelay];
  if (!delayPreset) {
    throw new Error(`Unsupported reminder_delay: ${reminderDelay || "empty"}`);
  }

  const sendAt = new Date(Date.now() + delayPreset.delayMs);
  const plannedMessageId = `pm-manual-${randomUUID()}`;

  const insertedRows = await tenantSql`
    INSERT INTO chatbot.planned_messages (
      planned_message_id,
      conversation_id,
      candidate_id,
      pipeline_run_id,
      step_id,
      body,
      reason,
      review_status,
      moderation_policy,
      send_after,
      auto_send_after,
      idempotency_key
    ) VALUES (
      ${plannedMessageId},
      ${target.conversation_id},
      ${target.candidate_id},
      ${target.pipeline_run_id},
      ${target.active_step_id},
      ${reminderBody},
      ${`manual_reminder:${delayPreset.key}`},
      'approved',
      'window_to_reject',
      ${sendAt.toISOString()},
      ${sendAt.toISOString()},
      ${`manual-reminder-${target.conversation_id}-${normalizeIdempotencyFragment(reminderBody)}-${delayPreset.key}`}
    )
    RETURNING planned_message_id
  `;

  const created = insertedRows[0];
  return complete(step, context, [
    "Напоминание поставлено в очередь.",
    `Кандидат: ${target.display_name ?? target.candidate_id}`,
    `Когда отправить: ${delayPreset.label}`,
    `Текст: ${reminderBody}`,
    `planned_message_id: ${created?.planned_message_id ?? plannedMessageId}`
  ].join("\n"));
}

async function executeEditVacancyField({ context, tenantSql, step }) {
  const vacancyId = resolveVacancyId(context);
  if (!vacancyId) {
    throw new Error("vacancy_id is required for edit_vacancy_field");
  }

  const fieldLabel = String(context.edit_field ?? "").trim();
  const field = EDITABLE_VACANCY_FIELDS[fieldLabel];
  if (!field) {
    throw new Error(`Unsupported edit_field: ${fieldLabel || "empty"}`);
  }

  const rawValue = String(context.edit_value ?? "").trim();
  if (!rawValue) {
    throw new Error("edit_value is required for edit_vacancy_field");
  }

  const parsedValue = parseVacancyFieldValue(field.type, rawValue);

  if (field.column === "title") {
    await tenantSql`
      UPDATE chatbot.vacancies
      SET title = ${parsedValue},
          updated_at = now()
      WHERE vacancy_id = ${vacancyId}
    `;
  } else if (field.column === "raw_text") {
    await tenantSql`
      UPDATE chatbot.vacancies
      SET raw_text = ${parsedValue},
          updated_at = now()
      WHERE vacancy_id = ${vacancyId}
    `;
  } else if (field.column === "must_haves") {
    await tenantSql`
      UPDATE chatbot.vacancies
      SET must_haves = ${JSON.stringify(parsedValue)}::jsonb,
          updated_at = now()
      WHERE vacancy_id = ${vacancyId}
    `;
  } else if (field.column === "nice_haves") {
    await tenantSql`
      UPDATE chatbot.vacancies
      SET nice_haves = ${JSON.stringify(parsedValue)}::jsonb,
          updated_at = now()
      WHERE vacancy_id = ${vacancyId}
    `;
  }

  return complete(step, context, [
    "Поле вакансии обновлено.",
    `Поле: ${fieldLabel}`,
    `vacancy_id: ${vacancyId}`,
    `Новое значение: ${formatUpdatedFieldValue(parsedValue)}`
  ].join("\n"));
}

async function executePauseVacancy({ context, tenantSql, step }) {
  const vacancyId = resolveVacancyId(context);
  if (!vacancyId) {
    throw new Error("vacancy_id is required for pause_vacancy");
  }

  const vacancyRows = await tenantSql`
    SELECT vacancy_id, job_id, title, status
    FROM chatbot.vacancies
    WHERE vacancy_id = ${vacancyId}
    LIMIT 1
  `;
  const vacancy = vacancyRows[0];
  if (!vacancy) {
    throw new Error(`Vacancy not found: ${vacancyId}`);
  }

  if (vacancy.status !== "paused") {
    await tenantSql`
      UPDATE chatbot.vacancies
      SET status = 'paused',
          updated_at = now()
      WHERE vacancy_id = ${vacancyId}
    `;
  }

  let blockedRows = [];
  if (vacancy.job_id) {
    blockedRows = await tenantSql`
      UPDATE chatbot.planned_messages pm
      SET review_status = 'blocked',
          reason = CASE
            WHEN pm.reason IS NULL OR pm.reason = '' THEN 'Blocked because vacancy was paused'
            ELSE pm.reason || ' | Blocked because vacancy was paused'
          END
      FROM chatbot.conversations c
      WHERE pm.conversation_id = c.conversation_id
        AND c.job_id = ${vacancy.job_id}
        AND pm.review_status IN ('pending', 'approved')
      RETURNING pm.planned_message_id
    `;
  }

  return complete(step, context, [
    vacancy.status === "paused" ? "Вакансия уже была на паузе." : "Вакансия поставлена на паузу.",
    `Вакансия: ${vacancy.title ?? vacancy.vacancy_id}`,
    `vacancy_id: ${vacancy.vacancy_id}`,
    "Статус: paused",
    `Заблокировано сообщений в очереди: ${blockedRows.length}`
  ].join("\n"));
}

async function resolveCandidateTarget({ context, tenantSql, requireConversation = false }) {
  const pipelineRunId = pickContextValue(context, ["pipeline_run_id", "client_context.pipeline_run_id"]);
  const conversationId = pickContextValue(context, ["conversation_id", "client_context.conversation_id"]);
  const candidateId = pickContextValue(context, ["candidate_id", "client_context.candidate_id"]);
  const jobId = pickContextValue(context, ["job_id", "client_context.job_id"]);

  let rows = [];

  if (pipelineRunId) {
    rows = await tenantSql`
      SELECT
        pr.pipeline_run_id,
        pr.job_id,
        pr.candidate_id,
        pr.active_step_id,
        pr.status,
        cand.display_name,
        c.conversation_id
      FROM chatbot.pipeline_runs pr
      LEFT JOIN chatbot.candidates cand
        ON cand.candidate_id = pr.candidate_id
      LEFT JOIN chatbot.conversations c
        ON c.job_id = pr.job_id
       AND c.candidate_id = pr.candidate_id
      WHERE pr.pipeline_run_id = ${pipelineRunId}
      ORDER BY c.created_at DESC NULLS LAST
      LIMIT 1
    `;
  } else if (conversationId) {
    rows = await tenantSql`
      SELECT
        pr.pipeline_run_id,
        c.job_id,
        c.candidate_id,
        pr.active_step_id,
        pr.status,
        cand.display_name,
        c.conversation_id
      FROM chatbot.conversations c
      LEFT JOIN chatbot.pipeline_runs pr
        ON pr.job_id = c.job_id
       AND pr.candidate_id = c.candidate_id
      LEFT JOIN chatbot.candidates cand
        ON cand.candidate_id = c.candidate_id
      WHERE c.conversation_id = ${conversationId}
      ORDER BY pr.updated_at DESC NULLS LAST, pr.created_at DESC NULLS LAST
      LIMIT 1
    `;
  } else if (candidateId && jobId) {
    rows = await tenantSql`
      SELECT
        pr.pipeline_run_id,
        pr.job_id,
        pr.candidate_id,
        pr.active_step_id,
        pr.status,
        cand.display_name,
        c.conversation_id
      FROM chatbot.pipeline_runs pr
      LEFT JOIN chatbot.candidates cand
        ON cand.candidate_id = pr.candidate_id
      LEFT JOIN chatbot.conversations c
        ON c.job_id = pr.job_id
       AND c.candidate_id = pr.candidate_id
      WHERE pr.candidate_id = ${candidateId}
        AND pr.job_id = ${jobId}
      ORDER BY
        CASE pr.status
          WHEN 'active' THEN 0
          WHEN 'rejected' THEN 1
          ELSE 2
        END ASC,
        pr.updated_at DESC NULLS LAST,
        pr.created_at DESC NULLS LAST
      LIMIT 1
    `;
  }

  const target = rows[0] ?? null;
  if (!target) {
    throw new Error("Candidate notebook context is missing. Provide pipeline_run_id, conversation_id, or candidate_id + job_id.");
  }
  if (requireConversation && !target.conversation_id) {
    throw new Error("Conversation context is required for this action.");
  }
  return target;
}

function resolveVacancyId(context) {
  return pickContextValue(context, ["vacancy_id", "client_context.vacancy_id"]);
}

function pickContextValue(context, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, segment) => {
      if (current == null) return undefined;
      return current[segment];
    }, context);
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

function complete(step, context, content) {
  return {
    context,
    nextStepOrder: step.next_step_order ?? null,
    reply: {
      kind: "display",
      content_type: "text",
      content
    }
  };
}

function normalizeIdempotencyFragment(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "manual";
}

function parseVacancyFieldValue(type, rawValue) {
  if (type === "text") {
    return rawValue;
  }

  if (type === "jsonb_list") {
    const items = rawValue
      .split(/\n|;/)
      .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter(Boolean);

    if (items.length === 0) {
      throw new Error("At least one list item is required");
    }

    return items;
  }

  throw new Error(`Unsupported vacancy field type: ${type}`);
}

function formatUpdatedFieldValue(value) {
  return Array.isArray(value) ? value.join("; ") : String(value);
}

const EDITABLE_VACANCY_FIELDS = Object.freeze({
  "Название вакансии": {
    column: "title",
    type: "text"
  },
  "Описание вакансии": {
    column: "raw_text",
    type: "text"
  },
  "Обязательные требования": {
    column: "must_haves",
    type: "jsonb_list"
  },
  "Желательные требования": {
    column: "nice_haves",
    type: "jsonb_list"
  }
});

const REMINDER_DELAY_PRESETS = Object.freeze({
  "Через 1 час": {
    key: "1h",
    label: "через 1 час",
    delayMs: 60 * 60 * 1000
  },
  "Через 3 часа": {
    key: "3h",
    label: "через 3 часа",
    delayMs: 3 * 60 * 60 * 1000
  },
  "Завтра утром": {
    key: "tomorrow-morning",
    label: "завтра утром",
    delayMs: 18 * 60 * 60 * 1000
  }
});
