# GCP VM SSH Access

Шаблон доступа к VM для `hiring-agent` без публикации реальных IP, hostname и аккаунтов.

## Required Vars

```bash
export VM_NAME="<vm-name>"
export VM_HOST="<vm-public-ip>"
export VM_ZONE="<vm-zone>"
export VM_USER="<vm-user>"
export GCP_PROJECT_ID="<gcp-project-id>"
export GCP_ACCOUNT_EMAIL="<gcp-account-email>"
```

## TL;DR

Если локально настроен SSH alias:

```bash
ssh hiring-agent-vm
ssh hiring-agent-vm "pm2 list"
```

Если alias сломан, проверь `~/.ssh/config` и фактические `HostName`, `User`, `IdentityFile`.

## IAP Tunnel

```bash
gcloud compute ssh "$VM_NAME" \
  --tunnel-through-iap \
  --project="$GCP_PROJECT_ID" \
  --zone="$VM_ZONE" \
  --account="$GCP_ACCOUNT_EMAIL"
```

Подробнее: [`docs/google-cloud-playbooks.md`](google-cloud-playbooks.md).

## Добавить SSH-ключ

Через `authorized_keys`, если доступ уже есть:

```bash
echo "ssh-ed25519 AAAA... username" >> ~/.ssh/authorized_keys
```

Через metadata VM:

```bash
EXISTING=$(gcloud compute instances describe "$VM_NAME" \
  --zone="$VM_ZONE" \
  --project="$GCP_PROJECT_ID" \
  --account="$GCP_ACCOUNT_EMAIL" \
  --format="value(metadata.items[key='ssh-keys'].value)" 2>/dev/null)

NEWKEY="username:ssh-ed25519 AAAA... username"

gcloud compute instances add-metadata "$VM_NAME" \
  --zone="$VM_ZONE" \
  --project="$GCP_PROJECT_ID" \
  --account="$GCP_ACCOUNT_EMAIL" \
  --metadata="ssh-keys=${EXISTING}
${NEWKEY}"
```

## CI/CD

- GitHub Actions хранит приватный ключ только в секрете `VM_SSH_KEY`
- workflow должен логиниться под отдельным deploy-user или текущим runtime-user
- реальные key material, hostname и IP не должны попадать в git

## Ports

| Порт | Назначение |
|------|------------|
| `3101` | `hiring-agent` |
| `80/443` | nginx / reverse proxy |

Перед деплоем на нестандартный порт проверь занятость через `ss -tlnp` и `pm2 list`.
