# Demo Data Plan

Date: 2026-04-14

## Goal

Собрать демо-базу и демо-вакансии так, чтобы:

- hiring-agent выглядел как продукт, а не как shell на пустых данных;
- `create_vacancy`, `view_vacancy`, `setup_communication`, `candidate_funnel` можно было показывать на правдоподобных кейсах;
- demo и sandbox не зависели от legacy DB в рантайме;
- данные были достаточно интересными для UX-демо, но при этом достаточно структурированными для тестов.

## Что уже есть

### 1. Synthetic V1 fixtures уже неплохие

Файл: `tests/fixtures/iteration-1-seed.json`

Там уже есть 3 хорошие synthetic вакансии:

- `job-zakup-china` — Закупщик (Китай)
- `job-cook-hot-shop` — Повар горячего цеха
- `job-b2b-sales-manager` — Менеджер продаж B2B

Плюсы:

- у каждой вакансии есть `description`;
- у каждой есть `pipeline_template` с конкретными шагами и `done_when/reject_when`;
- есть `candidate_fixtures` с правдоподобными входящими сообщениями;
- вакансии сильно отличаются по домену и стилю скрининга.

### 2. Есть более зрелые homework fixtures

Файл: `tests/fixtures/homework-jobs-seed.json`

Там уже переведены более интересные legacy-кейсы:

- `job-wb-card-designer-v1` — маркетплейс-дизайнер с homework flow
- `job-china-procurement-v1` — закупки Китай с AI interview + homework

Плюсы:

- это ближе к реальным рабочим сценариям;
- есть `external_action`, `internal_action`, submission detection;
- хорошо подходят под demo runtime engine.

### 3. Есть legacy baseline по реальным вакансиям

Файл: `docs/reports/2026-04-12-legacy-pipeline-baseline.md`

Оттуда видно, какие реальные вакансии уже были сильными кандидатами для V2 demo:

- `job_id=4` — WB designer
- `job_id=9` — China procurement
- `job_id=26` — B2B sales / Skolkovo

Плюсы:

- уже есть перевод pipeline goals;
- уже собраны реальные candidate samples;
- это хороший источник для новых synthetic demo fixtures, не надо фантазировать с нуля.

### 4. Есть management playbooks seed

Файл: `data/playbooks-seed.json`

Там уже описаны:

- `create_vacancy`
- `setup_communication`
- `view_vacancy`
- `mass_broadcast`
- `candidate_funnel`

Это значит, demo-данные надо проектировать не просто как `jobs`, а как данные под будущий runtime этих playbooks.

## Главная проблема сейчас

Сейчас demo-данные живут в двух разных мирах:

- старый candidate-chatbot / pipeline demo (`jobs`, `pipeline_template`, `candidate_fixtures`);
- новая playbook/vacancy модель (`chatbot.vacancies`, `management.playbook_*`).

Из-за этого UI и runtime рискуют опираться на:

- либо пустые `vacancies`,
- либо красивые, но disconnected `jobs`,
- либо hardcoded `getDemoRuntimeData()`.

Нужно собрать один осмысленный demo dataset, где:

- есть `chatbot.jobs`;
- есть `chatbot.vacancies`, связанные с `job_id`;
- есть candidate/pipeline fixtures;
- есть management playbooks, которые можно запускать поверх этих вакансий.

## Предлагаемый состав demo-вакансий

Я бы не пытался тащить десятки вакансий. Для хорошего demo хватит 5–6.

### Tier A: основные вакансии для демо продукта

1. `vac-demo-sales-skolkovo`
- источник: legacy job `26`
- зачем: показать простой, понятный B2B screening + handoff flow
- playbooks: `view_vacancy`, `setup_communication`, `candidate_funnel`, позже `mass_broadcast`

2. `vac-demo-china-procurement`
- источник: legacy job `9` + `homework-jobs-seed`
- зачем: показать сложную вакансию с homework / AI interview / rich FAQ
- playbooks: все, включая runtime branching

3. `vac-demo-wb-designer`
- источник: legacy job `4` + `homework-jobs-seed`
- зачем: показать creative/domain-specific vacancy с richer homework flow
- playbooks: `create_vacancy` output target, `view_vacancy`, `setup_communication`

### Tier B: supporting synthetic вакансии

4. `vac-demo-cook-hot-shop`
- источник: `iteration-1-seed`
- зачем: показать массовую линейную вакансию, простой screening

5. `vac-demo-b2b-sales-industrial`
- источник: `iteration-1-seed`
- зачем: fallback B2B кейс для сравнения с Skolkovo

6. `vac-demo-sandbox-beta-ops`
- источник: `sandbox-secondary-seed`
- зачем: изоляция tenant access, не продуктовый showcase

## Рекомендованный demo narrative

Нужно не просто “несколько вакансий”, а сценарии показа.

### Narrative 1: create vacancy

Пустой или почти пустой tenant.

Рекрутер:

- загружает сырой текст вакансии;
- получает extracted `must_haves`;
- подтверждает `work_conditions`;
- видит `application_steps`;
- на выходе получает готовую `chatbot.vacancies` запись со статусом `draft/active`.

Для этого нужен один подготовленный длинный `raw_vacancy_text` per demo vacancy.

### Narrative 2: view vacancy

Рекрутер выбирает уже готовую вакансию и видит:

- must haves;
- nice haves;
- work conditions;
- application steps;
- company info;
- FAQ.

Это лучше всего показывать на `china-procurement` и `wb-designer`.

### Narrative 3: setup communication

Рекрутер запускает настройку общения и видит:

- как из vacancy структуры собирается recruiter-facing playbook;
- какие шаги в нашей зоне ответственности;
- какой target action у вакансии.

Лучше всего работает на:

- `sales-skolkovo`
- `cook-hot-shop`

### Narrative 4: candidate funnel

Рекрутер открывает уже живую вакансию и видит:

- реальные `pipeline_runs`;
- разный прогресс по шагам;
- часть кандидатов застряла;
- часть rejected;
- часть дошла до target action/homework.

Лучше всего:

- `sales-skolkovo` — короткий funnel;
- `china-procurement` — длинный funnel;
- `wb-designer` — funnel с homework handoff.

## Структура demo dataset

Предлагаю завести один канонический dataset, а не раскидывать demo по несвязанным файлам.

### Новый набор файлов

1. `tests/fixtures/demo-vacancies.json`

Содержит:

- `vacancy_id`
- `job_id`
- `title`
- `raw_vacancy_text`
- `must_haves`
- `nice_haves`
- `work_conditions`
- `application_steps`
- `company_info`
- `faq`
- `status`
- `extraction_status`
- optional `hh_vacancy_id`

2. `tests/fixtures/demo-pipeline-seed.json`

Содержит:

- `clients`
- `recruiters`
- `jobs`
- `candidate_fixtures`
- `pipeline_templates`

Можно собрать на базе `iteration-1-seed.json` + `homework-jobs-seed.json`.

3. `tests/fixtures/demo-scenarios.md` или `.json`

Содержит не данные БД, а product demo сценарии:

- “создать новую вакансию”
- “посмотреть сложную вакансию”
- “показать воронку”
- “отправить кандидатов в homework”

Это пригодится для smoke/e2e тестов и demo script.

## Что стоит переиспользовать без изменений

### Оставить как есть

- `iteration-1-seed.json` как базовый cheap synthetic seed
- `sandbox-secondary-seed.json` как tenant-isolation seed
- `homework-jobs-seed.json` как источник richer pipeline logic

### Не использовать как продуктовый demo напрямую

- `getDemoRuntimeData()` в `services/hiring-agent/src/demo-runtime-data.js`

Почему:

- это hardcoded aggregate, а не реальные DB-backed сущности;
- он годится только как временный mock для funnel UI;
- он не связан с `vacancies` и playbook runtime.

## Что стоит восстановить из legacy идей

Из `legacy-pipeline-report` уже видно правильный demo-состав.

Надо не тянуть legacy DB в рантайм, а один раз перевести эти идеи в новую fixture-модель:

- `sales-skolkovo`:
  - короткий screening
  - простые must-haves
  - handoff в Telegram / manager contact

- `china-procurement`:
  - AI interview optional
  - homework branch
  - сильный FAQ и richer company context

- `wb-designer`:
  - хороший creative/domain-specific кейс
  - easy-to-demo homework flow
  - более интересная визуальная/продуктовая подача

## Immediate implementation plan

### Phase 1: собрать канонический demo corpus

Сделать новый файл:

- `tests/fixtures/demo-vacancies.json`

В него положить минимум 3 Tier A вакансии:

- `sales-skolkovo`
- `china-procurement`
- `wb-designer`

Каждая должна иметь уже готовые extracted fields, чтобы `view_vacancy` и `setup_communication` можно было показать сразу.

### Phase 2: связать vacancies с jobs

Обновить sandbox/dev seed так, чтобы после `store.seed(...)` дополнительно создавались записи в:

- `chatbot.vacancies`

Линк:

- `vacancies.job_id -> jobs.job_id`

Это даст один реальный read model для UI.

### Phase 3: наполнить pipeline runs правдоподобно

Для Tier A вакансий нужно не по 1 кандидату, а хотя бы:

- 6–10 runs на вакансию

С профилями:

- strong
- medium
- hidden gem
- weak/risky
- stuck
- completed

Это нужно, чтобы `candidate_funnel` выглядел живым.

### Phase 4: определить demo mode contract

`APP_MODE=demo` не должен зависеть от `getDemoRuntimeData()`.

Лучше:

- либо поднимать in-memory dataset из новых fixture files;
- либо поднимать локальную seeded DB и читать оттуда.

Если нужен быстрый путь:

- demo mode = in-memory store, собранный из `demo-vacancies.json + demo-pipeline-seed.json`

Если нужен более честный путь:

- sandbox/dev DB seed + UI читает реальную DB.

## Что бы я делал первым

Самая выгодная первая итерация:

1. Оставить старые seed files как source material.
2. Сделать новый `demo-vacancies.json` на 3 вакансии:
   - `sales-skolkovo`
   - `china-procurement`
   - `wb-designer`
3. Обновить `seed-sandbox-db.js`, чтобы он:
   - seed-ил jobs/candidates как сейчас;
   - дополнительно upsert-ил `chatbot.vacancies`.
4. После этого подключить `view_vacancy` к реальным demo vacancies.

Это даст быстрый win:

- UI уже можно показывать;
- runtime engine потом будет работать с тем же dataset;
- demo перестанет зависеть от hardcoded `getDemoRuntimeData()`.

## Минимальный definition of done

Считать demo-слой готовым, когда:

- в sandbox/dev есть минимум 3 красивые demo vacancies;
- каждая связана с `job_id`;
- по каждой есть структурированные vacancy fields;
- по каждой есть 6+ pipeline runs;
- `view_vacancy` и `candidate_funnel` работают на одних и тех же данных;
- `create_vacancy` умеет создавать vacancy того же формата, что уже лежит в demo.

## Не делать сейчас

- не тащить прямой доступ к legacy routing DB в продуктовый runtime;
- не генерировать 20+ вакансий ради количества;
- не плодить отдельные synthetic data formats под каждый playbook;
- не держать `demo-runtime-data.js` как долгосрочный source of truth.

## Recommendation

Новый demo-слой стоит строить вокруг 3 showcase вакансий:

- `sales-skolkovo`
- `china-procurement`
- `wb-designer`

с опорой на:

- `iteration-1-seed.json`
- `homework-jobs-seed.json`
- `docs/reports/2026-04-12-legacy-pipeline-baseline.md`

И уже поверх них делать:

- playbook runtime engine
- UI flows
- sandbox demo

Это даст demo, который выглядит как продукт, а не как набор разрозненных моков.

## Demo Catalog V2

Ниже более прикладной состав, который лучше соответствует реальному `hh.ru`-ощущению.

Нужны не только "красивые showcase вакансии", но и типовые массовые вакансии с синими воротничками, где:

- много откликов;
- большинство кандидатов отвечают коротко и прагматично;
- есть went-dark, salary mismatch, график mismatch, документ mismatch;
- воронка и массовая коммуникация выглядят живыми.

### Пакет 1: Blue-collar HH-like vacancies

Рекомендую 4 типовые вакансии.

1. `vac-demo-electrician-shifts`
- роль: `Электрик / электромонтажник`
- тип: линейный синий воротничок
- локация: Москва / область
- объём: `40` откликов
- целевые сценарии:
  - опыт есть / нет;
  - допуски / разряд;
  - график вахта / 5/2;
  - инструмент свой / не свой;
  - готовность быстро выйти.

2. `vac-demo-warehouse-picker`
- роль: `Комплектовщик на склад`
- тип: массовый найм
- локация: Подмосковье
- объём: `50` откликов
- целевые сценарии:
  - гражданство / документы;
  - сменный график;
  - физическая нагрузка;
  - проживание / развозка;
  - кандидат “просто жмёт отклик”, но потом не отвечает.

3. `vac-demo-cook-hot-shop`
- роль: `Повар горячего цеха`
- тип: service blue-collar
- локация: Москва
- объём: `30` откликов
- целевые сценарии:
  - медкнижка;
  - опыт горячего цеха;
  - зарплатная вилка;
  - быстрый выход;
  - часть кандидатов подходит, но хочет другой график.

4. `vac-demo-tile-worker`
- роль: `Плиточник / отделочник`
- тип: project blue-collar
- локация: Москва и выезды по объектам
- объём: `35` откликов
- целевые сценарии:
  - опыт на отделке;
  - свой инструмент;
  - сдельная оплата;
  - готовность к выездам;
  - русский язык / коммуникация с бригадиром.

### Пакет 2: White-collar / richer vacancies

Оставить 2 более "умные" вакансии для richer playbooks:

5. `vac-demo-sales-skolkovo`
- роль: `Менеджер продаж B2B`
- объём: `30` откликов
- нужен для:
  - ручного добора;
  - просмотра воронки;
  - examples более длинной переписки.

6. `vac-demo-china-procurement`
- роль: `Менеджер по закупкам Китай`
- объём: `25` откликов
- нужен для:
  - homework flow;
  - AI interview / branching;
  - rich vacancy data.

### Пакет 3: Empty vacancy for create flow

7. `vac-demo-unlaunched-ops-manager`
- статус: `draft`
- есть:
  - `raw_vacancy_text`
  - дополнительные материалы
  - hh/sourcing notes
  - пример ideal candidate profile
- нет:
  - откликов
  - pipeline runs
  - candidate conversations
  - финально подтверждённых `application_steps`

Назначение:

- показывать `create_vacancy`;
- показывать `view_vacancy` в промежуточном состоянии;
- показывать, как runtime достраивает `must_haves`, `work_conditions`, `FAQ`, `goals/steps`.

Это должен быть именно "сырой пакет материалов", а не уже готовая вакансийная карточка.

## Рекомендуемое распределение откликов

Для blue-collar вакансий я бы делал не "идеальные" датасеты, а типично hh-подобные.

На вакансию `30–50` откликов:

- `20–30%` сильные/нормальные
- `20–25%` пограничные, но worth clarifying
- `15–20%` mismatch по зарплате / графику / формату
- `10–15%` mismatch по обязательным требованиям
- `20–30%` went dark / односложный ответ / вообще без ответа

Это даст реалистичный funnel.

Пример для вакансии на `40` откликов:

- `8` strong
- `9` medium / need clarification
- `7` hard mismatch
- `6` soft mismatch
- `10` no reply / went dark

## Рекомендуемое распределение переписок

Нужны не только входящие отклики, но и разная глубина диалога.

На одну типовую массовую вакансию:

- `10` кандидатов: только отклик, без ответа
- `8` кандидатов: 1 входящее + 1 исходящее
- `7` кандидатов: короткий screening на 2–4 сообщения
- `4` кандидата: дошли до подтверждения условий
- `1–2` кандидата: дошли до target action

Для richer вакансий:

- `5–7` коротких диалогов
- `8–10` средних диалогов
- `3–5` длинных диалогов с follow-ups / branching

## Типы кандидатов, которые обязательно нужны

Для каждой blue-collar вакансии стоит синтетически покрыть такие профили:

1. `Strong fit`
- отвечает по делу
- подтверждает опыт
- готов на условия

2. `No-documents fit risk`
- опыт есть
- проблема с документами / медкнижкой / допуском

3. `Schedule mismatch`
- кандидат нормальный, но не подходит по графику

4. `Salary mismatch`
- хочет сильно выше вилки

5. `No experience but motivated`
- массовый hh-типаж, который "готов учиться"

6. `Went dark`
- откликнулся, потом пропал

7. `Chaotic answerer`
- отвечает сумбурно, надо извлекать смысл

8. `Good hidden gem`
- резюме слабое, но в диалоге оказывается сильным

## Формат материалов для empty vacancy

Для "пустой" вакансии одного `raw_vacancy_text` мало. Лучше хранить пакет материалов.

Предлагаемый shape:

```json
{
  "vacancy_id": "vac-demo-unlaunched-ops-manager",
  "job_id": "job-demo-unlaunched-ops-manager",
  "title": "Операционный менеджер складской площадки",
  "status": "draft",
  "extraction_status": "pending",
  "source_materials": {
    "vacancy_text": "...",
    "hh_draft_text": "...",
    "ideal_candidate_profile": "...",
    "hiring_manager_notes": "...",
    "faq_notes": "...",
    "compensation_notes": "..."
  },
  "raw_vacancy_text": "склеенный текст из source_materials",
  "must_haves": null,
  "nice_haves": null,
  "work_conditions": null,
  "application_steps": null,
  "company_info": null,
  "faq": null
}
```

Такой формат лучше подходит для `create_vacancy`, чем "просто пустые поля".

## Что генерить первым

Если делать по приоритету, я бы генерил так:

### Wave 1

- `vac-demo-warehouse-picker` with `50` откликов
- `vac-demo-cook-hot-shop` with `30` откликов
- `vac-demo-sales-skolkovo` with `30` откликов
- `vac-demo-unlaunched-ops-manager` without отклики

### Wave 2

- `vac-demo-electrician-shifts` with `40` откликов
- `vac-demo-tile-worker` with `35` откликов
- `vac-demo-china-procurement` with `25` откликов

Это уже даст:

- типовой blue-collar HH feel;
- один sales-кейс;
- один rich branching-кейс;
- одну "пустую" вакансию под генерацию.

## Implementation recommendation

Лучше не писать сразу один гигантский fixture на сотни кандидатов руками.

Нормальный путь:

1. Зафиксировать catalog вакансий и required distributions.
2. Сделать generator script:
   - шаблоны вакансий,
   - шаблоны кандидатов,
   - шаблоны коротких диалогов,
   - deterministic seed.
3. Генерить из него:
   - `demo-vacancies.json`
   - `demo-pipeline-seed.json`
   - optional `demo-conversations.json`

Тогда dataset будет:

- воспроизводимый;
- расширяемый;
- не ручной свалкой.
