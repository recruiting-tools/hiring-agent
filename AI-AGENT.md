# AI Agent Workflow (Branch Hygiene)

Этот файл — базовый протокол для агентских сессий, чтобы не делать грязные коммиты при параллельной разработке.

## Non-Negotiables

1. Одна задача = одна ветка = один PR.
2. Никогда не смешивать unrelated изменения в одном commit/PR.
3. Не работать feature-изменениями в `main`.
4. Для параллельных сессий использовать отдельные `git worktree`.
5. Перед merge ветка должна быть `CLEAN` и проходить sandbox gate.

## Start Task (Absolute Commands)

Используй абсолютные пути, не завися от текущей папки/ветки:

```bash
REPO="/Users/vova/Documents/GitHub/hiring-agent"
TASK="feat/short-task-name"
WT="/tmp/hiring-agent-${TASK//\//-}"

git -C "$REPO" fetch origin main
git -C "$REPO" worktree add "$WT" origin/main
git -C "$WT" switch -c "$TASK"
```

Если `worktree` не нужен, минимум:

```bash
REPO="/Users/vova/Documents/GitHub/hiring-agent"
TASK="feat/short-task-name"

git -C "$REPO" fetch origin main
git -C "$REPO" switch --detach origin/main
git -C "$REPO" switch -c "$TASK"
```

## Commit Hygiene

Перед коммитом:

```bash
git -C "$WT" status --short
git -C "$WT" diff --name-only
```

Коммить только целевые файлы:

```bash
git -C "$WT" add <file1> <file2>
git -C "$WT" commit -m "feat: concise intent"
```

Проверка, что PR не тащит мусор:

```bash
git -C "$WT" diff --name-only origin/main...HEAD
```

## Restack / Conflict Recovery

Если PR стал `DIRTY`:

```bash
git -C "$WT" fetch origin main
git -C "$WT" rebase origin/main
```

Если ветка сильно загрязнена, пересобери clean-ветку через cherry-pick:

```bash
REPO="/Users/vova/Documents/GitHub/hiring-agent"
CLEAN_TASK="feat/task-clean"

git -C "$REPO" fetch origin main
git -C "$REPO" switch --detach origin/main
git -C "$REPO" switch -c "$CLEAN_TASK"
git -C "$REPO" cherry-pick <sha1> <sha2>
```

## Parallel Sessions Rule

1. Каждый агент/сессия работает в своем `worktree`.
2. Один и тот же branch одновременно в двух сессиях не использовать.
3. Если PR блокируется, оставляй review-комментарий с конкретным blocker и переключайся на следующую задачу.

## Ready-to-Merge Checklist

1. `gh pr diff --name-only` содержит только ожидаемые файлы.
2. `gh pr checks <pr>` зелёный.
3. `gh pr view <pr> --json mergeStateStatus` = `CLEAN`.
4. Sandbox smoke пройден для risky изменений.

### HH Review Working Memory

Для hh-review потоков веди один документ с прогрессом:

- `specs/2026-04-15-hh-review-pr2-progress-log.md`

В нём фиксируй:
1. статус PR-1 (спецификации и слои),
2. статус PR-2 (sandbox + мок-среда),
3. что проверено в этой итерации,
4. что откладывается в следующий шаг.

## Vacancy Parsing Setup Checklist

Этот чеклист использовать, когда агенту нужно запустить полноценный разбор новой вакансии через `create_vacancy` и затем `setup_communication`.

1. Проверить доступность playbook'ов:
   - `create_vacancy`
   - `setup_communication`
   - `candidate_funnel`
2. Убедиться, что подключена tenant DB (`chatbot.*`) и management DB (`management.*`).
3. Для LLM задать переменные окружения (при необходимости поднять качество точечно):
   - `OPENROUTER_MODEL`
   - `OPENROUTER_CREATE_VACANCY_APPLICATION_STEPS_MODEL`
   - `OPENROUTER_SETUP_COMMUNICATION_PLAN_MODEL`
   - `OPENROUTER_SETUP_COMMUNICATION_EXAMPLES_MODEL`
4. На вход `create_vacancy` передавать максимум исходников:
   - raw-текст вакансии (обязательно)
   - must-have требования
   - условия работы (зарплата, график, формат, локация)
   - описание компании/проекта
   - этапы найма (если уже известны)
5. После прохождения шагов `create_vacancy` проверить, что в `chatbot.vacancies` заполнены:
   - `must_haves`
   - `nice_haves`
   - `work_conditions`
   - `application_steps`
   - `company_info`
   - `faq`
6. После выбора действия `Распланировать общение с кандидатами` проверить:
   - появился `communication_plan_draft` (или `communication_plan`, если сохранили)
   - UI отрисовал табличный план и кнопки действий
7. После выбора `Сравнить с другими вакансиями` проверить:
   - UI вернул markdown-таблицу сравнения
   - в таблице текущая вакансия помечена как `(текущая)`
8. Минимальный smoke перед релизом:
   - `pnpm test:hiring-agent`
   - ручной прогон в sandbox: создание вакансии -> план коммуникаций -> сохранение -> генерация примеров
