import { createHash } from "node:crypto";

/**
 * LLM-as-runtime handler for the setup_communication playbook.
 *
 * Flow:
 *   1) Read vacancy + saved/draft communication settings
 *   2) Detect recruiter intent (show, edit, save, generate examples)
 *   3) Optionally call LLM for one structured scenario (JSON contract)
 *   4) Persist draft/saved/examples in chatbot.vacancies
 *   5) Return structured reply consumed by chat UI renderer
 */

const ACTION_SAVE = "save";
const ACTION_EDIT = "edit";
const ACTION_START = "start";
const ACTION_GENERATE_CONVERSATIONS = "generate_conversations";
const ACTION_SHOW = "show";

const SAVE_ACTION_MESSAGE = "настроить общение: сохранить настройку коммуникаций";
const START_ACTION_MESSAGE = "настроить общение: запустить сценарий коммуникаций";
const GENERATE_CONVERSATIONS_ACTION_MESSAGE = "настроить общение: сгенерировать примеры общения";
const EDIT_ACTION_MESSAGE = "настроить общение: поправить сценарий коммуникаций";

const EXAMPLE_KIND_FIRST_MESSAGE = "first_message";
const EXAMPLE_KIND_CONVERSATION = "conversation_example";

export async function runCommunicationPlanPlaybook({
  tenantSql,
  vacancyId,
  jobId = null,
  llmAdapter,
  recruiterInput = null,
  llmConfig = {},
  clientContext = null
}) {
  if (!tenantSql) {
    return {
      reply: {
        kind: "fallback_text",
        text: "Подключите базу данных, чтобы использовать этот плейбук."
      }
    };
  }

  if (!vacancyId && !jobId) {
    return {
      reply: {
        kind: "fallback_text",
        text: "Выберите вакансию, чтобы настроить общение с кандидатами."
      }
    };
  }

  const resolved = await findVacancy({
    tenantSql,
    vacancyId,
    jobId
  });
  let vacancy = resolved.vacancy;
  const resolvedVacancyId = resolved.resolvedVacancyId;
  if (!vacancy) {
    return {
      reply: {
        kind: "fallback_text",
        text: "Вакансия не найдена."
      }
    };
  }
  vacancy = await repairVacancyCommunicationState({
    tenantSql,
    vacancy,
    vacancyId: resolvedVacancyId
  });

  const action = detectAction(recruiterInput);
  const savedPlan = normalizePlan(vacancy.communication_plan);
  const draftPlan = normalizePlan(vacancy.communication_plan_draft);
  const transientContext = normalizeTransientContext(clientContext);
  const transientDraftPlan = transientContext?.plan ?? null;
  const effectiveDraftPlan = draftPlan ?? transientDraftPlan;
  const examples = normalizeExamples(vacancy.communication_examples);
  const savedExamples = resolveExamplesForPlan({
    plan: savedPlan,
    examples,
    examplesPlanHash: vacancy.communication_examples_plan_hash
  });
  const effectiveDraftExamples = draftPlan
    ? resolveExamplesForPlan({
      plan: draftPlan,
      examples,
      examplesPlanHash: vacancy.communication_examples_plan_hash
    })
    : (transientContext?.examples ?? []);
  const savedExampleSets = splitExamples(savedExamples);

  if (action === ACTION_SAVE) {
    if (!effectiveDraftPlan) {
      if (savedPlan) {
        return {
          reply: buildCommunicationPlanReply({
            plan: savedPlan,
            firstMessageExamples: savedExampleSets.firstMessageExamples,
            conversationExamples: savedExampleSets.conversationExamples,
            note: "Уже настроено. Черновик не найден, показываю сохраненную версию.",
            isConfigured: true,
            vacancyId: resolvedVacancyId
          })
        };
      }
      return {
        reply: {
          kind: "fallback_text",
          text: "Сначала сформируйте сценарий, затем сохраните настройку."
        }
      };
    }

    const draftHash = computePlanHash(effectiveDraftPlan);
    const syncedExamples = effectiveDraftExamples;

    try {
      await tenantSql`
        UPDATE chatbot.vacancies
        SET
          communication_plan = ${JSON.stringify(effectiveDraftPlan)}::jsonb,
          communication_plan_updated_at = now(),
          communication_plan_draft = NULL,
          communication_examples = ${JSON.stringify(syncedExamples)}::jsonb,
          communication_examples_plan_hash = ${syncedExamples.length > 0 ? draftHash : null},
          updated_at = now()
        WHERE vacancy_id = ${resolvedVacancyId}
      `;
    } catch (error) {
      if (isCommunicationPlanContractError(error) || isCommunicationExamplesConstraintError(error)) {
        return {
          reply: buildCommunicationPlanReply({
            plan: effectiveDraftPlan,
            firstMessageExamples: splitExamples(syncedExamples).firstMessageExamples,
            conversationExamples: splitExamples(syncedExamples).conversationExamples,
            note: "Сценарий собран, но сохранить настройку в базе не удалось. Попробуйте снова через минуту.",
            isConfigured: false,
            vacancyId: resolvedVacancyId
          })
        };
      }
      throw error;
    }

    return {
      reply: buildCommunicationPlanReply({
        plan: effectiveDraftPlan,
        firstMessageExamples: splitExamples(syncedExamples).firstMessageExamples,
        conversationExamples: splitExamples(syncedExamples).conversationExamples,
        note: "Настройка сохранена в базе для этой вакансии.",
        isConfigured: true,
        vacancyId: resolvedVacancyId
      })
    };
  }

  if (action === ACTION_START) {
    const planForExamples = effectiveDraftPlan ?? savedPlan;
    if (!planForExamples) {
      return {
        reply: {
          kind: "fallback_text",
          text: "Сначала сформируйте сценарий коммуникаций, затем генерируйте примеры."
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

    const rawExamples = await generateWithModel(
      llmAdapter,
      buildExamplesPrompt(vacancy, planForExamples),
      llmConfig.examplesModel
    );
    const generatedExampleSets = splitExamples(normalizeExamples(parseJsonPayload(rawExamples)));
    const currentExampleSets = splitExamples(
      effectiveDraftPlan ? effectiveDraftExamples : savedExamples
    );
    const mergedExamples = [
      ...generatedExampleSets.firstMessageExamples,
      ...currentExampleSets.conversationExamples
    ];

    try {
      await tenantSql`
        UPDATE chatbot.vacancies
        SET
          communication_examples = ${JSON.stringify(mergedExamples)}::jsonb,
          communication_examples_plan_hash = ${computePlanHash(planForExamples)},
          updated_at = now()
        WHERE vacancy_id = ${resolvedVacancyId}
      `;
    } catch (error) {
      if (isCommunicationExamplesConstraintError(error)) {
        return {
          reply: buildCommunicationPlanReply({
            plan: planForExamples,
            firstMessageExamples: generatedExampleSets.firstMessageExamples,
            conversationExamples: currentExampleSets.conversationExamples,
            note: "Примеры первого сообщения собраны, но сохранить их в базе не удалось. Можно повторить позже.",
            isConfigured: Boolean(savedPlan) && !effectiveDraftPlan,
            vacancyId: resolvedVacancyId
          })
        };
      }
      throw error;
    }

    return {
      reply: buildCommunicationPlanReply({
        plan: planForExamples,
        firstMessageExamples: generatedExampleSets.firstMessageExamples,
        conversationExamples: currentExampleSets.conversationExamples,
        note: "Сгенерировал примеры первого сообщения по текущему сценарию.",
        isConfigured: Boolean(savedPlan) && !effectiveDraftPlan,
        vacancyId: resolvedVacancyId
      })
    };
  }

  if (action === ACTION_GENERATE_CONVERSATIONS) {
    const planForExamples = effectiveDraftPlan ?? savedPlan;
    if (!planForExamples) {
      return {
        reply: {
          kind: "fallback_text",
          text: "Сначала сформируйте сценарий коммуникаций, затем генерируйте примеры общения."
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

    const rawExamples = await generateWithModel(
      llmAdapter,
      buildConversationExamplesPrompt(vacancy, planForExamples),
      llmConfig.examplesModel
    );
    const generatedExampleSets = splitExamples(normalizeExamples(parseJsonPayload(rawExamples)));
    const currentExampleSets = splitExamples(
      effectiveDraftPlan ? effectiveDraftExamples : savedExamples
    );
    const mergedExamples = [
      ...currentExampleSets.firstMessageExamples,
      ...generatedExampleSets.conversationExamples
    ];

    try {
      await tenantSql`
        UPDATE chatbot.vacancies
        SET
          communication_examples = ${JSON.stringify(mergedExamples)}::jsonb,
          communication_examples_plan_hash = ${computePlanHash(planForExamples)},
          updated_at = now()
        WHERE vacancy_id = ${resolvedVacancyId}
      `;
    } catch (error) {
      if (isCommunicationExamplesConstraintError(error)) {
        return {
          reply: buildCommunicationPlanReply({
            plan: planForExamples,
            firstMessageExamples: currentExampleSets.firstMessageExamples,
            conversationExamples: generatedExampleSets.conversationExamples,
            note: "Тренировочные диалоги собраны, но сохранить их в базе не удалось. Можно повторить позже.",
            isConfigured: Boolean(savedPlan) && !effectiveDraftPlan,
            vacancyId: resolvedVacancyId
          })
        };
      }
      throw error;
    }

    return {
      reply: buildCommunicationPlanReply({
        plan: planForExamples,
        firstMessageExamples: currentExampleSets.firstMessageExamples,
        conversationExamples: generatedExampleSets.conversationExamples,
        note: "Сгенерировал тренировочные примеры общения с кандидатом по этому сценарию.",
        isConfigured: Boolean(savedPlan) && !effectiveDraftPlan,
        vacancyId: resolvedVacancyId
      })
    };
  }

  if (effectiveDraftPlan && action !== ACTION_EDIT) {
    const draftExampleSets = splitExamples(effectiveDraftExamples);
    return {
      reply: buildCommunicationPlanReply({
        plan: effectiveDraftPlan,
        firstMessageExamples: draftExampleSets.firstMessageExamples,
        conversationExamples: draftExampleSets.conversationExamples,
        note: draftPlan
          ? "Показываю текущий черновик сценария. Проверьте и сохраните, если подходит."
          : "Показываю черновик из предыдущего ответа. Его ещё нужно сохранить в базе.",
        isConfigured: false,
        vacancyId: resolvedVacancyId
      })
    };
  }

  if (savedPlan && action !== ACTION_EDIT) {
    return {
      reply: buildCommunicationPlanReply({
        plan: savedPlan,
        firstMessageExamples: savedExampleSets.firstMessageExamples,
        conversationExamples: savedExampleSets.conversationExamples,
        note: "Уже настроено. Текущий сценарий выглядит так:",
        isConfigured: true,
        vacancyId: resolvedVacancyId
      })
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

  const prompt = buildPlanPrompt({
    vacancy,
    existingPlan: savedPlan,
    draftPlan: effectiveDraftPlan,
    recruiterInput,
    isEdit: action === ACTION_EDIT
  });
  const { draft } = await generatePlanDraft({
    llmAdapter,
    prompt,
    model: llmConfig.planModel
  });

  if (!draft) {
    return {
      reply: {
        kind: "fallback_text",
        text: "Не удалось собрать сценарий в нужном формате. Нажмите «Поправить» и попробуйте ещё раз."
      }
    };
  }

  try {
    await tenantSql`
      UPDATE chatbot.vacancies
      SET
        communication_plan_draft = ${JSON.stringify(draft)}::jsonb,
        updated_at = now()
      WHERE vacancy_id = ${resolvedVacancyId}
    `;
  } catch (error) {
    if (isCommunicationPlanDraftConstraintError(error)) {
      return {
        reply: buildCommunicationPlanReply({
          plan: draft,
          firstMessageExamples: splitExamples(resolveExamplesForPlan({
            plan: draft,
            examples,
            examplesPlanHash: vacancy.communication_examples_plan_hash
          })).firstMessageExamples,
          conversationExamples: splitExamples(resolveExamplesForPlan({
            plan: draft,
            examples,
            examplesPlanHash: vacancy.communication_examples_plan_hash
          })).conversationExamples,
          note: "Сценарий сформирован, но черновик не сохранился в базе. Можно продолжить и сохранить позже.",
          isConfigured: false,
          vacancyId: resolvedVacancyId
        })
      };
    }
    throw error;
  }

  return {
    reply: buildCommunicationPlanReply({
      plan: draft,
      firstMessageExamples: splitExamples(resolveExamplesForPlan({
        plan: draft,
        examples,
        examplesPlanHash: vacancy.communication_examples_plan_hash
      })).firstMessageExamples,
      conversationExamples: splitExamples(resolveExamplesForPlan({
        plan: draft,
        examples,
        examplesPlanHash: vacancy.communication_examples_plan_hash
      })).conversationExamples,
      note: action === ACTION_EDIT
        ? "Обновил черновик сценария. Проверьте и сохраните, если подходит."
        : "Сформировал один рабочий сценарий в табличном формате.",
      isConfigured: false,
      vacancyId: resolvedVacancyId
    })
  };
}

function buildPlanPrompt({ vacancy, existingPlan, draftPlan, recruiterInput, isEdit }) {
  const mustHaves = formatList(vacancy.must_haves);
  const niceHaves = formatList(vacancy.nice_haves);
  const conditions = formatConditions(vacancy.work_conditions);
  const inScopeSteps = formatApplicationSteps(vacancy.application_steps);
  const firstStepScript = getFirstStepScript(vacancy.application_steps);
  const existing = existingPlan ? formatExistingPlan(existingPlan) : "— нет сохраненного сценария";
  const draft = draftPlan ? formatExistingPlan(draftPlan) : "— нет черновика";
  const recruiterRequest = cleanText(recruiterInput, "— нет дополнительного запроса");
  const sourceMaterials = formatSourceMaterials(vacancy);
  const editInstruction = isEdit
    ? "Есть запрос на правки. Улучши текущий сценарий с учетом сохраненной версии."
    : "Сформируй новый сценарий с нуля.";

  return `Ты помогаешь рекрутеру настроить коммуникацию с кандидатом по вакансии.

${editInstruction}

Нужен ровно ОДИН лучший вариант сценария. Не предлагай несколько вариантов.

Верни только валидный JSON без markdown и без пояснений.

Формат JSON:
{
  "scenario_title": "краткое название сценария",
  "goal": "целевое действие",
  "steps": [
    {
      "step": "название шага",
      "reminders_count": 0,
      "comment": "короткий комментарий"
    }
  ]
}

Пример корректного ответа:
{
  "scenario_title": "Базовый скрининг Менеджера по продажам",
  "goal": "Договоренность о собеседовании",
  "steps": [
    { "step": "Приветствие и вопрос о мотивации?", "reminders_count": 1, "comment": "Открыть диалог и понять интерес кандидата" },
    { "step": "Проверка релевантного опыта в продажах", "reminders_count": 1, "comment": "Проверить базовое соответствие" },
    { "step": "Сверка условий по зарплате и формату", "reminders_count": 1, "comment": "Снять риски по ожиданиям" },
    { "step": "Короткий рассказ о роли и компании", "reminders_count": 0, "comment": "Укрепить интерес к вакансии" },
    { "step": "Приглашение на собеседование", "reminders_count": 2, "comment": "Предложить слот и зафиксировать следующий шаг" }
  ]
}

Требования к сценарию:
- 4-7 шагов
- Только шаги в нашей зоне
- Первый шаг: приветствие + один вопрос
- Последний шаг: приглашение на следующий этап (звонок/интервью)
- reminders_count: целое число 0-3
- Комментарии короткие и прикладные

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

Текущий сохраненный сценарий:
${existing}

Текущий черновик сценария:
${draft}

Последний запрос рекрутера:
${recruiterRequest}

Материалы вакансии:
${sourceMaterials}`;
}

function buildExamplesPrompt(vacancy, plan) {
  const steps = plan.steps
    .map((step, index) => `${index + 1}. ${step.step} (напоминаний: ${step.reminders_count})`)
    .join("\n");

  return `Сгенерируй примеры первого сообщения кандидату по сценарию коммуникации.

Верни только валидный JSON-массив из 3 объектов без markdown и без пояснений.

Формат:
[
  {
    "title": "Короткое название варианта",
    "message": "Текст первого сообщения"
  }
]

Пример корректного ответа:
[
  {
    "title": "Деловой и лаконичный",
    "message": "Здравствуйте! Увидел ваш профиль и хочу обсудить вакансию Менеджера по продажам. Что для вас сейчас главное при выборе новой роли?"
  },
  {
    "title": "Теплый с контекстом",
    "message": "Добрый день! Мы расширяем команду продаж и ваш опыт выглядит релевантно. Подскажите, пожалуйста, что в новой работе для вас в приоритете?"
  },
  {
    "title": "Живой и короткий",
    "message": "Привет! Есть ощущение, что наш опыт может хорошо совпасть по роли Менеджера по продажам. Что вас сейчас больше всего мотивирует рассматривать смену работы?"
  }
]

Требования:
- Сообщение: 1-3 предложения
- Тон человеческий, без канцелярита
- Сообщение соответствует первому шагу сценария
- В каждом сообщении ровно один ключевой вопрос

Должность: ${vacancy.title ?? "не указана"}
Сценарий: ${plan.scenario_title}
Цель: ${plan.goal}
Шаги:
${steps}`;
}

function buildConversationExamplesPrompt(vacancy, plan) {
  const steps = plan.steps
    .map((step, index) => `${index + 1}. ${step.step} (напоминаний: ${step.reminders_count}; комментарий: ${step.comment})`)
    .join("\n");

  return `Сгенерируй реалистичные тренировочные диалоги рекрутера и кандидата.

Важно:
- Это синтетические примеры для тренировки, не для реальной отправки в HH.
- Не используй реальные персональные данные, телефоны, email, ссылки.
- Рекрутер пишет коротко и по делу, кандидат отвечает естественно.

Верни только валидный JSON-массив без markdown и пояснений.

Формат:
[
  {
    "title": "Название варианта",
    "summary": "Краткое резюме кандидата и контекст",
    "turns": [
      { "speaker": "recruiter", "message": "..." },
      { "speaker": "candidate", "message": "..." }
    ]
  }
]

Требования:
- Верни ровно 3 варианта
- В каждом варианте 6-10 реплик
- Структура должна следовать шагам сценария
- Завершение диалога: приглашение на следующий этап и подтверждение кандидата
- Речь живая, без канцелярита

Должность: ${vacancy.title ?? "не указана"}
Сценарий: ${plan.scenario_title}
Цель: ${plan.goal}
Шаги:
${steps}`;
}

function buildCommunicationPlanReply({
  plan,
  firstMessageExamples,
  conversationExamples,
  note,
  isConfigured,
  vacancyId
}) {
  return {
    kind: "communication_plan",
    scenario_title: plan.scenario_title,
    goal: plan.goal,
    steps: plan.steps,
    vacancy_id: vacancyId ?? null,
    examples: firstMessageExamples,
    conversation_examples: conversationExamples,
    note,
    is_configured: isConfigured,
    actions: buildActions({ isConfigured })
  };
}

function buildActions({ isConfigured }) {
  const actions = [];
  if (!isConfigured) {
    actions.push({
      label: "Сохранить",
      message: SAVE_ACTION_MESSAGE
    });
  }

  actions.push({
    label: "Запустить",
    message: START_ACTION_MESSAGE
  });

  actions.push({
    label: "Сгенерировать примеры общения",
    message: GENERATE_CONVERSATIONS_ACTION_MESSAGE
  });

  actions.push({
    label: "Поправить",
    message: EDIT_ACTION_MESSAGE
  });

  return actions;
}

function detectAction(input) {
  const text = String(input ?? "").toLowerCase();
  if (!text) return ACTION_SHOW;
  if (text.includes("сохранить настрой")) return ACTION_SAVE;
  if (text.includes("запустить сценар") || text.includes("запуск сценар")) {
    return ACTION_START;
  }
  if (text.includes("сгенерировать примеры общен") || text.includes("примеры общения")) {
    return ACTION_GENERATE_CONVERSATIONS;
  }
  if (text.includes("поправить") || text.includes("изменить сценар") || text.includes("отредактир")) {
    return ACTION_EDIT;
  }
  if (text.includes("сгенерировать пример") || text.includes("примеры общен") || text.includes("обновить пример")) {
    return ACTION_START;
  }
  return ACTION_SHOW;
}

function parseJsonPayload(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const objectMatch = withoutFence.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    const arrayMatch = withoutFence.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        return null;
      }
    }
  }

  return null;
}

function normalizePlan(rawPlan) {
  if (!rawPlan || typeof rawPlan !== "object" || Array.isArray(rawPlan)) return null;
  const title = cleanText(rawPlan.scenario_title, "Рабочий сценарий коммуникации");
  const goal = cleanText(rawPlan.goal, "Договоренность о следующем шаге");
  const rows = Array.isArray(rawPlan.steps) ? rawPlan.steps : [];
  if (rows.length < 4 || rows.length > 7) return null;
  const steps = rows
    .map((row) => {
      const step = cleanText(row?.step, "");
      if (!step) return null;
      const remindersRaw = Number(
        row?.reminders_count ?? row?.reminders ?? row?.reminder_count ?? 0
      );
      if (!Number.isFinite(remindersRaw)) return null;
      const remindersCount = Math.round(remindersRaw);
      if (remindersCount < 0 || remindersCount > 3) return null;

      return {
        step,
        reminders_count: remindersCount,
        comment: cleanText(row?.comment, "—")
      };
    })
    .filter(Boolean);

  if (steps.length !== rows.length) return null;
  if (!hasValidBoundarySteps(steps)) return null;

  return {
    scenario_title: title,
    goal,
    steps
  };
}

function normalizeExamples(rawExamples) {
  if (!Array.isArray(rawExamples)) return [];
  return rawExamples
    .map((item, index) => {
      const title = cleanText(item?.title, `Вариант ${index + 1}`);
      const turns = normalizeConversationTurns(item?.turns ?? item?.conversation ?? item?.dialogue);
      if (turns.length > 0) {
        return {
          kind: EXAMPLE_KIND_CONVERSATION,
          title,
          summary: cleanText(item?.summary, ""),
          turns
        };
      }

      const message = cleanText(item?.message ?? item?.text, "");
      if (!message) return null;
      return {
        kind: EXAMPLE_KIND_FIRST_MESSAGE,
        title,
        message
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeConversationTurns(rawTurns) {
  if (!Array.isArray(rawTurns)) return [];
  const turns = rawTurns
    .map((turn) => {
      const speaker = normalizeSpeaker(turn?.speaker ?? turn?.role ?? turn?.author);
      const message = cleanText(turn?.message ?? turn?.text, "");
      if (!speaker || !message) return null;
      return { speaker, message };
    })
    .filter(Boolean)
    .slice(0, 12);
  return turns.length >= 4 ? turns : [];
}

function normalizeSpeaker(value) {
  const raw = String(value ?? "").toLowerCase().trim();
  if (["recruiter", "employer", "assistant", "manager", "hr"].includes(raw)) return "recruiter";
  if (["candidate", "applicant", "user"].includes(raw)) return "candidate";
  return null;
}

function splitExamples(examples) {
  const firstMessageExamples = [];
  const conversationExamples = [];

  for (const item of Array.isArray(examples) ? examples : []) {
    if (item?.kind === EXAMPLE_KIND_CONVERSATION && Array.isArray(item.turns) && item.turns.length > 0) {
      conversationExamples.push({
        kind: EXAMPLE_KIND_CONVERSATION,
        title: cleanText(item.title, "Вариант"),
        summary: cleanText(item.summary, ""),
        turns: item.turns
      });
      continue;
    }

    const message = cleanText(item?.message ?? item?.text, "");
    if (!message) continue;
    firstMessageExamples.push({
      kind: EXAMPLE_KIND_FIRST_MESSAGE,
      title: cleanText(item?.title, "Вариант"),
      message
    });
  }

  return { firstMessageExamples, conversationExamples };
}

function cleanText(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : fallback;
}

function truncateForPrompt(value, maxLength) {
  const text = cleanText(value, "");
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function hasValidBoundarySteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const first = `${steps[0].step} ${steps[0].comment}`.toLowerCase();
  const last = `${steps.at(-1).step} ${steps.at(-1).comment}`.toLowerCase();
  const hasGreeting = /(привет|здрав|добрый|hello|hi|контакт)/.test(first);
  const hasQuestion = first.includes("?") || /(вопрос|спроси|уточни)/.test(first);
  const hasNextStepInvite = /(интерв|собесед|звон|созвон|встреч|следующ|этап|слот)/.test(last);
  return hasGreeting && hasQuestion && hasNextStepInvite;
}

function computePlanHash(plan) {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function resolveExamplesForPlan({ plan, examples, examplesPlanHash }) {
  if (!plan || !Array.isArray(examples) || examples.length === 0) return [];
  if (!examplesPlanHash) return [];
  return computePlanHash(plan) === String(examplesPlanHash) ? examples : [];
}

function normalizeTransientContext(rawContext) {
  if (!rawContext || typeof rawContext !== "object") return null;

  const rawPlan = rawContext.plan
    ?? rawContext.communication_plan
    ?? (rawContext.kind === "communication_plan" ? rawContext : null);
  const plan = normalizePlan(rawPlan);
  if (!plan) return null;

  const examples = normalizeExamples([
    ...(Array.isArray(rawContext.examples) ? rawContext.examples : []),
    ...(Array.isArray(rawContext.conversation_examples) ? rawContext.conversation_examples : [])
  ]);

  return {
    plan,
    examples
  };
}

async function repairVacancyCommunicationState({ tenantSql, vacancy, vacancyId }) {
  if (!tenantSql || !vacancy || !vacancyId) {
    return vacancy;
  }

  const normalizedSavedPlan = normalizePlan(vacancy.communication_plan);
  const normalizedDraftPlan = normalizePlan(vacancy.communication_plan_draft);
  const hasExamplesArray = Array.isArray(vacancy.communication_examples);
  const nextExamplesPlanHash = (
    typeof vacancy.communication_examples_plan_hash === "string"
    && vacancy.communication_examples_plan_hash.trim().length > 0
    && hasExamplesArray
    && vacancy.communication_examples.length > 0
  )
    ? vacancy.communication_examples_plan_hash
    : null;

  const needsRepair = (
    (vacancy.communication_plan != null && !normalizedSavedPlan)
    || (vacancy.communication_plan_draft != null && !normalizedDraftPlan)
    || !hasExamplesArray
    || (
      vacancy.communication_examples_plan_hash != null
      && nextExamplesPlanHash == null
    )
  );

  if (!needsRepair) {
    return vacancy;
  }

  const rows = await tenantSql`
    UPDATE chatbot.vacancies
    SET
      communication_plan = ${normalizedSavedPlan ? JSON.stringify(normalizedSavedPlan) : null}::jsonb,
      communication_plan_draft = ${normalizedDraftPlan ? JSON.stringify(normalizedDraftPlan) : null}::jsonb,
      communication_examples = ${JSON.stringify(hasExamplesArray ? vacancy.communication_examples : [])}::jsonb,
      communication_examples_plan_hash = ${nextExamplesPlanHash},
      updated_at = now()
    WHERE vacancy_id = ${vacancyId}
    RETURNING *
  `;

  return rows[0] ?? {
    ...vacancy,
    communication_plan: normalizedSavedPlan,
    communication_plan_draft: normalizedDraftPlan,
    communication_examples: hasExamplesArray ? vacancy.communication_examples : [],
    communication_examples_plan_hash: nextExamplesPlanHash
  };
}

function isCommunicationPlanDraftConstraintError(error) {
  const message = String(error?.message ?? "");
  return message.includes("chk_vacancies_communication_plan_draft_contract");
}

function isCommunicationPlanContractError(error) {
  const message = String(error?.message ?? "");
  return (
    message.includes("chk_vacancies_communication_plan_contract")
    || message.includes("chk_vacancies_communication_plan_draft_contract")
  );
}

function isCommunicationExamplesConstraintError(error) {
  const message = String(error?.message ?? "");
  return message.includes("chk_vacancies_communication_examples_array");
}

async function generateWithModel(llmAdapter, prompt, model) {
  const options = model ? { model } : undefined;
  return llmAdapter.generate(prompt, options);
}

async function generatePlanDraft({ llmAdapter, prompt, model }) {
  const raw = await generateWithModel(llmAdapter, prompt, model);
  const parsed = parseJsonPayload(raw);
  const draft = normalizePlan(parsed);
  if (draft) {
    return { draft, raw };
  }

  const repairedRaw = await generateWithModel(
    llmAdapter,
    buildPlanRepairPrompt({ prompt, invalidResponse: raw }),
    model
  );

  return {
    raw: repairedRaw,
    draft: normalizePlan(parseJsonPayload(repairedRaw))
  };
}

function buildPlanRepairPrompt({ prompt, invalidResponse }) {
  return `${prompt}

Предыдущий ответ не прошел валидацию и не может быть использован как сценарий.

Ниже невалидный ответ модели:
${String(invalidResponse ?? "").trim() || "— пустой ответ"}

Исправь ответ и верни только валидный JSON строго по указанной выше схеме.
Без markdown.
Без пояснений.
Без текста до или после JSON.
Проверь перед ответом:
- 4-7 шагов
- первый шаг содержит приветствие и один вопрос
- последний шаг приглашает на следующий этап
- reminders_count в диапазоне 0-3`;
}

async function findVacancy({ tenantSql, vacancyId, jobId }) {
  if (vacancyId) {
    const rows = await tenantSql`
      SELECT *
      FROM chatbot.vacancies
      WHERE vacancy_id = ${vacancyId}
      LIMIT 1
    `;

    const vacancy = rows[0] ?? null;
    if (vacancy) {
      return {
        vacancy,
        resolvedVacancyId: vacancy.vacancy_id
      };
    }
  }

  if (jobId) {
    const rows = await tenantSql`
      SELECT *
      FROM chatbot.vacancies
      WHERE job_id = ${jobId}
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'draft' THEN 1
          ELSE 2
        END ASC,
        updated_at DESC,
        created_at DESC
      LIMIT 1
    `;

    const vacancy = rows[0] ?? null;
    if (vacancy) {
      return {
        vacancy,
        resolvedVacancyId: vacancy.vacancy_id
      };
    }

    const jobRows = await tenantSql`
      SELECT job_id, title, description
      FROM chatbot.jobs
      WHERE job_id = ${jobId}
      LIMIT 1
    `;
    const job = jobRows[0] ?? null;
    if (job) {
      const seededRows = await tenantSql`
        INSERT INTO chatbot.vacancies (
          title,
          raw_text,
          job_id,
          status,
          extraction_status,
          communication_plan,
          communication_plan_draft,
          communication_examples,
          communication_examples_plan_hash
        )
        VALUES (
          ${job.title ?? "Новая вакансия"},
          ${job.description ?? null},
          ${job.job_id},
          'draft',
          'pending',
          NULL,
          NULL,
          '[]'::jsonb,
          NULL
        )
        RETURNING *
      `;

      const seededVacancy = seededRows[0] ?? null;
      if (seededVacancy) {
        return {
          vacancy: seededVacancy,
          resolvedVacancyId: seededVacancy.vacancy_id
        };
      }
    }
  }

  return {
    vacancy: null,
    resolvedVacancyId: null
  };
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

function formatSourceMaterials(vacancy) {
  const sections = [];
  const rawText = cleanText(vacancy?.raw_text, "");
  if (rawText) {
    sections.push(`Текст вакансии:\n${truncateForPrompt(rawText, 2500)}`);
  }

  const sourceMaterials = vacancy?.source_materials;
  if (sourceMaterials && typeof sourceMaterials === "object" && !Array.isArray(sourceMaterials)) {
    const materialLines = Object.entries(sourceMaterials)
      .map(([key, value]) => {
        const serialized = typeof value === "string" ? value : JSON.stringify(value);
        const text = cleanText(serialized, "");
        if (!text) return null;
        return `${key}: ${truncateForPrompt(text, 800)}`;
      })
      .filter(Boolean)
      .slice(0, 8);

    if (materialLines.length > 0) {
      sections.push(`Структурированные материалы:\n- ${materialLines.join("\n- ")}`);
    }
  }

  return sections.length > 0 ? sections.join("\n\n") : "— не указано";
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

function formatExistingPlan(plan) {
  return [
    `Название: ${plan.scenario_title}`,
    `Цель: ${plan.goal}`,
    "Шаги:",
    ...plan.steps.map((step, index) => (
      `${index + 1}. ${step.step} (напоминаний: ${step.reminders_count}) — ${step.comment}`
    ))
  ].join("\n");
}
