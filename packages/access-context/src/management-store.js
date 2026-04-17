import { randomBytes } from "node:crypto";

const SESSION_TTL_DAYS = 30;
const SESSION_RENEWAL_WINDOW_DAYS = 7;

export function createManagementStore(managementSql) {
  const value = (input) => (input === undefined ? null : input);
  const resolveJobSetupKey = ({ jobSetupId }) => value(jobSetupId ?? null);
  const normalizeSessionRow = (row) => {
    if (!row) return null;
    return {
      ...row
    };
  };

  return {
    async getRecruiterSession(sessionToken) {
      const rows = await managementSql`
        SELECT
          s.session_token,
          s.expires_at,
          r.recruiter_id,
          r.email,
          r.status AS recruiter_status,
          r.role,
          t.tenant_id,
          t.slug AS tenant_slug,
          t.display_name AS tenant_display_name,
          t.status AS tenant_status
        FROM management.sessions s
        JOIN management.recruiters r ON r.recruiter_id = s.recruiter_id
        JOIN management.tenants t ON t.tenant_id = r.tenant_id
        WHERE s.session_token = ${value(sessionToken)}
          AND s.expires_at > now()
      `;
      return rows[0] ?? null;
    },

    async renewSessionIfNeeded(sessionToken, expiresAt) {
      if (!(expiresAt instanceof Date)) return;
      const renewalThreshold = Date.now() + SESSION_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      if (expiresAt.getTime() >= renewalThreshold) return;

      await managementSql`
        UPDATE management.sessions
        SET expires_at = now() + ${`${SESSION_TTL_DAYS} days`}::interval
        WHERE session_token = ${value(sessionToken)}
      `;
    },

    async createSession(recruiterId) {
      const sessionToken = randomSessionToken();
      await managementSql`
        INSERT INTO management.sessions (session_token, recruiter_id, expires_at)
        VALUES (${value(sessionToken)}, ${value(recruiterId)}, now() + ${`${SESSION_TTL_DAYS} days`}::interval)
      `;
      return sessionToken;
    },

    async getRecruiterByEmail(email) {
      const rows = await managementSql`
        SELECT
          r.recruiter_id,
          r.tenant_id,
          r.email,
          r.password_hash,
          r.status,
          r.role,
          t.status AS tenant_status
        FROM management.recruiters r
        JOIN management.tenants t ON t.tenant_id = r.tenant_id
        WHERE r.email = ${value(email)}
      `;
      return rows[0] ?? null;
    },

    async getPrimaryBinding({ tenantId, appEnv }) {
      const rows = await managementSql`
        SELECT binding_id, tenant_id, environment, binding_kind, db_alias, schema_name, is_primary
        FROM management.tenant_database_bindings
        WHERE tenant_id = ${value(tenantId)}
          AND environment = ${value(appEnv)}
          AND is_primary = true
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async getDatabaseConnection(dbAlias) {
      const rows = await managementSql`
        SELECT db_alias, secret_name, connection_string, provider, region, status
        FROM management.database_connections
        WHERE db_alias = ${value(dbAlias)}
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async getPlaybookSteps(playbookKey) {
      const rows = await managementSql`
        SELECT
          step_key,
          playbook_key,
          step_order,
          name,
          step_type,
          user_message,
          prompt_template,
          context_key,
          db_save_column,
          next_step_order,
          options,
          routing,
          notes,
          created_at
        FROM management.playbook_steps
        WHERE playbook_key = ${value(playbookKey)}
        ORDER BY step_order ASC
      `;
      return rows;
    },

    async getActiveSession({ tenantId, recruiterId, vacancyId, jobId = null, jobSetupId = null, playbookKey }) {
      const resolvedJobSetupId = resolveJobSetupKey({ jobSetupId });
      const rows = await managementSql`
        SELECT
          session_id,
          tenant_id,
          recruiter_id,
          conversation_id,
          playbook_key,
          current_step_order,
          job_id,
          job_setup_id,
          vacancy_id,
          context,
          call_stack,
          status,
          started_at,
          updated_at,
          completed_at
        FROM management.playbook_sessions
        WHERE tenant_id = ${value(tenantId)}
          AND recruiter_id = ${value(recruiterId)}
          AND playbook_key = ${value(playbookKey)}
          AND status = 'active'
          AND (
            (${value(jobId)}::text IS NOT NULL AND job_id IS NOT DISTINCT FROM ${value(jobId)})
            OR (${resolvedJobSetupId}::text IS NOT NULL AND job_setup_id IS NOT DISTINCT FROM ${resolvedJobSetupId})
            OR (
              ${value(jobId)}::text IS NULL
              AND ${resolvedJobSetupId}::text IS NULL
              AND job_id IS NULL
              AND job_setup_id IS NULL
            )
          )
        LIMIT 1
      `;
      return normalizeSessionRow(rows[0] ?? null);
    },

    async getPlaybookSessionById({ tenantId, sessionId }) {
      const rows = await managementSql`
        SELECT
          session_id,
          tenant_id,
          recruiter_id,
          conversation_id,
          playbook_key,
          current_step_order,
          job_id,
          job_setup_id,
          vacancy_id,
          context,
          call_stack,
          status,
          started_at,
          updated_at,
          completed_at
        FROM management.playbook_sessions
        WHERE tenant_id = ${value(tenantId)}
          AND session_id = ${value(sessionId)}
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async createPlaybookSession({
      tenantId,
      recruiterId,
      conversationId = null,
      playbookKey,
      currentStepOrder,
      vacancyId = null,
      jobId = null,
      jobSetupId = null,
      context = {},
      callStack = []
    }) {
      const resolvedJobSetupId = resolveJobSetupKey({ jobSetupId, vacancyId });
      const legacyVacancyId = value(vacancyId);
      const rows = await managementSql`
        INSERT INTO management.playbook_sessions (
          tenant_id,
          recruiter_id,
          conversation_id,
          playbook_key,
          current_step_order,
          job_id,
          job_setup_id,
          vacancy_id,
          context,
          call_stack
        )
        VALUES (
          ${value(tenantId)},
          ${value(recruiterId)},
          ${value(conversationId)},
          ${value(playbookKey)},
          ${value(currentStepOrder)},
          ${value(jobId)},
          ${resolvedJobSetupId},
          ${legacyVacancyId},
          ${JSON.stringify(context ?? {})}::jsonb,
          ${JSON.stringify(callStack ?? [])}::jsonb
        )
        RETURNING
          session_id,
          tenant_id,
          recruiter_id,
          conversation_id,
          playbook_key,
          current_step_order,
          job_id,
          job_setup_id,
          vacancy_id,
          context,
          call_stack,
          status,
          started_at,
          updated_at,
          completed_at
      `;
      return normalizeSessionRow(rows[0] ?? null);
    },

    async updateSession(sessionId, {
      currentStepOrder,
      context,
      callStack,
      vacancyId,
      jobId,
      jobSetupId,
      status
    } = {}) {
      const resolvedJobSetupId = resolveJobSetupKey({ jobSetupId });
      const rows = await managementSql`
        UPDATE management.playbook_sessions
        SET
          current_step_order = COALESCE(${value(currentStepOrder)}, current_step_order),
          context = COALESCE(${context === undefined ? null : JSON.stringify(context)}::jsonb, context),
          call_stack = COALESCE(${callStack === undefined ? null : JSON.stringify(callStack)}::jsonb, call_stack),
          job_id = COALESCE(${value(jobId)}, job_id),
          job_setup_id = COALESCE(${resolvedJobSetupId}, job_setup_id),
          vacancy_id = COALESCE(${value(vacancyId)}, vacancy_id),
          status = COALESCE(${value(status)}, status),
          updated_at = now()
        WHERE session_id = ${value(sessionId)}
        RETURNING
          session_id,
          tenant_id,
          recruiter_id,
          conversation_id,
          playbook_key,
          current_step_order,
          job_id,
          job_setup_id,
          vacancy_id,
          context,
          call_stack,
          status,
          started_at,
          updated_at,
          completed_at
      `;
      return normalizeSessionRow(rows[0] ?? null);
    },

    async completeSession(sessionId, { context, callStack, vacancyId, jobId, jobSetupId } = {}) {
      const resolvedJobSetupId = resolveJobSetupKey({ jobSetupId });
      const rows = await managementSql`
        UPDATE management.playbook_sessions
        SET
          status = 'completed',
          current_step_order = null,
          context = COALESCE(${context === undefined ? null : JSON.stringify(context)}::jsonb, context),
          call_stack = COALESCE(${callStack === undefined ? null : JSON.stringify(callStack)}::jsonb, call_stack),
          job_id = COALESCE(${value(jobId)}, job_id),
          job_setup_id = COALESCE(${resolvedJobSetupId}, job_setup_id),
          vacancy_id = COALESCE(${value(vacancyId)}, vacancy_id),
          updated_at = now(),
          completed_at = now()
        WHERE session_id = ${value(sessionId)}
        RETURNING
          session_id,
          tenant_id,
          recruiter_id,
          conversation_id,
          playbook_key,
          current_step_order,
          job_id,
          job_setup_id,
          vacancy_id,
          context,
          call_stack,
          status,
          started_at,
          updated_at,
          completed_at
      `;
      return normalizeSessionRow(rows[0] ?? null);
    },

    async abortActiveSessions({ tenantId, recruiterId, vacancyId, jobId = null, jobSetupId = null, excludePlaybookKey = null }) {
      const resolvedJobSetupId = resolveJobSetupKey({ jobSetupId });
      await managementSql`
        UPDATE management.playbook_sessions
        SET status = 'aborted',
            updated_at = now()
        WHERE tenant_id = ${value(tenantId)}
          AND recruiter_id = ${value(recruiterId)}
          AND status = 'active'
          AND (${value(excludePlaybookKey)}::text IS NULL OR playbook_key <> ${value(excludePlaybookKey)})
          AND (
            (${value(jobId)}::text IS NOT NULL AND job_id IS NOT DISTINCT FROM ${value(jobId)})
            OR (${resolvedJobSetupId}::text IS NOT NULL AND job_setup_id IS NOT DISTINCT FROM ${resolvedJobSetupId})
            OR (
              ${value(jobId)}::text IS NULL
              AND ${resolvedJobSetupId}::text IS NULL
              AND job_id IS NULL
              AND job_setup_id IS NULL
            )
          )
      `;
    }
  };
}

function randomSessionToken() {
  return randomBytes(32).toString("hex");
}
