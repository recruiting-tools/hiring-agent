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

2. E2E smoke через браузер (прод):
```bash
node scripts/playwright-smoke.mjs
```

Важно:
- `scripts/playwright-smoke.mjs` использует значения `BASE_URL`, `EMAIL`, `PASSWORD` из самого файла.
- перед запуском на другом окружении обновите эти константы в файле.

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
- `.github/workflows/sandbox-release-gate.yml`
