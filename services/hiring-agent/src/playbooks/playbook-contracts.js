export const ALWAYS_RUNNABLE_PLAYBOOK_KEYS = Object.freeze(
  new Set([
    "candidate_funnel",
    "setup_communication",
    "assistant_capabilities",
    "quick_start"
  ])
);

export const FALLBACK_ROUTES = Object.freeze([
  {
    playbook_key: "candidate_funnel",
    keywords: ["воронк", "статус кандидат", "funnel", "pipeline"]
  },
  {
    playbook_key: "setup_communication",
    keywords: ["план коммуникац", "скрининг", "communication plan", "настроить общение", "настройте общение"]
  },
  {
    playbook_key: "assistant_capabilities",
    keywords: [
      "что ты умеешь",
      "чем ты умеешь",
      "что ты вообще умеешь",
      "что ты можешь делать",
      "чем ты можешь",
      "помощь",
      "справка",
      "что умеет"
    ]
  },
  {
    playbook_key: "quick_start",
    keywords: ["быстрый старт", "с чего начать", "первый запуск", "чеклист", "quick start", "как начать"]
  },
  {
    playbook_key: "candidate_broadcast",
    keywords: ["рассылк", "всем кандидатам", "бродкаст", "массовое сообщение", "broadcast", "календарь"]
  }
]);

export const FALLBACK_PLAYBOOKS = Object.freeze([
  {
    playbook_key: "candidate_funnel",
    title: "Визуализация воронки",
    name: "Визуализация воронки",
    enabled: true,
    status: "available"
  },
  {
    playbook_key: "setup_communication",
    title: "Настроить общение с кандидатами",
    name: "Настроить общение с кандидатами",
    enabled: true,
    status: "available"
  },
  {
    playbook_key: "assistant_capabilities",
    title: "Что ты умеешь",
    name: "Что ты умеешь",
    enabled: true,
    status: "available"
  },
  {
    playbook_key: "quick_start",
    title: "Быстрый старт",
    name: "Быстрый старт",
    enabled: true,
    status: "available"
  },
  {
    playbook_key: "candidate_broadcast",
    title: "Выборочная рассылка кандидатам",
    name: "Выборочная рассылка кандидатам",
    enabled: false,
    status: "coming_soon"
  }
]);

export const STATIC_UTILITY_PLAYBOOK_KEYS = Object.freeze(
  new Set([
    "assistant_capabilities",
    "quick_start"
  ])
);

export const PLAYBOOKS_WITHOUT_VACANCY = Object.freeze(
  new Set([
    "candidate_funnel",
    "setup_communication",
    "assistant_capabilities",
    "quick_start",
    "create_vacancy"
  ])
);

export const ROUTING_FALLBACK_TEXT = "Я пока поддерживаю воронку по кандидатам, план коммуникации, выборочную рассылку, а также полезные справочные сценарии.";

export const STATIC_UTILITY_REPLIES = Object.freeze({
  assistant_capabilities: Object.freeze({
    kind: "display",
    content_type: "text",
    lines: [
      "Что умеет <name>:",
      "• Собирать структуру вакансии и готовить данные под воронку кандидатов.",
      "• Подстраивать сценарий коммуникации и давать примеры первых сообщений.",
      "• Формировать массовую рассылку и запускать контактную волны.",
      "• Показывать быстрый старт и подсказки по работе с чатом."
    ]
  }),
  quick_start: Object.freeze({
    kind: "display",
    content_type: "text",
    lines: [
      "Быстрый старт в Hiring Agent:",
      "1. Выберите вакансию в верхней части экрана (если хотите работать с конкретной вакансией).",
      "2. Напишите задачу в чат: воронка, рассылка, коммуникация или подготовка вакансии.",
      "3. Подтверждайте шаги, если ассистент просит уточнить детали.",
      "4. Для справки вызывайте «что ты умеешь» или «быстрый старт»."
    ]
  })
});

const STATIC_REPLIES_FALLBACK = Object.freeze({
  kind: "fallback_text",
  text: "Этот utility-плейбук пока недоступен."
});

const STATIC_UTILITY_REPLY_KEYS = Object.freeze(new Set(Object.keys(STATIC_UTILITY_REPLIES)));

export function buildStaticPlaybookReply(playbookKey, playbook = {}) {
  if (!STATIC_UTILITY_REPLY_KEYS.has(playbookKey)) {
    return structuredClone(STATIC_REPLIES_FALLBACK);
  }

  const config = STATIC_UTILITY_REPLIES[playbookKey];
  if (!config) {
    return structuredClone(STATIC_REPLIES_FALLBACK);
  }

  const titleName = playbook.name ?? "ассистент";
  const [firstLine, ...restLines] = config.lines;
  return {
    kind: config.kind,
    content_type: config.content_type,
    content: [firstLine.replace("<name>", titleName), ...restLines].join("\n")
  };
}

export const SCENARIO_TEST_MESSAGES = Object.freeze({
  capabilitiesRoute: "Расскажи, что ты вообще умеешь?",
  quickStartRoute: "Нужен быстрый старт",
  unknownPlaybook: "Проверка неизвестного playbook",
  funnelRoute: "Визуализируй воронку по кандидатам"
});

export const UNKNOWN_PLAYBOOK_KEY = "does_not_exist";
