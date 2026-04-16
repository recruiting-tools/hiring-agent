const FILTERS = {
  bullet_list(value) {
    if (!Array.isArray(value)) return stringifyScalar(value);
    return value.map((item) => `• ${stringifyScalar(item)}`).join("\n");
  },

  formatted(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value.map((item) => `• ${stringifyScalar(item)}`).join("\n");
    }
    if (isPlainObject(value)) {
      return formatStructuredObject(value);
    }
    return stringifyScalar(value);
  },

  json(value) {
    if (value == null) return "";
    return JSON.stringify(value);
  },

  html(value) {
    if (value == null) return "";
    return typeof value === "string" ? value : stringifyScalar(value);
  },

  names_only(value) {
    if (!Array.isArray(value)) return "";
    return value
      .map((item) => (item && typeof item === "object" ? item.name : item))
      .filter(Boolean)
      .join(", ");
  },

  in_scope_only(value) {
    if (!Array.isArray(value)) return "";
    return FILTERS.names_only(value.filter((item) => item?.in_our_scope === true));
  },

  qa_list(value) {
    if (!Array.isArray(value)) return "";
    return value
      .map((item) => `Q: ${item?.q ?? ""}\nA: ${item?.a ?? ""}`.trim())
      .join("\n\n");
  },

  table(value) {
    if (!Array.isArray(value) || value.length === 0) return "";

    if (looksLikeApplicationSteps(value)) {
      return formatApplicationStepsTable(value);
    }

    const columns = Array.from(new Set(value.flatMap((item) => Object.keys(item ?? {}))));
    const header = `| ${columns.map((column) => formatTableHeader(column)).join(" | ")} |`;
    const separator = `| ${columns.map(() => "---").join(" | ")} |`;
    const rows = value.map((item) => (
      `| ${columns.map((column) => formatTableCell(item?.[column], column)).join(" | ")} |`
    ));

    return [header, separator, ...rows].join("\n");
  },

  must_haves_review(value) {
    if (!Array.isArray(value) || value.length === 0) {
      return "Пока не удалось выделить обязательные требования. Нажмите «Уточнить» и пришлите больше материалов.";
    }

    const count = value.length;
    const intro = count < 2
      ? `Нашли только ${count} обязательных требования — кажется маловато. Не упустили ничего важного?`
      : count >= 5
        ? `Нашли ${count} обязательных требований — это много. Все они действительно блокирующие?`
        : "Нашли следующие обязательные требования:";

    return [
      intro,
      "",
      "Список обязательных требований:",
      FILTERS.bullet_list(value)
    ].join("\n");
  },

  funnel_table(value) {
    if (!Array.isArray(value) || value.length === 0) return "Нет данных по воронке.";

    const header = "| Этап | Всего | В работе | Завершено | Зависли | Отказ |";
    const separator = "| --- | --- | --- | --- | --- | --- |";
    const rows = value.map((item) => (
      `| ${stringifyScalar(item?.step_name)} | ${stringifyScalar(item?.total)} | ${stringifyScalar(item?.in_progress)} | ${stringifyScalar(item?.completed)} | ${stringifyScalar(item?.stuck)} | ${stringifyScalar(item?.rejected)} |`
    ));
    return [header, separator, ...rows].join("\n");
  },

  candidate_search_results(value) {
    if (!Array.isArray(value) || value.length === 0) {
      return "Ничего не нашлось. Попробуйте уточнить имя, стек или этап.";
    }

    const header = "| Кандидат | Вакансия | Текущий этап | Статус | Match |";
    const separator = "| --- | --- | --- | --- | --- |";
    const rows = value.map((item) => (
      `| ${stringifyScalar(item?.name)} | ${stringifyScalar(item?.vacancy_title)} | ${stringifyScalar(item?.current_step)} | ${stringifyScalar(item?.status)} | ${stringifyScalar(item?.match_score)} |`
    ));
    return [header, separator, ...rows].join("\n");
  },

  candidate_snapshot(value) {
    if (!value || typeof value !== "object") {
      return stringifyScalar(value);
    }

    if (value.kind === "not_found") {
      const suffix = value.lookup_query ? `: ${value.lookup_query}` : "";
      return `Кандидат не найден${suffix}.`;
    }

    if (value.kind === "ambiguous") {
      const lines = ["Нашлось несколько кандидатов. Лучше уточнить запрос или открыть `candidate_search`:"];
      for (const item of value.matches ?? []) {
        lines.push(`• ${stringifyScalar(item?.name)} · ${stringifyScalar(item?.vacancy_title)} · ${stringifyScalar(item?.current_step)}`);
      }
      return lines.join("\n");
    }

    const lines = [
      `# ${value.candidate_name ?? value.candidate_id ?? "Кандидат"}`,
      `Статус run: ${stringifyScalar(value.run_status)}`,
      `Текущий этап: ${stringifyScalar(value.current_step)}`,
      `Вакансия: ${stringifyScalar(value.vacancy_title)}`
    ];

    if (value.hours_on_step != null) {
      lines.push(`Часов на этапе: ${stringifyScalar(value.hours_on_step)}`);
    }

    if (value.awaiting_reply === true) {
      lines.push("Ожидаем ответ кандидата: да");
    }

    if (value.last_message_at || value.last_message_body) {
      lines.push(
        "",
        "## Последнее сообщение",
        [
          value.last_message_direction ? `Направление: ${value.last_message_direction}` : null,
          value.last_message_at ? `Время: ${value.last_message_at}` : null,
          value.last_message_body ? `Текст: ${value.last_message_body}` : null
        ].filter(Boolean).join("\n")
      );
    }

    if (value.next_message_body || value.next_message_send_after) {
      lines.push(
        "",
        "## Очередь",
        [
          value.next_message_review_status ? `Статус: ${value.next_message_review_status}` : null,
          value.next_message_send_after ? `Отправка после: ${value.next_message_send_after}` : null,
          value.next_message_body ? `Сообщение: ${value.next_message_body}` : null
        ].filter(Boolean).join("\n")
      );
    }

    if (value.rejection_reason) {
      lines.push("", `Причина отклонения: ${value.rejection_reason}`);
    }

    return lines.join("\n");
  },

  today_summary(value) {
    if (!value || typeof value !== "object") {
      return stringifyScalar(value);
    }

    const stalled = Array.isArray(value.stalled_candidates) ? value.stalled_candidates : [];
    const lines = [
      "Сводка за сегодня:",
      `• Ответов от кандидатов: ${stringifyScalar(value.responses_today ?? 0)}`,
      `• Отправленных сообщений: ${stringifyScalar(value.sent_today ?? 0)}`,
      `• Сообщений в moderation queue: ${stringifyScalar(value.moderation_pending ?? 0)}`,
      `• Застрявших кандидатов: ${stalled.length}`
    ];

    if (stalled.length) {
      lines.push("", "Застрявшие кандидаты:");
      for (const item of stalled) {
        lines.push(`• ${stringifyScalar(item?.name)} · ${stringifyScalar(item?.vacancy_title)} · ${stringifyScalar(item?.current_step)} · ${stringifyScalar(item?.hours_waiting)} ч`);
      }
    }

    return lines.join("\n");
  },

  vacancy_card(value) {
    if (!value || typeof value !== "object") return stringifyScalar(value);

    const lines = [`# ${value.title ?? "Вакансия без названия"}`];

    if (Array.isArray(value.must_haves) && value.must_haves.length) {
      lines.push("", "## Must haves", FILTERS.bullet_list(value.must_haves));
    }

    if (Array.isArray(value.nice_haves) && value.nice_haves.length) {
      lines.push("", "## Nice to have", FILTERS.bullet_list(value.nice_haves));
    }

    if (value.work_conditions) {
      lines.push("", "## Условия работы", FILTERS.formatted(value.work_conditions));
    }

    if (Array.isArray(value.application_steps) && value.application_steps.length) {
      lines.push("", "## Этапы", FILTERS.table(value.application_steps));
    }

    if (value.company_info) {
      lines.push("", "## О компании", FILTERS.formatted(value.company_info));
    }

    if (Array.isArray(value.faq) && value.faq.length) {
      lines.push("", "## FAQ", FILTERS.qa_list(value.faq));
    }

    return lines.join("\n");
  }
};

export function interpolate(template, context = {}) {
  const input = String(template ?? "");

  return input.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]+?)\s*)?\}\}/g, (_match, path, filterName) => {
    const value = resolvePath(context, String(path ?? "").trim());
    if (!filterName) {
      return stringifyScalar(value);
    }

    const filter = FILTERS[String(filterName).trim()];
    if (!filter) {
      return stringifyScalar(value);
    }

    return filter(value);
  });
}

function resolvePath(context, path) {
  if (!path) return "";

  const segments = path.split(".");
  const normalizedSegments = segments[0] === "context" && !Object.hasOwn(context, "context")
    ? segments.slice(1)
    : segments;

  return normalizedSegments.reduce((current, segment) => {
    if (current == null) return undefined;
    return current[segment];
  }, context);
}

function stringifyScalar(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikeApplicationSteps(value) {
  return value.every((item) => isPlainObject(item) && "name" in item && "type" in item && "what" in item && "script" in item);
}

function formatApplicationStepsTable(steps) {
  const columns = ["name", "type", "what", "script", "is_target"];
  const header = "| Этап | Тип | Что проверяем | Как спрашиваем | Цель |";
  const separator = "| --- | --- | --- | --- | --- |";
  const rows = steps.map((item) => (
    `| ${columns.map((column) => formatTableCell(item?.[column], column)).join(" | ")} |`
  ));
  return [header, separator, ...rows].join("\n");
}

function formatStructuredObject(value) {
  if (looksLikeWorkConditions(value)) {
    return formatWorkConditions(value);
  }

  const lines = Object.entries(value)
    .filter(([, item]) => !isEmptyValue(item))
    .map(([key, item]) => `${humanizeKey(key)}: ${formatStructuredInlineValue(item, key)}`);

  return lines.length > 0 ? lines.join("\n") : "— не указано";
}

function looksLikeWorkConditions(value) {
  const knownKeys = [
    "salary_range",
    "pay_per_shift",
    "currency",
    "remote",
    "schedule",
    "shift_duration_hours",
    "location",
    "tools_own",
    "contract_type",
    "perks"
  ];

  return Object.keys(value).some((key) => knownKeys.includes(key));
}

function formatWorkConditions(value) {
  const lines = [];
  const salary = formatSalaryRange(value.salary_range, value.currency);
  if (salary) lines.push(`Зарплата: ${salary}`);
  if (typeof value.pay_per_shift === "number") {
    lines.push(`Оплата за смену: ${formatMoney(value.pay_per_shift, value.currency)}`);
  }
  if (typeof value.remote === "boolean") lines.push(`Удалёнка: ${value.remote ? "да" : "нет"}`);
  if (!isEmptyValue(value.schedule)) lines.push(`График: ${value.schedule}`);
  if (typeof value.shift_duration_hours === "number") lines.push(`Длительность смены: ${value.shift_duration_hours} ч.`);
  if (!isEmptyValue(value.location)) lines.push(`Локация: ${value.location}`);
  if (typeof value.tools_own === "boolean") lines.push(`Свои инструменты: ${value.tools_own ? "да" : "нет"}`);
  if (!isEmptyValue(value.contract_type)) lines.push(`Оформление: ${value.contract_type}`);
  if (Array.isArray(value.perks) && value.perks.length > 0) {
    lines.push(`Бонусы: ${value.perks.map((item) => stringifyScalar(item)).join(", ")}`);
  }

  const extraLines = Object.entries(value)
    .filter(([key, item]) => ![
      "salary_range",
      "pay_per_shift",
      "currency",
      "remote",
      "schedule",
      "shift_duration_hours",
      "location",
      "tools_own",
      "contract_type",
      "perks"
    ].includes(key) && !isEmptyValue(item))
    .map(([key, item]) => `${humanizeKey(key)}: ${formatStructuredInlineValue(item, key)}`);

  const allLines = [...lines, ...extraLines];
  return allLines.length > 0 ? allLines.join("\n") : "— не указано";
}

function formatSalaryRange(range, currency = "RUB") {
  if (isEmptyValue(range)) return "";
  if (typeof range === "string") return range;
  if (!isPlainObject(range)) return stringifyScalar(range);

  const min = typeof range.min === "number" ? range.min : null;
  const max = typeof range.max === "number" ? range.max : null;

  if (min != null && max != null) {
    return `${formatMoney(min, currency)}–${formatMoney(max, currency)}`;
  }
  if (min != null) {
    return `от ${formatMoney(min, currency)}`;
  }
  if (max != null) {
    return `до ${formatMoney(max, currency)}`;
  }

  return Object.entries(range)
    .filter(([, item]) => !isEmptyValue(item))
    .map(([key, item]) => `${humanizeKey(key)} ${formatStructuredInlineValue(item, key)}`)
    .join(", ");
}

function formatMoney(value, currency = "RUB") {
  if (typeof value !== "number") return stringifyScalar(value);
  const formatted = value.toLocaleString("ru-RU");
  return currency === "RUB" ? `${formatted} ₽` : `${formatted} ${currency}`;
}

function formatStructuredInlineValue(value, key = "") {
  if (isEmptyValue(value)) return "";
  if (key === "salary_range") return formatSalaryRange(value);
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => stringifyScalar(item)).join(", ");
  if (isPlainObject(value)) {
    return Object.entries(value)
      .filter(([, item]) => !isEmptyValue(item))
      .map(([nestedKey, item]) => `${humanizeKey(nestedKey)} ${formatStructuredInlineValue(item, nestedKey)}`)
      .join(", ");
  }
  return stringifyScalar(value);
}

function formatTableHeader(column) {
  const labels = {
    name: "Название",
    type: "Тип",
    what: "Что",
    script: "Скрипт",
    is_target: "Цель",
    in_our_scope: "В нашей зоне"
  };

  return labels[column] ?? humanizeKey(column);
}

function formatTableCell(value, column = "") {
  if (column === "type") {
    const labels = {
      must_have_check: "Must-have",
      condition_check: "Условие",
      target_action: "Целевое действие",
      employer_action: "Работодатель"
    };
    if (typeof value === "string" && labels[value]) {
      return labels[value];
    }
  }

  if (typeof value === "boolean") {
    return value ? "Да" : "Нет";
  }

  if (Array.isArray(value)) {
    return value.map((item) => stringifyScalar(item)).join(", ");
  }

  if (isPlainObject(value)) {
    return formatStructuredInlineValue(value, column);
  }

  return stringifyScalar(value);
}

function humanizeKey(key) {
  const labels = {
    name: "Название",
    description: "Описание",
    notes: "Заметки",
    schedule: "График",
    location: "Локация",
    remote: "Удалёнка",
    contract_type: "Оформление",
    shift_duration_hours: "Длительность смены",
    tools_own: "Свои инструменты",
    pay_per_shift: "Оплата за смену",
    salary_range: "Зарплата",
    perks: "Бонусы",
    is_target: "Цель",
    in_our_scope: "В нашей зоне"
  };
  if (labels[key]) return labels[key];

  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function isEmptyValue(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}
