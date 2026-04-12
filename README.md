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
