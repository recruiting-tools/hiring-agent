const HISTORY_WINDOW = 10;

const JSON_SCHEMA = `{
  "step_result": "needs_clarification | done | reject | manual_review",
  "completed_step_ids": ["step_id", ...],
  "rejected_step_id": "step_id or null",
  "extracted_facts": { "step_id": <extracted value>, ... },
  "missing_information": ["step_id", ...],
  "next_message": "сообщение кандидату на русском языке",
  "confidence": 0.0-1.0,
  "guard_flags": []
}`;

export function buildPrompt({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage }) {
  const stepLines = pendingTemplateSteps
    .map((tplStep) => {
      const lines = [`### Шаг: ${tplStep.id}`];
      if (tplStep.goal) lines.push(`Цель: ${tplStep.goal}`);
      if (tplStep.done_when) lines.push(`Закрыт когда: ${tplStep.done_when}`);
      if (tplStep.reject_when) lines.push(`Отказ когда: ${tplStep.reject_when}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const recentHistory = (history ?? []).slice(-HISTORY_WINDOW);
  const historyLines = recentHistory
    .map((msg) => {
      const role = msg.direction === "inbound" ? "Кандидат" : "Рекрутер";
      return `${role}: ${msg.body}`;
    })
    .join("\n");

  const resumeSection = candidate?.resume_text
    ? `## Резюме кандидата\n${candidate.resume_text}`
    : "## Резюме кандидата\n(не предоставлено)";

  const inboundBody = inboundMessage?.body ?? inboundMessage?.text ?? "";

  return `Ты — AI-рекрутер, помогаешь скринировать кандидата на вакансию. Твоя задача — оценить ответ кандидата, закрыть выполненные шаги скрининга и сформулировать следующий вопрос или принять решение.

## Вакансия
Название: ${job.title}
Описание: ${job.description ?? "(нет описания)"}

${resumeSection}

## Открытые шаги скрининга
Закрой столько шагов, сколько позволяет ответ кандидата. Один ответ может закрыть несколько шагов.

${stepLines}

## История диалога (последние ${HISTORY_WINDOW} сообщений)
${historyLines || "(нет истории)"}

## Новое сообщение кандидата
${inboundBody}

## Инструкция
Верни JSON строго по схеме ниже. Не добавляй комментарии. Не используй placeholder-переменные вида {{name}}.

${JSON_SCHEMA}

Правила:
- step_result: "done" если все шаги закрыты, "needs_clarification" если нужны уточнения, "reject" если кандидат не подходит по критерию reject_when, "manual_review" если нет уверенности.
- completed_step_ids: только шаги которые явно закрыты ответом кандидата.
- next_message: текст следующего сообщения на русском языке. Пустая строка если step_result = "done" или "manual_review".
- confidence: твоя уверенность в решении от 0 до 1.`;
}
