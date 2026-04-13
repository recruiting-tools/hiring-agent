import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import { createSession, getRecruiterByEmail, parseCookies, resolveSession } from "./auth.js";

const STYLE_BLOCK = `
  <style>
    :root {
      --bg: #f3efe5;
      --ink: #1e2430;
      --card: rgba(255, 252, 245, 0.9);
      --line: rgba(30, 36, 48, 0.12);
      --accent: #c4552d;
      --accent-soft: rgba(196, 85, 45, 0.12);
      --olive: #5c6b4f;
      --olive-soft: rgba(92, 107, 79, 0.14);
      --warn: #8d5a12;
      --warn-soft: rgba(141, 90, 18, 0.14);
      --shadow: 0 18px 50px rgba(48, 39, 26, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(196, 85, 45, 0.16), transparent 28%),
        radial-gradient(circle at top right, rgba(92, 107, 79, 0.14), transparent 24%),
        linear-gradient(180deg, #f8f4eb 0%, var(--bg) 100%);
      min-height: 100vh;
    }
    button,
    input,
    select,
    textarea {
      font: inherit;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 13px 18px;
      color: white;
      background: linear-gradient(135deg, #be4f29, #a24022);
      cursor: pointer;
    }
    button.secondary {
      background: rgba(30, 36, 48, 0.08);
      color: var(--ink);
    }
    button:disabled {
      opacity: 0.6;
      cursor: wait;
    }
    .eyebrow {
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 12px;
      color: rgba(30, 36, 48, 0.66);
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(6px);
    }
    .notice {
      display: none;
      border: 1px solid rgba(196, 85, 45, 0.2);
      background: rgba(196, 85, 45, 0.1);
      color: #7f351b;
      border-radius: 16px;
      padding: 12px 14px;
      font-size: 14px;
      line-height: 1.45;
    }
    .notice.visible {
      display: block;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .chat-panel { position: static; }
      .shell { padding: 24px 16px 40px; }
    }
  </style>
`;

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hiring Agent Login</title>
  ${STYLE_BLOCK}
  <style>
    .login-shell {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .login-card {
      width: min(460px, 100%);
      padding: 32px;
      display: grid;
      gap: 18px;
    }
    h1 {
      margin: 0;
      font-size: clamp(34px, 7vw, 48px);
      line-height: 0.95;
    }
    .subhead {
      font-size: 17px;
      line-height: 1.5;
      color: rgba(30, 36, 48, 0.78);
    }
    form {
      display: grid;
      gap: 14px;
    }
    label {
      display: grid;
      gap: 8px;
      font-size: 14px;
      color: rgba(30, 36, 48, 0.78);
    }
    input {
      width: 100%;
      border-radius: 16px;
      border: 1px solid var(--line);
      padding: 14px 16px;
      background: rgba(255,255,255,0.84);
    }
  </style>
</head>
<body>
  <div class="login-shell">
    <section class="panel login-card">
      <div class="eyebrow">Recruiter Chat</div>
      <h1>Вход в hiring agent</h1>
      <div class="subhead">Войдите по email и паролю, чтобы открыть playbook-driven chat для своей клиентской зоны.</div>
      <div class="notice" id="loginError"></div>
      <form id="loginForm">
        <label>
          Email
          <input id="emailInput" type="email" autocomplete="username" required placeholder="recruiter@company.com">
        </label>
        <label>
          Пароль
          <input id="passwordInput" type="password" autocomplete="current-password" required placeholder="••••••••">
        </label>
        <button id="loginBtn" type="submit">Войти</button>
      </form>
    </section>
  </div>
  <script>
    const loginForm = document.getElementById("loginForm");
    const loginBtn = document.getElementById("loginBtn");
    const loginError = document.getElementById("loginError");

    function showError(message) {
      loginError.textContent = message;
      loginError.classList.add("visible");
    }

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      loginError.classList.remove("visible");
      loginBtn.disabled = true;

      try {
        const response = await fetch("/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: document.getElementById("emailInput").value.trim(),
            password: document.getElementById("passwordInput").value
          })
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          window.location = data.redirect || "/";
          return;
        }

        showError(data.error || "Не удалось войти.");
      } catch (_error) {
        showError("Сеть недоступна. Повторите попытку.");
      } finally {
        loginBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;

const CHAT_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hiring Agent</title>
  ${STYLE_BLOCK}
  <style>
    .shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    .account {
      display: grid;
      gap: 4px;
    }
    .account strong {
      font-size: 20px;
      font-weight: normal;
    }
    h1 {
      margin: 0;
      font-size: clamp(34px, 5vw, 56px);
      line-height: 0.94;
      max-width: 820px;
    }
    .subhead {
      max-width: 720px;
      font-size: 18px;
      line-height: 1.5;
      color: rgba(30, 36, 48, 0.82);
    }
    .hero {
      display: grid;
      gap: 16px;
      margin-bottom: 20px;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      gap: 18px;
    }
    .chat-panel {
      padding: 18px;
      display: grid;
      gap: 14px;
      align-self: start;
      position: sticky;
      top: 20px;
    }
    .chat-log {
      display: grid;
      gap: 10px;
      max-height: 360px;
      overflow: auto;
      padding-right: 4px;
    }
    .bubble {
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid var(--line);
      line-height: 1.45;
      font-size: 15px;
      white-space: pre-wrap;
    }
    .bubble.user {
      background: #fff;
    }
    .bubble.assistant {
      background: #f9f4ea;
    }
    textarea,
    select {
      width: 100%;
      border-radius: 18px;
      border: 1px solid var(--line);
      padding: 14px 16px;
      background: rgba(255,255,255,0.82);
    }
    textarea {
      min-height: 124px;
      resize: vertical;
    }
    .result-panel {
      padding: 20px;
      display: grid;
      gap: 18px;
      min-height: 520px;
    }
    .placeholder {
      border: 1px dashed var(--line);
      border-radius: 20px;
      padding: 24px;
      color: rgba(30, 36, 48, 0.72);
      background: rgba(255,255,255,0.45);
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,0.78);
    }
    .metric .label {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(30, 36, 48, 0.58);
    }
    .metric .value {
      margin-top: 8px;
      font-size: 30px;
      line-height: 1;
    }
    .branches {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .badge {
      border-radius: 999px;
      padding: 10px 14px;
      background: var(--olive-soft);
      color: var(--olive);
      font-size: 14px;
    }
    .badge.warn {
      background: var(--warn-soft);
      color: var(--warn);
    }
    .badge.accent {
      background: var(--accent-soft);
      color: var(--accent);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 20px;
      border: 1px solid var(--line);
      background: rgba(255,255,255,0.82);
    }
    th, td {
      padding: 12px 14px;
      text-align: left;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
    }
    th {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(30, 36, 48, 0.58);
      background: rgba(30, 36, 48, 0.03);
    }
    tr:last-child td {
      border-bottom: 0;
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div class="account">
        <div class="eyebrow">Recruiter Session</div>
        <strong id="recruiterEmail">__RECRUITER_EMAIL__</strong>
      </div>
      <a href="/logout"><button class="secondary" type="button">Выйти</button></a>
    </div>
    <div class="hero">
      <div class="eyebrow">Recruiter Chat / Prod Shell</div>
      <h1>Playbook-driven chat shell для рекрутера</h1>
      <div class="subhead">Стейтлесс-демо с pattern router, gated playbooks и локальным funnel adapter поверх runtime-shaped данных.</div>
    </div>
    <div class="layout">
      <section class="panel chat-panel">
        <label class="eyebrow" for="jobSelect">Вакансия</label>
        <select id="jobSelect">
          <option value="">Выберите вакансию</option>
        </select>
        <div class="notice" id="chatError"></div>
        <div class="chat-log" id="chatLog"></div>
        <textarea id="messageInput">Визуализируй воронку по кандидатам</textarea>
        <button id="sendBtn">Запустить playbook</button>
      </section>
      <section class="panel result-panel" id="resultPanel">
        <div class="placeholder">Спросите про воронку, план коммуникации или выборочную рассылку. Для PR 1 включён только funnel playbook.</div>
      </section>
    </div>
  </div>
  <script>
    const chatLog = document.getElementById("chatLog");
    const resultPanel = document.getElementById("resultPanel");
    const messageInput = document.getElementById("messageInput");
    const sendBtn = document.getElementById("sendBtn");
    const jobSelect = document.getElementById("jobSelect");
    const chatError = document.getElementById("chatError");
    const storageKey = "hiring-agent-chat-history";

    function escapeHtml(text) {
      return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\\"", "&quot;")
        .replaceAll("'", "&#39;");
    }

    function showError(message) {
      chatError.textContent = message;
      chatError.classList.add("visible");
    }

    function clearError() {
      chatError.classList.remove("visible");
    }

    function readHistory() {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (_error) {
        return [];
      }
    }

    function writeHistory(history) {
      sessionStorage.setItem(storageKey, JSON.stringify(history.slice(-30)));
    }

    function addBubble(role, text, options = {}) {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + role;
      bubble.textContent = text;
      chatLog.appendChild(bubble);
      chatLog.scrollTop = chatLog.scrollHeight;

      if (options.persist !== false) {
        const history = readHistory();
        history.push({ role, text });
        writeHistory(history);
      }
    }

    function restoreHistory() {
      for (const item of readHistory()) {
        addBubble(item.role, item.text, { persist: false });
      }
    }

    function renderReply(reply) {
      if (reply.kind === "fallback_text") {
        resultPanel.innerHTML = '<div class="placeholder">' + escapeHtml(reply.text) + '</div>';
        addBubble("assistant", reply.text);
        return;
      }

      if (reply.kind === "playbook_locked") {
        resultPanel.innerHTML =
          '<div class="placeholder"><strong>' + escapeHtml(reply.title) + '</strong><br><br>' + escapeHtml(reply.message) + "</div>";
        addBubble("assistant", reply.message);
        return;
      }

      if (reply.kind !== "render_funnel") return;

      addBubble("assistant", "Построил funnel snapshot по goal-этапам.");
      const branchMarkup = reply.branches.map((branch, index) => {
        const cls = index === 0 ? "badge accent" : index === 1 ? "badge warn" : "badge";
        return '<div class="' + cls + '">' + escapeHtml(branch.title) + ": " + escapeHtml(branch.count) + "</div>";
      }).join("");

      const rowsMarkup = reply.rows.map((row) => (
        "<tr>" +
          "<td>" + escapeHtml(row.step_name) + "</td>" +
          "<td>" + escapeHtml(row.total) + "</td>" +
          "<td>" + escapeHtml(row.completed) + "</td>" +
          "<td>" + escapeHtml(row.in_progress) + "</td>" +
          "<td>" + escapeHtml(row.stuck) + "</td>" +
          "<td>" + escapeHtml(row.rejected) + "</td>" +
        "</tr>"
      )).join("");

      resultPanel.innerHTML =
        "<div>" +
          '<div class="eyebrow">Playbook</div>' +
          '<h2 style="margin:8px 0 0;font-size:32px;">' + escapeHtml(reply.title) + "</h2>" +
          '<div style="margin-top:8px;color:rgba(30,36,48,.62);font-size:14px;">Generated at ' + escapeHtml(new Date(reply.generated_at).toLocaleString()) + "</div>" +
        "</div>" +
        '<div class="cards">' +
          '<div class="metric"><div class="label">Всего</div><div class="value">' + escapeHtml(reply.summary.total) + "</div></div>" +
          '<div class="metric"><div class="label">Квалифицированы</div><div class="value">' + escapeHtml(reply.summary.qualified) + "</div></div>" +
          '<div class="metric"><div class="label">Отсечены</div><div class="value">' + escapeHtml(reply.summary.rejected) + "</div></div>" +
          '<div class="metric"><div class="label">Ждут движения</div><div class="value">' + escapeHtml(reply.summary.waiting) + "</div></div>" +
        "</div>" +
        '<div class="branches">' + branchMarkup + "</div>" +
        "<table>" +
          "<thead><tr><th>Этап</th><th>Вошли</th><th>Завершили</th><th>В работе</th><th>Зависли</th><th>Отсечены</th></tr></thead>" +
          "<tbody>" + rowsMarkup + "</tbody>" +
        "</table>";
    }

    async function handleApiError(response) {
      if (response.status === 401) {
        window.location = "/login";
        throw new Error("unauthorized");
      }

      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "request_failed");
    }

    async function loadJobs() {
      const response = await fetch("/api/jobs");
      if (!response.ok) await handleApiError(response);

      const data = await response.json();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      for (const job of jobs) {
        const option = document.createElement("option");
        option.value = job.job_id;
        option.textContent = job.title;
        jobSelect.appendChild(option);
      }
      if (jobs.length === 1) {
        jobSelect.value = jobs[0].job_id;
      }
    }

    async function submitMessage() {
      const message = messageInput.value.trim();
      if (!message) return;

      clearError();
      sendBtn.disabled = true;
      addBubble("user", message);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message,
            job_id: jobSelect.value
          })
        });

        if (!response.ok) await handleApiError(response);

        const data = await response.json();
        renderReply(data.reply);
      } catch (error) {
        if (error.message !== "unauthorized") {
          showError("Не удалось получить ответ. Проверьте сеть или повторите запрос.");
        }
      } finally {
        sendBtn.disabled = false;
      }
    }

    restoreHistory();
    loadJobs().catch((error) => {
      if (error.message !== "unauthorized") {
        showError("Не удалось загрузить вакансии.");
      }
    });
    sendBtn.addEventListener("click", submitMessage);
  </script>
</body>
</html>`;

export function createHiringAgentServer(app, options = {}) {
  const sql = options.sql ?? null;

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const result = app.getHealth();
        writeJson(response, result.status, result.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/login") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(LOGIN_HTML);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/auth/login") {
        const body = await readJsonBody(request);
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");

        if (!email || !password) {
          writeJson(response, 400, { error: "email and password required" });
          return;
        }

        const recruiter = await getRecruiterByEmail(sql, email);
        const validPassword = sql
          ? recruiter?.password_hash
            ? await bcrypt.compare(password, recruiter.password_hash)
            : false
          : Boolean(recruiter);

        if (!recruiter || !validPassword) {
          writeJson(response, 401, { error: "Invalid credentials" });
          return;
        }

        const sessionToken = await createSession(sql, recruiter.recruiter_id);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `session=${sessionToken}; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict`
        });
        response.end(JSON.stringify({ redirect: "/" }));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/logout") {
        response.writeHead(302, {
          location: "/login",
          "set-cookie": "session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict"
        });
        response.end();
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/") {
        const recruiter = await requireRecruiter(request, response, sql, { unauthorizedStatus: 302 });
        if (!recruiter) return;

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(CHAT_HTML.replace("__RECRUITER_EMAIL__", escapeHtml(recruiter.email)));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/jobs") {
        const recruiter = await requireRecruiter(request, response, sql);
        if (!recruiter) return;

        const result = await app.getJobs(recruiter.client_id);
        writeJson(response, result.status, result.body);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
        const recruiter = await requireRecruiter(request, response, sql);
        if (!recruiter) return;

        const body = await readJsonBody(request);
        const result = await app.postChatMessage({
          message: body.message,
          recruiter_token: recruiter.recruiter_token,
          job_id: body.job_id
        });
        writeJson(response, result.status, result.body);
        return;
      }

      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      writeJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
}

async function requireRecruiter(request, response, sql, options = {}) {
  const unauthorizedStatus = options.unauthorizedStatus ?? 401;
  const cookies = parseCookies(request.headers.cookie);
  const recruiter = await resolveSession(sql, cookies.session);
  if (recruiter) return recruiter;

  if (unauthorizedStatus === 302) {
    response.writeHead(302, { location: "/login" });
    response.end();
    return null;
  }

  writeJson(response, unauthorizedStatus, { error: "unauthorized" });
  return null;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
