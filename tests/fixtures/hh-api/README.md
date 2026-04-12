# HH API fixtures

Синтетические fixture-файлы для контрактного mock слоя HH.ru.

Правила:

- fixtures не содержат токены и чужие PII;
- `manifest.json` описывает источник, сценарий и статус редактирования;
- live capture сохраняется только локально в `.local/hh-captures/`, а в репозиторий попадают только redacted fixtures;
- fixture-имена должны отражать endpoint и сценарий (`messages.reversed`, `response.page-1`, `403-no-paid-access`).

Эта библиотека нужна для `pnpm test:hh` и `pnpm test:all` без сетевого доступа и без HH credentials.
