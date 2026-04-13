import { buildFunnelSnapshot } from "../queries/funnel-query.js";

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
