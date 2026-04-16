const DEFAULT_RESULT_LIMIT = 10;
const DEFAULT_STALLED_HOURS = 24;

export async function getCandidateSnapshot(sql, {
  tenantId,
  jobId = null,
  pipelineRunId = null,
  conversationId = null,
  candidateId = null,
  lookupQuery = null
}) {
  if (!tenantId) {
    throw new Error("tenantId is required for candidate_snapshot");
  }

  if (pipelineRunId || conversationId || candidateId) {
    const row = await fetchCandidateSnapshotRow(sql, {
      tenantId,
      jobId,
      pipelineRunId,
      conversationId,
      candidateId
    });
    return row ? normalizeCandidateSnapshot(row) : buildNotFoundSnapshot(lookupQuery ?? candidateId ?? conversationId ?? pipelineRunId);
  }

  const matches = await getCandidateSearchResults(sql, {
    tenantId,
    jobId,
    query: lookupQuery,
    limit: 3
  });

  if (matches.length === 1) {
    const row = await fetchCandidateSnapshotRow(sql, {
      tenantId,
      jobId,
      candidateId: matches[0].candidate_id
    });
    return row ? normalizeCandidateSnapshot(row) : buildNotFoundSnapshot(lookupQuery);
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      lookup_query: String(lookupQuery ?? "").trim(),
      matches
    };
  }

  return buildNotFoundSnapshot(lookupQuery);
}

export async function getTodaySummary(sql, {
  tenantId,
  jobId = null,
  stalledHours = DEFAULT_STALLED_HOURS
}) {
  if (!tenantId) {
    throw new Error("tenantId is required for today_summary");
  }

  const inboundRows = await sql`
    SELECT COUNT(*)::int AS count
    FROM chatbot.messages m
    JOIN chatbot.conversations conv ON conv.conversation_id = m.conversation_id
    JOIN chatbot.jobs j ON j.job_id = conv.job_id
    WHERE j.client_id = ${tenantId}
      AND (${jobId}::text IS NULL OR conv.job_id = ${jobId})
      AND m.direction = 'inbound'
      AND m.occurred_at >= date_trunc('day', now())
  `;

  const outboundRows = await sql`
    SELECT COUNT(*)::int AS count
    FROM chatbot.messages m
    JOIN chatbot.conversations conv ON conv.conversation_id = m.conversation_id
    JOIN chatbot.jobs j ON j.job_id = conv.job_id
    WHERE j.client_id = ${tenantId}
      AND (${jobId}::text IS NULL OR conv.job_id = ${jobId})
      AND m.direction = 'outbound'
      AND m.occurred_at >= date_trunc('day', now())
  `;

  const moderationRows = await sql`
    SELECT COUNT(*)::int AS count
    FROM chatbot.planned_messages pm
    JOIN chatbot.conversations conv ON conv.conversation_id = pm.conversation_id
    JOIN chatbot.jobs j ON j.job_id = conv.job_id
    WHERE j.client_id = ${tenantId}
      AND (${jobId}::text IS NULL OR conv.job_id = ${jobId})
      AND pm.review_status = 'pending'
  `;

  const stalledRows = await sql`
    WITH active_steps AS (
      SELECT
        pr.candidate_id,
        pr.job_id,
        c.display_name,
        v.title AS vacancy_title,
        COALESCE(step_meta.step_name, pss.step_id) AS current_step,
        pss.updated_at
      FROM chatbot.pipeline_step_state pss
      JOIN chatbot.pipeline_runs pr ON pr.pipeline_run_id = pss.pipeline_run_id
      JOIN chatbot.jobs j ON j.job_id = pr.job_id
      JOIN chatbot.candidates c ON c.candidate_id = pr.candidate_id
      LEFT JOIN chatbot.vacancies v ON v.job_id = pr.job_id AND v.status != 'archived'
      LEFT JOIN LATERAL (
        SELECT pt.steps_json
        FROM chatbot.pipeline_templates pt
        WHERE pt.job_id = pr.job_id
        ORDER BY pt.template_version DESC
        LIMIT 1
      ) template_data ON true
      LEFT JOIN LATERAL (
        SELECT step_entry ->> 'goal' AS step_name
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(template_data.steps_json) = 'array'
               THEN template_data.steps_json
               ELSE '[]'::jsonb
          END
        ) AS step_entry
        WHERE step_entry ->> 'id' = pss.step_id
        LIMIT 1
      ) step_meta ON true
      WHERE j.client_id = ${tenantId}
        AND (${jobId}::text IS NULL OR pr.job_id = ${jobId})
        AND pss.state = 'active'
        AND (
          COALESCE(pss.awaiting_reply, false) = true
          OR pss.updated_at <= now() - (${stalledHours} * interval '1 hour')
        )
    )
    SELECT
      candidate_id,
      display_name,
      vacancy_title,
      current_step,
      ROUND(EXTRACT(EPOCH FROM (now() - updated_at)) / 3600.0, 1) AS hours_waiting
    FROM active_steps
    ORDER BY updated_at ASC
    LIMIT 5
  `;

  return {
    kind: "summary",
    scope: jobId ? "vacancy" : "tenant",
    responses_today: Number(inboundRows[0]?.count ?? 0),
    sent_today: Number(outboundRows[0]?.count ?? 0),
    moderation_pending: Number(moderationRows[0]?.count ?? 0),
    stalled_candidates: stalledRows.map((row) => ({
      candidate_id: row.candidate_id,
      name: row.display_name || row.candidate_id,
      vacancy_title: row.vacancy_title || "Без названия",
      current_step: row.current_step || "unknown",
      hours_waiting: Number(row.hours_waiting ?? 0)
    }))
  };
}

export async function getCandidateSearchResults(sql, {
  tenantId,
  jobId = null,
  query,
  limit = DEFAULT_RESULT_LIMIT
}) {
  if (!tenantId) {
    throw new Error("tenantId is required for candidate_search");
  }

  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    return [];
  }

  const rows = await sql`
    WITH scoped_runs AS (
      SELECT DISTINCT ON (pr.job_id, pr.candidate_id)
        pr.pipeline_run_id,
        pr.job_id,
        pr.candidate_id,
        pr.status,
        pr.updated_at
      FROM chatbot.pipeline_runs pr
      JOIN chatbot.jobs j ON j.job_id = pr.job_id
      WHERE j.client_id = ${tenantId}
        AND (${jobId}::text IS NULL OR pr.job_id = ${jobId})
      ORDER BY pr.job_id, pr.candidate_id, pr.updated_at DESC
    ),
    active_steps AS (
      SELECT
        pss.pipeline_run_id,
        pss.step_id,
        pss.updated_at
      FROM chatbot.pipeline_step_state pss
      WHERE pss.state = 'active'
    ),
    last_messages AS (
      SELECT
        conversation_id,
        MAX(occurred_at) AS last_message_at
      FROM chatbot.messages
      GROUP BY conversation_id
    )
    SELECT
      sr.candidate_id,
      c.display_name,
      c.resume_text,
      sr.status,
      v.title AS vacancy_title,
      COALESCE(step_meta.step_name, active_steps.step_id, sr.status) AS current_step,
      last_messages.last_message_at
    FROM scoped_runs sr
    JOIN chatbot.candidates c ON c.candidate_id = sr.candidate_id
    LEFT JOIN chatbot.conversations conv
      ON conv.job_id = sr.job_id
      AND conv.candidate_id = sr.candidate_id
    LEFT JOIN last_messages ON last_messages.conversation_id = conv.conversation_id
    LEFT JOIN chatbot.vacancies v ON v.job_id = sr.job_id AND v.status != 'archived'
    LEFT JOIN active_steps ON active_steps.pipeline_run_id = sr.pipeline_run_id
    LEFT JOIN LATERAL (
      SELECT pt.steps_json
      FROM chatbot.pipeline_templates pt
      WHERE pt.job_id = sr.job_id
      ORDER BY pt.template_version DESC
      LIMIT 1
    ) template_data ON true
    LEFT JOIN LATERAL (
      SELECT step_entry ->> 'goal' AS step_name
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(template_data.steps_json) = 'array'
             THEN template_data.steps_json
             ELSE '[]'::jsonb
        END
      ) AS step_entry
      WHERE step_entry ->> 'id' = active_steps.step_id
      LIMIT 1
    ) step_meta ON true
    ORDER BY sr.updated_at DESC, c.display_name ASC NULLS LAST, sr.candidate_id ASC
  `;

  const tokens = tokenize(normalizedQuery);
  if (!tokens.length) {
    return [];
  }

  return rows
    .map((row) => {
      const haystack = [
        row.candidate_id,
        row.display_name,
        row.resume_text,
        row.status,
        row.current_step,
        row.vacancy_title
      ].join(" ").toLowerCase();
      const matched = tokens.filter((token) => haystack.includes(token)).length;
      const matchScore = Math.round((matched / tokens.length) * 100);
      return {
        candidate_id: row.candidate_id,
        name: row.display_name || row.candidate_id,
        vacancy_title: row.vacancy_title || "Без названия",
        current_step: row.current_step || "unknown",
        status: row.status || "active",
        last_message_at: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
        match_score: matchScore
      };
    })
    .filter((row) => row.match_score >= 50)
    .sort((left, right) => right.match_score - left.match_score || left.name.localeCompare(right.name, "ru"))
    .slice(0, limit);
}

async function fetchCandidateSnapshotRow(sql, {
  tenantId,
  jobId = null,
  pipelineRunId = null,
  conversationId = null,
  candidateId = null
}) {
  const rows = await sql`
    WITH candidate_scope AS (
      SELECT
        pr.pipeline_run_id,
        pr.job_id,
        pr.candidate_id,
        pr.status AS run_status,
        pr.updated_at AS run_updated_at,
        conv.conversation_id
      FROM chatbot.pipeline_runs pr
      JOIN chatbot.jobs j ON j.job_id = pr.job_id
      LEFT JOIN chatbot.conversations conv
        ON conv.job_id = pr.job_id
        AND conv.candidate_id = pr.candidate_id
      WHERE j.client_id = ${tenantId}
        AND (${jobId}::text IS NULL OR pr.job_id = ${jobId})
        AND (${pipelineRunId}::text IS NULL OR pr.pipeline_run_id = ${pipelineRunId})
        AND (${conversationId}::text IS NULL OR conv.conversation_id = ${conversationId})
        AND (${candidateId}::text IS NULL OR pr.candidate_id = ${candidateId})
      ORDER BY pr.updated_at DESC
      LIMIT 1
    ),
    last_message AS (
      SELECT
        m.conversation_id,
        m.direction,
        m.body,
        m.occurred_at
      FROM chatbot.messages m
      JOIN candidate_scope scope ON scope.conversation_id = m.conversation_id
      ORDER BY m.occurred_at DESC NULLS LAST, m.received_at DESC NULLS LAST
      LIMIT 1
    ),
    next_planned AS (
      SELECT
        pm.conversation_id,
        pm.body,
        pm.review_status,
        pm.send_after
      FROM chatbot.planned_messages pm
      JOIN candidate_scope scope ON scope.conversation_id = pm.conversation_id
      WHERE pm.review_status IN ('pending', 'approved')
      ORDER BY pm.send_after ASC NULLS LAST, pm.created_at ASC
      LIMIT 1
    )
    SELECT
      scope.pipeline_run_id,
      scope.job_id,
      scope.candidate_id,
      scope.conversation_id,
      scope.run_status,
      cand.display_name,
      cand.resume_text,
      vacancy.vacancy_id,
      vacancy.title AS vacancy_title,
      active.step_id AS current_step_id,
      COALESCE(step_meta.step_name, active.step_id, scope.run_status) AS current_step,
      active.awaiting_reply,
      active.last_reason,
      active.updated_at AS current_step_updated_at,
      last_message.direction AS last_message_direction,
      last_message.body AS last_message_body,
      last_message.occurred_at AS last_message_at,
      next_planned.body AS next_message_body,
      next_planned.review_status AS next_message_review_status,
      next_planned.send_after AS next_message_send_after
    FROM candidate_scope scope
    JOIN chatbot.candidates cand ON cand.candidate_id = scope.candidate_id
    LEFT JOIN chatbot.vacancies vacancy
      ON vacancy.job_id = scope.job_id
      AND vacancy.status != 'archived'
    LEFT JOIN chatbot.pipeline_step_state active
      ON active.pipeline_run_id = scope.pipeline_run_id
      AND active.state = 'active'
    LEFT JOIN LATERAL (
      SELECT pt.steps_json
      FROM chatbot.pipeline_templates pt
      WHERE pt.job_id = scope.job_id
      ORDER BY pt.template_version DESC
      LIMIT 1
    ) template_data ON true
    LEFT JOIN LATERAL (
      SELECT step_entry ->> 'goal' AS step_name
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(template_data.steps_json) = 'array'
             THEN template_data.steps_json
             ELSE '[]'::jsonb
        END
      ) AS step_entry
      WHERE step_entry ->> 'id' = active.step_id
      LIMIT 1
    ) step_meta ON true
    LEFT JOIN last_message ON last_message.conversation_id = scope.conversation_id
    LEFT JOIN next_planned ON next_planned.conversation_id = scope.conversation_id
    LIMIT 1
  `;

  return rows[0] ?? null;
}

function normalizeCandidateSnapshot(row) {
  const currentStepUpdatedAt = row.current_step_updated_at ? new Date(row.current_step_updated_at) : null;

  return {
    kind: "snapshot",
    candidate_id: row.candidate_id,
    candidate_name: row.display_name || row.candidate_id,
    vacancy_id: row.vacancy_id ?? null,
    vacancy_title: row.vacancy_title || "Без названия",
    pipeline_run_id: row.pipeline_run_id,
    conversation_id: row.conversation_id ?? null,
    run_status: row.run_status || "active",
    current_step: row.current_step || "unknown",
    awaiting_reply: row.awaiting_reply === true,
    rejection_reason: row.last_reason ?? null,
    hours_on_step: currentStepUpdatedAt ? hoursSince(currentStepUpdatedAt) : null,
    last_message_direction: row.last_message_direction ?? null,
    last_message_body: row.last_message_body ?? null,
    last_message_at: row.last_message_at ? new Date(row.last_message_at).toISOString() : null,
    next_message_body: row.next_message_body ?? null,
    next_message_review_status: row.next_message_review_status ?? null,
    next_message_send_after: row.next_message_send_after ? new Date(row.next_message_send_after).toISOString() : null
  };
}

function buildNotFoundSnapshot(lookupQuery) {
  return {
    kind: "not_found",
    lookup_query: String(lookupQuery ?? "").trim()
  };
}

function tokenize(query) {
  return [...new Set(
    String(query ?? "")
      .toLowerCase()
      .split(/[^a-zа-я0-9+.#-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  )];
}

function hoursSince(value) {
  return Number(((Date.now() - value.getTime()) / 36e5).toFixed(1));
}
