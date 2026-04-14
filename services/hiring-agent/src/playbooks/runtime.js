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
  playbookKey,
  recruiterInput = null,
  llmAdapter,
  llmConfig = {},
  conversationId = null
}) {
  if (!managementStore) {
    throw new Error("managementStore or managementSql is required");
  }

  const steps = await managementStore.getPlaybookSteps(playbookKey);
  if (!steps.length) {
    throw new Error(`Playbook steps not found for ${playbookKey}`);
  }

  let session = await managementStore.getActiveSession({
    tenantId,
    recruiterId,
    vacancyId,
    playbookKey
  });

  if (!session) {
    await managementStore.abortActiveSessions?.({
      tenantId,
      recruiterId,
      vacancyId,
      excludePlaybookKey: playbookKey
    });

    const initialStep = steps[0];
    session = await managementStore.createPlaybookSession({
      tenantId,
      recruiterId,
      conversationId,
      playbookKey,
      currentStepOrder: initialStep.step_order,
      vacancyId,
      context: vacancyId ? { vacancy_id: vacancyId } : {},
      callStack: []
    });
  }

  const stepMap = new Map(steps.map((step) => [step.step_order, step]));
  let currentStepOrder = session.current_step_order ?? steps[0].step_order;
  let context = normalizeSessionContext(session.context);
  if (vacancyId && !context.vacancy_id) {
    context.vacancy_id = vacancyId;
  }

  while (true) {
    const step = stepMap.get(currentStepOrder);
      if (!step) {
        const finalVacancyId = context.vacancy_id ?? vacancyId ?? session.vacancy_id ?? null;
        await managementStore.completeSession(session.session_id, {
          context,
          vacancyId: finalVacancyId
        });
        return {
          sessionId: session.session_id,
          vacancyId: finalVacancyId,
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

      context = result.context ?? context;
      const effectiveVacancyId = result.vacancyId ?? context.vacancy_id ?? vacancyId ?? session.vacancy_id ?? null;

      if (result.awaitingInput) {
        await managementStore.updateSession(session.session_id, {
          currentStepOrder: step.step_order,
          context,
          vacancyId: effectiveVacancyId
        });
        return {
          sessionId: session.session_id,
          vacancyId: effectiveVacancyId,
          reply: result.reply
        };
      }

      if (result.nextStepOrder == null) {
        await managementStore.completeSession(session.session_id, {
          context,
          vacancyId: effectiveVacancyId
        });
        return {
          sessionId: session.session_id,
          vacancyId: effectiveVacancyId,
          reply: result.reply ?? { kind: "completed", message: "Playbook completed." }
        };
      }

      currentStepOrder = result.nextStepOrder;
      recruiterInput = null;

      await managementStore.updateSession(session.session_id, {
        currentStepOrder,
        context,
        vacancyId: effectiveVacancyId
      });

      if (result.reply) {
        return {
          sessionId: session.session_id,
          vacancyId: effectiveVacancyId,
          reply: result.reply
        };
      }
    } catch (error) {
      if (error instanceof PlaybookLlmError) {
        await managementStore.updateSession(session.session_id, {
          context,
          vacancyId: context.vacancy_id ?? vacancyId ?? null,
          status: "error"
        });
        return {
          sessionId: session.session_id,
          vacancyId: context.vacancy_id ?? vacancyId ?? session.vacancy_id ?? null,
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
