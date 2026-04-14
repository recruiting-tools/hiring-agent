# ТЗ: Hiring Agent — Frontend

**Статус:** готово к имплементации  
**Данные:** строится поверх data model из PR #29 (playbook_definitions, playbook_steps, playbook_sessions, vacancies)  
**Подход:** vanilla JS SPA, встроенный в Express (CHAT_HTML constant), markdown → HTML через marked.js  
**Стиль:** тёмный UI, цветовые токены из recruiter-agent (см. ниже)

---

## 1. Принципы

### Вакансия — это модальность

Вакансия — не шаг плейбука, а контекст всей сессии работы рекрутера. Два состояния UI:

| Состояние | Что видит рекрутер |
|---|---|
| **Нет вакансии** | Empty state с двумя действиями: выбрать из списка или создать новую |
| **Вакансия выбрана** | Полный чат, заголовок вакансии в хедере, доступны все плейбуки |

Переключение вакансии в хедере сбрасывает текущий чат (новая сессия).

### Плейбуки — стандартные, предсказуемые

5 плейбуков из seed, всегда одинаковые. Шаги детерминированы в БД → агент знает заранее что будет делать и анонсирует каждый шаг.

### Markdown → HTML

Все ответы агента рендерятся как markdown → HTML через marked.js + DOMPurify. Никаких шаблонов на стороне сервера — только сырой markdown в `chunk` событиях.

### WebSocket, streaming

Каждый ответ агента стримится чанк-по-чанку. Рекрутер видит текст как он появляется, прогресс-шаги до текста, кнопки после.

---

## 2. Дизайн-токены

Точная копия recruiter-agent (`web/app/globals.css`):

```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap');

:root {
  --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;

  /* backgrounds */
  --color-bg:    #080a0f;   /* страница */
  --color-bg2:   #0e1118;   /* карточки, панели */
  --color-bg3:   #161b26;   /* инпут, ховер */

  /* borders */
  --color-edge:  #1e2535;

  /* text */
  --color-t1:    #e4e8f0;   /* основной */
  --color-t2:    #8892a4;   /* вторичный */
  --color-t3:    #4a5268;   /* плейсхолдер */

  /* accent */
  --color-accent:     #4f8ff7;
  --color-accent-dim: rgba(79,143,247,0.12);

  /* status */
  --color-green: #34c759;
  --color-red:   #ef4444;
  --color-orange: #f5a623;
}
```

---

## 3. Макет (Layout)

```
┌──────────────────────────────────────────────────────────┐
│ HEADER                                                    │
│  [•] Hiring Agent    [── выбор вакансии ──▾]  [Выйти]   │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  CHAT LOG (flex-col, overflow-y: auto, flex: 1)          │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ если нет вакансии: EMPTY STATE                      │ │
│  │ если есть: ПРИВЕТСТВЕННОЕ СООБЩЕНИЕ + ПЛЕЙБУКИ      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
├──────────────────────────────────────────────────────────┤
│ INPUT AREA                                                │
│  [textarea ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] [→] │
└──────────────────────────────────────────────────────────┘
```

**CSS:**
```css
body {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
  font-family: var(--font-sans);
  color: var(--color-t1);
}

header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  height: 56px;
  border-bottom: 1px solid var(--color-edge);
  flex-shrink: 0;
}

#chat-log {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

#input-area {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--color-edge);
  flex-shrink: 0;
}
```

---

## 4. Хедер

```
[●] Hiring Agent   [──── Плиточник / Москва ────▾]   [Выйти]
```

| Элемент | Описание |
|---|---|
| `●` | Connection dot: зелёный = WS connected, красный = disconnected |
| `Hiring Agent` | Лого/название, не кликабельное |
| Vacancy select | `<select>` загружается из `GET /api/vacancies`. Когда нет вакансий — опция «Нет вакансий». Отдельная опция «+ Создать вакансию» в конце списка. |
| Выйти | `<a href="/logout">` |

### Vacancy selector поведение

- Загружается при старте через `GET /api/vacancies`
- Выбранная вакансия хранится в памяти (`selectedVacancyId`)
- При смене вакансии: сбросить чат, отправить WS-событие `{type: "vacancy_changed", vacancyId}` или просто закрыть/переоткрыть WS
- Если выбрана «+ Создать вакансию» → автоматически отправить в чат: `{type: "message", text: "создать вакансию", vacancyId: null}`

---

## 5. Empty State (нет вакансии)

Показывается когда `selectedVacancyId = null` и список вакансий пустой (или ещё не загружен).

```html
<div class="empty-state">
  <div class="empty-icon">📋</div>
  <h2>Выберите вакансию</h2>
  <p>Выберите вакансию в меню выше или создайте новую</p>
  <button class="btn-primary" id="create-vacancy-btn">
    Создать вакансию
  </button>
</div>
```

Клик на кнопку = тот же эффект что «+ Создать вакансию» в селекторе.

---

## 6. Приветственное сообщение + плейбуки

Когда вакансия выбрана, при старте чата агент показывает:

```
Привет! Работаю с вакансией **Плиточник / Москва**.

Что будем делать?
```

И сразу под текстом — кнопки-плейбуки (как action buttons):

```
[Настрой общение]  [Посмотреть вакансию]  [Воронка]  [Рассылка]
```

Это **не** запрос к серверу — генерируется на клиенте при выборе вакансии. Список плейбуков загружается из `GET /api/playbooks` (возвращает definitions с `status: "available"`).

Если вакансия не выбрана, вместо кнопок плейбуков — кнопка «Создать вакансию» (единственный плейбук без вакансии).

---

## 7. Пузыри сообщений

### Пузырь пользователя (user bubble)

```html
<div class="msg-row user">
  <div class="bubble user-bubble">текст сообщения</div>
</div>
```

```css
.msg-row { display: flex; }
.msg-row.user { justify-content: flex-end; }
.msg-row.assistant { justify-content: flex-start; }

.bubble {
  max-width: 75%;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.5;
}

.user-bubble {
  background: var(--color-accent);
  color: white;
  border-radius: 12px 12px 2px 12px;
}
```

### Пузырь агента (assistant bubble)

```html
<div class="msg-row assistant">
  <div class="bubble assistant-bubble">
    <div class="progress-steps" id="ps-{id}"></div>  <!-- появляются во время работы -->
    <div class="bubble-content" id="bc-{id}"></div>   <!-- markdown сюда -->
    <div class="actions" id="ac-{id}"></div>           <!-- кнопки после done -->
  </div>
</div>
```

```css
.assistant-bubble {
  background: var(--color-bg2);
  border: 1px solid var(--color-edge);
  color: var(--color-t1);
  border-radius: 12px 12px 12px 2px;
}

/* Streaming cursor */
.assistant-bubble.streaming .bubble-content::after {
  content: '▋';
  animation: blink 1s step-end infinite;
  color: var(--color-accent);
}

@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
```

---

## 8. Progress steps

Пока агент думает — внутри пузыря агента появляются строки прогресса. Каждый `progress` WS-event = новая строка.

```html
<div class="progress-steps">
  <div class="progress-step done">
    <span class="step-dot"></span>
    <span>Загружаю данные вакансии</span>
  </div>
  <div class="progress-step active">
    <span class="step-dot pulse"></span>
    <span>Извлекаю обязательные требования</span>
  </div>
</div>
```

```css
.progress-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-t2);
  padding: 2px 0;
}

.step-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-t3);
  flex-shrink: 0;
}

.progress-step.active .step-dot {
  background: var(--color-accent);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.progress-step.done .step-dot {
  background: var(--color-green);
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}
```

На `done` event: последний шаг помечается `done`, анимация останавливается.

### Человекочитаемые названия прогресс-шагов

Маппинг `tool → label` на клиенте:

```js
const STEP_LABELS = {
  'auto_fetch':       'Загружаю данные вакансии',
  'route_playbook':   'Определяю плейбук',
  'llm_extract':      'Извлекаю данные',
  'llm_generate':     'Генерирую текст',
  'data_fetch':       'Запрашиваю данные',
  'decision':         'Проверяю условия',
  // step names come from DB:
  // progress event can carry { tool, label } where label = step.name
};
```

Если `progress` event содержит `label` — показывать его. Иначе — маппинг по `tool`.

---

## 9. Action buttons

После `done` event агент может вернуть `actions: [{label, message}]`. Рендерятся под контентом пузыря:

```html
<div class="actions">
  <button class="action-btn" data-msg="утвердить">Утвердить</button>
  <button class="action-btn" data-msg="уточнить">Уточнить</button>
</div>
```

```css
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-edge);
}

.action-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-family: var(--font-sans);
  border-radius: 8px;
  border: 1px solid var(--color-edge);
  background: var(--color-bg3);
  color: var(--color-t2);
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover {
  background: var(--color-accent-dim);
  border-color: var(--color-accent);
  color: var(--color-t1);
}
```

Клик по кнопке = `sendMessage(button.dataset.msg)`. Кнопки скрываются после выбора (или остаются — на усмотрение).

---

## 10. Инпут

```html
<textarea
  id="msg-input"
  placeholder="Напишите сообщение..."
  rows="1"
></textarea>
<button id="send-btn" disabled>
  <svg><!-- стрелка вправо --></svg>
</button>
```

```css
#msg-input {
  flex: 1;
  resize: none;
  background: var(--color-bg3);
  border: 1px solid var(--color-edge);
  border-radius: 10px;
  padding: 10px 14px;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--color-t1);
  max-height: 160px;
  overflow-y: auto;
  outline: none;
}

#msg-input::placeholder { color: var(--color-t3); }
#msg-input:focus { border-color: var(--color-accent); }

#send-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--color-accent);
  border: none;
  cursor: pointer;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

#send-btn:disabled { opacity: 0.4; cursor: default; }
```

**Поведение:**
- Auto-height textarea: `scrollHeight` до 160px
- Enter → отправить; Shift+Enter → новая строка
- Отключить кнопку и textarea во время streaming
- Отключить если нет WS-соединения

---

## 11. WebSocket протокол

### Client → Server

```ts
// Обычное сообщение
{ type: "message", text: string, vacancyId: string | null }

// Выбор вакансии (сброс контекста)
{ type: "vacancy_changed", vacancyId: string | null }
```

### Server → Client

```ts
// Прогресс шаг (один или несколько до начала текста)
{ type: "progress", tool: string, label?: string }

// Чанк текста (markdown)
{ type: "chunk", text: string }

// Завершение ответа
{ type: "done", actions?: Array<{ label: string, message: string }> }

// Ошибка
{ type: "error", message: string }

// Конфигурация при подключении
{ type: "session", playbookSessionId?: string }
```

### Пример полного обмена для `setup_communication`:

```
→ { type: "message", text: "настрой общение", vacancyId: "vac-123" }

← { type: "progress", tool: "auto_fetch", label: "Загружаю данные вакансии" }
← { type: "progress", tool: "llm_generate", label: "Составляю варианты плана коммуникации" }
← { type: "chunk", text: "## Варианты плана коммуникации\n\n" }
← { type: "chunk", text: "**Вариант 1** — последовательный скрининг\n..." }
← { type: "done", actions: [
    { label: "Утвердить вариант 1", message: "утвердить вариант 1" },
    { label: "Уточнить", message: "хочу уточнить" },
    { label: "Вариант 2", message: "покажи вариант 2" }
  ]
}
```

---

## 12. API endpoints (нужны от бэкенда)

| Метод | URL | Ответ |
|---|---|---|
| `GET` | `/api/vacancies` | `[{ vacancyId, title, status }]` — только active + draft |
| `GET` | `/api/playbooks` | `[{ playbook_key, name, trigger_description, status }]` — only available |
| `WS` | `/ws` | Streaming chat (auth через session cookie) |
| `GET` | `/health` | Существующий |
| `GET` | `/` | CHAT_HTML |
| `GET /POST` | `/auth/login`, `/logout` | Существующие |

---

## 13. Бэкенд: handleChatMessage

Когда WS получает `{type: "message", text, vacancyId}`, бэкенд должен:

1. Определить плейбук по тексту сообщения (паттерн-матчинг по `keywords` из `playbook_definitions`)
2. Загрузить шаги плейбука из `playbook_steps`
3. Для каждого шага:
   - Отправить `{type: "progress", tool: step.step_type, label: step.name}`
   - Выполнить шаг согласно `step_type`:
     - `auto_fetch` → SQL-запрос, нет UI
     - `llm_extract` → вызов LLM, результат в context
     - `llm_generate` → вызов LLM, stream чанки
     - `display` → стримить `user_message` (с подстановкой из context)
     - `buttons` → отправить в `done.actions`
     - `user_input` → стримить `user_message`, ждать следующего WS-сообщения
4. По завершении — `{type: "done", actions}`

**Пока LLM не подключён** (ранние итерации): для `llm_extract` / `llm_generate` шагов — заглушка со стримингом текста "🔧 [LLM-шаг: {step.name} — промпт будет добавлен позже]".

---

## 14. E2E тесты плейбуков

**Принцип:** дать агенту текстовый вопрос → проверить что ответ соответствует ожидаемому плейбуку.

**Структура теста:**

```js
// tests/e2e/playbook-routing.test.js

describe('Playbook routing', () => {
  test('triggers candidate_funnel', async () => {
    const reply = await chatMessage('покажи воронку', vacancyId);
    expect(reply.playbookKey).toBe('candidate_funnel');
    expect(reply.progressSteps).toContain('auto_fetch');
    expect(reply.text).toMatch(/воронка/i);
  });

  test('triggers create_vacancy', async () => {
    const reply = await chatMessage('создать новую вакансию', null);
    expect(reply.playbookKey).toBe('create_vacancy');
    // First step is user_input
    expect(reply.text).toContain('Загрузите материалы');
  });

  test('triggers view_vacancy', async () => {
    const reply = await chatMessage('посмотри вакансию', vacancyId);
    expect(reply.playbookKey).toBe('view_vacancy');
    expect(reply.text).toMatch(/данные.+вакансии/i);
  });

  test('triggers setup_communication', async () => {
    const reply = await chatMessage('настрой общение с кандидатами', vacancyId);
    expect(reply.playbookKey).toBe('setup_communication');
  });

  test('triggers mass_broadcast', async () => {
    const reply = await chatMessage('сделай рассылку по кандидатам', vacancyId);
    expect(reply.playbookKey).toBe('mass_broadcast');
  });

  test('fallback when no vacancy and non-create query', async () => {
    const reply = await chatMessage('покажи воронку', null); // no vacancy
    expect(reply.text).toContain('выберите вакансию');
    expect(reply.actions).toContainEqual(
      expect.objectContaining({ label: 'Выбрать вакансию' })
    );
  });
});
```

**Тест шагов плейбука:**

```js
// tests/e2e/playbook-steps.test.js

describe('create_vacancy steps', () => {
  test('step 1: asks for vacancy materials', async () => {
    const session = await startPlaybook('create_vacancy', null);
    const { text, awaitingInput } = session.currentStep;
    expect(text).toContain('Загрузите материалы');
    expect(awaitingInput).toBe(true);
  });

  test('step 2: extracts must_haves from raw text', async () => {
    const session = await startPlaybook('create_vacancy', null);
    await session.reply('Ищем плиточника. Опыт от 1 года обязателен. Свой инструмент. Оплата 4000 за смену.');
    const result = session.context.must_haves;
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});
```

**Helper `chatMessage(text, vacancyId)`:**

```js
async function chatMessage(text, vacancyId) {
  // POST /api/chat-test (тестовый endpoint без WS)
  const res = await fetch('http://localhost:3101/api/chat-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
    body: JSON.stringify({ text, vacancyId })
  });
  return res.json();
  // { playbookKey, progressSteps, text, actions }
}
```

Тестовый endpoint `/api/chat-test` — только в `NODE_ENV=test`, отдаёт синхронный JSON вместо WS-стрима.

---

## 15. Порядок имплементации

### Фаза 1 — скелет UI (без бэкенда)

1. Переписать `CHAT_HTML` с новым дизайном (CSS токены, layout, пузыри, инпут)
2. Мок WS: тест что пузыри, прогресс-шаги и кнопки рендерятся корректно
3. Vacancy selector: загрузка из API, empty state, приветствие с плейбуками

### Фаза 2 — WS + бэкенд

4. WS сервер на Express: auth из cookie, heartbeat
5. `handleChatMessage`: роутинг по keywords, прогресс-события, заглушки для LLM-шагов
6. `GET /api/vacancies` и `GET /api/playbooks`
7. E2E тесты routing

### Фаза 3 — реальные шаги плейбука

8. `auto_fetch`: SQL-запрос вакансии
9. `display` + `buttons`: рендер user_message с подстановкой context, actions
10. `user_input`: ожидание следующего WS-сообщения
11. `candidate_funnel` data_fetch + render как markdown-таблица
12. E2E тесты шагов

### Фаза 4 — LLM шаги

13. `llm_extract` + `llm_generate` с реальными промптами из DB
14. Streaming LLM output через чанки
15. E2E тесты полных флоу

---

## 16. Что НЕ входит в эту фазу

- История разговоров (боковая панель с прошлыми сессиями)
- Brain panel (просмотр промптов/плейбуков)
- File upload
- Dark/light mode переключатель
- Mobile-first адаптивность (базовый минимум достаточен)
- Параллельные сессии (один рекрутер = одна активная сессия)
