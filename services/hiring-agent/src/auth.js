import { randomBytes } from "node:crypto";

const DEMO_RECRUITER = {
  recruiter_id: "demo-recruiter",
  client_id: "demo-client",
  recruiter_token: "rec-tok-demo-001",
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
    SELECT r.recruiter_id, r.client_id, r.recruiter_token, r.email
    FROM chatbot.sessions s
    JOIN chatbot.recruiters r ON r.recruiter_id = s.recruiter_id
    WHERE s.session_token = ${token}
      AND s.expires_at > now()
  `;

  return rows[0] ?? null;
}

export async function createSession(sql, recruiterId) {
  if (!sql) return `demo-session-${randomBytes(16).toString("hex")}`;

  const token = randomBytes(32).toString("hex");
  await sql`
    INSERT INTO chatbot.sessions (session_token, recruiter_id, expires_at)
    VALUES (${token}, ${recruiterId}, now() + interval '7 days')
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
    SELECT recruiter_id, client_id, recruiter_token, email, password_hash
    FROM chatbot.recruiters
    WHERE email = ${email}
  `;

  return rows[0] ?? null;
}
