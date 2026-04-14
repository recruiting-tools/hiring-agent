# Spec: Data Model для Playbooks

**Статус:** черновик для ревью  
**Связанный шит:** [Google Sheets — playbooks](https://docs.google.com/spreadsheets/d/1vpx6Z-LnngQhDg80sGQlC7VEtwvAkhHBhwIB8mZBUxg)

---

## 1. Что такое плейбук

Плейбук — это сценарий, по которому агент ведёт рекрутера. Состоит из шагов. На каждом шаге агент либо что-то спрашивает у рекрутера, либо делает работу (запрашивает данные, вызывает LLM, показывает результат).

Агент выполняет шаги последовательно, накапливая контекст в рамках сессии.

### Вакансия как UI-контекст

**Предположение:** вакансия выбирается один раз на уровне интерфейса (селект в шапке или сайдбаре) и остаётся активной на всю сессию работы рекрутера. Все плейбуки работают в контексте этой вакансии.

Следствия:
- Шага "выбрать вакансию" **нет** внутри плейбуков
- Тип шага `vacancy_select` не нужен
- Каждый плейбук начинается с **шага 0** — автоматической загрузки данных текущей вакансии из БД (не показывается рекрутеру, выполняется в фоне)
- `vacancy_id` инжектируется в `session.context` при старте плейбука из UI-состояния

Исключение: плейбук `create_vacancy` — не требует шага 0 (он сам создаёт вакансию).

---

## 2. Реальные примеры вакансий (основа для модели)

Эти примеры — основа для понимания что нужно хранить.

### Плиточник

**Цель найма:** договориться о стажировочном / пробном рабочем дне с опытным мастером.

**Шаги разговора с кандидатом:**

| # | Что проверяем | Как |
|---|---|---|
| 1 | Опыт по специальностям: штукатур-маляр, плиточник, отделочник, сантехник, мастер по внутренней отделке | Приветствуем, хвалим за опыт если он в резюме есть и он релевантен. Уточняем если не указано. |
| 2 | Наличие своего инструмента | Говорим что формат работы такой — у мастеров свой инструмент. Подходит ли кандидату? |
| 3 | Готовность к условиям оплаты | Говорим что за смену 4 000 ₽. Подходит ли? |
| 4 | **Целевое действие:** стажировочный день | Объясняем: приедете на смену к опытному мастеру, посмотрите как устроено, попробуете поработать вместе. Если всё ок — двигаемся дальше. |

### Промоутер

**Цель найма:** договориться о первом выезде и связать кандидата с супервайзером.

| # | Что проверяем | Как |
|---|---|---|
| 1 | Опрятный внешний вид и хороший разговорный русский язык | Уточняем |
| 2 | Готовность работать 6 часов на улице | Уточняем |
| 3 | Готовность к оплате 1 800 ₽ за смену | Уточняем |
| 4 | **Целевое действие:** первый выезд | Согласовываем дату, передаём супервайзеру |

### Ключевое наблюдение

Каждый шаг — это разговорный чекпойнт: агент **говорит что-то конкретное** и **получает подтверждение от кандидата**. Шаги не абстрактные ("скрининг"), а предметные ("подтвердить наличие своего инструмента").

У каждого шага есть:
- **Что** проверяем
- **Как** говорим (скрипт / подход)
- **Тип**: must_have / condition / target_action

---

## 3. Таблицы в PostgreSQL

### 3.1 management.vacancies

```sql
CREATE TABLE IF NOT EXISTS management.vacancies (
  vacancy_id        TEXT PRIMARY KEY DEFAULT 'vac-' || gen_random_uuid()::TEXT,
  tenant_id         TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  created_by        TEXT REFERENCES management.recruiters(recruiter_id),

  title             TEXT NOT NULL,
  raw_text          TEXT,             -- загруженные материалы до обработки

  must_haves        JSONB NOT NULL DEFAULT '[]',
  nice_haves        JSONB NOT NULL DEFAULT '[]',
  work_conditions   JSONB NOT NULL DEFAULT '{}',
  application_steps JSONB NOT NULL DEFAULT '[]',  -- см. §3.2
  company_info      JSONB NOT NULL DEFAULT '{}',
  faq               JSONB NOT NULL DEFAULT '[]',  -- [{q, a}] — частые вопросы кандидатов

  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'partial', 'complete')),

  status            TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),

  hh_vacancy_id     TEXT,
  hh_vacancy_url    TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.2 Схема поля application_steps

Это главное поле — отличается от стандартных "этапов воронки".

```json
[
  {
    "name": "Проверка опыта по специальностям",
    "type": "must_have_check",
    "what": "Наличие опыта: штукатур-маляр, плиточник, отделочник, сантехник",
    "script": "Приветствуем. Если в резюме есть релевантный опыт — отмечаем это. Если не указан — уточняем.",
    "in_our_scope": true,
    "is_target": false
  },
  {
    "name": "Подтверждение условий — инструмент",
    "type": "condition_check",
    "what": "Кандидат работает со своим инструментом",
    "script": "Говорим: у нас принято что мастера работают со своим инструментом. Это подходит?",
    "in_our_scope": true,
    "is_target": false
  },
  {
    "name": "Подтверждение условий — оплата",
    "type": "condition_check",
    "what": "4 000 ₽ за смену",
    "script": "Говорим: оплата 4 000 ₽ за смену. Это подходит?",
    "in_our_scope": true,
    "is_target": false
  },
  {
    "name": "Стажировочный день",
    "type": "target_action",
    "what": "Договориться о стажировочном дне с опытным мастером",
    "script": "Объясняем формат: вы приедете на смену к опытному мастеру, посмотрите как всё устроено, немного поработаете вместе. Если всё ок — двигаемся дальше.",
    "in_our_scope": true,
    "is_target": true
  }
]
```

**Типы шагов кандидата:**
- `must_have_check` — проверяем обязательное требование
- `condition_check` — кандидат подтверждает условие (инструмент, оплата, расписание)
- `target_action` — финальное действие которое мы хотим получить (пробный день, первый выезд, интервью)
- `employer_action` — шаг на стороне работодателя (не наша зона, но надо учитывать)

### 3.3 Схемы остальных полей вакансии

**must_haves / nice_haves** — массив строк:
```json
["Опыт плиточника от 1 года", "Наличие своего инструмента"]
```

**work_conditions:**
```json
{
  "pay_per_shift": 4000,
  "currency": "RUB",
  "shift_duration_hours": 8,
  "location": "Москва",
  "remote": false,
  "schedule": "сменный",
  "tools_own": true,
  "perks": []
}
```

**company_info:**
```json
{
  "name": "Название компании",
  "description": "Краткое описание",
  "notes": "Особенности"
}
```

---

### 3.4 management.playbook_definitions

```sql
CREATE TABLE IF NOT EXISTS management.playbook_definitions (
  playbook_key        TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  trigger_description TEXT,           -- когда этот плейбук предлагать
  keywords            TEXT[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'beta', 'coming_soon', 'deprecated')),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Плейбуки:**

| playbook_key | Название |
|---|---|
| `setup_communication` | Настрой общение с кандидатами по вакансии |
| `create_vacancy` | Создать новую вакансию |
| `view_vacancy` | Посмотреть информацию по вакансии |
| `mass_broadcast` | Массовая рассылка сообщения |
| `candidate_funnel` | Воронка по кандидатам |

---

### 3.5 management.playbook_steps

```sql
CREATE TABLE IF NOT EXISTS management.playbook_steps (
  step_key     TEXT PRIMARY KEY,       -- напр. "create_vacancy.3"
  playbook_key TEXT NOT NULL REFERENCES management.playbook_definitions(playbook_key) ON DELETE CASCADE,
  step_order   INTEGER NOT NULL,
  name         TEXT NOT NULL,
  step_type    TEXT NOT NULL
    CHECK (step_type IN (
      'auto_fetch',      -- шаг 0: автозагрузка данных из БД, не показывается рекрутеру
      'buttons',         -- кнопки с вариантами
      'user_input',      -- свободный текст от рекрутера
      'data_fetch',      -- SQL-запрос в БД (показывается рекрутеру)
      'llm_extract',     -- LLM → структурированные данные
      'llm_generate',    -- LLM → текст / HTML
      'decision',        -- проверка условий, роутинг
      'display',         -- показать данные, опциональные кнопки
      'subroutine'       -- вызов другого плейбука
    )),
  user_message    TEXT,     -- что агент говорит рекрутеру (для display/input/buttons)
  prompt_template TEXT,     -- LLM-промпт (для llm_extract / llm_generate)
  context_key     TEXT,     -- куда сохранить результат в session.context
  db_save_column  TEXT,     -- для llm_extract: колонка в management.vacancies для UPDATE
  next_step_order INTEGER,  -- следующий шаг по умолчанию (NULL = конец)
  options         TEXT,     -- для buttons/display: варианты через ";"
  routing         JSONB,    -- явное ветвление: {"Подтвердить": 4, "Изменить": 2}
  notes           TEXT,     -- внутренние заметки
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (playbook_key, step_order)
);
```

---

### 3.6 management.playbook_sessions (runtime)

```sql
CREATE TABLE IF NOT EXISTS management.playbook_sessions (
  session_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  recruiter_id     TEXT REFERENCES management.recruiters(recruiter_id),
  conversation_id  TEXT,

  playbook_key     TEXT NOT NULL REFERENCES management.playbook_definitions(playbook_key),
  current_step_order INTEGER,

  -- всё что накоплено: vacancy_id, extracted fields, user choices
  context          JSONB NOT NULL DEFAULT '{}',

  -- стек для subroutine: [{playbook_key, return_step_order}]
  call_stack       JSONB NOT NULL DEFAULT '[]',

  status           TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'aborted', 'error')),

  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);
```

### 3.7 management.tenant_playbook_access

```sql
CREATE TABLE IF NOT EXISTS management.tenant_playbook_access (
  tenant_id    TEXT NOT NULL REFERENCES management.tenants(tenant_id),
  playbook_key TEXT NOT NULL REFERENCES management.playbook_definitions(playbook_key) ON DELETE CASCADE,
  enabled      BOOLEAN NOT NULL DEFAULT false,
  enabled_at   TIMESTAMPTZ,
  enabled_by   TEXT,
  notes        TEXT,
  PRIMARY KEY (tenant_id, playbook_key)
);
```

---

## 4. Шаги плейбуков

### 4.1 create_vacancy

Единственный плейбук без шага 0 — сам создаёт вакансию.

| order | step_type | name | что происходит |
|---|---|---|---|
| 1 | `user_input` | Загрузить материалы | Рекрутер вставляет текст. Агент делает INSERT в vacancies со status='draft'. |
| 2 | `llm_extract` | Извлечь must haves | LLM из raw_text → массив строк. UPDATE vacancies SET must_haves. |
| 3 | `decision` | Проверить must haves | <2 → уточнить; ≥5 → спросить верно ли; 2–4 → продолжить автоматически. |
| 4 | `llm_extract` | Извлечь nice haves | LLM → массив строк. UPDATE. |
| 5 | `display` | Показать nice haves | Показать + кнопки «Уточнить / Продолжить». |
| 6 | `llm_extract` | Извлечь условия работы | LLM → work_conditions JSON. UPDATE. |
| 7 | `display` | Показать условия | Показать + кнопки «Уточнить / Продолжить». |
| 8 | `llm_extract` | Извлечь шаги найма | LLM → application_steps JSON (name/type/what/script/in_our_scope/is_target). UPDATE. |
| 9 | `display` | Показать шаги найма | Показать + кнопки «Скорректировать / Всё верно». |
| 10 | `llm_extract` | Извлечь инфо о компании | LLM → company_info JSON. UPDATE. |
| 11 | `display` | Показать инфо о компании | Показать + кнопки «Уточнить / Продолжить». |
| 12 | `llm_generate` | Сгенерировать FAQ | LLM генерирует частые вопросы и ответы на основе всех данных вакансии. Сохраняет в vacancy.faq. |
| 13 | `display` | Показать FAQ | Показать список Q&A + «Добавить вопрос / Всё верно». |
| 14 | `buttons` | Что делаем дальше? | «Настроить общение с кандидатами» → setup_communication / «Готово». |

### 4.2 setup_communication

| order | step_type | name | что происходит |
|---|---|---|---|
| 0 | `auto_fetch` | Загрузить данные вакансии | SELECT всех полей из vacancies по vacancy_id из UI-контекста. Не показывается рекрутеру. |
| 1 | `llm_generate` | Составить варианты плана коммуникации | На основании application_steps генерирует ровно 4 варианта последовательности шагов. |
| 2 | `display` | Показать варианты, предложить выбрать | Показать таблицей + кнопки «Вариант 1/2/3/4 / Уточнить». Сохраняет выбранный ярлык варианта. |
| 3 | `llm_generate` | Сгенерировать примеры сообщений кандидату | 3 реалистичных первых сообщения, HTML. Находит выбранный вариант внутри `communication_plan_options`. |
| 4 | `display` | Показать примеры сообщений | Показать + «Использовать / Уточнить». |
| 5 | `buttons` | Выбрать режим подключения | «Полная автоматизация / Пре-модерация с таймаутом / Только уведомления». |

### 4.3 view_vacancy

| order | step_type | name | что происходит |
|---|---|---|---|
| 0 | `auto_fetch` | Загрузить данные вакансии | SELECT всех полей. Не показывается рекрутеру. |
| 1 | `display` | Показать все данные вакансии | Рендерит все поля структурировано. |

### 4.4 mass_broadcast

| order | step_type | name | что происходит |
|---|---|---|---|
| 0 | `auto_fetch` | Загрузить данные вакансии | SELECT. Не показывается рекрутеру. |
| 1 | `user_input` | Запросить критерий выборки | Рекрутер описывает кого выбрать. |
| 2 | `llm_extract` | Обработать критерий | Преобразует запрос в безопасный structured filter: `{type, description, review_summary, exact_filter?, fuzzy_query?, threshold?}`. |
| 3 | `display` | Уточнить логику у рекрутера | Показывает `review_summary`, даёт маршруты «Подтвердить / Изменить порог / Изменить критерий». |
| 4 | `data_fetch` | Получить кандидатов для рассылки | Через fetch source `mass_broadcast_candidates`, фильтр по `vacancy.job_id` + `selection_query`. |
| 5 | `llm_generate` | Сгенерировать сообщения и репорт | Список кандидатов с персонализированными сообщениями. |

### 4.5 candidate_funnel

| order | step_type | name | что происходит |
|---|---|---|---|
| 0 | `auto_fetch` | Загрузить данные вакансии | SELECT. Не показывается рекрутеру. |
| 1 | `data_fetch` | Получить данные воронки | Через fetch source `candidate_funnel`, фильтр по `vacancy.job_id`. |
| 2 | `display` | Таблица воронки | Шаг × статус: дошло / висит >1ч / >24ч / >48ч. |

---

## 5. Что осталось на промпты (TBD)

Промпты для всех `llm_extract` и `llm_generate` шагов — пустые до появления финальных примеров вакансий.

Что нужно для каждого промпта:
- **create_vacancy шаг 2** (must haves): примеры с плиточником и промоутером дают хорошую основу
- **create_vacancy шаг 8** (application_steps): это самый сложный промпт — LLM должна выделить не просто шаги, а разговорный скрипт для каждого. Нужно 3–4 примера с заполненным `script`.
- **setup_communication шаг 3** (план коммуникации): нужны примеры "хорошего плана" для синих воротничков
- **setup_communication шаг 5** (примеры сообщений): нужны примеры первых сообщений кандидатам

---

## 6. Открытые вопросы

1. **INSERT на шаге 1 create_vacancy.** Агент создаёт запись сразу при получении raw_text (status='draft'), потом UPDATE полей по мере извлечения. После шага 14 — status='active'. Это предположение, нужно подтвердить.

2. **Скрипты в application_steps.** Поле `script` — это инструкция для LLM (что и как говорить), не готовый текст. Конкретные сообщения кандидату генерирует LLM в setup_communication шаг 3.

3. **Роутинг из decision/buttons/display.** Для детерминированного рантайма ветвление должно жить в `routing` JSONB, а не только в текстовых notes. `notes` можно оставить для описания условий, но не как единственный источник логики переходов.

4. **FAQ и внешние источники.** В шите упомянуто «парсим сайт и другую публичную инфу» для FAQ. Это значит шаг 12 create_vacancy должен принять URL компании как опциональный input и парсить. Или это отдельный шаг?

5. **Шаг 0 и смена вакансии.** Если рекрутер переключает вакансию в UI во время активной сессии плейбука — что происходит с текущей сессией? Сбрасывается или продолжается?
