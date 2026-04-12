import { createServer } from "node:http";

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

export function createHttpServer(app) {
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

      // HTML moderation page
      const htmlMatch = request.url.match(/^\/recruiter\/([^/]+)$/);
      if (htmlMatch && request.method === "GET") {
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

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
