import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
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
  <title>Сообщения на модерации</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f1ea;
      --panel: #fffdf8;
      --panel-muted: #f8f4ed;
      --line: #d8d0c3;
      --text: #1f2933;
      --muted: #667085;
      --accent: #8f4f24;
      --accent-soft: #f1dfcf;
      --danger: #b42318;
      --shadow: 0 18px 50px rgba(31, 41, 51, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(143, 79, 36, 0.08), transparent 30%),
        linear-gradient(180deg, #fbf8f3 0%, var(--bg) 100%);
      color: var(--text);
    }
    .shell {
      width: min(1440px, calc(100vw - 32px));
      margin: 24px auto;
      padding: 24px;
      border: 1px solid rgba(216, 208, 195, 0.8);
      border-radius: 28px;
      background: rgba(255, 253, 248, 0.96);
      box-shadow: var(--shadow);
    }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 20px;
    }
    .title {
      margin: 0;
      font-size: clamp(28px, 4vw, 38px);
      line-height: 1;
    }
    .subtitle {
      margin: 8px 0 0;
      max-width: 740px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.45;
    }
    .header-meta {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
    }
    .filter-badge, .meta-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
    }
    .all-link {
      color: var(--muted);
      font-size: 13px;
      text-decoration: none;
    }
    #status {
      min-height: 20px;
      margin-bottom: 16px;
      color: var(--muted);
      font-size: 14px;
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
      gap: 20px;
      min-height: 720px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 24px;
      background: var(--panel);
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 18px 18px 14px;
      border-bottom: 1px solid rgba(216, 208, 195, 0.7);
      background: rgba(248, 244, 237, 0.55);
    }
    .panel-title {
      margin: 0;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .panel-note {
      margin: 4px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    .queue-list {
      padding: 12px;
      display: grid;
      gap: 10px;
      max-height: 820px;
      overflow: auto;
    }
    .queue-item {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 18px;
      background: var(--panel-muted);
      padding: 14px;
      text-align: left;
      cursor: pointer;
      transition: border-color 120ms ease, transform 120ms ease, background 120ms ease;
    }
    .queue-item:hover {
      border-color: rgba(143, 79, 36, 0.24);
      transform: translateY(-1px);
    }
    .queue-item.active {
      border-color: rgba(143, 79, 36, 0.5);
      background: #fff7ee;
      box-shadow: inset 0 0 0 1px rgba(143, 79, 36, 0.08);
    }
    .queue-topline, .detail-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    .queue-name {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
    }
    .queue-job, .queue-step, .queue-preview, .detail-note, .reason, .history-meta {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .queue-preview {
      color: var(--text);
    }
    .countdown {
      flex: 0 0 auto;
      padding: 5px 8px;
      border-radius: 999px;
      background: white;
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .countdown.overdue {
      color: var(--danger);
      background: #fdecec;
    }
    .detail {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .detail-body {
      padding: 18px;
      display: grid;
      gap: 16px;
      overflow: auto;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      padding: 14px;
      border-radius: 18px;
      background: var(--panel-muted);
      border: 1px solid rgba(216, 208, 195, 0.7);
    }
    .metric-label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .metric-value {
      margin-top: 8px;
      font-size: 15px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .card {
      padding: 16px 18px;
      border: 1px solid rgba(216, 208, 195, 0.75);
      border-radius: 20px;
      background: white;
    }
    .card-title {
      margin: 0 0 10px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .message-body, .resume-body {
      margin: 0;
      white-space: pre-wrap;
      line-height: 1.55;
      word-break: break-word;
    }
    .timeline {
      display: grid;
      gap: 10px;
    }
    .timeline-item {
      padding: 12px 14px;
      border-radius: 16px;
      background: var(--panel-muted);
      border: 1px solid rgba(216, 208, 195, 0.65);
    }
    .timeline-item.outbound {
      background: #fff5ea;
      border-color: rgba(143, 79, 36, 0.22);
    }
    .history-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: 0;
    }
    .history-body {
      margin: 8px 0 0;
      white-space: pre-wrap;
      line-height: 1.5;
      word-break: break-word;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 11px 16px;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
    }
    .primary-btn {
      background: var(--accent);
      color: white;
    }
    .ghost-btn {
      background: #efe9df;
      color: var(--text);
    }
    .empty {
      padding: 32px 18px;
      color: var(--muted);
      text-align: center;
    }
    details {
      border-top: 1px solid rgba(216, 208, 195, 0.75);
      padding-top: 12px;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--text);
    }
    @media (max-width: 980px) {
      .shell {
        width: calc(100vw - 16px);
        margin: 8px auto;
        padding: 14px;
        border-radius: 20px;
      }
      .header, .workspace, .queue-topline, .detail-meta, .summary-grid {
        grid-template-columns: 1fr;
        display: grid;
      }
      .header-meta {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="header">
      <div>
        <h1 class="title">Сообщения на модерации</h1>
        <p class="subtitle">Очередь запланированных сообщений кандидатам. Слева видно последнее сообщение и срок автоотправки, справа полный planned message, история общения и резюме.</p>
      </div>
      <div class="header-meta" id="filter-badge">
        <span class="meta-badge" id="queue-size">0 в очереди</span>
      </div>
    </header>
    <div id="status"></div>
    <section class="workspace">
      <aside class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Очередь</h2>
            <p class="panel-note">200 символов последнего сообщения видны сразу, полная переписка открывается справа.</p>
          </div>
        </div>
        <div class="queue-list" id="queue-list"></div>
      </aside>
      <section class="panel detail">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Детали</h2>
            <p class="panel-note" id="detail-subtitle">Выберите сообщение слева, чтобы проверить planned message и контекст.</p>
          </div>
        </div>
        <div class="detail-body" id="detail-body">
          <div class="empty">Очередь пока пустая.</div>
        </div>
      </section>
    </section>
  </main>
  <script>
    const TOKEN = location.pathname.split('/')[2];
    const params = new URLSearchParams(location.search);
    const JOB_ID = params.get('job_id') || null;
    const JOB_TITLE = params.get('title') || null;
    let items = [];
    let selectedId = null;

    if (JOB_ID) {
      const badge = document.getElementById('filter-badge');
      badge.innerHTML =
        '<span class="meta-badge" id="queue-size">0 в очереди</span>' +
        '<span class="filter-badge">Вакансия: ' + esc(JOB_TITLE || JOB_ID) + '</span>' +
        '<a class="all-link" href="/recruiter/' + esc(TOKEN) + '">← все вакансии</a>';
    }

    function esc(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
    }

    async function fetchQueue() {
      const url = '/recruiter/' + TOKEN + '/queue' + (JOB_ID ? '?job_id=' + encodeURIComponent(JOB_ID) : '');
      const r = await fetch(url);
      if (!r.ok) { document.getElementById('status').textContent = 'Ошибка загрузки'; return; }
      const data = await r.json();
      items = data.items;
      document.getElementById('status').textContent = items.length
        ? 'Обновляется автоматически каждые 5 секунд.'
        : 'Сейчас нет сообщений, ожидающих модерации.';
      const queueSize = document.getElementById('queue-size');
      if (queueSize) {
        queueSize.textContent = items.length + ' в очереди';
      }
      if (!items.length) {
        selectedId = null;
      } else if (!selectedId || !items.some((item) => item.planned_message_id === selectedId)) {
        selectedId = items[0].planned_message_id;
      }
      renderQueueList();
      renderDetail();
    }

    function renderQueueList() {
      const list = document.getElementById('queue-list');
      list.innerHTML = '';
      if (!items.length) {
        list.innerHTML = '<div class="empty">Нет сообщений в очереди.</div>';
        return;
      }
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'queue-item' + (item.planned_message_id === selectedId ? ' active' : '');
        button.dataset.id = item.planned_message_id;
        button.dataset.sendAfter = item.auto_send_after;
        button.innerHTML =
          '<div class="queue-topline">' +
            '<div>' +
              '<p class="queue-name">' + esc(item.candidate_display_name) + '</p>' +
              '<p class="queue-job">' + esc(item.job_title) + '</p>' +
            '</div>' +
            '<span class="countdown"></span>' +
          '</div>' +
          '<p class="queue-step">' + esc(item.active_step_goal || item.step_id || 'Без шага') + '</p>' +
          '<p class="queue-preview">' + esc(item.last_message_preview || item.planned_message_preview || item.body || '') + '</p>';
        button.addEventListener('click', () => {
          selectedId = item.planned_message_id;
          renderQueueList();
          renderDetail();
        });
        list.appendChild(button);
      }
      updateCountdowns();
    }

    function renderDetail() {
      const detailBody = document.getElementById('detail-body');
      const detailSubtitle = document.getElementById('detail-subtitle');
      const item = items.find((candidateItem) => candidateItem.planned_message_id === selectedId);
      if (!item) {
        detailSubtitle.textContent = 'Выберите сообщение слева, чтобы проверить planned message и контекст.';
        detailBody.innerHTML = '<div class="empty">Очередь пока пустая.</div>';
        return;
      }
      detailSubtitle.textContent = item.candidate_display_name + ' · ' + item.job_title;
      detailBody.innerHTML =
        '<div class="detail-meta">' +
          '<div>' +
            '<h3 style="margin:0;font-size:26px">' + esc(item.candidate_display_name) + '</h3>' +
            '<p class="detail-note">' + esc(item.job_title) + '</p>' +
          '</div>' +
          '<span class="countdown" data-send-after="' + esc(item.auto_send_after) + '">' + esc(formatCountdown(item.auto_send_after)) + '</span>' +
        '</div>' +
        '<div class="summary-grid">' +
          '<div class="metric"><div class="metric-label">Шаг</div><div class="metric-value">' + esc(item.active_step_goal || item.step_id || 'Без шага') + '</div></div>' +
          '<div class="metric"><div class="metric-label">Запланировано</div><div class="metric-value">' + esc(formatDateTime(item.auto_send_after)) + '</div></div>' +
          '<div class="metric"><div class="metric-label">Последнее сообщение</div><div class="metric-value">' + esc(item.last_message_preview || 'Нет сообщений') + '</div></div>' +
        '</div>' +
        '<div class="card">' +
          '<h3 class="card-title">Запланированное сообщение</h3>' +
          '<p class="message-body">' + esc(item.body || '') + '</p>' +
          (item.reason ? '<p class="reason">Причина: ' + esc(item.reason) + '</p>' : '') +
        '</div>' +
        '<div class="actions">' +
          '<button type="button" class="ghost-btn" data-action="block">Заблокировать</button>' +
          '<button type="button" class="primary-btn" data-action="send-now">Отправить сейчас</button>' +
        '</div>' +
        '<div class="card">' +
          '<h3 class="card-title">История сообщений</h3>' +
          renderHistory(item.history) +
        '</div>' +
        '<div class="card">' +
          '<h3 class="card-title">Резюме</h3>' +
          (item.resume_text
            ? '<details open><summary>Показать resume_text</summary><pre class="resume-body">' + esc(item.resume_text) + '</pre></details>'
            : '<p class="detail-note">Резюме пока не сохранено.</p>') +
        '</div>';

      detailBody.querySelector('[data-action="block"]').addEventListener('click', () => doBlock(item.planned_message_id));
      detailBody.querySelector('[data-action="send-now"]').addEventListener('click', () => doSendNow(item.planned_message_id));
      updateCountdowns();
    }

    function renderHistory(history) {
      if (!history || !history.length) {
        return '<p class="detail-note">История ещё не накопилась. В очереди видно только planned message.</p>';
      }
      return '<div class="timeline">' + history.map((message) =>
        '<div class="timeline-item ' + esc(message.direction || '') + '">' +
          '<p class="history-meta"><span>' + esc(message.direction === 'outbound' ? 'Мы' : 'Кандидат') + '</span><span>' + esc(formatDateTime(message.occurred_at)) + '</span></p>' +
          '<p class="history-body">' + esc(message.body || '') + '</p>' +
        '</div>'
      ).join('') + '</div>';
    }

    function formatDateTime(value) {
      const date = value ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) return 'не указано';
      return date.toLocaleString('ru-RU', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function formatCountdown(value) {
      const sendAfter = new Date(value).getTime();
      const secs = Math.round((sendAfter - Date.now()) / 1000);
      if (secs <= 0) return 'Отправка сейчас';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      if (h > 0) return 'через ' + h + 'ч ' + String(m).padStart(2, '0') + 'м';
      return 'через ' + m + ':' + String(s).padStart(2, '0');
    }

    function updateCountdowns() {
      const now = Date.now();
      for (const node of document.querySelectorAll('[data-send-after], .queue-item')) {
        const source = node.dataset.sendAfter ? node : node.closest('[data-send-after]');
        const sendAfter = new Date(source.dataset.sendAfter).getTime();
        const secs = Math.round((sendAfter - now) / 1000);
        const td = node.classList.contains('countdown') ? node : node.querySelector('.countdown');
        if (!td) continue;
        if (secs <= 0) {
          td.textContent = 'Отправка сейчас';
          td.className = 'countdown overdue';
        } else {
          td.textContent = formatCountdown(source.dataset.sendAfter);
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

export function createHttpServer(app, { store, hhOAuthClient, hhPollRunner, hhImportRunner, hhSendRunner, internalApiToken } = {}) {
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, "http://localhost");

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

      if (request.method === "GET" && request.url === "/health") {
        const deploySha = process.env.DEPLOY_SHA ?? "";
        const appEnv = process.env.APP_ENV || "development";
        writeJson(response, 200, {
          service: "candidate-chatbot",
          status: "ok",
          deployed_at: process.env.DEPLOY_TIME || null,
          app_env: appEnv,
          deploy_sha: deploySha,
          seed_version: appEnv === "sandbox" ? "sandbox-v1" : null
        });
        return;
      }

      if (request.method === "GET" && (requestUrl.pathname === "/hh-callback/" || requestUrl.pathname === "/hh-callback")) {
        if (!hhOAuthClient) {
          writeJson(response, 503, { error: "hh_oauth_not_configured" });
          return;
        }
        if (!store) {
          writeJson(response, 503, { error: "hh_state_store_not_configured" });
          return;
        }

        const state = requestUrl.searchParams.get("state");
        if (!state) {
          writeJson(response, 400, { error: "missing_state" });
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (!code) {
          writeJson(response, 400, { error: "missing_code" });
          return;
        }

        const stateKey = stateStorageKey(state);
        const stateRow = await store.getHhOAuthTokens(stateKey);
        if (!stateRow || stateRow.token_type !== "oauth_state") {
          writeJson(response, 400, { error: "invalid_oauth_state" });
          return;
        }
        if (stateRow.metadata?.consumed_at || stateRow.token_type === "oauth_state_consumed") {
          writeJson(response, 400, { error: "oauth_state_consumed" });
          return;
        }
        if (!stateRow.expires_at || new Date(stateRow.expires_at).getTime() <= Date.now()) {
          await store.setHhOAuthTokens(stateKey, {
            ...stateRow,
            token_type: "oauth_state_expired",
            metadata: {
              ...(stateRow.metadata ?? {}),
              expired_at: new Date().toISOString()
            }
          });
          writeJson(response, 400, { error: "oauth_state_expired" });
          return;
        }

        try {
          const tokens = await hhOAuthClient.exchangeCodeForTokens(code);
          const me = await hhOAuthClient.getMe();
          await store.setHhOAuthTokens(stateKey, {
            ...stateRow,
            access_token: state,
            token_type: "oauth_state_consumed",
            metadata: {
              ...(stateRow.metadata ?? {}),
              consumed_at: new Date().toISOString()
            }
          });
          writeJson(response, 200, {
            ok: true,
            provider: "hh",
            employer_id: me.id ?? null,
            manager_id: me.manager?.id ?? null,
            expires_at: tokens.expires_at
          });
        } catch (error) {
          await store.setHhOAuthTokens(stateKey, {
            ...stateRow,
            access_token: state,
            token_type: "oauth_state_error",
            metadata: {
              ...(stateRow.metadata ?? {}),
              error_code: error?.code ?? "error",
              error_message: error?.message ?? "OAuth exchange failed",
              failed_at: new Date().toISOString()
            }
          });
          if (error?.status === 401) {
            writeJson(response, 401, {
              error: "hh_oauth_exchange_failed",
              message: error.message
            });
            return;
          }
          writeJson(response, 400, {
            error: "hh_oauth_exchange_failed",
            message: error.message
          });
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/hh-authorize/") {
        if (!hhOAuthClient) {
          writeJson(response, 503, { error: "hh_oauth_not_configured" });
          return;
        }
        if (!store) {
          writeJson(response, 503, { error: "hh_state_store_not_configured" });
          return;
        }
        const state = randomState();
        const stateKey = stateStorageKey(state);
        const stateExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await store.setHhOAuthTokens(stateKey, {
          access_token: state,
          token_type: "oauth_state",
          expires_at: stateExpiresAt,
          metadata: {
            redirect_uri: hhOAuthClient.redirectUri,
            created_at: new Date().toISOString(),
            user_agent: request.headers["user-agent"] ?? null,
            referer: request.headers["referer"] ?? null
          }
        });
        const authorizeUrl = buildHhAuthorizeUrl({
          clientId: hhOAuthClient.clientId,
          redirectUri: hhOAuthClient.redirectUri,
          state
        });
        writeJson(response, 200, {
          ok: true,
          provider: "hh",
          authorize_url: authorizeUrl,
          state,
          expires_at: stateExpiresAt
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/internal/hh-poll") {
        if (!isAuthorizedInternalRequest(request, internalApiToken)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        if (!hhPollRunner) {
          writeJson(response, 503, { error: "hh_poll_not_configured" });
          return;
        }
        const hhImport = store ? await store.getFeatureFlag("hh_import") : null;
        if (hhImport && hhImport.enabled === false) {
          writeJson(response, 200, { ok: true, skipped: true, reason: "hh_import_disabled" });
          return;
        }
        const result = await hhPollRunner.pollAll();
        writeJson(response, 200, { ok: true, ...(result ?? {}) });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/internal/hh-import") {
        if (!isAuthorizedInternalRequest(request, internalApiToken)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        if (!hhImportRunner) {
          writeJson(response, 503, { error: "hh_import_not_configured" });
          return;
        }
        const hhImport = store ? await store.getFeatureFlag("hh_import") : null;
        if (hhImport && hhImport.enabled === false) {
          writeJson(response, 200, { ok: true, skipped: true, reason: "hh_import_disabled" });
          return;
        }
        const body = await readJsonBody(request).catch(() => ({}));
        if (!isValidIsoDateTime(body.window_start)) {
          writeJson(response, 400, { error: "invalid_window_start" });
          return;
        }
        if (body.window_end != null && !isValidIsoDateTime(body.window_end)) {
          writeJson(response, 400, { error: "invalid_window_end" });
          return;
        }
        const result = await hhImportRunner.syncApplicants({
          windowStart: body.window_start,
          windowEnd: body.window_end
        });
        writeJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/internal/hh-send") {
        const startedAt = Date.now();
        console.info(JSON.stringify({ event: "hh_send_endpoint_enter" }));
        if (!isAuthorizedInternalRequest(request, internalApiToken)) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        if (!hhSendRunner) {
          writeJson(response, 503, { error: "hh_send_not_configured" });
          return;
        }
        const hhSend = store ? await store.getFeatureFlag("hh_send") : null;
        console.info(JSON.stringify({
          event: "hh_send_endpoint_after_flag",
          hh_send_enabled: hhSend?.enabled ?? null,
          elapsed_ms: Date.now() - startedAt
        }));
        if (hhSend && hhSend.enabled === false) {
          writeJson(response, 200, { ok: true, skipped: true, reason: "hh_send_disabled" });
          return;
        }
        const result = await hhSendRunner.sendDue();
        console.info(JSON.stringify({
          event: "hh_send_endpoint_before_return",
          elapsed_ms: Date.now() - startedAt
        }));
        writeJson(response, 200, { ok: true, ...(result ?? {}) });
        return;
      }

      if (request.method === "GET" && request.url === "/") {
        response.writeHead(302, { location: "/login" });
        response.end();
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
        if (!recruiter) {
          writeJson(response, 401, { error: "Неверный email или пароль", error_code: "invalid_credentials" });
          return;
        }
        if (!recruiter.password_hash) {
          writeJson(response, 401, { error: "Пароль не настроен", error_code: "password_not_set" });
          return;
        }
        const validPassword = await bcrypt.compare(String(password), recruiter.password_hash);
        if (!validPassword) {
          writeJson(response, 401, { error: "Неверный email или пароль", error_code: "invalid_credentials" });
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
      const queueMatch = requestUrl.pathname.match(/^\/recruiter\/([^/]+)\/queue$/);
      if (queueMatch && request.method === "GET") {
        const token = queueMatch[1];
        const jobId = requestUrl.searchParams.get("job_id") || undefined;
        const result = await app.getModerationQueue(token, { jobId });
        writeJson(response, result.status, result.body);
        return;
      }

      // Block a message
      const blockMatch = requestUrl.pathname.match(/^\/recruiter\/([^/]+)\/queue\/([^/]+)\/block$/);
      if (blockMatch && request.method === "POST") {
        const [, token, id] = blockMatch;
        const result = await app.blockMessage(token, id);
        writeJson(response, result.status, result.body);
        return;
      }

      // Send now
      const sendNowMatch = requestUrl.pathname.match(/^\/recruiter\/([^/]+)\/queue\/([^/]+)\/send-now$/);
      if (sendNowMatch && request.method === "POST") {
        const [, token, id] = sendNowMatch;
        const result = await app.sendMessageNow(token, id);
        writeJson(response, result.status, result.body);
        return;
      }

      // HTML moderation page — requires valid session cookie when store is available
      const htmlMatch = requestUrl.pathname.match(/^\/recruiter\/([^/]+)$/);
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

function isAuthorizedInternalRequest(request, expectedToken) {
  if (!expectedToken) return false;
  const auth = request.headers.authorization ?? "";
  return auth === `Bearer ${expectedToken}`;
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

function isValidIsoDateTime(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return Number.isFinite(new Date(value).getTime());
}

function randomState() {
  return randomBytes(16).toString("hex");
}

function stateStorageKey(state) {
  return `hh_state:hh:${state}`;
}

function buildHhAuthorizeUrl({ clientId, redirectUri, state }) {
  const authorizeUrl = new URL("https://hh.ru/oauth/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", String(clientId));
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  return authorizeUrl.toString();
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
