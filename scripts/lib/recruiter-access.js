import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export function generatePassword(length = 18) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let password = "";
  for (let index = 0; index < length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }
  return password;
}

export function buildRecruiterLookupClause({ recruiterId, email, token }) {
  const clauses = [];
  const values = [];

  if (recruiterId) {
    clauses.push(`r.recruiter_id = $${values.length + 1}`);
    values.push(recruiterId);
  }
  if (email) {
    clauses.push(`r.email = $${values.length + 1}`);
    values.push(email);
  }
  if (token) {
    clauses.push(`r.recruiter_token = $${values.length + 1}`);
    values.push(token);
  }

  if (clauses.length === 0) {
    throw new Error("Provide at least one recruiter identifier: --recruiter-id, --email, or --token");
  }

  return {
    whereSql: clauses.join(" AND "),
    values
  };
}

export async function listRecruiters(client, { clientId = null } = {}) {
  const values = [];
  const whereSql = clientId
    ? `WHERE r.client_id = $${values.push(clientId)}`
    : "";
  const result = await client.query(`
    SELECT
      current_database() AS database_name,
      r.recruiter_id,
      r.client_id,
      c.name AS client_name,
      r.email,
      r.recruiter_token,
      (r.password_hash IS NOT NULL) AS has_password,
      COUNT(DISTINCT j.job_id)::int AS visible_jobs
    FROM chatbot.recruiters r
    LEFT JOIN management.clients c ON c.client_id = r.client_id
    LEFT JOIN chatbot.jobs j ON j.client_id = r.client_id
    ${whereSql}
    GROUP BY current_database(), r.recruiter_id, r.client_id, c.name, r.email, r.recruiter_token, r.password_hash
    ORDER BY c.name NULLS LAST, r.email NULLS LAST, r.recruiter_id
  `, values);
  return result.rows;
}

export async function ensureClientExists(client, clientId) {
  const result = await client.query(`
    SELECT client_id, name
    FROM management.clients
    WHERE client_id = $1
  `, [clientId]);
  if (result.rows.length === 0) {
    throw new Error(`Client not found: ${clientId}`);
  }
  return result.rows[0];
}

export async function findRecruiters(client, lookup) {
  const { whereSql, values } = buildRecruiterLookupClause(lookup);
  const result = await client.query(`
    SELECT
      current_database() AS database_name,
      r.recruiter_id,
      r.client_id,
      c.name AS client_name,
      r.email,
      r.recruiter_token,
      (r.password_hash IS NOT NULL) AS has_password,
      COUNT(DISTINCT j.job_id)::int AS visible_jobs
    FROM chatbot.recruiters r
    LEFT JOIN management.clients c ON c.client_id = r.client_id
    LEFT JOIN chatbot.jobs j ON j.client_id = r.client_id
    WHERE ${whereSql}
    GROUP BY current_database(), r.recruiter_id, r.client_id, c.name, r.email, r.recruiter_token, r.password_hash
    ORDER BY r.recruiter_id
  `, values);
  return result.rows;
}

export function assertSingleRecruiter(rows, lookup) {
  if (rows.length === 0) {
    throw new Error(`Recruiter not found for lookup ${JSON.stringify(lookup)}`);
  }
  if (rows.length > 1) {
    const ids = rows.map((row) => row.recruiter_id).join(", ");
    throw new Error(`Recruiter lookup is ambiguous; matched: ${ids}`);
  }
  return rows[0];
}

export async function assertEmailAvailable(client, email, recruiterId = null) {
  if (!email) return;
  const values = [email];
  const recruiterFilter = recruiterId
    ? `AND recruiter_id <> $${values.push(recruiterId)}`
    : "";
  const result = await client.query(`
    SELECT recruiter_id
    FROM chatbot.recruiters
    WHERE email = $1
    ${recruiterFilter}
    LIMIT 1
  `, values);
  if (result.rows.length > 0) {
    throw new Error(`Email is already used by recruiter ${result.rows[0].recruiter_id}: ${email}`);
  }
}

export async function assertTokenAvailable(client, token, recruiterId = null) {
  if (!token) return;
  const values = [token];
  const recruiterFilter = recruiterId
    ? `AND recruiter_id <> $${values.push(recruiterId)}`
    : "";
  const result = await client.query(`
    SELECT recruiter_id
    FROM chatbot.recruiters
    WHERE recruiter_token = $1
    ${recruiterFilter}
    LIMIT 1
  `, values);
  if (result.rows.length > 0) {
    throw new Error(`Recruiter token is already used by recruiter ${result.rows[0].recruiter_id}: ${token}`);
  }
}

export async function createRecruiterAccess(client, {
  recruiterId,
  clientId,
  email,
  token,
  password = null
}) {
  if (!recruiterId || !clientId || !email || !token) {
    throw new Error("Creating recruiter access requires recruiterId, clientId, email, and token");
  }

  const existing = await client.query(`
    SELECT recruiter_id
    FROM chatbot.recruiters
    WHERE recruiter_id = $1
  `, [recruiterId]);
  if (existing.rows.length > 0) {
    throw new Error(`Recruiter already exists: ${recruiterId}`);
  }

  const clientRow = await ensureClientExists(client, clientId);
  await assertEmailAvailable(client, email);
  await assertTokenAvailable(client, token);

  const nextPassword = password || generatePassword();
  const passwordHash = await bcrypt.hash(nextPassword, 10);
  const result = await client.query(`
    INSERT INTO chatbot.recruiters (recruiter_id, client_id, email, recruiter_token, password_hash)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING recruiter_id, client_id, email, recruiter_token
  `, [
    recruiterId,
    clientId,
    email,
    token,
    passwordHash
  ]);

  const recruiter = result.rows[0];
  const visibleJobs = await client.query(`
    SELECT COUNT(*)::int AS visible_jobs
    FROM chatbot.jobs
    WHERE client_id = $1
  `, [clientId]);

  return {
    database_name: (await client.query("SELECT current_database() AS database_name")).rows[0].database_name,
    recruiter_id: recruiter.recruiter_id,
    client_id: recruiter.client_id,
    client_name: clientRow.name,
    email: recruiter.email,
    recruiter_token: recruiter.recruiter_token,
    password: nextPassword,
    visible_jobs: visibleJobs.rows[0].visible_jobs
  };
}

export async function bootstrapRecruiterAccess(client, {
  lookup,
  nextEmail = null,
  nextToken = null,
  password = null,
  clientId = null
}) {
  const recruiter = assertSingleRecruiter(await findRecruiters(client, lookup), lookup);
  if (clientId && recruiter.client_id !== clientId) {
    throw new Error(`Recruiter ${recruiter.recruiter_id} belongs to client ${recruiter.client_id}, expected ${clientId}`);
  }
  await assertEmailAvailable(client, nextEmail, recruiter.recruiter_id);
  await assertTokenAvailable(client, nextToken, recruiter.recruiter_id);

  const nextPassword = password || generatePassword();
  const passwordHash = await bcrypt.hash(nextPassword, 10);
  const result = await client.query(`
    UPDATE chatbot.recruiters
    SET email = COALESCE($2, email),
        recruiter_token = COALESCE($3, recruiter_token),
        password_hash = $4
    WHERE recruiter_id = $1
    RETURNING recruiter_id, client_id, email, recruiter_token
  `, [
    recruiter.recruiter_id,
    nextEmail,
    nextToken,
    passwordHash
  ]);

  return {
    database_name: recruiter.database_name,
    recruiter_id: result.rows[0].recruiter_id,
    client_id: result.rows[0].client_id,
    client_name: recruiter.client_name,
    email: result.rows[0].email,
    recruiter_token: result.rows[0].recruiter_token,
    password: nextPassword,
    visible_jobs: recruiter.visible_jobs
  };
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[rawKey] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[rawKey] = true;
      continue;
    }
    args[rawKey] = next;
    index += 1;
  }
  return args;
}
