# Phase 1 Implementation Plan — Hiring Agent Frontend

**Goal:** Replace current warm-beige hiring-agent UI with dark-mode chat UI matching recruiter-agent visual style.  
**TZ:** `docs/2026-04-14-hiring-agent-frontend-tz.md`  
**Branch:** `feature/chat-ui-replication`  
**Files to modify:** `services/hiring-agent/src/http-server.js`, root `package.json`  
**Do NOT touch:** any other files, candidate-chatbot, hh-connector, DB migrations

---

## Key technical facts

1. **Raw `node:http` server** — not Express. `createHiringAgentServer()` returns an `http.Server`.  
   WebSocket server attaches to it: `new WebSocketServer({ server: httpServer })`

2. **`ws` package not installed.** Must add `"ws": "^8.18.1"` to root `package.json` dependencies and run `pnpm install`.

3. **Auth via `session` cookie** — `parseCookies(req.headers.cookie).session` → `resolveSession(managementSql, token)`.  
   Same logic works for WS upgrade requests.

4. **`/api/jobs` already exists** — reuse it for vacancy selector. Returns `{ jobs: [{job_id, title}] }`.

5. **Existing `/api/chat` HTTP endpoint must stay** — integration tests use it. Just keep it alongside the new WS.

---

## Iteration 1 — WebSocket server

### Changes to `http-server.js`

At the top, add import:
```js
import { WebSocketServer } from 'ws';
```

Inside `createHiringAgentServer()`, after creating `server = createServer(...)`, add:

```js
// ── WebSocket server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  // Auth: validate session cookie
  const cookies = parseCookies(req.headers.cookie ?? '');
  const recruiter = await resolveSession(managementSql, cookies.session).catch(() => null);
  if (!recruiter) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  // Session context
  const wsContext = {
    recruiterId: recruiter.recruiter_id,
    tenantId: recruiter.tenant_id,
    recruiterEmail: recruiter.email,
  };

  // Heartbeat: keep connection alive through proxies
  let alive = true;
  ws.on('pong', () => { alive = true; });

  const heartbeat = setInterval(() => {
    if (!alive) { clearInterval(heartbeat); ws.terminate(); return; }
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on('close', () => clearInterval(heartbeat));
  ws.on('error', () => clearInterval(heartbeat));

  // Message handler
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'message') {
      await handleChatWs(ws, msg, wsContext, app, { managementSql, poolRegistry, appEnv });
    }
  });
});
// ─────────────────────────────────────────────────────────────────────────────

return server;
```

### Add `handleChatWs` function (before `createHiringAgentServer`)

```js
async function handleChatWs(ws, msg, wsContext, app, options) {
  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  const { text, vacancyId } = msg;

  try {
    // Progress: routing
    send({ type: 'progress', tool: 'route_playbook', label: 'Определяю плейбук' });

    // Build tenantSql (same as requireAccessContext does)
    let tenantSql = null;
    if (options.poolRegistry) {
      try {
        const ctx = await resolveAccessContext({
          managementStore: options.managementStore,
          poolRegistry: options.poolRegistry,
          appEnv: options.appEnv ?? 'local',
          sessionToken: null, // already validated
          tenantId: wsContext.tenantId,
        });
        tenantSql = ctx?.tenantSql ?? null;
      } catch { /* local dev fallback */ }
    }

    // Call existing postChatMessage (keep backward compat)
    const result = await app.postChatMessage({
      message: text,
      tenantSql,
      tenantId: wsContext.tenantId,
      job_id: vacancyId,
    });

    const reply = result.body?.reply ?? result.body;

    // Convert reply to streaming format
    send({ type: 'progress', tool: 'render', label: 'Генерирую ответ' });
    const { markdown, actions } = replyToMarkdown(reply);
    send({ type: 'chunk', text: markdown });
    send({ type: 'done', actions });

  } catch (err) {
    send({ type: 'error', message: err?.message ?? 'Ошибка сервера' });
  }
}
```

### Add `replyToMarkdown` helper

```js
function replyToMarkdown(reply) {
  if (!reply || typeof reply !== 'object') {
    return { markdown: String(reply ?? '…'), actions: [] };
  }

  if (reply.kind === 'render_funnel') {
    const rows = (reply.rows ?? []).map(r =>
      `| ${r.step_name} | ${r.total} | ${r.completed} | ${r.in_progress} | ${r.stuck} | ${r.rejected} |`
    ).join('\n');

    const branches = (reply.branches ?? []).map(b => `- **${b.title}:** ${b.count}`).join('\n');

    const md = [
      `## ${reply.title ?? 'Воронка кандидатов'}`,
      '',
      `> Всего: **${reply.summary?.total ?? '—'}** | Квалифицированы: **${reply.summary?.qualified ?? '—'}** | Ждут движения: **${reply.summary?.waiting ?? '—'}**`,
      '',
      branches ? `${branches}\n` : '',
      '| Этап | Всего | Завершили | В работе | Зависли | Отсечены |',
      '|------|-------|-----------|----------|---------|----------|',
      rows,
    ].filter(Boolean).join('\n');

    return {
      markdown: md,
      actions: [
        { label: 'Обновить', message: 'обнови воронку' },
        { label: 'Детали кандидата', message: 'расскажи подробнее о кандидатах' },
      ],
    };
  }

  if (reply.kind === 'playbook_locked') {
    return {
      markdown: `> ⚠️ **${reply.title ?? 'Плейбук недоступен'}**\n\n${reply.message ?? ''}`,
      actions: [],
    };
  }

  if (reply.kind === 'fallback_text') {
    return {
      markdown: reply.text ?? '…',
      actions: [],
    };
  }

  // Unknown — dump as code block
  return {
    markdown: '```json\n' + JSON.stringify(reply, null, 2) + '\n```',
    actions: [],
  };
}
```

---

## Iteration 2 — Full CHAT_HTML rewrite

Replace the entire `CHAT_HTML` constant with the following. Read every line carefully — pixel-perfect dark-mode UI.

```js
const CHAT_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hiring Agent</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
  <style>
    :root {
      --font: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --bg:    #080a0f;
      --bg2:   #0e1118;
      --bg3:   #161b26;
      --edge:  #1e2535;
      --t1:    #e4e8f0;
      --t2:    #8892a4;
      --t3:    #4a5268;
      --acc:   #4f8ff7;
      --acc-d: rgba(79,143,247,0.12);
      --green: #34c759;
      --red:   #ef4444;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--t1);
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── HEADER ────────────────────────────────────────────────── */
    #header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 16px;
      height: 52px;
      border-bottom: 1px solid var(--edge);
      flex-shrink: 0;
    }
    #status-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--red);
      flex-shrink: 0;
      transition: background 0.3s;
    }
    #status-dot.connected { background: var(--green); }
    .logo {
      font-size: 14px;
      font-weight: 600;
      color: var(--t1);
      letter-spacing: -0.01em;
    }
    #vacancy-select {
      flex: 1;
      max-width: 320px;
      margin-left: auto;
      padding: 6px 10px;
      background: var(--bg3);
      border: 1px solid var(--edge);
      border-radius: 8px;
      color: var(--t1);
      font-family: var(--font);
      font-size: 13px;
      cursor: pointer;
      outline: none;
    }
    #vacancy-select:focus { border-color: var(--acc); }
    #vacancy-select option { background: var(--bg2); }
    #logout-btn {
      margin-left: 8px;
      padding: 5px 12px;
      font-size: 12px;
      font-family: var(--font);
      background: transparent;
      border: 1px solid var(--edge);
      border-radius: 7px;
      color: var(--t2);
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
    }
    #logout-btn:hover { border-color: var(--t2); color: var(--t1); }

    /* ── CHAT LOG ──────────────────────────────────────────────── */
    #chat-log {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scroll-behavior: smooth;
    }
    #chat-log::-webkit-scrollbar { width: 4px; }
    #chat-log::-webkit-scrollbar-track { background: transparent; }
    #chat-log::-webkit-scrollbar-thumb { background: var(--edge); border-radius: 2px; }

    /* ── EMPTY STATE ───────────────────────────────────────────── */
    #empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      flex: 1;
      padding: 40px 20px;
      text-align: center;
      color: var(--t2);
    }
    #empty-state .empty-icon { font-size: 40px; }
    #empty-state h2 { font-size: 18px; font-weight: 600; color: var(--t1); }
    #empty-state p { font-size: 14px; line-height: 1.5; max-width: 300px; }
    .btn-primary {
      padding: 9px 18px;
      background: var(--acc);
      color: white;
      border: none;
      border-radius: 9px;
      font-family: var(--font);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .btn-primary:hover { opacity: 0.88; }

    /* ── MESSAGE ROWS ──────────────────────────────────────────── */
    .msg-row { display: flex; }
    .msg-row.user { justify-content: flex-end; }
    .msg-row.assistant { justify-content: flex-start; }

    .bubble {
      max-width: min(75%, 680px);
      padding: 10px 14px;
      font-size: 14px;
      line-height: 1.55;
      border-radius: 12px;
      word-break: break-word;
    }
    .user-bubble {
      background: var(--acc);
      color: white;
      border-radius: 12px 12px 2px 12px;
    }
    .assistant-bubble {
      background: var(--bg2);
      border: 1px solid var(--edge);
      color: var(--t1);
      border-radius: 12px 12px 12px 2px;
      position: relative;
    }

    /* Streaming cursor */
    .assistant-bubble.streaming .bubble-content:not(:empty)::after {
      content: '▋';
      display: inline;
      color: var(--acc);
      animation: blink 1s step-end infinite;
      margin-left: 1px;
    }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

    /* ── PROGRESS STEPS ────────────────────────────────────────── */
    .progress-steps {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 6px;
    }
    .progress-steps:empty { display: none; }
    .progress-step {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      color: var(--t2);
    }
    .step-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--t3);
    }
    .progress-step.active .step-dot {
      background: var(--acc);
      animation: pulse-dot 1.4s ease-in-out infinite;
    }
    .progress-step.done .step-dot { background: var(--green); }
    @keyframes pulse-dot {
      0%,100%{opacity:1;transform:scale(1)}
      50%{opacity:0.45;transform:scale(0.75)}
    }

    /* ── BUBBLE CONTENT (markdown) ─────────────────────────────── */
    .bubble-content { overflow-x: auto; }
    .bubble-content p { margin: 0 0 8px; }
    .bubble-content p:last-child { margin-bottom: 0; }
    .bubble-content h1,.bubble-content h2,.bubble-content h3 {
      font-size: 15px; font-weight: 600; margin: 12px 0 6px;
      color: var(--t1);
    }
    .bubble-content h2 { font-size: 14px; }
    .bubble-content ul,.bubble-content ol {
      padding-left: 18px; margin: 4px 0 8px;
    }
    .bubble-content li { margin: 3px 0; }
    .bubble-content code {
      background: var(--bg3);
      border: 1px solid var(--edge);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 12px;
      font-family: 'SF Mono', 'Fira Code', monospace;
    }
    .bubble-content pre {
      background: var(--bg3);
      border: 1px solid var(--edge);
      border-radius: 8px;
      padding: 10px 12px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .bubble-content pre code {
      background: none; border: none; padding: 0; font-size: 12px;
    }
    .bubble-content table {
      width: 100%; border-collapse: collapse;
      font-size: 13px; margin: 8px 0;
    }
    .bubble-content th,.bubble-content td {
      padding: 6px 10px;
      border: 1px solid var(--edge);
      text-align: left;
    }
    .bubble-content th {
      background: var(--bg3);
      color: var(--t2);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .bubble-content tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
    .bubble-content blockquote {
      border-left: 3px solid var(--acc);
      padding: 4px 12px;
      margin: 8px 0;
      color: var(--t2);
      font-style: italic;
    }
    .bubble-content strong { color: var(--t1); font-weight: 600; }
    .bubble-content a { color: var(--acc); text-decoration: none; }
    .bubble-content a:hover { text-decoration: underline; }

    /* ── ACTION BUTTONS ────────────────────────────────────────── */
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--edge);
    }
    .actions:empty { display: none; }
    .action-btn {
      padding: 5px 12px;
      font-size: 12px;
      font-family: var(--font);
      font-weight: 500;
      border-radius: 7px;
      border: 1px solid var(--edge);
      background: var(--bg3);
      color: var(--t2);
      cursor: pointer;
      transition: all 0.12s;
      white-space: nowrap;
    }
    .action-btn:hover {
      background: var(--acc-d);
      border-color: var(--acc);
      color: var(--t1);
    }

    /* ── PLAYBOOK CHIPS (welcome message) ──────────────────────── */
    .playbook-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .playbook-chip {
      padding: 5px 12px;
      font-size: 12px;
      font-family: var(--font);
      font-weight: 500;
      border-radius: 7px;
      border: 1px solid var(--acc);
      background: var(--acc-d);
      color: var(--acc);
      cursor: pointer;
      transition: all 0.12s;
    }
    .playbook-chip:hover { background: var(--acc); color: white; }

    /* ── INPUT AREA ────────────────────────────────────────────── */
    #input-area {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 10px 16px 14px;
      border-top: 1px solid var(--edge);
      flex-shrink: 0;
    }
    #msg-input {
      flex: 1;
      resize: none;
      background: var(--bg3);
      border: 1px solid var(--edge);
      border-radius: 10px;
      padding: 9px 13px;
      font-family: var(--font);
      font-size: 14px;
      color: var(--t1);
      max-height: 160px;
      min-height: 38px;
      overflow-y: hidden;
      outline: none;
      transition: border-color 0.15s;
      line-height: 1.5;
    }
    #msg-input::placeholder { color: var(--t3); }
    #msg-input:focus { border-color: var(--acc); }
    #send-btn {
      width: 36px; height: 36px;
      flex-shrink: 0;
      border-radius: 9px;
      border: none;
      background: var(--acc);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.12s;
    }
    #send-btn:disabled { opacity: 0.35; cursor: default; }
    #send-btn svg { width: 16px; height: 16px; }
  </style>
</head>
<body>
  <!-- Header -->
  <header id="header">
    <div id="status-dot" title="WebSocket"></div>
    <div class="logo">Hiring Agent</div>
    <select id="vacancy-select">
      <option value="">Загрузка вакансий…</option>
    </select>
    <a href="/logout" id="logout-btn">Выйти</a>
  </header>

  <!-- Chat log -->
  <div id="chat-log">
    <!-- Empty state shown before vacancy selected / on load -->
    <div id="empty-state">
      <div class="empty-icon">📋</div>
      <h2>Выберите вакансию</h2>
      <p>Выберите вакансию в меню выше или создайте новую</p>
      <button class="btn-primary" id="create-vacancy-btn">Создать вакансию</button>
    </div>
  </div>

  <!-- Input -->
  <div id="input-area">
    <textarea id="msg-input" placeholder="Напишите сообщение…" rows="1"></textarea>
    <button id="send-btn" disabled title="Отправить">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>
    </button>
  </div>

  <script>
    // ── Config ────────────────────────────────────────────────────────────────
    const WS_URL = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';
    const STEP_LABELS = {
      auto_fetch:    'Загружаю данные вакансии',
      route_playbook:'Определяю плейбук',
      llm_extract:   'Извлекаю данные',
      llm_generate:  'Генерирую текст',
      data_fetch:    'Запрашиваю данные',
      decision:      'Проверяю условия',
      render:        'Генерирую ответ',
    };

    // ── State ─────────────────────────────────────────────────────────────────
    let ws = null;
    let streaming = false;
    let selectedVacancyId = null;
    let currentAssistant = null; // { stepsEl, contentEl, actionsEl, text }

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const chatLog        = document.getElementById('chat-log');
    const emptyState     = document.getElementById('empty-state');
    const vacancySelect  = document.getElementById('vacancy-select');
    const msgInput       = document.getElementById('msg-input');
    const sendBtn        = document.getElementById('send-btn');
    const statusDot      = document.getElementById('status-dot');
    const createVacBtn   = document.getElementById('create-vacancy-btn');

    // ── WebSocket ─────────────────────────────────────────────────────────────
    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        statusDot.classList.add('connected');
        updateSendEnabled();
      };

      ws.onclose = () => {
        statusDot.classList.remove('connected');
        updateSendEnabled();
        setTimeout(connect, 3000); // auto-reconnect
      };

      ws.onerror = () => statusDot.classList.remove('connected');

      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data);

        if (data.type === 'progress' && currentAssistant) {
          // Mark previous step done
          const prev = currentAssistant.stepsEl.querySelector('.progress-step.active');
          if (prev) prev.classList.replace('active', 'done');

          const step = document.createElement('div');
          step.className = 'progress-step active';
          step.innerHTML =
            '<span class="step-dot"></span>' +
            '<span>' + escapeHtml(data.label || STEP_LABELS[data.tool] || data.tool) + '</span>';
          currentAssistant.stepsEl.appendChild(step);
          scrollBottom();
        }

        if (data.type === 'chunk' && currentAssistant) {
          currentAssistant.text += data.text;
          renderMarkdown(currentAssistant.contentEl, currentAssistant.text);
          scrollBottom();
        }

        if (data.type === 'done' && currentAssistant) {
          // Mark last step done
          const active = currentAssistant.stepsEl.querySelector('.progress-step.active');
          if (active) active.classList.replace('active', 'done');

          // Remove streaming cursor
          currentAssistant.bubbleEl.classList.remove('streaming');

          // Render action buttons
          if (data.actions && data.actions.length > 0) {
            data.actions.forEach(({ label, message }) => {
              const btn = document.createElement('button');
              btn.className = 'action-btn';
              btn.textContent = label;
              btn.dataset.msg = message;
              btn.addEventListener('click', () => sendMessage(message));
              currentAssistant.actionsEl.appendChild(btn);
            });
          }

          currentAssistant = null;
          streaming = false;
          updateSendEnabled();
          scrollBottom();
        }

        if (data.type === 'error') {
          if (currentAssistant) {
            currentAssistant.bubbleEl.classList.remove('streaming');
            const errEl = document.createElement('p');
            errEl.style.color = 'var(--red)';
            errEl.style.fontSize = '13px';
            errEl.textContent = '❌ ' + (data.message || 'Ошибка сервера');
            currentAssistant.contentEl.appendChild(errEl);
            currentAssistant = null;
          }
          streaming = false;
          updateSendEnabled();
        }
      };
    }

    function renderMarkdown(el, text) {
      const html = DOMPurify.sanitize(marked.parse(text));
      el.innerHTML = html;
    }

    // ── Messages ──────────────────────────────────────────────────────────────
    function addUserBubble(text) {
      const row = document.createElement('div');
      row.className = 'msg-row user';
      const bubble = document.createElement('div');
      bubble.className = 'bubble user-bubble';
      bubble.textContent = text;
      row.appendChild(bubble);
      chatLog.appendChild(row);
      scrollBottom();
    }

    function addAssistantBubble() {
      const row = document.createElement('div');
      row.className = 'msg-row assistant';

      const bubble = document.createElement('div');
      bubble.className = 'bubble assistant-bubble streaming';

      const stepsEl = document.createElement('div');
      stepsEl.className = 'progress-steps';

      const contentEl = document.createElement('div');
      contentEl.className = 'bubble-content';

      const actionsEl = document.createElement('div');
      actionsEl.className = 'actions';

      bubble.appendChild(stepsEl);
      bubble.appendChild(contentEl);
      bubble.appendChild(actionsEl);
      row.appendChild(bubble);
      chatLog.appendChild(row);
      scrollBottom();

      return { bubbleEl: bubble, stepsEl, contentEl, actionsEl, text: '' };
    }

    function addSystemMessage(markdown) {
      const row = document.createElement('div');
      row.className = 'msg-row assistant';
      const bubble = document.createElement('div');
      bubble.className = 'bubble assistant-bubble';
      const contentEl = document.createElement('div');
      contentEl.className = 'bubble-content';
      renderMarkdown(contentEl, markdown);
      bubble.appendChild(contentEl);
      row.appendChild(bubble);
      chatLog.appendChild(row);
      scrollBottom();
      return bubble;
    }

    function sendMessage(text) {
      if (!text || !text.trim()) return;
      if (streaming) return;
      if (!ws || ws.readyState !== 1) return;

      streaming = true;
      updateSendEnabled();

      addUserBubble(text);
      currentAssistant = addAssistantBubble();

      msgInput.value = '';
      msgInput.style.height = 'auto';

      ws.send(JSON.stringify({ type: 'message', text: text.trim(), vacancyId: selectedVacancyId }));
    }

    // ── Vacancy selector ──────────────────────────────────────────────────────
    async function loadVacancies() {
      try {
        const res = await fetch('/api/jobs');
        if (res.status === 401) { window.location = '/login'; return; }
        const data = await res.json();
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];

        // Clear and repopulate
        vacancySelect.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = jobs.length === 0 ? 'Нет вакансий' : 'Выберите вакансию…';
        vacancySelect.appendChild(placeholder);

        jobs.forEach(job => {
          const opt = document.createElement('option');
          opt.value = job.job_id;
          opt.textContent = job.title;
          vacancySelect.appendChild(opt);
        });

        // «+ Создать вакансию» at the end
        const createOpt = document.createElement('option');
        createOpt.value = '__create__';
        createOpt.textContent = '+ Создать вакансию';
        vacancySelect.appendChild(createOpt);

        // Auto-select if only one
        if (jobs.length === 1) {
          vacancySelect.value = jobs[0].job_id;
          onVacancySelected(jobs[0].job_id, jobs[0].title);
        }
      } catch {
        vacancySelect.innerHTML = '<option value="">Ошибка загрузки</option>';
      }
    }

    vacancySelect.addEventListener('change', () => {
      const val = vacancySelect.value;
      if (val === '__create__') {
        vacancySelect.value = selectedVacancyId || '';
        triggerCreateVacancy();
        return;
      }
      const title = vacancySelect.options[vacancySelect.selectedIndex]?.text ?? '';
      onVacancySelected(val || null, title);
    });

    function onVacancySelected(vacancyId, title) {
      selectedVacancyId = vacancyId;

      // Clear chat
      chatLog.innerHTML = '';

      if (!vacancyId) {
        chatLog.appendChild(emptyState);
        updateSendEnabled();
        return;
      }

      // Welcome message with playbook chips
      showWelcome(vacancyId, title);
      updateSendEnabled();
    }

    function showWelcome(vacancyId, title) {
      const bubbleEl = addSystemMessage(
        'Работаю с вакансией **' + escapeText(title) + '**. Что будем делать?'
      );

      // Add playbook chips
      const PLAYBOOKS = [
        { label: 'Настрой общение', msg: 'настрой общение с кандидатами' },
        { label: 'Посмотреть вакансию', msg: 'посмотри вакансию' },
        { label: 'Воронка', msg: 'покажи воронку по кандидатам' },
        { label: 'Рассылка', msg: 'сделай рассылку' },
      ];

      const chipsEl = document.createElement('div');
      chipsEl.className = 'playbook-chips';
      PLAYBOOKS.forEach(({ label, msg }) => {
        const chip = document.createElement('button');
        chip.className = 'playbook-chip';
        chip.textContent = label;
        chip.addEventListener('click', () => sendMessage(msg));
        chipsEl.appendChild(chip);
      });
      bubbleEl.appendChild(chipsEl);
    }

    function triggerCreateVacancy() {
      selectedVacancyId = null;
      chatLog.innerHTML = '';
      updateSendEnabled();
      sendMessage('создать вакансию');
    }

    createVacBtn.addEventListener('click', triggerCreateVacancy);

    // ── Input handling ────────────────────────────────────────────────────────
    msgInput.addEventListener('input', () => {
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 160) + 'px';
      updateSendEnabled();
    });

    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendMessage(msgInput.value);
      }
    });

    sendBtn.addEventListener('click', () => sendMessage(msgInput.value));

    function updateSendEnabled() {
      const ready = ws?.readyState === 1 && !streaming && msgInput.value.trim().length > 0;
      sendBtn.disabled = !ready;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function scrollBottom() {
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function escapeHtml(s) {
      return String(s ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function escapeText(s) {
      // For use inside markdown (not HTML)
      return String(s ?? '').replace(/[\\*_[\]()]/g, '\\\\$&');
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    // Configure marked
    marked.use({ breaks: true, gfm: true });

    // Start WS
    connect();

    // Load vacancies
    loadVacancies();

    // Show empty state initially
    chatLog.innerHTML = '';
    chatLog.appendChild(emptyState);
  </script>
</body>
</html>\`;
```

---

## Tests

After both iterations, run:

```bash
cd /Users/vova/Documents/GitHub/hiring-agent && pnpm test
```

All existing tests must pass. The WS addition is purely additive — HTTP endpoints unchanged.

If tests fail due to import errors from `ws` package, make sure `pnpm install` was run after adding `ws` to `package.json`.

---

## Commit instructions

After iteration 1 (WS backend):
```bash
git add package.json services/hiring-agent/src/http-server.js
git commit -m "feat: add WebSocket server to hiring-agent — streaming, heartbeat, WS auth"
```

After iteration 2 (frontend):
```bash
git add services/hiring-agent/src/http-server.js
git commit -m "feat: rewrite hiring-agent chat UI — dark mode, streaming bubbles, playbook chips, vacancy modality"
```

---

## Verification Note

2026-04-14: Iteration 1 backend work is already present on `feature/chat-ui-replication` in commit `59acb00` (`feat: add WebSocket server to hiring-agent — streaming, heartbeat, WS auth`).

Validation run from repo root:

```bash
pnpm test
```

Result: 13 tests passed, 0 failed.
