import { randomBytes } from "node:crypto";

const SESSION_TTL_DAYS = 30;
const SESSION_RENEWAL_WINDOW_DAYS = 7;

export function createManagementStore(managementSql) {
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
        WHERE s.session_token = ${sessionToken}
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
        WHERE session_token = ${sessionToken}
      `;
    },

    async createSession(recruiterId) {
      const sessionToken = randomSessionToken();
      await managementSql`
        INSERT INTO management.sessions (session_token, recruiter_id, expires_at)
        VALUES (${sessionToken}, ${recruiterId}, now() + ${`${SESSION_TTL_DAYS} days`}::interval)
      `;
      return sessionToken;
    },

    async getRecruiterByEmail(email) {
      const rows = await managementSql`
        SELECT recruiter_id, tenant_id, email, password_hash, status, role
        FROM management.recruiters
        WHERE email = ${email}
      `;
      return rows[0] ?? null;
    },

    async getPrimaryBinding({ tenantId, appEnv }) {
      const rows = await managementSql`
        SELECT binding_id, tenant_id, environment, binding_kind, db_alias, schema_name, is_primary
        FROM management.tenant_database_bindings
        WHERE tenant_id = ${tenantId}
          AND environment = ${appEnv}
          AND is_primary = true
        LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async getDatabaseConnection(dbAlias) {
      const rows = await managementSql`
        SELECT db_alias, secret_name, connection_string, provider, region, status
        FROM management.database_connections
        WHERE db_alias = ${dbAlias}
        LIMIT 1
      `;
      return rows[0] ?? null;
    }
  };
}

function randomSessionToken() {
  return randomBytes(32).toString("hex");
}
