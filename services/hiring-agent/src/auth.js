import { randomBytes } from "node:crypto";
import {
  createManagementStore,
  withAccessContextResilience
} from "../../../packages/access-context/src/index.js";

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

export async function resolveSession(sql, token, options = {}) {
  if (!token) return null;
  if (!sql) return { ...DEMO_RECRUITER };

  const managementStore = createManagementStore(sql);
  const session = await withAccessContextResilience(
    () => managementStore.getRecruiterSession(token),
    {
      operationName: "management session lookup",
      timeoutMs: options.timeoutMs,
      message: "Management session lookup timed out"
    }
  );
  if (!session) return null;

  if (session.expires_at && session.expires_at.getTime() < Date.now() + SESSION_RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    void managementStore.renewSessionIfNeeded(token, session.expires_at).catch(() => {});
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
  return createManagementStore(sql).createSession(recruiterId);
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
  return createManagementStore(sql).getRecruiterByEmail(email);
}
