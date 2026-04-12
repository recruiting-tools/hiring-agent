# local-to-public-domain — plan by Claude

> Цель: из текущего состояния (postgres тесты проходят локально) дойти до публичного URL,
> где рекрутёр логинится с email+паролем, видит очередь модерации и может принимать решения по кандидатам.
>
> Обновлено: 2026-04-12 — все основные доступы получены, единственный оставшийся блокер — HH employer OAuth token.

---

## Легенда

- 🤖 — Claude делает сам, без участия пользователя
- 👤 — нужно действие от пользователя (доступ / аккаунт / команда)
- ✅ — definition of done (как проверить что фаза завершена)
- 🔑 — кред получен и сохранён в Mac keychain

---

## Статус кредов (актуально на 2026-04-12)

| Кред | Статус | Keychain key |
|------|--------|--------------|
| `GEMINI_API_KEY` | 🔑 в shell | — |
| `NEON_API_KEY` (V2 org) | 🔑 в keychain | `neon-api-key-v2 / hiring-agent` |
| `V2_DEV_NEON_URL` (round-leaf-16031956) | 🔑 в `.env.local` | — |
| `V2_PROD_NEON_URL` (shiny-darkness-67314937) | 🔑 в keychain | `neon-prod-url-hiring-agent / hiring-agent` |
| GCP Owner на `project-5d8dd8a0-67af-44ba-b6e` | ✅ выдан | — |
| DNS write на `recruiter-assistant.com` | ✅ доступен через `gcloud` (`skillset-analytics-487510`) | — |
| `TELEGRAM_BOT_TOKEN` (@hiring_agnet_bot) | 🔑 в keychain | `telegram-bot-token-hiring-agent / hiring_agnet_bot` |
| HH Client ID / Secret (заявка #18667) | 🔑 в keychain | `hh-client-secret-recruiter-agent` |
| HH App Token | 🔑 в keychain | `hh-app-token-recruiter-agent / hiring-agent` |
| **HH employer OAuth access_token** | ❌ **не получен** — нужен OAuth flow после deploy | — |
| Тестовая вакансия HH | ✅ `vacancy_id=132032392` | — |
| Тестовый кандидат HH | ✅ Vova откликнется вручную | — |

---

## Фаза 0 — Починить и запустить локально

**Цель:** сервер стартует локально, можно сделать curl, увидеть planned_message в БД и в moderation UI.

### Задачи

| # | Что | Кто |
|---|-----|-----|
| 0.1 | Исправить `notification-dispatcher.js` — добавить `await` на все async store-методы (`findRunById`, `getSubscriptionsForStep`, `getRecruiterById`, `getCandidate`) | 🤖 |
| 0.2 | Создать `hh-connector/package.json` как workspace-пакет | 🤖 |
| 0.3 | Инстанциировать `NotificationDispatcher` в `index.js` и передать в `createCandidateChatbot` | 🤖 |
| 0.4 | Запускать `cron-sender` в `index.js` через `setInterval` (каждые 30 сек) | 🤖 |
| 0.5 | Проверить и починить `scripts/seed-dev-db.js` | 🤖 |
| 0.6 | Прогнать все integration тесты против Neon dev, починить упавшие | 🤖 |
| 0.7 | Добавить `test:all` скрипт в `package.json` — запускает весь набор | 🤖 |
| 0.8 | Запустить сервер локально с real DB и сделать test webhook | 👤 |

### ✅ Done when
```bash
npm run test:all  # все зелёные

USE_REAL_DB=true V2_DEV_NEON_URL=$(security find-generic-password -s neon-prod-url-hiring-agent -a hiring-agent -w 2>/dev/null) \
  npm run dev:candidate-chatbot

curl -X POST http://localhost:8080/webhook/message \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"conv-candidate-001","text":"Привет","channel":"test","channel_message_id":"1","occurred_at":"2026-04-12T10:00:00Z"}'

open http://localhost:8080/recruiter/rec-tok-alpha-001
```

---

## Фаза 1 — Auth: логин по email + паролю

**Цель:** вместо token-в-URL — нормальный логин.

### Задачи

| # | Что | Кто |
|---|-----|-----|
| 1.1 | Migration 008: `ADD COLUMN password_hash TEXT` в `chatbot.recruiters` | 🤖 |
| 1.2 | `POST /auth/login {email, password}` → httpOnly cookie с session token | 🤖 |
| 1.3 | `GET /login` → HTML-форма | 🤖 |
| 1.4 | Middleware: moderation UI проверяет cookie, если нет → редирект на `/login` | 🤖 |
| 1.5 | Seed: `demo@hiring-agent.app` / `demo1234` | 🤖 |
| 1.6 | Применить migration 008 к Neon dev | 🤖 |
| 1.7 | Проверить вручную: `/login` → войти → очередь | 👤 |

### ✅ Done when
```
http://localhost:8080/login → demo@hiring-agent.app / demo1234 → moderation queue
```

---

## Фаза 2 — Deploy на Cloud Run + домен

**Цель:** сервис на `https://candidate-chatbot.recruiter-assistant.com`.

> Все блокеры сняты. Claude делает сам.

### Задачи

| # | Что | Кто |
|---|-----|-----|
| 2.1 | `GET /health` endpoint → `{service, status, commit, deployed_at}`, читает `DEPLOY_SHA`/`DEPLOY_TIME` из env | 🤖 |
| 2.2 | `Dockerfile` для `candidate-chatbot` (multi-stage, node:22-alpine) | 🤖 |
| 2.3 | `npm run migrate` скрипт — применяет все SQL из `migrations/` к целевой БД | 🤖 |
| 2.4 | Применить миграции 001–008 к prod Neon (`shiny-darkness-67314937`) | 🤖 |
| 2.5 | Seed prod: 1 client, 1 job + pipeline, `demo@hiring-agent.app` с паролем | 🤖 |
| 2.6 | Добавить секреты в GCP Secret Manager (`project-5d8dd8a0-67af-44ba-b6e`) | 🤖 |
| 2.7 | `gcloud run deploy candidate-chatbot-v2` — source deploy из monorepo | 🤖 |
| 2.8 | Cloud Run: `HH_SEND_ENABLED=false`, `OUTBOUND_SEND_ENABLED=false` (kill switch) | 🤖 |
| 2.9 | DNS: `gcloud dns record-sets create candidate-chatbot.recruiter-assistant.com` → Cloud Run URL | 🤖 |
| 2.10 | Post-deploy SHA verification: `curl /health` → `commit` совпадает с git HEAD | 🤖 |
| 2.11 | Smoke test публичного URL | 👤 |

### ✅ Done when
```bash
curl -fsS https://candidate-chatbot.recruiter-assistant.com/health
# → {"service":"candidate-chatbot","status":"ok","commit":"<sha>"}

# Открыть и войти:
open https://candidate-chatbot.recruiter-assistant.com/login
# demo@hiring-agent.app / demo1234 → moderation queue
```

---

## Фаза 3 — HH.ru: реальные кандидаты

**Цель:** Vova откликается на вакансию `132032392`, агент отвечает через moderation UI.

> Единственный оставшийся блокер: **HH employer OAuth access_token**.

### Как получить employer OAuth token

После того как `/hh-callback/` endpoint задеплоен:

```bash
# 1. Открыть в браузере (как работодатель на hh.ru):
https://hh.ru/oauth/authorize?response_type=code&client_id=THFMPVJIDL4MHTM5EE4AFS96MTUDOFOF9UURDFI539OOJF8VCCLKJLENSOI0PCEJ&redirect_uri=https://recruiter-assistant.com/hh-callback/

# 2. Авторизоваться как работодатель
# 3. Скопировать `code` из URL редиректа
# 4. Claude обменяет code → access_token + refresh_token
```

### Задачи

| # | Что | Кто |
|---|-----|-----|
| 3.1 | `GET /hh-callback/` endpoint — принимает `code`, обменивает на токены, сохраняет в БД | 🤖 |
| 3.2 | Провести OAuth flow для employer токена | 👤 (открыть URL) + 🤖 (обмен) |
| 3.3 | Добавить `HH_ACCESS_TOKEN`, `HH_EMPLOYER_ID` в Secret Manager | 🤖 |
| 3.4 | `POST /internal/hh-poll` endpoint — запускает `hh-connector.pollAll()` | 🤖 |
| 3.5 | Cloud Scheduler job: каждые 60 сек → `/internal/hh-poll` | 🤖 |
| 3.6 | Создать `hh_negotiation` в БД для тестового отклика | 🤖 |
| 3.7 | Убедиться в kill switch: `HH_SEND_ENABLED=false` → polling работает, отправка нет | 🤖 |
| 3.8 | Vova откликается на вакансию `132032392` | 👤 |
| 3.9 | Дать зелёный свет на отправку: `HH_SEND_ENABLED=true` для тестовой вакансии | 👤 |
| 3.10 | Проверить полный цикл: отклик → moderation UI → кнопка → ответ в HH | 👤 |

### ✅ Done when
```
1. Vova откликается на hh.ru/vacancy/132032392
2. Через ~60 сек в moderation queue появляется planned_message
3. Нажать "Отправить сейчас" → ответ приходит в HH
```

---

## Фаза 4 — Telegram уведомления

**Цель:** рекрутёр получает уведомление когда кандидат прошёл этап. Бот `@hiring_agnet_bot` уже создан.

### Задачи

| # | Что | Кто |
|---|-----|-----|
| 4.1 | `POST /tg/webhook` endpoint — обрабатывает `/start`, сохраняет `tg_chat_id` по email | 🤖 |
| 4.2 | Зарегистрировать Telegram webhook: `setWebhook` → `https://candidate-chatbot.recruiter-assistant.com/tg/webhook` | 🤖 |
| 4.3 | Добавить `TELEGRAM_BOT_TOKEN` в Secret Manager, обновить Cloud Run | 🤖 |
| 4.4 | Insert подписки в `management.recruiter_subscriptions` для демо-рекрутёра | 🤖 |
| 4.5 | Написать `/start` боту `@hiring_agnet_bot` → получить `tg_chat_id` | 👤 |
| 4.6 | Проверить уведомление после step_completed | 👤 |

### ✅ Done when
```
Написать /start боту → прийти подтверждение
Кандидат проходит шаг → в Telegram:
  "Кандидат Иван прошёл шаг «Опыт работы» (Senior Backend Engineer)"
```

---

## Production readiness gate

Не включать реальную отправку (`HH_SEND_ENABLED=true`) пока не выполнено:

- [ ] `npm run test:all` зелёный
- [ ] `npm run test:postgres` реально ходит в Neon prod и зелёный
- [ ] `/health` возвращает правильный `commit` SHA
- [ ] DNS работает, HTTPS валидный cert
- [ ] Staging smoke пройден руками
- [ ] Tenant isolation проверен (Alpha не видит Beta)
- [ ] Kill switch работает (`HH_SEND_ENABLED=false` → нет отправок)
- [ ] Cloud Run rollback доступен (`gcloud run services update-traffic --to-revisions=PREVIOUS=100`)
- [ ] Все отправки только через `planned_messages → cron → sendHHWithGuard`

---

## Сводка блокеров — что ещё нужно от тебя

| Фаза | Что | Статус |
|------|-----|--------|
| 0-2 | GCP Owner | ✅ выдан |
| 0-2 | Neon V2 API key | ✅ в keychain |
| 0-2 | Prod Neon проект | ✅ создан (`shiny-darkness-67314937`) |
| 0-2 | DNS write | ✅ доступен через gcloud |
| 0-2 | Telegram bot token | ✅ в keychain |
| 0-2 | HH app credentials | ✅ в keychain |
| **3** | **HH employer OAuth** | ❌ **нужен OAuth flow** (после deploy `/hh-callback/`) |
| 3 | Тестовый отклик на vacancy 132032392 | 👤 Vova откликается вручную |
| 4 | Написать `/start` боту @hiring_agnet_bot | 👤 1 сообщение |

---

## Хронология

```
Сейчас        Фаза 0+1         Фаза 2              Фаза 3           Фаза 4
postgres  →  всё зелёное  →  публичный HTTPS  →  реальный HH   →  Telegram
тесты         + auth           candidate-chatbot    (нужен OAuth)    (бот готов)
проходят      ~2-3 ч 🤖        ~1-2 ч 🤖            ~1 ч 👤+🤖        ~30 мин 🤖
```

**Фазы 0, 1, 2 — Claude делает полностью сам.**
**Фаза 3 — одно действие от тебя: открыть URL для OAuth и откликнуться на вакансию.**
**Фаза 4 — одно действие: написать `/start` боту.**
