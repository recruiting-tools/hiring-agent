# Plan: hiring-agent Frontend + Prod Deploy

> Historical plan only.
> Auth sections in this document are stale after the management-auth migration.
> `<hiring-agent-host>/login` now uses `management.recruiters` and `management.sessions`,
> not `chatbot.recruiters` / `chatbot.sessions`.

**Ревью пройдено** — исправлены 3 критических + 4 медиум замечания от Claude-ревьюера (2026-04-13).

## Контекст

`hiring-agent` — рекрутерский AI-агент. Backend готов: `POST /api/chat` + pattern router → playbooks + inline chat UI (встроен прямо в `http-server.js`).

**Работает локально:**
```bash
PORT=3100 DATABASE_URL=$V2_DEV_NEON_URL node services/hiring-agent/src/index.js
# → http://localhost:3100/?token=<demo-recruiter-token>
```

**Не сделано для прода:**
1. Нормальная auth (сейчас token из URL-параметра)
2. Деплой на GCP VM `<vm-public-ip>`
3. Nginx + домен `<hiring-agent-host>`
4. CI/CD workflow

---

## Архитектура

```
браузер рекрутера
       ↓ HTTPS
<hiring-agent-host>  (DNS A → <vm-public-ip>)
       ↓
  Nginx (VM) — SSL termination, proxy → :3100
       ↓
  hiring-agent  Node.js :3100  (PM2)
       ↓
  Neon prod DB  (chatbot.recruiters, chatbot.sessions, chatbot.jobs)
```

---

## Task 1 — Auth: login page + session cookie

**Файлы:** `services/hiring-agent/src/http-server.js` (расширить), новый `services/hiring-agent/src/auth.js`

### Эндпоинты
| Method | Path | Описание |
|--------|------|----------|
| `GET /login` | — | Форма входа (HTML) |
| `POST /auth/login` | body: `{email, password}` | Проверяет `chatbot.recruiters`, ставит `session` cookie |
| `GET /logout` | — | Удаляет cookie, редирект на `/login` |
| `GET /` | — | Требует auth. Без cookie → 302 `/login` |
| `POST /api/chat` | — | Требует auth. Без cookie → 401 |
| `GET /api/vacancies` | — | Требует auth. Список вакансий рекрутера (`/api/jobs` оставлен как alias) |

### Auth flow
1. Рекрутер вводит **email + пароль** (не токен — токен это внутренний идентификатор)
2. Сервер: `bcrypt.compare(password, recruiter.password_hash)` из `chatbot.recruiters`
3. OK → `createSession(sql, recruiter_id)` → `session_token` (random 32 bytes hex) сохраняется в `chatbot.sessions`
4. `Set-Cookie: session=<token>; HttpOnly; Path=/; Max-Age=2592000; SameSite=Strict` + `Secure` только в `NODE_ENV=production` (localhost работает по HTTP)
5. На каждый запрос: парсим cookie → `resolveSession(sql, token)` → `{recruiter_id, client_id, recruiter_token, email}`
6. **Session renewal**: если до `expires_at` осталось < 7 дней → `UPDATE chatbot.sessions SET expires_at = now() + interval '30 days'` — делать в `resolveSession()`. Рекрутер, который заходит каждую неделю, никогда не будет выброшен.

### ⚠️ recruiter_token wiring (критично)

`http-server.js` при обработке `POST /api/chat` должен:
1. Вызвать `resolveSession()` из cookie
2. Извлечь `recruiter_token` из результата
3. Передать в `app.postChatMessage({message, recruiter_token, job_id})`

Текущий `app.js:27` именно этого и ждёт — `recruiter_token` в body. После auth он должен идти из сессии, а не из тела запроса (тело клиент не шлёт). Без этого wiring playbooks не получат токен.

### Новый модуль `auth.js`
```js
// services/hiring-agent/src/auth.js
export function parseCookies(header) { ... }

// Возвращает {recruiter_id, client_id, recruiter_token, email} или null
export async function resolveSession(sql, sessionToken) {
  // SELECT r.recruiter_id, r.client_id, r.recruiter_token, r.email
  // FROM chatbot.sessions s JOIN chatbot.recruiters r ON ...
  // WHERE s.session_token = $token AND s.expires_at > now()
}

// Возвращает случайный hex-токен, сохраняет в chatbot.sessions
export async function createSession(sql, recruiterId) {
  // INSERT INTO chatbot.sessions (session_token, recruiter_id, expires_at)
  // VALUES ($token, $recruiterId, now() + interval '30 days')
}
// resolveSession также делает renewal: если expires_at < now() + 7 days → UPDATE expires_at = now() + 30 days

export async function getRecruiterByEmail(sql, email) {
  // SELECT recruiter_id, client_id, recruiter_token, email, password_hash
  // FROM chatbot.recruiters WHERE email = $email
}
```

Прямые SQL-запросы через `sql` (postgres client) — без зависимости от `candidate-chatbot`.

> **SESSION_SECRET не нужен.** session_token — это random bytes, хранится в БД. Подписывать нечего.
> Убрать из .env и ecosystem.

### Режим без DB (demo mode)
Если `sql === null`:
- `POST /auth/login` — принимает любой email без проверки пароля
- `resolveSession()` — возвращает фиктивного рекрутера `{recruiter_token: "<demo-recruiter-token>", email: "demo@local"}`
- Для прода этот режим не используется

---

## Task 2 — Frontend: улучшенный UI

**Файл:** `services/hiring-agent/src/http-server.js` (заменить `HTML` и `LOGIN_HTML` константы)

### Login page (GET /login)
Дизайн в стиле текущего (Georgia, тёплые тона, карточка по центру):
- Email + пароль инпуты
- Кнопка "Войти"
- Ошибка под формой если неверные данные
- JS: `fetch('/auth/login', {method:'POST', body: JSON.stringify({email, password})})` → при успехе `window.location = data.redirect || '/'`

### Chat UI (GET /)
Расширить текущий `HTML`:
- **Удалить** строки с `searchParams.get("token")` и `searchParams.get("job_id")` — больше не из URL
- **Шапка**: email рекрутера (из `GET /api/me` или передаётся в HTML через server-side template) + кнопка "Выйти" → `GET /logout`
- **Vacancy selector**: `<select>` заполняется из `GET /api/vacancies` при загрузке страницы
- **Chat history**: сохраняется в `sessionStorage` (не теряется при F5, сбрасывается при закрытии вкладки)
- **Error states**: ошибка сети → toast-сообщение; 401 → `window.location = '/login'`
- `fetch('/api/chat')` — браузер автоматически шлёт cookie (same-origin), `credentials: 'include'` не нужен

### Server-side: передать email рекрутера в HTML

Чтобы шапка показывала имя без лишнего API-запроса — генерировать HTML динамически:
```js
// В http-server.js при GET /
const recruiter = await resolveSession(sql, cookies.session);
const html = CHAT_HTML.replace('__RECRUITER_EMAIL__', recruiter.email);
response.end(html);
```
`CHAT_HTML` содержит `<span id="recruiterEmail">__RECRUITER_EMAIL__</span>`.

---

## Task 3 — GET /api/vacancies

**Изменение:** `services/hiring-agent/src/app.js` — добавить метод `getJobs(clientId)`

```js
async getJobs(clientId) {
  if (!sql) return { status: 200, body: { jobs: [] } };
  const rows = await sql`
    SELECT job_id, title
    FROM chatbot.jobs
    WHERE client_id = ${clientId}
    ORDER BY created_at DESC
  `;
  return { status: 200, body: { jobs: rows } };
}
```

> **Таблица `chatbot.jobs`** — существует в схеме (используется в `scripts/lib/recruiter-access.js:listRecruiters` — `JOIN chatbot.jobs j ON j.client_id = r.client_id`). Дополнительных миграций не нужно.

`http-server.js`: `GET /api/vacancies` вызывает `app.getVacancies(...)`; `GET /api/jobs` оставлен как backward-compatible alias.

---

## Task 4 — PM2 ecosystem file

**Файл:** `services/hiring-agent/ecosystem.config.cjs`

```js
module.exports = {
  apps: [{
    name: 'hiring-agent',
    script: './src/index.js',
    cwd: '/opt/hiring-agent/services/hiring-agent',
    // НЕ указывать --experimental-vm-modules (это для Jest, не для prod)
    env_production: {
      NODE_ENV: 'production',
      PORT: 3100
      // DATABASE_URL читается через source .env в deploy script (см. Task 5)
    }
  }]
};
```

> **PM2 не читает .env автоматически.** `env_file` работает только в PM2 v5+, которого может не быть на VM.
> Решение: deploy script делает `source /opt/hiring-agent/.env` перед `pm2 restart` (см. Task 5).

---

## Task 5 — Nginx config

**Файл:** `infra/hiring-agent/nginx.conf` (в репо, деплоится на VM вручную)

```nginx
server {
    listen 80;
    server_name <hiring-agent-host>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name <hiring-agent-host>;

    ssl_certificate     /etc/letsencrypt/live/<hiring-agent-host>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<hiring-agent-host>/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3100;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
```

---

## Task 6 — Deploy script

**Файл:** `scripts/deploy-hiring-agent.sh`

```bash
#!/bin/bash
# Деплоит hiring-agent на GCP VM (<vm-public-ip>) через SSH.
# Usage: VM_USER=username ./scripts/deploy-hiring-agent.sh
set -e

VM_HOST="${VM_HOST:-<vm-public-ip>}"
VM_USER="${VM_USER:-vladimir}"
REPO_DIR="/opt/hiring-agent"
SHA=$(git rev-parse HEAD)

echo "Deploying hiring-agent @ $SHA → $VM_HOST..."

ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" bash -s << 'REMOTE'
  set -e
  cd /opt/hiring-agent

  git fetch origin main
  git checkout main
  git pull origin main
  pnpm install --frozen-lockfile

  # source .env чтобы PM2 получил DATABASE_URL (PM2 сам .env не читает)
  set -a
  [ -f .env ] && source .env
  set +a

  pm2 restart hiring-agent --update-env || \
    pm2 start services/hiring-agent/ecosystem.config.cjs --env production
  pm2 save

  sleep 2
  STATUS=$(curl -sf http://localhost:3100/health | jq -r '.status' 2>/dev/null || echo "failed")
  echo "Health: $STATUS"
  [ "$STATUS" = "ok" ] || { echo "HEALTH CHECK FAILED"; exit 1; }
REMOTE

echo "Deploy succeeded: $SHA"
```

> `StrictHostKeyChecking=accept-new` — автоматически принимает unknown host при первом подключении. В CI это нужно явно (GitHub Actions не знает fingerprint VM).

---

## Task 7 — GitHub Actions workflow

**Файл:** `.github/workflows/deploy-hiring-agent.yml`

```yaml
name: Deploy hiring-agent to VM

on:
  push:
    branches: [main]
    paths:
      - 'services/hiring-agent/**'
      - 'infra/hiring-agent/**'
      - 'scripts/deploy-hiring-agent.sh'
  workflow_dispatch:

concurrency:
  group: deploy-hiring-agent
  cancel-in-progress: false

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Authenticate to GCP
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ secrets.WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v3

      - name: Load SSH key from GCP Secret Manager
        run: |
          mkdir -p ~/.ssh
          gcloud secrets versions access latest \
            --secret=VM_SSH_KEY \
            --project=<gcp-project-id> \
            > ~/.ssh/hiring_agent_vm_key
          chmod 600 ~/.ssh/hiring_agent_vm_key
          eval "$(ssh-agent -s)"
          ssh-add ~/.ssh/hiring_agent_vm_key

      - name: Add VM to known_hosts
        run: ssh-keyscan -H <vm-public-ip> >> ~/.ssh/known_hosts

      - name: Deploy
        env:
          VM_HOST: <vm-public-ip>
          VM_USER: vladimir
        run: bash ./scripts/deploy-hiring-agent.sh

      - name: Post-deploy smoke
        run: |
          STATUS=$(curl -sf https://<hiring-agent-host>/health \
            | jq -r '.status' 2>/dev/null || echo "failed")
          echo "Health: $STATUS"
          [ "$STATUS" = "ok" ] || { echo "SMOKE FAILED"; exit 1; }
```

> **VM_SSH_KEY хранится в GCP Secret Manager** (не GitHub Secrets) — консистентно с тем как deploy-prod.yml работает с другими секретами через Workload Identity.
>
> **known_hosts** — шаг `ssh-keyscan` обязателен, иначе `ssh` в CI упадёт с `Host key verification failed`.
>
> **concurrency group** — отдельная от `deploy-prod`, чтобы параллельный merge не создавал race condition на VM.

---

## Task 8 — Tests

**Файл:** `tests/unit/hiring-agent-auth.test.js`

Тесты:
- `parseCookies("")` → `{}`
- `parseCookies("session=abc123; foo=bar")` → `{session: "abc123", foo: "bar"}`
- `resolveSession(mockSql, validToken)` → возвращает recruiter объект
- `resolveSession(mockSql, expiredToken)` → `null`
- `resolveSession(null, anyToken)` → demo recruiter (demo mode)
- `GET /` без cookie → 302 `/login`
- `POST /api/chat` без cookie → 401
- `GET /` без cookie, demo mode (sql=null) → 200

**Обновить `package.json`** — добавить `hiring-agent-auth.test.js` в скрипт `test:hiring-agent`:
```json
"test:hiring-agent": "node --test tests/unit/hiring-agent-router.test.js tests/unit/hiring-agent-funnel-query.test.js tests/unit/hiring-agent-auth.test.js tests/integration/hiring-agent.test.js tests/integration/hiring-agent-funnel-adapter.test.js"
```

---

## Порядок реализации

| # | Задача | Кто | Зависит от |
|---|--------|-----|------------|
| 1 | `auth.js` + login/logout endpoints + recruiter_token wiring | Codex | — |
| 2 | Frontend: login page + улучшенный chat UI (без URL params) | Codex | 1 |
| 3 | `GET /api/vacancies` endpoint | Codex | 1 |
| 4 | Tests + обновить `test:hiring-agent` в package.json | Codex | 1, 2, 3 |
| 5 | PM2 ecosystem file | Codex | — |
| 6 | Nginx config | Codex | — |
| 7 | Deploy script | Codex | 5 |
| 8 | GitHub Actions workflow | Codex | 7 |

Tasks 5-8 можно параллельно с 1-4.

---

## Ручные шаги (не Codex, один раз)

1. **DNS**: A-запись `<hiring-agent-host> → <vm-public-ip>` в Google Domains (domains.google.com → <public-domain> → DNS)

2. **VM first-time setup** (если не сделано):
   ```bash
   ssh <vm-user>@<vm-public-ip>
   # Node 20+ через NodeSource (apt install nodejs даёт старую версию)
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
   sudo npm install -g pnpm pm2
   git clone https://github.com/recruiting-tools/hiring-agent /opt/hiring-agent
   ```

3. **Env vars на VM**: создать `/opt/hiring-agent/.env`:
   ```
   DATABASE_URL=<prod neon url>
   PORT=3100
   NODE_ENV=production
   # SESSION_SECRET не нужен — сессии хранятся в БД как random bytes
   ```

4. **Nginx**: скопировать `infra/hiring-agent/nginx.conf` в `/etc/nginx/sites-available/hiring-agent`, сделать symlink в `sites-enabled`, reload nginx

5. **Certbot**: `sudo certbot --nginx -d <hiring-agent-host>`

6. **GCP Secret Manager**: добавить SSH-ключ `VM_SSH_KEY` для CI:
   ```bash
   gcloud secrets create VM_SSH_KEY --project=<gcp-project-id>
   gcloud secrets versions add VM_SSH_KEY --data-file=~/.ssh/hiring_agent_vm_key
   # Дать доступ Service Account который используется в CI
   gcloud secrets add-iam-policy-binding VM_SSH_KEY \
     --member="serviceAccount:<SA>" --role="roles/secretmanager.secretAccessor" \
     --project=<gcp-project-id>
   ```

---

## Definition of Done

- [ ] `pnpm test:hiring-agent` зелёный (включая новые auth тесты)
- [ ] Локально: форма входа, чат, job selector, logout работают
- [ ] `<hiring-agent-host>` → редирект на `/login`
- [ ] После входа: chat работает, `recruiter_token` из сессии доходит до playbook
- [ ] `/health` возвращает `{"status":"ok"}`
- [ ] CI workflow `deploy-hiring-agent` зелёный
