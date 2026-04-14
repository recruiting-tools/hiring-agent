import { getFunnelData } from "../../data/funnel-adapter.js";
import { getMassBroadcastCandidates } from "../../data/mass-broadcast-adapter.js";

export async function handleDataFetchStep({ step, context, tenantSql, tenantId }) {
  if (!tenantSql) {
    throw new Error("tenantSql is required for data_fetch step");
  }

  const fetchConfig = parseFetchConfig(step);
  const data = await fetchData({ fetchConfig, context, tenantSql, tenantId });

  return {
    context: step.context_key ? { ...context, [step.context_key]: data } : context,
    nextStepOrder: step.next_step_order ?? null,
    reply: null
  };
}

function parseFetchConfig(step) {
  if (typeof step.notes === "string") {
    try {
      const parsed = JSON.parse(step.notes);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {}
  }

  if (step.playbook_key === "candidate_funnel") {
    return { source: "candidate_funnel" };
  }

  throw new Error(`Unsupported data_fetch config for ${step.step_key ?? step.playbook_key ?? "unknown_step"}`);
}

async function fetchData({ fetchConfig, context, tenantSql, tenantId }) {
  if (fetchConfig.source === "candidate_funnel") {
    if (!tenantId) {
      throw new Error("tenantId is required for candidate_funnel data_fetch");
    }

    return getFunnelData(tenantSql, {
      tenantId,
      jobId: context.vacancy?.job_id ?? context.job_id ?? context.vacancy_id ?? null
    });
  }

  if (fetchConfig.source === "mass_broadcast_candidates") {
    return getMassBroadcastCandidates(tenantSql, {
      tenantId,
      jobId: context.vacancy?.job_id ?? context.job_id ?? null,
      selectionQuery: context.selection_query ?? {},
      limit: fetchConfig.limit
    });
  }

  throw new Error(`Unsupported data_fetch source: ${fetchConfig.source ?? "unknown"}`);
}
