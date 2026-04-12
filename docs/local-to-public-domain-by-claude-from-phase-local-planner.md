# local-to-public-domain — plan by Claude

> Цель: из текущего состояния (postgres тесты проходят локально) дойти до публичного URL,
> где рекрутёр логинится с email+паролем, видит очередь модерации и может принимать решения по кандидатам.

---

## Легенда

- 🤖 — Claude делает сам, без участия пользователя
- 👤 — нужно действие от пользователя (доступ / аккаунт / команда)
- ✅ — definition of done (как проверить что фаза завершена)

---

## Фаза 0 — Починить и запустить локально

**Цель:** сервер стартует локально, можно сделать curl, увидеть planned_message в БД и в moderation UI.

### Задачи

| # | Что | Кто |
|---|-----|-----|
| 0.1 | Исправить `notification-dispatcher.js` — добавить `await` на все async store-методы (`findRunById`, `getSubscriptionsForStep`, `getRecruiterById`, `getCandidate`) | 🤖 |
| 0.2 | Создать `hh-connector/package.json` как workspace-пакет, прописать в monorepo | 🤖 |
| 0.3 | Инстанциировать `NotificationDispatcher` в `index.js` и передать в `createCandidateChatbot` | 🤖 |
| 0.4 | Запускать `cron-sender` в `index.js` через `setInterval` (каждые 30 сек) | 🤖 |
| 0.5 | Проверить и починить `scripts/seed-dev-db.js` — должен запускаться без ошибок | 🤖 |
| 0.6 | Прогнать все integration тесты против реального Neon dev и починить упавшие (`test:hh`, `test:cron`, `test:moderation`, `test:tenant`, `test:telegram`) | 🤖 |
| 0.7 | Запустить сервер локально с `USE_REAL_DB=true V2_DEV_NEON_URL=... npm run dev:candidate-chatbot` | 👤 |
| 0.8 | Открыть `http://localhost:8080/recruiter/<token>` и увидеть UI | 👤 |

### ✅ Done when
```bash
# Все тесты зелёные
npm run test && npm run test:postgres && npm run test:moderation && npm run test:tenant

# Сервер стартует
USE_REAL_DB=true V2_DEV_NEON_URL=$V2_DEV_NEON_URL npm run dev:candidate-chatbot

# Сымулировать кандидата — в UI появляется planned_message
curl -X POST http://localhost:8080/webhook/message \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"conv-candidate-001","text":"Привет, хочу на работу","channel":"test","channel_message_id":"msg-1","occurred_at":"2026-04-12T10:00:00Z"}'

open http://localhost:8080/recruiter/rec-tok-alpha-001
```

---

## Фаза 1 — Auth: логин по email + паролю

**Цель:** вместо `token-в-URL` — нормальный логин. Рекрутёр открывает `/login`, вводит email+пароль, попадает в очередь модерации. Это даёт "демо-аккаунт" который можно передать другому человеку.

### Задачи

| # | Что | Кто |
|---|-----|-----|
| 1.1 | Migration 008: `ALTER TABLE chatbot.recruiters ADD COLUMN password_hash TEXT` | 🤖 |
| 1.2 | `POST /auth/login {email, password}` → ставит httpOnly cookie с session token | 🤖 |
| 1.3 | `GET /login` → HTML-форма с email + password | 🤖 |
| 1.4 | Middleware: `GET /recruiter/:token` проверяет cookie сессии, если нет — редирект на `/login` | 🤖 |
| 1.5 | Seed: добавить `demo@hiring-agent.app` / `demo1234` в dev БД | 🤖 |
| 1.6 | Применить migration 008 к Neon dev через MCP или npm script | 🤖 |
| 1.7 | Вручную проверить: открыть `/login`, войти, увидеть очередь | 👤 |

### ✅ Done when
```
Открыть http://localhost:8080/login
→ ввести demo@hiring-agent.app / demo1234
→ попасть в moderation queue
→ logout → редирект обратно на /login
```

---

## Фаза 2 — Deploy на Cloud Run + домен

**Цель:** сервис доступен по публичному HTTPS-адресу. Можно открыть с телефона.

### Нужно от тебя (блокеры)

| Доступ | Что сделать | Где |
|--------|-------------|-----|
| 👤 GCP роли | В проекте `project-5d8dd8a0-67af-44ba-b6e` выдать `vladimir@skillset.ae`: `Cloud Run Admin`, `Artifact Registry Writer`, `Secret Manager Secret Accessor`, `Service Account User` | [IAM Console](https://console.cloud.google.com/iam-admin/iam?project=project-5d8dd8a0-67af-44ba-b6e) под Ludmila-аккаунтом |
| 👤 Prod Neon | Создать новый проект в org `org-bold-wave-46400152` с именем `hiring-agent-prod` | [Neon Console](https://console.neon.tech/app/org-bold-wave-46400152/projects) |
| 👤 Secret Manager | Добавить секреты через GCP Console: `GEMINI_API_KEY`, `NEON_URL_PROD`, `SESSION_SECRET` | После получения IAM |
| 👤 DNS | В Cloudflare добавить CNAME: `hiring-agent.app` или `demo.recruiter-assistant.com` → Cloud Run URL | После deploy |

### Задачи (Claude делает после получения доступов)

| # | Что | Кто |
|---|-----|-----|
| 2.1 | Создать `Dockerfile` для `candidate-chatbot` (multi-stage, node:22-alpine) | 🤖 |
| 2.2 | Создать `npm run migrate` скрипт — применяет все SQL файлы из `migrations/` к целевой БД | 🤖 |
| 2.3 | Применить все миграции (001–008) к prod Neon | 🤖 |
| 2.4 | Сид prod БД: 1 client, 1 job с pipeline, 1 рекрутёр `demo@hiring-agent.app` | 🤖 |
| 2.5 | `gcloud run deploy candidate-chatbot` с env из Secret Manager | 🤖 |
| 2.6 | Настроить Cloud Run: min-instances=0, память 512MB, регион europe-west1 | 🤖 |
| 2.7 | Прописать custom domain в Cloud Run + добавить DNS запись | 🤖 + 👤 |
| 2.8 | Smoke test: открыть публичный URL, войти, сделать test webhook | 👤 |

### ✅ Done when
```
https://demo.recruiter-assistant.com/login → форма логина
→ войти demo@hiring-agent.app / demo1234
→ очередь модерации доступна
→ HTTPS работает, cert валидный
```

---

## Фаза 3 — HH.ru: реальные кандидаты

**Цель:** откликнуться на тестовую вакансию с реального кандидатского аккаунта и увидеть как агент отвечает.

### Нужно от тебя (блокеры)

| Доступ | Что сделать |
|--------|-------------|
| 👤 HH employer аккаунт | Войти в [hh.ru](https://hh.ru) как работодатель, создать тестовую вакансию |
| 👤 HH OAuth token | Сгенерировать `access_token` для работодателя с правами `negotiations` (через OAuth flow или dev portal) |
| 👤 HH employer_id | Взять из URL личного кабинета работодателя |
| 👤 Тестовый отклик | С отдельного кандидатского аккаунта откликнуться на тестовую вакансию |

### Задачи (Claude делает после получения данных)

| # | Что | Кто |
|---|-----|-----|
| 3.1 | Добавить `HH_ACCESS_TOKEN`, `HH_EMPLOYER_ID` в Secret Manager | 👤 + 🤖 |
| 3.2 | Создать `hh_negotiation` в БД для тестового отклика | 🤖 |
| 3.3 | Запустить `hh-connector.pollAll()` вручную, убедиться что сообщение доходит | 🤖 |
| 3.4 | Добавить Cloud Scheduler job: каждые 60 сек вызывает `/internal/hh-poll` endpoint | 🤖 |
| 3.5 | Проверить полный цикл: отклик → webhook → planned_message → moderation UI | 👤 |
| 3.6 | Утвердить сообщение в UI → убедиться что оно отправилось в HH.ru | 👤 |

### ✅ Done when
```
1. Кандидат откликается на HH
2. Через ~60 сек в moderation queue появляется planned_message
3. Рекрутёр нажимает "Отправить сейчас" — сообщение приходит кандидату в HH
```

---

## Фаза 4 — Telegram уведомления

**Цель:** рекрутёр получает уведомление в Telegram когда кандидат прошёл этап.

### Нужно от тебя

| Доступ | Что сделать |
|--------|-------------|
| 👤 Telegram бот | Написать [@BotFather](https://t.me/BotFather): `/newbot` → получить `TELEGRAM_BOT_TOKEN` |
| 👤 tg_chat_id | Написать боту `/start` → Claude вытащит chat_id и занесёт в БД |

### Задачи

| # | Что | Кто |
|---|-----|-----|
| 4.1 | Добавить `TELEGRAM_BOT_TOKEN` в Secret Manager, обновить Cloud Run | 🤖 |
| 4.2 | Endpoint `POST /tg/start` — принимает webhook от Telegram, сохраняет `tg_chat_id` по email рекрутёра | 🤖 |
| 4.3 | Зарегистрировать Telegram webhook через BotFather → prod URL | 🤖 |
| 4.4 | Insert подписки в `management.recruiter_subscriptions` для демо-рекрутёра | 🤖 |
| 4.5 | Проверить: кандидат отвечает → рекрутёр получает сообщение в Telegram | 👤 |

### ✅ Done when
```
Кандидат прошёл шаг "Готовность к работе"
→ в Telegram приходит:
  "Кандидат Иван Петров прошёл шаг «Готовность к работе» (Senior Backend Engineer)"
```

---

## Сводная таблица блокеров от тебя

| Фаза | Что нужно | Срочность |
|------|-----------|-----------|
| 2 | GCP IAM: выдать роли на `project-5d8dd8a0-67af-44ba-b6e` через Ludmila-аккаунт | Блокирует deploy |
| 2 | Создать Neon prod проект в org `org-bold-wave-46400152` | Блокирует deploy |
| 2 | DNS запись после deploy (2 мин в Cloudflare) | Последний шаг фазы 2 |
| 3 | HH employer OAuth token + employer_id | Блокирует реальных кандидатов |
| 3 | Тестовая вакансия + тестовый отклик | Нужен для e2e теста |
| 4 | Telegram бот через @BotFather | Блокирует уведомления |

---

## Хронология

```
Сейчас           Фаза 0            Фаза 1          Фаза 2           Фаза 3+4
postgres тесты → всё зелёное   → login/pass  → публичный URL → реальные кандидаты
проходят         локально          работает       + HTTPS          + Telegram
                 ~1-2 ч (🤖)      ~1 ч (🤖)      ~2-3 ч           ~2 ч
                                              (нужны доступы)   (нужен HH акк)
```

**Фазы 0 и 1 Claude делает полностью сам.**
**Фаза 2 блокируется на GCP + Neon (от тебя ~10 мин через Cloudflare/GCP консоль).**
**Фазы 3-4 блокируются на HH аккаунте и Telegram боте.**
