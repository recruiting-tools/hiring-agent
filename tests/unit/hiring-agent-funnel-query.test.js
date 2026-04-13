import assert from "node:assert/strict";
import test from "node:test";
import { getDemoRuntimeData } from "../../services/hiring-agent/src/demo-runtime-data.js";
import { buildFunnelSnapshot } from "../../services/hiring-agent/src/queries/funnel-query.js";

test("funnel adapter: produces stable aggregate contract from runtime-shaped data", () => {
  const snapshot = buildFunnelSnapshot(getDemoRuntimeData());

  assert.equal(snapshot.total_candidates, 12);
  assert.equal(snapshot.qualified_candidates, 6);
  assert.equal(snapshot.rejected_candidates, 4);
  assert.equal(snapshot.waiting_candidates, 7);

  const screening = snapshot.rows.find((row) => row.step_id === "screening");
  assert.deepEqual(screening, {
    step_id: "screening",
    step_name: "Скрининг",
    total: 12,
    in_progress: 1,
    completed: 9,
    stuck: 1,
    rejected: 1
  });

  const qualification = snapshot.rows.find((row) => row.step_id === "qualification");
  assert.deepEqual(qualification, {
    step_id: "qualification",
    step_name: "Подтверждение квалификации",
    total: 9,
    in_progress: 1,
    completed: 6,
    stuck: 0,
    rejected: 2
  });
});
