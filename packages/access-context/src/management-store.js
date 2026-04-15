import { randomBytes } from "node:crypto";

const SESSION_TTL_DAYS = 30;
const SESSION_RENEWAL_WINDOW_DAYS = 7;

export function createManagementStore(managementSql) {
  const value = (input) => (input === undefined ? null : input);

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
        SELECT recruiter_id, tenant_id, email, password_hash, status, role
        FROM management.recruiters
        WHERE email = ${value(email)}
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

    async getActiveSession({ tenantId, recruiterId, vacancyId, playbookKey }) {
      const rows = await managementSql`
        SELECT
          session_id,
          tenant_id,
          recruiter_id,
          conversation_id,
          playbook_key,
          current_step_order,
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
          AND vacancy_id IS NOT DISTINCT FROM ${value(vacancyId)}
          AND playbook_key = ${value(playbookKey)}
          AND status = 'active'
        LIMIT 1
      `;
      return rows[0] ?? null;
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
      context = {},
      callStack = []
    }) {
      const rows = await managementSql`
        INSERT INTO management.playbook_sessions (
          tenant_id,
          recruiter_id,
          conversation_id,
          playbook_key,
          current_step_order,
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
          ${value(vacancyId)},
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
          vacancy_id,
          context,
          call_stack,
          status,
          started_at,
          updated_at,
          completed_at
      `;
      return rows[0] ?? null;
    },

    async updateSession(sessionId, {
      currentStepOrder,
      context,
      callStack,
      vacancyId,
      status
    } = {}) {
      const rows = await managementSql`
        UPDATE management.playbook_sessions
        SET
          current_step_order = COALESCE(${value(currentStepOrder)}, current_step_order),
          context = COALESCE(${context === undefined ? null : JSON.stringify(context)}::jsonb, context),
          call_stack = COALESCE(${callStack === undefined ? null : JSON.stringify(callStack)}::jsonb, call_stack),
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
          vacancy_id,
          context,
          call_stack,
          status,
          started_at,
          updated_at,
          completed_at
      `;
      return rows[0] ?? null;
    },

    async completeSession(sessionId, { context, callStack, vacancyId } = {}) {
      const rows = await managementSql`
        UPDATE management.playbook_sessions
        SET
          status = 'completed',
          current_step_order = null,
          context = COALESCE(${context === undefined ? null : JSON.stringify(context)}::jsonb, context),
          call_stack = COALESCE(${callStack === undefined ? null : JSON.stringify(callStack)}::jsonb, call_stack),
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
          vacancy_id,
          context,
          call_stack,
          status,
          started_at,
          updated_at,
          completed_at
      `;
      return rows[0] ?? null;
    },

    async abortActiveSessions({ tenantId, recruiterId, vacancyId, excludePlaybookKey = null }) {
      await managementSql`
        UPDATE management.playbook_sessions
        SET status = 'aborted',
            updated_at = now()
        WHERE tenant_id = ${value(tenantId)}
          AND recruiter_id = ${value(recruiterId)}
          AND vacancy_id IS NOT DISTINCT FROM ${value(vacancyId)}
          AND status = 'active'
          AND (${value(excludePlaybookKey)}::text IS NULL OR playbook_key <> ${value(excludePlaybookKey)})
      `;
    }
  };
}

function randomSessionToken() {
  return randomBytes(32).toString("hex");
}
