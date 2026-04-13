import { buildFunnelSnapshot } from "../queries/funnel-query.js";
import { getFunnelData } from "../data/funnel-adapter.js";

function buildReplyFromRows(rows) {
  const normalizedRows = rows.map((row) => ({
    step_id: row.step_id,
    step_name: row.step_name,
    total: row.total,
    in_progress: row.in_progress,
    completed: row.completed,
    stuck: row.stuck,
    rejected: row.rejected
  }));

  const qualificationRow = normalizedRows.find((row) => row.step_id === "qualification");
  const summary = {
    total: normalizedRows.reduce((max, row) => Math.max(max, row.total), 0),
    qualified: qualificationRow?.completed ?? 0,
    rejected: normalizedRows.reduce((sum, row) => sum + row.rejected, 0),
    waiting: normalizedRows.reduce((sum, row) => sum + row.in_progress + row.stuck, 0)
  };

  return {
    kind: "render_funnel",
    playbook_key: "candidate_funnel",
    title: "Воронка кандидатов по goal-этапам",
    summary,
    rows: normalizedRows,
    branches: [
      { branch_key: "rejected", title: "Отсечены", count: summary.rejected },
      {
        branch_key: "stuck",
        title: "Зависли",
        count: normalizedRows.reduce((sum, row) => sum + row.stuck, 0)
      },
      {
        branch_key: "in_progress",
        title: "В работе",
        count: normalizedRows.reduce((sum, row) => sum + row.in_progress, 0)
      }
    ],
    generated_at: new Date().toISOString()
  };
}

export function runCandidateFunnelPlaybook({ runtimeData }) {
  const snapshot = buildFunnelSnapshot(runtimeData);

  return {
    kind: "render_funnel",
    playbook_key: "candidate_funnel",
    title: "Воронка кандидатов по goal-этапам",
    summary: {
      total: snapshot.total_candidates,
      qualified: snapshot.qualified_candidates,
      rejected: snapshot.rejected_candidates,
      waiting: snapshot.waiting_candidates
    },
    rows: snapshot.rows,
    branches: snapshot.branches,
    generated_at: snapshot.generated_at
  };
}

export async function executeWithDb({ sql, tenantId, jobId }) {
  const rows = await getFunnelData(sql, { tenantId, jobId });
  return buildReplyFromRows(rows);
}
