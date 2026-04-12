# Local → Public Domain: Phase Plan

**Цель**: рабочий публичный демо-стенд — recruiter видит очередь сообщений, candidate-chatbot отвечает через Gemini, HH.ru интеграция работает на реальных данных.

**Дата**: 2026-04-12  
**Исполнитель**: claude agent (phase-doer), запускается координатором итерационно.

---

## Env vars (нужны перед стартом)

Добавить в `~/.zshrc` на машине где запускается:

```bash
# HH API app credentials (не коммитить в репо)
HH_CLIENT_ID=<из 1password/notion>
HH_CLIENT_SECRET=<из 1password/notion>
HH_APP_TOKEN=<токен приложения>

# Neon dev DB (уже создан воркером iteration 2)
V2_DEV_NEON_URL=postgresql://neondb_owner:npg_HG2XT9sVajhS@ep-curly-cake-ale9126f.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require

# Уже должен быть в shell
GEMINI_API_KEY=<уже есть>

# GCP project для Cloud Run (Ludmila account)
GCP_PROJECT=project-5d8dd8a0-67af-44ba-b6e
GCP_REGION=europe-west1
```

---

## Phase 1 — Dev DB готова к работе

**Acceptance**: `pnpm test:postgres` зелёный, seed применён.

### Шаги

1. Применить все миграции к dev Neon:
```bash
cd /Users/vova/Documents/GitHub/hiring-agent
for f in services/candidate-chatbot/migrations/*.sql; do
  echo "Applying $f..."
  psql "$V2_DEV_NEON_URL" -f "$f"
done
```

2. Запустить seed:
```bash
pnpm seed:dev
```

3. Проверить:
```bash
V2_DEV_NEON_URL=$V2_DEV_NEON_URL pnpm test:postgres
```

### Done when
- Все 5 postgres-тестов зелёные
- В dev Neon есть таблицы: `chatbot.*`, `management.*`
- Seed data: 1 job (zakup), 1 candidate, 1 recruiter с токеном `rec-tok-demo-001`

---

## Phase 2 — Local smoke test (real DB + Gemini)

**Acceptance**: curl к localhost возвращает осмысленный ответ от Gemini, сообщение появляется в moderation UI.

### Шаги

1. Запустить сервис:
```bash
USE_REAL_DB=true PORT=3001 pnpm dev:candidate-chatbot
```

2. Отправить тестовое сообщение:
```bash
curl -X POST http://localhost:3001/webhook/message \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "conv-zakup-001",
    "channel": "test",
    "channel_message_id": "in-smoke-001",
    "text": "Здравствуйте! Готов рассмотреть вакансию закупщика.",
    "occurred_at": "2026-04-12T10:00:00.000Z"
  }'
```

3. Открыть moderation UI:
```
http://localhost:3001/recruiter/rec-tok-demo-001/queue/page
```

### Done when
- Webhook возвращает JSON без `{{` и `}}`
- В moderation UI видно сообщение с таймером
- В таблице `chatbot.planned_messages` есть запись

---

## Phase 3 — Реальный HH API клиент

**Acceptance**: `HhApiClient.getMessages(negotiationId)` возвращает реальные сообщения из HH.

### Что нужно написать

Новый файл `services/hh-connector/src/hh-api-client.js`:

```js
// Реальный HH API клиент (не фейк)
// Документация: https://github.com/hhru/api/blob/master/docs/negotiations.md

export class HhApiClient {
  constructor({ accessToken }) {
    this.accessToken = accessToken; // токен рекрутера (не app token)
    this.baseUrl = 'https://api.hh.ru';
  }

  // GET /negotiations — список откликов
  async getNegotiations({ vacancyId, status = 'response' }) { ... }

  // GET /negotiations/{id}/messages — история переписки
  async getMessages(negotiationId) { ... }

  // PUT /negotiations/{id}/messages — отправить сообщение
  async sendMessage(negotiationId, text) { ... }
}
```

### HH OAuth flow для получения токена рекрутера

1. Авторизационная ссылка:
```
https://hh.ru/oauth/authorize?response_type=code&client_id=$HH_CLIENT_ID&redirect_uri=https://recruiter-assistant.com/hh-callback/
```

2. Получить code из redirect URL, обменять на токен:
```bash
curl -X POST https://hh.ru/oauth/token \
  -d "grant_type=authorization_code" \
  -d "client_id=$HH_CLIENT_ID" \
  -d "client_secret=$HH_CLIENT_SECRET" \
  -d "code=<code_from_redirect>" \
  -d "redirect_uri=https://recruiter-assistant.com/hh-callback/"
```

3. Сохранить `access_token` и `refresh_token` в env или DB:
```bash
HH_ACCESS_TOKEN=<полученный токен>
HH_REFRESH_TOKEN=<полученный refresh>
```

### Done when
- `HhApiClient` умеет `getNegotiations`, `getMessages`, `sendMessage`
- Можно получить список откликов по реальной вакансии
- Unit тест с реальным API (помечен `@slow`, запускается вручную)

---

## Phase 4 — Local end-to-end с реальным HH

**Acceptance**: кандидат пишет в HH → hh-connector подхватывает → candidate-chatbot отвечает через Gemini → ответ появляется в moderation UI → после 10 минут уходит в HH.

### Шаги

1. Запустить candidate-chatbot с реальной базой:
```bash
USE_REAL_DB=true PORT=3001 pnpm dev:candidate-chatbot
```

2. Запустить hh-connector loop (polling каждые 30 секунд):
```bash
HH_ACCESS_TOKEN=$HH_ACCESS_TOKEN \
V2_DEV_NEON_URL=$V2_DEV_NEON_URL \
node services/hh-connector/src/poll-loop.js
```

> Note: `poll-loop.js` нужно написать — простой setInterval вокруг `HhConnector.pollAll()`.

3. Запустить cron-sender loop (каждую минуту проверяет planned_messages):
```bash
USE_REAL_DB=true \
HH_ACCESS_TOKEN=$HH_ACCESS_TOKEN \
node services/hh-connector/src/cron-loop.js
```

> Note: `cron-loop.js` — простой setInterval вокруг `CronSender.tick()`.

### Done when
- Реальный отклик из HH появляется в candidate-chatbot
- Gemini генерирует ответ рекрутера
- Ответ виден в moderation UI через `http://localhost:3001/recruiter/rec-tok-demo-001/queue/page`
- После 10 минут (или Send Now) сообщение уходит в HH

---

## Phase 5 — Deploy candidate-chatbot на Cloud Run

**Acceptance**: `https://candidate-chatbot.recruiter-assistant.com/recruiter/rec-tok-demo-001/queue/page` открывается.

### Шаги

1. Написать `services/candidate-chatbot/Dockerfile`:
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
COPY services/candidate-chatbot/ ./services/candidate-chatbot/
COPY tests/fixtures/ ./tests/fixtures/
RUN npm install -g pnpm && pnpm install --frozen-lockfile
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "services/candidate-chatbot/src/index.js"]
```

2. Собрать и залить в Artifact Registry (GCP project Ludmila account):
```bash
gcloud builds submit --tag europe-west1-docker.pkg.dev/$GCP_PROJECT/hiring-agent/candidate-chatbot \
  --project $GCP_PROJECT
```

3. Задеплоить на Cloud Run:
```bash
gcloud run deploy candidate-chatbot \
  --image europe-west1-docker.pkg.dev/$GCP_PROJECT/hiring-agent/candidate-chatbot \
  --region $GCP_REGION \
  --project $GCP_PROJECT \
  --set-env-vars "USE_REAL_DB=true,GEMINI_API_KEY=$GEMINI_API_KEY,V2_DEV_NEON_URL=$V2_DEV_NEON_URL" \
  --allow-unauthenticated \
  --port 8080
```

4. DNS: `candidate-chatbot.recruiter-assistant.com` → Cloud Run URL (уже в CLAUDE.md).

### Done when
- `curl https://candidate-chatbot.recruiter-assistant.com/recruiter/rec-tok-demo-001/queue` возвращает JSON
- Moderation page открывается по публичному URL
- Webhook принимает сообщения через HTTPS

---

## Phase 6 — hh-connector + cron-sender на VM

**Acceptance**: polling и отправка работают без локального запуска.

### Шаги

1. На GCP VM (`34.31.217.176`):
```bash
git clone <repo> /opt/hiring-agent
cd /opt/hiring-agent && pnpm install
```

2. Создать systemd сервисы:
   - `hh-poll.service` — запускает `poll-loop.js` (polling каждые 30 сек)
   - `hh-cron.service` — запускает `cron-loop.js` (отправка каждую минуту)

3. Env file `/etc/hiring-agent.env`:
```
V2_DEV_NEON_URL=...
HH_ACCESS_TOKEN=...
HH_REFRESH_TOKEN=...
HH_CLIENT_ID=...
HH_CLIENT_SECRET=...
CANDIDATE_CHATBOT_URL=https://candidate-chatbot.recruiter-assistant.com
```

4. HH token refresh: access_token живёт 2 недели, refresh_token — 3 месяца. Написать `refresh-token.js` и поставить в cron.

### Done when
- `systemctl status hh-poll` — active/running
- `systemctl status hh-cron` — active/running
- Новые отклики в HH подхватываются автоматически
- Planned messages уходят без ручного запуска

---

## Phase 7 — Публичное демо готово

**Финальный чеклист**:

- [ ] Phase 1: dev Neon с миграциями и seed ✓
- [ ] Phase 2: local smoke test с реальным DB и LLM ✓
- [ ] Phase 3: HhApiClient + OAuth token получен ✓
- [ ] Phase 4: local end-to-end с реальным HH ✓
- [ ] Phase 5: candidate-chatbot задеплоен на Cloud Run ✓
- [ ] Phase 6: hh-connector + cron-sender на VM ✓
- [ ] Публичный URL: `https://candidate-chatbot.recruiter-assistant.com/recruiter/rec-tok-demo-001/queue/page` ✓

---

## Что НЕ входит в этот план (следующие итерации)

- Onboarding нового клиента без seed скрипта
- Management DB в отдельном Neon проекте
- Telegram bot с реальным токеном
- Мониторинг и алерты на production
- HTTPS для /hh-callback/ endpoint (нужен для OAuth redirect)
- Recruiter auth (сейчас только token в URL)

---

## Порядок запуска для координатора

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
```

Каждая фаза — отдельный воркер. Воркер читает эту спеку, делает только свою фазу, коммитит результат, отчитывается `DONE: Phase N — <summary>`.
