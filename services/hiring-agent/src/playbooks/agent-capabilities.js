import { PLAYBOOKS_WITHOUT_VACANCY } from "./playbook-contracts.js";

const AGENT_CAPABILITIES_PLAYBOOK_KEY = "agent_capabilities";

const PLAYBOOK_DISCOVERY_METADATA = Object.freeze({
  agent_capabilities: Object.freeze({
    whenToUse: "Когда нужно быстро понять, какие сценарии доступны прямо сейчас.",
    requiresVacancySelection: false,
    hasSideEffects: false,
    examples: ["Что ты умеешь?", "Какие есть фичи?", "Help"]
  }),
  quick_start: Object.freeze({
    whenToUse: "Когда нужен краткий сценарий первого запуска и порядок действий.",
    requiresVacancySelection: false,
    hasSideEffects: false,
    examples: ["Быстрый старт", "С чего начать?", "Как начать работу?"]
  }),
  candidate_funnel: Object.freeze({
    whenToUse: "Когда нужно посмотреть текущую воронку кандидатов по вакансии.",
    requiresVacancySelection: true,
    hasSideEffects: false,
    examples: ["Покажи воронку по кандидатам", "Отчёт по воронке", "Какие статусы у кандидатов?"]
  }),
  setup_communication: Object.freeze({
    whenToUse: "Когда нужен план коммуникации, скрининг или примеры первых сообщений.",
    requiresVacancySelection: true,
    hasSideEffects: false,
    examples: ["Настрой общение с кандидатами", "Подготовь план коммуникации", "Сделай скрининг-сценарий"]
  }),
  mass_broadcast: Object.freeze({
    whenToUse: "Когда нужно подготовить массовое сообщение и контактную волну по вакансии.",
    requiresVacancySelection: true,
    hasSideEffects: true,
    examples: ["Сделай рассылку", "Отправь всем кандидатам ссылку на календарь", "Подготовь массовое сообщение"]
  }),
  view_vacancy: Object.freeze({
    whenToUse: "Когда нужно быстро открыть карточку и текст выбранной вакансии.",
    requiresVacancySelection: true,
    hasSideEffects: false,
    examples: ["Покажи текст вакансии", "Карточка вакансии", "Посмотреть вакансию"]
  }),
  create_vacancy: Object.freeze({
    whenToUse: "Когда нужно собрать новую вакансию из материалов или ссылки.",
    requiresVacancySelection: false,
    hasSideEffects: true,
    examples: ["Создать вакансию", "Собери новую вакансию", "Подготовь вакансию из описания"]
  }),
  account_access: Object.freeze({
    whenToUse: "Когда нужно отключить или отозвать доступ к hh.ru.",
    requiresVacancySelection: false,
    hasSideEffects: true,
    examples: ["Отключить hh", "Отозвать доступ", "Разъединить hh"]
  }),
  data_retention: Object.freeze({
    whenToUse: "Когда нужен подтверждённый сценарий очистки данных аккаунта.",
    requiresVacancySelection: false,
    hasSideEffects: true,
    examples: ["Удалить все данные", "Очистить данные аккаунта", "Стереть историю"]
  })
});

function formatBooleanLabel(value) {
  return value ? "да" : "нет";
}

function describePlaybook(playbook) {
  const metadata = PLAYBOOK_DISCOVERY_METADATA[playbook.playbook_key] ?? {};
  return {
    title: playbook.title ?? playbook.name ?? playbook.playbook_key,
    whenToUse: playbook.trigger_description ?? metadata.whenToUse ?? "Сценарий доступен через playbook registry.",
    requiresVacancySelection: metadata.requiresVacancySelection
      ?? !PLAYBOOKS_WITHOUT_VACANCY.has(playbook.playbook_key),
    hasSideEffects: metadata.hasSideEffects ?? false,
    examples: Array.isArray(metadata.examples) && metadata.examples.length > 0
      ? metadata.examples
      : [`Открой ${playbook.title ?? playbook.name ?? playbook.playbook_key}`]
  };
}

export function buildAgentCapabilitiesReply(playbooks, options = {}) {
  const agentName = options.agentName ?? "Hiring Agent";
  const enabledPlaybooks = (Array.isArray(playbooks) ? playbooks : [])
    .filter((playbook) => playbook?.enabled === true)
    .filter((playbook) => playbook.playbook_key !== AGENT_CAPABILITIES_PLAYBOOK_KEY);

  const lines = [
    `Что умеет ${agentName} сейчас:`
  ];

  if (enabledPlaybooks.length === 0) {
    lines.push("Сейчас нет доступных playbook-сценариев в реестре.");
  } else {
    lines.push(`Сейчас доступны ${enabledPlaybooks.length} сценариев.`);
    for (const playbook of enabledPlaybooks) {
      const details = describePlaybook(playbook);
      lines.push("");
      lines.push(`${details.title}`);
      lines.push(`Когда использовать: ${details.whenToUse}`);
      lines.push(`Нужно выбрать вакансию: ${formatBooleanLabel(details.requiresVacancySelection)}`);
      lines.push(`Есть побочные действия: ${formatBooleanLabel(details.hasSideEffects)}`);
      lines.push(`Примеры: ${details.examples.map((example) => `«${example}»`).join(", ")}`);
    }
  }

  lines.push("");
  lines.push("Если сомневаетесь, напишите задачу своими словами, и я подскажу подходящий сценарий.");

  return {
    kind: "display",
    content_type: "text",
    content: lines.join("\n")
  };
}
