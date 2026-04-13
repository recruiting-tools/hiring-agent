import { getDemoRuntimeData } from "./demo-runtime-data.js";
import { executeWithDb, runCandidateFunnelPlaybook } from "./playbooks/candidate-funnel.js";
import { findPlaybook, getPlaybookRegistry } from "./playbooks/registry.js";
import { routePlaybook } from "./playbooks/router.js";

// sql is an optional postgres client — if null the app falls back to demo data.
// Callers (index.js, tests) create and own the client; they must call sql.end() on shutdown.
export function createHiringAgentApp(sql = null) {

  return {
    getHealth() {
      return {
        status: 200,
        body: {
          service: "hiring-agent",
          status: "ok",
          mode: sql ? "db-connected" : "stateless-demo",
          playbooks: getPlaybookRegistry().map((playbook) => ({
            playbook_key: playbook.playbook_key,
            enabled: playbook.enabled,
            status: playbook.status
          }))
        }
      };
    },

    async postChatMessage({ message, recruiter_token: _recruiterToken, job_id: jobId }) {
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
        return {
          status: 200,
          body: {
            reply: sql
              ? await executeWithDb({ sql, jobId })
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
    }
  };
}
