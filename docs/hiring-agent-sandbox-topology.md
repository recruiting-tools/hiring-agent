# Hiring-Agent Sandbox Topology

Дата: 2026-04-14  
Статус: draft

## Why

Для `hiring-agent` одной sandbox branch tenant DB недостаточно.

Сервис использует два независимых слоя:

- `MANAGEMENT_DATABASE_URL` — control plane:
  recruiters, sessions, tenant bindings, playbook_definitions, playbook_steps
- tenant/chatbot DB — data plane:
  jobs, pipeline data, candidate runtime state

Если sandbox UI смотрит на production `MANAGEMENT_DATABASE_URL`, мы все равно рискуем:

- видеть production playbook definitions;
- создавать production `playbook_sessions`;
- ловить ложные баги из-за production seed state;
- смешивать sandbox UI с production control-plane data.

## Required Sandbox Shape

Безопасный sandbox для `hiring-agent` должен иметь:

1. отдельную Neon branch для tenant DB;
2. отдельную Neon branch для management DB;
3. sandbox runtime с:
   - `APP_ENV=sandbox`
   - `MANAGEMENT_DATABASE_URL=<management sandbox branch>`
   - tenant binding, ведущий в sandbox tenant DB

## Topology

### Data plane

- project: `round-leaf-16031956`
- branch: `sandbox`
- envs:
  - `CHATBOT_DATABASE_URL`
  - `SANDBOX_DATABASE_URL`

### Control plane

- project: `orange-silence-65083641`
- branch: `sandbox`
- env:
  - `MANAGEMENT_DATABASE_URL`

## Bootstrap Order

```bash
NEON_API_KEY=... ./scripts/neon-hiring-agent-sandbox-branch.sh

export CHATBOT_DATABASE_URL='...'
export SANDBOX_DATABASE_URL='...'
export MANAGEMENT_DATABASE_URL='...'

node scripts/migrate-management.js
DATABASE_URL="$CHATBOT_DATABASE_URL" node scripts/migrate.js

pnpm seed:sandbox
pnpm bootstrap:management:tenants
pnpm bootstrap:management:recruiters
pnpm bootstrap:management:bindings
pnpm bootstrap:demo-user
MANAGEMENT_DATABASE_URL="$MANAGEMENT_DATABASE_URL" node scripts/seed-playbooks.js --force
```

## What This Unlocks

- safe debugging of `create_vacancy` / runtime steps without touching production;
- safe reseeding of `playbook_definitions` and `playbook_steps`;
- realistic UI/WS/login testing against sandbox state;
- isolated destructive iteration on playbooks and recruiter sessions.

## Operational Rule

`hiring-agent` sandbox must never point to:

- production `MANAGEMENT_DATABASE_URL`
- production tenant binding

If one of those is production, this is not a sandbox.
