# Google Cloud Playbooks

Публично-безопасный шаблон operational-команд для GCP-инфраструктуры этого проекта.
Все реальные project id, аккаунты, hostnames и IP должны приходить из secret/vars,
а не храниться в git.

## Контекст

- `GCP_PROJECT_ID=<gcp-project-id>`
- `GCP_REGION=europe-west1`
- `VM_HOST=<vm-public-ip>`
- `VM_NAME=<vm-name>`
- `VM_ZONE=<vm-zone>`
- `VM_USER=<vm-user>`
- `PUBLIC_DOMAIN=<public-domain>`
- `HIRING_AGENT_HOST=<hiring-agent-host>`
- `CANDIDATE_CHATBOT_HOST=<candidate-chatbot-host>`
- `GCP_ACCOUNT_EMAIL=<gcp-account-email>`

## IAP Tunnel

Найти VM по IP:

```bash
gcloud compute instances list \
  --project="$GCP_PROJECT_ID" \
  --account="$GCP_ACCOUNT_EMAIL" \
  --filter="networkInterfaces[0].accessConfigs[0].natIP=$VM_HOST" \
  --format="table(name,zone,status)"
```

SSH через IAP:

```bash
gcloud compute ssh "$VM_NAME" \
  --tunnel-through-iap \
  --project="$GCP_PROJECT_ID" \
  --zone="$VM_ZONE" \
  --account="$GCP_ACCOUNT_EMAIL"
```

Команда на VM без интерактивного входа:

```bash
gcloud compute ssh "$VM_NAME" \
  --tunnel-through-iap \
  --project="$GCP_PROJECT_ID" \
  --zone="$VM_ZONE" \
  --account="$GCP_ACCOUNT_EMAIL" \
  --command="pm2 list"
```

SCP через IAP:

```bash
gcloud compute scp local-file.txt "$VM_NAME:/remote/path" \
  --tunnel-through-iap \
  --project="$GCP_PROJECT_ID" \
  --zone="$VM_ZONE" \
  --account="$GCP_ACCOUNT_EMAIL"
```

Пробросить порт:

```bash
gcloud compute start-iap-tunnel "$VM_NAME" 3101 \
  --local-host-port=localhost:13101 \
  --project="$GCP_PROJECT_ID" \
  --zone="$VM_ZONE" \
  --account="$GCP_ACCOUNT_EMAIL" &

curl http://localhost:13101/health
```

## SSH Keys

Добавить публичный ключ в metadata VM:

```bash
EXISTING=$(gcloud compute instances describe "$VM_NAME" \
  --zone="$VM_ZONE" \
  --project="$GCP_PROJECT_ID" \
  --account="$GCP_ACCOUNT_EMAIL" \
  --format="value(metadata.items[key='ssh-keys'].value)" 2>/dev/null)

NEWKEY="deploy-user:ssh-ed25519 AAAA... deploy-user"

gcloud compute instances add-metadata "$VM_NAME" \
  --zone="$VM_ZONE" \
  --project="$GCP_PROJECT_ID" \
  --account="$GCP_ACCOUNT_EMAIL" \
  --metadata="ssh-keys=${EXISTING}
${NEWKEY}"
```

Приватный ключ для CI должен храниться только в GitHub Secret `VM_SSH_KEY`.

## Firewall

Посмотреть firewall rules для тега:

```bash
gcloud compute firewall-rules list \
  --project="$GCP_PROJECT_ID" \
  --filter="targetTags=TAG_NAME" \
  --format="table(name,direction,allowed,sourceRanges,targetTags)"
```

Временный доступ по SSH:

```bash
gcloud compute firewall-rules create allow-ssh-admin \
  --project="$GCP_PROJECT_ID" \
  --allow=tcp:22 \
  --source-ranges=YOUR_IP/32 \
  --target-tags=TAG_NAME \
  --description="Temp SSH access for admin"
```

## DNS

Пример записи:

```bash
gcloud dns record-sets create <name>."$PUBLIC_DOMAIN". \
  --zone="<dns-zone>" \
  --project="<dns-project-id>" \
  --account="$GCP_ACCOUNT_EMAIL" \
  --type=A --ttl=300 --rrdatas="$VM_HOST"
```

Проверка DNS:

```bash
dig "$HIRING_AGENT_HOST" A +short
nslookup "$HIRING_AGENT_HOST" 8.8.8.8
```

## PM2

```bash
pm2 list
pm2 logs hiring-agent
pm2 restart hiring-agent
ss -tlnp | grep LISTEN
```

## Диагностика деплоя

```bash
curl "https://$HIRING_AGENT_HOST/health"

gcloud compute ssh "$VM_NAME" \
  --tunnel-through-iap \
  --project="$GCP_PROJECT_ID" \
  --zone="$VM_ZONE" \
  --account="$GCP_ACCOUNT_EMAIL" \
  --command="cd /opt/hiring-agent && git log --oneline -5"
```
