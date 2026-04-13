const STEPS = [
  { step_id: "screening", step_name: "Скрининг" },
  { step_id: "qualification", step_name: "Подтверждение квалификации" },
  { step_id: "homework", step_name: "Практический этап" },
  { step_id: "interview", step_name: "Финальное интервью" },
  { step_id: "offer", step_name: "Оффер" }
];

function buildRun(runId, statesByStep) {
  return {
    pipeline_run_id: runId,
    status: statesByStep.offer === "completed" ? "completed" : statesByStep.__run_status ?? "active",
    step_states: STEPS
      .filter((step) => statesByStep[step.step_id])
      .map((step, index) => {
        const raw = statesByStep[step.step_id];
        if (typeof raw === "string") {
          return {
            pipeline_run_id: runId,
            step_id: step.step_id,
            step_name: step.step_name,
            step_index: index,
            state: raw,
            freshness: raw === "active" ? "fresh" : null
          };
        }

        return {
          pipeline_run_id: runId,
          step_id: step.step_id,
          step_name: step.step_name,
          step_index: index,
          state: raw.state,
          freshness: raw.freshness ?? null
        };
      })
  };
}

const RUNS = [
  buildRun("run-001", {
    screening: "completed",
    qualification: "completed",
    homework: "completed",
    interview: "completed",
    offer: "completed"
  }),
  buildRun("run-002", {
    screening: "completed",
    qualification: "completed",
    homework: "completed",
    interview: "completed",
    offer: { state: "active", freshness: "fresh" }
  }),
  buildRun("run-003", {
    screening: "completed",
    qualification: "completed",
    homework: "completed",
    interview: { state: "active", freshness: "fresh" }
  }),
  buildRun("run-004", {
    screening: "completed",
    qualification: "completed",
    homework: "completed",
    interview: { state: "active", freshness: "stalled" }
  }),
  buildRun("run-005", {
    screening: "completed",
    qualification: "completed",
    homework: { state: "active", freshness: "fresh" }
  }),
  buildRun("run-006", {
    screening: "completed",
    qualification: "completed",
    homework: "rejected",
    __run_status: "rejected"
  }),
  buildRun("run-007", {
    screening: "completed",
    qualification: { state: "active", freshness: "fresh" }
  }),
  buildRun("run-008", {
    screening: "completed",
    qualification: "rejected",
    __run_status: "rejected"
  }),
  buildRun("run-009", {
    screening: "completed",
    qualification: "rejected",
    __run_status: "rejected"
  }),
  buildRun("run-010", {
    screening: { state: "active", freshness: "fresh" }
  }),
  buildRun("run-011", {
    screening: { state: "active", freshness: "stalled" }
  }),
  buildRun("run-012", {
    screening: "rejected",
    __run_status: "rejected"
  })
];

export function getDemoRuntimeData() {
  return {
    steps: structuredClone(STEPS),
    runs: structuredClone(RUNS)
  };
}
