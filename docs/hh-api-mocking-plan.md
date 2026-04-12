# HH.ru API mocking plan

Дата: 2026-04-12

## Цель

Нужно подключить HH.ru без платной "тестовой вакансии" и при этом получить надежный тестовый слой, на который можно опираться при изменениях логики сервиса.

Результат этого этапа:

- библиотека типовых HH request/response fixtures в репозитории;
- контрактный mock HH API поверх этих fixtures;
- тесты основных sync-сценариев: импорт новых откликов, поиск новых сообщений, отправка ответа, защита от дублей, один resume в разных vacancy/negotiation;
- безопасный smoke на реальном HH только для сбора контрактов и привязки моего тестового кандидата по `resume_id`.

Отдельный репозиторий пока не нужен. Fixtures должны жить рядом с кодом, чтобы `pnpm test:all` ловил регрессии без сетевого доступа и без HH credentials. Если эти fixtures понадобятся другим сервисам, тогда выделим `hh-contract-fixtures` отдельно.

## Источники контракта

1. Официальная документация hh.ru:
   - `hhru/api` README: https://github.com/hhru/api
   - авторизация: https://raw.githubusercontent.com/hhru/api/master/docs/authorization.md
   - переписка работодателя: https://raw.githubusercontent.com/hhru/api/master/docs/employer_negotiations.md
   - OpenAPI: https://api.hh.ru/openapi/redoc
2. Наш свежий документ с production-паттернами:
   - https://chillai.space/p/hh-api-integration-patterns?password=NJh_zOj6
3. Реальные ответы HH, которые соберем после OAuth.

Важный риск из официальной документации: методы сообщений по откликам/приглашениям для работодателя помечены как устаревшие, новые возможности чатов в них не поддерживаются. Поэтому fixtures из реального API обязательны: mock должен отражать не только документацию, но и фактические ответы, которые увидит наш сервис.

## Что уже есть в коде

Есть минимальный `FakeHhClient` в `services/hh-connector/src/hh-client.js`:

- `getMessages(hhNegotiationId)`;
- `sendMessage(hhNegotiationId, text)`;
- ручной seed переговорки и сообщений.

Есть тесты:

- polling пишет inbound в `chatbot.messages`;
- polling идемпотентен по `channel_message_id`;
- сообщения сортируются по `created_at`;
- `awaiting_reply` меняется по последнему автору;
- `pollAll` берет только due negotiations;
- send guard не отправляет один `planned_message` дважды;
- concurrent sends доставляют ровно один раз.

Этого достаточно для unit/integration логики, но недостаточно как HH mock layer: сейчас fake не моделирует список переговорок, `updated_at`, collections, vacancy/resume ids, пагинацию, ошибки, token refresh и реальные формы payloads.

## Целевая структура в репозитории

```text
docs/
  hh-api-mocking-plan.md
tests/
  fixtures/
    hh-api/
      README.md
      manifest.json
      oauth/
        token.success.json
        refresh.success.json
        me.employer.json
      negotiations/
        response.page-1.json
        phone_interview.page-1.json
        negotiation.single.json
        messages.ascending.json
        messages.reversed.json
        messages.empty.json
        send-message.success.json
        change-state.success.json
      resumes/
        resume.vladimir-kobzev.redacted.json
        resume.minimal.json
      errors/
        401-expired-token.json
        403-no-paid-access.json
        404-negotiation-not-found.json
        429-rate-limit.json
services/
  hh-connector/
    src/
      hh-api-client.js
      hh-contract-mock.js
      hh-fixture-recorder.js
```

`manifest.json` должен описывать происхождение каждого fixture: endpoint, method, query shape, capture date, redaction status, linked scenario, and schema version. Секреты, ФИО третьих лиц, телефоны, email, ссылки на приватные документы и токены не попадают в fixtures.

## Минимальный HH API surface для mock

Покрываем только то, что реально нужно сервису.

1. OAuth:
   - `GET /hh-callback/?code=...` в нашем сервисе;
   - обмен code на tokens;
   - refresh за 1 час до истечения;
   - проверка токена через `/me`.
2. Импорт новых кандидатов:
   - список переговорок по collection и vacancy: `GET /negotiations/{collection}?vacancy_id=...`;
   - пагинация;
   - `updated_at`, `id`, `state`, `resume`, `vacancy`;
   - получение одного negotiation, если список дает неполные данные;
   - получение resume по URL/id.
3. Обработка сообщений:
   - `GET /negotiations/{negotiationId}/messages`;
   - форма `items: Message[]`;
   - `author.participant_type: applicant | employer`;
   - сортировка mock-ответов не гарантируется: обязательно fixture с reversed order.
4. Отправка:
   - send message;
   - success с HH message id;
   - retriable failures;
   - non-retriable failures;
   - idempotency на стороне нашего `message_delivery_attempts`.
5. Lifecycle:
   - смена collection/state, например `response -> phone_interview`;
   - кандидаты в `discard` не должны продолжать active screening;
   - candidate/resume может появиться в другой vacancy id.

## Как ловим моего тестового кандидата

Тестовая вакансия как отдельная платная сущность не нужна. После OAuth делаем безопасный read-only capture:

1. Получить список доступных работодателю vacancy/negotiation collections.
2. Пройти по существующим collection для разрешенных vacancy id.
3. Искать кандидата по одному из признаков:
   - `resume_id`, если он уже известен;
   - сообщение в HH: `привет я владимир кобзев kobzevvv@gmail.com`;
   - email в доступном resume/contact payload, если HH возвращает его работодателю.
4. После нахождения создать в `manifest.json` alias:
   - `canonical_test_candidate: vladimir_kobzev`;
   - `resume_id: <real resume id>`;
   - `allowed_for_live_smoke: true`;
   - реальные персональные поля в fixtures заменить стабильными synthetic values, кроме если явно решим оставить email для ручного поиска.

Дальше сложные live-тесты выполняем только против этого resume/negotiation и только с явным `HH_LIVE_SMOKE=true`. Обычный CI использует mock.

## Recorder: сбор хороших примеров ответов

Нужен маленький recorder вокруг настоящего HH client.

Правила:

- записывать method, path template, query keys, status, response headers whitelist, body;
- автоматически редактировать secrets и персональные данные;
- сохранять raw только локально в ignored директорию, например `.local/hh-captures/`;
- коммитить только redacted fixtures из `tests/fixtures/hh-api/`;
- для каждого нового endpoint добавлять минимум один happy-path fixture и один error fixture;
- фиксировать дату capture, потому что HH API и payloads меняются.

Redaction:

- `access_token`, `refresh_token`, authorization headers - всегда `<redacted>`;
- телефоны, email третьих лиц, имена, URLs резюме - synthetic values;
- `resume_id`, `negotiation_id`, `vacancy_id` - можно сохранять как synthetic stable ids, кроме manifest alias для моего тестового resume;
- текст сообщений третьих лиц - synthetic, но сохраняем структуру, переносы, пустые поля и HTML/markdown особенности, если они есть.

## Contract mock behavior

Mock должен быть stateful, иначе он не поймает ошибки жизненного цикла.

Состояние mock:

- `tokens`: active/expired/revoked;
- `vacancies`: active/archived;
- `negotiations`: `hh_negotiation_id`, `hh_vacancy_id`, `resume_id`, `collection`, `updated_at`;
- `messages`: ordered storage, but response order can be configured per scenario;
- `sentMessages`: append-only log;
- `failures`: сценарии 401/403/404/429/5xx.

Основные операции:

- `listNegotiations(collection, { vacancy_id, page, per_page })`;
- `getNegotiation(id)`;
- `getResume(resumeIdOrUrl)`;
- `getMessages(negotiationId)`;
- `sendMessage(negotiationId, text)`;
- `changeState(action, negotiationId)`;
- `expireAccessToken()`;
- `advanceClock(ms)`.

Важно: `updated_at` меняется при новом сообщении кандидата, отправке работодателя и смене state. Отдельный scenario должен уметь заморозить `updated_at`, чтобы тестировать fallback из нашего chillai-документа.

## Тестовые сценарии

Обязательные:

1. `syncHHApplicants` импортирует новый response, создает candidate/conversation/hh_negotiation, получает resume и отправляет welcome.
2. Повторный импорт того же `hh_negotiation_id` не создает дубль.
3. Тот же `resume_id` приходит по другой `hh_vacancy_id` и другому `hh_negotiation_id`: создаем/связываем корректно, не ломаем историю и явно решаем политику duplicate candidate.
4. Сообщения приходят reversed: connector сортирует по `created_at`, last_sender/awaiting_reply корректны.
5. Сообщение кандидата уже сохранено, но отправка ответа упала: следующий sync не замораживает кандидата, а обрабатывает unanswered inbound.
6. Pre-filter говорит skip, но в нашей DB последний non-system message inbound: bypass pre-filter и обработать.
7. `sendHHWithGuard` при retry/concurrency вызывает HH send ровно один раз.
8. `hh_send=false`: polling и import работают, send не выполняется.
9. Access token истекает: refresh происходит до запроса, исходный action повторяется один раз.
10. Refresh token протух/отозван: сервис отключает HH send/import, пишет actionable error, не зацикливается.
11. 403 paid access: сервис не ретраит бесконечно и сохраняет диагностичный статус.
12. 429 rate limit: backoff, no message loss, no duplicate sends.
13. Empty messages response не сбрасывает `awaiting_reply` и `last_sender`.
14. Candidate moved to `discard`: дальнейший screening/send останавливается.
15. Pagination: новые negotiation на page 2 не теряются.

## Изменения в текущем плане фазы 3

Старый план сразу вел к live vacancy smoke. Новый порядок:

| # | Что | Кто |
|---|-----|-----|
| 3.1 | Migration 009: `management.oauth_tokens`, `management.feature_flags`, при необходимости audit для HH captures | bot |
| 3.2 | `GET /hh-callback/` принимает `?code=`, обменивает на tokens, пишет в `management.oauth_tokens` | bot |
| 3.3 | `token-refresher.js`: refresh за 1 час до истечения | bot |
| 3.4 | Real `hh-api-client.js` + recorder в `.local/hh-captures/` | bot |
| 3.5 | `hh-contract-mock.js` и fixture library | bot |
| 3.6 | `POST /internal/hh-poll` защищен для Cloud Scheduler, но сначала работает локально против mock | bot |
| 3.7 | Cloud Scheduler job каждые 60 секунд только после зеленого mock suite | bot |
| 3.8 | OAuth flow: открыть URL как работодатель hh.ru, передать `?code=` Claude/Codex | user |
| 3.9 | Read-only live capture: `/me`, collections, доступные negotiations/resumes/messages | bot |
| 3.10 | Найти тестового кандидата по `resume_id` или сообщению `привет я владимир кобзев kobzevvv@gmail.com` | user + bot |
| 3.11 | Добавить redacted fixtures из live capture и закрепить их тестами | bot |
| 3.12 | Включить отправку через `hh_send=true` только для allowlisted negotiation/resume | user + bot |

## Definition of done

- `pnpm test:hh` и `pnpm test:all` зеленые без HH credentials.
- Все HH endpoints, которые вызывает сервис, имеют fixtures и mock coverage.
- Есть минимум один fixture на reversed messages order.
- Есть сценарий `same resume_id, different vacancy_id`.
- Есть тест frozen-candidate prevention: unanswered inbound не теряется при pre-filter skip/send failure.
- Live smoke отключен по умолчанию и требует `HH_LIVE_SMOKE=true`.
- Fixtures не содержат tokens и чужих PII.
- README ссылается на этот план вместо прямого требования создавать/использовать отдельную тестовую вакансию.
