import { randomBytes } from "node:crypto";

const SESSION_TTL_DAYS = 30;
const SESSION_RENEWAL_WINDOW_DAYS = 7;

const DEMO_RECRUITER = {
  recruiter_id: "demo-recruiter",
  tenant_id: "tenant-demo",
  email: "demo@local"
};

export function parseCookies(header) {
  if (!header) return {};

  return String(header)
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) return cookies;
      const key = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();
      if (!key) return cookies;
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

export async function resolveSession(sql, token) {
  if (!token) return null;
  if (!sql) return { ...DEMO_RECRUITER };

  const rows = await sql`
    SELECT r.recruiter_id, r.tenant_id, r.email, r.role, r.status AS recruiter_status,
           t.status AS tenant_status, s.expires_at
    FROM management.sessions s
    JOIN management.recruiters r ON r.recruiter_id = s.recruiter_id
    JOIN management.tenants t ON t.tenant_id = r.tenant_id
    WHERE s.session_token = ${token}
      AND s.expires_at > now()
  `;

  const session = rows[0] ?? null;
  if (!session) return null;

  if (session.expires_at && session.expires_at.getTime() < Date.now() + SESSION_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    void sql`
      UPDATE management.sessions
      SET expires_at = now() + ${`${SESSION_TTL_DAYS} days`}::interval
      WHERE session_token = ${token}
    `.catch(() => {});
  }

  return {
    recruiter_id: session.recruiter_id,
    tenant_id: session.tenant_id,
    email: session.email,
    role: session.role,
    recruiter_status: session.recruiter_status,
    tenant_status: session.tenant_status
  };
}

export async function createSession(sql, recruiterId) {
  if (!sql) return `demo-session-${randomBytes(16).toString("hex")}`;

  const token = randomBytes(32).toString("hex");
  await sql`
    INSERT INTO management.sessions (session_token, recruiter_id, expires_at)
    VALUES (${token}, ${recruiterId}, now() + ${`${SESSION_TTL_DAYS} days`}::interval)
  `;
  return token;
}

export async function getRecruiterByEmail(sql, email) {
  if (!email) return null;
  if (!sql) {
    return {
      ...DEMO_RECRUITER,
      email,
      password_hash: null
    };
  }

  const rows = await sql`
    SELECT recruiter_id, tenant_id, email, password_hash, status, role
    FROM management.recruiters
    WHERE email = ${email}
  `;

  return rows[0] ?? null;
}
