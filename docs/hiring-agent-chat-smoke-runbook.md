# Hiring Agent Chat Smoke Runbook

Дата: 2026-04-15  
Статус: active

## Purpose

Актуальный smoke для чата `hiring-agent` в этом репозитории.

Цели:
- быстро поймать регрессии в маршрутизации playbook и форматах ответов;
- проверить базовую работоспособность API/WS контракта;
- отдельно проверить e2e UI-путь на проде.

## Current Smoke Entry Points

1. Интеграционный smoke контракта чата:
```bash
node --test tests/integration/hiring-agent.test.js
```

2. E2E smoke через браузер:
```bash
PLAYWRIGHT_SMOKE_BASE_URL="https://<hiring-agent-host>" \
PLAYWRIGHT_SMOKE_EMAIL="<email>" \
PLAYWRIGHT_SMOKE_PASSWORD="<password>" \
node scripts/playwright-smoke.mjs
```

Важно:
- `scripts/playwright-smoke.mjs` читает учётные данные только из env.
- обязательные переменные: `PLAYWRIGHT_SMOKE_EMAIL`, `PLAYWRIGHT_SMOKE_PASSWORD`.
- для URL используется `PLAYWRIGHT_SMOKE_BASE_URL` (fallback: `BASE_URL`, `SANDBOX_URL`).

## Sandbox Quick Start

Для живого sandbox-e2e:

- slot URLs:
  - `sandbox-1` → `https://<hiring-agent-host>/sandbox-001`
  - `sandbox-2` → `https://<hiring-agent-host>/sandbox-002`
  - `sandbox-3` → `https://<hiring-agent-host>/sandbox-003`
- login creds для sandbox лежат в GitHub Environments `sandbox-1/2/3`:
  - `HIRING_AGENT_SANDBOX_DEMO_EMAIL`
  - `HIRING_AGENT_SANDBOX_DEMO_PASSWORD`
- локальный шаблон и дефолты для ручного теста лежат в `.env.sandbox.example`

Быстро проверить, что секреты настроены:
```bash
gh secret list --env sandbox-1 | rg '^HIRING_AGENT_SANDBOX_DEMO_'
```

Быстрый end-to-end сценарий вручную:
1. Открыть `https://<hiring-agent-host>/sandbox-001/login`
2. Войти с demo creds
3. В чате выбрать вакансию
4. Отправить `создать вакансию`
5. Дойти до шага с кнопкой `Настроить общение с кандидатами`
6. Нажать её и проверить, что возвращается `setup_communication` / `communication_plan`

## What Is Covered

`tests/integration/hiring-agent.test.js` покрывает:
- `GET /health` и auth-контракт;
- `POST /api/chat` для ключевых сценариев;
- маршрутизацию playbook по ключевым фразам;
- runtime playbook и обработку ошибок (`playbook_not_found`, `playbook_locked`, `job_not_found`, `vacancy_not_found`);
- WebSocket-контракт и рендер action-пэйлоадов;
- сценарии utility/playbook routing, включая `account_access` и `data_retention`.

`scripts/playwright-smoke.mjs` покрывает:
- загрузку login-страницы;
- login-форму и пост-логин переход;
- видимость селектора вакансий;
- запуск сценария «Настройте общение» и получение ответа.

## Success Criteria

Smoke успешен, если:
- интеграционный прогон `tests/integration/hiring-agent.test.js` завершается без fail;
- e2e smoke не показывает ошибок на логине/роутинге/ответе сценария.

## Known Drift Fixed

Предыдущая версия runbook ссылалась на несуществующие команды и файл:
- `pnpm smoke:hiring-agent:*`
- `scripts/smoke-hiring-agent-chat.js`

В текущем репозитории их нет; используйте команды из раздела `Current Smoke Entry Points`.

## References

- `tests/integration/hiring-agent.test.js`
- `scripts/playwright-smoke.mjs`
- `scripts/rotate-management-recruiter-password.js`
- `README.md#demo-login-password-rotation`
- `.github/workflows/sandbox-release-gate.yml`
