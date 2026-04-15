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

const runName = args["run-name"] ?? `moderation-${Date.now()}`;
const email = args.email ?? process.env.RECRUITER_EMAIL ?? process.env.DEMO_EMAIL ?? "recruiter@example.test";
const password = args.password ?? process.env.RECRUITER_PASSWORD ?? process.env.DEMO_PASSWORD ?? "";
const recruiterToken = args.token ?? process.env.RECRUITER_TOKEN ?? "rec-tok-demo-001";
const jobId = args["job-id"] ?? process.env.MODERATION_JOB_ID ?? null;
const jobTitle = args["job-title"] ?? process.env.MODERATION_JOB_TITLE ?? null;
const action = (args.action ?? "inspect").toLowerCase();
const format = (args.format ?? "text").toLowerCase();
const shouldRunWebhook = toBoolean(args["run-webhook"], false);
const forceWebhook = toBoolean(args["force-webhook"], false);
const conversationId = args["conversation-id"] ?? process.env.MODERATION_CONVERSATION_ID ?? null;
const webhookText = args["webhook-text"] ?? process.env.MODERATION_WEBHOOK_TEXT ?? "Это тестовое сообщение для проверки moderation-очереди.";
const webhookAttempts = parseIntSafe(args["webhook-attempts"] ?? "8", 8);
const webhookWaitMs = parseIntSafe(args["webhook-wait-ms"] ?? "1000", 1000);
const checkPage = toBoolean(args["check-page"], true);
const selectedItemId = args["item-id"] ?? null;
const reportAfterAction = toBoolean(args["report-after-action"], true);

const allowedActions = new Set(["inspect", "block", "send-now"]);
if (!allowedActions.has(action)) {
  console.error("ERROR: --action must be one of: inspect, block, send-now");
  process.exit(1);
}

if (!password) {
  console.error("ERROR: password is required (use --password or RECRUITER_PASSWORD/DEMO_PASSWORD)");
  process.exit(1);
}

if (shouldRunWebhook && !conversationId) {
  console.error("ERROR: --conversation-id is required when --run-webhook is set");
  process.exit(1);
}

if (webhookAttempts < 1) {
  console.error("ERROR: --webhook-attempts must be >= 1");
  process.exit(1);
}

if (webhookWaitMs < 100) {
  console.error("ERROR: --webhook-wait-ms must be >= 100");
  process.exit(1);
}

main().catch((error) => {
  console.error(`Moderation smoke/report failed: ${error.message}`);
  process.exit(1);
});

async function main() {
  const queuePath = `/recruiter/${encodeURIComponent(recruiterToken)}/queue${jobId ? `?job_id=${encodeURIComponent(jobId)}` : ""}`;
  const pageQuery = [];
  if (jobId) pageQuery.push(`job_id=${encodeURIComponent(jobId)}`);
  if (jobTitle) pageQuery.push(`title=${encodeURIComponent(jobTitle)}`);
  const pagePath = `/recruiter/${encodeURIComponent(recruiterToken)}${pageQuery.length > 0 ? `?${pageQuery.join("&")}` : ""}`;

  console.log(`[moderation-report] baseUrl=${baseUrl}`);
  console.log(`[moderation-report] run=${runName}`);
  console.log(`[moderation-report] action=${action}`);

  const cookie = await login(baseUrl, email, password, recruiterToken);

  if (checkPage) {
    const moderationResponse = await fetch(baseUrl + pagePath, { headers: { cookie } });
    const moderationBody = await moderationResponse.text();
    if (!moderationResponse.ok) {
      throw new Error(`moderation page request failed (HTTP ${moderationResponse.status}): ${moderationBody}`);
    }
    if (!moderationBody.includes("Очередь запланированных сообщений") && !moderationBody.includes("Сообщения на модерации")) {
      throw new Error("moderation page response does not contain expected UI marker");
    }
  }

  const before = await fetchQueue(baseUrl, queuePath, cookie);
  const report = {
    run: runName,
    base_url: baseUrl,
    recruiter_token: recruiterToken,
    login_email: email,
    action,
    filters: { job_id: jobId, title: jobTitle },
    before: { total: before.items.length }
  };

  let queue = before;

  if (shouldRunWebhook && (forceWebhook || before.items.length === 0)) {
    const webhookPayload = {
      conversation_id: conversationId,
      channel: "moderation-smoke",
      channel_message_id: `smoke-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      text: webhookText,
      occurred_at: new Date().toISOString()
    };

    const webhookResponse = await fetch(baseUrl + "/webhook/message", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(webhookPayload)
    });

    const webhookBodyText = await webhookResponse.text();
    if (!webhookResponse.ok) {
      throw new Error(`webhook trigger failed (HTTP ${webhookResponse.status}): ${webhookBodyText}`);
    }

    const webhookResponseBody = safeJson(webhookBodyText, null);

    report.webhook = {
      conversation_id: conversationId,
      response: webhookResponseBody
    };

    const after = await waitForQueueUpdate(
      baseUrl,
      queuePath,
      cookie,
      before.items.length,
      webhookAttempts,
      webhookWaitMs,
      webhookResponseBody?.planned_message_id ?? null
    );
    report.after = {
      total: after.items.length,
      delta: after.items.length - before.items.length
    };
    queue = after;
  }

  const selected = selectQueueItem(queue.items, selectedItemId);
  report.selected_item_id = selected?.planned_message_id ?? null;
  report.queue = {
    total: queue.items.length,
    items: queue.items
  };

  if (action === "block") {
    if (!selected) throw new Error("block action requires at least one queue item");
    const actionPayload = await callModerationAction(baseUrl, cookie, recruiterToken, selected.planned_message_id, "block");
    report.actions = [{ action: "block", item_id: selected.planned_message_id, response: actionPayload }];
  }

  if (action === "send-now") {
    if (!selected) throw new Error("send-now action requires at least one queue item");
    const actionPayload = await callModerationAction(baseUrl, cookie, recruiterToken, selected.planned_message_id, "send-now");
    report.actions = [{ action: "send-now", item_id: selected.planned_message_id, response: actionPayload }];
  }

  if (reportAfterAction && action !== "inspect") {
    report.queue_after_action = await fetchQueue(baseUrl, queuePath, cookie);
  }

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderTextReport(report);
}

async function login(baseUrl, email, password, recruiterToken) {
  const loginResponse = await fetch(baseUrl + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual"
  });

  const loginBodyText = await loginResponse.text();
  if (!loginResponse.ok) {
    if (loginResponse.status === 401) {
      const parsed = safeJson(loginBodyText, null);
      const code = parsed?.error_code ? ` (${parsed.error_code})` : "";
      throw new Error(`auth/login failed (HTTP ${loginResponse.status}${code}): ${loginBodyText}`);
    }
    throw new Error(`auth/login failed (HTTP ${loginResponse.status}): ${loginBodyText}`);
  }

  const setCookie = getSetCookie(loginResponse.headers);
  if (!setCookie) {
    throw new Error("auth/login success but Set-Cookie header is missing");
  }

  const loginBody = safeJson(loginBodyText, null);
  if (loginBody?.redirect && !String(loginBody.redirect).includes(recruiterToken)) {
    throw new Error(`login redirect points to unexpected recruiter: ${loginBody.redirect}`);
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
  const parsed = safeJson(bodyText, null);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("moderation queue response has invalid shape");
  }
  return parsed;
}

async function callModerationAction(baseUrl, cookie, recruiterToken, plannedMessageId, action) {
  const response = await fetch(
    `${baseUrl}/recruiter/${encodeURIComponent(recruiterToken)}/queue/${encodeURIComponent(plannedMessageId)}/${action}`,
    {
      method: "POST",
      headers: { cookie }
    }
  );
  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`action ${action} failed (HTTP ${response.status}): ${bodyText}`);
  }
  return safeJson(bodyText, null);
}

async function waitForQueueUpdate(baseUrl, queuePath, cookie, baseline, attempts, waitMs, plannedMessageId = null) {
  for (let i = 0; i < attempts; i += 1) {
    const current = await fetchQueue(baseUrl, queuePath, cookie);
    const hasPlannedMessage = plannedMessageId
      ? current.items.some((item) => item.planned_message_id === plannedMessageId)
      : false;

    if (current.items.length > baseline || hasPlannedMessage) {
      return current;
    }
    await sleep(waitMs);
  }

  const finalQueue = await fetchQueue(baseUrl, queuePath, cookie);
  const hasPlannedMessage = plannedMessageId
    ? finalQueue.items.some((item) => item.planned_message_id === plannedMessageId)
    : false;
  if (hasPlannedMessage) {
    return finalQueue;
  }

  if (baseline > 0) {
    return finalQueue;
  }

  throw new Error(`no queue update after webhook. baseline=${baseline}, planned_message_id=${plannedMessageId ?? "n/a"}`);
}

function selectQueueItem(items, selectedItemId) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (selectedItemId) {
    return items.find((item) => item.planned_message_id === selectedItemId) ?? null;
  }
  return items[0] ?? null;
}

function getSetCookie(headers) {
  const direct = headers.get("set-cookie");
  if (direct) return direct;
  const raw = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  return raw[0] ?? "";
}

function safeJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function renderTextReport(report) {
  console.log("Moderation report:");
  console.log(`run: ${report.run}`);
  console.log(`base_url: ${report.base_url}`);
  console.log(`queue before: ${report.before.total}`);
  if (report.after) {
    console.log(`queue after webhook: ${report.after.total} (delta=${report.after.delta})`);
  }
  console.log(`selected_item_id: ${report.selected_item_id ?? "n/a"}`);
  if (Array.isArray(report.actions)) {
    for (const actionRow of report.actions) {
      console.log(`action ${actionRow.action}: ${actionRow.item_id}`);
    }
  }
  if (report.queue_after_action) {
    console.log(`queue after action: ${report.queue_after_action.items?.length ?? report.queue_after_action.total ?? "unknown"}`);
  }
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

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
