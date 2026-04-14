export async function getFunnelData(sql, { tenantId, jobId = null }) {
  const rows = jobId
    ? await sql`
      with scoped_runs as (
        select pipeline_runs.pipeline_run_id, pipeline_runs.job_id
        from chatbot.pipeline_runs
        join chatbot.jobs on chatbot.jobs.job_id = pipeline_runs.job_id
        where pipeline_runs.job_id = ${jobId}
          and chatbot.jobs.client_id = ${tenantId}
      )
      select
        pss.step_id,
        pss.step_index,
        coalesce(step_meta.step_name, pss.step_id) as step_name,
        count(*)::int as total,
        count(*) filter (
          where pss.state = 'active'
            and coalesce(pss.awaiting_reply, false) = false
        )::int as in_progress,
        count(*) filter (where pss.state = 'completed')::int as completed,
        count(*) filter (
          where pss.state = 'active'
            and coalesce(pss.awaiting_reply, false) = true
        )::int as stuck,
        count(*) filter (where pss.state = 'rejected')::int as rejected
      from chatbot.pipeline_step_state pss
      join scoped_runs sr on sr.pipeline_run_id = pss.pipeline_run_id
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
        where step_entry ->> 'id' = pss.step_id
        limit 1
      ) step_meta on true
      group by
        pss.step_id,
        pss.step_index,
        coalesce(step_meta.step_name, pss.step_id)
      order by pss.step_index asc
    `
    : await sql`
      with scoped_runs as (
        select pipeline_runs.pipeline_run_id, pipeline_runs.job_id
        from chatbot.pipeline_runs
        join chatbot.jobs on chatbot.jobs.job_id = pipeline_runs.job_id
        where chatbot.jobs.client_id = ${tenantId}
      )
      select
        pss.step_id,
        pss.step_index,
        coalesce(step_meta.step_name, pss.step_id) as step_name,
        count(*)::int as total,
        count(*) filter (
          where pss.state = 'active'
            and coalesce(pss.awaiting_reply, false) = false
        )::int as in_progress,
        count(*) filter (where pss.state = 'completed')::int as completed,
        count(*) filter (
          where pss.state = 'active'
            and coalesce(pss.awaiting_reply, false) = true
        )::int as stuck,
        count(*) filter (where pss.state = 'rejected')::int as rejected
      from chatbot.pipeline_step_state pss
      join scoped_runs sr on sr.pipeline_run_id = pss.pipeline_run_id
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
        where step_entry ->> 'id' = pss.step_id
        limit 1
      ) step_meta on true
      group by
        pss.step_id,
        pss.step_index,
        coalesce(step_meta.step_name, pss.step_id)
      order by pss.step_index asc
    `;

  return rows.map((row) => ({
    step_name: row.step_name,
    step_id: row.step_id,
    step_index: Number(row.step_index),
    total: Number(row.total),
    in_progress: Number(row.in_progress),
    completed: Number(row.completed),
    stuck: Number(row.stuck),
    rejected: Number(row.rejected)
  }));
}
