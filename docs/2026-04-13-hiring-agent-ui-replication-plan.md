# Plan: Hiring-Agent UI Replication

**Spec**: `docs/hiring-agent-ui-replication-spec.md`  
**Branch**: `feature/chat-ui-replication`  
**Goal**: Replicate recruiter-agent chat UI (dark mode, streaming, action buttons) in hiring-agent  
**Source UI**: `/Users/vova/Documents/GitHub/recruiting-agent/web/app/page.tsx` + `globals.css`

---

## Iteration 1 — WebSocket server skeleton

**Task**: Add WebSocket server to Express.js. Auth on connection. Heartbeat.

- Install `ws` package if not present (`services/hiring-agent/package.json`)
- Import `WebSocketServer` from `ws` in `http-server.js`
- Attach WS server to existing HTTP server (share port)
- On connection: parse session cookie from `req.headers.cookie`, reject with `ws.close(4001, 'Unauthorized')` if invalid
- 30s heartbeat: `setInterval(() => wss.clients.forEach(ws => { if (!alive) ws.terminate(); alive=false; ws.ping() }), 30000)` + `ws.on('pong', () => { alive=true })`
- Basic message echo: receive `{type:"message", text}` → send `{type:"chunk", text: "echo: "+text}` + `{type:"done", actions:[]}`
- Run `pnpm test` from repo root — all tests must pass

**Files**: `services/hiring-agent/src/http-server.js`, `services/hiring-agent/package.json`  
**Status**: pending

---

## Iteration 2 — Streaming adapter + playbook markdown/actions

**Task**: Wire existing playbooks to WebSocket protocol. Add markdown output + actions to playbooks.

### renderReplyAsMarkdown(reply)
- `render_funnel` → format the funnel data as a markdown table (columns: Кандидат, Этап, Источник, etc.) + summary line. Return markdown string.
- `playbook_locked` → `> ⚠️ ${reply.message}`
- `fallback_text` → reply.text as-is
- Any unknown kind → JSON.stringify as code block

### handleChatMessage({ws, text, jobId, session})
```js
async function handleChatMessage({ws, text, jobId, session}) {
  const send = obj => ws.send(JSON.stringify(obj));
  send({type:'progress', tool:'route_playbook'});
  
  const reply = await postChatMessage({text, recruiterId: session.recruiterId, jobId});
  
  const markdown = renderReplyAsMarkdown(reply);
  send({type:'progress', tool: reply.kind || 'generate_reply'});
  send({type:'chunk', text: markdown});
  send({type:'done', actions: reply.actions || []});
}
```

### Add `actions` + `markdown` to candidate-funnel.js reply
```js
return {
  kind: 'render_funnel',
  // ... existing fields ...
  markdown: buildFunnelMarkdown(data),  // new
  actions: [
    {label: 'Сменить вакансию', message: 'покажи список вакансий'},
    {label: 'Топ кандидаты', message: 'покажи топ кандидатов'},
    {label: 'Обновить', message: 'обнови воронку'},
  ]
};
```

### router.js
- Pass through `actions` from playbook reply (don't strip)

### Wire in WS handler
- Replace echo in iteration 1 with `handleChatMessage` call
- Pass `jobId` from WS message payload

- Run `pnpm test` — all pass

**Files**: `http-server.js`, `services/hiring-agent/src/playbooks/candidate-funnel.js`, `router.js`  
**Status**: pending

---

## Iteration 3 — Frontend: complete rewrite of CHAT_HTML

**Task**: Replace the entire `CHAT_HTML` constant with a dark-mode SPA matching recruiter-agent visual design.

### CSS Variables (must match exactly)
```css
:root {
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --color-bg:    #080a0f;
  --color-bg2:   #0e1118;
  --color-bg3:   #161b26;
  --color-edge:  #1e2535;
  --color-t1:    #e4e8f0;
  --color-t2:    #8892a4;
  --color-t3:    #4a5268;
  --color-accent:#4f8ff7;
  --color-accent-dim: rgba(79,143,247,0.12);
  --color-green: #34c759;
  --color-red:   #ef4444;
}
```

Font: `<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">`

### Layout (HTML structure)
```
<header>
  <div class="logo">Hiring Agent</div>
  <select id="job-select">...</select>
  <span id="status-dot" class="dot"></span>
  <a href="/logout" class="logout-btn">Выйти</a>
</header>

<main id="chat-log">
  <!-- messages rendered here -->
</main>

<footer id="input-area">
  <textarea id="msg-input" placeholder="Напишите сообщение..." rows="1"></textarea>
  <button id="send-btn">
    <svg>...</svg>  <!-- send arrow icon -->
  </button>
</footer>
```

### Message bubble HTML (user)
```html
<div class="msg-row user">
  <div class="bubble user-bubble">текст сообщения</div>
</div>
```

### Message bubble HTML (assistant)
```html
<div class="msg-row assistant">
  <div class="bubble assistant-bubble">
    <div class="bubble-content"><!-- markdown rendered --></div>
    <div class="progress-steps">
      <div class="progress-step">
        <span class="dot pulse"></span>
        <span>route_playbook</span>
      </div>
    </div>
    <div class="actions">
      <button class="action-btn" data-msg="покажи список вакансий">Сменить вакансию</button>
    </div>
  </div>
</div>
```

### CSS rules
- User bubble: `background: var(--color-accent); color: white; border-radius: 12px 12px 2px 12px; max-width: 75%; align-self: flex-end`
- Assistant bubble: `background: var(--color-bg2); border: 1px solid var(--color-edge); color: var(--color-t1); border-radius: 12px 12px 12px 2px; max-width: 75%`
- Progress dot: `width:8px; height:8px; border-radius:50%; background: var(--color-accent)` + pulse animation
- Action button: `px:12px py:6px; border-radius:8px; background: var(--color-bg3); border: 1px solid var(--color-edge); color: var(--color-t2); font-size: 12px; cursor: pointer`
- Action button hover: `background: var(--color-accent-dim); border-color: var(--color-accent); color: var(--color-t1)`
- Streaming cursor: `::after { content: '▋'; animation: blink 1s infinite }`
- Status dot: `width:8px; height:8px; border-radius:50%` — green when connected, red when not

### JS WebSocket client

```js
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
let ws;
let streaming = false;
let currentAssistantEl = null;

function connect() {
  ws = new WebSocket(WS_URL);
  
  ws.onopen = () => setStatus('green');
  ws.onclose = () => { setStatus('red'); setTimeout(connect, 3000); }; // auto-reconnect
  ws.onerror = () => setStatus('red');
  
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    
    if (data.type === 'progress') {
      addProgressStep(currentAssistantEl, data.tool);
    }
    if (data.type === 'chunk') {
      appendChunk(currentAssistantEl, data.text);
    }
    if (data.type === 'done') {
      finalizeAssistant(currentAssistantEl, data.actions);
      streaming = false;
      setSendEnabled(true);
    }
    if (data.type === 'error') {
      appendChunk(currentAssistantEl, `\n\n❌ ${data.message}`);
      finalizeAssistant(currentAssistantEl, []);
      streaming = false;
      setSendEnabled(true);
    }
  };
}

function sendMessage(text) {
  if (!text.trim() || streaming || !ws || ws.readyState !== 1) return;
  streaming = true;
  setSendEnabled(false);
  
  // Render user bubble
  addUserBubble(text);
  
  // Create empty assistant bubble
  currentAssistantEl = addAssistantBubble();
  
  // Clear input
  msgInput.value = '';
  msgInput.style.height = 'auto';
  
  // Get selected job
  const jobId = jobSelect.value || null;
  
  // Send via WS
  ws.send(JSON.stringify({type: 'message', text, jobId}));
  
  scrollToBottom();
}
```

### Markdown rendering
Use marked.js + DOMPurify from CDN:
```html
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
```

`appendChunk` accumulates full text and re-renders with `DOMPurify.sanitize(marked.parse(fullText))`.

### Textarea auto-height
```js
msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 160) + 'px';
});
```

### Enter to send, Shift+Enter for newline
```js
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(msgInput.value); }
});
```

### Jobs dropdown
Load from `GET /api/jobs` on page load. Populate `<select id="job-select">`. If no jobs, show placeholder.

### Startup
On page load: connect WS, load jobs, add a greeting assistant message:
```
Привет! Я помогу управлять перепиской с кандидатами.
Выберите вакансию и напишите, что нужно сделать.
```

- Run `pnpm test` — all pass

**Files**: `services/hiring-agent/src/http-server.js` (entire CHAT_HTML rewrite)  
**Status**: pending

---

## Iteration 4 — Integration polish + markdown in code blocks

**Task**: Ensure everything works together. Fix any integration issues.

- Code blocks in markdown: style `pre code` with dark bg, monospace, padding
- Tables in markdown: style with dark bg, borders matching design
- Long messages: ensure chat-log scrolls correctly, doesn't overflow
- Assistant bubble: remove progress steps after `done` (or keep as subtle completed indicators — grayed out, no pulse)
- If `pnpm test` has integration tests that POST to `/api/chat` HTTP — ensure those still work (keep HTTP endpoint alongside WS)
- Remove old inline styles that no longer apply to new HTML
- Verify: login → chat loads → WS connects (green dot) → message sent → bubbles work → action buttons work → clicking action sends message
- Run `pnpm test` — all pass

**Status**: pending

---

## Worker constraints

- Branch: `feature/chat-ui-replication` (create if not exists)  
- Commit all changes before DONE  
- `pnpm test` must be green before DONE  
- Do NOT touch: candidate-chatbot, hh-connector, any DB migrations, any V1 repos  
- Do NOT deploy  
- Source to read for visual reference: `/Users/vova/Documents/GitHub/recruiting-agent/web/app/page.tsx` and `web/app/globals.css`

---

## Progress log

| Iteration | Status | Worker | Notes |
|-----------|--------|--------|-------|
| 1 — WS skeleton | pending | — | — |
| 2 — Streaming adapter | pending | — | — |
| 3 — Frontend rewrite | pending | — | — |
| 4 — Polish | pending | — | — |
