# VM Deploy Guide

Публично-безопасный guide для VM-based сервисов без реальных project id, hostnames, IP и аккаунтов.

## Scope

Этот документ покрывает только VM-based сервисы из этого репозитория:

- `hiring-agent`
- `hh-connector`
- `hiring-mcp`

`candidate-chatbot` деплоится отдельно в Cloud Run через [`scripts/deploy.sh`](/Users/vova/Documents/GitHub/hiring-agent/scripts/deploy.sh).

## Shared Snapshot

| Field | Value |
|-------|-------|
| GCP project | `<gcp-project-id>` |
| Region | `europe-west1` |
| Runtime | `Node.js` + `pnpm` |
| Runtime user | `<vm-user>` |
| VM public IP | `<vm-public-ip>` |
| App dir pattern | `/home/<vm-user>/<service-name>/` |

## Access Model

Рекомендуемый pattern:

- shell через `gcloud compute ssh --tunnel-through-iap`
- file upload через `gcloud compute scp --tunnel-through-iap`
- process manager: `PM2`
- nginx только для внешнего `hiring-agent`
- public traffic только через canonical public host из infra config

Базовый preflight:

```bash
gcloud auth login
gcloud config set project <gcp-project-id>
gcloud config get-value project
```

## One-Off Access

```bash
VM_NAME="<vm-name>"
ZONE="<vm-zone>"
PROJECT="<gcp-project-id>"
VM_USER="<vm-user>"

gcloud compute ssh "$VM_USER@$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap
```

Статус runtime:

```bash
gcloud compute ssh "$VM_NAME" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap \
  --command="pm2 list"
```

Заливка артефакта:

```bash
gcloud compute scp ./deploy.tar.gz "$VM_USER@$VM_NAME:/tmp/deploy.tar.gz" \
  --zone="$ZONE" \
  --project="$PROJECT" \
  --tunnel-through-iap
```

## SSH Alias

```sshconfig
Host hiring-vm
    HostName <vm-name>
    User <vm-user>
    IdentityFile ~/.ssh/google_compute_engine
    IdentitiesOnly yes
    ProxyCommand /opt/homebrew/bin/gcloud compute start-iap-tunnel <vm-name> 22 --listen-on-stdin --zone=<vm-zone> --project=<gcp-project-id>
```

## Hiring-Agent

Текущий runtime contract:

- app dir: `/opt/hiring-agent`
- process manager: `PM2`
- listen port: `3101`
- local healthcheck: `http://127.0.0.1:3101/health`
- public URL: `https://<hiring-agent-host>`

Проверка:

```bash
curl -sf http://127.0.0.1:3101/health
curl -sf https://<hiring-agent-host>/health
pm2 list
pm2 logs hiring-agent --lines 100
```

Nginx skeleton:

```nginx
server {
    listen 80;
    server_name <hiring-agent-host>;

    location / {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Notes

- Реальные IP, DNS zone names, project ids и deploy accounts храните в secret manager, GitHub vars/secrets или private ops docs
- Public repo должен содержать только шаблоны, команды и expected env names
