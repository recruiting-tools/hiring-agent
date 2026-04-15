import { getDemoRuntimeData } from "./demo-runtime-data.js";
import { executeWithDb, runCandidateFunnelPlaybook } from "./playbooks/candidate-funnel.js";
import { runCommunicationPlanPlaybook } from "./playbooks/communication-plan.js";
import { findPlaybook, getPlaybookRegistry } from "./playbooks/registry.js";
import { dispatch } from "./playbooks/runtime.js";
import { routePlaybook } from "./playbooks/router.js";
import {
  PLAYBOOKS_WITHOUT_VACANCY,
  ROUTING_FALLBACK_TEXT,
  STATIC_UTILITY_PLAYBOOK_KEYS,
  buildStaticPlaybookReply
} from "./playbooks/playbook-contracts.js";

const TENANT_DB_TIMEOUT_MS = 5000;

export function createHiringAgentApp(options = {}) {
  const demoMode = options.demoMode ?? true;
  const tenantDbTimeoutMs = options.tenantDbTimeoutMs ?? TENANT_DB_TIMEOUT_MS;
  const managementSql = options.managementSql ?? null;
  const llmAdapter = options.llmAdapter ?? null;
  const communicationPlanLlmConfig = options.communicationPlanLlmConfig ?? {};
  const createVacancyLlmConfig = options.createVacancyLlmConfig ?? {};
  const healthMetadata = {
    app_env: options.appEnv ?? "local",
    deploy_sha: options.deploySha ?? "unknown",
    started_at: options.startedAt ?? null,
    port: options.port ?? null
  };

  return {
    async getHealth({ includePlaybooks = false } = {}) {
      const body = {
        service: "hiring-agent",
        status: "ok",
        mode: demoMode ? "stateless-demo" : "management-auth",
        ...healthMetadata
      };

      if (includePlaybooks) {
        try {
          const playbooks = await getPlaybookRegistry(managementSql);
          body.playbooks = playbooks.map((playbook) => ({
            playbook_key: playbook.playbook_key,
            enabled: playbook.enabled,
            status: playbook.status
          }));
          body.playbook_registry_status = "ok";
        } catch (error) {
          body.playbooks = [];
          body.playbook_registry_status = "error";
          body.playbook_registry_error = error instanceof Error ? error.message : String(error);
        }
      }

      return {
        status: 200,
        body
      };
    },

    async postChatMessage({
      message,
      action = null,
      playbook_key: requestedPlaybookKey = null,
      tenantSql = null,
      tenantId = null,
      recruiterId = null,
      job_id: jobId,
      vacancy_id: vacancyId = null,
      managementSql: requestManagementSql = managementSql
    }) {
      let playbookKey = action === "start_playbook" && requestedPlaybookKey
        ? requestedPlaybookKey
        : await routePlaybook(message, requestManagementSql);

      if (!playbookKey) {
        const registry = await getPlaybookRegistry(requestManagementSql, tenantId);
        playbookKey = await routePlaybookWithLlm({
          message,
          playbooks: registry,
          llmAdapter
        });
      }

      if (!playbookKey) {
        return {
          status: 200,
          body: {
            reply: {
              kind: "fallback_text",
              text: ROUTING_FALLBACK_TEXT
            }
          }
        };
      }

      const playbook = await findPlaybook(playbookKey, requestManagementSql, tenantId);
      if (!playbook) {
        return {
          status: 404,
          body: {
            error: "playbook_not_found"
          }
        };
      }

      if (!playbook.enabled) {
        return {
          status: 200,
          body: {
            reply: {
              kind: "playbook_locked",
              playbook_key: playbook.playbook_key,
              title: playbook.title,
              message: "Этот playbook есть в системе, но не включён для вашего аккаунта."
            }
          }
        };
      }

      if (playbook.playbook_key === "candidate_funnel") {
        if (tenantSql && !jobId) {
          return {
            status: 200,
            body: {
              reply: {
                kind: "fallback_text",
                text: "Выберите вакансию в верхней части экрана, чтобы посмотреть воронку."
              }
            }
          };
        }

        if (tenantSql && tenantId && jobId) {
          const tenantJob = await withTenantDbTimeout(
            () => getTenantJobById(tenantSql, tenantId, jobId),
            { operation: "getTenantJobById", timeoutMs: tenantDbTimeoutMs }
          );
          if (!tenantJob) {
            return {
              status: 404,
              body: {
                error: "job_not_found"
              }
            };
          }
        }

        return {
          status: 200,
          body: {
            reply: tenantSql
              ? await withTenantDbTimeout(
                () => executeWithDb({ sql: tenantSql, tenantId, jobId }),
                { operation: "executeWithDb", timeoutMs: tenantDbTimeoutMs }
              )
              : runCandidateFunnelPlaybook({ runtimeData: getDemoRuntimeData() })
          }
        };
      }

      if (playbook.playbook_key === "setup_communication") {
        const result = await runCommunicationPlanPlaybook({
          tenantSql,
          vacancyId,
          jobId,
          llmAdapter,
          recruiterInput: message,
          llmConfig: communicationPlanLlmConfig
        });
        return {
          status: 200,
          body: { reply: result.reply }
        };
      }

      if (STATIC_UTILITY_PLAYBOOK_KEYS.has(playbookKey)) {
        return {
          status: 200,
          body: { reply: buildStaticPlaybookReply(playbook.playbook_key, playbook) }
        };
      }

      if (!PLAYBOOKS_WITHOUT_VACANCY.has(playbook.playbook_key) && !vacancyId) {
        return {
          status: 200,
          body: {
            reply: {
              kind: "fallback_text",
              text: "Сначала выберите вакансию для этого playbook."
            }
          }
        };
      }

      if (!requestManagementSql) {
        return {
          status: 501,
          body: {
            error: "playbook_runtime_requires_management_db"
          }
        };
      }

      const runtimeResult = await dispatch({
        managementSql: requestManagementSql,
        tenantSql,
        tenantId,
        recruiterId,
        vacancyId,
        playbookKey,
        recruiterInput: message ?? null,
        llmAdapter,
        llmConfig: {
          createVacancy: createVacancyLlmConfig
        }
      });

      return {
        status: 200,
        body: {
          reply: runtimeResult.reply,
          session_id: runtimeResult.sessionId,
          vacancy_id: runtimeResult.vacancyId ?? vacancyId ?? null
        }
      };
    },

    async getJobs({ tenantSql = null, tenantId = null }) {
      if (!tenantSql || !tenantId) {
        return {
          status: 200,
          body: {
            jobs: []
          }
        };
      }

      const rows = await withTenantDbTimeout(
        () => tenantSql`
          SELECT job_id, title
          FROM chatbot.jobs
          WHERE client_id = ${tenantId}
          ORDER BY created_at DESC
        `,
        { operation: "getJobs", timeoutMs: tenantDbTimeoutMs }
      );

      return {
        status: 200,
        body: {
          jobs: rows
        }
      };
    }
  };
}

export class TenantDbTimeoutError extends Error {
  constructor(operation, timeoutMs) {
    super(`Tenant DB operation timed out after ${timeoutMs}ms: ${operation}`);
    this.name = "TenantDbTimeoutError";
    this.code = "tenant_db_timeout";
    this.httpStatus = 503;
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

async function withTenantDbTimeout(run, { operation, timeoutMs }) {
  let timeoutHandle = null;
  try {
    return await Promise.race([
      Promise.resolve().then(run),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new TenantDbTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function getTenantJobById(tenantSql, tenantId, jobId) {
  const rows = await tenantSql`
    SELECT job_id, title
    FROM chatbot.jobs
    WHERE job_id = ${jobId}
      AND client_id = ${tenantId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function routePlaybookWithLlm({ message, playbooks, llmAdapter }) {
  if (!llmAdapter?.generate) return null;

  const recruiterMessage = String(message ?? "").trim();
  if (!recruiterMessage) return null;

  const catalog = Array.isArray(playbooks)
    ? playbooks.map((playbook) => ({
      playbook_key: playbook.playbook_key,
      name: playbook.name ?? playbook.title ?? playbook.playbook_key,
      trigger_description: playbook.trigger_description ?? "",
      enabled: Boolean(playbook.enabled)
    }))
    : [];

  if (catalog.length === 0) return null;

  const prompt = [
    "Ты роутер recruiter-chat.",
    "Выбери самый подходящий playbook по сообщению рекрутера.",
    "Выбирай только из списка ниже. Если не уверен — верни null.",
    "",
    "Список playbook:",
    JSON.stringify(catalog, null, 2),
    "",
    `Сообщение рекрутера: ${JSON.stringify(recruiterMessage)}`,
    "",
    "Верни JSON без markdown:",
    "{\"playbook_key\": \"<key>\" | null}"
  ].join("\n");

  try {
    const raw = await llmAdapter.generate(prompt);
    const parsed = parseJsonResponse(raw);
    const key = typeof parsed?.playbook_key === "string"
      ? parsed.playbook_key.trim()
      : null;

    if (!key) return null;
    return catalog.some((item) => item.playbook_key === key) ? key : null;
  } catch {
    return null;
  }
}

function parseJsonResponse(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const normalized = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}
