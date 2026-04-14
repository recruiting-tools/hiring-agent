# Hiring Agent Chat Smoke Runbook

Дата: 2026-04-15  
Статус: active

## Purpose

Этот runbook описывает стандартный smoke-прогон чата `hiring-agent` для новых сессий и CI.

Цель smoke:
- быстро поймать поломки API/WS контракта;
- убедиться, что базовые элементы фронта в demo доступны;
- проверить, что ключевые playbook-вызовы на sandbox возвращают неполоманный ответ.

## Where It Runs

- Локально: вручную из репозитория.
- CI: workflow `Sandbox Release Gate` (`.github/workflows/sandbox-release-gate.yml`), job `gate`.

## Commands

1. Demo level:
```bash
pnpm smoke:hiring-agent:demo
```

2. Sandbox level:
```bash
SANDBOX_URL='https://<sandbox-host>' \
SANDBOX_DEMO_EMAIL='<email>' \
SANDBOX_DEMO_PASSWORD='<password>' \
pnpm smoke:hiring-agent:sandbox
```

3. Both levels:
```bash
SANDBOX_URL='https://<sandbox-host>' \
SANDBOX_DEMO_EMAIL='<email>' \
SANDBOX_DEMO_PASSWORD='<password>' \
pnpm smoke:hiring-agent:both
```

## What Is Tested And Why

### Demo level (`--level demo`)

1. `GET /health`  
Проверяет, что сервис поднялся в `stateless-demo`.

2. `POST /auth/login`  
Проверяет базовый auth contract и выдачу `session` cookie.

3. `GET /chat`  
Проверяет, что основной shell фронта грузится и содержит главные кнопки:
- `send-btn` с `title="Отправить"`
- `logout-btn` с текстом `Выйти`

4. `WS /ws` message  
Отправляет тестовую фразу и ждёт `done.actions`; проверяется, что приходит action-кнопка:
- `label: "Обновить"`
- `message: "обнови воронку"`

Это гарантирует, что “главная кнопка действия” (которую рендерит фронт) приходит с валидным payload.

5. `POST /api/chat`  
Проверяет JSON-контракт ответа (`reply.kind` + `artifact.id`).

6. `GET /api/artifacts/:id`  
Проверяет, что артефакт сохраняется и читается.

7. Ошибочные контракты:
- bad JSON -> `400 {"error":"invalid_json"}`
- без cookie -> `401 {"error":"unauthorized"}`

### Sandbox level (`--level sandbox`)

1. `GET /health`  
Проверка доступности окружения.

2. `POST /auth/login`  
Проверка реального логина sandbox-рекрутера.

3. `GET /api/jobs`  
Проверка tenant-контекста и загрузки вакансий.

4. `POST /api/chat` (funnel сценарий)  
Проверка, что ключевой сценарий чата возвращает валидный `reply.kind` и `artifact.id`.

5. `POST /api/chat` (`start_playbook`, `create_vacancy`)  
Проверка, что runtime ключевого playbook вызова отвечает неполоманным payload.

6. `GET /api/artifacts/:id`  
Проверка чтения сохраненного артефакта.

## Test Payloads (Current Canonical)

В smoke используются фиксированные payload:

1. Funnel trigger:
```json
{"message":"Визуализируй воронку по кандидатам"}
```

2. Playbook trigger:
```json
{
  "action":"start_playbook",
  "playbook_key":"create_vacancy",
  "message":"Тестовая вакансия: backend node.js"
}
```

Эти строки безопасны (без PII) и должны оставаться стабильными для сравнений между сессиями.

## Success Criteria

Smoke считается успешным, когда:
- обязательные HTTP/WS шаги возвращают ожидаемые коды;
- для основных chat-вызовов есть `reply.kind` (string);
- есть `artifact.id` и артефакт читается;
- для demo WS-сценария приходит action-кнопка `Обновить`.

## CI Integration

CI запуск подключен в:
- `.github/workflows/sandbox-release-gate.yml`

Шаг запускается при наличии secrets:
- `HIRING_AGENT_SANDBOX_URL`
- `HIRING_AGENT_SANDBOX_DEMO_EMAIL`
- `HIRING_AGENT_SANDBOX_DEMO_PASSWORD`

Если secrets отсутствуют, шаг помечается `skip` (gate не падает).

## GitHub Actions Logs

Скрипт печатает явные шаги в формате:
- `[smoke:demo] ...`
- `[smoke:sandbox] ...`

В логах видны:
- endpoint/операция;
- отправляемый тестовый `message` (без паролей);
- итоговый `[OK]` или причина падения.

Источник логики:
- `scripts/smoke-hiring-agent-chat.js`

## Fast Troubleshooting

1. `sandbox level requires --base-url`  
Не задан `SANDBOX_URL`/`HIRING_AGENT_SANDBOX_URL`.

2. `login should return session cookie`  
Проблема auth sandbox-пользователя или неправильный пароль.

3. `missing reply.kind` / `missing artifact.id`  
Регрессия chat-контракта, смотреть изменения в `services/hiring-agent/src/app.js` и `src/http-server.js`.

4. `websocket unauthorized (4001)`  
Проблема cookie/auth в WS-контуре.

## References

- `scripts/smoke-hiring-agent-chat.js`
- `.github/workflows/sandbox-release-gate.yml`
- `README.md` (раздел `Chat Smoke (2 levels)`)
