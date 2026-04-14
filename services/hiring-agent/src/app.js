import { getDemoRuntimeData } from "./demo-runtime-data.js";
import { executeWithDb, runCandidateFunnelPlaybook } from "./playbooks/candidate-funnel.js";
import { runCommunicationPlanPlaybook } from "./playbooks/communication-plan.js";
import { findPlaybook, getPlaybookRegistry } from "./playbooks/registry.js";
import { dispatch } from "./playbooks/runtime.js";
import { routePlaybook } from "./playbooks/router.js";

const TENANT_DB_TIMEOUT_MS = 5000;

export function createHiringAgentApp(options = {}) {
  const demoMode = options.demoMode ?? true;
  const tenantDbTimeoutMs = options.tenantDbTimeoutMs ?? TENANT_DB_TIMEOUT_MS;
  const managementSql = options.managementSql ?? null;
  const llmAdapter = options.llmAdapter ?? null;
  const healthMetadata = {
    app_env: options.appEnv ?? "local",
    deploy_sha: options.deploySha ?? "unknown",
    started_at: options.startedAt ?? null,
    port: options.port ?? null
  };

  return {
    async getHealth() {
      const playbooks = await getPlaybookRegistry(managementSql);
      return {
        status: 200,
        body: {
          service: "hiring-agent",
          status: "ok",
          mode: demoMode ? "stateless-demo" : "management-auth",
          ...healthMetadata,
          playbooks: playbooks.map((playbook) => ({
            playbook_key: playbook.playbook_key,
            enabled: playbook.enabled,
            status: playbook.status
          }))
        }
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
      const effectiveVacancyId = vacancyId ?? jobId ?? null;
      const playbookKey = action === "start_playbook" && requestedPlaybookKey
        ? requestedPlaybookKey
        : await routePlaybook(message, requestManagementSql);
      if (!playbookKey) {
        return {
          status: 200,
          body: {
            reply: {
              kind: "fallback_text",
              text: "Не понял запрос. Сейчас доступны сценарии по вакансии, воронке, настройке общения и массовой рассылке."
            }
          }
        };
      }

      const playbook = await findPlaybook(playbookKey, requestManagementSql);
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

      if (!requestManagementSql && playbook.playbook_key === "candidate_funnel") {
        if (tenantSql && !effectiveVacancyId) {
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

        if (tenantSql && tenantId && effectiveVacancyId) {
          const tenantJob = await withTenantDbTimeout(
            () => getTenantJobById(tenantSql, tenantId, effectiveVacancyId),
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
                () => executeWithDb({ sql: tenantSql, tenantId, jobId: effectiveVacancyId }),
                { operation: "executeWithDb", timeoutMs: tenantDbTimeoutMs }
              )
              : runCandidateFunnelPlaybook({ runtimeData: getDemoRuntimeData() })
          }
        };
      }

      if (!requestManagementSql && playbook.playbook_key === "setup_communication") {
        if (tenantSql && tenantId && effectiveVacancyId) {
          const tenantJob = await withTenantDbTimeout(
            () => getTenantJobById(tenantSql, tenantId, effectiveVacancyId),
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

        const result = await runCommunicationPlanPlaybook({
          tenantSql,
          vacancyId: effectiveVacancyId,
          llmAdapter
        });
        return {
          status: 200,
          body: { reply: result.reply }
        };
      }

      if (playbook.playbook_key !== "create_vacancy" && !effectiveVacancyId) {
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

      if (playbook.playbook_key !== "create_vacancy" && tenantSql && effectiveVacancyId) {
        const tenantVacancy = await withTenantDbTimeout(
          () => getTenantVacancyById(tenantSql, effectiveVacancyId),
          { operation: "getTenantVacancyById", timeoutMs: tenantDbTimeoutMs }
        );
        if (!tenantVacancy) {
          return {
            status: 404,
            body: {
              error: "vacancy_not_found"
            }
          };
        }
      }

      const runtimeResult = await dispatch({
        managementSql: requestManagementSql,
        tenantSql,
        tenantId,
        recruiterId,
        vacancyId: effectiveVacancyId,
        playbookKey,
        recruiterInput: message ?? null,
        llmAdapter
      });

      return {
        status: 200,
        body: {
          reply: runtimeResult.reply,
          session_id: runtimeResult.sessionId,
          vacancy_id: runtimeResult.vacancyId ?? effectiveVacancyId ?? null
        }
      };
    },

    async getVacancies({ tenantSql = null }) {
      if (!tenantSql) {
        return {
          status: 200,
          body: {
            jobs: [],
            vacancies: []
          }
        };
      }

      const rows = await withTenantDbTimeout(
        () => tenantSql`
          SELECT vacancy_id, job_id, title, status, extraction_status
          FROM chatbot.vacancies
          WHERE status != 'archived'
          ORDER BY updated_at DESC NULLS LAST, created_at DESC
        `,
        { operation: "getVacancies", timeoutMs: tenantDbTimeoutMs }
      );

      return {
        status: 200,
        body: {
          jobs: rows,
          vacancies: rows
        }
      };
    },

    async getJobs({ tenantSql = null, tenantId = null }) {
      return this.getVacancies({ tenantSql, tenantId });
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

async function getTenantVacancyById(tenantSql, vacancyId) {
  const rows = await tenantSql`
    SELECT vacancy_id, job_id, title, status, extraction_status
    FROM chatbot.vacancies
    WHERE vacancy_id = ${vacancyId}
    LIMIT 1
  `;

  return rows[0] ?? null;
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
