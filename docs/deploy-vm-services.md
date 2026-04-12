# VM Deploy Guide

Этот документ покрывает только VM-based сервисы из этого репозитория:

- `hiring-agent` → `services/hiring-agent/` → `hiring-chat.recruiter-assistant.com`
- `hh-connector` → `services/hh-connector/` → внутренний
- `hiring-mcp` → `services/hiring-mcp/` → внутренний

`candidate-chatbot` сюда не входит: он уже деплоится в Cloud Run через [`scripts/deploy.sh`](/Users/vova/Documents/GitHub/hiring-agent/scripts/deploy.sh).

## Shared Prerequisites And Access

### Shared Snapshot

| Field | Value |
|-------|-------|
| GCP project | `project-5d8dd8a0-67af-44ba-b6e` |
| Region | `europe-west1` |
| Runtime | `Node.js` + `pnpm` |
| Runtime user | `vova` |
| VM public IP | `34.31.217.176` |
| App dir pattern | `/home/vova/<service-name>/` |

### VM Lookup Result

Для фиксации VM identity был выполнен запрос:

```bash
gcloud compute instances list \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --format="value(name,zone,networkInterfaces[0].accessConfigs[0].natIP)"
```

Результат на `2026-04-12`:

```text
vpn-george   europe-west3-a   35.198.78.143
vpn-george   europe-west3-b   34.185.168.157
vpn-tonia    europe-north1-c  35.228.179.144
vk-tunnel    europe-north1-a  35.228.180.87
vpn-finland  europe-north1-a  34.88.175.133
vpn-kids     europe-north1-a  35.228.174.227
```

`34.31.217.176` в этом выводе не найден. Ниже guide использует известный public IP и сервисные конвенции репозитория. Перед первым реальным deploy стоит отдельно сверить фактические `VM name` и `zone` в GCP Console или обновлённым `gcloud` доступом.

### Access Model

Рекомендуемый operational pattern:

- shell через `gcloud compute ssh --tunnel-through-iap`
- file upload через `gcloud compute scp --tunnel-through-iap`
- systemd для каждого сервиса
- nginx только для внешнего `hiring-agent`
- public traffic только через `hiring-chat.recruiter-assistant.com`

Базовый preflight:

```bash
gcloud auth login
gcloud config set project project-5d8dd8a0-67af-44ba-b6e
gcloud config get-value project
```

Оператору нужны:

- доступ к проекту `project-5d8dd8a0-67af-44ba-b6e`
- SSH access на VM
- доступ к IAP tunnel
- право управлять `systemd` и `nginx` на VM

### One-Off Access

Если VM identity уже подтверждена:

```bash
VM_NAME="UNRESOLVED_VM_NAME_2026_04_12"
ZONE="UNRESOLVED_ZONE_2026_04_12"
PROJECT="project-5d8dd8a0-67af-44ba-b6e"

gcloud compute ssh vova@"$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap
```

Статус systemd:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap \
  --command="sudo systemctl status hiring-agent.service --no-pager"
```

Заливка артефакта:

```bash
gcloud compute scp ./deploy.tar.gz vova@"$VM_NAME":/tmp/deploy.tar.gz \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap
```

### SSH Alias

Когда `VM_NAME` и `ZONE` будут подтверждены, удобно добавить alias:

```sshconfig
Host hiring-vm
    HostName UNRESOLVED_VM_NAME_2026_04_12
    User vova
    IdentityFile ~/.ssh/google_compute_engine
    IdentitiesOnly yes
    ProxyCommand /opt/homebrew/bin/gcloud compute start-iap-tunnel UNRESOLVED_VM_NAME_2026_04_12 22 --listen-on-stdin --zone=UNRESOLVED_ZONE_2026_04_12 --project=project-5d8dd8a0-67af-44ba-b6e
```

Тогда:

```bash
ssh hiring-vm
```

### Packaging Convention

Эти три сервиса в текущем репозитории ещё не имеют полного checked-in runtime layout, поэтому deploy skeleton ниже опирается на операционную конвенцию:

- локально собирается self-contained артефакт для одного сервиса
- артефакт распаковывается в `/home/vova/<service-name>/`
- в каталоге сервиса на VM лежат минимум `dist/`, `package.json`, `pnpm-lock.yaml`, `.env`
- `pnpm install --prod --frozen-lockfile` выполняется на VM уже внутри каталога сервиса

Если сервис остаётся workspace-dependent, сначала нужно собрать deploy bundle без зависимости на корневой monorepo layout.

## Hiring-Agent

### Service Snapshot

| Field | Value |
|-------|-------|
| Service | `hiring-agent` |
| Repo path | `services/hiring-agent/` |
| App dir | `/home/vova/hiring-agent/` |
| Systemd unit | `hiring-agent.service` |
| Listen port | `3100` |
| Local healthcheck | `http://127.0.0.1:3100/health` |
| Public URL | `https://hiring-chat.recruiter-assistant.com` |
| Public healthcheck | `https://hiring-chat.recruiter-assistant.com/health` |
| Public IP | `34.31.217.176` |

### Deploy Script Skeleton

```bash
#!/bin/bash
set -euo pipefail

PROJECT="project-5d8dd8a0-67af-44ba-b6e"
ZONE="UNRESOLVED_ZONE_2026_04_12"
VM="UNRESOLVED_VM_NAME_2026_04_12"
SERVICE="hiring-agent"
REMOTE_DIR="/home/vova/$SERVICE"
LOCAL_TARBALL="/tmp/$SERVICE-deploy.tar.gz"
SSH="gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --tunnel-through-iap"
SCP="gcloud compute scp --zone=$ZONE --project=$PROJECT --tunnel-through-iap"

# 1. Собрать self-contained bundle локально
tar czf "$LOCAL_TARBALL" dist/ package.json pnpm-lock.yaml

# 2. Залить bundle
$SSH --command="mkdir -p $REMOTE_DIR"
$SCP "$LOCAL_TARBALL" vova@$VM:/tmp/$SERVICE-deploy.tar.gz

# 3. Распаковать и установить prod dependencies
$SSH --command="cd $REMOTE_DIR && tar xzf /tmp/$SERVICE-deploy.tar.gz && pnpm install --prod --frozen-lockfile"

# 4. Проверить права на env
$SSH --command="chmod 600 $REMOTE_DIR/.env"

# 5. Перезапустить сервис
$SSH --command="sudo systemctl restart hiring-agent.service"

# 6. Проверить локальный и внешний health
$SSH --command="curl -sf http://127.0.0.1:3100/health"
curl -sf https://hiring-chat.recruiter-assistant.com/health
```

### Systemd Unit

```ini
[Unit]
Description=hiring-agent
After=network.target

[Service]
Type=simple
User=vova
WorkingDirectory=/home/vova/hiring-agent
EnvironmentFile=/home/vova/hiring-agent/.env
ExecStart=/usr/bin/node /home/vova/hiring-agent/dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Nginx Config

```nginx
server {
    listen 80;
    server_name hiring-chat.recruiter-assistant.com;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:3100/health;
        proxy_set_header Host $host;
    }
}
```

### Runbook

Статус:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo systemctl status hiring-agent.service --no-pager"
```

Логи:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo journalctl -u hiring-agent.service -n 100 --no-pager"
```

Рестарт:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo systemctl restart hiring-agent.service"
```

Smoke:

```bash
curl -I https://hiring-chat.recruiter-assistant.com/
curl -sf https://hiring-chat.recruiter-assistant.com/health
```

## HH-Connector

### Service Snapshot

| Field | Value |
|-------|-------|
| Service | `hh-connector` |
| Repo path | `services/hh-connector/` |
| App dir | `/home/vova/hh-connector/` |
| Systemd unit | `hh-connector.service` |
| Listen port | `3200` |
| Local healthcheck | `http://127.0.0.1:3200/health` |
| Public URL | `internal only` |
| Public IP | `34.31.217.176` |

### Deploy Script Skeleton

```bash
#!/bin/bash
set -euo pipefail

PROJECT="project-5d8dd8a0-67af-44ba-b6e"
ZONE="UNRESOLVED_ZONE_2026_04_12"
VM="UNRESOLVED_VM_NAME_2026_04_12"
SERVICE="hh-connector"
REMOTE_DIR="/home/vova/$SERVICE"
LOCAL_TARBALL="/tmp/$SERVICE-deploy.tar.gz"
SSH="gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --tunnel-through-iap"
SCP="gcloud compute scp --zone=$ZONE --project=$PROJECT --tunnel-through-iap"

tar czf "$LOCAL_TARBALL" dist/ package.json pnpm-lock.yaml

$SSH --command="mkdir -p $REMOTE_DIR"
$SCP "$LOCAL_TARBALL" vova@$VM:/tmp/$SERVICE-deploy.tar.gz
$SSH --command="cd $REMOTE_DIR && tar xzf /tmp/$SERVICE-deploy.tar.gz && pnpm install --prod --frozen-lockfile"
$SSH --command="chmod 600 $REMOTE_DIR/.env"
$SSH --command="sudo systemctl restart hh-connector.service"
$SSH --command="curl -sf http://127.0.0.1:3200/health"
```

### Systemd Unit

```ini
[Unit]
Description=hh-connector
After=network.target

[Service]
Type=simple
User=vova
WorkingDirectory=/home/vova/hh-connector
EnvironmentFile=/home/vova/hh-connector/.env
ExecStart=/usr/bin/node /home/vova/hh-connector/dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Runbook

Статус:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo systemctl status hh-connector.service --no-pager"
```

Логи:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo journalctl -u hh-connector.service -n 100 --no-pager"
```

Рестарт:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo systemctl restart hh-connector.service"
```

Smoke:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="curl -sf http://127.0.0.1:3200/health"
```

## Hiring-MCP

### Service Snapshot

| Field | Value |
|-------|-------|
| Service | `hiring-mcp` |
| Repo path | `services/hiring-mcp/` |
| App dir | `/home/vova/hiring-mcp/` |
| Systemd unit | `hiring-mcp.service` |
| Listen port | `3300` |
| Local healthcheck | `http://127.0.0.1:3300/health` |
| Public URL | `internal only` |
| Public IP | `34.31.217.176` |

### Deploy Script Skeleton

```bash
#!/bin/bash
set -euo pipefail

PROJECT="project-5d8dd8a0-67af-44ba-b6e"
ZONE="UNRESOLVED_ZONE_2026_04_12"
VM="UNRESOLVED_VM_NAME_2026_04_12"
SERVICE="hiring-mcp"
REMOTE_DIR="/home/vova/$SERVICE"
LOCAL_TARBALL="/tmp/$SERVICE-deploy.tar.gz"
SSH="gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --tunnel-through-iap"
SCP="gcloud compute scp --zone=$ZONE --project=$PROJECT --tunnel-through-iap"

tar czf "$LOCAL_TARBALL" dist/ package.json pnpm-lock.yaml

$SSH --command="mkdir -p $REMOTE_DIR"
$SCP "$LOCAL_TARBALL" vova@$VM:/tmp/$SERVICE-deploy.tar.gz
$SSH --command="cd $REMOTE_DIR && tar xzf /tmp/$SERVICE-deploy.tar.gz && pnpm install --prod --frozen-lockfile"
$SSH --command="chmod 600 $REMOTE_DIR/.env"
$SSH --command="sudo systemctl restart hiring-mcp.service"
$SSH --command="curl -sf http://127.0.0.1:3300/health"
```

### Systemd Unit

```ini
[Unit]
Description=hiring-mcp
After=network.target

[Service]
Type=simple
User=vova
WorkingDirectory=/home/vova/hiring-mcp
EnvironmentFile=/home/vova/hiring-mcp/.env
ExecStart=/usr/bin/node /home/vova/hiring-mcp/dist/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Runbook

Статус:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo systemctl status hiring-mcp.service --no-pager"
```

Логи:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo journalctl -u hiring-mcp.service -n 100 --no-pager"
```

Рестарт:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="sudo systemctl restart hiring-mcp.service"
```

Smoke:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --tunnel-through-iap \
  --command="curl -sf http://127.0.0.1:3300/health"
```
