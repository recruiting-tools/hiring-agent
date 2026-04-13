export async function getFunnelData(sql, jobId = null) {
  const jobFilter = jobId
    ? sql`where pipeline_runs.job_id = ${jobId}`
    : sql``;

  const rows = await sql`
    select
      pipeline_step_state.step_id,
      pipeline_step_state.step_index,
      coalesce(step_meta.step_name, pipeline_step_state.step_id) as step_name,
      count(*)::int as total,
      count(*) filter (
        where pipeline_step_state.state = 'active'
          and coalesce(pipeline_step_state.awaiting_reply, false) = false
      )::int as in_progress,
      count(*) filter (where pipeline_step_state.state = 'completed')::int as completed,
      count(*) filter (
        where pipeline_step_state.state = 'active'
          and coalesce(pipeline_step_state.awaiting_reply, false) = true
      )::int as stuck,
      count(*) filter (where pipeline_step_state.state = 'rejected')::int as rejected
    from chatbot.pipeline_step_state
    join chatbot.pipeline_runs
      on pipeline_runs.pipeline_run_id = pipeline_step_state.pipeline_run_id
    left join lateral (
      select pipeline_templates.steps_json
      from chatbot.pipeline_templates
      where pipeline_templates.job_id = pipeline_runs.job_id
      order by pipeline_templates.template_id desc
      limit 1
    ) template_data on true
    left join lateral (
      select step_entry ->> 'goal' as step_name
      from jsonb_array_elements(coalesce(template_data.steps_json, '[]'::jsonb)) as step_entry
      where step_entry ->> 'id' = pipeline_step_state.step_id
      limit 1
    ) step_meta on true
    ${jobFilter}
    group by
      pipeline_step_state.step_id,
      pipeline_step_state.step_index,
      coalesce(step_meta.step_name, pipeline_step_state.step_id)
    order by pipeline_step_state.step_index asc
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
