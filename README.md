# Hiring Agent V2

Система управления перепиской с кандидатами. Переписывание с нуля, параллельно с V1.

## Сервисы

| Сервис | Папка | Домен | Инфра |
|---|---|---|---|
| `candidate-chatbot` | `services/candidate-chatbot` | `candidate-chatbot.recruiter-assistant.com` | Cloud Run europe-west1 |
| `hiring-mcp` | `services/hiring-mcp` | внутренний | GCP VM |
| `hiring-agent` | `services/hiring-agent` | `hiring-chat.recruiter-assistant.com` | GCP VM |
| `hh-connector` | `services/hh-connector` | внутренний | GCP VM |

## Быстрый старт

```bash
pnpm install
pnpm test          # все тесты
pnpm test:watch    # watch mode
```

## Env vars (локально)

```bash
# ~/.zshrc
V2_NEON_ORG_ID=org-bold-wave-46400152
V2_MANAGEMENT_DB_URL=...   # Neon project: orange-silence-65083641
V2_DEV_NEON_URL=...        # Neon project: round-leaf-16031956
GEMINI_API_KEY=...         # уже есть в shell
```

## Архитектура — коротко

Кандидат пишет → `hh-connector` принимает и пишет в DB → `candidate-chatbot` читает pipeline state → LLM (Gemini Flash) генерирует ответ → `planned_messages` → cron отправляет через N минут (рекрутер может заблокировать).

Подробная спека: [`docs/spec-by-claude.md`](docs/spec-by-claude.md)

---

## Claude Code Instructions

### Статус V1 репозиториев

**V1 repos — READ ONLY. Не редактировать, не импортировать без явного решения.**

| V1 репо | Статус | Что взять |
|---|---|---|
| `candidate-routing` | frozen | `sendHHWithGuard()` логика |
| `recruiter-mcp` | frozen | role-based tool registration паттерн |
| `recruiting-agent` | frozen | playbooks паттерн |
| `recruiter-data-layer` | frozen | multi-tenant Neon паттерн |
| `hh-connector` | frozen | poll state, awaiting_reply |
| `interview-engine` | live, не трогать | использовать как API |
| `apply-via-resume` | live, не трогать | использовать как API |

### Ключевые архитектурные правила

1. **Один путь отправки**: сообщение кандидату → только через `planned_messages` → cron → `sendHHWithGuard`. Прямых вызовов send нет нигде.

2. **State machine нелинейная**: один ответ кандидата может закрыть несколько шагов. LLM получает все незакрытые шаги сразу и возвращает `completed_step_ids[]`.

3. **Validator обязателен**: после каждого LLM-ответа — детерминированный validator. Нет `{{placeholder}}` → нет отправки.

4. **pipeline_events — source of truth**: `pipeline_step_state` — проекция, можно пересобрать. Не писать state напрямую в step_state минуя events.

5. **Text2SQL только поверх marts**: `output_data_marts.candidate_funnel` — единственная таблица для аналитических запросов. Не давать LLM доступ к operational tables.

6. **Cloudflare не в пути кандидата**: все публичные эндпоинты для кандидатов — только GCP (Cloud Run). Cloudflare = DNS only.

7. **Домен**: `recruiter-assistant.com` — единственный. `recruiter-asisstant.com` (двойная s) — не продлевать.

### Neon (V2 org)

- Org ID: `org-bold-wave-46400152`
- Management DB project: `orange-silence-65083641`
- Dev client DB project: `round-leaf-16031956`
- API key: тот же `NEON_API_KEY` (один аккаунт, разные org)
- Всегда указывать `--org-id` в neonctl командах

### GCP

- Deploy проект: `project-5d8dd8a0-67af-44ba-b6e` (Ludmila account)
- Регион: `europe-west1`
- VM IP: `34.31.217.176` (для hiring-agent UI)

### Deploy — candidate-chatbot

```bash
./scripts/deploy.sh   # сборка образа + деплой (два шага, не --source)
```

**Gotchas:**

1. **НЕ использовать `--source` напрямую** — зависает в агент-сессии (exit 144). `deploy.sh` делает `gcloud builds submit` + `gcloud run deploy --image` раздельно.

2. **Domain mapping** — только от `ludmilachramcova@gmail.com` (домен `recruiter-assistant.com` верифицирован на ней):
   ```bash
   gcloud config set account ludmilachramcova@gmail.com
   gcloud beta run domain-mappings create \
     --service=candidate-chatbot-v2 \
     --domain=candidate-chatbot.recruiter-assistant.com \
     --region=europe-west1 \
     --project=project-5d8dd8a0-67af-44ba-b6e
   gcloud config set account vladimir@skillset.ae   # вернуть
   ```
   `vladimir@skillset.ae` и `kobzevvv@gmail.com` для domain mapping **не подходят**.

3. **CNAME** `candidate-chatbot.recruiter-assistant.com → ghs.googlehosted.com` уже стоит. Не трогать.

4. **SSL-сертификат** выпускается автоматически ~15–60 мин после создания маппинга.

### Что ещё не сделано

#### HH.ru — реальные кандидаты (Фаза 3)

Единственный блокер: HH employer OAuth access_token. Всё остальное — Claude.

Обновление от 2026-04-12: отдельную платную тестовую вакансию не заводим. Сначала делаем контрактный mock HH API и библиотеку redacted fixtures, потом выполняем ограниченный live smoke через существующие HH данные и allowlisted тестового кандидата по `resume_id`. Подробный план: [`docs/hh-api-mocking-plan.md`](docs/hh-api-mocking-plan.md).

| # | Что | Кто |
|---|-----|-----|
| 3.1 | `GET /hh-callback/` — принимает `?code=`, обменивает на tokens, пишет в `management.oauth_tokens` | 🤖 |
| 3.2 | Migration 009: `management.oauth_tokens` + `management.feature_flags` | 🤖 |
| 3.3 | `token-refresher.js` — рефреш за 1 час до истечения (access живёт 14 дней, refresh 90) | 🤖 |
| 3.4 | `POST /internal/hh-poll` — защищённый endpoint для Cloud Scheduler | 🤖 |
| 3.5 | Cloud Scheduler job: каждые 60 сек → `POST /internal/hh-poll` | 🤖 |
| 3.6 | OAuth flow: открыть URL как работодатель hh.ru, передать `?code=` Claude | 👤 |
| 3.7 | Откликнуться на `https://hh.ru/vacancy/132032392` | 👤 |
| 3.8 | Включить отправку: `UPDATE management.feature_flags SET enabled=true WHERE flag='hh_send'` | 👤+🤖 |

**HH OAuth URL** (открыть как работодатель):
```
https://hh.ru/oauth/authorize?response_type=code&client_id=THFMPVJIDL4MHTM5EE4AFS96MTUDOFOF9UURDFI539OOJF8VCCLKJLENSOI0PCEJ&redirect_uri=https://recruiter-assistant.com/hh-callback/
```

**Production readiness gate** (перед включением `hh_send=true`):
- [ ] `/health` SHA верифицирован
- [ ] Public entrypoint smoke: `GET /` возвращает 2xx/3xx и не `{"error":"not_found"}`, `GET /login` возвращает HTML 200
- [ ] `pnpm test:all` зелёный
- [ ] Staging smoke: webhook → planned_message → "Отправить сейчас" → статус sent
- [ ] Staging smoke: "Заблокировать" → не отправляется
- [ ] Tenant isolation: токен Alpha не видит Beta
- [ ] Kill switch: `hh_send=false` → нет отправок, polling продолжается

#### Telegram — prod wiring (Фаза 4)

Код уже написан (iteration 6). Осталось подключить в проде:

| # | Что | Кто |
|---|-----|-----|
| 4.1 | `setWebhook` → `https://candidate-chatbot.recruiter-assistant.com/tg/webhook` | 🤖 |
| 4.2 | Seed подписок в `chatbot.recruiter_subscriptions` для `rec-tok-prod-001` | 🤖 |
| 4.3 | Написать `/start` боту `@hiring_agnet_bot` | 👤 |

---

### XP правила

- Каждая итерация начинается с failing теста
- Тест зелёный → и только тогда следующий шаг
- Не добавлять фичи без теста
- Не деплоить без зелёных тестов

### Документы спеки

Все в `docs/`:
- [`docs/spec-by-claude.md`](docs/spec-by-claude.md) — основной план (EP approach, архитектура, DB schema, XP итерации)
- [`docs/iteration-1-tz-and-test-data.md`](docs/iteration-1-tz-and-test-data.md) — конкретное ТЗ первой итерации и seed fixtures
- [`docs/access-readiness.md`](docs/access-readiness.md) — доступы, Neon org, GCP, env vars

Тестовые данные:
- [`tests/fixtures/iteration-1-seed.json`](tests/fixtures/iteration-1-seed.json) — вакансии, pipeline steps и candidate fixtures для Iteration 1
