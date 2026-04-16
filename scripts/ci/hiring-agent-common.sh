#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env: $name"
    exit 1
  fi
}

setup_ssh_access() {
  require_env VM_HOST
  require_env VM_USER
  require_env VM_SSH_KEY

  mkdir -p ~/.ssh
  printf '%s\n' "$VM_SSH_KEY" > ~/.ssh/vm_key
  chmod 600 ~/.ssh/vm_key
  printf 'Host %s\n  IdentityFile ~/.ssh/vm_key\n  StrictHostKeyChecking accept-new\n' \
    "$VM_HOST" >> ~/.ssh/config
  ssh-keyscan -H "$VM_HOST" >> ~/.ssh/known_hosts
}

write_remote_env_file() {
  local remote_path="$1"
  local env_body="$2"
  local env_b64
  env_b64="$(printf '%s' "$env_body" | base64 -w0)"
  ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" \
    "mkdir -p \"$(dirname "$remote_path")\" && echo '$env_b64' | base64 -d > '$remote_path'"
}

ensure_sandbox_nginx_routes() {
  require_env HIRING_AGENT_PUBLIC_HOST

  local snippet_b64
  snippet_b64="$(cat <<'NGINX' | base64 -w0
location = /sandbox-001 { return 301 /sandbox-001/; }
location = /sandbox-002 { return 301 /sandbox-002/; }
location = /sandbox-003 { return 301 /sandbox-003/; }

location ^~ /sandbox-001/ {
  proxy_pass http://127.0.0.1:3201;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}

location ^~ /sandbox-002/ {
  proxy_pass http://127.0.0.1:3202;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}

location ^~ /sandbox-003/ {
  proxy_pass http://127.0.0.1:3203;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
NGINX
)"

  ssh -o StrictHostKeyChecking=accept-new "$VM_USER@$VM_HOST" \
    HIRING_AGENT_PUBLIC_HOST="$HIRING_AGENT_PUBLIC_HOST" \
    SNIPPET_B64="$snippet_b64" \
    bash -s <<'EOF'
set -euo pipefail
if ! sudo -n true 2>/dev/null; then
  echo "ERROR: sudo without password is required to configure nginx sandbox routes"
  exit 1
fi

echo "$SNIPPET_B64" | base64 -d | sudo tee /etc/nginx/snippets/hiring-agent-sandbox-locations.conf >/dev/null

SITE_FILE=$(sudo grep -Rls "server_name .*${HIRING_AGENT_PUBLIC_HOST//./\\.}" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n1 || true)
if [[ -z "$SITE_FILE" ]]; then
  echo "ERROR: could not locate nginx server block for ${HIRING_AGENT_PUBLIC_HOST}"
  exit 1
fi

if ! sudo grep -q "hiring-agent-sandbox-locations.conf" "$SITE_FILE"; then
  sudo sed -i "/server_name .*${HIRING_AGENT_PUBLIC_HOST//./\\.}.*;/a\\    include \\/etc\\/nginx\\/snippets\\/hiring-agent-sandbox-locations.conf;" "$SITE_FILE"
fi

sudo nginx -t
sudo systemctl reload nginx
EOF
}
