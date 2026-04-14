/**
 * LLM-as-runtime handler for the setup_communication playbook.
 *
 * Instead of going through the 6-step runtime (auto_fetch → llm_generate → display
 * → llm_generate → display → buttons), we do it in one shot:
 *   1. Fetch job + pipeline template from chatbot.jobs / chatbot.pipeline_templates
 *   2. Build a single comprehensive prompt
 *   3. One LLM call → full communication plan + first message examples
 *   4. Return as llm_output reply
 *
 * No session management, no DB writes, no step machine.
 * The recruiter gets a complete plan in one response (~2-3 sec).
 */

export async function runCommunicationPlanPlaybook({ tenantSql, vacancyId, llmAdapter }) {
  if (!tenantSql) {
    return {
      reply: {
        kind: "fallback_text",
        text: "Подключите базу данных, чтобы использовать этот плейбук."
      }
    };
  }

  if (!vacancyId) {
    return {
      reply: {
        kind: "fallback_text",
        text: "Выберите вакансию, чтобы настроить общение с кандидатами."
      }
    };
  }

  if (!llmAdapter?.generate) {
    return {
      reply: {
        kind: "fallback_text",
        text: "LLM не настроен. Обратитесь к администратору."
      }
    };
  }

  const job = await getCommunicationPlanJob(tenantSql, vacancyId);
  if (!job) {
    return {
      reply: {
        kind: "fallback_text",
        text: "Вакансия не найдена."
      }
    };
  }

  const prompt = buildPrompt(job);
  const raw = await llmAdapter.generate(prompt);

  return {
    reply: {
      kind: "llm_output",
      content: raw,
      content_type: "markdown"
    }
  };
}

async function getCommunicationPlanJob(tenantSql, jobId) {
  const rows = await tenantSql`
    SELECT
      j.job_id,
      j.title,
      j.description,
      pt.steps_json AS pipeline_steps
    FROM chatbot.jobs j
    LEFT JOIN chatbot.pipeline_templates pt
      ON pt.job_id = j.job_id
    WHERE j.job_id = ${jobId}
    ORDER BY pt.template_version DESC NULLS LAST
    LIMIT 1
  `;

  return normalizeJob(rows[0] ?? null);
}

function normalizeJob(row) {
  if (!row) return null;

  return {
    job_id: row.job_id,
    title: row.title ?? null,
    description: row.description ?? null,
    pipeline_steps: Array.isArray(row.pipeline_steps) ? row.pipeline_steps : []
  };
}

function buildPrompt(job) {
  const steps = Array.isArray(job.pipeline_steps) ? job.pipeline_steps : [];
  const description = job.description?.trim() || "— не указано";
  const communicationSteps = formatPipelineSteps(steps);
  const firstStepGuidance = getFirstStepGuidance(steps);

  return `Ты помогаешь рекрутеру выстроить сценарий переписки с кандидатами по вакансии.

Подготовь полный план коммуникации. Он включает два блока.

─────────────────────────────────────
БЛОК 1 — ПЛАН КОММУНИКАЦИИ (2–3 варианта)
─────────────────────────────────────

На основе данных вакансии составь 2–3 варианта плана — последовательность шагов от первого контакта с кандидатом до финального целевого действия.

Требования:
- Включай только шаги в нашей зоне (из списка ниже)
- Первый шаг: тёплое приветствие + один вопрос
- Последний шаг: целевое действие (звонок, оффер)
- Типичный порядок: проверка must haves → подтверждение условий → договорённость о следующем шаге
- Варианты могут отличаться группировкой тем, порядком вопросов или уровнем детализации

─────────────────────────────────────
БЛОК 2 — ПРИМЕРЫ ПЕРВОГО СООБЩЕНИЯ (3 варианта)
─────────────────────────────────────

Напиши 3 варианта первого сообщения агента кандидату.
Стиль: тёплый, человечный, без канцелярита. Кандидат должен почувствовать живой интерес, а не скрипт.
Структура: короткое приветствие → один ключевой вопрос (первый шаг плана).

Три варианта отличаются тональностью:
- Вариант А: деловой и лаконичный
- Вариант Б: чуть теплее, с коротким контекстом о вакансии
- Вариант В: максимально живой, почти дружеский

─────────────────────────────────────
ДАННЫЕ ВАКАНСИИ
─────────────────────────────────────

Должность: ${job.title ?? "не указана"}

Описание вакансии:
${description}

Шаги скрининга и найма:
${communicationSteps}
${firstStepGuidance ? `\nПодсказка по первому сообщению:\n${firstStepGuidance}` : ""}
─────────────────────────────────────
ФОРМАТ ОТВЕТА
─────────────────────────────────────

Ответь в Markdown. Используй ##-заголовки для разделения блоков.
Блок 1: заголовок "## План коммуникации", под ним варианты с ###-заголовками.
Блок 2: заголовок "## Примеры первого сообщения", под ним три варианта.
В конце — одна строка с рекомендацией по режиму автоматизации (полная автоматизация / пре-модерация / только уведомления) и коротким обоснованием (1 предложение).`;
}

function formatPipelineSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return "— не указано";
  return steps
    .map((s, i) => {
      const goal = s.goal ? ` — ${s.goal}` : "";
      const doneWhen = s.done_when ? `\n   Когда считаем успехом: ${s.done_when}` : "";
      const rejectWhen = s.reject_when ? `\n   Когда это red flag: ${s.reject_when}` : "";
      return `${i + 1}. ${s.id ?? s.name ?? `step-${i + 1}`}${goal}${doneWhen}${rejectWhen}`;
    })
    .join("\n");
}

function getFirstStepGuidance(steps) {
  if (!Array.isArray(steps)) return null;
  const firstStep = steps[0];
  if (!firstStep) return null;

  const parts = [];
  if (firstStep.goal) parts.push(`Первый шаг должен проверить: ${firstStep.goal}`);
  if (firstStep.done_when) parts.push(`Успешный сигнал: ${firstStep.done_when}`);
  if (firstStep.reject_when) parts.push(`Риск/отказ: ${firstStep.reject_when}`);
  return parts.length > 0 ? parts.join("\n") : null;
}
