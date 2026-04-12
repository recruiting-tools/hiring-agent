# Iteration 1 — TZ and Test Data

Дата: 2026-04-12

Этот документ сужает `docs/spec-by-claude.md` до первой рабочей итерации. Цель не построить весь hiring-agent, а получить проверяемый скелет candidate-chatbot: входящее сообщение кандидата превращается в осмысленный ответ, ответ кладется в `planned_messages`, state machine может закрыть один или несколько шагов.

## Что делаем

Первая итерация покрывает только candidate-facing контур без реальной отправки в HH:

1. Сервис `candidate-chatbot` принимает входящее сообщение через `POST /webhook/message`.
2. Сервис находит `conversation`, `pipeline_run`, незакрытые `pipeline_step_state` и последние сообщения.
3. Сервис вызывает LLM через адаптер. В тестах адаптер мокается, в локальном ручном прогоне можно использовать Gemini Flash.
4. LLM возвращает structured output:
   - какие шаги закрыты;
   - какие факты извлечены;
   - нужен ли уточняющий вопрос, отказ или manual review;
   - текст следующего сообщения кандидату.
5. Детерминированный validator проверяет output.
6. Если output валиден, сервис пишет:
   - inbound message в `messages`;
   - события в `pipeline_events`;
   - обновленную проекцию в `pipeline_step_state`;
   - outbound draft в `planned_messages`.
7. Сообщение кандидату не отправляется. В первой итерации достаточно увидеть его через `GET /queue/pending`.

## Чего не делаем

- Реальная HH-интеграция, polling и `sendHHWithGuard`.
- Cron отправки `planned_messages`.
- Moderation UI.
- Telegram.
- Multi-tenant management DB в полном виде.
- Text2SQL и аналитические marts.
- Генератор pipeline по вакансии.
- Tool-call шаги с реальными внешними API. В первой итерации tool-шаги можно хранить в данных, но executor должен ставить `manual_review`, если дошел до такого шага.

## Минимальный контракт API

### `POST /webhook/message`

Request:

```json
{
  "conversation_id": "conv-zakup-001",
  "channel": "test",
  "channel_message_id": "in-zakup-001",
  "text": "Здравствуйте. 8 лет закупаю из Китая, в основном напрямую с фабрик. 1688 и WeChat использую постоянно, бюджет 15-20 млн в месяц.",
  "occurred_at": "2026-04-12T08:00:00.000Z"
}
```

Response:

```json
{
  "pipeline_run_id": "run-zakup-001",
  "run_status": "active",
  "step_result": "needs_clarification",
  "completed_step_ids": ["direct_china_suppliers", "china_platforms", "purchase_volume"],
  "rejected_step_id": null,
  "planned_message_id": "pm-zakup-001",
  "message": "Спасибо, опыт релевантный. Уточните, пожалуйста, с какими категориями товаров работали в последние 2-3 года и приходилось ли решать вопросы с браком или инспекциями до отгрузки?"
}
```

Правила:

- Response не должен содержать `{{` или `}}`.
- Response может вернуть `planned_message_id: null`, если run завершен без следующего сообщения или validator отправил результат в manual review.
- Если `conversation_id` неизвестен, вернуть `404`.
- Если нет активного `pipeline_run`, вернуть `409` с кодом `no_active_pipeline_run`.
- Если LLM output невалиден, вернуть `202` с `step_result: "manual_review"` и записать событие `llm_output_rejected`.

### `GET /queue/pending`

Возвращает pending drafts для ручной проверки в dev:

```json
{
  "items": [
    {
      "planned_message_id": "pm-zakup-001",
      "conversation_id": "conv-zakup-001",
      "candidate_id": "cand-zakup-good",
      "pipeline_run_id": "run-zakup-001",
      "step_id": "product_categories",
      "body": "Спасибо, опыт релевантный. Уточните, пожалуйста...",
      "reason": "Закрыты шаги direct_china_suppliers, china_platforms, purchase_volume. Остались product_categories и quality_cases.",
      "review_status": "pending"
    }
  ]
}
```

## Structured output от LLM

```json
{
  "step_result": "done|needs_clarification|reject|manual_review",
  "completed_step_ids": ["direct_china_suppliers"],
  "rejected_step_id": null,
  "extracted_facts": {
    "direct_china_suppliers": true
  },
  "missing_information": ["product_categories"],
  "next_message": "Уточните, пожалуйста, с какими категориями товаров работали?",
  "confidence": 0.86,
  "guard_flags": []
}
```

Validator первой итерации:

- JSON парсится.
- `step_result` входит в enum.
- Все `completed_step_ids` существуют среди pending steps текущего run.
- `rejected_step_id`, если не `null`, существует среди pending steps текущего run.
- `next_message` не содержит `{{` и `}}`.
- `next_message` не совпадает с последним outbound сообщением.
- `next_message` не пустой для `needs_clarification` и `reject`.
- `next_message` не содержит URL, если pending step имеет `kind: "tool"` и tool result отсутствует.
- `confidence < 0.55` переводит результат в `manual_review`.

## Тесты первой итерации

Первые тесты должны быть integration-level, но без реальной сети:

1. `webhook returns real planned message, not placeholder`
2. `one candidate answer can complete multiple steps`
3. `pipeline stays active when required facts are missing`
4. `pipeline rejects candidate when reject_when is met`
5. `invalid llm json goes to manual review and does not create planned message`
6. `duplicate outbound message is blocked by validator`
7. `pending queue returns created planned message`
8. `webhook returns 404 for unknown conversation`
9. `webhook returns 409 when conversation has no active pipeline run`
10. `http server exposes webhook and pending queue endpoints`
11. `state projection matches events log for completed and rejected steps`

## Seed base

Machine-readable версия этих данных лежит в `tests/fixtures/iteration-1-seed.json`.

Один клиент и один рекрутер:

```json
{
  "client": {
    "client_id": "client-demo-001",
    "name": "Demo Client"
  },
  "recruiter": {
    "recruiter_id": "recruiter-demo-001",
    "client_id": "client-demo-001",
    "email": "recruiter@example.test"
  }
}
```

## Pipeline templates

Ниже три вакансии для seed данных. Первая основана на существующем кейсе "Закупщик (Китай)" из лендингов, две остальные синтетические.

### 1. Закупщик Китай

```json
{
  "job_id": "job-zakup-china",
  "title": "Закупщик (Китай)",
  "description": "Москва, 180000-250000 руб. Строительное оборудование и комплектующие. Нужен опыт прямых закупок у китайских фабрик от 3 лет, WeChat/1688, контроль качества, готовность к командировкам 3-4 раза в год.",
  "pipeline_template": {
    "template_id": "tpl-zakup-china-v1",
    "template_version": 1,
    "name": "china-procurement-screening-v1",
    "steps": [
      {
        "id": "direct_china_suppliers",
        "step_index": 1,
        "kind": "question",
        "goal": "Проверить прямой опыт работы с китайскими фабриками",
        "done_when": "кандидат явно говорит, что работал напрямую с фабриками, а не только через посредников",
        "reject_when": "кандидат работал только через посредников и не понимает прямую коммуникацию с фабриками",
        "prompt_key": "step.direct_china_suppliers"
      },
      {
        "id": "china_platforms",
        "step_index": 2,
        "kind": "question",
        "goal": "Проверить практический опыт WeChat и 1688",
        "done_when": "кандидат описывает, как использовал WeChat, 1688 или аналогичные китайские каналы для поиска и коммуникации",
        "reject_when": "кандидат не работал с китайскими каналами и не готов быстро включиться",
        "prompt_key": "step.china_platforms"
      },
      {
        "id": "purchase_volume",
        "step_index": 3,
        "kind": "question",
        "goal": "Понять масштаб закупок",
        "done_when": "кандидат называет месячный бюджет, количество контейнеров, партий или сопоставимый масштаб",
        "reject_when": "опыт ограничен разовыми мелкими заказами и не подходит под промышленный масштаб",
        "prompt_key": "step.purchase_volume"
      },
      {
        "id": "product_categories",
        "step_index": 4,
        "kind": "question",
        "goal": "Проверить близость категорий к строительному оборудованию",
        "done_when": "кандидат перечисляет категории товаров; строительное оборудование, инструмент или комплектующие считаются сильным совпадением",
        "reject_when": "категории полностью нерелевантны и кандидат не готов переходить в технические товары",
        "prompt_key": "step.product_categories"
      },
      {
        "id": "quality_cases",
        "step_index": 5,
        "kind": "question",
        "goal": "Проверить опыт решения брака, инспекций и претензий к поставщикам",
        "done_when": "кандидат описывает конкретный случай с браком, инспекцией, заменой, скидкой или претензией",
        "reject_when": "кандидат не сталкивался с качеством и не понимает процесс контроля до отгрузки",
        "prompt_key": "step.quality_cases"
      },
      {
        "id": "compensation_and_travel",
        "step_index": 6,
        "kind": "question",
        "goal": "Проверить зарплатные ожидания и готовность к командировкам в Китай",
        "done_when": "кандидат называет ожидания в пределах 180000-250000 руб. или обсуждаемую вилку и подтверждает готовность к 3-4 поездкам в год",
        "reject_when": "ожидания сильно выше вилки или кандидат не готов к обязательным командировкам",
        "prompt_key": "step.compensation_and_travel"
      }
    ]
  }
}
```

### 2. Повар горячего цеха

```json
{
  "job_id": "job-cook-hot-shop",
  "title": "Повар горячего цеха",
  "description": "Москва, ресторан при бизнес-центре, 90000-120000 руб. Нужен опыт горячего цеха от 1 года, медкнижка или готовность оформить, график 5/2, выход в течение 2 недель.",
  "pipeline_template": {
    "template_id": "tpl-cook-hot-shop-v1",
    "template_version": 1,
    "name": "cook-hot-shop-screening-v1",
    "steps": [
      {
        "id": "hot_shop_experience",
        "step_index": 1,
        "kind": "question",
        "goal": "Проверить опыт горячего цеха",
        "done_when": "кандидат подтверждает опыт горячего цеха от 1 года или описывает релевантные блюда и процессы",
        "reject_when": "у кандидата нет опыта кухни и он ищет первую работу без стажировки",
        "prompt_key": "step.hot_shop_experience"
      },
      {
        "id": "medical_book",
        "step_index": 2,
        "kind": "question",
        "goal": "Проверить наличие медкнижки",
        "done_when": "кандидат подтверждает действующую медкнижку или готовность оформить до выхода",
        "reject_when": "кандидат отказывается оформлять медкнижку",
        "prompt_key": "step.medical_book"
      },
      {
        "id": "schedule_fit",
        "step_index": 3,
        "kind": "question",
        "goal": "Проверить готовность к графику 5/2",
        "done_when": "кандидат подтверждает график 5/2 или задает уточняющий вопрос без отказа",
        "reject_when": "кандидат может работать только 2/2, ночь или частичную занятость",
        "prompt_key": "step.schedule_fit"
      },
      {
        "id": "start_date",
        "step_index": 4,
        "kind": "question",
        "goal": "Понять дату выхода",
        "done_when": "кандидат называет дату выхода или срок отработки",
        "reject_when": "кандидат может выйти позже чем через 6 недель и вакансия срочная",
        "prompt_key": "step.start_date"
      },
      {
        "id": "salary_fit",
        "step_index": 5,
        "kind": "question",
        "goal": "Проверить зарплатные ожидания",
        "done_when": "кандидат называет ожидания в пределах 90000-120000 руб. или готов обсуждать вилку",
        "reject_when": "ожидания сильно выше вилки и кандидат не готов обсуждать",
        "prompt_key": "step.salary_fit"
      }
    ]
  }
}
```

### 3. Менеджер продаж B2B

```json
{
  "job_id": "job-b2b-sales-manager",
  "title": "Менеджер продаж B2B",
  "description": "Москва или гибрид, 120000-160000 руб. фикс + бонус. Продажа промышленного оборудования. Нужны B2B продажи от 2 лет, работа с CRM, длинный цикл сделки, готовность к плану и командировкам 1-2 раза в квартал.",
  "pipeline_template": {
    "template_id": "tpl-b2b-sales-manager-v1",
    "template_version": 1,
    "name": "b2b-sales-screening-v1",
    "steps": [
      {
        "id": "b2b_sales_experience",
        "step_index": 1,
        "kind": "question",
        "goal": "Проверить опыт B2B продаж от 2 лет",
        "done_when": "кандидат подтверждает B2B продажи от 2 лет и называет тип клиентов или продукта",
        "reject_when": "есть только B2C/розница и нет готовности переходить в B2B",
        "prompt_key": "step.b2b_sales_experience"
      },
      {
        "id": "industrial_or_complex_product",
        "step_index": 2,
        "kind": "question",
        "goal": "Проверить опыт сложного или технического продукта",
        "done_when": "кандидат продавал оборудование, SaaS, услуги для бизнеса или другой продукт с консультационной продажей",
        "reject_when": "кандидат продавал только простые транзакционные товары и не понимает длинный цикл",
        "prompt_key": "step.industrial_or_complex_product"
      },
      {
        "id": "long_cycle",
        "step_index": 3,
        "kind": "question",
        "goal": "Проверить опыт длинного цикла сделки",
        "done_when": "кандидат описывает сделки дольше 1 месяца, этапы согласования или работу с несколькими ЛПР",
        "reject_when": "кандидат готов только к быстрым входящим продажам",
        "prompt_key": "step.long_cycle"
      },
      {
        "id": "crm_usage",
        "step_index": 4,
        "kind": "question",
        "goal": "Проверить дисциплину CRM",
        "done_when": "кандидат называет CRM и описывает регулярную работу с воронкой, задачами или отчетами",
        "reject_when": "кандидат принципиально не ведет CRM",
        "prompt_key": "step.crm_usage"
      },
      {
        "id": "compensation_model",
        "step_index": 5,
        "kind": "question",
        "goal": "Проверить готовность к фикс + бонус",
        "done_when": "кандидат понимает модель фикс + бонус и ожидания попадают в вилку или обсуждаемы",
        "reject_when": "кандидат рассматривает только фикс сильно выше вилки",
        "prompt_key": "step.compensation_model"
      },
      {
        "id": "travel_fit",
        "step_index": 6,
        "kind": "question",
        "goal": "Проверить готовность к редким командировкам",
        "done_when": "кандидат подтверждает готовность к 1-2 командировкам в квартал",
        "reject_when": "кандидат не готов к командировкам вообще",
        "prompt_key": "step.travel_fit"
      }
    ]
  }
}
```

## Candidate fixtures

### `cand-zakup-good`: один ответ закрывает три шага

```json
{
  "candidate_id": "cand-zakup-good",
  "job_id": "job-zakup-china",
  "conversation_id": "conv-zakup-001",
  "pipeline_run_id": "run-zakup-001",
  "display_name": "Максим Волков",
  "resume_text": "Менеджер по закупкам, 8 лет в закупках из Китая. Последнее место: руководитель отдела закупок. Английский B1, китайский разговорный. Ожидания от 200000 руб.",
  "inbound_text": "Здравствуйте. 8 лет закупаю из Китая, в основном напрямую с фабрик, примерно 80% объема. 1688 использую для поиска, дальше вывожу в WeChat. Бюджет 15-20 млн в месяц.",
  "expected": {
    "step_result": "needs_clarification",
    "completed_step_ids": ["direct_china_suppliers", "china_platforms", "purchase_volume"],
    "missing_information": ["product_categories", "quality_cases", "compensation_and_travel"],
    "run_status": "active",
    "planned_message_semantic": "уточняет категории товаров и опыт с браком/инспекциями"
  }
}
```

### `cand-cook-reject`: отказ по медкнижке

```json
{
  "candidate_id": "cand-cook-reject",
  "job_id": "job-cook-hot-shop",
  "conversation_id": "conv-cook-001",
  "pipeline_run_id": "run-cook-001",
  "display_name": "Иван Петров",
  "resume_text": "Повар, 2 года горячего цеха, Москва. Ожидания 100000 руб.",
  "inbound_text": "Опыт горячего цеха есть, но медкнижку делать не хочу, это принципиально. График 5/2 норм.",
  "expected": {
    "step_result": "reject",
    "completed_step_ids": ["hot_shop_experience", "schedule_fit"],
    "rejected_step_id": "medical_book",
    "run_status": "rejected",
    "planned_message_semantic": "вежливый отказ без обсуждения деталей вакансии"
  }
}
```

### `cand-sales-incomplete`: нужен уточняющий вопрос

```json
{
  "candidate_id": "cand-sales-incomplete",
  "job_id": "job-b2b-sales-manager",
  "conversation_id": "conv-sales-001",
  "pipeline_run_id": "run-sales-001",
  "display_name": "Анна Соколова",
  "resume_text": "Менеджер по продажам, 4 года. CRM: amoCRM. Ожидания от 150000 руб.",
  "inbound_text": "Здравствуйте. В продажах 4 года, CRM веду регулярно, по деньгам от 150 фикс плюс бонус подходит.",
  "expected": {
    "step_result": "needs_clarification",
    "completed_step_ids": ["crm_usage", "compensation_model"],
    "missing_information": ["b2b_sales_experience", "industrial_or_complex_product", "long_cycle", "travel_fit"],
    "run_status": "active",
    "planned_message_semantic": "уточняет B2B/продукт/цикл сделки и командировки"
  }
}
```

## Acceptance criteria

Итерация считается готовой, когда:

- `pnpm test` проходит.
- Все fixture-сценарии выше проходят без реальной сети.
- В коде есть один LLM adapter interface и fake adapter для тестов.
- В `planned_messages.body` нет placeholders.
- `pipeline_events` содержит аудит решений по каждому закрытому или отклоненному шагу.
- `pipeline_step_state` можно восстановить из событий хотя бы в рамках тестовой helper-функции.
- Нет реальной отправки кандидату ни через HH, ни через email, ни через другой канал.
