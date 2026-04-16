import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { WebSocketServer } from "ws";
import { createSession, getRecruiterByEmail, parseCookies, resolveSession } from "./auth.js";
import { normalizeJsonResponseText } from "./json-response.js";
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
    const APP_BASE_PATH = '__APP_BASE_PATH__';
    const withBasePath = (path) => (APP_BASE_PATH ? APP_BASE_PATH + path : path);
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
        const response = await fetch(withBasePath("/auth/login"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: document.getElementById("emailInput").value.trim(),
            password: document.getElementById("passwordInput").value
          })
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          window.location = data.redirect || withBasePath("/");
          return;
        }

        showError(data.message || data.error || "Не удалось войти.");
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
  <style>
    :root {
      --font: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --bg: #09111f;
      --bg2: #0d1627;
      --bg3: #101b31;
      --surface: rgba(13, 22, 39, 0.82);
      --surface-strong: rgba(16, 27, 49, 0.94);
      --surface-soft: rgba(255, 255, 255, 0.04);
      --edge: rgba(157, 181, 224, 0.14);
      --edge-strong: rgba(157, 181, 224, 0.24);
      --t1: #edf3ff;
      --t2: #9ca9c6;
      --t3: #61708d;
      --acc: #69a2ff;
      --acc-strong: #8fb8ff;
      --acc-d: rgba(105, 162, 255, 0.14);
      --green: #3ddc97;
      --red: #ff6b6b;
      --shadow-lg: 0 28px 90px rgba(2, 8, 23, 0.45);
      --shadow-md: 0 16px 50px rgba(2, 8, 23, 0.24);
      --shell-width: 1440px;
      --chat-width: 920px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background:
        radial-gradient(circle at top left, rgba(105, 162, 255, 0.2), transparent 30%),
        radial-gradient(circle at top right, rgba(61, 220, 151, 0.12), transparent 24%),
        linear-gradient(180deg, #08101d 0%, #09111f 35%, #0c1525 100%);
      color: var(--t1);
      min-height: 100dvh;
      overflow: hidden;
    }
    a { color: inherit; }
    button,
    textarea,
    select {
      font: inherit;
    }

    .app-shell {
      width: min(calc(100% - 32px), var(--shell-width));
      margin: 0 auto;
      padding: 28px 0 32px;
      min-height: 100dvh;
      max-height: 100dvh;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .brand-stack {
      display: grid;
      gap: 6px;
    }
    .eyebrow {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--acc-strong);
    }
    .topbar h1 {
      font-size: clamp(28px, 3vw, 40px);
      line-height: 1.02;
      letter-spacing: -0.04em;
    }
    .topbar p {
      max-width: 640px;
      font-size: 14px;
      line-height: 1.65;
      color: var(--t2);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 999px;
      border: 1px solid var(--edge);
      background: rgba(8, 14, 26, 0.54);
      color: var(--t2);
      white-space: nowrap;
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow-md);
    }
    .status-pill strong {
      color: var(--t1);
      font-size: 13px;
      font-weight: 600;
    }
    #status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--red);
      box-shadow: 0 0 0 6px rgba(255, 107, 107, 0.12);
      transition: background 0.3s, box-shadow 0.3s;
    }
    #status-dot.connected {
      background: var(--green);
      box-shadow: 0 0 0 6px rgba(61, 220, 151, 0.12);
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(280px, 320px) minmax(0, 1fr) minmax(280px, 320px);
      grid-template-areas: "history chat sidebar";
      gap: 20px;
      align-items: stretch;
      flex: 1;
      min-height: 0;
      transition: grid-template-columns 0.22s ease;
      position: relative;
    }
    .workspace.history-collapsed {
      grid-template-columns: 0 minmax(0, 1fr) minmax(280px, 320px);
    }
    .panel {
      border: 1px solid var(--edge);
      background: var(--surface);
      border-radius: 28px;
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow-lg);
    }
    .history-panel {
      grid-area: history;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .workspace.history-collapsed .history-panel {
      opacity: 0;
      transform: translateX(-18px);
      pointer-events: none;
    }
    .history-panel-inner {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
    }
    .history-panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--edge);
    }
    .history-panel-header h2 {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .history-panel-header p {
      margin-top: 6px;
      font-size: 12px;
      line-height: 1.55;
      color: var(--t2);
    }
    .history-panel-toolbar {
      display: grid;
      gap: 10px;
      padding: 14px 20px 16px;
      border-bottom: 1px solid var(--edge);
    }
    .panel-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid var(--edge);
      background: rgba(255, 255, 255, 0.03);
      color: var(--t2);
      cursor: pointer;
      white-space: nowrap;
    }
    .panel-toggle:hover {
      border-color: var(--edge-strong);
      color: var(--t1);
    }
    .history-launcher {
      position: absolute;
      left: 0;
      top: 12px;
      z-index: 3;
    }
    .history-launcher[hidden] {
      display: none;
    }
    .history-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .history-list::-webkit-scrollbar { width: 4px; }
    .history-list::-webkit-scrollbar-track { background: transparent; }
    .history-list::-webkit-scrollbar-thumb { background: var(--edge); border-radius: 2px; }
    .history-empty {
      margin: 10px 12px 14px;
      padding: 14px;
      border-radius: 16px;
      border: 1px dashed var(--edge);
      background: rgba(255, 255, 255, 0.02);
      color: var(--t2);
      font-size: 13px;
      line-height: 1.6;
    }
    .history-empty[hidden] {
      display: none;
    }
    .history-item {
      width: 100%;
      display: grid;
      gap: 10px;
      padding: 14px;
      text-align: left;
      border-radius: 18px;
      border: 1px solid var(--edge);
      background: rgba(255, 255, 255, 0.03);
      color: var(--t1);
      cursor: pointer;
    }
    .history-item.active {
      border-color: rgba(105, 162, 255, 0.45);
      background: linear-gradient(180deg, rgba(105, 162, 255, 0.14), rgba(255, 255, 255, 0.03));
      box-shadow: inset 0 0 0 1px rgba(105, 162, 255, 0.08);
    }
    .history-item:hover {
      border-color: var(--edge-strong);
      transform: translateY(-1px);
    }
    .history-item-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .history-item-title {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.45;
      color: var(--t1);
    }
    .history-item-time {
      flex-shrink: 0;
      font-size: 11px;
      color: var(--t3);
      white-space: nowrap;
    }
    .history-item-preview {
      font-size: 12px;
      line-height: 1.6;
      color: var(--t2);
    }
    .history-item-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .history-badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 9px;
      border-radius: 999px;
      border: 1px solid var(--edge);
      background: rgba(255, 255, 255, 0.03);
      color: var(--t2);
      font-size: 11px;
      white-space: nowrap;
    }
    .history-badge.current {
      border-color: rgba(105, 162, 255, 0.45);
      color: var(--acc-strong);
      background: rgba(105, 162, 255, 0.1);
    }
    .sidebar {
      grid-area: sidebar;
      display: grid;
      gap: 16px;
      align-content: start;
      min-height: 0;
      overflow-y: auto;
      padding-right: 4px;
    }
    .sidebar-card {
      padding: 20px;
    }
    .sidebar-card h2,
    .sidebar-card h3 {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .sidebar-card p {
      margin-top: 8px;
      color: var(--t2);
      font-size: 13px;
      line-height: 1.6;
    }
    .meta-grid {
      display: grid;
      gap: 14px;
      margin-top: 18px;
    }
    .meta-row {
      display: grid;
      gap: 6px;
    }
    .meta-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--t3);
    }
    .meta-value {
      color: var(--t1);
      font-size: 14px;
      line-height: 1.45;
      word-break: break-word;
    }
    #vacancy-select {
      width: 100%;
      padding: 12px 14px;
      background: var(--surface-strong);
      border: 1px solid var(--edge);
      border-radius: 14px;
      color: var(--t1);
      font-size: 14px;
      cursor: pointer;
      outline: none;
      appearance: none;
    }
    #vacancy-select:focus { border-color: var(--acc); }
    #vacancy-select option { background: var(--bg2); }
    .primary-btn,
    .ghost-btn,
    .shortcut-btn,
    .action-btn,
    .playbook-chip,
    #send-btn {
      transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, opacity 0.16s ease, color 0.16s ease;
    }
    .primary-btn,
    .ghost-btn,
    .shortcut-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 42px;
      border-radius: 14px;
      border: 1px solid transparent;
      padding: 0 14px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .primary-btn {
      color: #07101d;
      background: linear-gradient(135deg, #8bb7ff 0%, #6ea7ff 100%);
      box-shadow: 0 12px 32px rgba(105, 162, 255, 0.22);
    }
    .ghost-btn {
      color: var(--t2);
      border-color: var(--edge);
      background: rgba(255, 255, 255, 0.02);
    }
    .primary-btn:hover,
    .ghost-btn:hover,
    .shortcut-btn:hover,
    .action-btn:hover,
    .playbook-chip:hover,
    #send-btn:hover:not(:disabled) {
      transform: translateY(-1px);
    }
    .shortcut-list {
      display: grid;
      gap: 10px;
      margin-top: 16px;
    }
    .shortcut-btn {
      justify-content: flex-start;
      min-height: 48px;
      padding: 0 14px;
      border-radius: 16px;
      border: 1px solid var(--edge);
      background: rgba(255, 255, 255, 0.03);
      color: var(--t1);
      text-align: left;
    }
    .shortcut-btn[disabled] {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
    }
    .shortcut-btn span {
      display: block;
    }
    .shortcut-title {
      font-size: 13px;
      font-weight: 600;
    }
    .shortcut-copy {
      margin-top: 2px;
      font-size: 12px;
      color: var(--t2);
    }
    #moderation-link {
      margin-top: 10px;
    }
    #moderation-link[hidden] {
      display: none;
    }
    .moderation-copy {
      margin-top: 8px;
      color: var(--t2);
      font-size: 12px;
      line-height: 1.5;
    }

    .chat-stage {
      grid-area: chat;
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 12%),
        rgba(10, 18, 33, 0.82);
    }
    .chat-stage-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 18px 22px;
      border-bottom: 1px solid var(--edge);
      background: rgba(6, 12, 24, 0.42);
      backdrop-filter: blur(18px);
    }
    .chat-stage-copy {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .chat-stage-copy h2 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.03em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chat-stage-copy p {
      font-size: 13px;
      color: var(--t2);
      line-height: 1.5;
    }
    .chat-stage-actions {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    #logout-btn {
      flex-shrink: 0;
      padding: 11px 14px;
      border: 1px solid var(--edge);
      border-radius: 14px;
      color: var(--t2);
      text-decoration: none;
      background: rgba(255, 255, 255, 0.03);
    }
    #logout-btn:hover {
      border-color: var(--edge-strong);
      color: var(--t1);
    }

    #chat-log {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 26px 22px 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }
    #chat-log::-webkit-scrollbar { width: 4px; }
    #chat-log::-webkit-scrollbar-track { background: transparent; }
    #chat-log::-webkit-scrollbar-thumb { background: var(--edge); border-radius: 2px; }
    .chat-lane {
      width: min(100%, var(--chat-width));
      margin: 0 auto;
    }

    #empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      flex: 1;
      padding: 48px 20px 56px;
      text-align: center;
      color: var(--t2);
    }
    #empty-state .empty-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid var(--edge);
      background: rgba(255, 255, 255, 0.04);
      font-size: 12px;
      color: var(--acc-strong);
    }
    #empty-state h2 {
      font-size: clamp(28px, 3.8vw, 40px);
      font-weight: 600;
      letter-spacing: -0.05em;
      color: var(--t1);
      max-width: 560px;
    }
    #empty-state p {
      font-size: 15px;
      line-height: 1.75;
      max-width: 560px;
    }
    .empty-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
    }
    .msg-row {
      display: flex;
      width: min(100%, var(--chat-width));
      margin: 0 auto;
    }
    .msg-row.user { justify-content: flex-end; }
    .msg-row.assistant { justify-content: flex-start; }
    .bubble {
      max-width: min(82%, 760px);
      padding: 14px 16px;
      font-size: 14px;
      line-height: 1.65;
      border-radius: 20px;
      word-break: break-word;
      box-shadow: var(--shadow-md);
    }
    .user-bubble {
      background: linear-gradient(135deg, #79abff 0%, #5a97ff 100%);
      color: #07101d;
      border-radius: 20px 20px 6px 20px;
    }
    .assistant-bubble {
      background: rgba(9, 17, 31, 0.78);
      border: 1px solid var(--edge);
      color: var(--t1);
      border-radius: 20px 20px 20px 6px;
      position: relative;
    }
    .assistant-bubble.streaming .bubble-content:not(:empty)::after {
      content: '▋';
      display: inline;
      color: var(--acc);
      animation: blink 1s step-end infinite;
      margin-left: 1px;
    }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

    .progress-steps {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 10px;
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
    .bubble-content { overflow-x: auto; }
    .bubble-content p { margin: 0 0 8px; }
    .bubble-content p:last-child { margin-bottom: 0; }
    .bubble-content h1,.bubble-content h2,.bubble-content h3 {
      font-size: 15px; font-weight: 600; margin: 14px 0 6px;
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
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--edge);
    }
    .actions:empty { display: none; }
    .action-btn {
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 999px;
      border: 1px solid var(--edge);
      background: rgba(255, 255, 255, 0.04);
      color: var(--t2);
      cursor: pointer;
      white-space: nowrap;
    }
    .action-btn:hover {
      background: var(--acc-d);
      border-color: var(--acc);
      color: var(--t1);
    }
    .playbook-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .playbook-chip {
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 999px;
      border: 1px solid var(--acc);
      background: var(--acc-d);
      color: var(--acc);
      cursor: pointer;
    }
    .playbook-chip:hover { background: var(--acc); color: white; }
    a.playbook-chip { text-decoration: none; display: inline-block; }
    #input-area {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      padding: 18px 22px 22px;
      border-top: 1px solid var(--edge);
      flex-shrink: 0;
      background: rgba(6, 12, 24, 0.42);
    }
    .composer-shell {
      width: min(100%, var(--chat-width));
      margin: 0 auto;
      display: flex;
      align-items: flex-end;
      gap: 10px;
      padding: 10px;
      border-radius: 20px;
      border: 1px solid var(--edge);
      background: rgba(7, 14, 26, 0.82);
      box-shadow: var(--shadow-md);
    }
    #msg-input {
      flex: 1;
      resize: none;
      background: transparent;
      border: 0;
      border-radius: 14px;
      padding: 10px 12px;
      font-size: 14px;
      color: var(--t1);
      max-height: 160px;
      min-height: 42px;
      overflow-y: hidden;
      outline: none;
      line-height: 1.5;
    }
    #msg-input::placeholder { color: var(--t3); }
    .composer-meta {
      width: min(100%, var(--chat-width));
      margin: 8px auto 0;
      padding: 0 4px;
      font-size: 12px;
      color: var(--t3);
    }
    #send-btn {
      width: 42px;
      height: 42px;
      flex-shrink: 0;
      border-radius: 14px;
      border: none;
      background: linear-gradient(135deg, #8bb7ff 0%, #6ea7ff 100%);
      color: #07101d;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #send-btn:disabled { opacity: 0.35; cursor: default; }
    #send-btn svg { width: 16px; height: 16px; }
    @media (max-width: 980px) {
      .app-shell {
        width: min(calc(100% - 20px), var(--shell-width));
        padding-top: 18px;
      }
      .topbar {
        flex-direction: column;
        align-items: stretch;
      }
      .workspace {
        grid-template-columns: 1fr;
        grid-template-areas:
          "chat"
          "sidebar";
        flex: 1;
        min-height: 0;
      }
      .history-panel {
        position: fixed;
        inset: 0 auto 0 0;
        width: min(88vw, 360px);
        height: 100dvh;
        z-index: 20;
        border-radius: 0 26px 26px 0;
        border-left: 0;
        transform: translateX(-100%);
        opacity: 1;
        pointer-events: auto;
      }
      .workspace.history-open .history-panel {
        transform: translateX(0);
        box-shadow: 0 30px 80px rgba(2, 8, 23, 0.58);
      }
      .workspace.history-collapsed .history-panel {
        opacity: 1;
        transform: translateX(-100%);
      }
      .history-launcher {
        position: fixed;
        left: 16px;
        top: 84px;
      }
      .sidebar {
        order: 2;
        overflow: visible;
        padding-right: 0;
      }
      .chat-stage {
        min-height: 0;
      }
      .chat-stage-header {
        flex-direction: column;
        align-items: flex-start;
      }
      .chat-stage-actions {
        width: 100%;
      }
      .bubble {
        max-width: 100%;
      }
    }
    @media (max-width: 640px) {
      .app-shell {
        width: 100%;
        padding: 0;
      }
      .topbar {
        margin: 0;
        padding: 18px 16px 14px;
      }
      .panel,
      .chat-stage {
        border-radius: 0;
        border-left: 0;
        border-right: 0;
      }
      .workspace {
        gap: 0;
      }
      .history-panel {
        width: min(92vw, 360px);
      }
      .sidebar {
        gap: 0;
      }
      .sidebar-card {
        border-radius: 0;
        border-left: 0;
        border-right: 0;
      }
      #chat-log,
      #input-area,
      .chat-stage-header {
        padding-left: 16px;
        padding-right: 16px;
      }
      .composer-shell {
        padding: 8px;
      }
      #empty-state h2 {
        font-size: 30px;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-stack">
        <div class="eyebrow">Вакансия</div>
        <h1>Работа с вакансией</h1>
        <p>Контекст и чат.</p>
      </div>
      <div class="status-pill">
        <span id="status-dot" title="WebSocket"></span>
        <div>
          <strong id="connection-label">Подключение</strong>
          <div id="connection-copy">Соединяемся с агентом…</div>
        </div>
      </div>
    </header>

    <main class="workspace" id="workspace">
      <aside class="history-panel panel" id="history-panel">
        <div class="history-panel-inner">
          <div class="history-panel-header">
            <div>
              <h2>История сессий</h2>
              <p>Недавние сценарии и быстрый возврат к прошлым чатам.</p>
            </div>
            <button class="panel-toggle" id="history-toggle-btn" type="button">Скрыть</button>
          </div>
          <div class="history-panel-toolbar">
            <button class="primary-btn" id="new-session-btn" type="button">Новая сессия</button>
          </div>
          <div class="history-empty" id="history-empty">Список появится после первой сохранённой сессии.</div>
          <div class="history-list" id="history-list"></div>
        </div>
      </aside>

      <button class="panel-toggle history-launcher" id="history-launcher-btn" type="button" hidden>История</button>

      <aside class="sidebar">
        <section class="sidebar-card panel">
          <h2>Контекст</h2>
          <p id="workspace-copy">Выберите вакансию и действие.</p>

          <div class="meta-grid">
            <div class="meta-row">
              <div class="meta-label">Рекрутер</div>
              <div class="meta-value">__RECRUITER_EMAIL__</div>
            </div>

            <div class="meta-row">
              <div class="meta-label">Вакансия</div>
              <select id="vacancy-select">
                <option value="">Загрузка вакансий…</option>
              </select>
            </div>

            <div class="meta-row">
              <div class="meta-label">Текущий фокус</div>
              <div class="meta-value" id="context-vacancy-title">Вакансия не выбрана</div>
              <div class="meta-value" id="context-vacancy-copy" style="color: var(--t2); font-size: 13px;">Выберите вакансию или создайте новую, чтобы открыть рабочий сценарий.</div>
            </div>
          </div>

          <div style="display:grid; gap:10px; margin-top:18px;">
            <button class="primary-btn" id="create-vacancy-btn">Создать вакансию</button>
            <a href="__LOGOUT_PATH__" class="ghost-btn" id="logout-btn">Выйти</a>
          </div>
        </section>

        <section class="sidebar-card panel">
          <h3>Действия</h3>

          <div class="shortcut-list">
            <button class="shortcut-btn" data-msg="настроить общение с кандидатами" data-requires-vacancy="true">
              <span class="shortcut-title">Настроить общение</span>
            </button>
            <button class="shortcut-btn" data-msg="посмотри вакансию" data-requires-vacancy="true">
              <span class="shortcut-title">Посмотреть вакансию</span>
            </button>
            <button class="shortcut-btn" data-msg="покажи воронку по кандидатам" data-requires-vacancy="true">
              <span class="shortcut-title">Открыть воронку</span>
            </button>
            <button class="shortcut-btn" data-msg="сделай рассылку" data-requires-vacancy="true">
              <span class="shortcut-title">Сделать рассылку</span>
            </button>
          </div>

          <a href="#" class="ghost-btn" id="moderation-link" hidden target="_blank" rel="noopener">Сообщения на модерации</a>
          <div class="moderation-copy" id="moderation-copy">Очередь модерации.</div>
        </section>
      </aside>

      <section class="chat-stage panel">
        <header class="chat-stage-header">
          <div class="chat-stage-copy">
            <h2 id="chat-stage-title">Рабочая зона агента</h2>
            <p id="chat-stage-subtitle">Выберите вакансию.</p>
          </div>
          <div class="chat-stage-actions">
            <button class="panel-toggle" id="chat-history-btn" type="button">История</button>
            <button class="panel-toggle" id="copy-link-btn" type="button" disabled>Скопировать ссылку</button>
          </div>
        </header>

        <div id="chat-log">
          <div id="empty-state" class="chat-lane">
            <h2>Выберите вакансию</h2>
            <p>Чат доступен после выбора вакансии.</p>
            <div class="empty-actions">
              <button class="primary-btn" id="empty-create-vacancy-btn">Создать вакансию</button>
            </div>
          </div>
        </div>

        <div id="input-area">
          <div style="width:100%;">
            <div class="composer-shell">
              <textarea id="msg-input" placeholder="Напишите, что нужно сделать по вакансии…" rows="1"></textarea>
              <button id="send-btn" disabled title="Отправить">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
            <div class="composer-meta" id="composer-meta">Enter: отправить. Shift+Enter: новая строка.</div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <script>
    // ── Config ────────────────────────────────────────────────────────────────
    const APP_BASE_PATH = '__APP_BASE_PATH__';
    const withBasePath = (path) => (APP_BASE_PATH ? APP_BASE_PATH + path : path);
    const WS_URL = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + withBasePath('/ws');
    const LOGIN_PATH = withBasePath('/login');
    const CHATBOT_MODERATION_BASE = '__CHATBOT_MODERATION_BASE__';
    const LAST_VACANCY_KEY = 'hiring-agent:last-vacancy-id:' + (APP_BASE_PATH || 'root');
    const CHAT_STATE_QUERY_PARAM = 'state';
    const CHAT_STATE_HASH_PREFIX = 'state=';
    const CHAT_SESSION_HASH_PREFIX = 's=';
    const CHAT_STATE_STORAGE_KEY = 'hiring-agent:chat-state:' + (APP_BASE_PATH || 'root');
    const CHAT_SESSION_HISTORY_KEY = 'hiring-agent:session-history:' + (APP_BASE_PATH || 'root');
    const CHAT_STATE_VERSION = 1;
    const MAX_SESSION_HISTORY_ITEMS = 24;
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
    let selectedVacancyJobId = null;
    let availableVacancies = [];
    let selectedVacancyTitle = '';
    let activePlaybookKey = null;
    let activePlaybookContext = null;
    let activeSessionId = null;
    let currentAssistant = null; // { stepsEl, contentEl, actionsEl, text }
    let chatHistory = [];
    let pendingInitialChatStatePromise = loadInitialChatState();
    let sessionHistoryIndex = loadSessionHistoryIndex();
    let historyOpen = window.matchMedia('(min-width: 981px)').matches;

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const workspace = document.getElementById('workspace');
    const chatLog        = document.getElementById('chat-log');
    const emptyState     = document.getElementById('empty-state');
    const vacancySelect  = document.getElementById('vacancy-select');
    const msgInput       = document.getElementById('msg-input');
    const sendBtn        = document.getElementById('send-btn');
    const statusDot      = document.getElementById('status-dot');
    const createVacBtn   = document.getElementById('create-vacancy-btn');
    const emptyCreateVacBtn = document.getElementById('empty-create-vacancy-btn');
    const connectionLabel = document.getElementById('connection-label');
    const connectionCopy = document.getElementById('connection-copy');
    const contextVacancyTitle = document.getElementById('context-vacancy-title');
    const contextVacancyCopy = document.getElementById('context-vacancy-copy');
    const chatStageTitle = document.getElementById('chat-stage-title');
    const chatStageSubtitle = document.getElementById('chat-stage-subtitle');
    const composerMeta = document.getElementById('composer-meta');
    const moderationLink = document.getElementById('moderation-link');
    const moderationCopy = document.getElementById('moderation-copy');
    const shortcutButtons = Array.from(document.querySelectorAll('.shortcut-btn'));
    const historyList = document.getElementById('history-list');
    const historyEmpty = document.getElementById('history-empty');
    const historyToggleBtn = document.getElementById('history-toggle-btn');
    const historyLauncherBtn = document.getElementById('history-launcher-btn');
    const chatHistoryBtn = document.getElementById('chat-history-btn');
    const newSessionBtn = document.getElementById('new-session-btn');
    const copyLinkBtn = document.getElementById('copy-link-btn');

    // ── WebSocket ─────────────────────────────────────────────────────────────
    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        statusDot.classList.add('connected');
        connectionLabel.textContent = 'Агент на связи';
        connectionCopy.textContent = 'Соединение установлено.';
        updateSendEnabled();
      };

      ws.onclose = (ev) => {
        streaming = false;
        currentAssistant = null;
        statusDot.classList.remove('connected');
        connectionLabel.textContent = 'Подключение потеряно';
        connectionCopy.textContent = 'Переподключение...';
        updateSendEnabled();
        if (ev.code === 4001) { window.location = LOGIN_PATH; return; }
        setTimeout(connect, 3000); // auto-reconnect
      };

      ws.onerror = () => {
        statusDot.classList.remove('connected');
        connectionLabel.textContent = 'Ошибка соединения';
        connectionCopy.textContent = 'WebSocket недоступен.';
      };

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
          applyServerState(data);
          activePlaybookContext = data.reply || null;

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

          pushChatHistoryEntry({
            kind: 'assistant',
            markdown: currentAssistant.text,
            actions: Array.isArray(data.actions) ? data.actions : []
          });

          currentAssistant = null;
          streaming = false;
          updateSendEnabled();
          scrollBottom();
          void saveServerChatState();
        }

        if (data.type === 'error') {
          if (currentAssistant) {
            currentAssistant.bubbleEl.classList.remove('streaming');
            const errEl = document.createElement('p');
            errEl.style.color = 'var(--red)';
            errEl.style.fontSize = '13px';
            errEl.textContent = '❌ ' + (data.message || 'Ошибка сервера');
            currentAssistant.contentEl.appendChild(errEl);
            pushChatHistoryEntry({
              kind: 'assistant',
              markdown: (currentAssistant.text || '') + '\\n\\n❌ ' + (data.message || 'Ошибка сервера'),
              actions: []
            });
            currentAssistant = null;
          }
          streaming = false;
          updateSendEnabled();
          void saveServerChatState();
        }
      };
    }

    function renderMarkdown(el, text) {
      const source = String(text ?? '');
      if (typeof marked?.parse === 'function') {
        el.innerHTML = DOMPurify.sanitize(marked.parse(source));
        return;
      }

      const escaped = source
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\\n/g, '<br>');
      el.innerHTML = DOMPurify.sanitize(escaped);
    }

    function stripMarkdown(text) {
      const tick = String.fromCharCode(96);
      return String(text ?? '')
        .replace(new RegExp(tick + tick + tick + '[\\s\\S]*?' + tick + tick + tick, 'g'), ' ')
        .replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_>#-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function getHistoryPreview(history) {
      const latest = [...(Array.isArray(history) ? history : [])]
        .reverse()
        .find((entry) => entry?.kind === 'assistant' || entry?.kind === 'user');

      if (!latest) return 'Сохранённый сценарий без сообщений.';

      const source = latest.kind === 'assistant' ? latest.markdown : latest.text;
      const clean = stripMarkdown(source);
      return clean ? clean.slice(0, 140) : 'Сохранённый сценарий.';
    }

    function formatHistoryTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';

      return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    }

    function isDesktopHistoryLayout() {
      return window.matchMedia('(min-width: 981px)').matches;
    }

    function loadSessionHistoryIndex() {
      try {
        const raw = JSON.parse(localStorage.getItem(CHAT_SESSION_HISTORY_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') : [];
      } catch {
        return [];
      }
    }

    function saveSessionHistoryIndex() {
      try {
        localStorage.setItem(CHAT_SESSION_HISTORY_KEY, JSON.stringify(sessionHistoryIndex));
      } catch {}
    }

    function setHistoryOpen(nextOpen) {
      historyOpen = Boolean(nextOpen);
      workspace.classList.toggle('history-open', historyOpen);
      workspace.classList.toggle('history-collapsed', !historyOpen);
      historyLauncherBtn.hidden = historyOpen;
      historyToggleBtn.textContent = historyOpen ? 'Скрыть' : 'Показать';
      chatHistoryBtn.textContent = historyOpen ? 'Скрыть историю' : 'История';
    }

    function updateCopyLinkButton() {
      copyLinkBtn.disabled = !activeSessionId;
    }

    async function copyCurrentSessionLink() {
      if (!activeSessionId) return;
      const url = new URL(window.location.href);
      url.searchParams.delete(CHAT_STATE_QUERY_PARAM);
      url.hash = CHAT_SESSION_HASH_PREFIX + encodeURIComponent(activeSessionId);

      try {
        await navigator.clipboard.writeText(url.toString());
        copyLinkBtn.textContent = 'Ссылка скопирована';
        setTimeout(() => {
          copyLinkBtn.textContent = 'Скопировать ссылку';
        }, 1600);
      } catch {}
    }

    function renderSessionHistory() {
      const items = Array.isArray(sessionHistoryIndex) ? sessionHistoryIndex : [];
      const prioritizedItems = selectedVacancyId
        ? [
            ...items.filter((item) => String(item?.vacancyId ?? '') === String(selectedVacancyId)),
            ...items.filter((item) => String(item?.vacancyId ?? '') !== String(selectedVacancyId))
          ]
        : items;

      historyEmpty.hidden = prioritizedItems.length > 0;
      historyList.innerHTML = '';

      prioritizedItems.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-item' + (item.sessionId === activeSessionId ? ' active' : '');

        const top = document.createElement('div');
        top.className = 'history-item-top';

        const title = document.createElement('div');
        title.className = 'history-item-title';
        title.textContent = item.vacancyTitle || 'Новая сессия';

        const time = document.createElement('div');
        time.className = 'history-item-time';
        time.textContent = formatHistoryTime(item.updatedAt);

        const preview = document.createElement('div');
        preview.className = 'history-item-preview';
        preview.textContent = item.preview || 'Без превью';

        const meta = document.createElement('div');
        meta.className = 'history-item-meta';

        if (item.sessionId === activeSessionId) {
          const currentBadge = document.createElement('span');
          currentBadge.className = 'history-badge current';
          currentBadge.textContent = 'Текущая';
          meta.appendChild(currentBadge);
        }

        if (item.vacancyId) {
          const vacancyBadge = document.createElement('span');
          vacancyBadge.className = 'history-badge';
          vacancyBadge.textContent = String(item.vacancyId) === String(selectedVacancyId) && selectedVacancyId
            ? 'Текущая вакансия'
            : 'Вакансия';
          meta.appendChild(vacancyBadge);
        }

        top.appendChild(title);
        top.appendChild(time);
        button.appendChild(top);
        button.appendChild(preview);
        button.appendChild(meta);

        button.addEventListener('click', async () => {
          const snapshot = await fetchChatStateBySessionId(item.sessionId);
          if (!snapshot) return;
          restoreChatState(snapshot);
          if (!isDesktopHistoryLayout()) {
            setHistoryOpen(false);
          }
        });

        historyList.appendChild(button);
      });
    }

    function upsertSessionHistoryEntry(state) {
      const normalized = normalizeChatState(state);
      if (!normalized?.sessionId) return;

      const entry = {
        sessionId: normalized.sessionId,
        vacancyId: normalized.vacancyId,
        vacancyTitle: normalized.vacancyTitle || 'Новая сессия',
        updatedAt: new Date().toISOString(),
        preview: getHistoryPreview(normalized.history)
      };

      sessionHistoryIndex = [
        entry,
        ...sessionHistoryIndex.filter((item) => item?.sessionId !== entry.sessionId)
      ].slice(0, MAX_SESSION_HISTORY_ITEMS);

      saveSessionHistoryIndex();
      renderSessionHistory();
    }

    // ── Messages ──────────────────────────────────────────────────────────────
    function pushChatHistoryEntry(entry) {
      chatHistory.push(entry);
      persistChatState();
    }

    function clearChatHistory() {
      chatHistory = [];
      persistChatState();
    }

    function addUserBubble(text, options = {}) {
      const row = document.createElement('div');
      row.className = 'msg-row user';
      const bubble = document.createElement('div');
      bubble.className = 'bubble user-bubble';
      bubble.textContent = text;
      row.appendChild(bubble);
      chatLog.appendChild(row);
      scrollBottom();
      if (options.record !== false) {
        pushChatHistoryEntry({ kind: 'user', text: String(text ?? '') });
      }
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

    function addRenderedAssistantMessage(markdown, actions, options = {}) {
      const row = document.createElement('div');
      row.className = 'msg-row assistant';
      const bubble = document.createElement('div');
      bubble.className = 'bubble assistant-bubble';
      const contentEl = document.createElement('div');
      contentEl.className = 'bubble-content';
      const actionsEl = document.createElement('div');
      actionsEl.className = 'actions';
      renderMarkdown(contentEl, markdown);
      bubble.appendChild(contentEl);

      (Array.isArray(actions) ? actions : []).forEach(({ label, message }) => {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = label;
        btn.dataset.msg = message;
        btn.addEventListener('click', () => sendMessage(message));
        actionsEl.appendChild(btn);
      });

      bubble.appendChild(actionsEl);
      row.appendChild(bubble);
      chatLog.appendChild(row);
      scrollBottom();

      if (options.record !== false) {
        pushChatHistoryEntry({
          kind: 'assistant',
          markdown: String(markdown ?? ''),
          actions: Array.isArray(actions) ? actions : []
        });
      }

      return bubble;
    }

    function addSystemMessage(markdown, options = {}) {
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

      if (options.record !== false) {
        pushChatHistoryEntry({
          kind: 'system',
          markdown: String(markdown ?? ''),
          welcome: options.welcome === true
        });
      }

      return bubble;
    }

    function attachWelcomeChips(bubbleEl) {
      const PLAYBOOKS = [
        { label: 'Настройте общение', msg: 'настроить общение с кандидатами' },
        { label: 'Воронка', msg: 'покажи воронку по кандидатам' },
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

    function renderChatHistoryEntry(entry) {
      if (!entry || typeof entry !== 'object') return;

      if (entry.kind === 'user') {
        addUserBubble(entry.text || '', { record: false });
        return;
      }

      if (entry.kind === 'assistant') {
        addRenderedAssistantMessage(entry.markdown || '', entry.actions || [], { record: false });
        return;
      }

      const bubbleEl = addSystemMessage(entry.markdown || '', {
        record: false,
        welcome: entry.welcome === true
      });
      if (entry.welcome) {
        attachWelcomeChips(bubbleEl);
      }
    }

    function clearActivePlaybookState() {
      activePlaybookKey = null;
      activePlaybookContext = null;
    }

    function upsertVacancyOption(vacancyId, title, jobId) {
      if (!vacancyId) return;

      const normalizedVacancyId = String(vacancyId);
      const label = title || 'Новая вакансия';
      let option = Array.from(vacancySelect.options).find((item) => String(item.value) === normalizedVacancyId);

      if (!option) {
        option = document.createElement('option');
        option.value = normalizedVacancyId;
        const createOption = Array.from(vacancySelect.options).find((item) => item.value === '__create__');
        vacancySelect.insertBefore(option, createOption || null);
      }

      option.textContent = label;
      vacancySelect.value = normalizedVacancyId;

      const existing = availableVacancies.find((item) => String(item.vacancy_id) === normalizedVacancyId);
      if (existing) {
        existing.title = label;
        existing.job_id = jobId || existing.job_id || null;
        return;
      }

      availableVacancies.unshift({
        vacancy_id: normalizedVacancyId,
        job_id: jobId || null,
        title: label
      });
    }

    function applyServerState(data) {
      if (data.sessionId) {
        activeSessionId = String(data.sessionId);
        updateCopyLinkButton();
      }

      if (data.playbookActive && data.playbookKey) {
        activePlaybookKey = data.playbookKey;
      } else {
        clearActivePlaybookState();
      }

      if (!data.vacancyId) return;

      selectedVacancyId = data.vacancyId;
      selectedVacancyJobId = data.jobId || selectedVacancyJobId || null;
      selectedVacancyTitle = data.vacancyTitle || selectedVacancyTitle || 'Новая вакансия';
      localStorage.setItem(LAST_VACANCY_KEY, String(selectedVacancyId));
      upsertVacancyOption(selectedVacancyId, selectedVacancyTitle, selectedVacancyJobId);
      syncContext();
      persistChatState();
      renderSessionHistory();
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

      ws.send(JSON.stringify({
        type: 'message',
        text: text.trim(),
        vacancyId: selectedVacancyId,
        jobId: selectedVacancyJobId || null,
        playbookKey: activePlaybookKey || null,
        clientContext: activePlaybookContext || null
      };

      if (!preferHttpFallback && ws && ws.readyState === 1) {
        ws.send(JSON.stringify(payload));
        return;
      }

      void sendMessageHttp(payload);
    }

    async function sendMessageHttp(payload) {
      try {
        const response = await fetch(withBasePath('/api/chat'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            message: payload.text,
            playbook_key: payload.playbookKey || null,
            client_context: payload.clientContext || null,
            vacancy_id: payload.vacancyId || null,
            job_id: payload.jobId || null
          })
        });

        if (response.status === 401) {
          window.location = LOGIN_PATH;
          return;
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (data && (data.markdown || data.text)) {
            const markdown = String(data.markdown || data.text || '');
            currentAssistant.text += markdown;
            renderMarkdown(currentAssistant.contentEl, currentAssistant.text);
            pushChatHistoryEntry({
              kind: 'assistant',
              markdown: currentAssistant.text,
              actions: []
            });
            currentAssistant.bubbleEl.classList.remove('streaming');
            currentAssistant = null;
            streaming = false;
            updateSendEnabled();
            scrollBottom();
            return;
          }

          throw new Error(data.message || data.error || 'Ошибка сервера');
        }

        applyServerState({
          playbookActive: Boolean(data.playbook_active),
          playbookKey: data.playbook_key || null,
          sessionId: data.session_id || null,
          vacancyId: data.vacancy_id || null,
          jobId: data.job_id || null,
          vacancyTitle: data.vacancy_title || null,
          replyKind: data.reply?.kind || null,
          reply: data.reply || null
        });
        activePlaybookContext = data.reply || null;

        const markdown = String(data.markdown || data.text || '');
        currentAssistant.text += markdown;
        renderMarkdown(currentAssistant.contentEl, currentAssistant.text);

        if (Array.isArray(data.actions) && data.actions.length > 0) {
          data.actions.forEach(({ label, message }) => {
            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.textContent = label;
            btn.dataset.msg = message;
            btn.addEventListener('click', () => sendMessage(message));
            currentAssistant.actionsEl.appendChild(btn);
          });
        }

        pushChatHistoryEntry({
          kind: 'assistant',
          markdown: currentAssistant.text,
          actions: Array.isArray(data.actions) ? data.actions : []
        });

        currentAssistant.bubbleEl.classList.remove('streaming');
        currentAssistant = null;
        streaming = false;
        updateSendEnabled();
        scrollBottom();
      } catch (error) {
        if (currentAssistant) {
          currentAssistant.bubbleEl.classList.remove('streaming');
          const errEl = document.createElement('p');
          errEl.style.color = 'var(--red)';
          errEl.style.fontSize = '13px';
          errEl.textContent = '❌ ' + (error?.message || 'Ошибка сервера');
          currentAssistant.contentEl.appendChild(errEl);
          pushChatHistoryEntry({
            kind: 'assistant',
            markdown: (currentAssistant.text || '') + '\\n\\n❌ ' + (error?.message || 'Ошибка сервера'),
            actions: []
          });
          currentAssistant = null;
        }
        streaming = false;
        updateSendEnabled();
      }
    }

    // ── Vacancy selector ──────────────────────────────────────────────────────
    async function loadVacancies() {
      try {
        const res = await fetch(withBasePath('/api/jobs'));
        if (res.status === 401) { window.location = LOGIN_PATH; return; }
        const data = await res.json();
        const jobs = Array.isArray(data.vacancies) ? data.vacancies : (Array.isArray(data.jobs) ? data.jobs : []);
        availableVacancies = jobs;
        const savedVacancyId = localStorage.getItem(LAST_VACANCY_KEY);

        if (jobs.length === 0) {
          vacancySelect.innerHTML = '<option value="">Нет вакансий</option>';
          contextVacancyTitle.textContent = 'Нет активных вакансий';
          contextVacancyCopy.textContent = 'Добавьте вакансию.';
          chatStageTitle.textContent = 'Пока нет вакансий';
          chatStageSubtitle.textContent = 'Добавьте вакансию для начала работы.';
          composerMeta.textContent = 'Создайте вакансию.';
          syncShortcuts();
          return;
        }

        vacancySelect.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Выберите вакансию…';
        vacancySelect.appendChild(placeholder);

        jobs.forEach(job => {
          const opt = document.createElement('option');
          opt.value = job.vacancy_id;
          opt.textContent = job.title;
          vacancySelect.appendChild(opt);
        });

        // «+ Создать вакансию» at the end (only when other vacancies exist)
        const createOpt = document.createElement('option');
        createOpt.value = '__create__';
        createOpt.textContent = '+ Создать вакансию';
        vacancySelect.appendChild(createOpt);

        if (pendingInitialChatStatePromise) {
          const pendingInitialChatState = await pendingInitialChatStatePromise;
          pendingInitialChatStatePromise = null;
          if (pendingInitialChatState) {
            restoreChatState(pendingInitialChatState);
            return;
          }
        }

        const savedMatch = jobs.find((job) => String(job.vacancy_id) === savedVacancyId);
        if (savedMatch) {
          vacancySelect.value = savedMatch.vacancy_id;
          onVacancySelected(savedMatch.vacancy_id, savedMatch.title, savedMatch.job_id);
          return;
        }

        // Auto-select if only one
        if (jobs.length === 1) {
          vacancySelect.value = jobs[0].vacancy_id;
          onVacancySelected(jobs[0].vacancy_id, jobs[0].title, jobs[0].job_id);
        }
      } catch {
        vacancySelect.innerHTML = '<option value="">Ошибка загрузки</option>';
      }
    }

    vacancySelect.addEventListener('change', () => {
      const val = vacancySelect.value;
      if (val === '__create__') {
        triggerCreateVacancy();
        return;
      }
      const title = vacancySelect.options[vacancySelect.selectedIndex]?.text ?? '';
      const selected = availableVacancies.find((job) => String(job.vacancy_id) === String(val));
      onVacancySelected(val || null, title, selected?.job_id ?? null);
    });

    function onVacancySelected(vacancyId, title, jobId) {
      clearActivePlaybookState();
      activeSessionId = null;
      updateCopyLinkButton();
      selectedVacancyId = vacancyId;
      selectedVacancyJobId = jobId || null;
      selectedVacancyTitle = title || '';
      if (vacancyId) localStorage.setItem(LAST_VACANCY_KEY, String(vacancyId));
      else localStorage.removeItem(LAST_VACANCY_KEY);

      syncContext();

      // Clear chat
      chatLog.innerHTML = '';
      clearChatHistory();

      if (!vacancyId) {
        chatLog.appendChild(emptyState);
        updateSendEnabled();
        return;
      }

      showWelcome(vacancyId, title);
      updateSendEnabled();
    }

    function showWelcome(vacancyId, title) {
      const bubbleEl = addSystemMessage('Вакансия: **' + escapeText(title) + '**', { welcome: true });
      attachWelcomeChips(bubbleEl);
    }

    function triggerCreateVacancy() {
      clearActivePlaybookState();
      activeSessionId = null;
      updateCopyLinkButton();
      selectedVacancyId = null;
      selectedVacancyJobId = null;
      selectedVacancyTitle = '';
      vacancySelect.value = '';
      syncContext();
      chatLog.innerHTML = '';
      clearChatHistory();
      updateSendEnabled();
      sendMessage('создать вакансию');
    }

    createVacBtn.addEventListener('click', triggerCreateVacancy);
    emptyCreateVacBtn.addEventListener('click', triggerCreateVacancy);
    shortcutButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!button.disabled) sendMessage(button.dataset.msg || '');
      });
    });

    function syncContext() {
      const hasVacancy = Boolean(selectedVacancyId);

      contextVacancyTitle.textContent = hasVacancy ? selectedVacancyTitle : 'Вакансия не выбрана';
      contextVacancyCopy.textContent = hasVacancy
        ? 'Выберите действие или напишите запрос.'
        : 'Выберите вакансию.';

      chatStageTitle.textContent = hasVacancy
        ? selectedVacancyTitle
        : 'Рабочая зона агента';
      chatStageSubtitle.textContent = hasVacancy
        ? 'Готов к работе.'
        : 'Выберите вакансию.';

      composerMeta.textContent = hasVacancy
        ? 'Enter отправляет сообщение, Shift+Enter переносит строку.'
        : 'Выберите вакансию.';

      if (CHATBOT_MODERATION_BASE) {
        if (hasVacancy && selectedVacancyJobId) {
          const titleParam = encodeURIComponent(selectedVacancyTitle || '');
          moderationLink.href = CHATBOT_MODERATION_BASE + '?job_id=' + encodeURIComponent(selectedVacancyJobId) + (titleParam ? '&title=' + titleParam : '');
          moderationCopy.textContent = 'Модерация по выбранной вакансии.';
        } else {
          moderationLink.href = CHATBOT_MODERATION_BASE;
          moderationCopy.textContent = 'Общая модерация.';
        }
        moderationLink.hidden = false;
      } else {
        moderationLink.hidden = true;
        moderationCopy.textContent = 'Модерация недоступна.';
      }

      syncShortcuts();
      persistChatState();
      renderSessionHistory();
    }

    function syncShortcuts() {
      shortcutButtons.forEach((button) => {
        const requiresVacancy = button.dataset.requiresVacancy === 'true';
        button.disabled = requiresVacancy && !selectedVacancyId;
      });
    }

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
      return String(s ?? '').replace(/[\\*_[\]()]/g, '\\$&');
    }

    function serializeChatState() {
      return {
        version: CHAT_STATE_VERSION,
        sessionId: activeSessionId ? String(activeSessionId) : null,
        vacancyId: selectedVacancyId ? String(selectedVacancyId) : null,
        jobId: selectedVacancyJobId ? String(selectedVacancyJobId) : null,
        vacancyTitle: selectedVacancyTitle || '',
        playbookKey: activePlaybookKey || null,
        playbookContext: activePlaybookContext || null,
        history: chatHistory
      };
    }

    function encodeChatState(state) {
      try {
        const json = JSON.stringify(state);
        const bytes = new TextEncoder().encode(json);
        let binary = '';
        bytes.forEach((byte) => {
          binary += String.fromCharCode(byte);
        });
        return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
      } catch {
        return '';
      }
    }

    function decodeChatState(raw) {
      if (!raw) return null;

      try {
        const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return normalizeChatState(JSON.parse(new TextDecoder().decode(bytes)));
      } catch {
        return null;
      }
    }

    function normalizeChatState(state) {
      if (!state || typeof state !== 'object') return null;

      const normalizedHistory = Array.isArray(state.history)
        ? state.history
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry) => ({
            kind: entry.kind === 'user' ? 'user' : (entry.kind === 'assistant' ? 'assistant' : 'system'),
            text: typeof entry.text === 'string' ? entry.text : '',
            markdown: typeof entry.markdown === 'string' ? entry.markdown : '',
            welcome: entry.welcome === true,
            actions: Array.isArray(entry.actions)
              ? entry.actions
                .filter((action) => action && typeof action === 'object')
                .map((action) => ({
                  label: String(action.label ?? ''),
                  message: String(action.message ?? '')
                }))
              : []
          }))
        : [];

      return {
        version: Number(state.version) || CHAT_STATE_VERSION,
        sessionId: state.sessionId ? String(state.sessionId) : null,
        vacancyId: state.vacancyId ? String(state.vacancyId) : null,
        jobId: state.jobId ? String(state.jobId) : null,
        vacancyTitle: typeof state.vacancyTitle === 'string' ? state.vacancyTitle : '',
        playbookKey: typeof state.playbookKey === 'string' ? state.playbookKey : null,
        playbookContext: state.playbookContext && typeof state.playbookContext === 'object' ? state.playbookContext : null,
        history: normalizedHistory
      };
    }

    function persistChatState() {
      const state = serializeChatState();
      const hasMeaningfulState = Boolean(
        state.vacancyId
        || state.playbookKey
        || state.history.length > 0
      );

      try {
        if (hasMeaningfulState) {
          sessionStorage.setItem(CHAT_STATE_STORAGE_KEY, JSON.stringify(state));
        } else {
          sessionStorage.removeItem(CHAT_STATE_STORAGE_KEY);
        }
      } catch {}

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete(CHAT_STATE_QUERY_PARAM);
      nextUrl.hash = activeSessionId
        ? CHAT_SESSION_HASH_PREFIX + encodeURIComponent(activeSessionId)
        : '';
      history.replaceState(null, '', nextUrl.toString());
      updateCopyLinkButton();
    }

    async function loadInitialChatState() {
      const hashSessionId = window.location.hash.startsWith('#' + CHAT_SESSION_HASH_PREFIX)
        ? decodeURIComponent(window.location.hash.slice(CHAT_SESSION_HASH_PREFIX.length + 1))
        : '';
      if (hashSessionId) {
        activeSessionId = hashSessionId;
        const fromServer = await fetchChatStateBySessionId(hashSessionId);
        if (fromServer) return fromServer;
        activeSessionId = null;
      }

      const hashState = window.location.hash.startsWith('#' + CHAT_STATE_HASH_PREFIX)
        ? window.location.hash.slice(CHAT_STATE_HASH_PREFIX.length + 1)
        : '';
      const fromUrl = decodeChatState(
        hashState || new URLSearchParams(window.location.search).get(CHAT_STATE_QUERY_PARAM)
      );
      if (fromUrl) return fromUrl;

      try {
        return normalizeChatState(JSON.parse(sessionStorage.getItem(CHAT_STATE_STORAGE_KEY) || 'null'));
      } catch {
        return null;
      }
    }

    function restoreChatState(state) {
      const normalized = normalizeChatState(state);
      if (!normalized) return;

      clearActivePlaybookState();
      activeSessionId = normalized.sessionId || activeSessionId;
      updateCopyLinkButton();
      activePlaybookKey = normalized.playbookKey;
      activePlaybookContext = normalized.playbookContext;
      selectedVacancyId = normalized.vacancyId;
      selectedVacancyJobId = normalized.jobId;
      selectedVacancyTitle = normalized.vacancyTitle || '';

      if (selectedVacancyId) {
        localStorage.setItem(LAST_VACANCY_KEY, String(selectedVacancyId));
        if (selectedVacancyTitle) {
          upsertVacancyOption(selectedVacancyId, selectedVacancyTitle, selectedVacancyJobId);
        } else {
          vacancySelect.value = String(selectedVacancyId);
        }
      } else {
        localStorage.removeItem(LAST_VACANCY_KEY);
        vacancySelect.value = '';
      }

      syncContext();
      chatLog.innerHTML = '';
      chatHistory = normalized.history;

      if (!selectedVacancyId) {
        chatLog.appendChild(emptyState);
      } else if (chatHistory.length > 0) {
        chatHistory.forEach((entry) => renderChatHistoryEntry(entry));
      } else {
        showWelcome(selectedVacancyId, selectedVacancyTitle || 'Новая вакансия');
      }

      updateSendEnabled();
      persistChatState();
      upsertSessionHistoryEntry(normalized);
    }

    async function fetchChatStateBySessionId(sessionId) {
      if (!sessionId) return null;

      try {
        const res = await fetch(withBasePath('/api/chat-state?session_id=' + encodeURIComponent(sessionId)));
        if (res.status === 401) {
          window.location = LOGIN_PATH;
          return null;
        }
        if (!res.ok) {
          return null;
        }
        const data = await res.json();
        return normalizeChatState(data.snapshot);
      } catch {
        return null;
      }
    }

    async function saveServerChatState() {
      if (!activeSessionId) return;

      try {
        const res = await fetch(withBasePath('/api/chat-state'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            session_id: activeSessionId,
            snapshot: serializeChatState()
          })
        });
        if (res.ok) {
          upsertSessionHistoryEntry(serializeChatState());
        }
      } catch {}
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    // Configure marked only when CDN asset is available.
    if (typeof marked?.use === 'function') {
      marked.use({ breaks: true, gfm: true });
    }

    // Start WS
    connect();

    historyToggleBtn.addEventListener('click', () => setHistoryOpen(!historyOpen));
    historyLauncherBtn.addEventListener('click', () => setHistoryOpen(true));
    chatHistoryBtn.addEventListener('click', () => setHistoryOpen(!historyOpen));
    newSessionBtn.addEventListener('click', () => {
      if (selectedVacancyId) {
        onVacancySelected(selectedVacancyId, selectedVacancyTitle, selectedVacancyJobId);
      } else {
        chatLog.innerHTML = '';
        clearChatHistory();
        clearActivePlaybookState();
        activeSessionId = null;
        updateCopyLinkButton();
        chatLog.appendChild(emptyState);
        syncContext();
      }
      if (!isDesktopHistoryLayout()) {
        setHistoryOpen(false);
      }
    });
    copyLinkBtn.addEventListener('click', () => {
      void copyCurrentSessionLink();
    });
    window.addEventListener('resize', () => {
      if (isDesktopHistoryLayout() && !historyOpen) {
        historyLauncherBtn.hidden = false;
      }
    });

    // Load vacancies
    loadVacancies();

    // Show empty state initially
    chatLog.innerHTML = '';
    chatLog.appendChild(emptyState);
    syncContext();
    renderSessionHistory();
    setHistoryOpen(isDesktopHistoryLayout());
  </script>
</body>
</html>`;


function escapeMarkdownTableCell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|");
}

function formatCommunicationPlanMarkdown(reply) {
  const title = String(reply.scenario_title ?? "Сценарий коммуникации");
  const goal = String(reply.goal ?? "Договориться о следующем шаге");
  const rows = Array.isArray(reply.steps) ? reply.steps : [];
  const examples = Array.isArray(reply.examples) ? reply.examples : [];
  const conversationExamples = Array.isArray(reply.conversation_examples) ? reply.conversation_examples : [];
  const note = String(reply.note ?? "").trim();
  const jobId = String(reply.job_id ?? "").trim();
  const vacancyId = String(reply.vacancy_id ?? "").trim();

  const tableRows = rows.length > 0
    ? rows.map((row) => {
      const reminders = Number.isInteger(row?.reminders_count)
        ? row.reminders_count
        : 0;
      return `| ${escapeMarkdownTableCell(row?.step)} | ${reminders} | ${escapeMarkdownTableCell(row?.comment)} |`;
    }).join("\n")
    : "| — | — | — |";

  const examplesBlock = examples.length > 0
    ? [
      "",
      "### Примеры первого сообщения",
      "",
      ...examples.map((item, index) => (
        `**${index + 1}. ${item?.title ?? `Вариант ${index + 1}`}:** ${item?.message ?? "—"}`
      ))
    ].join("\n")
    : "";

  const reportPath = jobId
    ? `chat/communication-examples?job_id=${encodeURIComponent(jobId)}`
    : (vacancyId ? `chat/communication-examples?vacancy_id=${encodeURIComponent(vacancyId)}` : null);
  const conversationsBlock = conversationExamples.length > 0
    ? [
      "",
      "### Примеры общения (рекрутер ↔ кандидат)",
      "",
      ...conversationExamples.map((item, index) => {
        const turns = Array.isArray(item?.turns) ? item.turns : [];
        const preview = turns
          .slice(0, 4)
          .map((turn) => `- **${turn?.speaker === "candidate" ? "Кандидат" : "Рекрутер"}:** ${turn?.message ?? "—"}`)
          .join("\n");
        return [
          `**${index + 1}. ${item?.title ?? `Диалог ${index + 1}`}` + "**",
          item?.summary ? `_${item.summary}_` : "",
          preview
        ].filter(Boolean).join("\n");
      }),
      reportPath ? `\n[Открыть HTML-отчёт](${reportPath})` : ""
    ].join("\n")
    : "";

  const hintBlock = examples.length === 0
    ? "\n\n_Чтобы получить примеры первого сообщения, нажмите «Запустить»._"
    : "";
  const conversationHintBlock = conversationExamples.length === 0
    ? "\n\n_Чтобы получить тренировочный диалог, нажмите «Сгенерировать примеры общения»._"
    : "";

  return [
    "## План коммуникации",
    "",
    `**Сценарий:** ${title}`,
    `**Цель:** ${goal}`,
    "",
    "| Шаг | Кол-во напоминалок | Комментарий |",
    "|---|---:|---|",
    tableRows,
    note ? `\n> ${note}` : "",
    hintBlock,
    conversationHintBlock,
    examplesBlock,
    conversationsBlock
  ].filter(Boolean).join("\n");
}

function replyToMarkdown(reply) {
  const normalizedReply = tryParseStructuredReply(reply);
  if (normalizedReply) {
    reply = normalizedReply;
  }
  const mappedErrorReply = mapErrorBodyToReply(reply);
  if (mappedErrorReply) {
    reply = mappedErrorReply;
  }

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

  if (reply.kind === "display") {
    return {
      markdown: String(reply.content ?? "…"),
      actions: Array.isArray(reply.options)
        ? reply.options.map((option) => ({ label: option, message: option }))
        : [],
    };
  }

  if (reply.kind === "user_input") {
    return {
      markdown: String(reply.message ?? "Введите ответ."),
      actions: [],
    };
  }

  if (reply.kind === "buttons") {
    return {
      markdown: String(reply.message ?? "Выберите действие."),
      actions: Array.isArray(reply.options)
        ? reply.options.map((option) => ({ label: option, message: option }))
        : [],
    };
  }

  if (reply.kind === "completed") {
    return {
      markdown: String(reply.message ?? "Готово."),
      actions: [],
    };
  }

  if (reply.kind === "communication_plan") {
    return {
      markdown: formatCommunicationPlanMarkdown(reply),
      actions: Array.isArray(reply.actions) ? reply.actions : [],
    };
  }

  // Unknown — dump as code block
  return {
    markdown: "```json\n" + JSON.stringify(reply, null, 2) + "\n```",
    actions: [],
  };
}

function serializeReplyForClient(reply) {
  const { markdown, actions } = replyToMarkdown(reply);
  return {
    markdown,
    text: markdown,
    actions
  };
}

function mapErrorBodyToReply(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || body.kind) {
    return null;
  }

  if (body.error === "job_not_found" || body.error === "vacancy_not_found") {
    return {
      kind: "fallback_text",
      text: "Не удалось найти актуальную вакансию для этого запроса. Выберите вакансию заново и повторите попытку."
    };
  }

  if (typeof body.message === "string" && body.message.trim()) {
    return {
      kind: "fallback_text",
      text: body.message.trim()
    };
  }

  if (typeof body.error === "string" && body.error.trim()) {
    return {
      kind: "fallback_text",
      text: body.error.trim()
    };
  }

  return null;
}

function tryParseStructuredReply(reply) {
  if (typeof reply !== "string") {
    return null;
  }

  const normalized = normalizeJsonResponseText(reply);
  if (!normalized || (!normalized.startsWith("{") && !normalized.startsWith("["))) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function handleChatWs(ws, msg, wsContext, app) {
  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  const { text, vacancyId, jobId, playbookKey, clientContext } = msg;
  console.log("[ws] message:", JSON.stringify({ text, vacancyId, jobId, playbookKey, tenantId: wsContext.tenantId }));

  try {
    send({ type: "progress", tool: "route_playbook", label: "Определяю плейбук" });

    const result = await app.postChatMessage({
      message: text,
      tenantSql: wsContext.tenantSql,
      tenantId: wsContext.tenantId,
      recruiterId: wsContext.recruiterId,
      playbook_key: playbookKey ?? null,
      vacancy_id: vacancyId,
      job_id: jobId ?? null,
      client_context: clientContext ?? null,
    });

    const reply = result.body?.reply ?? mapErrorBodyToReply(result.body) ?? result.body;
    console.log("[ws] reply kind:", reply?.kind ?? "unknown", "status:", result.status);

    send({ type: "progress", tool: "render", label: "Генерирую ответ" });
    const { markdown, actions } = replyToMarkdown(reply);
    send({ type: "chunk", text: markdown });
    send({
      type: "done",
      actions,
      playbookKey: result.body?.playbook_key ?? null,
      playbookActive: Boolean(result.body?.playbook_active),
      sessionId: result.body?.session_id ?? null,
      vacancyId: result.body?.vacancy_id ?? null,
      jobId: result.body?.job_id ?? null,
      jobSetupId: result.body?.job_setup_id ?? result.body?.vacancy_id ?? null,
      vacancyTitle: result.body?.vacancy_title ?? null,
      replyKind: reply?.kind ?? null,
      reply
    });

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
  const appBasePath = normalizeBasePath(options.appBasePath ?? process.env.APP_BASE_PATH ?? "");
  const loginPath = joinBasePath(appBasePath, "/login");
  const logoutPath = joinBasePath(appBasePath, "/logout");
  const wsPath = joinBasePath(appBasePath, "/ws");
  const rootPath = appBasePath ? `${appBasePath}/` : "/";
  const sessionCookieName = options.sessionCookieName ?? process.env.SESSION_COOKIE_NAME ?? sessionCookieNameFromBasePath(appBasePath);
  const sessionCookiePath = appBasePath || "/";

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const routePath = routePathFromRequest(requestUrl.pathname, appBasePath);
      const normalizedPath = routePath ?? requestUrl.pathname;

      // Health stays available both with and without base path to keep VM-local probes simple.
      if (request.method === "GET" && (requestUrl.pathname === "/health" || normalizedPath === "/health")) {
        const includePlaybooks =
          requestUrl.searchParams.get("details") === "1"
          || requestUrl.searchParams.get("include_playbooks") === "1";
        const result = await app.getHealth({ includePlaybooks });
        writeJson(response, result.status, result.body);
        return;
      }

      if (request.method === "GET" && (requestUrl.pathname === "/health_status" || normalizedPath === "/health_status")) {
        const cookies = parseCookies(request.headers.cookie ?? "");
        const sessionToken = cookies[sessionCookieName];
        const session = await resolveSession(managementSql, sessionToken);
        const result = await app.getHealth();
        writeJson(response, 200, await buildHealthStatusResponse({
          health: result.body,
          session,
          requestUrl,
          appBasePath
        }));
        return;
      }

      if (routePath === null) {
        writeJson(response, 404, { error: "not_found" });
        return;
      }

      if (request.method === "GET" && normalizedPath === "/login") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          LOGIN_HTML
            .replaceAll("__APP_BASE_PATH__", escapeJsString(appBasePath))
        );
        return;
      }

      if (request.method === "POST" && normalizedPath === "/auth/login") {
        const body = await readJsonBody(request);
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

        if (!email || !password) {
          writeJson(response, 400, {
            error: "missing_credentials",
            message: "Укажите email и пароль."
          });
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
          writeJson(response, 401, {
            error: "invalid_credentials",
            message: "Не удалось войти. Проверьте email и пароль."
          });
          return;
        }

        const sessionToken = await createSession(managementSql, recruiter.recruiter_id);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": `${sessionCookieName}=${sessionToken}; HttpOnly; Path=${sessionCookiePath}; Max-Age=2592000; SameSite=Strict${secure}`
        });
        response.end(JSON.stringify({ redirect: rootPath }));
        return;
      }

      if (request.method === "GET" && normalizedPath === "/logout") {
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        response.writeHead(302, {
          location: loginPath,
          "set-cookie": `${sessionCookieName}=; HttpOnly; Path=${sessionCookiePath}; Max-Age=0; SameSite=Strict${secure}`
        });
        response.end();
        return;
      }

      if (request.method === "GET" && normalizedPath === "/") {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv,
          unauthorizedStatus: 302,
          loginPath,
          sessionCookieName
        });
        if (!accessContext) return;

        const chatbotBaseUrl = process.env.CHATBOT_BASE_URL ?? process.env.CANDIDATE_CHATBOT_BASE_URL ?? "";
        const recruiterToken = await getChatbotRecruiterToken(accessContext.tenantSql, accessContext.recruiterId);
        const chatbotModerationBase = recruiterToken ? `${chatbotBaseUrl}/recruiter/${recruiterToken}` : "";

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          CHAT_HTML
            .replace("__RECRUITER_EMAIL__", escapeHtml(accessContext.recruiterEmail))
            .replace("__CHATBOT_MODERATION_BASE__", escapeHtml(chatbotModerationBase))
            .replace("__LOGOUT_PATH__", escapeHtml(logoutPath))
            .replace("__APP_BASE_PATH__", escapeJsString(appBasePath))
        );
        return;
      }

      if (request.method === "GET" && normalizedPath === "/chat/communication-examples") {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv,
          sessionCookieName
        });
        if (!accessContext) return;
        if (!accessContext.tenantSql) {
          writeJson(response, 501, { error: "tenant_sql_not_configured" });
          return;
        }

        const vacancyId = requestUrl.searchParams.get("vacancy_id");
        const jobId = requestUrl.searchParams.get("job_id");
        if (!vacancyId && !jobId) {
          writeJson(response, 400, { error: "vacancy_or_job_id_required" });
          return;
        }

        const reportData = await getCommunicationExamplesReportData(accessContext.tenantSql, { vacancyId, jobId });
        if (!reportData) {
          writeJson(response, 404, { error: "communication_examples_not_found" });
          return;
        }

        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderCommunicationExamplesReportHtml(reportData));
        return;
      }

      if (request.method === "GET" && (normalizedPath === "/api/jobs" || normalizedPath === "/api/vacancies")) {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv,
          sessionCookieName
        });
        if (!accessContext) return;

        const result = await app.getVacancies({
          tenantSql: accessContext.tenantSql,
          tenantId: accessContext.tenantId
        });
        writeJson(response, result.status, result.body);
        return;
      }

      if (request.method === "POST" && normalizedPath === "/api/chat") {
        const accessContext = await requireAccessContext(request, response, {
          managementStore,
          poolRegistry,
          appEnv,
          sessionCookieName
        });
        if (!accessContext) return;

        const body = await readJsonBody(request);
        const result = await app.postChatMessage({
          message: body.message,
          action: body.action,
          playbook_key: body.playbook_key,
          client_context: body.client_context,
          tenantSql: accessContext.tenantSql,
          tenantId: accessContext.tenantId,
          recruiterId: accessContext.recruiterId,
          managementSql,
          job_id: body.job_id,
          vacancy_id: body.vacancy_id
        });

        const bodyWithRender = (() => {
          const reply = result.body?.reply ?? mapErrorBodyToReply(result.body);
          if (!result.body || !reply) {
            return result.body;
          }

          return {
            ...result.body,
            ...serializeReplyForClient(reply)
          };
        })();

        writeJson(response, result.status, bodyWithRender);
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
  const wss = new WebSocketServer({ server, path: wsPath });

  wss.on("connection", async (ws, req) => {
    console.log("[ws] new connection");
    const cookies = parseCookies(req.headers.cookie ?? "");
    const sessionToken = cookies[sessionCookieName];

    // Resolve access context at connection time — mirrors requireAccessContext.
    // This ensures tenantSql is properly tenant-scoped in management mode.
    let wsContext;
    if (managementStore && poolRegistry) {
      try {
        const ctx = await resolveAccessContext({
          managementStore,
          poolRegistry,
          appEnv,
          sessionToken,
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
      const recruiter = await resolveSession(managementSql, sessionToken).catch(() => null);
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
        await handleChatWs(ws, msg, wsContext, app);
      }
    });
  });
  // ─────────────────────────────────────────────────────────────────────────────

  return server;
}

function normalizeBasePath(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "/") return "";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/g, "");
}

function joinBasePath(basePath, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return basePath ? `${basePath}${normalizedPath}` : normalizedPath;
}

function routePathFromRequest(pathname, basePath) {
  if (!basePath) return pathname || "/";
  if (pathname === basePath || pathname === `${basePath}/`) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || "/";
  }
  return null;
}

function sessionCookieNameFromBasePath(basePath) {
  if (!basePath) return "session";
  const suffix = basePath.slice(1).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `session_${suffix}`;
}

function escapeJsString(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

async function requireAccessContext(request, response, options = {}) {
  const unauthorizedStatus = options.unauthorizedStatus ?? 401;
  const cookies = parseCookies(request.headers.cookie ?? "");
  const sessionCookieName = options.sessionCookieName ?? "session";
  const loginPath = options.loginPath ?? "/login";
  const sessionToken = cookies[sessionCookieName];
  if (!options.managementStore || !options.poolRegistry) {
    const recruiter = await resolveSession(null, sessionToken);
    if (recruiter) {
      return {
        recruiterId: recruiter.recruiter_id,
        recruiterEmail: recruiter.email,
        tenantId: recruiter.tenant_id,
        tenantSql: null
      };
    }

    if (unauthorizedStatus === 302) {
      response.writeHead(302, { location: loginPath });
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
      sessionToken
    });
  } catch (error) {
    if (error instanceof AccessContextError && error.code === "ERROR_UNAUTHENTICATED" && unauthorizedStatus === 302) {
      response.writeHead(302, { location: loginPath });
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
      response.writeHead(302, { location: loginPath });
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

async function buildHealthStatusResponse({ health, session, requestUrl, appBasePath }) {
  const authenticated = Boolean(session);
  const runtimeOk = health?.status === "ok";
  const loginPath = joinBasePath(appBasePath, "/login");
  const deploy = await readDeployStatus();
  const runtime = {
    health_ok: runtimeOk,
    service: health?.service ?? "hiring-agent",
    mode: health?.mode ?? "unknown",
    app_env: health?.app_env ?? "unknown",
    deploy_sha: health?.deploy_sha ?? "unknown",
    started_at: health?.started_at ?? null,
    port: health?.port ?? null
  };

  if (!authenticated) {
    return {
      status_key: "auth_required",
      title: "Нужен повторный вход",
      message: "Сессия истекла или ещё не создана. Войдите, чтобы продолжить работу.",
      severity: "warning",
      deploy,
      runtime,
      auth: {
        authenticated: false,
        login_path: loginPath
      },
      details: {
        request_path: requestUrl.pathname,
        reason: "no_active_session"
      }
    };
  }

  if (deploy?.state === "failed") {
    return {
      status_key: "deploy_failed",
      title: "Обновление сервера завершилось с ошибкой",
      message: "Это не похоже на обычное ожидание. Последняя выкладка не завершилась.",
      severity: "warning",
      deploy,
      runtime,
      auth: {
        authenticated: true,
        recruiter_email: session.email ?? null,
        recruiter_status: session.recruiter_status ?? null,
        tenant_status: session.tenant_status ?? null
      },
      details: {
        request_path: requestUrl.pathname
      }
    };
  }

  if (deploy?.state === "in_progress" || deploy?.state === "queued") {
    return {
      status_key: "deploy_in_progress",
      title: "Идёт обновление сервера",
      message: formatDeployInProgressMessage(deploy, runtime),
      severity: "info",
      deploy,
      runtime,
      auth: {
        authenticated: true,
        recruiter_email: session.email ?? null,
        recruiter_status: session.recruiter_status ?? null,
        tenant_status: session.tenant_status ?? null
      },
      details: {
        request_path: requestUrl.pathname,
        sha_matches_expected: runtime.deploy_sha === (deploy.expected_sha ?? runtime.deploy_sha)
      }
    };
  }

  if (deploy?.state === "succeeded" && deploy.expected_sha && runtime.deploy_sha !== deploy.expected_sha) {
    return {
      status_key: "deploy_pending_switch",
      title: "Новый релиз уже выложен",
      message: "Обновление завершилось, но публичный сервер ещё не переключился на новую версию.",
      severity: "info",
      deploy,
      runtime,
      auth: {
        authenticated: true,
        recruiter_email: session.email ?? null,
        recruiter_status: session.recruiter_status ?? null,
        tenant_status: session.tenant_status ?? null
      },
      details: {
        request_path: requestUrl.pathname,
        sha_matches_expected: false
      }
    };
  }

  if (runtimeOk) {
    return {
      status_key: "runtime_available",
      title: "Сервер отвечает",
      message: "Сервис доступен. Если live-канал задерживается, можно продолжать через обычные запросы.",
      severity: "info",
      deploy,
      runtime,
      auth: {
        authenticated: true,
        recruiter_email: session.email ?? null,
        recruiter_status: session.recruiter_status ?? null,
        tenant_status: session.tenant_status ?? null
      },
      details: {
        request_path: requestUrl.pathname
      }
    };
  }

  return {
    status_key: "runtime_unavailable",
    title: "Сервер отвечает нестабильно",
    message: "Сервис доступен, но сообщил о проблеме со своим состоянием.",
    severity: "warning",
    deploy,
    runtime,
    auth: {
      authenticated: true,
      recruiter_email: session.email ?? null,
      recruiter_status: session.recruiter_status ?? null,
      tenant_status: session.tenant_status ?? null
    },
    details: {
      request_path: requestUrl.pathname
    }
  };
}

async function readDeployStatus() {
  const candidates = [
    process.env.DEPLOY_STATUS_FILE,
    path.resolve(process.cwd(), "deploy-status.json"),
    path.resolve(process.cwd(), "../deploy-status.json")
  ].filter(Boolean);

  for (const filename of candidates) {
    try {
      const raw = await readFile(filename, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeDeployStatus(parsed);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      continue;
    }
  }

  return null;
}

function normalizeDeployStatus(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const startedAt = typeof raw.started_at === "string" ? raw.started_at : null;
  const completedAt = typeof raw.completed_at === "string" ? raw.completed_at : null;
  const updatedAt = typeof raw.updated_at === "string" ? raw.updated_at : null;
  return {
    state: typeof raw.state === "string" ? raw.state : "unknown",
    target: typeof raw.target === "string" ? raw.target : null,
    expected_sha: typeof raw.expected_sha === "string" ? raw.expected_sha : null,
    started_at: startedAt,
    completed_at: completedAt,
    updated_at: updatedAt,
    avg_duration_sec: Number.isFinite(Number(raw.avg_duration_sec)) ? Number(raw.avg_duration_sec) : null,
    elapsed_sec: startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)) : null,
    run_url: typeof raw.run_url === "string" ? raw.run_url : null,
    workflow: typeof raw.workflow === "string" ? raw.workflow : null
  };
}

function formatDeployInProgressMessage(deploy, runtime) {
  const bits = [];
  if (deploy.avg_duration_sec) {
    bits.push(`Обычно это занимает около ${formatDurationSeconds(deploy.avg_duration_sec)}.`);
  } else {
    bits.push("Обычно это занимает несколько минут.");
  }

  if (deploy.elapsed_sec != null) {
    bits.push(`Сейчас прошло ${formatDurationSeconds(deploy.elapsed_sec)}.`);
  }

  if (deploy.expected_sha && runtime.deploy_sha && deploy.expected_sha !== runtime.deploy_sha) {
    bits.push("Пока ещё работает предыдущая версия сервиса.");
  }

  return bits.join(" ");
}

function formatDurationSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (minutes === 0) return `${seconds} сек`;
  return `${minutes} мин ${seconds} сек`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

async function getCommunicationExamplesReportData(tenantSql, { vacancyId, jobId }) {
  const rows = vacancyId
    ? await tenantSql`
      SELECT vacancy_id, job_id, title, updated_at, communication_plan, communication_plan_draft, communication_examples
      FROM chatbot.vacancies
      WHERE vacancy_id = ${vacancyId}
      LIMIT 1
    `
    : await tenantSql`
      SELECT vacancy_id, job_id, title, updated_at, communication_plan, communication_plan_draft, communication_examples
      FROM chatbot.vacancies
      WHERE job_id = ${jobId}
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'draft' THEN 1
          ELSE 2
        END ASC,
        updated_at DESC,
        created_at DESC
      LIMIT 1
    `;

  const vacancy = rows[0] ?? null;
  if (!vacancy) return null;

  return {
    vacancyId: vacancy.vacancy_id,
    jobId: vacancy.job_id ?? vacancy.vacancy_id ?? null,
    title: vacancy.title ?? "Вакансия",
    updatedAt: vacancy.updated_at ?? null,
    plan: normalizeReportPlan(vacancy.communication_plan_draft) ?? normalizeReportPlan(vacancy.communication_plan),
    conversationExamples: normalizeReportConversationExamples(vacancy.communication_examples)
  };
}

function normalizeReportPlan(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rows = Array.isArray(raw.steps) ? raw.steps : [];
  if (rows.length === 0) return null;
  return {
    scenarioTitle: String(raw.scenario_title ?? "Сценарий").trim() || "Сценарий",
    goal: String(raw.goal ?? "Договориться о следующем шаге").trim() || "Договориться о следующем шаге",
    steps: rows.map((row) => ({
      step: String(row?.step ?? "").trim(),
      remindersCount: Number.isFinite(Number(row?.reminders_count)) ? Math.round(Number(row.reminders_count)) : 0,
      comment: String(row?.comment ?? "").trim()
    })).filter((row) => row.step.length > 0)
  };
}

function normalizeReportConversationExamples(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const turns = Array.isArray(item?.turns)
        ? item.turns
          .map((turn) => {
            const role = String(turn?.speaker ?? turn?.role ?? "").toLowerCase().trim();
            const speaker = role === "candidate" ? "candidate" : (role === "recruiter" ? "recruiter" : null);
            const message = String(turn?.message ?? turn?.text ?? "").trim();
            if (!speaker || !message) return null;
            return { speaker, message };
          })
          .filter(Boolean)
        : [];
      if (turns.length === 0) return null;
      return {
        title: String(item?.title ?? `Диалог ${index + 1}`).trim() || `Диалог ${index + 1}`,
        summary: String(item?.summary ?? "").trim(),
        turns: turns.slice(0, 12)
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function renderCommunicationExamplesReportHtml(report) {
  const updatedAtLabel = report.updatedAt
    ? new Date(report.updatedAt).toLocaleString("ru-RU")
    : "—";
  const planRows = report.plan?.steps?.length
    ? report.plan.steps.map((row) => (
      `<tr><td>${escapeHtml(row.step)}</td><td>${row.remindersCount}</td><td>${escapeHtml(row.comment || "—")}</td></tr>`
    )).join("")
    : "<tr><td colspan=\"3\">План не найден</td></tr>";

  const conversations = report.conversationExamples.length > 0
    ? report.conversationExamples.map((example, index) => {
      const turns = example.turns.map((turn) => (
        `<div class="turn ${turn.speaker}"><div class="speaker">${turn.speaker === "candidate" ? "Кандидат" : "Рекрутер"}</div><div class="text">${escapeHtml(turn.message)}</div></div>`
      )).join("");
      return `<section class="example-card"><h3>${index + 1}. ${escapeHtml(example.title)}</h3>${example.summary ? `<p class="summary">${escapeHtml(example.summary)}</p>` : ""}<div class="turns">${turns}</div></section>`;
    }).join("")
    : "<section class=\"example-card\"><h3>Диалоги пока не сгенерированы</h3><p class=\"summary\">Вернитесь в чат и нажмите «Сгенерировать примеры общения».</p></section>";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Примеры общения — ${escapeHtml(report.title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#08101d; --panel:#0e1a2b; --line:#1e3351; --text:#e7efff; --muted:#94a5c3; --acc:#78a8ff; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif; background: linear-gradient(180deg,#070f1c,#0b1526); color: var(--text); }
    .shell { width: min(1100px, calc(100% - 32px)); margin: 24px auto 40px; display: grid; gap: 14px; }
    .panel { border: 1px solid var(--line); background: var(--panel); border-radius: 18px; padding: 18px; }
    h1 { margin: 0 0 8px; font-size: clamp(24px, 4vw, 34px); }
    .meta { color: var(--muted); font-size: 14px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
    th, td { border: 1px solid var(--line); padding: 10px; vertical-align: top; }
    th { text-align: left; color: var(--muted); font-weight: 600; }
    .example-card { border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin-top: 12px; background: rgba(8,16,29,0.65); }
    .example-card h3 { margin: 0 0 8px; font-size: 18px; }
    .summary { margin: 0 0 10px; color: var(--muted); }
    .turns { display: grid; gap: 8px; }
    .turn { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
    .turn.recruiter { background: rgba(120,168,255,0.12); }
    .turn.candidate { background: rgba(148,165,195,0.08); }
    .speaker { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
    .text { line-height: 1.55; white-space: pre-wrap; }
  </style>
</head>
<body>
  <main class="shell">
    <section class="panel">
      <h1>Примеры общения</h1>
      <p class="meta"><strong>Вакансия:</strong> ${escapeHtml(report.title)}<br><strong>job_id:</strong> ${escapeHtml(report.jobId ?? "—")}<br><strong>vacancy_id:</strong> ${escapeHtml(report.vacancyId)}<br><strong>Обновлено:</strong> ${escapeHtml(updatedAtLabel)}</p>
    </section>
    <section class="panel">
      <h2>План коммуникации</h2>
      <p class="meta"><strong>Сценарий:</strong> ${escapeHtml(report.plan?.scenarioTitle ?? "—")}<br><strong>Цель:</strong> ${escapeHtml(report.plan?.goal ?? "—")}</p>
      <table>
        <thead><tr><th>Шаг</th><th>Напоминания</th><th>Комментарий</th></tr></thead>
        <tbody>${planRows}</tbody>
      </table>
    </section>
    <section class="panel">
      <h2>Тренировочные диалоги</h2>
      ${conversations}
    </section>
  </main>
</body>
</html>`;
}

class InvalidJsonError extends Error {
  constructor() {
    super("Request body is not valid JSON");
    this.name = "InvalidJsonError";
  }
}

async function getChatbotRecruiterToken(tenantSql, recruiterId) {
  if (!tenantSql || !recruiterId) return null;
  try {
    const rows = await tenantSql`
      SELECT recruiter_token FROM chatbot.recruiters WHERE recruiter_id = ${recruiterId} LIMIT 1
    `;
    return rows[0]?.recruiter_token ?? null;
  } catch {
    return null;
  }
}
