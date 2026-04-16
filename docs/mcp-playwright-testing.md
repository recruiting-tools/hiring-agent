# MCP Playwright Testing Runbook

Дата: 2026-04-16
Статус: active

## Purpose

Этот runbook нужен для живой UI-проверки через MCP Playwright в агент-сессии.
Он закрывает тот случай, когда unit/integration smoke уже зелёные, но нужно руками
проверить auth, routing и поведение браузерного UI перед merge или deploy.

## When To Use MCP Playwright

Используйте MCP Playwright, когда нужно проверить:
- login flow и session cookie;
- browser-only регрессии: кнопки, селекты, websocket state, редиректы;
- связку нескольких экранов или сервисов после runtime/UI изменений;
- быстрый smoke после merge в sandbox или перед prod cutover.

Не используйте MCP Playwright как замену обычным тестам, если задача сводится к:
- чистой бизнес-логике playbook router/runtime;
- API shape, SQL migrations, idempotency, importer/send flows;
- deterministic moderation/report сценариям, которые проще прогнать скриптом.

В этих случаях сначала гоняем:
- `pnpm test`
- `pnpm test:sandbox`
- `pnpm smoke:hiring-agent:demo`
- `pnpm smoke:hiring-agent:sandbox`
- `node scripts/playwright-smoke.mjs`
- `node scripts/smoke-moderation-report.js`

## Credential Conventions

В git храним только имена env-переменных и шаблоны. Реальные пароли живут в:
- GitHub Environments secrets;
- локальном `.env.local`;
- shell env текущей сессии.

Базовый шаблон: `.env.sandbox.example`

### Hiring Agent Demo / Sandbox Login

Основной UI для MCP Playwright:
- URL: `https://<hiring-agent-host>/login`
- sandbox slots:
  - `https://<hiring-agent-host>/sandbox-001/login`
  - `https://<hiring-agent-host>/sandbox-002/login`
  - `https://<hiring-agent-host>/sandbox-003/login`

Основные env:
- `SANDBOX_DEMO_EMAIL`
- `SANDBOX_DEMO_PASSWORD`
- `PLAYWRIGHT_SMOKE_BASE_URL`
- `PLAYWRIGHT_SMOKE_EMAIL`
- `PLAYWRIGHT_SMOKE_PASSWORD`

GitHub Environment secrets для slot-ов:
- `HIRING_AGENT_SANDBOX_DEMO_EMAIL`
- `HIRING_AGENT_SANDBOX_DEMO_PASSWORD`

Проверить, что слот настроен:

```bash
gh secret list --env sandbox-3 | rg '^HIRING_AGENT_SANDBOX_DEMO_'
```

Если нужно обновить demo login для `hiring-agent`, canonical path:

```bash
pnpm bootstrap:demo-user
```

Не используйте для этого legacy path `pnpm bootstrap:recruiter-access`: он меняет
`chatbot.recruiters`, а не `management.recruiters`.

### Recruiter / Moderation Login

Для moderation UI и recruiter queue:
- URL: `https://<candidate-chatbot-host>/login`
- после логина редирект ведёт на `/recruiter/:token`

Обычные env:
- `RECRUITER_EMAIL`
- `RECRUITER_PASSWORD`
- `RECRUITER_TOKEN`

Локальные dev fallback-значения в скриптах:
- email: `recruiter@example.test`
- token: `rec-tok-demo-001`

Если нужен живой smoke moderation без ручного кликанья, сначала полезнее прогнать:

```bash
MODERATION_BASE_URL='https://<candidate-chatbot-host>' \
RECRUITER_EMAIL='<email>' \
RECRUITER_PASSWORD='<password>' \
RECRUITER_TOKEN='<token>' \
node scripts/smoke-moderation-report.js
```

## Recommended Smoke Scenarios

### 1. Hiring-Agent Chat / Playbook UI

Минимальный сценарий после изменений в chat UI, routing или playbook runtime:

1. Открыть `/login`.
2. Войти под sandbox demo account.
3. Дождаться, что websocket-индикатор показывает `Агент на связи`.
4. Выбрать вакансию в `#vacancy-select`.
5. Проверить один action-oriented flow:
   - `Настройте общение`
   - `Сгенерировать примеры общения`
   - или `agent_capabilities` / help surface для discovery
6. Убедиться, что в ответе нет `Вакансия не найдена`, `LLM не настроен`, `Ошибка`.

Это же покрывает `scripts/playwright-smoke.mjs`, поэтому для CI-подобного smoke сначала
проще запускать скрипт, а MCP Playwright использовать для ручной диагностики и соседних UI-правок.

### 2. Candidate-Chatbot Moderation Flow

Минимальный сценарий после изменений в moderation UI:

1. Открыть `/login` на `candidate-chatbot`.
2. Войти под recruiter account.
3. Проверить, что открывается moderation page, а не повторный redirect на `/login`.
4. Открыть очередь `/recruiter/:token/queue`.
5. Если есть элементы:
   - проверить job title / candidate preview;
   - нажать `block` или `send-now` только в sandbox/dev;
   - убедиться, что UI и queue JSON согласованы.
6. Если очередь пустая, не фабрикуйте данные вручную через браузер; используйте
   `scripts/smoke-moderation-report.js --run-webhook ...` или seed/runtime path.

### 3. Vacancy / Communication Report Flow

Сценарий полезен после изменений вокруг vacancy selection, communication plan или examples:

1. Пройти login в `hiring-agent`.
2. Выбрать вакансию.
3. Сгенерировать communication plan.
4. Сгенерировать conversation examples.
5. Проверить, что открывается report path
   `chat/communication-examples?job_id=...`
6. Убедиться, что в отчёте есть vacancy title, updated timestamp и контент примеров.

## MCP Playwright Session Workflow

Рекомендуемый порядок в живой сессии:

1. Подготовить env и target URL.
2. Сначала прогнать deterministic smoke-скрипт, если он уже есть.
3. Потом открыть MCP Playwright на том же URL для ручной проверки конкретного UI-path.
4. Логин делать через реальные поля формы, а не через прямую подмену cookie.
5. После логина опираться на устойчивые признаки:
   - `#vacancy-select`
   - `#connection-label`
   - видимые кнопки с русскими CTA
   - redirect off `/login`
6. Для flaky async UI использовать wait на текст/состояние, а не произвольные sleep.

Практические правила:
- не хранить пароли в prompt или в markdown;
- не пытаться через MCP Playwright создавать сложные тестовые данные, если для этого уже есть CLI/script path;
- если менялись только API/SQL слои, ограничиться unit/integration/smoke без браузера;
- если в PR несколько соседних UI/runtime изменений, фиксировать в PR comment, какой именно smoke path был проверен вручную.

## Entry Points And Short Commands

```bash
# chat smoke script
PLAYWRIGHT_SMOKE_BASE_URL='https://<hiring-agent-host>' \
PLAYWRIGHT_SMOKE_EMAIL='<email>' \
PLAYWRIGHT_SMOKE_PASSWORD='<password>' \
node scripts/playwright-smoke.mjs
```

```bash
# moderation smoke/report
MODERATION_BASE_URL='https://<candidate-chatbot-host>' \
RECRUITER_EMAIL='<email>' \
RECRUITER_PASSWORD='<password>' \
RECRUITER_TOKEN='<token>' \
node scripts/smoke-moderation-report.js --action inspect
```

## Related Docs

- `README.md`
- `docs/hiring-agent-chat-smoke-runbook.md`
- `docs/release-process.md`
- `scripts/playwright-smoke.mjs`
- `scripts/smoke-moderation-report.js`
