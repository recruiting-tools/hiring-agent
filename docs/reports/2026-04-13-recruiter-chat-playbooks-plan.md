# Recruiter Chat And Playbooks Plan

Дата: 2026-04-13

## 1. Текущее состояние

По текущему состоянию репозитория recruiter-facing chat-агента ещё нет.

Что есть сейчас:

- `services/candidate-chatbot/` — рабочий runtime для общения с кандидатами.
- `services/hh-connector/` — импорт и отправка через HH.
- recruiter moderation UI внутри `candidate-chatbot`: логин `/login`, очередь `/recruiter/:token`, approve / block planned messages.
- отчёты и research в `docs/reports/` и `scripts/generate-evaluation-report.js`.

Чего нет сейчас:

- реализованного сервиса в `services/hiring-agent/`
- реализованного сервиса в `services/hiring-mcp/`
- recruiter chat UI с диалогом и playbook routing
- playbook runtime для recruiter use cases

Вывод: сейчас есть report/research слой и moderation UI, но не отдельный агент-чаты для рекрутера.

## 2. Продуктовая рамка для первого релиза

Для демо не нужно делать общий умный агент "на всё". Лучше сделать recruiter chat как thin shell над ограниченным набором playbooks.

Важно для PR 1: recruiter chat делаем stateless. Без новых таблиц `chat_sessions` / `chat_messages` и без миграций под persistent chat history. История живёт только в UI-сессии браузера. Persistent storage переносится в следующий этап.

Рекомендуемая модель:

- все playbooks можно хранить в registry
- в аккаунте клиента включена только малая allowlist
- если найден playbook, но он выключен, UI показывает, что capability существует, но не включена
- если playbook не найден, отдаётся обычный fallback-ответ без ложного обещания функционала

Это даёт:

- не удаляем заготовленные playbooks
- не ломаем UX на недоделанных сценариях
- создаём ощущение расширяемого продукта
- сохраняем архитектурную чистоту через feature gating

## 3. Рекомендуемая архитектура

### 3.1 Базовые сущности

- `playbook_definitions`
- `client_playbook_access`
- `chat_sessions`
- `chat_messages`

### 3.2 Runtime flow

1. Recruiter пишет сообщение.
2. Router определяет intent.
3. Router ищет подходящий playbook.
4. Проверяется client entitlement.
5. Дальше один из трёх исходов:
   - `enabled` → playbook исполняется
   - `disabled` → показываем locked state
   - `not_found` → обычный fallback

### 3.3 Технические слои

- `services/hiring-agent/`:
  - recruiter chat HTTP/UI
  - chat session handling
  - playbook router
  - response rendering
- `services/hiring-mcp/`:
  - инструменты доступа к данным
  - выборки кандидатов
  - агрегации funnel / status
  - генерация draft plans

Ключевой принцип: playbook не должен напрямую рисовать UI. Playbook возвращает структурированный payload, а UI слой его рендерит.

Важно для PR 1: `hiring-mcp` не входит в scope. `hiring-agent` использует локальный read-only query module внутри своего сервиса. После стабилизации contract этот слой можно вынести в `hiring-mcp` отдельным PR.

## 4. Три стартовых playbook-сценария

### 4.1 Visualize Candidate Funnel

Запросы:

- "Визуализируй воронку по кандидатам"
- "Покажи статусы кандидатов"
- "Сколько людей дошло до каждого этапа"

Что делает:

- получает агрегаты по goal-based шагам, а не по HH-статусам
- показывает основной progression path
- отдельно показывает exit branches: rejected, disqualified, stuck / waiting, no response

Источник данных для PR 1: локальный adapter поверх runtime-shaped данных. Он должен быть first-class deliverable, а не временной сноской. Его контракт должен быть стабильным и независимым от будущего mart.

Рекомендация по UX:

- не рисовать "красивую маркетинговую воронку"
- основа — табличный view + branch badges + inline bars
- сверху summary cards
- ниже matrix/table по шагам

Это самый безопасный первый playbook: mostly read-only, не требует отправки сообщений и хорошо смотрится в демо.

### 4.2 Build Communication Plan

Запросы:

- "Подготовь план коммуникации по вакансии"
- "Настрой скрининг"
- "Сделай pipeline общения"

Что делает:

- выбирает ближайший шаблон по типу вакансии
- выдаёт draft плана
- предлагает добавить / убрать шаги
- может остановиться на скрининге или построить путь до конца

Нужно хранить starter templates для нескольких классов ролей: IT, blue collar, массовый найм, sales, async remote.

### 4.3 Broadcast To Candidate Segment

Запросы:

- "Напиши всем кандидатам со знанием китайского"
- "Отправь ссылку на календарь всем после скрининга"
- "Покажи выборку и подготовь сообщение"

Что делает:

- строит сегмент
- показывает preview списка кандидатов
- генерирует draft сообщения
- отправляет в существующий moderation/report flow на подтверждение

Это третий playbook и самый рискованный на старте, потому что затрагивает массовую отправку.

## 5. Что делать первым

Рекомендация: первым делать `Visualize Candidate Funnel`.

Почему:

- минимальный операционный риск
- высокий demo value
- помогает определить общий playbook contract
- позволяет сразу придумать reusable recruiter chat shell

## 6. Разбиение на PR

### PR 1. Recruiter Chat Shell + Playbook Gating + Funnel Demo

Scope:

- каркас `services/hiring-agent`
- чатовый UI для рекрутера
- playbook router
- registry playbooks
- entitlement / disabled-state
- один рабочий playbook: funnel visualization
- stateless recruiter chat без DB migrations
- local funnel query module внутри `hiring-agent`
- pattern-based intent router
- тесты на router, funnel adapter и HTTP integration

### PR 2. Communication Plan Playbook

Scope:

- шаблоны планов коммуникации
- подбор ближайшего шаблона
- редактирование шагов
- сохранение draft configuration

### PR 3. Candidate Broadcast Playbook

Scope:

- candidate segment builder
- preview selection
- message composer
- handoff в существующий moderation/report flow

## 7. Детали PR 1

Минимальный вертикальный slice:

- `services/hiring-agent/src/server.*`
- `services/hiring-agent/src/playbooks/registry.*`
- `services/hiring-agent/src/playbooks/router.*`
- `services/hiring-agent/src/playbooks/funnel-visualization.*`
- `services/hiring-agent/src/ui/*`
- read-only data adapter для funnel metrics

Router для PR 1 должен быть deterministic: keyword / pattern matching без LLM-classifier.

Важно не привязывать funnel playbook к HH statuses. Источник должен быть goal-based. Если mart ещё не готов, на первом этапе можно сделать адаптер поверх текущих runtime tables, но через отдельный query layer, чтобы потом заменить на mart без переписывания UI и playbook logic.

Минимальный стабильный контракт адаптера для PR 1:

- `step_name`
- `total`
- `in_progress`
- `completed`
- `stuck`
- `rejected`

## 8. Что пока не делать

- не делать общий "LLM-агент" без жёстких маршрутов
- не смешивать playbook execution и HTML rendering
- не добавлять массовую отправку в первом PR
- не строить сложный funnel SVG/graph до появления реальных примеров

## 9. Следующий практический шаг

1. Описать data contract funnel visualization.
2. Собрать 3-5 реалистичных funnel examples.
3. Выбрать один UI concept для таблицы + branch indicators.
4. Под этот contract поднять каркас `services/hiring-agent`.

## 10. Test Gates For PR 1

Перед реализацией и по ходу итераций нужны failing tests минимум на:

- router contract: сообщение → ожидаемый `playbook_key`
- locked playbook contract: выключенный playbook → `playbook_locked`
- funnel adapter contract: runtime-shaped input → стабильный aggregate output
- HTTP integration: `POST /api/chat` возвращает `render_funnel` для funnel intent
