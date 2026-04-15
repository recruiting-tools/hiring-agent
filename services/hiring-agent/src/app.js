import { getDemoRuntimeData } from "./demo-runtime-data.js";
import { parseJsonResponse as parseRawJsonResponse } from "./json-response.js";
import { executeWithDb, runCandidateFunnelPlaybook } from "./playbooks/candidate-funnel.js";
import { runCommunicationPlanPlaybook } from "./playbooks/communication-plan.js";
import { canBypassTenantPlaybookLock, canonicalizePlaybookKey } from "./playbooks/playbook-key-map.js";
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
const DATA_RETENTION_CONFIRMATION_TEXT = "delete all my data";
const ACCOUNT_ACCESS_PLAYBOOK_KEY = "account_access";
const DATA_RETENTION_PLAYBOOK_KEY = "data_retention";
const DATA_RETENTION_TRIGGER_TEXT = `Введите ровно: ${DATA_RETENTION_CONFIRMATION_TEXT}`;

const ACCOUNT_ACCESS_QUERY = {
  oauthTokensRemoved: {
    label: "oauth_tokens_removed",
    run: (sql) => sql`
      DELETE FROM management.oauth_tokens
      WHERE provider ILIKE 'hh%'
      RETURNING 1
    `
  },
  featureFlagsDisabled: {
    label: "feature_flags_disabled",
    run: (sql) => sql`
      UPDATE management.feature_flags
        SET enabled = false
      WHERE flag IN ('hh_send', 'hh_import')
      RETURNING 1
    `
  }
};

const MANAGEMENT_TENANT_DATA_QUERIES = [
  {
    key: "tenant_playbook_access_removed",
    query: (sql, tenantId) => sql`
      DELETE FROM management.tenant_playbook_access
      WHERE tenant_id = ${tenantId}
      RETURNING 1
    `
  },
  {
    key: "playbook_sessions_removed",
    query: (sql, tenantId) => sql`
      DELETE FROM management.playbook_sessions
      WHERE tenant_id = ${tenantId}
      RETURNING 1
    `
  },
  {
    key: "recruiter_subscriptions_removed",
    query: (sql, tenantId) => sql`
      DELETE FROM management.recruiter_subscriptions
      WHERE recruiter_id IN (
        SELECT recruiter_id
        FROM management.recruiters
        WHERE tenant_id = ${tenantId}
      )
      RETURNING 1
    `
  },
  {
    key: "sessions_removed",
    query: (sql, tenantId) => sql`
      DELETE FROM management.sessions
      WHERE recruiter_id IN (
        SELECT recruiter_id
        FROM management.recruiters
        WHERE tenant_id = ${tenantId}
      )
      RETURNING 1
    `
  },
  {
    key: "recruiters_removed",
    query: (sql, tenantId) => sql`
      DELETE FROM management.recruiters
      WHERE tenant_id = ${tenantId}
      RETURNING 1
    `
  }
];

const TENANT_DB_DATA_QUERIES = [
  {
    key: "message_delivery_attempts_removed",
    query: (sql) => sql`DELETE FROM chatbot.message_delivery_attempts RETURNING 1`
  },
  {
    key: "planned_messages_removed",
    query: (sql) => sql`DELETE FROM chatbot.planned_messages RETURNING 1`
  },
  {
    key: "messages_removed",
    query: (sql) => sql`DELETE FROM chatbot.messages RETURNING 1`
  },
  {
    key: "pipeline_step_state_removed",
    query: (sql) => sql`DELETE FROM chatbot.pipeline_step_state RETURNING 1`
  },
  {
    key: "pipeline_events_removed",
    query: (sql) => sql`DELETE FROM chatbot.pipeline_events RETURNING 1`
  },
  {
    key: "hh_poll_state_removed",
    query: (sql) => sql`DELETE FROM chatbot.hh_poll_state RETURNING 1`
  },
  {
    key: "hh_negotiations_removed",
    query: (sql) => sql`DELETE FROM chatbot.hh_negotiations RETURNING 1`
  },
  {
    key: "pipeline_runs_removed",
    query: (sql) => sql`DELETE FROM chatbot.pipeline_runs RETURNING 1`
  },
  {
    key: "vacancies_removed",
    query: (sql) => sql`DELETE FROM chatbot.vacancies RETURNING 1`
  },
  {
    key: "conversations_removed",
    query: (sql) => sql`DELETE FROM chatbot.conversations RETURNING 1`
  },
  {
    key: "pipeline_templates_removed",
    query: (sql) => sql`DELETE FROM chatbot.pipeline_templates RETURNING 1`
  },
  {
    key: "sessions_removed",
    query: (sql) => sql`DELETE FROM chatbot.sessions RETURNING 1`
  },
  {
    key: "recruiters_removed",
    query: (sql) => sql`DELETE FROM chatbot.recruiters RETURNING 1`
  },
  {
    key: "candidates_removed",
    query: (sql) => sql`DELETE FROM chatbot.candidates RETURNING 1`
  },
  {
    key: "jobs_removed",
    query: (sql) => sql`DELETE FROM chatbot.jobs RETURNING 1`
  }
];

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
      client_context: clientContext = null,
      tenantSql = null,
      tenantId = null,
      recruiterId = null,
      job_id: jobId,
      vacancy_id: vacancyId = null,
      managementSql: requestManagementSql = managementSql
    }) {
      const requestedJobId = jobId ?? null;
      const requestedVacancyId = vacancyId ?? null;
      const explicitPlaybookKey = canonicalizePlaybookKey(requestedPlaybookKey) || null;
      const useMessageAsRecruiterInput = Boolean(explicitPlaybookKey);

      let playbookKey = explicitPlaybookKey ?? canonicalizePlaybookKey(
        action === "start_playbook" && requestedPlaybookKey
          ? requestedPlaybookKey
          : await routePlaybook(message, requestManagementSql)
      );

      if (!playbookKey) {
        const registry = await getPlaybookRegistry(requestManagementSql, tenantId);
        playbookKey = canonicalizePlaybookKey(await routePlaybookWithLlm({
          message,
          playbooks: registry,
          llmAdapter
        }));
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

      const canBypassLockedState = canBypassTenantPlaybookLock(playbook.playbook_key);
      if (!playbook.enabled && !canBypassLockedState) {
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

      const identity = tenantSql && tenantId
        ? await withTenantDbTimeout(
          () => resolveTenantIdentity({
            tenantSql,
            tenantId,
            jobId: requestedJobId,
            vacancyId: requestedVacancyId,
            seedFromJob: playbook.playbook_key !== "candidate_funnel" && playbook.playbook_key !== "create_vacancy"
          }),
          { operation: "resolveTenantIdentity", timeoutMs: tenantDbTimeoutMs }
        )
        : {
          jobId: requestedJobId,
          vacancyId: requestedVacancyId,
          job: null,
          vacancy: null,
          requestedJobFound: requestedJobId == null,
          requestedVacancyFound: requestedVacancyId == null
        };

      const effectiveJobId = identity.jobId ?? requestedJobId ?? null;
      const effectiveVacancyId = identity.vacancyId ?? requestedVacancyId ?? null;
      const explicitVacancyMissing = hasExplicitVacancyMiss({
        requestedVacancyId,
        effectiveJobId,
        requestedVacancyFound: identity.requestedVacancyFound
      });
      const explicitJobMissing = Boolean(requestedJobId && !identity.requestedJobFound);
      const legacyEchoedJobId = isLegacyEchoedJobId({
        requestedJobId,
        requestedVacancyId,
        requestedVacancyFound: identity.requestedVacancyFound
      });

      if (playbook.playbook_key === "candidate_funnel") {
        if (tenantSql && !effectiveJobId) {
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

        if (explicitVacancyMissing) {
          return {
            status: 404,
            body: {
              error: "vacancy_not_found"
            }
          };
        }

        if (tenantSql && tenantId && explicitJobMissing) {
          return {
            status: 404,
            body: {
              error: "job_not_found"
            }
          };
        }

        return {
          status: 200,
          body: {
            reply: tenantSql
              ? await withTenantDbTimeout(
                () => executeWithDb({ sql: tenantSql, tenantId, jobId: effectiveJobId }),
                { operation: "executeWithDb", timeoutMs: tenantDbTimeoutMs }
              )
              : runCandidateFunnelPlaybook({ runtimeData: getDemoRuntimeData() })
          }
        };
      }

      if (playbook.playbook_key === "setup_communication") {
        if (explicitVacancyMissing) {
          return {
            status: 404,
            body: {
              error: "vacancy_not_found"
            }
          };
        }

        if (explicitJobMissing && !legacyEchoedJobId) {
          return {
            status: 404,
            body: {
              error: "job_not_found"
            }
          };
        }

        const result = await runCommunicationPlanPlaybook({
          tenantSql,
          vacancyId: effectiveVacancyId,
          jobId: effectiveJobId,
          llmAdapter,
          recruiterInput: useMessageAsRecruiterInput ? (message ?? null) : null,
          llmConfig: communicationPlanLlmConfig,
          clientContext
        });
        return {
          status: 200,
          body: {
            reply: result.reply,
            playbook_key: playbook.playbook_key,
            playbook_active: true,
            vacancy_id: effectiveVacancyId,
            job_id: effectiveJobId,
            vacancy_title: identity.vacancy?.title ?? null
          }
        };
      }

      if (playbook.playbook_key === "view_vacancy") {
        if (explicitVacancyMissing) {
          return {
            status: 404,
            body: {
              error: "vacancy_not_found"
            }
          };
        }

        if (explicitJobMissing) {
          return {
            status: 404,
            body: {
              error: "job_not_found"
            }
          };
        }

        if (!tenantSql || !effectiveVacancyId) {
          return {
            status: 200,
            body: {
              reply: {
                kind: "fallback_text",
                text: "Сначала выберите вакансию, чтобы показать её текст."
              }
            }
          };
        }

        return {
          status: 200,
          body: {
            reply: await withTenantDbTimeout(
              () => buildVacancyTextReply({
                tenantSql,
                vacancyId: effectiveVacancyId
              }),
              { operation: "buildVacancyTextReply", timeoutMs: tenantDbTimeoutMs }
            )
          }
        };
      }

      if (playbook.playbook_key === "view_vacancy") {
        if (explicitVacancyMissing) {
          return {
            status: 404,
            body: {
              error: "vacancy_not_found"
            }
          };
        }

        if (explicitJobMissing) {
          return {
            status: 404,
            body: {
              error: "job_not_found"
            }
          };
        }

        if (!tenantSql || !effectiveVacancyId) {
          return {
            status: 200,
            body: {
              reply: {
                kind: "fallback_text",
                text: "Сначала выберите вакансию, чтобы показать её текст."
              }
            }
          };
        }

        return {
          status: 200,
          body: {
            reply: await withTenantDbTimeout(
              () => buildVacancyTextReply({
                tenantSql,
                vacancyId: effectiveVacancyId
              }),
              { operation: "buildVacancyTextReply", timeoutMs: tenantDbTimeoutMs }
            )
          }
        };
      }

      if (playbook.playbook_key === ACCOUNT_ACCESS_PLAYBOOK_KEY) {
        if (!requestManagementSql) {
          return {
            status: 200,
            body: {
              reply: {
                kind: "fallback_text",
                text: "Для управления доступом требуется подключенный management DB."
              }
            }
          };
        }

        return {
          status: 200,
          body: {
            reply: await performAccountAccessRevocation({
              managementSql: requestManagementSql
            })
          }
        };
      }

      if (playbook.playbook_key === DATA_RETENTION_PLAYBOOK_KEY) {
        if (!tenantId) {
          return {
            status: 200,
            body: {
              reply: {
                kind: "fallback_text",
                text: "Для очистки данных откройте сценарий в контексте вашего аккаунта tenant."
              }
            }
          };
        }

        if (!tenantSql || !requestManagementSql) {
          return {
            status: 200,
            body: {
              reply: {
                kind: "fallback_text",
                text: "Для очистки данных нужны tenant SQL и management SQL."
              }
            }
          };
        }

        if (!isDeleteDataConfirmation(message)) {
          return {
            status: 200,
            body: {
              reply: {
                kind: "display",
                content_type: "text",
                content: buildDataRetentionPrompt()
              }
            }
          };
        }

        return {
          status: 200,
          body: {
            reply: await performTenantDataRetention({
              managementSql: requestManagementSql,
              tenantSql,
              tenantId
            })
          }
        };
      }

      if (STATIC_UTILITY_PLAYBOOK_KEYS.has(playbookKey)) {
        return {
          status: 200,
          body: { reply: buildStaticPlaybookReply(playbook.playbook_key, playbook) }
        };
      }

      if (!PLAYBOOKS_WITHOUT_VACANCY.has(playbook.playbook_key) && !effectiveVacancyId) {
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

      if (playbook.playbook_key !== "create_vacancy") {
        if (explicitVacancyMissing) {
          return {
            status: 404,
            body: {
              error: "vacancy_not_found"
            }
          };
        }

        if (explicitJobMissing) {
          return {
            status: 404,
            body: {
              error: "job_not_found"
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
        jobId: effectiveJobId,
        playbookKey,
        recruiterInput: useMessageAsRecruiterInput ? (message ?? null) : null,
        llmAdapter,
        llmConfig: {
          createVacancy: createVacancyLlmConfig
        }
      });

      const runtimeVacancyId = runtimeResult.vacancyId ?? effectiveVacancyId ?? null;
      const runtimeJobId = runtimeResult.jobId ?? effectiveJobId ?? null;
      const runtimeVacancyTitle = runtimeResult.context?.vacancy?.title ?? identity.vacancy?.title ?? null;
      const runtimePlaybookActive = runtimeResult.reply?.kind !== "completed";
      let reply = runtimeResult.reply;

      if (playbook.playbook_key === "create_vacancy") {
        const followUpReply = await resolveCreateVacancyFollowUp({
          tenantSql,
          llmAdapter,
          communicationPlanLlmConfig,
          runtimeReply: runtimeResult.reply,
          runtimeContext: runtimeResult.context,
          vacancyId: runtimeVacancyId,
          jobId: runtimeJobId
        });
        if (followUpReply) {
          reply = followUpReply;
        }
      }

      return {
        status: 200,
        body: {
          reply,
          playbook_key: playbook.playbook_key,
          playbook_active: runtimePlaybookActive,
          session_id: runtimeResult.sessionId,
          vacancy_id: runtimeVacancyId,
          job_id: runtimeJobId,
          vacancy_title: runtimeVacancyTitle
        }
      };
    },

    async getVacancies({ tenantSql = null, tenantId = null }) {
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

      const jobsRows = await withTenantDbTimeout(
        () => {
          if (tenantId) {
            return tenantSql`
              SELECT job_id, title
              FROM chatbot.jobs
              WHERE client_id = ${tenantId}
              ORDER BY created_at DESC
            `;
          }

          return tenantSql`
            SELECT job_id, title
            FROM chatbot.jobs
            ORDER BY created_at DESC
          `;
        },
        { operation: "getVacancies", timeoutMs: tenantDbTimeoutMs }
      );

      const synthesizedRows = jobsRows.map((job) => ({
        vacancy_id: job.job_id,
        job_id: job.job_id,
        title: job.title,
        status: "active",
        extraction_status: "pending"
      }));

      const seenKeys = new Set(
        rows.map((row) => String(row.job_id ?? row.vacancy_id ?? ""))
      );
      const mergedRows = [
        ...rows,
        ...synthesizedRows.filter((row) => !seenKeys.has(String(row.job_id ?? row.vacancy_id ?? "")))
      ];

      return {
        status: 200,
        body: {
          jobs: mergedRows,
          vacancies: mergedRows
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

async function getTenantVacancyByJobId(tenantSql, jobId) {
  const rows = await tenantSql`
    SELECT vacancy_id, job_id, title, status, extraction_status
    FROM chatbot.vacancies
    WHERE job_id = ${jobId}
    ORDER BY
      CASE status
        WHEN 'active' THEN 0
        WHEN 'draft' THEN 1
        ELSE 2
      END ASC,
      updated_at DESC NULLS LAST,
      created_at DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function getTenantJobById(tenantSql, tenantId, jobId) {
  if (!tenantId) return null;

  const rows = await tenantSql`
    SELECT job_id, title, description
    FROM chatbot.jobs
    WHERE job_id = ${jobId}
      AND client_id = ${tenantId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function seedVacancyFromJob(tenantSql, job) {
  await tenantSql`
    INSERT INTO chatbot.vacancies (
      vacancy_id,
      job_id,
      title,
      raw_text,
      status,
      extraction_status
    ) VALUES (
      ${job.job_id},
      ${job.job_id},
      ${job.title ?? "Без названия"},
      ${job.description ?? ""},
      'active',
      'pending'
    )
    ON CONFLICT (vacancy_id) DO NOTHING
  `;
}

async function resolveTenantIdentity({ tenantSql, tenantId, jobId = null, vacancyId = null, seedFromJob = false }) {
  let job = null;
  let vacancy = null;
  let resolvedJobId = jobId ?? null;
  let resolvedVacancyId = vacancyId ?? null;
  let requestedVacancyFound = vacancyId == null;
  let requestedJobFound = jobId == null;

  if (vacancyId) {
    vacancy = await getTenantVacancyById(tenantSql, vacancyId);
    if (vacancy) {
      requestedVacancyFound = true;
      resolvedVacancyId = vacancy.vacancy_id;
      if (!resolvedJobId && vacancy.job_id) {
        resolvedJobId = vacancy.job_id;
      }
    }
  }

  if (!resolvedJobId && vacancyId) {
    resolvedJobId = vacancyId;
  }

  if (resolvedJobId) {
    job = await getTenantJobById(tenantSql, tenantId, resolvedJobId);
    if (jobId) {
      requestedJobFound = Boolean(job);
    }
  }

  if (!job && vacancy?.job_id) {
    job = await getTenantJobById(tenantSql, tenantId, vacancy.job_id);
    if (job) {
      resolvedJobId = job.job_id;
    }
  }

  const shouldLookupVacancyByJob = Boolean(
    !vacancy
    && resolvedJobId
    && (
      job
      || (vacancyId && vacancyId === resolvedJobId)
    )
  );

  if (shouldLookupVacancyByJob) {
    vacancy = await getTenantVacancyByJobId(tenantSql, resolvedJobId);
    if (vacancy) {
      resolvedVacancyId = vacancy.vacancy_id;
    } else if (seedFromJob && job && (vacancyId == null || vacancyId === resolvedJobId)) {
      await seedVacancyFromJob(tenantSql, job);
      vacancy = await getTenantVacancyByJobId(tenantSql, resolvedJobId);
      if (vacancy) {
        resolvedVacancyId = vacancy.vacancy_id;
      }
    }
  }

  return {
    jobId: job?.job_id ?? resolvedJobId ?? null,
    vacancyId: vacancy?.vacancy_id ?? resolvedVacancyId ?? null,
    job,
    vacancy,
    requestedJobFound,
    requestedVacancyFound
  };
}

function hasExplicitVacancyMiss({ requestedVacancyId, effectiveJobId, requestedVacancyFound }) {
  return Boolean(
    requestedVacancyId
    && !requestedVacancyFound
    && requestedVacancyId !== (effectiveJobId ?? null)
  );
}

function isLegacyEchoedJobId({ requestedJobId, requestedVacancyId, requestedVacancyFound }) {
  return Boolean(
    requestedJobId
    && requestedVacancyId
    && requestedJobId === requestedVacancyId
    && requestedVacancyFound
  );
}

function isDeleteDataConfirmation(rawMessage) {
  return normalizeText(rawMessage) === DATA_RETENTION_CONFIRMATION_TEXT;
}

function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDataRetentionPrompt() {
  return [
    "Для очистки данных введите ровно:",
    DATA_RETENTION_TRIGGER_TEXT
  ].join("\n");
}

async function performAccountAccessRevocation({ managementSql }) {
  const accessResetSummary = await runAccountAccessRevocation({ managementSql });
  const tokenCount = accessResetSummary[ACCOUNT_ACCESS_QUERY.oauthTokensRemoved.label];
  const flagCount = accessResetSummary[ACCOUNT_ACCESS_QUERY.featureFlagsDisabled.label];
  const allGood = tokenCount > 0 || flagCount > 0;

  return {
    kind: "display",
    content_type: "text",
    content: [
      "Доступ к hh.ru отключён.",
      `Удалено OAuth-записей: ${tokenCount}`,
      `Отключено флагов hh_send/hh_import: ${flagCount}`,
      allGood
        ? "Действия выполнены. Для новой интеграции можно снова пройти OAuth-подключение."
        : "Подключение уже было отключено или уже пусто."
    ].join("\n")
  };
}

async function performTenantDataRetention({ managementSql, tenantSql, tenantId }) {
  const accessSummary = await runAccountAccessRevocation({ managementSql });
  const managementStats = {
    ...accessSummary,
    ...(await runManagementTenantCleanup({ managementSql, tenantId }))
  };
  const tenantStats = await runTenantDataCleanup(tenantSql);

  return {
    kind: "display",
    content_type: "text",
    content: [
      "Очистка данных выполнена.",
      `Management: oauth_tokens=${managementStats.oauth_tokens_removed}, feature_flags=${managementStats.feature_flags_disabled}, recruiter_access=${managementStats.tenant_playbook_access_removed}, playbook_sessions=${managementStats.playbook_sessions_removed}, recruiter_subscriptions=${managementStats.recruiter_subscriptions_removed}, sessions=${managementStats.sessions_removed}, recruiters=${managementStats.recruiters_removed}`,
      `Tenant DB: pipeline_templates=${tenantStats.pipeline_templates_removed}, message_delivery_attempts=${tenantStats.message_delivery_attempts_removed}, hh_poll_state=${tenantStats.hh_poll_state_removed}, messages=${tenantStats.messages_removed}, planned_messages=${tenantStats.planned_messages_removed}, pipeline_step_state=${tenantStats.pipeline_step_state_removed}, pipeline_events=${tenantStats.pipeline_events_removed}, hh_negotiations=${tenantStats.hh_negotiations_removed}, pipeline_runs=${tenantStats.pipeline_runs_removed}, conversations=${tenantStats.conversations_removed}, vacancies=${tenantStats.vacancies_removed}, recruiters=${tenantStats.recruiters_removed}, sessions=${tenantStats.sessions_removed}, candidates=${tenantStats.candidates_removed}, jobs=${tenantStats.jobs_removed}`
    ].join("\n")
  };
}

async function runAccountAccessRevocation({ managementSql }) {
  const revokedTokens = await ACCOUNT_ACCESS_QUERY.oauthTokensRemoved.run(managementSql);
  const disabledFlags = await ACCOUNT_ACCESS_QUERY.featureFlagsDisabled.run(managementSql);

  return {
    [ACCOUNT_ACCESS_QUERY.oauthTokensRemoved.label]: revokedTokens.length,
    [ACCOUNT_ACCESS_QUERY.featureFlagsDisabled.label]: disabledFlags.length
  };
}

async function runManagementTenantCleanup({ managementSql, tenantId }) {
  const entries = {};
  for (const cleanup of MANAGEMENT_TENANT_DATA_QUERIES) {
    const rows = await cleanup.query(managementSql, tenantId);
    entries[cleanup.key] = rows.length;
  }
  return entries;
}

async function runTenantDataCleanup(tenantSql) {
  const entries = {};
  for (const cleanup of TENANT_DB_DATA_QUERIES) {
    const rows = await cleanup.query(tenantSql);
    entries[cleanup.key] = rows.length;
  }
  return entries;
}

async function buildVacancyTextReply({ tenantSql, vacancyId }) {
  const rows = await tenantSql`
    SELECT
      vacancy_id,
      title,
      raw_text,
      must_haves,
      nice_haves
    FROM chatbot.vacancies
    WHERE vacancy_id = ${vacancyId}
    LIMIT 1
  `;
  const vacancy = rows[0] ?? null;

  if (!vacancy) {
    return {
      kind: "fallback_text",
      text: "Не удалось найти текущую вакансию."
    };
  }

  const rawText = String(vacancy.raw_text ?? "").trim();
  const mustHaves = Array.isArray(vacancy.must_haves) ? vacancy.must_haves : [];
  const niceHaves = Array.isArray(vacancy.nice_haves) ? vacancy.nice_haves : [];

  if (rawText) {
    return {
      kind: "display",
      content_type: "text",
      content: [
        `Текст вакансии: ${vacancy.title ?? "без названия"}`,
        "",
        rawText
      ].join("\n")
    };
  }

  const lines = [
    `Текст вакансии: ${vacancy.title ?? "без названия"}`,
    "",
    "У исходной вакансии нет поля raw_text. Показываю краткую выжимку:"
  ];

  if (mustHaves.length > 0) {
    lines.push("", "Обязательные требования:");
    lines.push(...mustHaves.map((item) => `- ${item}`));
  }

  if (niceHaves.length > 0) {
    lines.push("", "Желательные требования:");
    lines.push(...niceHaves.map((item) => `- ${item}`));
  }

  if (mustHaves.length === 0 && niceHaves.length === 0) {
    lines.push("", "Данных для выжимки пока нет.");
  }

  return {
    kind: "display",
    content_type: "text",
    content: lines.join("\n")
  };
}

async function routePlaybookWithLlm({ message, playbooks, llmAdapter }) {
  if (!llmAdapter?.generate) return null;

  const recruiterMessage = String(message ?? "").trim();
  if (!recruiterMessage) return null;

  const catalog = Array.isArray(playbooks)
    ? playbooks.map((playbook) => ({
      playbook_key: canonicalizePlaybookKey(playbook.playbook_key),
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
    const parsed = safeParseJsonResponse(raw);
    const key = typeof parsed?.playbook_key === "string"
      ? parsed.playbook_key.trim()
      : null;
    const normalizedKey = canonicalizePlaybookKey(key);

    if (!normalizedKey) return null;
    return catalog.some((item) => item.playbook_key === normalizedKey) ? normalizedKey : null;
  } catch {
    return null;
  }
}

function safeParseJsonResponse(raw) {
  try {
    return parseRawJsonResponse(raw);
  } catch {
    return null;
  }
}

async function resolveCreateVacancyFollowUp({
  tenantSql,
  llmAdapter,
  communicationPlanLlmConfig,
  runtimeReply,
  runtimeContext,
  vacancyId,
  jobId
}) {
  if (runtimeReply?.kind !== "completed") {
    return null;
  }

  const action = detectCreateVacancyNextAction(runtimeContext?.next_action);
  if (action === "setup_communication") {
    const result = await runCommunicationPlanPlaybook({
      tenantSql,
      vacancyId,
      jobId,
      llmAdapter,
      recruiterInput: null,
      llmConfig: communicationPlanLlmConfig
    });
    return result.reply;
  }

  if (action === "compare_vacancies") {
    return await buildVacancyComparisonReply({
      tenantSql,
      vacancyId
    });
  }

  return null;
}

function detectCreateVacancyNextAction(rawAction) {
  const action = String(rawAction ?? "").trim().toLowerCase();
  if (!action) return null;

  if (
    action.includes("распланировать общение")
    || action.includes("настроить общение")
  ) {
    return "setup_communication";
  }

  if (action.includes("сравнить") && action.includes("ваканси")) {
    return "compare_vacancies";
  }

  return null;
}

async function buildVacancyComparisonReply({ tenantSql, vacancyId }) {
  if (!tenantSql) {
    return {
      kind: "fallback_text",
      text: "Сравнение вакансий доступно только при подключенной базе данных."
    };
  }

  if (!vacancyId) {
    return {
      kind: "fallback_text",
      text: "Не удалось определить текущую вакансию для сравнения."
    };
  }

  const currentRows = await tenantSql`
    SELECT
      vacancy_id,
      title,
      status,
      extraction_status,
      must_haves,
      application_steps,
      communication_plan
    FROM chatbot.vacancies
    WHERE vacancy_id = ${vacancyId}
    LIMIT 1
  `;
  const current = currentRows[0] ?? null;
  if (!current) {
    return {
      kind: "fallback_text",
      text: "Текущая вакансия не найдена, сравнение недоступно."
    };
  }

  const otherRows = await tenantSql`
    SELECT
      vacancy_id,
      title,
      status,
      extraction_status,
      must_haves,
      application_steps,
      communication_plan
    FROM chatbot.vacancies
    WHERE vacancy_id <> ${vacancyId}
      AND status <> 'archived'
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 5
  `;

  const rows = [current, ...otherRows];
  const table = rows
    .map((row, index) => {
      const title = index === 0
        ? `${escapeMarkdownTableCell(row.title ?? "Без названия")} (текущая)`
        : escapeMarkdownTableCell(row.title ?? "Без названия");
      const status = escapeMarkdownTableCell(formatVacancyStatus(row));
      const mustHaves = escapeMarkdownTableCell(formatMustHaves(row.must_haves));
      const stepsCount = Array.isArray(row.application_steps) ? row.application_steps.length : 0;
      const communicationState = row.communication_plan ? "Настроено" : "Нет";
      return `| ${title} | ${status} | ${mustHaves} | ${stepsCount} | ${communicationState} |`;
    })
    .join("\n");

  return {
    kind: "fallback_text",
    text: [
      "## Сравнение с другими вакансиями",
      "",
      "| Вакансия | Статус | Маст-хэвы | Шагов найма | Коммуникация |",
      "|---|---|---|---:|---|",
      table,
      "",
      otherRows.length === 0
        ? "_Других активных вакансий для сравнения пока нет._"
        : "_Показал до 5 последних вакансий из базы._"
    ].join("\n")
  };
}

function formatVacancyStatus(row) {
  const status = String(row?.status ?? "unknown");
  const extraction = String(row?.extraction_status ?? "unknown");
  return `${status}/${extraction}`;
}

function formatMustHaves(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return "—";
  }

  const top = raw
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 3);
  return top.length ? top.join(", ") : "—";
}

function escapeMarkdownTableCell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|");
}
