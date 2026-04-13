function buildEmptyRow(step) {
  return {
    step_id: step.step_id,
    step_name: step.step_name,
    total: 0,
    in_progress: 0,
    completed: 0,
    stuck: 0,
    rejected: 0
  };
}

export function buildFunnelSnapshot(runtimeData) {
  const rows = runtimeData.steps.map((step) => buildEmptyRow(step));
  const stepIndexById = new Map(rows.map((row, index) => [row.step_id, index]));

  for (const run of runtimeData.runs) {
    for (const state of run.step_states) {
      const row = rows[stepIndexById.get(state.step_id)];
      if (!row) continue;
      row.total += 1;

      if (state.state === "completed") row.completed += 1;
      if (state.state === "rejected") row.rejected += 1;
      if (state.state === "active" && state.freshness === "fresh") row.in_progress += 1;
      if (state.state === "active" && state.freshness === "stalled") row.stuck += 1;
    }
  }

  const total_candidates = runtimeData.runs.length;
  const rejected_candidates = runtimeData.runs.filter((run) => run.status === "rejected").length;
  const qualified_candidates = runtimeData.runs.filter((run) => (
    run.step_states.some((step) => step.step_id === "qualification" && step.state === "completed")
  )).length;
  const waiting_candidates = runtimeData.runs.filter((run) => (
    run.step_states.some((step) => step.state === "active")
  )).length;

  const branches = [
    { branch_key: "rejected", title: "Отсечены", count: rejected_candidates },
    {
      branch_key: "stuck",
      title: "Зависли",
      count: rows.reduce((sum, row) => sum + row.stuck, 0)
    },
    {
      branch_key: "in_progress",
      title: "В работе",
      count: rows.reduce((sum, row) => sum + row.in_progress, 0)
    }
  ];

  return {
    generated_at: new Date().toISOString(),
    total_candidates,
    qualified_candidates,
    rejected_candidates,
    waiting_candidates,
    rows,
    branches
  };
}
