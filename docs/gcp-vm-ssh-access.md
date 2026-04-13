# GCP VM SSH Access

VM для `hiring-agent`: **hostname `claude-code-vm`**, IP `34.31.217.176`, region `europe-west1`.

## TL;DR — быстрый доступ

Самый простой способ — прямой SSH с ключом `google_compute_engine` (создаётся gcloud автоматически):

```bash
# Интерактивный вход
ssh -i ~/.ssh/google_compute_engine vova@34.31.217.176

# Выполнить команду
ssh -i ~/.ssh/google_compute_engine vova@34.31.217.176 "pm2 list"
```

**Не надо искать VM в gcloud** — достаточно знать IP и ключ.

---

## Альтернатива: IAP Tunnel

Используй когда: порт 22 закрыт, нет прямого сетевого доступа.

```bash
# VM name: claude-code-vm, zone: europe-west1-b (уточни если изменилось)
gcloud compute ssh claude-code-vm \
  --tunnel-through-iap \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --zone=europe-west1-b \
  --account=ludmilachramcova@gmail.com
```

Подробнее — см. [`docs/google-cloud-playbooks.md`](google-cloud-playbooks.md).

---

## Добавить SSH-ключ без входа на VM

Если нет SSH-доступа, ключ можно добавить напрямую через `authorized_keys` (если уже внутри) или через gcloud metadata.

### Через authorized_keys (если SSH работает)

```bash
echo "ssh-ed25519 AAAA... username" >> ~/.ssh/authorized_keys
```

### Через gcloud metadata (если SSH не работает)

```bash
# Прочитать текущие ключи (не потерять!)
EXISTING=$(gcloud compute instances describe claude-code-vm \
  --zone=europe-west1-b \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --account=ludmilachramcova@gmail.com \
  --format="value(metadata.items[key='ssh-keys'].value)" 2>/dev/null)

# Добавить новый ключ
NEWKEY="username:ssh-ed25519 AAAA... username"
gcloud compute instances add-metadata claude-code-vm \
  --zone=europe-west1-b \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --account=ludmilachramcova@gmail.com \
  --metadata="ssh-keys=${EXISTING}
${NEWKEY}"
```

> **Важно**: `add-metadata` перезаписывает весь ключ `ssh-keys`. Всегда читай существующие перед записью.

---

## CI/CD — SSH ключ для деплоя

Для GitHub Actions ключ хранится как **GitHub Secret** `VM_SSH_KEY`.

**Текущий CI ключ** (username: `github-ci-hiring-agent`):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEhsodQZC9tEvhqh256jta97hA37NAd6sNOq2qdveeTm github-ci-hiring-agent
```

Этот публичный ключ добавлен в `~/.ssh/authorized_keys` на VM. Приватный ключ — в GitHub Secrets → `VM_SSH_KEY`.

---

## Зоопарк портов на VM

| Порт | Сервис |
|------|--------|
| 3000 | Next.js (другой сервис) |
| 3100 | Skillset app (не трогать) |
| **3101** | **hiring-agent** |
| 80/443 | nginx |

Перед деплоем deploy script автоматически проверяет конфликт портов.
CI шаг `Check port availability on VM` выводит `ss -tlnp` + `pm2 list` в лог.

Если нужно задеплоить на другой порт:
```bash
TARGET_PORT=3102 ./scripts/deploy-hiring-agent.sh
# или через GitHub Actions workflow_dispatch: поле target_port
```
