import { createServer } from "node:http";

const HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hiring Agent</title>
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
    .shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero {
      display: grid;
      gap: 16px;
      margin-bottom: 20px;
    }
    .eyebrow {
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 12px;
      color: rgba(30, 36, 48, 0.66);
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
    .layout {
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      gap: 18px;
    }
    .panel {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(6px);
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
    textarea {
      width: 100%;
      min-height: 124px;
      resize: vertical;
      border-radius: 18px;
      border: 1px solid var(--line);
      padding: 14px 16px;
      font: inherit;
      background: rgba(255,255,255,0.82);
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 13px 18px;
      font: inherit;
      color: white;
      background: linear-gradient(135deg, #be4f29, #a24022);
      cursor: pointer;
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
    tr:last-child td { border-bottom: 0; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .chat-panel { position: static; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div class="eyebrow">Recruiter Chat / PR 1 Demo</div>
      <h1>Playbook-driven chat shell для рекрутера</h1>
      <div class="subhead">Стейтлесс-демо с pattern router, gated playbooks и локальным funnel adapter поверх runtime-shaped данных.</div>
    </div>
    <div class="layout">
      <section class="panel chat-panel">
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

    function addBubble(role, text) {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + role;
      bubble.textContent = text;
      chatLog.appendChild(bubble);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function renderReply(reply) {
      if (reply.kind === "fallback_text") {
        resultPanel.innerHTML = '<div class="placeholder">' + reply.text + '</div>';
        addBubble("assistant", reply.text);
        return;
      }

      if (reply.kind === "playbook_locked") {
        resultPanel.innerHTML = '<div class="placeholder"><strong>' + reply.title + '</strong><br><br>' + reply.message + '</div>';
        addBubble("assistant", reply.message);
        return;
      }

      if (reply.kind !== "render_funnel") return;

      addBubble("assistant", "Построил funnel snapshot по goal-этапам.");
      const branchMarkup = reply.branches.map((branch, index) => {
        const cls = index === 0 ? "badge accent" : index === 1 ? "badge warn" : "badge";
        return '<div class="' + cls + '">' + branch.title + ': ' + branch.count + '</div>';
      }).join("");

      const rowsMarkup = reply.rows.map((row) => (
        '<tr>' +
          '<td>' + row.step_name + '</td>' +
          '<td>' + row.total + '</td>' +
          '<td>' + row.completed + '</td>' +
          '<td>' + row.in_progress + '</td>' +
          '<td>' + row.stuck + '</td>' +
          '<td>' + row.rejected + '</td>' +
        '</tr>'
      )).join("");

      resultPanel.innerHTML =
        '<div>' +
          '<div class="eyebrow">Playbook</div>' +
          '<h2 style="margin:8px 0 0;font-size:32px;">' + reply.title + '</h2>' +
          '<div style="margin-top:8px;color:rgba(30,36,48,.62);font-size:14px;">Generated at ' + new Date(reply.generated_at).toLocaleString() + '</div>' +
        '</div>' +
        '<div class="cards">' +
          '<div class="metric"><div class="label">Всего</div><div class="value">' + reply.summary.total + '</div></div>' +
          '<div class="metric"><div class="label">Квалифицированы</div><div class="value">' + reply.summary.qualified + '</div></div>' +
          '<div class="metric"><div class="label">Отсечены</div><div class="value">' + reply.summary.rejected + '</div></div>' +
          '<div class="metric"><div class="label">Ждут движения</div><div class="value">' + reply.summary.waiting + '</div></div>' +
        '</div>' +
        '<div class="branches">' + branchMarkup + '</div>' +
        '<table>' +
          '<thead><tr><th>Этап</th><th>Вошли</th><th>Завершили</th><th>В работе</th><th>Зависли</th><th>Отсечены</th></tr></thead>' +
          '<tbody>' + rowsMarkup + '</tbody>' +
        '</table>';
    }

    async function submitMessage() {
      const message = messageInput.value.trim();
      if (!message) return;
      addBubble("user", message);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      renderReply(data.reply);
    }

    document.getElementById("sendBtn").addEventListener("click", submitMessage);
  </script>
</body>
</html>`;

export function createHiringAgentServer(app) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        const result = app.getHealth();
        writeJson(response, result.status, result.body);
        return;
      }

      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(HTML);
        return;
      }

      if (request.method === "POST" && request.url === "/api/chat") {
        const body = await readJsonBody(request);
        const result = await app.postChatMessage(body);
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
