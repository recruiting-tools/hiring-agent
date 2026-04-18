import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import {
  createManagementStore,
  withAccessContextResilience
} from "../../../packages/access-context/src/index.js";

const SESSION_TTL_DAYS = 30;
const SESSION_RENEWAL_WINDOW_DAYS = 7;
const SESSION_SNAPSHOT_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const SESSION_SNAPSHOT_VERSION = 1;
const LOCAL_DEV_SESSION_SNAPSHOT_SECRET = "local-dev-hiring-agent-session-snapshot-secret";

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

export function sessionSnapshotCookieNameFromSessionCookieName(sessionCookieName) {
  return `${sessionCookieName}_auth`;
}

export function resolveSessionSnapshotSecret(env = process.env) {
  const configuredSecret = env.HIRING_AGENT_SESSION_SNAPSHOT_SECRET
    ?? env.SESSION_SECRET
    ?? env.MANAGEMENT_DATABASE_URL
    ?? null;
  if (configuredSecret) return String(configuredSecret);
  return LOCAL_DEV_SESSION_SNAPSHOT_SECRET;
}

export function createSignedSessionSnapshot(session, sessionToken, options = {}) {
  if (!session || !sessionToken) return null;

  const secret = String(options.secret ?? resolveSessionSnapshotSecret(options.env));
  const nowMs = resolveNowMs(options.now);
  const ttlMs = Number(options.ttlMs ?? SESSION_SNAPSHOT_TTL_MS);
  const payload = {
    v: SESSION_SNAPSHOT_VERSION,
    recruiter_id: session.recruiter_id ?? null,
    tenant_id: session.tenant_id ?? null,
    email: session.email ?? null,
    role: session.role ?? null,
    recruiter_status: session.recruiter_status ?? session.status ?? null,
    tenant_status: session.tenant_status ?? null,
    token_fingerprint: sessionTokenFingerprint(sessionToken),
    exp: nowMs + ttlMs
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signSessionSnapshot(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function resolveSessionFromSignedSnapshot(snapshotToken, sessionToken, options = {}) {
  if (!snapshotToken || !sessionToken) return null;

  const secret = String(options.secret ?? resolveSessionSnapshotSecret(options.env));
  const [encodedPayload = "", providedSignature = "", ...rest] = String(snapshotToken).split(".");
  if (!encodedPayload || !providedSignature || rest.length > 0) return null;

  const expectedSignature = signSessionSnapshot(encodedPayload, secret);
  if (!safeCompare(providedSignature, expectedSignature)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (payload?.v !== SESSION_SNAPSHOT_VERSION) return null;
  if (Number(payload?.exp ?? 0) <= resolveNowMs(options.now)) return null;
  if (payload?.token_fingerprint !== sessionTokenFingerprint(sessionToken)) return null;

  return {
    recruiter_id: payload.recruiter_id ?? null,
    tenant_id: payload.tenant_id ?? null,
    email: payload.email ?? null,
    role: payload.role ?? null,
    recruiter_status: payload.recruiter_status ?? null,
    tenant_status: payload.tenant_status ?? null
  };
}

export async function getRecruiterByEmail(sql, email) {
  if (!email) return null;
  if (!sql) {
    return {
      ...DEMO_RECRUITER,
      email,
      password_hash: null,
      status: "active",
      tenant_status: "active"
    };
  }
  return createManagementStore(sql).getRecruiterByEmail(email);
}

function resolveNowMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "number" && Number.isFinite(now)) return now;
  return Date.now();
}

function sessionTokenFingerprint(sessionToken) {
  return createHash("sha256")
    .update(String(sessionToken))
    .digest("base64url");
}

function signSessionSnapshot(encodedPayload, secret) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
