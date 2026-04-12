# local-to-public-domain — plan by Claude

> Цель: из текущего состояния (postgres тесты проходят локально) дойти до публичного URL,
> где рекрутёр логинится с email+паролем, видит очередь модерации и может принимать решения по кандидатам.
>
> Обновлено: 2026-04-12

---

## Легенда

- 🤖 — Claude делает сам
- 👤 — нужно действие от пользователя
- ✅ — definition of done
- 🔑 — кред получен и сохранён в Mac keychain

---

## Статус кредов (2026-04-12)

| Кред | Статус | Где |
|------|--------|-----|
| `GEMINI_API_KEY` | 🔑 в shell | — |
| `NEON_API_KEY` (V2 org) | 🔑 в keychain | `neon-api-key-v2 / hiring-agent` |
| `V2_DEV_NEON_URL` (`round-leaf-16031956`) | 🔑 в `.env.local` | — |
| `V2_PROD_NEON_URL` (`shiny-darkness-67314937`) | 🔑 в keychain | `neon-prod-url-hiring-agent / hiring-agent` |
| GCP Owner на `project-5d8dd8a0-67af-44ba-b6e` | ✅ | `vladimir@skillset.ae` |
| DNS write на `recruiter-assistant.com` | ✅ | `gcloud`, проект `skillset-analytics-487510` |
| `TELEGRAM_BOT_TOKEN` (`@hiring_agnet_bot`) | 🔑 в keychain | `telegram-bot-token-hiring-agent` |
| HH Client ID / Secret (заявка #18667) | 🔑 в keychain | `hh-client-secret-recruiter-agent` |
| HH App Token | 🔑 в keychain | `hh-app-token-recruiter-agent` |
| **HH employer OAuth access_token** | ❌ | нужен OAuth flow после deploy `/hh-callback/` |
| Тестовая вакансия HH | ✅ | `vacancy_id=132032392` |
| Тестовый кандидат | ✅ | Vova откликнется вручную |

---

## Фаза 0 — Починить и запустить локально

**Цель:** сервер стартует с реальной БД, все тесты зелёные, webhook создаёт planned_message.

| # | Что | Кто |
|---|-----|-----|
| 0.1 | Исправить `notification-dispatcher.js` — добавить `await` на async store-методы (`findRunById`, `getSubscriptionsForStep`, `getRecruiterById`, `getCandidate`) | 🤖 |
| 0.2 | Создать `services/hh-connector/package.json` как workspace-пакет | 🤖 |
| 0.3 | Инстанциировать `NotificationDispatcher` в `index.js` (сейчас передаётся `undefined`) | 🤖 |
| 0.4 | Запускать `CronSender.tick()` в `index.js` через `setInterval(30_000)` | 🤖 |
| 0.5 | Написать `services/hh-connector/src/poll-loop.js` — standalone `setInterval` вокруг `HhConnector.pollAll()` | 🤖 |
| 0.6 | Написать `services/hh-connector/src/cron-loop.js` — standalone `setInterval` вокруг `CronSender.tick()` | 🤖 |
| 0.7 | Проверить и починить `scripts/seed-dev-db.js` | 🤖 |
| 0.8 | Прогнать все integration тесты против Neon dev, починить упавшие | 🤖 |
| 0.9 | Добавить `"test:all": "node --test tests/**/*.test.js"` в `package.json` | 🤖 |
| 0.10 | Smoke-тест локально с реальной БД | 👤 |

### ✅ Done when
```bash
npm run test:all   # все зелёные

USE_REAL_DB=true V2_DEV_NEON_URL=$(security find-generic-password -s neon-prod-url-hiring-agent -a hiring-agent -w) \
  npm run dev:candidate-chatbot

curl -X POST http://localhost:8080/webhook/message \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"conv-zakup-001","channel":"test","channel_message_id":"smoke-1",
       "text":"Здравствуйте, готов к вакансии закупщика","occurred_at":"2026-04-12T10:00:00Z"}'

# В UI появляется planned_message с таймером
open http://localhost:8080/recruiter/rec-tok-demo-001
```

---

## Фаза 1 — Auth: логин по email + паролю

**Цель:** вместо token-в-URL — нормальный логин для передачи демо-доступа.

| # | Что | Кто |
|---|-----|-----|
| 1.1 | Migration 008: `ALTER TABLE chatbot.recruiters ADD COLUMN password_hash TEXT` | 🤖 |
| 1.2 | `POST /auth/login {email, password}` → httpOnly cookie с session token (таблица `chatbot.sessions`) | 🤖 |
| 1.3 | `GET /login` → HTML-форма | 🤖 |
| 1.4 | Middleware: moderation UI проверяет cookie сессии, если нет → редирект на `/login` | 🤖 |
| 1.5 | Seed: `demo@hiring-agent.app` / `demo1234` с bcrypt hash | 🤖 |
| 1.6 | Применить migration 008 к Neon dev | 🤖 |
| 1.7 | Проверить вручную | 👤 |

### ✅ Done when
```
http://localhost:8080/login
→ demo@hiring-agent.app / demo1234
→ moderation queue видна
→ logout → редирект на /login
```

---

## Фаза 1.5 — Рефактор пока ждём деплой (параллельно с Фазой 2)

> Запускается пока GCP/Secret Manager настраивается или в промежутках ожидания.
> Агент берёт задачи отсюда когда нет активных блокеров.

| # | Что рефакторить | Почему |
|---|-----------------|--------|
| R1 | **HTTP роутинг** в `http-server.js` — заменить regex-матчинг на нормальный роутер (или структурированный switch) | Regex-цепочка хрупкая, сложно добавлять новые endpoints |
| R2 | **Токены HH в БД** вместо env-переменных — таблица `management.oauth_tokens(provider, access_token, refresh_token, expires_at)` | Без этого смена токена = рестарт Cloud Run. С этим — автообновление без даунтайма |
| R3 | **Token refresh** — `services/hh-connector/src/token-refresher.js` — читает из `oauth_tokens`, рефрешит за 1 час до истечения (access_token живёт 14 дней, refresh_token — 90 дней) | Не делать вручную каждые 2 недели |
| R4 | **`notification-dispatcher.js`** — unit-тест на async dispatch, чтобы покрыть баг с missing await | Нет теста — нет уверенности |
| R5 | **`hh-connector.js`** — проверить обработку ошибок HH API (rate limit 429, 503, auth 401) | Падает молча при проблемах HH |
| R6 | **`cron-sender.js`** — убедиться что idempotency key действительно предотвращает дубли под concurrent отправкой | Самый опасный сценарий — двойная отправка кандидату |
| R7 | **`postgres-store.applyLlmDecision`** — проверить что `this.sql.transaction(queries)` атомарный при сбое на середине | Если транзакция упала после step_completed но до planned_message — потеря события |
| R8 | **Seed fixtures** — добавить `rec-tok-demo-001` во все seed-файлы (сейчас он только в одном из трёх) | Тесты падают неожиданно |

---

## Фаза 2 — Deploy на Cloud Run + домен

**Цель:** `https://candidate-chatbot.recruiter-assistant.com` доступен публично.

> Все блокеры сняты. Claude делает полностью сам.

### 2A — Подготовка к деплою

| # | Что | Кто |
|---|-----|-----|
| 2.1 | `GET /health` → `{service, status, commit, deployed_at}` — читает `DEPLOY_SHA`/`DEPLOY_TIME` из env | 🤖 |
| 2.2 | `Dockerfile` для `candidate-chatbot` (multi-stage, node:22-alpine, копирует только нужное) | 🤖 |
| 2.3 | `scripts/migrate.js` — применяет все `migrations/*.sql` к целевой БД через `$DATABASE_URL` | 🤖 |
| 2.4 | `scripts/deploy.sh` — деплой с SHA-baking и callback при успехе/ошибке (см. ниже) | 🤖 |
| 2.5 | Применить миграции 001–008 к prod Neon (`shiny-darkness-67314937`) | 🤖 |
| 2.6 | Seed prod: 1 client, 1 job + pipeline, `demo@hiring-agent.app` | 🤖 |

### 2B — GCP Secret Manager

| Секрет | Значение |
|--------|----------|
| `GEMINI_API_KEY` | из shell |
| `V2_PROD_NEON_URL` | из keychain `neon-prod-url-hiring-agent` |
| `SESSION_SECRET` | random 32 bytes |
| `HH_CLIENT_ID` | `THFMPVJIDL4MHTM5EE4AFS96MTUDOFOF9UURDFI539OOJF8VCCLKJLENSOI0PCEJ` |
| `HH_CLIENT_SECRET` | из keychain `hh-client-secret-recruiter-agent` |
| `TELEGRAM_BOT_TOKEN` | из keychain `telegram-bot-token-hiring-agent` |

### 2C — Cloud Run deploy

```bash
gcloud run deploy candidate-chatbot-v2 \
  --source services/candidate-chatbot \
  --region europe-west1 \
  --project project-5d8dd8a0-67af-44ba-b6e \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,V2_PROD_NEON_URL=V2_PROD_NEON_URL:latest,..." \
  --set-env-vars "USE_REAL_DB=true,NODE_ENV=production,HH_SEND_ENABLED=false,OUTBOUND_SEND_ENABLED=false,DEPLOY_SHA=$(git rev-parse HEAD),DEPLOY_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --min-instances 0
```

### 2D — DNS

```bash
# Получить Cloud Run URL после deploy, затем:
gcloud dns record-sets create candidate-chatbot.recruiter-assistant.com. \
  --zone=recruiter-assistant \
  --type=CNAME \
  --ttl=300 \
  --rrdatas=<cloud-run-url>.
```

### 2E — Post-deploy SHA verification

```bash
deployed_sha=$(curl -fsS https://candidate-chatbot.recruiter-assistant.com/health | jq -r .commit)
expected_sha=$(git rev-parse HEAD)
[ "$deployed_sha" = "$expected_sha" ] && echo "✅ SHA match" || echo "❌ SHA mismatch: $deployed_sha vs $expected_sha"
```

### ✅ Done when
```bash
curl -fsS https://candidate-chatbot.recruiter-assistant.com/health
# → {"service":"candidate-chatbot","status":"ok","commit":"<sha>","deployed_at":"..."}

open https://candidate-chatbot.recruiter-assistant.com/login
# demo@hiring-agent.app / demo1234 → moderation queue
```

---

## Деплой-процесс для агентов

> Принципы: агент видит результат деплоя без polling; каждый инстанс знает свою версию;
> смена токенов/настроек не требует рестарта.

### `scripts/deploy.sh`

```bash
#!/bin/bash
# Использование: DEPLOY_CALLBACK_URL=<url> ./scripts/deploy.sh
set -e

DEPLOY_SHA=$(git rev-parse HEAD)
DEPLOY_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CALLBACK_URL="${DEPLOY_CALLBACK_URL:-}"
SERVICE="candidate-chatbot-v2"

echo "Deploying $SERVICE @ $DEPLOY_SHA..."

set +e
deploy_output=$(gcloud run deploy "$SERVICE" \
  --source services/candidate-chatbot \
  --region europe-west1 \
  --project project-5d8dd8a0-67af-44ba-b6e \
  --update-env-vars "DEPLOY_SHA=$DEPLOY_SHA,DEPLOY_TIME=$DEPLOY_TIME" \
  2>&1)
exit_code=$?
set -e

if [ -n "$CALLBACK_URL" ]; then
  status=$( [ $exit_code -eq 0 ] && echo "success" || echo "failed" )
  curl -s -X POST "$CALLBACK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"$status\",\"sha\":\"$DEPLOY_SHA\",\"service\":\"$SERVICE\",\"output\":$(echo "$deploy_output" | jq -R -s .)}"
fi

exit $exit_code
```

Агент вызывает: `DEPLOY_CALLBACK_URL=http://localhost:3000/api/sessions/<id>/reply ./scripts/deploy.sh`

### Конфиг без рестарта

Мутабельный конфиг (OAuth токены, feature flags) хранится в БД:

- **Таблица `management.oauth_tokens`** — HH access/refresh token с `expires_at`
- **`token-refresher.js`** читает из БД, рефрешит за 1 час до истечения, пишет обратно
- При старте инстанса: читает токены из БД, не из env
- Смена токена = UPDATE в БД → все инстансы подхватывают на следующем poll (без рестарта)

```sql
-- Migration 009 (создаётся в Фазе R3)
CREATE TABLE IF NOT EXISTS management.oauth_tokens (
  provider      TEXT PRIMARY KEY,          -- 'hh_employer'
  access_token  TEXT NOT NULL,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Kill switch без рестарта

`management.feature_flags(flag TEXT PRIMARY KEY, enabled BOOLEAN)` — `hh-connector` проверяет перед каждой отправкой. Включить/выключить = UPDATE, подхватывается в следующем цикле.

---

## Фаза 3 — HH.ru: реальные кандидаты

**Цель:** Vova откликается на vacancy `132032392`, агент отвечает через moderation UI.

> Единственный оставшийся блокер: HH employer OAuth access_token.

### Получить employer OAuth token

```bash
# 1. Открыть в браузере как работодатель на hh.ru:
https://hh.ru/oauth/authorize?response_type=code&client_id=THFMPVJIDL4MHTM5EE4AFS96MTUDOFOF9UURDFI539OOJF8VCCLKJLENSOI0PCEJ&redirect_uri=https://recruiter-assistant.com/hh-callback/

# 2. Скопировать ?code= из URL редиректа и передать Claude

# 3. Claude обменяет code на access_token + refresh_token и запишет в management.oauth_tokens
```

| # | Что | Кто |
|---|-----|-----|
| 3.1 | `GET /hh-callback/` endpoint — принимает `code`, обменивает → tokens, пишет в `management.oauth_tokens` | 🤖 |
| 3.2 | OAuth flow: открыть auth URL как работодатель | 👤 |
| 3.3 | `HhApiClient` с `getNegotiations(vacancyId)`, `getMessages(negotiationId)`, `sendMessage(negotiationId, text)` | 🤖 |
| 3.4 | Migration 009: `management.oauth_tokens` + `management.feature_flags` | 🤖 |
| 3.5 | `token-refresher.js` — рефреш за 1 час до истечения | 🤖 |
| 3.6 | `POST /internal/hh-poll` — запускает `hh-connector.pollAll()` (защищён internal secret) | 🤖 |
| 3.7 | Cloud Scheduler job: каждые 60 сек → `POST /internal/hh-poll` | 🤖 |
| 3.8 | Создать `hh_negotiation` в БД для тестового отклика | 🤖 |
| 3.9 | Vova откликается на `https://hh.ru/vacancy/132032392` | 👤 |
| 3.10 | Включить отправку: `UPDATE management.feature_flags SET enabled=true WHERE flag='hh_send'` | 👤 + 🤖 |
| 3.11 | Проверить полный цикл: отклик → planned_message → кнопка → ответ в HH | 👤 |

### ✅ Done when
```
1. Vova откликается на hh.ru/vacancy/132032392
2. Через ~60 сек в moderation queue появляется planned_message
3. "Отправить сейчас" → ответ приходит в HH
```

---

## Фаза 4 — Telegram уведомления

**Цель:** рекрутёр получает пуш в Telegram когда кандидат прошёл этап. Бот `@hiring_agnet_bot` готов.

| # | Что | Кто |
|---|-----|-----|
| 4.1 | `POST /tg/webhook` — обрабатывает `/start`, сохраняет `tg_chat_id` по email рекрутёра | 🤖 |
| 4.2 | `setWebhook` → `https://candidate-chatbot.recruiter-assistant.com/tg/webhook` | 🤖 |
| 4.3 | Добавить `TELEGRAM_BOT_TOKEN` в Cloud Run из Secret Manager | 🤖 |
| 4.4 | Seed подписок в `management.recruiter_subscriptions` для демо-рекрутёра | 🤖 |
| 4.5 | Написать `/start` боту `@hiring_agnet_bot` | 👤 |
| 4.6 | Проверить уведомление после step_completed | 👤 |

### ✅ Done when
```
/start @hiring_agnet_bot → подтверждение
Кандидат проходит шаг → "Кандидат Иван прошёл шаг «Опыт закупок» (Закупщик из Китая)"
```

---

## Production readiness gate

Не включать `hh_send=true` пока не выполнено:

- [ ] `npm run test:all` зелёный
- [ ] `npm run test:postgres` против prod Neon зелёный
- [ ] `/health` возвращает правильный `commit` SHA
- [ ] DNS + HTTPS валидный
- [ ] Staging smoke пройден руками (все 4 сценария из раздела ниже)
- [ ] Tenant isolation проверен (Alpha не видит Beta)
- [ ] Kill switch работает (`feature_flags.hh_send=false` → нет отправок, polling продолжается)
- [ ] Cloud Run rollback доступен: `gcloud run services update-traffic candidate-chatbot-v2 --to-revisions=PREVIOUS=100`
- [ ] Все отправки только через `planned_messages → CronSender → sendHHWithGuard`
- [ ] Deploy SHA verification зелёный

### Staging smoke-сценарии

1. **Moderation happy path** — webhook → planned_message → "Отправить сейчас" → статус sent
2. **Block** — "Заблокировать" → сообщение исчезает из очереди, не отправляется
3. **Auto-send** — подождать 10 минут → сообщение уходит автоматически без действий
4. **Tenant isolation** — токен Alpha не видит сообщения Beta

---

## Сводка оставшихся блокеров от тебя

| Фаза | Что | Статус |
|------|-----|--------|
| 0–2 | Все доступы | ✅ получены |
| **3** | **HH employer OAuth** — открыть 1 URL в браузере как работодатель | ❌ после deploy |
| 3 | Откликнуться на vacancy 132032392 | 👤 |
| 4 | Написать `/start` боту `@hiring_agnet_bot` | 👤 1 сообщение |

---

## Хронология

```
Сейчас         Фаза 0+1          Фаза 1.5     Фаза 2              Фаза 3+4
postgres   →  всё зелёное   →  рефактор   →  публичный HTTPS  →  реальный HH
тесты          + auth             (параллельно)  кандидат-chatbot    + Telegram
               ~2-3 ч 🤖          ~2 ч 🤖        ~1-2 ч 🤖           ~1-2 ч 👤+🤖
```

**Фазы 0, 1, 1.5, 2 — Claude делает полностью сам.**
**Фаза 3 — одно действие: открыть OAuth URL + откликнуться на вакансию.**
**Фаза 4 — одно действие: написать `/start` боту.**
