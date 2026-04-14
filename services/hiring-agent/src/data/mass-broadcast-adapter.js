const DEFAULT_FUZZY_THRESHOLD = 60;
const DEFAULT_RESULT_LIMIT = 25;

export async function getMassBroadcastCandidates(sql, {
  tenantId,
  jobId,
  selectionQuery = {},
  limit = DEFAULT_RESULT_LIMIT
}) {
  if (!tenantId) {
    throw new Error("tenantId is required for mass_broadcast_candidates");
  }

  if (!jobId) {
    throw new Error("jobId is required for mass_broadcast_candidates");
  }

  const rows = await sql`
    with scoped_runs as (
      select
        pipeline_runs.pipeline_run_id,
        pipeline_runs.job_id,
        pipeline_runs.candidate_id,
        pipeline_runs.status
      from chatbot.pipeline_runs
      join chatbot.jobs on chatbot.jobs.job_id = pipeline_runs.job_id
      where pipeline_runs.job_id = ${jobId}
        and chatbot.jobs.client_id = ${tenantId}
    ),
    active_steps as (
      select
        pss.pipeline_run_id,
        pss.step_id,
        pss.step_index,
        pss.updated_at,
        pss.awaiting_reply
      from chatbot.pipeline_step_state pss
      where pss.state = 'active'
    ),
    last_messages as (
      select
        conversation_id,
        max(occurred_at) as last_message_at
      from chatbot.messages
      group by conversation_id
    )
    select
      sr.candidate_id,
      c.display_name,
      c.resume_text,
      sr.status,
      coalesce(step_meta.step_name, active_steps.step_id, sr.status) as current_step,
      active_steps.updated_at as current_step_updated_at,
      active_steps.awaiting_reply,
      last_messages.last_message_at
    from scoped_runs sr
    join chatbot.candidates c on c.candidate_id = sr.candidate_id
    left join active_steps on active_steps.pipeline_run_id = sr.pipeline_run_id
    left join chatbot.conversations conv
      on conv.job_id = sr.job_id
      and conv.candidate_id = sr.candidate_id
    left join last_messages on last_messages.conversation_id = conv.conversation_id
    left join lateral (
      select pt.steps_json
      from chatbot.pipeline_templates pt
      where pt.job_id = sr.job_id
      order by pt.template_version desc
      limit 1
    ) template_data on true
    left join lateral (
      select step_entry ->> 'goal' as step_name
      from jsonb_array_elements(
        case when jsonb_typeof(template_data.steps_json) = 'array'
             then template_data.steps_json
             else '[]'::jsonb
        end
      ) as step_entry
      where step_entry ->> 'id' = active_steps.step_id
      limit 1
    ) step_meta on true
    order by c.display_name asc nulls last, sr.candidate_id asc
  `;

  const hydratedRows = rows.map(normalizeCandidateRow);
  const filteredRows = filterCandidates(hydratedRows, selectionQuery);

  return filteredRows.slice(0, limit).map((candidate) => ({
    candidate_id: candidate.candidate_id,
    name: candidate.name,
    current_step: candidate.current_step,
    status: candidate.status,
    hours_on_step: candidate.hours_on_step,
    last_message_at: candidate.last_message_at,
    ...(candidate.match_score != null ? { match_score: candidate.match_score } : {})
  }));
}

function normalizeCandidateRow(row) {
  const currentStepUpdatedAt = row.current_step_updated_at ? new Date(row.current_step_updated_at) : null;
  const lastMessageAt = row.last_message_at ? new Date(row.last_message_at) : null;

  return {
    candidate_id: row.candidate_id,
    name: row.display_name || row.candidate_id,
    resume_text: row.resume_text || "",
    status: row.status || "active",
    current_step: row.current_step || "unknown",
    current_step_updated_at: currentStepUpdatedAt,
    last_message_at: lastMessageAt ? lastMessageAt.toISOString() : null,
    hours_on_step: currentStepUpdatedAt ? hoursSince(currentStepUpdatedAt) : null,
    last_message_age_hours: lastMessageAt ? hoursSince(lastMessageAt) : null
  };
}

function filterCandidates(candidates, selectionQuery) {
  if (selectionQuery?.type === "fuzzy") {
    return fuzzyMatchCandidates(candidates, selectionQuery);
  }

  return exactMatchCandidates(candidates, selectionQuery?.exact_filter ?? {});
}

function exactMatchCandidates(candidates, exactFilter) {
  return candidates.filter((candidate) => {
    if (exactFilter.current_step && !sameText(candidate.current_step, exactFilter.current_step)) {
      return false;
    }

    if (exactFilter.status && !sameText(candidate.status, exactFilter.status)) {
      return false;
    }

    if (exactFilter.min_hours_on_step != null) {
      if (candidate.hours_on_step == null || candidate.hours_on_step < Number(exactFilter.min_hours_on_step)) {
        return false;
      }
    }

    if (exactFilter.last_message_older_than_hours != null) {
      const requiredAge = Number(exactFilter.last_message_older_than_hours);
      if (candidate.last_message_age_hours != null && candidate.last_message_age_hours < requiredAge) {
        return false;
      }
    }

    return true;
  });
}

function fuzzyMatchCandidates(candidates, selectionQuery) {
  const query = `${selectionQuery?.fuzzy_query ?? ""}`.trim()
    || `${selectionQuery?.description ?? ""}`.trim();
  const tokens = tokenize(query);
  if (!tokens.length) {
    return candidates.slice(0, DEFAULT_RESULT_LIMIT);
  }

  const threshold = Number(selectionQuery?.threshold ?? DEFAULT_FUZZY_THRESHOLD);

  return candidates
    .map((candidate) => {
      const haystack = `${candidate.name} ${candidate.current_step} ${candidate.resume_text} ${candidate.status}`.toLowerCase();
      const matched = tokens.filter((token) => haystack.includes(token)).length;
      const matchScore = Math.round((matched / tokens.length) * 100);
      return {
        ...candidate,
        match_score: matchScore
      };
    })
    .filter((candidate) => candidate.match_score >= threshold)
    .sort((left, right) => right.match_score - left.match_score || left.name.localeCompare(right.name, "ru"));
}

function sameText(left, right) {
  return `${left ?? ""}`.trim().toLowerCase() === `${right ?? ""}`.trim().toLowerCase();
}

function tokenize(query) {
  return [...new Set(
    `${query ?? ""}`
      .toLowerCase()
      .split(/[^a-zа-я0-9+.#-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  )];
}

function hoursSince(value) {
  return Number(((Date.now() - value.getTime()) / 36e5).toFixed(1));
}
