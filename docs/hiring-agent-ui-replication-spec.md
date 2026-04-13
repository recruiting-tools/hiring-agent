# Hiring-Agent UI Replication Spec

**Goal**: Replicate recruiter-agent chat UI 1:1 in hiring-agent service.  
**Source**: `/Users/vova/Documents/GitHub/recruiting-agent/web/app/page.tsx` + globals.css  
**Target**: `services/hiring-agent/src/http-server.js` (rewrite embedded HTML + add WS)  
**Approach**: Keep Express.js backend. Replace monolithic `CHAT_HTML` with a modern dark-mode vanilla JS SPA that matches recruiter-agent visually and functionally.

---

## Why vanilla JS (not Next.js)

The hiring-agent is a lean Express.js service deployed via PM2 on a GCP VM. Adding Next.js would require a build step in CI/deploy and a separate process. Vanilla JS with the same CSS variables produces identical visual output without that overhead. All recruiter-agent UI features can be reproduced in plain HTML/CSS/JS.

---

## Visual Design — exact copy from recruiter-agent

### Color tokens (CSS variables)

```css
:root {
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --color-bg:    #080a0f;   /* page background */
  --color-bg2:   #0e1118;   /* card/panel backgrounds */
  --color-bg3:   #161b26;   /* input, hover backgrounds */
  --color-edge:  #1e2535;   /* borders */
  --color-t1:    #e4e8f0;   /* primary text */
  --color-t2:    #8892a4;   /* secondary text */
  --color-t3:    #4a5268;   /* tertiary / placeholder */
  --color-accent:#4f8ff7;   /* primary CTA blue */
  --color-accent-dim: rgba(79,143,247,0.12); /* hover bg for buttons/rows */
  --color-green: #34c759;
  --color-red:   #ef4444;
}
```

Font: load from Google Fonts — `Plus Jakarta Sans` (400, 500, 600).

### Layout

```
┌─────────────────────────────────────────────────┐
│ HEADER: logo + title + connection status dot     │
├─────────────────────────────────────────────────┤
│                                                  │
│  CHAT MESSAGES (flex-col, scrollable, flex-1)   │
│  ┌─────────────────────────────────────────┐    │
│  │ [assistant bubble] text + optional dots │    │
│  │                    [action btn] [btn]   │    │
│  │                        [user bubble]   →│    │
│  └─────────────────────────────────────────┘    │
│                                                  │
├─────────────────────────────────────────────────┤
│ INPUT AREA: textarea + send button               │
└─────────────────────────────────────────────────┘
```

Full-height viewport, no split artifact panel (hiring-agent has no artifacts right now — can add later).

---

## Message Bubble Design

### User message
- Right-aligned
- Background: `var(--color-accent)` blue
- Text: white
- Rounded: `12px 12px 2px 12px`
- Max-width: 75%

### Assistant message
- Left-aligned
- Background: `var(--color-bg2)`
- Border: 1px `var(--color-edge)`
- Text: `var(--color-t1)`
- Rounded: `12px 12px 12px 2px`
- Max-width: 75%
- Markdown rendered (bold, lists, code blocks)

### Progress steps (while bot is thinking)
```
● search_candidates   ← animated pulse dot + tool name
● generate_reply
```
Each step = one line, dot pulses until step completes (or step gets added). Shown inside the assistant bubble while streaming.

### Action buttons
Rendered below assistant message content:
```
[  Show Dashboard  ]  [  Export CSV  ]  [  New Search  ]
```
- `px-3 py-1.5 text-xs rounded-lg`
- Background: `var(--color-bg3)`, border: `var(--color-edge)`
- Hover: `var(--color-accent-dim)` bg + `var(--color-accent)` border + lighter text
- Click → sends button label as user message (bot answers as to any message)

### Streaming cursor
While bot is typing: `▋` blinking cursor at end of text.

---

## WebSocket Protocol

Replace current HTTP POST `/api/chat` with WebSocket at `/ws`.

### Client → Server

```json
{ "type": "message", "text": "покажи воронку" }
```

### Server → Client (streaming sequence)

```json
{ "type": "progress", "tool": "fetch_funnel" }
{ "type": "progress", "tool": "generate_reply" }
{ "type": "chunk", "text": "Вот воронка по вакансии:\n" }
{ "type": "chunk", "text": "...(more text)..." }
{ "type": "done", "actions": [
    { "label": "Другая вакансия", "message": "покажи список вакансий" },
    { "label": "Детали кандидата", "message": "расскажи подробнее" }
  ]
}
```

On error:
```json
{ "type": "error", "message": "Что-то пошло не так" }
```

### Auth via cookie (not WS query string)
Session cookie already set by `/auth/login`. WS upgrade request carries the cookie automatically — validate session on WS connection.

### Heartbeat
Server pings every 30s. Client responds to pong. Dead connections terminated.

---

## Backend Changes (http-server.js)

### 1. Add `ws` package WebSocket server

```js
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ server: httpServer });
```

### 2. WebSocket connection handler

```js
wss.on('connection', (ws, req) => {
  // 1. Validate session cookie
  const session = parseSessionFromCookie(req.headers.cookie);
  if (!session) { ws.close(4001, 'Unauthorized'); return; }

  // 2. Keep-alive ping/pong
  let alive = true;
  ws.on('pong', () => { alive = true; });

  // 3. Handle incoming messages
  ws.on('message', async (raw) => {
    const { type, text } = JSON.parse(raw);
    if (type !== 'message') return;

    // Stream response
    await handleChatMessage({ ws, text, session });
  });
});
```

### 3. handleChatMessage — streaming adapter

```js
async function handleChatMessage({ ws, text, session }) {
  const send = (obj) => ws.send(JSON.stringify(obj));

  // Progress: playbook routing
  send({ type: 'progress', tool: 'route_playbook' });

  // Route to existing playbook
  const reply = await postChatMessage({ text, recruiterId: session.recruiterId, jobId: session.jobId });

  // Convert existing reply kinds to streaming format
  if (reply.kind === 'render_funnel') {
    send({ type: 'progress', tool: 'render_funnel' });
    send({ type: 'chunk', text: reply.markdown }); // render_funnel should produce markdown
    send({ type: 'done', actions: reply.actions || [] });
  } else if (reply.kind === 'fallback_text') {
    send({ type: 'chunk', text: reply.text });
    send({ type: 'done', actions: [] });
  } else {
    send({ type: 'chunk', text: renderReplyAsMarkdown(reply) });
    send({ type: 'done', actions: reply.actions || [] });
  }
}
```

### 4. Keep old HTTP `/api/chat` for backward compat (or remove if no tests depend on it)

Check: `tests/integration/hiring-agent.test.js` — if it tests `/api/chat` HTTP endpoint, keep it alive alongside WS.

### 5. Add renderReplyAsMarkdown helper

Existing `renderReply()` returns HTML for embedding in template. Need a parallel `renderReplyAsMarkdown(reply)` that returns markdown string for streaming via WS.

For `render_funnel`: format table as markdown table.
For `playbook_locked`: return `> ⚠️ ${reply.message}` blockquote.
For `fallback_text`: return reply text as-is.

### 6. Playbooks — add `actions` field to reply objects

Each playbook can now return optional `actions: [{label, message}]` in its reply. Example:

```js
// candidate-funnel.js
return {
  kind: 'render_funnel',
  markdown: funnelMarkdown,
  actions: [
    { label: 'Сменить вакансию', message: 'покажи список вакансий' },
    { label: 'Подробности кандидата', message: 'расскажи подробнее о первом кандидате' },
  ]
};
```

---

## Frontend — complete rewrite of CHAT_HTML

The embedded HTML constant in http-server.js gets replaced with a full dark-mode SPA. Structure:

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Hiring Agent</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>/* CSS variables + layout (see design tokens above) */</style>
</head>
<body>
  <!-- Header -->
  <header id="header">
    <span class="logo">Hiring Agent</span>
    <span id="status-dot" class="dot dot-red"></span>
  </header>

  <!-- Chat messages -->
  <main id="chat-log"></main>

  <!-- Input area -->
  <footer id="input-area">
    <textarea id="msg-input" placeholder="Напишите сообщение..." rows="1"></textarea>
    <button id="send-btn">→</button>
  </footer>

  <script>/* WebSocket client + message rendering */</script>
</body>
</html>
```

### JS Client responsibilities

1. **Connect WebSocket** at `ws[s]://host/ws` on page load
2. **Connection status dot**: green = connected, red = disconnected
3. **Send message**: on Enter or send button click → `{type:"message", text}`
4. **Render user bubble** immediately on send
5. **Render assistant bubble** with empty content + `streaming: true` 
6. **On `progress`**: add progress line inside assistant bubble (pulsing dot + tool name)
7. **On `chunk`**: append text to assistant bubble (render markdown)
8. **On `done`**: mark streaming complete, render action buttons
9. **Action button click**: treat as new user message — send `{type:"message", text: action.message}`
10. **Auto-scroll** chat log to bottom on new messages
11. **Textarea auto-height**: expand up to 160px as user types
12. **Disable send** while bot is streaming

### Markdown rendering
Use [marked.js](https://cdn.jsdelivr.net/npm/marked/marked.min.js) from CDN. Render `**bold**`, lists, tables, code blocks. Sanitize with [DOMPurify](https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js).

### Message history
Keep in memory (JS array). Reload page = fresh session. (History sidebar is out of scope for now.)

---

## Job selector

Current UI has a `<select id="jobSelect">` dropdown to pick the active vacancy. Keep this, but move it to the header area (next to logo). Style it to match dark theme.

```html
<select id="job-select">
  <option value="">Загрузка вакансий...</option>
</select>
```

Populated via `GET /api/jobs` on page load (already implemented). Selected job ID sent with each WS message:

```json
{ "type": "message", "text": "покажи воронку", "jobId": "job-123" }
```

---

## Authentication

No changes. Login page (`LOGIN_HTML`) stays as-is — user logs in, gets session cookie, then `/` serves new chat UI.

The only addition: on WS upgrade, validate the session cookie. Already have session validation in middleware — reuse it.

---

## What stays the same

- Login page HTML/CSS (can keep warm-beige aesthetic there, or later unify)
- All playbook logic (router.js, candidate-funnel.js, registry.js)
- All queries (funnel-query.js, funnel-adapter.js)
- All tests in tests/integration/ (they test HTTP endpoints, not the UI)
- Auth logic (auth.js)
- Health endpoint
- PM2 + deploy process

---

## Files to change

| File | Change |
|------|--------|
| `services/hiring-agent/src/http-server.js` | Rewrite `CHAT_HTML`, add WS server, add `handleChatMessage`, add `renderReplyAsMarkdown` |
| `services/hiring-agent/src/app.js` | No changes needed (existing `postChatMessage` used as-is) |
| `services/hiring-agent/src/playbooks/candidate-funnel.js` | Add `actions` array + `markdown` field to reply object |
| `services/hiring-agent/src/playbooks/router.js` | Pass through `actions` from playbook replies |
| `package.json` (root or service) | Ensure `ws` package is installed |

---

## Files NOT to change

- Any V1 repos (recruiting-agent, recruiter-mcp, etc.) — read-only
- candidate-chatbot service
- hh-connector service  
- Any DB migrations or schema
- Tests (keep all passing)

---

## Out of scope (phase 2)

- Artifact panel (right-side HTML reports) — not used in hiring-agent yet
- History sidebar (conversation list)
- Brain panel (system prompt viewer)
- File upload
- Dark/light mode toggle
- Mobile responsive optimizations beyond basic

---

## Success criteria

1. `pnpm test` still green (all existing tests pass)
2. Login page works, session set
3. Chat loads with dark-mode UI
4. User types message → sees blue bubble immediately
5. Bot responds: progress dots appear during thinking → text streams in → action buttons appear at end
6. Clicking action button → sends as user message → bot responds again
7. Job selector in header, works as before
8. Connection status dot shows green when WS connected
9. PM2 restart still works (`pm2 restart hiring-agent --update-env`)

---

## Implementation order (suggested for Codex)

1. Install `ws` package if not present
2. Add WS server to http-server.js (alongside existing HTTP)
3. Implement `renderReplyAsMarkdown` for existing reply kinds
4. Add `actions` to candidate-funnel.js reply
5. Implement `handleChatMessage` streaming function
6. Rewrite `CHAT_HTML` with new dark-mode SPA
7. Run `pnpm test` — fix any breakage
8. Manual smoke: login → send message → see streaming + buttons
