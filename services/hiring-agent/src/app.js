import { getDemoRuntimeData } from "./demo-runtime-data.js";
import { executeWithDb, runCandidateFunnelPlaybook } from "./playbooks/candidate-funnel.js";
import { findPlaybook, getPlaybookRegistry } from "./playbooks/registry.js";
import { routePlaybook } from "./playbooks/router.js";

export function createHiringAgentApp(options = {}) {
  const demoMode = options.demoMode ?? true;
  const healthMetadata = {
    app_env: options.appEnv ?? "local",
    deploy_sha: options.deploySha ?? "unknown",
    started_at: options.startedAt ?? null,
    port: options.port ?? null
  };

  return {
    getHealth() {
      return {
        status: 200,
        body: {
          service: "hiring-agent",
          status: "ok",
          mode: demoMode ? "stateless-demo" : "management-auth",
          ...healthMetadata,
          playbooks: getPlaybookRegistry().map((playbook) => ({
            playbook_key: playbook.playbook_key,
            enabled: playbook.enabled,
            status: playbook.status
          }))
        }
      };
    },

    async postChatMessage({ message, tenantSql = null, tenantId = null, job_id: jobId }) {
      const playbookKey = routePlaybook(message);
      if (!playbookKey) {
        return {
          status: 200,
          body: {
            reply: {
              kind: "fallback_text",
              text: "Я пока поддерживаю только визуализацию воронки, план коммуникации и выборочную рассылку."
            }
          }
        };
      }

      const playbook = findPlaybook(playbookKey);
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
          const tenantJob = await getTenantJobById(tenantSql, tenantId, jobId);
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
              ? await executeWithDb({ sql: tenantSql, tenantId, jobId })
              : runCandidateFunnelPlaybook({ runtimeData: getDemoRuntimeData() })
          }
        };
      }

      return {
        status: 501,
        body: {
          error: "playbook_not_implemented"
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

      const rows = await tenantSql`
        SELECT job_id, title
        FROM chatbot.jobs
        WHERE client_id = ${tenantId}
        ORDER BY created_at DESC
      `;

      return {
        status: 200,
        body: {
          jobs: rows
        }
      };
    }
  };
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
