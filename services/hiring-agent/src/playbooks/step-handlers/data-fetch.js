import { getFunnelData } from "../../data/funnel-adapter.js";
import { getMassBroadcastCandidates } from "../../data/mass-broadcast-adapter.js";
import {
  getCandidateSearchResults,
  getCandidateSnapshot,
  getTodaySummary
} from "../../data/recruiter-read-adapter.js";

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

  if (fetchConfig.source === "candidate_snapshot") {
    return getCandidateSnapshot(tenantSql, {
      tenantId,
      jobId: context.vacancy?.job_id ?? context.job_id ?? context.client_context?.job_id ?? null,
      pipelineRunId: context.pipeline_run_id ?? context.client_context?.pipeline_run_id ?? null,
      conversationId: context.conversation_id ?? context.client_context?.conversation_id ?? null,
      candidateId: context.candidate_id ?? context.client_context?.candidate_id ?? null,
      lookupQuery: context.candidate_lookup_query ?? context.client_context?.candidate_name ?? null
    });
  }

  if (fetchConfig.source === "today_summary") {
    return getTodaySummary(tenantSql, {
      tenantId,
      jobId: context.vacancy?.job_id ?? context.job_id ?? context.client_context?.job_id ?? null,
      stalledHours: fetchConfig.stalledHours
    });
  }

  if (fetchConfig.source === "candidate_search") {
    return getCandidateSearchResults(tenantSql, {
      tenantId,
      jobId: context.vacancy?.job_id ?? context.job_id ?? context.client_context?.job_id ?? null,
      query: context.search_query ?? context.client_context?.candidate_name ?? null,
      limit: fetchConfig.limit
    });
  }

  throw new Error(`Unsupported data_fetch source: ${fetchConfig.source ?? "unknown"}`);
}
