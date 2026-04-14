import { createManagementStore } from "../../../../packages/access-context/src/management-store.js";
import { handleAutoFetchStep } from "./step-handlers/auto-fetch.js";
import { handleButtonsStep } from "./step-handlers/buttons.js";
import { handleDataFetchStep } from "./step-handlers/data-fetch.js";
import { handleDecisionStep } from "./step-handlers/decision.js";
import { handleDisplayStep } from "./step-handlers/display.js";
import { handleLlmExtractStep, PlaybookLlmError } from "./step-handlers/llm-extract.js";
import { handleLlmGenerateStep } from "./step-handlers/llm-generate.js";
import { handleSubroutineStep } from "./step-handlers/subroutine.js";
import { handleUserInputStep } from "./step-handlers/user-input.js";

const HANDLERS = {
  auto_fetch: handleAutoFetchStep,
  buttons: handleButtonsStep,
  data_fetch: handleDataFetchStep,
  decision: handleDecisionStep,
  display: handleDisplayStep,
  llm_extract: handleLlmExtractStep,
  llm_generate: handleLlmGenerateStep,
  subroutine: handleSubroutineStep,
  user_input: handleUserInputStep
};

export async function dispatch({
  managementSql = null,
  managementStore = managementSql ? createManagementStore(managementSql) : null,
  tenantSql,
  tenantId,
  recruiterId,
  vacancyId = null,
  jobId = null,
  playbookKey,
  recruiterInput = null,
  llmAdapter,
  llmConfig = {},
  conversationId = null
}) {
  if (!managementStore) {
    throw new Error("managementStore or managementSql is required");
  }

  const steps = (await managementStore.getPlaybookSteps(playbookKey)).map((step) => normalizeStep(step));
  if (!steps.length) {
    throw new Error(`Playbook steps not found for ${playbookKey}`);
  }

  let session = normalizeSession(await managementStore.getActiveSession({
    tenantId,
    recruiterId,
    vacancyId,
    playbookKey
  }));

  if (!session) {
    await managementStore.abortActiveSessions?.({
      tenantId,
      recruiterId,
      vacancyId,
      excludePlaybookKey: playbookKey
    });

    const initialStep = steps[0];
    if (initialStep.step_order == null) {
      throw new Error(`Playbook initial step_order is missing for ${playbookKey}`);
    }
    session = await managementStore.createPlaybookSession({
      tenantId,
      recruiterId,
      conversationId,
      playbookKey,
      currentStepOrder: initialStep.step_order,
      vacancyId,
      context: buildInitialContext({ vacancyId, jobId }),
      callStack: []
    });
    session = normalizeSession(session);
  }

  if (!session?.session_id) {
    throw new Error("Playbook session id is missing");
  }

  const stepMap = new Map(steps.map((step) => [step.step_order, step]));
  let currentStepOrder = session.current_step_order ?? steps[0].step_order;
  let context = mergeIdentityIntoContext(normalizeSessionContext(session.context), {
    vacancyId: vacancyId ?? session.vacancy_id ?? null,
    jobId
  });

  while (true) {
    const step = stepMap.get(currentStepOrder);
      if (!step) {
        const identity = deriveIdentity(context, { vacancyId, jobId, session });
        await managementStore.completeSession(session.session_id, {
          context,
          vacancyId: identity.vacancyId
        });
        return {
          sessionId: session.session_id,
          vacancyId: identity.vacancyId,
          jobId: identity.jobId,
          reply: { kind: "completed", message: "Playbook completed." }
        };
      }

    const handler = HANDLERS[step.step_type];
    if (!handler) {
      throw new Error(`Unsupported playbook step type: ${step.step_type}`);
    }

    try {
      const result = await handler({
        step,
        session,
        context,
        recruiterInput,
        tenantSql,
        tenantId,
        llmAdapter,
        llmConfig
      });

      context = mergeIdentityIntoContext(result.context ?? context, {
        vacancyId: result.vacancyId ?? vacancyId ?? session.vacancy_id ?? null,
        jobId: result.jobId ?? jobId ?? null
      });
      const identity = deriveIdentity(context, { vacancyId, jobId, session });

      if (result.awaitingInput) {
        await managementStore.updateSession(session.session_id, {
          currentStepOrder: step.step_order,
          context,
          vacancyId: identity.vacancyId
        });
        return {
          sessionId: session.session_id,
          vacancyId: identity.vacancyId,
          jobId: identity.jobId,
          reply: result.reply
        };
      }

      if (result.nextStepOrder == null) {
        await managementStore.completeSession(session.session_id, {
          context,
          vacancyId: identity.vacancyId
        });
        return {
          sessionId: session.session_id,
          vacancyId: identity.vacancyId,
          jobId: identity.jobId,
          reply: result.reply ?? { kind: "completed", message: "Playbook completed." }
        };
      }

      currentStepOrder = result.nextStepOrder;
      recruiterInput = null;

      await managementStore.updateSession(session.session_id, {
        currentStepOrder,
        context,
        vacancyId: identity.vacancyId
      });

      if (result.reply) {
        return {
          sessionId: session.session_id,
          vacancyId: identity.vacancyId,
          jobId: identity.jobId,
          reply: result.reply
        };
      }
    } catch (error) {
      if (error instanceof PlaybookLlmError) {
        const identity = deriveIdentity(context, { vacancyId, jobId, session });
        await managementStore.updateSession(session.session_id, {
          context,
          vacancyId: identity.vacancyId,
          status: "error"
        });
        return {
          sessionId: session.session_id,
          vacancyId: identity.vacancyId,
          jobId: identity.jobId,
          reply: {
            kind: "fallback_text",
            text: "Не удалось выполнить LLM-шаг. Попробуйте ещё раз позже."
          }
        };
      }

      throw error;
    }
  }
}

function normalizeStep(step) {
  if (!step || typeof step !== "object") return {};

  return {
    ...step,
    step_key: step.step_key ?? step.stepKey ?? null,
    playbook_key: step.playbook_key ?? step.playbookKey ?? null,
    step_order: step.step_order ?? step.stepOrder ?? null,
    name: step.name ?? null,
    step_type: step.step_type ?? step.stepType ?? null,
    user_message: step.user_message ?? step.userMessage ?? null,
    prompt_template: step.prompt_template ?? step.promptTemplate ?? null,
    context_key: step.context_key ?? step.contextKey ?? null,
    db_save_column: step.db_save_column ?? step.dbSaveColumn ?? null,
    next_step_order: step.next_step_order ?? step.nextStepOrder ?? null,
    options: step.options ?? null,
    routing: step.routing ?? null,
    notes: step.notes ?? null,
    created_at: step.created_at ?? step.createdAt ?? null
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;

  return {
    ...session,
    session_id: session.session_id ?? session.sessionId ?? null,
    tenant_id: session.tenant_id ?? session.tenantId ?? null,
    recruiter_id: session.recruiter_id ?? session.recruiterId ?? null,
    conversation_id: session.conversation_id ?? session.conversationId ?? null,
    playbook_key: session.playbook_key ?? session.playbookKey ?? null,
    current_step_order: session.current_step_order ?? session.currentStepOrder ?? null,
    vacancy_id: session.vacancy_id ?? session.vacancyId ?? null,
    context: session.context ?? null,
    call_stack: session.call_stack ?? session.callStack ?? [],
    status: session.status ?? null
  };
}

function normalizeSessionContext(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return structuredClone(value);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function buildInitialContext({ vacancyId, jobId }) {
  const context = {};
  if (vacancyId) context.vacancy_id = vacancyId;
  if (jobId) context.job_id = jobId;
  return context;
}

function mergeIdentityIntoContext(context, { vacancyId = null, jobId = null } = {}) {
  const nextContext = context && typeof context === "object" && !Array.isArray(context)
    ? { ...context }
    : {};

  if (vacancyId && !nextContext.vacancy_id) {
    nextContext.vacancy_id = vacancyId;
  }
  if (jobId && !nextContext.job_id) {
    nextContext.job_id = jobId;
  }

  if (nextContext.vacancy?.vacancy_id && !nextContext.vacancy_id) {
    nextContext.vacancy_id = nextContext.vacancy.vacancy_id;
  }
  if (nextContext.vacancy?.job_id && !nextContext.job_id) {
    nextContext.job_id = nextContext.vacancy.job_id;
  }

  return nextContext;
}

function deriveIdentity(context, { vacancyId = null, jobId = null, session = null } = {}) {
  const contextVacancyId = context?.vacancy?.vacancy_id ?? context?.vacancy_id ?? null;
  const contextJobId = context?.vacancy?.job_id ?? context?.job_id ?? null;

  return {
    vacancyId: contextVacancyId ?? vacancyId ?? session?.vacancy_id ?? null,
    jobId: contextJobId ?? jobId ?? null
  };
}
