import { createServer } from "node:http";
import bcrypt from "bcryptjs";

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Вход</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: sans-serif; display: flex; justify-content: center; padding: 4rem 1rem; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); min-width: 320px; }
    h2 { margin: 0 0 1.5rem; font-size: 1.4rem; }
    label { display: block; margin-bottom: 1rem; font-size: 0.9em; color: #444; }
    label span { display: block; margin-bottom: 0.25rem; }
    input { width: 100%; padding: 0.5rem 0.75rem; font-size: 1em; border: 1px solid #ccc; border-radius: 4px; }
    button { width: 100%; margin-top: 0.5rem; padding: 0.65rem; font-size: 1em; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { color: #c00; font-size: 0.9em; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Вход в систему</h2>
    <div id="error" class="error" style="display:none"></div>
    <form id="loginForm">
      <label><span>Email</span><input type="email" name="email" required autofocus></label>
      <label><span>Пароль</span><input type="password" name="password" required></label>
      <button type="submit">Войти</button>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const r = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
      });
      if (r.ok || r.status === 302) {
        const data = await r.json().catch(() => ({}));
        location.href = data.redirect || '/';
      } else {
        const data = await r.json().catch(() => ({}));
        const el = document.getElementById('error');
        el.textContent = data.error || 'Ошибка входа';
        el.style.display = '';
      }
    });
  </script>
</body>
</html>`;

const MODERATION_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Очередь модерации</title>
  <style>
    body { font-family: sans-serif; padding: 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    .body-preview { color: #555; font-size: 0.9em; max-width: 400px; }
    .countdown { font-weight: bold; }
    .overdue { color: #c00; }
    button { margin: 0 0.25rem; padding: 0.3rem 0.75rem; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Очередь модерации</h1>
  <div id="status"></div>
  <table id="queue">
    <thead>
      <tr>
        <th>Кандидат</th><th>Вакансия</th><th>Шаг</th>
        <th>Отправка</th><th>Сообщение</th><th>Действие</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>
  <script>
    const TOKEN = location.pathname.split('/')[2];
    let items = [];

    function esc(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }

    async function fetchQueue() {
      const r = await fetch('/recruiter/' + TOKEN + '/queue');
      if (!r.ok) { document.getElementById('status').textContent = 'Ошибка загрузки'; return; }
      const data = await r.json();
      items = data.items;
      renderTable();
    }

    function renderTable() {
      const tbody = document.querySelector('#queue tbody');
      tbody.innerHTML = '';
      for (const item of items) {
        const tr = document.createElement('tr');
        tr.dataset.id = item.planned_message_id;
        tr.dataset.sendAfter = item.auto_send_after;
        const preview = item.body.slice(0, 120) + (item.body.length > 120 ? '...' : '');
        tr.innerHTML =
          '<td>' + esc(item.candidate_display_name) + '</td>' +
          '<td>' + esc(item.job_title) + '</td>' +
          '<td>' + esc(item.active_step_goal) + '</td>' +
          '<td class="countdown"></td>' +
          '<td class="body-preview">' + esc(preview) + '</td>' +
          '<td>' +
            '<button onclick="doBlock(\\'' + esc(item.planned_message_id) + '\\')">Заблокировать</button>' +
            '<button onclick="doSendNow(\\'' + esc(item.planned_message_id) + '\\')">Отправить сейчас</button>' +
          '</td>';
        tbody.appendChild(tr);
      }
    }

    function updateCountdowns() {
      const now = Date.now();
      for (const tr of document.querySelectorAll('#queue tbody tr')) {
        const sendAfter = new Date(tr.dataset.sendAfter).getTime();
        const secs = Math.round((sendAfter - now) / 1000);
        const td = tr.querySelector('.countdown');
        if (secs <= 0) {
          td.textContent = 'Отправка...';
          td.className = 'countdown overdue';
        } else {
          const m = Math.floor(secs / 60), s = secs % 60;
          td.textContent = 'через ' + m + ':' + String(s).padStart(2, '0');
          td.className = 'countdown';
        }
      }
    }

    async function doBlock(id) {
      await fetch('/recruiter/' + TOKEN + '/queue/' + id + '/block', { method: 'POST' });
      fetchQueue();
    }

    async function doSendNow(id) {
      await fetch('/recruiter/' + TOKEN + '/queue/' + id + '/send-now', { method: 'POST' });
      fetchQueue();
    }

    fetchQueue();
    setInterval(fetchQueue, 5000);
    setInterval(updateCountdowns, 1000);
  </script>
</body>
</html>`;

export function createHttpServer(app, { store } = {}) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/webhook/message") {
        const body = await readJsonBody(request);
        const result = await app.postWebhookMessage(body);
        writeJson(response, result.status, result.body);
        return;
      }

      if (request.method === "GET" && request.url === "/queue/pending") {
        const result = await app.getPendingQueue();
        writeJson(response, result.status, result.body);
        return;
      }

      // Login form
      if (request.method === "GET" && request.url === "/login") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(LOGIN_HTML);
        return;
      }

      // Login POST
      if (request.method === "POST" && request.url === "/auth/login") {
        if (!store) {
          writeJson(response, 503, { error: "auth_not_configured" });
          return;
        }
        const body = await readLoginBody(request);
        const { email, password } = body;
        if (!email || !password) {
          writeJson(response, 400, { error: "email and password required" });
          return;
        }
        const recruiter = await store.getRecruiterByEmail(email);
        const validPassword = recruiter?.password_hash
          ? await bcrypt.compare(String(password), recruiter.password_hash)
          : false;
        if (!recruiter || !validPassword) {
          writeJson(response, 401, { error: "Invalid credentials" });
          return;
        }
        const sessionToken = await store.createSession(recruiter.recruiter_id);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `session=${sessionToken}; HttpOnly; Path=/; Max-Age=604800`
        });
        response.end(JSON.stringify({ redirect: `/recruiter/${recruiter.recruiter_token}` }));
        return;
      }

      // Recruiter moderation queue (JSON)
      const queueMatch = request.url.match(/^\/recruiter\/([^/]+)\/queue$/);
      if (queueMatch && request.method === "GET") {
        const token = queueMatch[1];
        const result = await app.getModerationQueue(token);
        writeJson(response, result.status, result.body);
        return;
      }

      // Block a message
      const blockMatch = request.url.match(/^\/recruiter\/([^/]+)\/queue\/([^/]+)\/block$/);
      if (blockMatch && request.method === "POST") {
        const [, token, id] = blockMatch;
        const result = await app.blockMessage(token, id);
        writeJson(response, result.status, result.body);
        return;
      }

      // Send now
      const sendNowMatch = request.url.match(/^\/recruiter\/([^/]+)\/queue\/([^/]+)\/send-now$/);
      if (sendNowMatch && request.method === "POST") {
        const [, token, id] = sendNowMatch;
        const result = await app.sendMessageNow(token, id);
        writeJson(response, result.status, result.body);
        return;
      }

      // HTML moderation page — requires valid session cookie when store is available
      const htmlMatch = request.url.match(/^\/recruiter\/([^/]+)$/);
      if (htmlMatch && request.method === "GET") {
        if (store) {
          const cookies = parseCookies(request.headers.cookie);
          const sessionToken = cookies["session"];
          const recruiter = sessionToken ? await store.getSessionRecruiter(sessionToken) : null;
          if (!recruiter) {
            response.writeHead(302, { location: "/login" });
            response.end();
            return;
          }
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(MODERATION_HTML);
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

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

async function readLoginBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  const ct = request.headers["content-type"] ?? "";
  if (ct.includes("application/json")) {
    return raw ? JSON.parse(raw) : {};
  }
  // URL-encoded form fallback
  const params = new URLSearchParams(raw);
  return { email: params.get("email"), password: params.get("password") };
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
