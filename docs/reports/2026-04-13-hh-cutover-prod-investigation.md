# HH Cutover Production Investigation

Date: 2026-04-13
Status: draft investigation artifact

## Scope

This document captures the current evidence for why merged HH cutover work is not visible in production data or recruiter UI.

It is intentionally forensic first:

- what was merged
- what was deployed
- what production is currently wired to
- what production data actually contains
- what expected result we should hold the fix against

## GitHub Artifacts

### Merged PRs directly relevant to the gap

| PR | URL | What it changed |
| --- | --- | --- |
| `#2` | https://github.com/recruiting-tools/hiring-agent/pull/2 | HH import path and moderation review upgrades |
| `#3` | https://github.com/recruiting-tools/hiring-agent/pull/3 | HH import collection routing hardening |
| `#4` | https://github.com/recruiting-tools/hiring-agent/pull/4 | recruiter access bootstrap tooling |
| `#6` | https://github.com/recruiting-tools/hiring-agent/pull/6 | recruiter access review fixes |

### HH vacancy IDs explicitly in PR `#2` scope

- `131345849` — менеджер по закупкам из Китая
- `131532142` — дизайнер
- `131812494` — дизайнер
- `132032392` — менеджер по продажам

### Production deploy runs

| Run | URL | Created at UTC | Head SHA | Result |
| --- | --- | --- | --- | --- |
| `24325735120` | https://github.com/recruiting-tools/hiring-agent/actions/runs/24325735120 | 2026-04-13 04:30:57Z | `41fbd9bf818c43810ad22913ab0cb6509127d657` | success |
| `24326071289` | https://github.com/recruiting-tools/hiring-agent/actions/runs/24326071289 | 2026-04-13 04:44:13Z | `d1a81125ec1d32539b5c48dbfa0ffe48cd231d76` | success |
| `24326139231` | https://github.com/recruiting-tools/hiring-agent/actions/runs/24326139231 | 2026-04-13 04:46:58Z | `54660cc5a0cf3905b68a2600f91bc5d7f6ef1ac2` | success |

## What Production Is Running

Cloud Run service: `candidate-chatbot-v2`

Observed via `gcloud run services describe candidate-chatbot-v2 --region=europe-west1 --project=<gcp-project-id>`:

- latest ready revision: `candidate-chatbot-v2-00014-vwz`
- `DEPLOY_SHA=54660cc5a0cf3905b68a2600f91bc5d7f6ef1ac2`
- `DEPLOY_TIME=2026-04-13T04:47:44Z`
- database secret mounted into runtime: `V2_PROD_NEON_URL`

Important implication:

- the service is not currently running the SHA from run `24325735120`
- production moved forward after that run
- any investigation must use the live revision and the live `V2_PROD_NEON_URL` secret, not only the earlier deploy run

## What Production DB Contains Right Now

Observed by reading the current `V2_PROD_NEON_URL` secret from GCP Secret Manager and querying the live database on 2026-04-13.

### Tenants

`management.clients`:

| client_id | name |
| --- | --- |
| `client-alpha-001` | `Alpha Corp` |
| `client-beta-001` | `Beta Ltd` |
| `client-prod-001` | `Hiring Agent Demo` |

Observed gap:

- no client row corresponding to the 4 HH vacancies described in PR `#2`
- no tenant that obviously represents the migrated real recruiter account
- one recruiter row still references `<demo-client-id>`, but that client row is absent from `management.clients`

### Jobs

`chatbot.jobs`:

| job_id | client_id | title |
| --- | --- | --- |
| `job-prod-001` | `client-prod-001` | `Менеджер по закупкам` |

Observed gap:

- only one job exists in production
- the 4 HH vacancy IDs from PR `#2` are not present as production jobs

### Recruiters

`chatbot.recruiters`:

| recruiter_id | client_id | email | token | has_password |
| --- | --- | --- | --- | --- |
| `rec-alpha-001` | `client-alpha-001` | `alice@alpha.test` | `rec-tok-alpha-001` | `false` |
| `rec-alpha-002` | `client-alpha-001` | `alex@alpha.test` | `rec-tok-alpha-002` | `false` |
| `rec-beta-001` | `client-beta-001` | `bob@beta.test` | `rec-tok-beta-001` | `false` |
| `rec-beta-002` | `client-beta-001` | `bella@beta.test` | `rec-tok-beta-002` | `false` |
| `<demo-recruiter-id>` | `<demo-client-id>` | `recruiter@example.test` | `<demo-recruiter-token>` | `false` |
| `recruiter-prod-001` | `client-prod-001` | `demo@example.test` | `<prod-recruiter-token>` | `true` |

Observed gap:

- production has one usable recruiter login, and it is still the demo tenant
- there is no recruiter row for a real migrated HH tenant

### Runtime data counts

| Table | Count |
| --- | --- |
| `chatbot.candidates` | `0` |
| `chatbot.conversations` | `0` |
| `chatbot.messages` | `0` |
| `chatbot.planned_messages` | `0` |
| `chatbot.pipeline_runs` | `0` |
| `chatbot.pipeline_step_state` | `0` |
| `chatbot.hh_negotiations` | `0` |

Observed gap:

- there is no imported recruiter-facing data in production at all
- this is not a UI-only visibility bug; the target DB is effectively empty of HH cutover data

## Migration State In Production DB

`public.schema_migrations` currently contains only:

- `001_iteration_2_client_schema.sql`
- `002_iteration_3_hh_integration.sql`
- `003_send_guard_unique_index.sql`
- `004_planned_messages_hh_message_id.sql`
- `005_iteration_4_moderation_ui.sql`
- `006_iteration_5_multi_tenant.sql`
- `007_iteration_6_telegram.sql`
- `008_auth.sql`

Observed gap:

- migration `009_hh_oauth_and_flags.sql` is not applied
- migration `010_step_follow_up_count.sql` is not applied
- production also lacks the tables introduced by that migration:
  - `management.oauth_tokens`
  - `management.feature_flags`

This is a release-process failure, not only a data-migration failure.

## Branch / Environment Evidence

Repository docs describe a split topology:

- dev project: `<dev-project-id>`
- sandbox branch inside that dev project
- temporary `pr-*` Neon branches for dry runs
- production project: `shiny-darkness-67314937`

Relevant source files:

- [README.md](/Users/vova/Documents/GitHub/hiring-agent-investigation/README.md:89)
- [docs/neon-sandbox-runbook.md](/Users/vova/Documents/GitHub/hiring-agent-investigation/docs/neon-sandbox-runbook.md:14)
- [docs/reports/2026-04-13-hh-cutover-plan.md](/Users/vova/Documents/GitHub/hiring-agent-investigation/docs/reports/2026-04-13-hh-cutover-plan.md:37)

Observed mismatch:

- PR `#2` planning assumes validation on a dedicated Neon branch in dev project `<dev-project-id>`
- live production runtime reads `V2_PROD_NEON_URL` from GCP and points at the production DB
- there is no visible automation in the production deploy workflow that:
  - runs outstanding DB migrations on the production DB
  - promotes data from a validated Neon branch into production
  - proves that HH import was executed against production after merge

## Release Process Gap

Production deploy workflow:

- [`.github/workflows/deploy-prod.yml`](/Users/vova/Documents/GitHub/hiring-agent-investigation/.github/workflows/deploy-prod.yml:1)
- [`scripts/deploy.sh`](/Users/vova/Documents/GitHub/hiring-agent-investigation/scripts/deploy.sh:1)

What it does:

- build and deploy Cloud Run service
- mount `V2_PROD_NEON_URL`
- smoke-check `/`, `/login`, `/health`

What it does not do:

- run `node scripts/migrate.js` against production DB
- verify `schema_migrations` is current
- import or reconcile HH vacancies/data
- verify recruiter-facing business data exists after deploy

This explains why merged application code can be live while production DB remains behind and empty.

## Current Best Hypothesis

The most likely failure chain is:

1. HH cutover implementation was merged at code level.
2. Sandbox/dev-branch validation and production rollout were treated as separate concerns.
3. Production deploys continued to ship app code successfully.
4. Production DB migrations and production import/cutover steps were never executed, or were executed only on a non-production Neon branch/project.
5. Recruiter UI therefore points at a real production DB that still contains demo seed data and no imported HH records.

## Expected Result

After the fix is complete, production should satisfy all of the following:

1. `public.schema_migrations` in production includes all required migrations for HH import and flags, including `009_hh_oauth_and_flags.sql`.
2. Production contains client rows and recruiter rows for the intended real recruiter tenant, not only demo tenants.
3. Production contains the in-scope HH vacancies from the cutover scope, with explicit vacancy-to-job mapping.
4. Production contains imported entities for the cutover scope: candidates, conversations/messages, negotiation records, and pipeline state consistent with the import design.
5. Recruiter login opens the intended tenant data in `/recruiter/:token`, not the demo tenant.
6. We have an explicit, auditable link between:
   - GitHub merge
   - Neon validation branch or dry run
   - production migration execution
   - production data import execution
7. Production smoke extends beyond transport checks and proves business readiness:
   - recruiter login works
   - expected job count exists
   - expected recruiter tenant exists
   - expected minimum imported record counts exist

## Decision For The Follow-up PR

Treat this as a release-pipeline and environment-promotion bug, not as a single missing recruiter password or UI bug.
