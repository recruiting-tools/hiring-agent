# Plan: hiring-agent Frontend + Prod Deploy

## Контекст

`hiring-agent` — рекрутерский AI-агент. Backend готов: `POST /api/chat` + pattern router → playbooks + inline chat UI (встроен прямо в `http-server.js`).

**Работает локально:**
```bash
PORT=3100 DATABASE_URL=$V2_DEV_NEON_URL node services/hiring-agent/src/index.js
# → http://localhost:3100/?token=rec-tok-demo-001
```

**Не сделано для прода:**
1. Нормальная auth (сейчас token из URL-параметра)
2. Деплой на GCP VM `34.31.217.176`
3. Nginx + домен `hiring-chat.recruiter-assistant.com`
4. CI/CD workflow

---

## Архитектура

```
браузер рекрутера
       ↓ HTTPS
hiring-chat.recruiter-assistant.com  (DNS A → 34.31.217.176)
       ↓
  Nginx (VM) — SSL termination, proxy → :3100
       ↓
  hiring-agent  Node.js :3100  (PM2)
       ↓
  Neon prod DB  (chatbot schema — recruiters, sessions, jobs)
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

### Auth flow
1. Рекрутер вводит **email + пароль** (не токен — токен это внутренний идентификатор)
2. Сервер: `bcrypt.compare(password, recruiter.password_hash)` из `chatbot.recruiters`
3. OK → `store.createSession(recruiter_id)` → `session_token` → `Set-Cookie: session=<token>; HttpOnly; Path=/; Max-Age=604800; SameSite=Strict`
4. На каждый запрос: парсим cookie → `store.getSessionRecruiter(token)` → получаем `{recruiter_id, client_id, recruiter_token}`

### Новый модуль `auth.js`
```js
// services/hiring-agent/src/auth.js
export function parseCookies(header) { ... }
export async function resolveSession(sql, cookies) { ... }  // → recruiter | null
export async function createSession(sql, recruiterId) { ... }  // → token
export async function getRecruiterByEmail(sql, email) { ... }
```

Прямые SQL-запросы к `chatbot.recruiters` и `chatbot.sessions` — без зависимости от `candidate-chatbot`.

### Режим без DB (demo mode)
Если `sql === null` — пропускаем auth, в сессии фиктивный `{recruiter_token: "rec-tok-demo-001"}`.

---

## Task 2 — Frontend: улучшенный UI

**Файл:** `services/hiring-agent/src/http-server.js` (заменить `HTML` константу)

### Login page (GET /login)
Дизайн в стиле текущего (Georgia, тёплые тона, карточка по центру):
- Email + пароль инпуты
- Кнопка "Войти"
- Ошибка под формой если неверные данные
- JS: `fetch('/auth/login', {method:'POST', ...})` → при успехе `window.location = '/'`

### Chat UI (GET /)
Расширить текущий `HTML`:
- **Шапка**: имя/email рекрутера (из сессии) + кнопка "Выйти" → `GET /logout`
- **Job selector**: дропдаун с `job_id` — `GET /api/jobs` возвращает список вакансий рекрутера
- **Chat history**: сохраняется в `sessionStorage` (не теряется при F5, сбрасывается при закрытии вкладки)
- **Error states**: ошибка сети → toast; 401 → редирект на `/login`

### Новый эндпоинт: GET /api/jobs
```js
// app.js — новый метод getJobs()
SELECT job_id, title FROM chatbot.jobs WHERE client_id = $client_id ORDER BY created_at DESC
```
Возвращает `[{job_id, title}]`. Используется для дропдауна в UI.

---

## Task 3 — PM2 ecosystem file

**Файл:** `services/hiring-agent/ecosystem.config.cjs`

```js
module.exports = {
  apps: [{
    name: 'hiring-agent',
    script: './src/index.js',
    cwd: '/opt/hiring-agent/services/hiring-agent',
    node_args: '--experimental-vm-modules',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3100
      // DATABASE_URL, SESSION_SECRET — из /opt/hiring-agent/.env
    }
  }]
};
```

PM2 читает `.env` файл из `cwd` при старте. Env vars задаются на VM вручную один раз.

---

## Task 4 — Nginx config

**Файл:** `infra/hiring-agent/nginx.conf` (в репо, деплоится на VM)

```nginx
server {
    listen 80;
    server_name hiring-chat.recruiter-assistant.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name hiring-chat.recruiter-assistant.com;

    ssl_certificate     /etc/letsencrypt/live/hiring-chat.recruiter-assistant.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hiring-chat.recruiter-assistant.com/privkey.pem;

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

## Task 5 — Deploy script

**Файл:** `scripts/deploy-hiring-agent.sh`

```bash
#!/bin/bash
# Деплоит hiring-agent на GCP VM (34.31.217.176) через SSH.
# Usage: ./scripts/deploy-hiring-agent.sh
set -e

VM_HOST="${VM_HOST:-34.31.217.176}"
VM_USER="${VM_USER:-vladimir}"
REPO_DIR="/opt/hiring-agent"
SHA=$(git rev-parse HEAD)

echo "Deploying hiring-agent @ $SHA → $VM_HOST..."

ssh "$VM_USER@$VM_HOST" bash -s << REMOTE
  set -e
  cd $REPO_DIR
  git fetch origin main
  git checkout main
  git pull origin main
  pnpm install --frozen-lockfile
  pm2 restart hiring-agent --update-env || \
    pm2 start services/hiring-agent/ecosystem.config.cjs --env production
  pm2 save
  sleep 2
  STATUS=\$(curl -sf http://localhost:3100/health | jq -r '.status' 2>/dev/null || echo "failed")
  echo "Health: \$STATUS"
  [ "\$STATUS" = "ok" ] || { echo "HEALTH CHECK FAILED"; exit 1; }
REMOTE

echo "Deploy succeeded: $SHA"
```

---

## Task 6 — GitHub Actions workflow

**Файл:** `.github/workflows/deploy-hiring-agent.yml`

Триггеры:
- `push` в `main` + path filter `services/hiring-agent/**` или `infra/hiring-agent/**`
- `workflow_dispatch`

Шаги:
1. `actions/checkout`
2. GCP auth (тот же Workload Identity + Service Account что в `deploy-prod.yml`)
3. Получить SSH-ключ из Secret Manager: `gcloud secrets versions access latest --secret=VM_SSH_KEY`
4. `ssh-add` ключа
5. `bash ./scripts/deploy-hiring-agent.sh`
6. Post-deploy smoke: `curl https://hiring-chat.recruiter-assistant.com/health`

**Новый GitHub Secret:** `VM_SSH_KEY` — приватный ключ для SSH на VM.

---

## Task 7 — Tests

Новые unit-тесты в `tests/unit/hiring-agent-auth.test.js`:
- `parseCookies` — парсинг заголовка
- `resolveSession` — mock SQL, валидная/невалидная сессия
- auth middleware — неавторизованный запрос → 302 на `/login`
- auth middleware — без DB (demo mode) → пропускает

---

## Порядок реализации

| # | Задача | Кто | Зависит от |
|---|--------|-----|------------|
| 1 | Auth module + login/logout endpoints | Codex | — |
| 2 | Frontend: login page + улучшенный chat UI | Codex | 1 |
| 3 | `GET /api/jobs` endpoint | Codex | 1 |
| 4 | Tests | Codex | 1, 2, 3 |
| 5 | PM2 ecosystem file | Codex | — |
| 6 | Nginx config | Codex | — |
| 7 | Deploy script | Codex | 5 |
| 8 | GitHub Actions workflow | Codex | 7 |

Tasks 5, 6 можно параллельно с 1-4.

---

## Ручные шаги (не Codex, один раз)

1. **DNS**: A-запись `hiring-chat.recruiter-assistant.com → 34.31.217.176` в Cloudflare (DNS only, не proxy)
2. **VM first-time setup** (если не сделано):
   ```bash
   ssh vladimir@34.31.217.176
   sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx
   sudo npm install -g pnpm pm2
   git clone https://github.com/recruiting-tools/hiring-agent /opt/hiring-agent
   ```
3. **Env vars на VM**: создать `/opt/hiring-agent/.env`:
   ```
   DATABASE_URL=<prod neon url>
   SESSION_SECRET=<random 64 hex chars>
   PORT=3100
   NODE_ENV=production
   ```
4. **Certbot**: `sudo certbot --nginx -d hiring-chat.recruiter-assistant.com`
5. **GitHub Secret**: добавить `VM_SSH_KEY` в repo settings

---

## Definition of Done

- [ ] `pnpm test:hiring-agent` зелёный
- [ ] Локально: форма входа, чат, logout работают
- [ ] `hiring-chat.recruiter-assistant.com` открывается, редирект на `/login`
- [ ] После входа: чат работает, job selector показывает вакансии
- [ ] `/health` возвращает `{"status":"ok"}`
- [ ] CI workflow зелёный
