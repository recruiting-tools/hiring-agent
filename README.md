# Hiring Agent V2

Система управления перепиской с кандидатами. Переписывание с нуля, параллельно с V1.

## Сервисы

| Сервис | Папка | Домен | Инфра |
|---|---|---|---|
| `candidate-chatbot` | `services/candidate-chatbot` | `https://<candidate-chatbot-host>` | Cloud Run |
| `hiring-mcp` | `services/hiring-mcp` | внутренний | GCP VM |
| `hiring-agent` | `services/hiring-agent` | `https://<hiring-agent-host>` | GCP VM |
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
V2_NEON_ORG_ID=<neon-org-id>
MANAGEMENT_DATABASE_URL=...   # management DB (shared, all tenants)
CHATBOT_DATABASE_URL=...      # demo tenant chatbot DB
GEMINI_API_KEY=...            # уже есть в shell
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=google/gemini-2.5-flash
OPENROUTER_SETUP_COMMUNICATION_PLAN_MODEL=openai/gpt-5.4-mini
OPENROUTER_SETUP_COMMUNICATION_EXAMPLES_MODEL=google/gemini-2.5-flash
OPENROUTER_CREATE_VACANCY_APPLICATION_STEPS_MODEL=openai/gpt-5.4-mini
```

## Архитектура — коротко

Кандидат пишет → `hh-connector` принимает и пишет в DB → `candidate-chatbot` читает pipeline state → LLM (Gemini Flash) генерирует ответ → `planned_messages` → cron отправляет через N минут (рекрутер может заблокировать).

Подробная спека: [`docs/spec-by-claude.md`](docs/spec-by-claude.md)

## Release Process

Каждая фича проходит через sandbox перед merge в main. Подробно: [`docs/release-process.md`](docs/release-process.md).
Для живых UI smoke и ручных browser-checks через сессию: [`docs/mcp-playwright-testing.md`](docs/mcp-playwright-testing.md).
Для параллельной работы агентов, делегирования между сессиями и чистых веток: [`ai-agent.md`](ai-agent.md).

**Локально перед PR:** `pnpm gate:sandbox`
**CI gate (авто):** `sandbox-gate` workflow — должен быть зелёным для merge
**Deploy (авто):** `deploy-prod` workflow запускается при merge в main

### PR From Session (Коротко)

1. Прогоняешь локальный gate:
```bash
pnpm gate:sandbox
```
2. Создаешь/обновляешь PR и добавляешь callback в body:
```bash
PR_NUM=<номер_pr>
RELAY_URL=<https://...>
SESSION_ID=<session_id>

BODY="$(gh pr view "$PR_NUM" --json body -q .body)"
printf "%s\n\n<!-- ci-callback: %s/api/sessions/%s/reply -->\n" \
  "$BODY" "$RELAY_URL" "$SESSION_ID" | gh pr edit "$PR_NUM" --body-file -
```
3. Ждешь `sandbox-gate` и callback в сессию (`success|failure` + ссылка на run).
4. Передаешь задачу deploy-сессии:
```bash
CORR_ID=$(uuidgen)
scripts/pr-worker.sh send-pr-ready \
  --to "<DEPLOY_SESSION_ID>" \
  --corr "$CORR_ID" \
  --branch "$(git rev-parse --abbrev-ref HEAD)" \
  --commit "$(git rev-parse HEAD)" \
  --pr-url "$(gh pr view "$PR_NUM" --json url -q .url)"
```
5. После merge проверяешь `deploy-prod` run и `/health`.

Ограничение callback:
- Маркер `ci-callback` в текущем pipeline отправляет только CI-статус.
- Review comments/threads из GitHub прилетают только если отдельно настроен webhook relay на review events.

### CI/CD Observability

Для GitHub Actions удобно смотреть так:

```bash
gh run list --limit 10
gh run watch <run-id> --exit-status
gh run view <run-id> --log-failed
```

Для `hiring-agent` deploy workflow:

- source of truth: `.github/workflows/deploy-hiring-agent.yml`
- deploy проверяет три слоя:
  - VM preflight
  - local VM runtime verify
  - public smoke

Быстрая диагностика:

- local VM verify failed, public smoke ещё не начался:
  проблема внутри VM/runtime/env/PM2
- local VM verify passed, public smoke failed:
  проблема в nginx, DNS, TLS или внешней маршрутизации
- `/health` надо читать вместе с:
  - `mode`
  - `deploy_sha`
  - `app_env`
  - `port`

Полезные команды:

```bash
# GitHub
gh run list --workflow "Deploy hiring-agent to VM" --limit 5
gh run view <run-id> --log-failed

# VM
ssh -i ~/.ssh/google_compute_engine <vm-user>@<vm-host>
pm2 list
pm2 logs hiring-agent
curl -sf http://127.0.0.1:3101/health | jq
ss -tlnp | grep ':3101 '
```

### Live Monitoring (hiring-agent)

Быстрый probe с локальной машины:

```bash
pnpm monitor:hiring-agent -- \
  --base-url https://<hiring-agent-host> \
  --ssh-target <vm-user>@<vm-host>
```

Что проверяет скрипт `scripts/monitor-hiring-agent.js`:
- `GET /health` (быстрый liveness: status/mode/app_env/port, без DB-lookup)
- `GET /health?details=1` можно использовать вручную для расширенной диагностики playbook registry
- `GET /login` (HTML 200)
- websocket probe (`/ws`)
- при `--ssh-target`: `pm2` состояние, local health (`127.0.0.1:3101`), счётчик upstream refused в `nginx error.log`

Опционально для полноценной auth + ws проверки:

```bash
MONITOR_EMAIL='operator@example.test' \
MONITOR_PASSWORD='<password>' \
pnpm monitor:hiring-agent -- --require-auth-ws --ssh-target <vm-user>@<vm-host>
```

Непрерывный watch:

```bash
watch -n 30 'pnpm monitor:hiring-agent -- --base-url https://<hiring-agent-host> --ssh-target <vm-user>@<vm-host>'
```

Пример cron (алерт в stderr/syslog по non-zero exit):

```cron
*/2 * * * * cd /opt/hiring-agent && MONITOR_BASE_URL=https://<hiring-agent-host> /usr/bin/node scripts/monitor-hiring-agent.js --ssh-target <vm-user>@localhost >> /var/log/hiring-agent-monitor.log 2>&1
```

### Password Rotation (Non-Demo Recruiter)

Для non-demo аккаунтов используйте отдельный скрипт ротации в `management.recruiters`.
По умолчанию он:
- обновляет `password_hash`;
- отзывает все активные `management.sessions` для рекрутера.

```bash
ROTATION_FILE="$HOME/.config/hiring-agent/credentials/management-password-rotation-$(date +%F).json"
mkdir -p "$(dirname "$ROTATION_FILE")"

MANAGEMENT_DATABASE_URL='<management-db-url>' \
pnpm auth:rotate-recruiter-password -- \
  --email recruiter@example.test \
  --json > "$ROTATION_FILE"

chmod 600 "$ROTATION_FILE"
jq -r '.generated_password' "$ROTATION_FILE"
```

Важно:
- `ROTATION_FILE` хранит новый пароль, не коммитить его в git.
- если нужно оставить текущие сессии активными, добавьте `--keep-sessions=true`.

### Demo Login Password Rotation

Для demo-аккаунта используется тот же скрипт, но удобнее запускать его либо с локально экспортированным `MANAGEMENT_DATABASE_URL`, либо с URL, вытащенным из production `.env`.

Сгенерировать новый случайный пароль:

```bash
MANAGEMENT_DATABASE_URL='<management-db-url>' \
node scripts/rotate-management-recruiter-password.js \
  --email demo@example.test \
  --json
```

Вывести только новый пароль:

```bash
MANAGEMENT_DATABASE_URL='<management-db-url>' \
node scripts/rotate-management-recruiter-password.js \
  --email demo@example.test \
  --json | jq -r '.generated_password'
```

Если `MANAGEMENT_DATABASE_URL` нужен именно из production VM:

```bash
MANAGEMENT_DATABASE_URL="$(
  ssh -i ~/.ssh/google_compute_engine <vm-user>@<vm-host> \
    \"grep '^MANAGEMENT_DATABASE_URL=' /opt/hiring-agent/.env | sed 's/^MANAGEMENT_DATABASE_URL=//'\" \
)" \
node scripts/rotate-management-recruiter-password.js \
  --email demo@example.test \
  --json
```

Если нужен свой пароль, а не случайный:

```bash
MANAGEMENT_DATABASE_URL='<management-db-url>' \
node scripts/rotate-management-recruiter-password.js \
  --email demo@example.test \
  --password 'YourNewPassword123' \
  --json
```

Что делает скрипт:
- находит рекрутера по `--email` или `--recruiter-id`;
- если `--password` не задан, генерирует случайный пароль внутри `scripts/rotate-management-recruiter-password.js`;
- обновляет `management.recruiters.password_hash`;
- по умолчанию отзывает все активные `management.sessions`.

### Chat Smoke (2 levels)

Быстрый smoke для `hiring-agent` чата:
Подробный runbook для новых сессий: [`docs/hiring-agent-chat-smoke-runbook.md`](docs/hiring-agent-chat-smoke-runbook.md)
MCP Playwright workflow для ручной UI-проверки: [`docs/mcp-playwright-testing.md`](docs/mcp-playwright-testing.md)

1) Demo level (локальный `APP_MODE=demo`, проверка API-контракта и ошибок):
```bash
pnpm smoke:hiring-agent:demo
```

2) Sandbox level (реальная auth + tenant DB + playbook runtime):
```bash
SANDBOX_URL='https://<sandbox-host>' \
SANDBOX_DEMO_EMAIL='<email>' \
SANDBOX_DEMO_PASSWORD='<password>' \
pnpm smoke:hiring-agent:sandbox
```

Для текущих slot URLs используйте:
- `sandbox-1` → `https://<hiring-agent-host>/sandbox-001`
- `sandbox-2` → `https://<hiring-agent-host>/sandbox-002`
- `sandbox-3` → `https://<hiring-agent-host>/sandbox-003`

Sandbox creds синхронизированы через GitHub Environments `sandbox-1/2/3`:
- `HIRING_AGENT_SANDBOX_DEMO_EMAIL`
- `HIRING_AGENT_SANDBOX_DEMO_PASSWORD`

Локальный шаблон лежит в `.env.sandbox.example`.

3) Оба уровня подряд:
```bash
SANDBOX_URL='https://<sandbox-host>' \
SANDBOX_DEMO_EMAIL='<email>' \
SANDBOX_DEMO_PASSWORD='<password>' \
pnpm smoke:hiring-agent:both
```

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

6. **DNS**: публичная зона и прод-хосты должны храниться в инфраструктурных секретах/vars и не хардкодиться в коде или runbook'ах public-репозитория.

7. **Домен**: используйте один canonical public domain и один canonical auth host для `hiring-agent`.

### Neon

- Org ID: `<neon-org-id>`
- Management DB project: `<management-project-id>`
- Dev client DB project: `<dev-client-project-id>`
- API key: `NEON_API_KEY`
- В `neonctl` командах явно указывайте `--org-id` и `--project-id`

### GCP

| Ресурс | Значение |
|---|---|
| Deploy-проект | `<gcp-project-id>` |
| Регион | `europe-west1` |
| VM IP | `<vm-public-ip>` |
| VM hostname | `<vm-hostname>` |
| VM user | `<vm-user>` (SSH: `~/.ssh/google_compute_engine`) |
| VM app dir | `/opt/hiring-agent` |
| PM2 process | `hiring-agent` (порт 3101) |
| Port 3100 | Skillset Next.js app — не трогать |
| SSL cert | `/etc/letsencrypt/live/<hiring-agent-host>/` (certbot, автообновление) |
| DNS зона | `<dns-zone>` в проекте `<dns-project-id>` |

**SSH на VM:**
```bash
ssh -i ~/.ssh/google_compute_engine <vm-user>@<vm-host>
```

**Управление сервисом:**
```bash
# На VM:
pm2 list
pm2 logs hiring-agent
pm2 restart hiring-agent --update-env
```

**Важно для логина hiring-agent:**
`https://<hiring-agent-host>/login` использует `management.recruiters` и `management.sessions`.
Если нужно завести или обновить demo/login доступ для `hiring-agent`, canonical path — `pnpm bootstrap:demo-user`,
а не legacy script `pnpm bootstrap:recruiter-access`, который меняет только `chatbot.recruiters`.

**Добавить DNS-запись:**
```bash
gcloud dns record-sets create <name>.<public-domain>. \
  --zone=<dns-zone> \
  --project=<dns-project-id> \
  --account=<gcp-account-email> \
  --type=A --ttl=300 --rrdatas=<IP>
```

Подробно: [`docs/google-cloud-playbooks.md`](docs/google-cloud-playbooks.md)

### Deploy — candidate-chatbot

```bash
./scripts/deploy.sh   # сборка образа + деплой (два шага, не --source)
```

**Gotchas:**

1. **НЕ использовать `--source` напрямую** — зависает в агент-сессии (exit 144). `deploy.sh` делает `gcloud builds submit` + `gcloud run deploy --image` раздельно.

2. **Domain mapping** — выполнять только из аккаунта, на котором подтвержден публичный домен:
   ```bash
   gcloud config set account <gcp-account-email>
   gcloud beta run domain-mappings create \
     --service=candidate-chatbot-v2 \
     --domain=<candidate-chatbot-host> \
     --region=europe-west1 \
     --project=<gcp-project-id>
   gcloud config set account <default-gcloud-account>   # вернуть
   ```
   Используйте только тот аккаунт, на котором подтвержден домен.

3. **CNAME** `<candidate-chatbot-host> → ghs.googlehosted.com` должен быть заранее настроен.

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
| 3.7 | Откликнуться на тестовую HH-вакансию | 👤 |
| 3.8 | Включить отправку: `UPDATE management.feature_flags SET enabled=true WHERE flag='hh_send'` | 👤+🤖 |

**HH OAuth URL** (открыть как работодатель):
```
https://hh.ru/oauth/authorize?response_type=code&client_id=<hh-client-id>&redirect_uri=https://<public-domain>/hh-callback/
```

**Production readiness gate** (перед включением `hh_send=true`):
- Перед production-выкатыванием обязательно пройдите:
  - `pnpm check:hh-cutover-readiness`
  - [`docs/hh-cutover-deploy-runbook-128.md`](docs/hh-cutover-deploy-runbook-128.md)
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
| 4.1 | `setWebhook` → `https://<candidate-chatbot-host>/tg/webhook` | 🤖 |
| 4.2 | Seed подписок в `chatbot.recruiter_subscriptions` для `<prod-recruiter-token>` | 🤖 |
| 4.3 | Написать `/start` боту `@hiring_agnet_bot` | 👤 |

---

### XP правила

- Каждая итерация начинается с failing теста
- Тест зелёный → и только тогда следующий шаг
- Не добавлять фичи без теста
- Не деплоить без зелёных тестов

### E2E Delivery — Claude as Orchestrator

**Read:** `/Users/vova/Documents/GitHub/claude-session-manager/docs/e2e-delivery-skill.md`

Short version:
- **Claude** = orchestrator + reviewer. Does not write code (exceptions: ≤5 trivial lines, or Codex failed 2×).
- **Codex** = coder. All non-trivial implementation delegated via Session Manager (`agent: "codex"`, `path` = this repo root).
- **Done** = deployed to prod + CI green + smoke test passing. Not just "code written".

Per-task cycle: Claude describes task → Codex implements → Claude reviews → OK or NEEDS_FIX → repeat → PR → deploy.

### Workflow: Code Review & Risky Changes

- **Delegation + coordinator rules**: [`/Users/vova/Documents/GitHub/claude-session-manager/docs/delegation-guide.md`](../claude-session-manager/docs/delegation-guide.md)
- **Risky schema changes**: before merging, create an ephemeral Neon branch via `scripts/create-feature-branch.sh <pr-N>`, run migrations + targeted tests, then delete the branch. See [`docs/neon-sandbox-runbook.md`](docs/neon-sandbox-runbook.md).
- **Session isolation**: start each coding session in a dedicated Git worktree from `origin/main`: `scripts/new-session-worktree.sh <slug> [branch-name]`. This prevents mixing in-progress edits between parallel sessions.
- **Sandbox gate**: before promoting to production, all of `pnpm test:all`, `pnpm test:sandbox`, `pnpm smoke:sandbox` must pass on a seeded sandbox. CI enforces this via `.github/workflows/sandbox-release-gate.yml`.

### Документы спеки

Все в `docs/`:
- [`docs/spec-by-claude.md`](docs/spec-by-claude.md) — основной план (EP approach, архитектура, DB schema, XP итерации)
- [`docs/iteration-1-tz-and-test-data.md`](docs/iteration-1-tz-and-test-data.md) — конкретное ТЗ первой итерации и seed fixtures
- [`docs/access-readiness.md`](docs/access-readiness.md) — доступы, Neon org, GCP, env vars

Тестовые данные:
- [`tests/fixtures/iteration-1-seed.json`](tests/fixtures/iteration-1-seed.json) — вакансии, pipeline steps и candidate fixtures для Iteration 1
