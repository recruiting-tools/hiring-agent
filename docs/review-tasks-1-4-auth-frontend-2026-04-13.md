# Code Review: Tasks 1-4 Auth + Frontend (commit 3ced4de)

Date: 2026-04-13  
Branch: fix/deploy-prod-dispatch  
Reviewer: Claude Sonnet 4.6

## Verdict: NEEDS_FIX

### CRITICAL — 3 блокера

**1. Session renewal не реализован в `resolveSession`**

`auth.js` строки 28-41: функция только читает сессию из DB и возвращает строку. Нет проверки близости к expiry и нет UPDATE для продления `expires_at`. Сессии будут истекать без авторенования.

Нужно: после получения валидной сессии — проверить, если `expires_at < now() + 7 days`, то `UPDATE sessions SET expires_at = now() + interval '30 days' WHERE session_token = $1` и установить новый cookie.

**2. Cookie `Max-Age=604800` (7 дней) вместо `2592000` (30 дней)**

`http-server.js` строка 626. Требование явно указывает 30 дней. Также `createSession` вставляет `interval '7 days'` — надо синхронизировать с cookie TTL.

**3. Флаг `Secure` не установлен нигде**

Ни в login (строка 626), ни в logout (строка 635) нет `Secure` флага. Требование: `Secure` только в production (`NODE_ENV === 'production'`). Без этого cookie передаётся по HTTP в продакшне.

---

### IMPORTANT — не блокеры, но стоит зафиксировать

**4. `recruiter_token` получается верно, но не используется**

`app.js` строка 26: `_recruiterToken` (underscore-prefix = intentionally unused). Токен правильно течёт через цепочку `resolveSession → http-server → app.postChatMessage`, но не скоупит запросы к DB. Tenant isolation не обеспечена. Приемлемо как placeholder для текущей итерации.

**5. Тест на session renewal отсутствует**

Поскольку renewal не реализован — теста нет. При добавлении renewal нужен тест: "resolveSession с сессией, истекающей через < 7 дней, должен продлевать expires_at".

---

### OK — всё прошло

- `parseCookies`: корректная обработка отсутствующего заголовка, пустых сегментов, URL-decode, `indexOf("=")` безопасен для значений с `=`. PASS
- `getRecruiterByEmail`: правильный SQL, demo mode (sql=null) возвращает fake recruiter с `password_hash: null`. PASS
- `createSession`: `randomBytes(32)`, demo mode возвращает dummy token. PASS
- `recruiter_token` течёт из `resolveSession()` → `requireRecruiter()` → `app.postChatMessage()` — не из URL params. PASS
- `searchParams.get("token")` полностью отсутствует в HTML/JS. PASS
- `GET /login`, `POST /auth/login`, `GET /logout` — реализованы корректно. PASS
- Auth middleware на `GET /`, `POST /api/chat`, `GET /api/jobs` — все через `requireRecruiter()` из cookie. PASS
- `app.getJobs(clientId)` — запрос `chatbot.jobs WHERE client_id = $clientId`. PASS
- `hiring-agent-auth.test.js` включён в `test:hiring-agent` в `package.json`. PASS
- Demo mode: `resolveSession` → `DEMO_RECRUITER`, `getJobs` → пустой список. PASS

---

## Что нужно исправить Codex

1. `auth.js` / `resolveSession`: добавить renewal-логику — если `expires_at < now() + 7 days`, продлить до `now() + 30 days`
2. `http-server.js`: изменить `Max-Age=604800` → `Max-Age=2592000` (и в createSession `interval '7 days'` → `interval '30 days'`)
3. `http-server.js`: добавить `Secure` флаг в set-cookie (login + logout) когда `process.env.NODE_ENV === 'production'`
4. `tests/unit/hiring-agent-auth.test.js`: добавить тест на session renewal
