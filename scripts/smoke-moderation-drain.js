#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const baseUrl = stripTrailingSlash(
  process.env.MODERATION_BASE_URL
  ?? process.env.CANDIDATE_CHATBOT_BASE_URL
  ?? process.env.BASE_URL
  ?? ""
);

if (!baseUrl) {
  console.error("ERROR: MODERATION_BASE_URL, CANDIDATE_CHATBOT_BASE_URL, or BASE_URL is required");
  process.exit(1);
}

const email = args.email ?? process.env.RECRUITER_EMAIL ?? process.env.DEMO_EMAIL ?? "recruiter@example.test";
const password = args.password ?? process.env.RECRUITER_PASSWORD ?? process.env.DEMO_PASSWORD ?? "";
const recruiterToken = args.token ?? process.env.RECRUITER_TOKEN ?? "rec-tok-demo-001";
const jobId = args["job-id"] ?? process.env.MODERATION_JOB_ID ?? null;
const conversationId = args["conversation-id"] ?? process.env.MODERATION_CONVERSATION_ID ?? null;
const maxItems = parseIntSafe(args["max-items"] ?? "100", 100);
const dryRun = toBoolean(args["dry-run"], false);
const format = (args.format ?? "json").toLowerCase();

if (!password) {
  console.error("ERROR: password is required (use --password or RECRUITER_PASSWORD/DEMO_PASSWORD)");
  process.exit(1);
}

main().catch((error) => {
  console.error(`Moderation queue drain failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const cookie = await login(baseUrl, email, password);
  const queuePath = `/recruiter/${encodeURIComponent(recruiterToken)}/queue${jobId ? `?job_id=${encodeURIComponent(jobId)}` : ""}`;
  const queue = await fetchQueue(baseUrl, queuePath, cookie);

  const candidates = queue.items
    .filter((item) => item.review_status === "pending" || item.review_status == null)
    .filter((item) => conversationId ? item.conversation_id === conversationId : true)
    .slice(0, maxItems);

  const report = {
    base_url: baseUrl,
    recruiter_token: recruiterToken,
    filters: {
      job_id: jobId,
      conversation_id: conversationId
    },
    total_before: queue.items.length,
    eligible: candidates.length,
    max_items: maxItems,
    dry_run: dryRun,
    blocked: []
  };

  if (dryRun) {
    report.blocked = candidates.map((item) => ({ planned_message_id: item.planned_message_id, status: "dry_run" }));
    return render(report, format);
  }

  for (const item of candidates) {
    const response = await fetch(
      `${baseUrl}/recruiter/${encodeURIComponent(recruiterToken)}/queue/${encodeURIComponent(item.planned_message_id)}/block`,
      {
        method: "POST",
        headers: { cookie }
      }
    );
    const bodyText = await response.text();
    report.blocked.push({
      planned_message_id: item.planned_message_id,
      status: response.ok ? "blocked" : "failed",
      status_code: response.status,
      payload: safeJson(bodyText, bodyText)
    });
  }

  return render(report, format);
}

function render(report, format) {
  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Queue size before: ${report.total_before}`);
  console.log(`Eligible pending: ${report.eligible}`);
  const blockedCount = report.blocked.filter((row) => row.status === "blocked").length;
  console.log(`Blocked: ${blockedCount}`);
  for (const row of report.blocked) {
    console.log(`- ${row.planned_message_id}: ${row.status} (${row.status_code ?? "n/a"})`);
  }
}

async function login(baseUrl, email, password) {
  const response = await fetch(baseUrl + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual"
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`auth/login failed (HTTP ${response.status}): ${bodyText}`);
  }
  const setCookie = getSetCookie(response.headers);
  if (!setCookie) {
    throw new Error("auth/login success but Set-Cookie header is missing");
  }
  return setCookie.split(";")[0];
}

async function fetchQueue(baseUrl, queuePath, cookie) {
  const response = await fetch(baseUrl + queuePath, {
    headers: { cookie }
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`moderation queue request failed (HTTP ${response.status}): ${bodyText}`);
  }
  const payload = safeJson(bodyText, null);
  if (!payload || !Array.isArray(payload.items)) {
    throw new Error("moderation queue response has invalid shape");
  }
  return payload;
}

function getSetCookie(headers) {
  const direct = headers.get("set-cookie");
  if (direct) return direct;
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return raw[0] ?? "";
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function toBoolean(value, fallback) {
  if (value == null) return fallback;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
