/**
 * LLM-as-runtime handler for the setup_communication playbook.
 *
 * Instead of going through the 6-step runtime (auto_fetch → llm_generate → display
 * → llm_generate → display → buttons), we do it in one shot:
 *   1. Fetch vacancy from chatbot.vacancies
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

  const rows = await tenantSql`
    SELECT *
    FROM chatbot.vacancies
    WHERE vacancy_id = ${vacancyId}
    LIMIT 1
  `;

  const vacancy = rows[0] ?? null;
  if (!vacancy) {
    return {
      reply: {
        kind: "fallback_text",
        text: "Вакансия не найдена."
      }
    };
  }

  const prompt = buildPrompt(vacancy);
  const raw = await llmAdapter.generate(prompt);

  return {
    reply: {
      kind: "llm_output",
      content: raw,
      content_type: "markdown"
    }
  };
}

function buildPrompt(vacancy) {
  const mustHaves = formatList(vacancy.must_haves);
  const niceHaves = formatList(vacancy.nice_haves);
  const conditions = formatConditions(vacancy.work_conditions);
  const inScopeSteps = formatApplicationSteps(vacancy.application_steps);
  const firstStepScript = getFirstStepScript(vacancy.application_steps);

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

Должность: ${vacancy.title ?? "не указана"}

Маст-хэвы:
${mustHaves}

Найс-хэвы:
${niceHaves}

Условия работы:
${conditions}

Шаги найма (наша зона):
${inScopeSteps}
${firstStepScript ? `\nСкрипт первого шага:\n${firstStepScript}` : ""}
─────────────────────────────────────
ФОРМАТ ОТВЕТА
─────────────────────────────────────

Ответь в Markdown. Используй ##-заголовки для разделения блоков.
Блок 1: заголовок "## План коммуникации", под ним варианты с ###-заголовками.
Блок 2: заголовок "## Примеры первого сообщения", под ним три варианта.
В конце — одна строка с рекомендацией по режиму автоматизации (полная автоматизация / пре-модерация / только уведомления) и коротким обоснованием (1 предложение).`;
}

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) return "— не указано";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatConditions(conditions) {
  if (!conditions || typeof conditions !== "object") return "— не указано";
  const parts = [];
  if (conditions.salary_range) {
    const { min, max } = conditions.salary_range;
    if (min && max) parts.push(`Зарплата: ${min.toLocaleString("ru-RU")}–${max.toLocaleString("ru-RU")} ₽`);
    else if (min) parts.push(`Зарплата: от ${min.toLocaleString("ru-RU")} ₽`);
    else if (max) parts.push(`Зарплата: до ${max.toLocaleString("ru-RU")} ₽`);
  }
  if (conditions.pay_per_shift) parts.push(`Ставка за смену: ${conditions.pay_per_shift}`);
  if (conditions.schedule) parts.push(`График: ${conditions.schedule}`);
  if (conditions.location) parts.push(`Локация: ${conditions.location}`);
  if (conditions.remote === true) parts.push("Удалённая работа: да");
  if (Array.isArray(conditions.perks) && conditions.perks.length > 0) {
    parts.push(`Бонусы: ${conditions.perks.join(", ")}`);
  }
  return parts.length > 0 ? parts.join("\n") : "— не указано";
}

function formatApplicationSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return "— не указано";
  const inScope = steps.filter((s) => s.in_our_scope);
  if (inScope.length === 0) return "— нет шагов в нашей зоне";
  return inScope
    .map((s, i) => {
      const target = s.is_target ? " [целевое действие]" : "";
      return `${i + 1}. ${s.name}${target}`;
    })
    .join("\n");
}

function getFirstStepScript(steps) {
  if (!Array.isArray(steps)) return null;
  const firstInScope = steps.find((s) => s.in_our_scope && s.script);
  return firstInScope?.script ?? null;
}
