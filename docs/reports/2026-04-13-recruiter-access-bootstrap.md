# Recruiter Access Bootstrap

Date: 2026-04-13

Purpose: give admins a deterministic way to inspect recruiter users in a target database and issue or rotate login credentials without hand-editing SQL.

> This script is legacy tenant-local tooling.
> It updates `chatbot.recruiters` only.
> It does NOT create or update `management.recruiters`, so it is not the correct bootstrap path
> for `<hiring-agent-host>/login`.
>
> For `hiring-agent` login/bootstrap use:
> - `scripts/bootstrap-demo-user.js` for demo/bootstrap flows
> - `scripts/bootstrap-management-recruiters.js` when mirroring recruiters into `management.*`

## Commands

List recruiters in the current database:

```bash
DATABASE_URL=... node scripts/bootstrap-recruiter-access.js list
```

Filter by client:

```bash
DATABASE_URL=... node scripts/bootstrap-recruiter-access.js list --client-id <demo-client-id>
```

Create a recruiter access row for an existing client:

```bash
DATABASE_URL=... node scripts/bootstrap-recruiter-access.js create \
  --recruiter-id recruiter-client-001 \
  --client-id <demo-client-id> \
  --email recruiter@example.test \
  --token rec-tok-client-001
```

Set or rotate password for an existing recruiter:

```bash
DATABASE_URL=... node scripts/bootstrap-recruiter-access.js set-password \
  --email recruiter@example.test
```

Set password with explicit tenant guard and token update:

```bash
DATABASE_URL=... node scripts/bootstrap-recruiter-access.js set-password \
  --recruiter-id <demo-recruiter-id> \
  --client-id <demo-client-id> \
  --set-token <prod-recruiter-token>
```

## Safety Rules

- The script lists recruiter rows before any change so the operator can confirm the target tenant.
- `create` only inserts a recruiter into an existing `management.clients` tenant.
- Lookup must resolve to exactly one recruiter.
- `--client-id` acts as a tenant guard and fails if the recruiter belongs to another client.
- `create` and `set-password --set-email` fail if the email is already used by another recruiter.
- `create` and `set-password --set-token` fail if the recruiter token is already used by another recruiter.
- Output includes `database_name`, `client_id`, `client_name`, and `visible_jobs` so the operator can verify they are touching the correct tenant.

## Intended Use

- post-migration recruiter login issuance
- controlled recruiter creation when migration created jobs but not the recruiter row
- password rotation
- tenant-safe recovery when the recruiter row already exists

## Not Intended For

- bootstrapping `<hiring-agent-host>/login`
- validating `management.sessions`
- provisioning control-plane auth for the management-backed `hiring-agent`
