# Google Cloud Playbooks

Практические команды для работы с GCP инфраструктурой `recruiter-assistant.com`.

## Контекст

- **Проект**: `project-5d8dd8a0-67af-44ba-b6e` (аккаунт `ludmilachramcova@gmail.com`)
- **Регион**: `europe-west1`
- **VM IP**: `34.31.217.176` (hiring-agent UI)
- **Домен**: `recruiter-assistant.com` — Google Domains, НЕ Cloudflare

---

## IAP Tunnel — доступ к VM без открытого SSH-порта

GCP Identity-Aware Proxy (IAP) позволяет подключаться к VM через Google-авторизацию — не нужен открытый порт 22, не нужен прямой сетевой доступ.

### Требования

- `gcloud auth login` с аккаунтом, у которого есть роль `roles/iap.tunnelResourceAccessor` на проект
- Или через `roles/compute.instanceAdmin.v1` + `roles/iam.serviceAccountUser`

### Найти имя VM по IP

```bash
# Найти VM по внешнему IP в конкретном проекте
gcloud compute instances list \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --account=ludmilachramcova@gmail.com \
  --filter="networkInterfaces[0].accessConfigs[0].natIP=34.31.217.176" \
  --format="table(name,zone,status)"
```

Если неизвестен проект — сканировать по всем:

```bash
for proj in $(gcloud projects list --format="value(projectId)"); do
  result=$(gcloud compute instances list --project="$proj" \
    --filter="networkInterfaces[0].accessConfigs[0].natIP=34.31.217.176" \
    --format="value(name,zone)" 2>/dev/null)
  [ -n "$result" ] && echo "$proj: $result"
done
```

### SSH через IAP tunnel

```bash
# Основная команда (заменить VM_NAME и ZONE)
gcloud compute ssh VM_NAME \
  --tunnel-through-iap \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --zone=ZONE \
  --account=ludmilachramcova@gmail.com
```

**Пример** (если VM называется `hiring-agent-vm` и zone `europe-west1-b`):

```bash
gcloud compute ssh hiring-agent-vm \
  --tunnel-through-iap \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --zone=europe-west1-b \
  --account=ludmilachramcova@gmail.com
```

### Выполнить команду на VM через IAP (без интерактивного входа)

```bash
gcloud compute ssh VM_NAME \
  --tunnel-through-iap \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --zone=ZONE \
  --account=ludmilachramcova@gmail.com \
  --command="pm2 list"
```

### Скопировать файл через IAP (scp)

```bash
gcloud compute scp local-file.txt VM_NAME:/remote/path \
  --tunnel-through-iap \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --zone=ZONE \
  --account=ludmilachramcova@gmail.com
```

### Пробросить порт через IAP tunnel

Удобно для доступа к сервису на VM без открытия firewall:

```bash
# Пробросить порт 3101 VM → localhost:13101
gcloud compute start-iap-tunnel VM_NAME 3101 \
  --local-host-port=localhost:13101 \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --zone=ZONE \
  --account=ludmilachramcova@gmail.com &

# Теперь можно:
curl http://localhost:13101/health
```

---

## SSH-ключи — управление без входа на VM

### Добавить публичный ключ в метадату VM

```bash
# Текущие ключи (не потерять существующие!)
EXISTING=$(gcloud compute instances describe VM_NAME \
  --zone=ZONE \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --account=ludmilachramcova@gmail.com \
  --format="value(metadata.items[key='ssh-keys'].value)" 2>/dev/null)

# Новый ключ (формат: "username:ssh-ed25519 AAAA... username")
NEWKEY="github-ci-hiring-agent:ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEhsodQZC9tEvhqh256jta97hA37NAd6sNOq2qdveeTm github-ci-hiring-agent"

# Добавить (через newline)
gcloud compute instances add-metadata VM_NAME \
  --zone=ZONE \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --account=ludmilachramcova@gmail.com \
  --metadata="ssh-keys=${EXISTING}
${NEWKEY}"
```

> **Важно**: `add-metadata` перезаписывает весь ключ `ssh-keys`. Всегда читай существующие ключи перед записью.

### CI/CD SSH ключ для GitHub Actions

**Публичный ключ** (должен быть в метадате VM, username: `github-ci-hiring-agent`):

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEhsodQZC9tEvhqh256jta97hA37NAd6sNOq2qdveeTm github-ci-hiring-agent
```

**Приватный ключ** → GitHub Secrets → `VM_SSH_KEY`.

---

## Firewall — управление правилами

### Посмотреть правила для VM

```bash
# Теги на VM
gcloud compute instances describe VM_NAME \
  --zone=ZONE \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --format="value(tags.items)"

# Правила для тега
gcloud compute firewall-rules list \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --filter="targetTags=TAG_NAME" \
  --format="table(name,direction,allowed,sourceRanges,targetTags)"
```

### Разрешить SSH-доступ с конкретного IP

```bash
gcloud compute firewall-rules create allow-ssh-admin \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --allow=tcp:22 \
  --source-ranges=YOUR_IP/32 \
  --target-tags=TAG_NAME \
  --description="Temp SSH access for admin"
```

### Удалить временное правило после завершения работы

```bash
gcloud compute firewall-rules delete allow-ssh-admin \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --quiet
```

---

## DNS — Google Domains (domains.google.com)

DNS для `recruiter-assistant.com` управляется через **Google Domains** → `domains.google.com`.
**НЕ Cloudflare, НЕ Cloud DNS** (хотя NS-серверы — `ns-cloud-a*.googledomains.com`).

### Текущие A-записи (что нужно)

| Запись | Тип | Значение |
|--------|-----|---------|
| `hiring-chat.recruiter-assistant.com` | A | `34.31.217.176` |
| `candidate-chatbot.recruiter-assistant.com` | CNAME | `ghs.googlehosted.com` |

**Добавить A-запись**: открыть [domains.google.com](https://domains.google.com) → `recruiter-assistant.com` → DNS → Custom records → Add.

### Проверить DNS

```bash
dig hiring-chat.recruiter-assistant.com A +short
# Ожидаемый ответ: 34.31.217.176

nslookup hiring-chat.recruiter-assistant.com 8.8.8.8
```

---

## PM2 — управление процессами на VM

```bash
# После подключения через IAP или SSH:
pm2 list                        # список процессов
pm2 logs hiring-agent           # логи в реальном времени
pm2 logs hiring-agent --lines 100  # последние 100 строк
pm2 restart hiring-agent        # рестарт
pm2 stop hiring-agent           # остановить
pm2 status                      # статус + CPU/MEM

# Проверить порты
ss -tlnp | grep LISTEN
```

---

## Диагностика деплоя

### Health check вручную

```bash
# Через IAP port forward (см. выше)
curl http://localhost:13101/health

# После того как DNS настроен
curl https://hiring-chat.recruiter-assistant.com/health
```

### Посмотреть последний деплой

```bash
gcloud compute ssh VM_NAME \
  --tunnel-through-iap \
  --project=project-5d8dd8a0-67af-44ba-b6e \
  --zone=ZONE \
  --command="cd /opt/hiring-agent && git log --oneline -5"
```

---

## Зоопарк портов на VM 34.31.217.176

| Порт | Сервис |
|------|--------|
| 3100 | Skillset Next.js app (другой сервис, не трогать) |
| **3101** | **hiring-agent** |
| 80/443 | nginx (reverse proxy) |

Перед деплоем на другой порт:
```bash
TARGET_PORT=3102 ./scripts/deploy-hiring-agent.sh
# или через GitHub Actions workflow_dispatch: поле target_port
```
