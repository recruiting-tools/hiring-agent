const FILTERS = {
  bullet_list(value) {
    if (!Array.isArray(value)) return stringifyScalar(value);
    return value.map((item) => `• ${stringifyScalar(item)}`).join("\n");
  },

  formatted(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
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

    const columns = Array.from(new Set(value.flatMap((item) => Object.keys(item ?? {}))));
    const header = `| ${columns.join(" | ")} |`;
    const separator = `| ${columns.map(() => "---").join(" | ")} |`;
    const rows = value.map((item) => (
      `| ${columns.map((column) => stringifyScalar(item?.[column])).join(" | ")} |`
    ));

    return [header, separator, ...rows].join("\n");
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
