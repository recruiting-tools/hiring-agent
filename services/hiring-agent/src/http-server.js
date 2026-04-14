import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { WebSocketServer } from "ws";
import { createSession, getRecruiterByEmail, parseCookies, resolveSession } from "./auth.js";
import { TenantDbTimeoutError } from "./app.js";
import {
  AccessContextError,
  resolveAccessContext
} from "../../../packages/access-context/src/index.js";

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
  <title>Вход</title>
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
      <div class="eyebrow">Recruiter</div>
      <h1>Вход</h1>
      <div class="subhead">Введите email и пароль.</div>
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
  <title>Вакансии</title>
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
      overflow-x: hidden;
      overflow-y: hidden;
    }

    /* ── HEADER ────────────────────────────────────────────────── */
    #header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 16px;
      min-height: 52px;
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
      flex: 1 1 280px;
      min-width: 0;
      max-width: 420px;
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
    #recruiter-email {
      font-size: 12px;
      color: var(--t3);
      margin-left: 4px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── CHAT LOG ──────────────────────────────────────────────── */
    #chat-log {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      width: min(100%, 980px);
      margin: 0 auto;
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
    #empty-state h2 { font-size: 18px; font-weight: 600; color: var(--t1); }
    #empty-state p { font-size: 14px; line-height: 1.5; max-width: 300px; }

    /* ── MESSAGE ROWS ──────────────────────────────────────────── */
    .msg-row {
      display: flex;
      width: 100%;
      min-width: 0;
    }
    .msg-row.user { justify-content: flex-end; }
    .msg-row.assistant { justify-content: flex-start; }

    .bubble {
      max-width: min(100%, 680px);
      padding: 10px 14px;
      font-size: 14px;
      line-height: 1.55;
      border-radius: 12px;
      word-break: break-word;
      overflow-wrap: anywhere;
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
    .comm-plan {
      display: grid;
      gap: 12px;
      margin-top: 4px;
    }
    .comm-plan-card {
      border: 1px solid var(--edge);
      border-radius: 12px;
      background: rgba(255,255,255,0.02);
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .comm-plan-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--t1);
      margin: 0;
      line-height: 1.35;
    }
    .comm-plan-note {
      margin: 0;
      padding: 8px 10px;
      border: 1px solid rgba(79, 143, 247, 0.35);
      background: rgba(79, 143, 247, 0.10);
      border-radius: 8px;
      color: #dbe8ff;
      font-size: 13px;
      line-height: 1.4;
    }
    .comm-plan-subtitle {
      margin: 0;
      font-size: 12px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--t3);
      font-weight: 600;
    }
    .comm-plan-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--edge);
      border-radius: 10px;
      background: rgba(0,0,0,0.12);
    }
    .comm-plan-table {
      width: 100%;
      min-width: 560px;
      border-collapse: collapse;
      font-size: 13px;
      line-height: 1.45;
    }
    .comm-plan-table th,
    .comm-plan-table td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--edge);
      text-align: left;
      vertical-align: top;
    }
    .comm-plan-table tr:last-child td {
      border-bottom: none;
    }
    .comm-plan-table th {
      background: rgba(255,255,255,0.03);
      color: var(--t2);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-weight: 600;
      white-space: nowrap;
    }
    .comm-plan-reminders {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid rgba(79, 143, 247, 0.45);
      background: rgba(79, 143, 247, 0.14);
      color: #dbe8ff;
      font-weight: 600;
      font-size: 12px;
      line-height: 1;
    }
    .comm-plan-goal {
      margin: 0;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(126, 208, 162, 0.28);
      background: rgba(126, 208, 162, 0.09);
      color: #dff7eb;
      font-size: 13px;
      line-height: 1.45;
    }
    .comm-plan-examples {
      display: grid;
      gap: 8px;
    }
    .comm-plan-example {
      border: 1px solid var(--edge);
      border-radius: 10px;
      padding: 10px;
      background: rgba(255,255,255,0.02);
      display: grid;
      gap: 6px;
    }
    .comm-plan-example-title {
      margin: 0;
      font-weight: 600;
      color: var(--t1);
      font-size: 13px;
      line-height: 1.35;
    }
    .comm-plan-example-text {
      margin: 0;
      color: var(--t2);
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .comm-plan-hint {
      margin: 0;
      color: var(--t3);
      font-size: 12px;
      line-height: 1.45;
    }

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
    .artifact-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed var(--edge);
      font-size: 12px;
      color: var(--t2);
      flex-wrap: wrap;
    }
    .artifact-bar:empty { display: none; }
    .artifact-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      border: 1px solid var(--edge);
      background: var(--bg3);
      color: var(--t2);
      border-radius: 7px;
      padding: 5px 10px;
      transition: all 0.12s;
      max-width: 100%;
    }
    .artifact-link:hover {
      border-color: var(--acc);
      color: var(--t1);
      background: var(--acc-d);
    }
    .artifact-copy {
      border: 1px solid var(--edge);
      background: transparent;
      color: var(--t2);
      border-radius: 7px;
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    .artifact-copy:hover {
      border-color: var(--acc);
      color: var(--t1);
    }
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
      white-space: normal;
      text-align: left;
      line-height: 1.25;
    }
    .action-btn:hover {
      background: var(--acc-d);
      border-color: var(--acc);
      color: var(--t1);
    }

    /* ── INPUT AREA ────────────────────────────────────────────── */
    #input-area {
      width: min(100%, 980px);
      margin: 0 auto;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 10px 16px 14px;
      border-top: 1px solid var(--edge);
      flex-shrink: 0;
      min-width: 0;
    }
    #msg-input {
      flex: 1;
      min-width: 0;
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
    @media (max-width: 900px) {
      #header {
        align-items: stretch;
      }
      #vacancy-select {
        order: 10;
        flex-basis: 100%;
        max-width: none;
        margin-left: 0;
      }
      #recruiter-email {
        flex: 1 1 auto;
      }
    }
  </style>
</head>
<body>
  <!-- Hiring Agent -->
  <!-- Header -->
  <header id="header">
    <div id="status-dot" title="WebSocket"></div>
    <div class="logo">Вакансия</div>
    <select id="vacancy-select">
      <option value="">Загрузка вакансий…</option>
    </select>
    <span id="recruiter-email">__RECRUITER_EMAIL__</span>
    <a href="/logout" id="logout-btn">Выйти</a>
  </header>

  <!-- Chat log -->
  <div id="chat-log">
    <!-- Empty state shown before vacancy selected / on load -->
    <div id="empty-state">
      <h2>Выберите вакансию</h2>
      <p>Выберите вакансию в меню сверху</p>
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
    const INITIAL_URL_STATE = readUrlState();

    // ── State ─────────────────────────────────────────────────────────────────
    let ws = null;
    let streaming = false;
    let selectedVacancyId = null;
    let currentArtifactId = INITIAL_URL_STATE.artifactId;
    let currentSessionId = INITIAL_URL_STATE.sessionId;
    let currentAssistant = null; // { stepsEl, contentEl, artifactEl, actionsEl, text }

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const chatLog        = document.getElementById('chat-log');
    const emptyState     = document.getElementById('empty-state');
    const vacancySelect  = document.getElementById('vacancy-select');
    const msgInput       = document.getElementById('msg-input');
    const sendBtn        = document.getElementById('send-btn');
    const statusDot      = document.getElementById('status-dot');

    // ── WebSocket ─────────────────────────────────────────────────────────────
    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        statusDot.classList.add('connected');
        updateSendEnabled();
      };

      ws.onclose = (ev) => {
        streaming = false;
        currentAssistant = null;
        statusDot.classList.remove('connected');
        updateSendEnabled();
        if (ev.code === 4001) { window.location = '/login'; return; }
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
          if (data.artifact) {
            renderArtifactFooter(currentAssistant.artifactEl, data.artifact);
            currentArtifactId = data.artifact.id || currentArtifactId;
            currentSessionId = data.artifact.session_id || currentSessionId;
            writeUrlState({
              vacancyId: selectedVacancyId,
              artifactId: currentArtifactId,
              sessionId: currentSessionId,
              push: true
            });
          }

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

      const artifactEl = document.createElement('div');
      artifactEl.className = 'artifact-bar';

      bubble.appendChild(stepsEl);
      bubble.appendChild(contentEl);
      bubble.appendChild(artifactEl);
      bubble.appendChild(actionsEl);
      row.appendChild(bubble);
      chatLog.appendChild(row);
      scrollBottom();

      return { bubbleEl: bubble, stepsEl, contentEl, artifactEl, actionsEl, text: '' };
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

    function renderArtifactFooter(container, artifact) {
      if (!container || !artifact || !artifact.url) return;
      container.innerHTML = '';

      const link = document.createElement('a');
      link.className = 'artifact-link';
      link.href = artifact.url;
      link.target = '_blank';
      link.rel = 'noopener';
      const shortId = String(artifact.id || '').slice(0, 8);
      link.textContent = shortId ? ('Артефакт #' + shortId) : 'Открыть артефакт';
      container.appendChild(link);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'artifact-copy';
      copyBtn.textContent = 'Копировать ссылку';
      copyBtn.addEventListener('click', async () => {
        try {
          const absoluteUrl = new URL(artifact.url, location.origin).toString();
          await navigator.clipboard.writeText(absoluteUrl);
          copyBtn.textContent = 'Скопировано';
          setTimeout(() => { copyBtn.textContent = 'Копировать ссылку'; }, 1400);
        } catch {
          copyBtn.textContent = 'Не скопировано';
          setTimeout(() => { copyBtn.textContent = 'Копировать ссылку'; }, 1400);
        }
      });
      container.appendChild(copyBtn);
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
        let artifactPayload = null;
        let requestedVacancyId = INITIAL_URL_STATE.vacancyId;

        if (INITIAL_URL_STATE.artifactId) {
          artifactPayload = await fetchArtifactPayload(INITIAL_URL_STATE.artifactId);
          const artifactVacancyId = artifactPayload?.artifact?.vacancy_id || null;
          if (!requestedVacancyId && artifactVacancyId) {
            requestedVacancyId = artifactVacancyId;
          }
          if (!currentSessionId && artifactPayload?.artifact?.session_id) {
            currentSessionId = artifactPayload.artifact.session_id;
          }
          currentArtifactId = INITIAL_URL_STATE.artifactId;
        }

        if (jobs.length === 0) {
          // No vacancies: hide dropdown, update empty state to "create first"
          vacancySelect.style.display = 'none';
          document.querySelector('#empty-state h2').textContent = 'Нет вакансий';
          document.querySelector('#empty-state p').textContent = 'Добавьте вакансию в системе';
          return;
        }

        // Has vacancies: ensure dropdown is visible
        vacancySelect.style.display = '';
        vacancySelect.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Выберите вакансию…';
        vacancySelect.appendChild(placeholder);

        jobs.forEach(job => {
          const opt = document.createElement('option');
          opt.value = job.job_id;
          opt.textContent = job.title;
          vacancySelect.appendChild(opt);
        });

        if (requestedVacancyId) {
          const requested = jobs.find((job) => job.job_id === requestedVacancyId);
          if (requested) {
            vacancySelect.value = requested.job_id;
            onVacancySelected(requested.job_id, requested.title, {
              preserveArtifact: true,
              skipWelcome: Boolean(artifactPayload)
            });
            if (artifactPayload) {
              hydrateChatFromArtifactPayload(artifactPayload);
            }
            return;
          }
        }

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
      const title = vacancySelect.options[vacancySelect.selectedIndex]?.text ?? '';
      onVacancySelected(val || null, title);
    });

    function onVacancySelected(vacancyId, title, options = {}) {
      const preserveArtifact = Boolean(options.preserveArtifact);
      const skipWelcome = Boolean(options.skipWelcome);
      selectedVacancyId = vacancyId;
      if (!preserveArtifact) {
        currentArtifactId = null;
        currentSessionId = null;
      }
      writeUrlState({
        vacancyId: selectedVacancyId,
        artifactId: currentArtifactId,
        sessionId: currentSessionId,
        push: false
      });

      // Clear chat
      chatLog.innerHTML = '';

      if (!vacancyId) {
        chatLog.appendChild(emptyState);
        updateSendEnabled();
        return;
      }

      // Welcome message with playbook chips
      if (!skipWelcome) {
        showWelcome(vacancyId, title);
      }
      updateSendEnabled();
    }

    function showWelcome(_vacancyId, title) {
      addSystemMessage('Вакансия: **' + escapeText(title) + '**');
    }

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

    async function fetchArtifactPayload(artifactId) {
      if (!artifactId) return null;
      try {
        const response = await fetch('/api/artifacts/' + encodeURIComponent(artifactId));
        if (response.status === 401) {
          window.location = '/login';
          return null;
        }
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    }

    function hydrateChatFromArtifactPayload(payload) {
      if (!payload || !payload.artifact) return;
      const historyItems = Array.isArray(payload.history) && payload.history.length > 0
        ? payload.history
        : [payload.artifact];

      chatLog.innerHTML = '';

      historyItems.forEach((item) => {
        if (item.request_message) {
          addUserBubble(String(item.request_message));
        }
        const markdown = mapReplyToMarkdown(item.reply);
        addAssistantHistoryBubble(markdown, {
          id: item.artifact_id,
          url: '/artifact/' + encodeURIComponent(item.artifact_id || '')
        });
      });

      if (historyItems.length === 0) {
        addSystemMessage('История артефакта пока пустая.');
      }
      scrollBottom();
    }

    function addAssistantHistoryBubble(markdown, artifact) {
      const row = document.createElement('div');
      row.className = 'msg-row assistant';

      const bubble = document.createElement('div');
      bubble.className = 'bubble assistant-bubble';

      const contentEl = document.createElement('div');
      contentEl.className = 'bubble-content';
      renderMarkdown(contentEl, markdown || '...');

      const artifactEl = document.createElement('div');
      artifactEl.className = 'artifact-bar';
      renderArtifactFooter(artifactEl, artifact);

      bubble.appendChild(contentEl);
      bubble.appendChild(artifactEl);
      row.appendChild(bubble);
      chatLog.appendChild(row);
    }

    function mapReplyToMarkdown(reply) {
      if (!reply || typeof reply !== 'object') {
        return String(reply ?? '...');
      }
      if (reply.kind === 'fallback_text') return reply.text || '...';
      if (reply.kind === 'llm_output') return reply.content || '...';
      if (reply.kind === 'display') return reply.content || '...';
      if (reply.kind === 'user_input') return reply.message || '...';
      if (reply.kind === 'playbook_locked') {
        return '> ⚠️ **' + escapeText(reply.title || 'Плейбук недоступен') + '**\n\n' + String(reply.message || '');
      }
      if (reply.kind === 'render_funnel') {
        const rows = (reply.rows || []).map((r) =>
          '| ' + (r.step_name || '-') + ' | ' + (r.total || 0) + ' | ' + (r.completed || 0) + ' | ' + (r.in_progress || 0) + ' | ' + (r.stuck || 0) + ' | ' + (r.rejected || 0) + ' |'
        ).join('\\n');
        return [
          '## ' + String(reply.title || 'Воронка кандидатов'),
          '',
          '| Этап | Всего | Завершили | В работе | Зависли | Отсечены |',
          '|------|-------|-----------|----------|---------|----------|',
          rows || '| — | 0 | 0 | 0 | 0 | 0 |'
        ].join('\\n');
      }
      return '~~~json\\n' + JSON.stringify(reply, null, 2) + '\\n~~~';
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function scrollBottom() {
      chatLog.scrollTop = chatLog.scrollHeight;
    }

    function readUrlState() {
      const params = new URLSearchParams(location.search);
      const pathParts = location.pathname.split('/').filter(Boolean);
      const pathArtifactId = pathParts[0] === 'chat' && pathParts[1] ? decodeURIComponent(pathParts[1]) : null;
      return {
        vacancyId: params.get('vacancy_id') || null,
        artifactId: params.get('artifact_id') || pathArtifactId,
        sessionId: params.get('session_id') || null
      };
    }

    function writeUrlState({ vacancyId, artifactId, sessionId, push = false }) {
      const params = new URLSearchParams(location.search);
      if (vacancyId) params.set('vacancy_id', vacancyId); else params.delete('vacancy_id');
      params.delete('artifact_id');
      if (sessionId) params.set('session_id', sessionId); else params.delete('session_id');

      const query = params.toString();
      const path = artifactId
        ? ('/chat/' + encodeURIComponent(artifactId))
        : '/chat';
      const nextUrl = query ? (path + '?' + query) : path;
      const state = { vacancyId, artifactId, sessionId };
      if (push) {
        history.pushState(state, '', nextUrl);
      } else {
        history.replaceState(state, '', nextUrl);
      }
    }

    function escapeHtml(s) {
      return String(s ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function escapeText(s) {
      // For use inside markdown (not HTML)
      return String(s ?? '').replace(/[\\*_[\]()]/g, '\\$&');
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
</html>`;

const ARTIFACT_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Artifact</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
  <style>
    :root {
      --font: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --bg: #080a0f;
      --bg2: #0e1118;
      --edge: #1e2535;
      --t1: #e4e8f0;
      --t2: #8892a4;
      --acc: #4f8ff7;
      --acc-d: rgba(79,143,247,0.12);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--t1);
      padding: 24px 16px 40px;
    }
    .wrap {
      width: min(100%, 980px);
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    .card {
      background: var(--bg2);
      border: 1px solid var(--edge);
      border-radius: 12px;
      padding: 14px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 180px 1fr;
      gap: 8px 12px;
      font-size: 13px;
      color: var(--t2);
    }
    .meta-grid b { color: var(--t1); font-weight: 600; }
    .history {
      display: grid;
      gap: 10px;
    }
    .history-item {
      border: 1px solid var(--edge);
      border-radius: 10px;
      overflow: hidden;
    }
    .history-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: rgba(255,255,255,0.02);
      border-bottom: 1px solid var(--edge);
      font-size: 12px;
      color: var(--t2);
    }
    .history-body {
      display: grid;
      gap: 10px;
      padding: 12px;
    }
    .input, .reply {
      border: 1px solid var(--edge);
      border-radius: 8px;
      padding: 10px;
      font-size: 13px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .input {
      background: rgba(79,143,247,0.08);
      color: #d8e5ff;
    }
    .reply {
      background: rgba(255,255,255,0.02);
      color: var(--t1);
    }
    .muted {
      color: var(--t2);
      font-size: 13px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--edge);
      color: var(--t2);
      background: transparent;
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
      text-decoration: none;
      font-size: 13px;
    }
    .btn:hover {
      color: var(--t1);
      border-color: var(--acc);
      background: var(--acc-d);
    }
    .comm-plan {
      display: grid;
      gap: 12px;
    }
    .comm-plan-card {
      border: 1px solid var(--edge);
      border-radius: 12px;
      background: rgba(255,255,255,0.02);
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .comm-plan-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--t1);
      margin: 0;
      line-height: 1.35;
    }
    .comm-plan-note {
      margin: 0;
      padding: 8px 10px;
      border: 1px solid rgba(79, 143, 247, 0.35);
      background: rgba(79, 143, 247, 0.10);
      border-radius: 8px;
      color: #dbe8ff;
      font-size: 13px;
      line-height: 1.4;
    }
    .comm-plan-subtitle {
      margin: 0;
      font-size: 12px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--t2);
      font-weight: 600;
    }
    .comm-plan-table-wrap {
      overflow-x: auto;
      border: 1px solid var(--edge);
      border-radius: 10px;
      background: rgba(0,0,0,0.12);
    }
    .comm-plan-table {
      width: 100%;
      min-width: 560px;
      border-collapse: collapse;
      font-size: 13px;
      line-height: 1.45;
    }
    .comm-plan-table th,
    .comm-plan-table td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--edge);
      text-align: left;
      vertical-align: top;
    }
    .comm-plan-table tr:last-child td {
      border-bottom: none;
    }
    .comm-plan-table th {
      background: rgba(255,255,255,0.03);
      color: var(--t2);
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-weight: 600;
      white-space: nowrap;
    }
    .comm-plan-reminders {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 26px;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid rgba(79, 143, 247, 0.45);
      background: rgba(79, 143, 247, 0.14);
      color: #dbe8ff;
      font-weight: 600;
      font-size: 12px;
      line-height: 1;
    }
    .comm-plan-goal {
      margin: 0;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(126, 208, 162, 0.28);
      background: rgba(126, 208, 162, 0.09);
      color: #dff7eb;
      font-size: 13px;
      line-height: 1.45;
    }
    .comm-plan-examples {
      display: grid;
      gap: 8px;
    }
    .comm-plan-example {
      border: 1px solid var(--edge);
      border-radius: 10px;
      padding: 10px;
      background: rgba(255,255,255,0.02);
      display: grid;
      gap: 6px;
    }
    .comm-plan-example-title {
      margin: 0;
      font-weight: 600;
      color: var(--t1);
      font-size: 13px;
      line-height: 1.35;
    }
    .comm-plan-example-text {
      margin: 0;
      color: var(--t2);
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .comm-plan-hint {
      margin: 0;
      color: var(--t2);
      font-size: 12px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1 style="font-size:20px; margin-bottom: 10px;">Артефакт чата</h1>
      <div class="muted" id="artifactStatus">Загрузка…</div>
      <div style="display:flex; gap:8px; margin-top: 10px;">
        <a class="btn" href="/chat" target="_self">Назад в чат</a>
        <button class="btn" id="copyLinkBtn" type="button">Копировать ссылку</button>
      </div>
    </div>

    <div class="card">
      <div class="meta-grid" id="metaGrid"></div>
    </div>

    <div class="card">
      <h2 style="font-size:16px; margin-bottom: 10px;">История</h2>
      <div id="history" class="history"></div>
    </div>
  </div>

  <script>
    const ARTIFACT_ID = '__ARTIFACT_ID__';
    const statusEl = document.getElementById('artifactStatus');
    const metaGrid = document.getElementById('metaGrid');
    const historyEl = document.getElementById('history');
    const copyLinkBtn = document.getElementById('copyLinkBtn');

    copyLinkBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        copyLinkBtn.textContent = 'Скопировано';
      } catch {
        copyLinkBtn.textContent = 'Не скопировано';
      }
      setTimeout(() => { copyLinkBtn.textContent = 'Копировать ссылку'; }, 1400);
    });

    function addMeta(label, value) {
      const key = document.createElement('b');
      key.textContent = label;
      const val = document.createElement('span');
      val.textContent = value == null ? '—' : String(value);
      metaGrid.appendChild(key);
      metaGrid.appendChild(val);
    }

    function replyToMarkdown(reply) {
      if (!reply || typeof reply !== 'object') return String(reply ?? '');
      if (reply.kind === 'fallback_text') return reply.text ?? '';
      if (reply.kind === 'llm_output') return reply.content ?? '';
      if (reply.kind === 'communication_plan') return communicationPlanToMarkdown(reply);
      if (reply.kind === 'display') return reply.content ?? '';
      if (reply.kind === 'user_input') return reply.message ?? '';
      if (reply.kind === 'playbook_locked') return '> ⚠️ ' + (reply.message ?? '');
      if (reply.kind === 'completed') return reply.message ?? 'Playbook completed.';
      return '~~~json\\n' + JSON.stringify(reply, null, 2) + '\\n~~~';
    }

    function communicationPlanToMarkdown(reply) {
      const rows = Array.isArray(reply.steps) ? reply.steps : [];
      const examples = Array.isArray(reply.examples) ? reply.examples : [];

      const escape = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const tableRows = rows.length > 0
        ? rows.map((row) => {
          const step = escape(String(row.step ?? '').trim() || '—');
          const reminders = Number.isFinite(Number(row.reminders_count)) ? Number(row.reminders_count) : 0;
          const comment = escape(String(row.comment ?? '').trim() || '—');
          return (
            '<tr>' +
              '<td>' + step + '</td>' +
              '<td><span class="comm-plan-reminders">' + reminders + '</span></td>' +
              '<td>' + comment + '</td>' +
            '</tr>'
          );
        }).join('')
        : (
          '<tr><td>—</td><td><span class="comm-plan-reminders">0</span></td><td>—</td></tr>'
        );

      const examplesHtml = examples.length > 0
        ? (
          '<div class="comm-plan-examples">' +
          examples.map((item, index) => (
            '<article class="comm-plan-example">' +
              '<h4 class="comm-plan-example-title">' + escape(item.title || ('Вариант ' + (index + 1))) + '</h4>' +
              '<p class="comm-plan-example-text">' + escape(item.message || '') + '</p>' +
            '</article>'
          )).join('') +
          '</div>'
        )
        : '<p class="comm-plan-hint">Чтобы увидеть примеры первого сообщения, нажмите кнопку «Сгенерировать примеры общения по этому сценарию коммуникаций».</p>';

      const noteHtml = reply.note
        ? '<p class="comm-plan-note">' + escape(reply.note) + '</p>'
        : '';

      return (
        '<section class="comm-plan">' +
          '<article class="comm-plan-card">' +
            '<h3 class="comm-plan-title">План коммуникации</h3>' +
            noteHtml +
            '<p><strong>Сценарий:</strong> ' + escape(reply.scenario_title || 'Рабочий сценарий') + '</p>' +
            '<div class="comm-plan-table-wrap">' +
              '<table class="comm-plan-table">' +
                '<thead><tr><th>Шаг</th><th>Кол-во напоминалок</th><th>Комментарий</th></tr></thead>' +
                '<tbody>' + tableRows + '</tbody>' +
              '</table>' +
            '</div>' +
            '<p class="comm-plan-goal"><strong>Целевое действие:</strong> ' + escape(reply.goal || 'Договоренность о следующем шаге') + '</p>' +
          '</article>' +
          '<article class="comm-plan-card">' +
            '<p class="comm-plan-subtitle">Примеры первого сообщения</p>' +
            examplesHtml +
          '</article>' +
        '</section>'
      );
    }

    function renderMarkdown(container, text) {
      const html = DOMPurify.sanitize(marked.parse(text || ''));
      container.innerHTML = html;
    }

    function renderHistory(items) {
      historyEl.innerHTML = '';
      if (!Array.isArray(items) || items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = 'История для этого артефакта пока отсутствует.';
        historyEl.appendChild(empty);
        return;
      }

      items.forEach((item) => {
        const box = document.createElement('div');
        box.className = 'history-item';

        const head = document.createElement('div');
        head.className = 'history-head';
        const left = document.createElement('span');
        left.textContent = '#' + String(item.artifact_id || '').slice(0, 8);
        const right = document.createElement('span');
        right.textContent = item.created_at ? new Date(item.created_at).toLocaleString() : '';
        head.appendChild(left);
        head.appendChild(right);

        const body = document.createElement('div');
        body.className = 'history-body';

        if (item.request_message) {
          const input = document.createElement('div');
          input.className = 'input';
          input.textContent = item.request_message;
          body.appendChild(input);
        }

        const reply = document.createElement('div');
        reply.className = 'reply';
        renderMarkdown(reply, replyToMarkdown(item.reply));
        body.appendChild(reply);

        box.appendChild(head);
        box.appendChild(body);
        historyEl.appendChild(box);
      });
    }

    async function loadArtifact() {
      try {
        const res = await fetch('/api/artifacts/' + encodeURIComponent(ARTIFACT_ID));
        if (res.status === 401) {
          location.href = '/login';
          return;
        }
        if (!res.ok) {
          statusEl.textContent = 'Артефакт не найден или недоступен.';
          return;
        }

        const data = await res.json();
        const artifact = data.artifact || {};
        statusEl.textContent = 'Артефакт загружен';

        addMeta('artifact_id', artifact.artifact_id);
        addMeta('created_at', artifact.created_at ? new Date(artifact.created_at).toISOString() : null);
        addMeta('session_id', artifact.session_id);
        addMeta('vacancy_id', artifact.vacancy_id);
        addMeta('source', artifact.source);
        addMeta('recruiter_id', artifact.recruiter_id);

        renderHistory(data.history || []);
      } catch {
        statusEl.textContent = 'Ошибка загрузки артефакта.';
      }
    }

    marked.use({ breaks: true, gfm: true });
    loadArtifact();
  </script>
</body>
</html>`;


function replyToMarkdown(reply) {
  if (!reply || typeof reply !== "object") {
    return { markdown: String(reply ?? "…"), actions: [] };
  }

  if (reply.kind === "render_funnel") {
    const rows = (reply.rows ?? []).map(r =>
      `| ${r.step_name} | ${r.total} | ${r.completed} | ${r.in_progress} | ${r.stuck} | ${r.rejected} |`
    ).join("\n");

    const branches = (reply.branches ?? []).map(b => `- **${b.title}:** ${b.count}`).join("\n");

    const md = [
      `## ${reply.title ?? "Воронка кандидатов"}`,
      "",
      `> Всего: **${reply.summary?.total ?? "—"}** | Квалифицированы: **${reply.summary?.qualified ?? "—"}** | Ждут движения: **${reply.summary?.waiting ?? "—"}**`,
      "",
      branches ? `${branches}\n` : "",
      "| Этап | Всего | Завершили | В работе | Зависли | Отсечены |",
      "|------|-------|-----------|----------|---------|----------|",
      rows,
    ].filter(Boolean).join("\n");

    return {
      markdown: md,
      actions: [
        { label: "Обновить", message: "обнови воронку" },
      ],
    };
  }

  if (reply.kind === "playbook_locked") {
    return {
      markdown: `> ⚠️ **${reply.title ?? "Плейбук недоступен"}**\n\n${reply.message ?? ""}`,
      actions: [],
    };
  }

  if (reply.kind === "fallback_text") {
    return {
      markdown: reply.text ?? "…",
      actions: [],
    };
  }

  if (reply.kind === "llm_output") {
    return {
      markdown: reply.content ?? "…",
      actions: [],
    };
  }

  if (reply.kind === "communication_plan") {
    return {
      markdown: formatCommunicationPlanMarkdown(reply),
      actions: Array.isArray(reply.actions) ? reply.actions : []
    };
  }

  // Unknown — dump as code block
  return {
    markdown: "```json\n" + JSON.stringify(reply, null, 2) + "\n```",
    actions: [],
  };
}

function formatCommunicationPlanMarkdown(reply) {
  const steps = Array.isArray(reply.steps) ? reply.steps : [];
  const examples = Array.isArray(reply.examples) ? reply.examples : [];

  const tableRows = steps.length > 0
    ? steps.map((row) => {
      const step = escapeHtml(row.step ?? "—");
      const remindersRaw = Number(row.reminders_count);
      const reminders = Number.isFinite(remindersRaw) ? remindersRaw : 0;
      const comment = escapeHtml(row.comment ?? "—");
      return (
        "<tr>" +
          `<td>${step}</td>` +
          `<td><span class="comm-plan-reminders">${reminders}</span></td>` +
          `<td>${comment}</td>` +
        "</tr>"
      );
    }).join("")
    : "<tr><td>—</td><td><span class=\"comm-plan-reminders\">0</span></td><td>—</td></tr>";

  const noteHtml = reply.note
    ? `<p class="comm-plan-note">${escapeHtml(reply.note)}</p>`
    : "";

  const examplesHtml = examples.length > 0
    ? (
      "<div class=\"comm-plan-examples\">" +
      examples.map((item, index) => (
        "<article class=\"comm-plan-example\">" +
          `<h4 class="comm-plan-example-title">${escapeHtml(item.title ?? `Вариант ${index + 1}`)}</h4>` +
          `<p class="comm-plan-example-text">${escapeHtml(item.message ?? "")}</p>` +
        "</article>"
      )).join("") +
      "</div>"
    )
    : "<p class=\"comm-plan-hint\">Чтобы увидеть примеры первого сообщения, нажмите кнопку «Сгенерировать примеры общения по этому сценарию коммуникаций».</p>";

  return (
    "<section class=\"comm-plan\">" +
      "<article class=\"comm-plan-card\">" +
        "<h3 class=\"comm-plan-title\">План коммуникации</h3>" +
        noteHtml +
        `<p><strong>Сценарий:</strong> ${escapeHtml(reply.scenario_title ?? "Рабочий сценарий")}</p>` +
        "<div class=\"comm-plan-table-wrap\">" +
          "<table class=\"comm-plan-table\">" +
            "<thead><tr><th>Шаг</th><th>Кол-во напоминалок</th><th>Комментарий</th></tr></thead>" +
            `<tbody>${tableRows}</tbody>` +
          "</table>" +
        "</div>" +
        `<p class="comm-plan-goal"><strong>Целевое действие:</strong> ${escapeHtml(reply.goal ?? "Договоренность о следующем шаге")}</p>` +
      "</article>" +
      "<article class=\"comm-plan-card\">" +
        "<p class=\"comm-plan-subtitle\">Примеры первого сообщения</p>" +
        examplesHtml +
      "</article>" +
    "</section>"
  );
}

async function handleChatWs(ws, msg, wsContext, app, artifactStore) {
  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  const { text, vacancyId } = msg;
  console.log("[ws] message:", JSON.stringify({ text, vacancyId, tenantId: wsContext.tenantId }));

  try {
    send({ type: "progress", tool: "route_playbook", label: "Определяю плейбук" });

    const result = await app.postChatMessage({
      message: text,
      tenantSql: wsContext.tenantSql,
      tenantId: wsContext.tenantId,
      recruiterId: wsContext.recruiterId,
      job_id: vacancyId,
      vacancy_id: vacancyId,
    });

    const reply = result.body?.reply ?? result.body;
    console.log("[ws] reply kind:", reply?.kind ?? "unknown", "status:", result.status);

    const artifact = await artifactStore.create({
      source: "ws",
      tenantId: wsContext.tenantId,
      recruiterId: wsContext.recruiterId,
      sessionId: result.body?.session_id ?? null,
      vacancyId: result.body?.vacancy_id ?? vacancyId ?? null,
      requestMessage: text,
      reply
    });

    send({ type: "progress", tool: "render", label: "Генерирую ответ" });
    const { markdown, actions } = replyToMarkdown(reply);
    send({ type: "chunk", text: markdown });
    send({ type: "done", actions, artifact });

  } catch (err) {
    console.error("[ws] error:", err?.message);
    send({ type: "error", message: err?.message ?? "Ошибка сервера" });
  }
}

export function createHiringAgentServer(app, options = {}) {
  const managementSql = options.managementSql ?? options.sql ?? null;
  const managementStore = options.managementStore ?? null;
  const poolRegistry = options.poolRegistry ?? null;
  const appEnv = options.appEnv ?? "local";
  const artifactStore = createChatArtifactStore({ managementSql });

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const result = await app.getHealth();
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
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

        if (!email || !password) {
          writeJson(response, 400, { error: "email and password required" });
          return;
        }

        const recruiter = await getRecruiterByEmail(managementSql, email);
        const validPassword = managementSql
          ? recruiter?.password_hash
            ? await bcrypt.compare(password, recruiter.password_hash)
            : false
          : Boolean(recruiter);

        const activeRecruiter = !managementSql || recruiter?.status === "active";
        if (!recruiter || !validPassword || !activeRecruiter) {
          writeJson(response, 401, { error: "Invalid credentials" });
          return;
        }

        const sessionToken = await createSession(managementSql, recruiter.recruiter_id);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `session=${sessionToken}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Strict${secure}`
        });
        response.end(JSON.stringify({ redirect: "/" }));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/logout") {
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        response.writeHead(302, {
          location: "/login",
          "set-cookie": `session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${secure}`
        });
        response.end();
        return;
      }

      if (request.method === "GET" && (requestUrl.pathname === "/" || isChatShellPath(requestUrl.pathname))) {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv,
          unauthorizedStatus: 302
        });
        if (!accessContext) return;

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          CHAT_HTML
            .replace("__RECRUITER_EMAIL__", escapeHtml(accessContext.recruiterEmail))
        );
        return;
      }

      if (request.method === "GET" && requestUrl.pathname.startsWith("/artifact/")) {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv,
          unauthorizedStatus: 302
        });
        if (!accessContext) return;

        const artifactId = requestUrl.pathname.slice("/artifact/".length);
        if (!artifactId) {
          writeJson(response, 404, { error: "artifact_not_found" });
          return;
        }

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(ARTIFACT_HTML.replace("__ARTIFACT_ID__", escapeHtml(artifactId)));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/jobs") {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv
        });
        if (!accessContext) return;

        const result = await app.getJobs({
          tenantSql: accessContext.tenantSql,
          tenantId: accessContext.tenantId
        });
        writeJson(response, result.status, result.body);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname.startsWith("/api/artifacts/")) {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv
        });
        if (!accessContext) return;

        const artifactId = requestUrl.pathname.slice("/api/artifacts/".length);
        if (!artifactId) {
          writeJson(response, 404, { error: "artifact_not_found" });
          return;
        }

        const payload = await artifactStore.getById({
          artifactId,
          tenantId: accessContext.tenantId,
          recruiterId: accessContext.recruiterId
        });

        if (!payload) {
          writeJson(response, 404, { error: "artifact_not_found" });
          return;
        }

        writeJson(response, 200, payload);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv
        });
        if (!accessContext) return;

        const body = await readJsonBody(request);
        const result = await app.postChatMessage({
          message: body.message,
          action: body.action,
          playbook_key: body.playbook_key,
          tenantSql: accessContext.tenantSql,
          tenantId: accessContext.tenantId,
          recruiterId: accessContext.recruiterId,
          managementSql,
          job_id: body.job_id,
          vacancy_id: body.vacancy_id
        });

        if (result.body?.reply) {
          const artifact = await artifactStore.create({
            source: "api",
            tenantId: accessContext.tenantId,
            recruiterId: accessContext.recruiterId,
            sessionId: result.body?.session_id ?? null,
            vacancyId: result.body?.vacancy_id ?? body.vacancy_id ?? body.job_id ?? null,
            requestMessage: body.message ?? null,
            reply: result.body.reply
          });
          if (artifact) {
            result.body.artifact = artifact;
          }
        }

        writeJson(response, result.status, result.body);
        return;
      }

      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof InvalidJsonError) {
        writeJson(response, 400, { error: "invalid_json" });
        return;
      }

      if (error instanceof TenantDbTimeoutError) {
        writeJson(response, error.httpStatus, {
          error: error.code,
          message: error.message,
          operation: error.operation
        });
        return;
      }

      writeJson(response, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // ── WebSocket server ─────────────────────────────────────────────────────────
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (ws, req) => {
    console.log("[ws] new connection");
    const cookies = parseCookies(req.headers.cookie ?? "");

    // Resolve access context at connection time — mirrors requireAccessContext.
    // This ensures tenantSql is properly tenant-scoped in management mode.
    let wsContext;
    if (managementStore && poolRegistry) {
      try {
        const ctx = await resolveAccessContext({
          managementStore,
          poolRegistry,
          appEnv,
          sessionToken: cookies.session,
        });
        wsContext = {
          recruiterId: ctx.recruiterId,
          tenantId: ctx.tenantId,
          recruiterEmail: ctx.recruiterEmail,
          tenantSql: ctx.tenantSql,
        };
      } catch (err) {
        console.log("[ws] auth failed (management):", err?.message);
        ws.close(4001, "Unauthorized");
        return;
      }
    } else {
      const recruiter = await resolveSession(managementSql, cookies.session).catch(() => null);
      if (!recruiter) {
        console.log("[ws] auth failed (session)");
        ws.close(4001, "Unauthorized");
        return;
      }
      wsContext = {
        recruiterId: recruiter.recruiter_id,
        tenantId: recruiter.tenant_id,
        recruiterEmail: recruiter.email,
        tenantSql: null,
      };
    }

    let alive = true;
    ws.on("pong", () => { alive = true; });

    const heartbeat = setInterval(() => {
      if (!alive) { clearInterval(heartbeat); ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, 30_000);

    ws.on("close", () => clearInterval(heartbeat));
    ws.on("error", () => clearInterval(heartbeat));

      ws.on("message", async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === "message") {
          await handleChatWs(ws, msg, wsContext, app, artifactStore);
        }
      });
    });
  // ─────────────────────────────────────────────────────────────────────────────

  return server;
}

function createChatArtifactStore({ managementSql }) {
  const memoryArtifacts = new Map();
  const memoryByTenant = new Map();

  return {
    async create({
      source = "api",
      tenantId,
      recruiterId = null,
      sessionId = null,
      vacancyId = null,
      requestMessage = null,
      reply = null
    }) {
      if (!tenantId || !reply) return null;

      const safeReply = toJsonSafe(reply);
      const safeMessage = requestMessage == null ? null : String(requestMessage);

      if (managementSql) {
        try {
          const rows = await managementSql`
            INSERT INTO management.chat_artifacts (
              tenant_id,
              recruiter_id,
              session_id,
              vacancy_id,
              source,
              request_message,
              reply
            )
            VALUES (
              ${tenantId},
              ${recruiterId},
              ${sessionId},
              ${vacancyId},
              ${source},
              ${safeMessage},
              ${JSON.stringify(safeReply)}::jsonb
            )
            RETURNING artifact_id::text AS artifact_id, created_at, session_id::text AS session_id, vacancy_id
          `;

          return toArtifactLink(rows[0]);
        } catch (error) {
          console.error("[artifact] db insert failed:", error?.message);
        }
      }

      const artifactId = randomUUID();
      const createdAt = new Date().toISOString();
      const row = {
        artifact_id: artifactId,
        tenant_id: tenantId,
        recruiter_id: recruiterId,
        session_id: sessionId,
        vacancy_id: vacancyId,
        source,
        request_message: safeMessage,
        reply: safeReply,
        created_at: createdAt
      };
      memoryArtifacts.set(artifactId, row);

      const ids = memoryByTenant.get(tenantId) ?? [];
      ids.push(artifactId);
      memoryByTenant.set(tenantId, ids);

      return toArtifactLink(row);
    },

    async getById({ artifactId, tenantId }) {
      if (!artifactId || !tenantId) return null;

      if (managementSql) {
        try {
          const rows = await managementSql`
            SELECT
              artifact_id::text AS artifact_id,
              tenant_id,
              recruiter_id,
              session_id::text AS session_id,
              vacancy_id,
              source,
              request_message,
              reply,
              created_at
            FROM management.chat_artifacts
            WHERE artifact_id::text = ${artifactId}
              AND tenant_id = ${tenantId}
            LIMIT 1
          `;
          const artifact = rows[0] ?? null;
          if (!artifact) return null;

          const historyRows = await fetchArtifactHistory({
            managementSql,
            tenantId,
            artifact
          });

          return {
            artifact,
            history: historyRows
          };
        } catch (error) {
          console.error("[artifact] db read failed:", error?.message);
        }
      }

      const artifact = memoryArtifacts.get(artifactId);
      if (!artifact || artifact.tenant_id !== tenantId) return null;
      const history = fetchMemoryHistory({
        tenantId,
        artifact,
        memoryArtifacts,
        memoryByTenant
      });
      return { artifact, history };
    }
  };
}

async function fetchArtifactHistory({ managementSql, tenantId, artifact }) {
  if (artifact.session_id) {
    const rows = await managementSql`
      SELECT
        artifact_id::text AS artifact_id,
        tenant_id,
        recruiter_id,
        session_id::text AS session_id,
        vacancy_id,
        source,
        request_message,
        reply,
        created_at
      FROM management.chat_artifacts
      WHERE tenant_id = ${tenantId}
        AND session_id = ${artifact.session_id}
      ORDER BY created_at ASC
      LIMIT 120
    `;
    return rows;
  }

  if (artifact.vacancy_id) {
    const rows = await managementSql`
      SELECT
        artifact_id::text AS artifact_id,
        tenant_id,
        recruiter_id,
        session_id::text AS session_id,
        vacancy_id,
        source,
        request_message,
        reply,
        created_at
      FROM management.chat_artifacts
      WHERE tenant_id = ${tenantId}
        AND vacancy_id = ${artifact.vacancy_id}
      ORDER BY created_at ASC
      LIMIT 120
    `;
    return rows;
  }

  const rows = await managementSql`
    SELECT
      artifact_id::text AS artifact_id,
      tenant_id,
      recruiter_id,
      session_id::text AS session_id,
      vacancy_id,
      source,
      request_message,
      reply,
      created_at
    FROM management.chat_artifacts
    WHERE tenant_id = ${tenantId}
      AND recruiter_id IS NOT DISTINCT FROM ${artifact.recruiter_id}
    ORDER BY created_at ASC
    LIMIT 120
  `;
  return rows;
}

function fetchMemoryHistory({ tenantId, artifact, memoryArtifacts, memoryByTenant }) {
  const ids = memoryByTenant.get(tenantId) ?? [];
  const rows = ids
    .map((id) => memoryArtifacts.get(id))
    .filter(Boolean);

  if (artifact.session_id) {
    return rows.filter((row) => row.session_id === artifact.session_id).slice(-120);
  }

  if (artifact.vacancy_id) {
    return rows.filter((row) => row.vacancy_id === artifact.vacancy_id).slice(-120);
  }

  return rows
    .filter((row) => row.recruiter_id === artifact.recruiter_id)
    .slice(-120);
}

function toArtifactLink(row) {
  if (!row?.artifact_id) return null;
  return {
    id: row.artifact_id,
    url: `/artifact/${row.artifact_id}`,
    api_url: `/api/artifacts/${row.artifact_id}`,
    created_at: row.created_at ?? null,
    session_id: row.session_id ?? null,
    vacancy_id: row.vacancy_id ?? null
  };
}

function toJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { kind: "fallback_text", text: String(value ?? "") };
  }
}

async function requireAccessContext(request, response, options = {}) {
  const unauthorizedStatus = options.unauthorizedStatus ?? 401;
  const cookies = parseCookies(request.headers.cookie);
  if (!options.managementStore || !options.poolRegistry) {
    const recruiter = await resolveSession(null, cookies.session);
    if (recruiter) {
      return {
        recruiterId: recruiter.recruiter_id,
        recruiterEmail: recruiter.email,
        tenantId: recruiter.tenant_id,
        tenantSql: null
      };
    }

    if (unauthorizedStatus === 302) {
      response.writeHead(302, { location: "/login" });
      response.end();
      return null;
    }

    writeJson(response, unauthorizedStatus, { error: "unauthorized" });
    return null;
  }

  try {
    return await resolveAccessContext({
      managementStore: options.managementStore,
      poolRegistry: options.poolRegistry,
      appEnv: options.appEnv ?? "local",
      sessionToken: cookies.session
    });
  } catch (error) {
    if (error instanceof AccessContextError && error.code === "ERROR_UNAUTHENTICATED" && unauthorizedStatus === 302) {
      response.writeHead(302, { location: "/login" });
      response.end();
      return null;
    }

    if (error instanceof AccessContextError) {
      writeJson(response, error.httpStatus, {
        error: error.code,
        message: error.message
      });
      return null;
    }

    if (unauthorizedStatus === 302) {
      response.writeHead(302, { location: "/login" });
      response.end();
      return null;
    }

    writeJson(response, unauthorizedStatus, { error: "unauthorized" });
    return null;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) return {};

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new InvalidJsonError();
  }
}

function writeJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isChatShellPath(pathname) {
  if (pathname === "/chat") return true;
  return /^\/chat\/[^/]+$/.test(pathname);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

class InvalidJsonError extends Error {
  constructor() {
    super("Request body is not valid JSON");
    this.name = "InvalidJsonError";
  }
}
