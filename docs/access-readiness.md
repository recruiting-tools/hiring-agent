# Access Readiness — Claude Review

*2026-04-12 | на основе live-проверок env, GCP, DNS, CI secrets*

---

## Что codex нашёл верно

- GitHub: admin на всех repos — подтверждено
- `project-5d8dd8a0-67af-44ba-b6e` недоступен для `vladimir@skillset.ae` — подтверждено
- Текущий `NEON_API_KEY` в shell битый — подтверждено (но другая причина — см. ниже)
- `chat.` и `api.` заняты — подтверждено DNS-дампом

---

## Новые находки из live-проверок

### 1. GEMINI_API_KEY уже есть в shell

```
GEMINI_API_KEY=AIzaSyCMeG5x1ciQJENC60Nkb5K8gliplb8NtNM  ✅
```

LLM-блокер снят. Для overnight Level 1 (local MVP + real LLM) — этого достаточно.

### 2. CI secrets богаче чем ожидалось

В `recruiting-tools/recruiting-ci-cd` уже есть:

| Secret | Статус |
|---|---|
| `MANAGEMENT_DB_URL` | ✅ есть |
| `OPENROUTER_API_KEY` | ✅ есть (альтернатива Gemini) |
| `APPLY_NEON_CONNECTION_STRING` | ✅ есть |
| `CANDIDATE_ROUTER_API_TOKEN` | ✅ есть |
| `GH_TOKEN_DEPLOY` | ✅ есть |

**Нужно вытащить `MANAGEMENT_DB_URL` локально** — это ключевой секрет для management DB registry.

### 3. NEON_API_KEY: ключ работает, но неправильный

Текущий ключ в shell (`~69 chars`) делает `neonctl projects list` успешно, но показывает только 1 проект:
```
square-art-34389733 — recruiter-data-layer-demo
```

Правильный ключ (из оригинального сообщения) показывает 4 проекта включая Management DB.

**Вывод**: в shell лежит чей-то другой/старый ключ. Нужно заменить на правильный.

### 4. DNS-зона в skillset-analytics-487510 — доступна текущим аккаунтом

DNS zone `recruiter-assistant` managed в `skillset-analytics-487510` (не в Ludmila-проекте). Текущий `vladimir@skillset.ae` имеет read доступ. Проверить write:

```bash
gcloud dns record-sets create hiring-chat.recruiter-assistant.com. \
  --zone=recruiter-assistant \
  --project=skillset-analytics-487510 \
  --type=A --ttl=300 --rrdatas=1.2.3.4
# если ошибка — нужна роль DNS Administrator на проект
```

Если write не работает — достаточно подтвердить, и я дам готовые `gcloud` команды, ты вставишь сам.

### 5. Полный список занятых DNS записей

| Субдомен | IP/Target | Что это |
|---|---|---|
| `recruiter-assistant.com` | 199.36.158.100 | apex |
| `www.` | 199.36.158.100 | |
| `agent.` | **34.31.217.176** | GCP VM (текущий hiring agent) |
| `api.` | 34.111.102.168 | Cloud LB — **занято** |
| `apply.` | ghs.googlehosted.com | Firebase/GHS |
| `ai-interview.` | ghs.googlehosted.com | interview engine |
| `bot.` | 34.28.224.134 | Cloud Run |
| `chat.` | 34.38.129.97 | Cloud Run — **занято** |
| `i.` | 34.28.224.134 | CDN worker |
| `send.` | SES MX | email sending |

Свободны для V2: `hiring-chat.` и `candidate-chatbot.` — без изменений.

---

## Уточнённый статус по уровням

### Level 0 — Spec + локальный код (без внешних сервисов)

| Что нужно | Статус |
|---|---|
| GitHub read/write | ✅ |
| Node/pnpm/psql | ✅ |
| Mock LLM | ✅ |
| Repo name decision | ❓ нужно подтвердить |

**Готов прямо сейчас.**

### Level 1 — Local MVP с реальным Postgres и реальным LLM

| Что нужно | Статус | Действие |
|---|---|---|
| `NEON_API_KEY` | ⚠️ неправильный в shell | Исправить (см. ниже) |
| `MANAGEMENT_DB_URL` | ✅ в CI secrets | Вытащить локально |
| `GEMINI_API_KEY` | ✅ уже в shell | Ничего |
| V2 staging/dev Neon DB | ❓ | Создать ветку или новый проект через Neon CLI |
| Repo создан | ❓ | Подтвердить имя |

**Готов после 3 действий ниже.**

### Level 2 — Staging deploy на GCP

| Что нужно | Статус | Действие |
|---|---|---|
| GCP Viewer на Ludmila project | ❌ | Зайти с ludmila аккаунтом, выдать |
| Cloud Run Admin | ❌ | То же |
| DNS write | ❓ | Проверить командой выше |
| V2 Cloud Run service account | ❌ | Создать |

**Blocker: Ludmila GCP.** Не нужно для overnight MVP.

---

## 3 действия чтобы я мог работать пока ты спишь

Всё это делается за 5 минут:

### Действие 1: Создать новый Neon org для V2 (полная изоляция от V1)

**Почему отдельный org, а не проект в том же аккаунте:**
- Агент не может случайно попасть в V1 проект
- `neonctl` без флага `--project-id` видит только V2
- Billing разделён — видно сколько стоит V2
- Можно нуллировать V2 без малейшего риска для V1

**Статус: ✅ создано 2026-04-12**

Org: `hiring agent` | ID: `org-bold-wave-46400152`
Тот же API key что и V1 (один аккаунт, разные org) — `neonctl` различает через `--org-id`.

| Проект | Project ID | Назначение |
|---|---|---|
| `v2-management-db` | `orange-silence-65083641` | Registry клиентов V2 |
| `v2-dev-client` | `round-leaf-16031956` | Dev/staging клиентская база |

Добавить в `~/.zshrc` (connection strings — в чате, не в файле):

```bash
export V2_NEON_ORG_ID=org-bold-wave-46400152
export V2_MANAGEMENT_DB_URL=<см. чат>
export V2_DEV_NEON_URL=<см. чат>
# NEON_API_KEY не меняем — тот же ключ работает для обоих org
```

**V1 не затронут** — другой org_id, агент не увидит V1 проекты при работе с V2.

### Действие 2: Подтвердить имя репозитория

Рекомендую: `recruiting-tools/hiring-agent-v2`, private.
Или другое — скажи и я создам.

---

## Что я делаю ночью (Level 1)

После трёх действий выше могу автономно:

- [x] Создать новый репо с monorepo структурой
- [x] Написать `CLAUDE.md` с guardrails для агентов
- [x] `docs/legacy-map.md` и `docs/architecture-decisions.md`
- [x] DB migrations (schema из плана) против Neon staging branch
- [x] Iteration 0-2: failing tests → green → pipeline reducer
- [x] Pipeline template seed (повар, менеджер продаж, курьер)
- [x] Детерминированный validator после LLM
- [x] `planned_messages` логика + window-to-reject
- [x] Базовый webhook endpoint
- [x] CI workflow draft (без деплоя, только тесты)

**Не делаю без дополнительных доступов:**
- Реальный HH connector (нужен `HH_CONNECTOR_URL` + secret)
- Staging deploy на Cloud Run (нужен Ludmila GCP)
- DNS записи (нужен write или твоё подтверждение)
- Telegram (нужен `TELEGRAM_BOT_TOKEN`)

---

## Что добавить в CI secrets когда будет нужно (Level 2)

Сейчас нет, но понадобится для staging deploy:

```
V2_NEON_STAGING_URL         — staging Neon branch connection string
V2_GEMINI_API_KEY           — LLM key (или переиспользовать OPENROUTER_API_KEY)
V2_GCP_WIF_PROVIDER         — Workload Identity Federation для Ludmila project
V2_GCP_SERVICE_ACCOUNT      — Cloud Run deploy SA email
HH_CONNECTOR_URL            — (отложить до HH интеграции)
HH_CONNECTOR_SECRET         — (отложить)
INTERVIEW_ENGINE_URL        — (отложить до tool-call итерации)
TELEGRAM_BOT_TOKEN          — (отложить до Telegram итерации)
```

---

## Ключевое отличие от codex-плана по Neon

Codex предлагал подключиться к существующей management DB из V1 (`MANAGEMENT_DB_URL` в CI secrets). Это неверно.

**Правило: V2 живёт в отдельном Neon org — нет ни одной общей таблицы с V1.**

Причины:
- Агент не может случайно мигрировать/дропнуть V1 данные
- V1 management DB содержит production tenant credentials — нельзя давать агенту доступ
- Четкая граница: `V2_NEON_API_KEY` видит только V2 проекты, `NEON_API_KEY` — только V1

Management DB для V2 создаётся с нуля в новом org — минут 10 работы, зато полная изоляция.
