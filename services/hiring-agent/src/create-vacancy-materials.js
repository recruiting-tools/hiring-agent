const HH_VACANCY_URL_PATTERN = /https?:\/\/(?:[a-z0-9-]+\.)?hh\.ru\/vacancy\/\d+[^\s)>\]]*/i;
const DEFAULT_HH_FETCH_TIMEOUT_MS = 15000;

export async function resolveCreateVacancyMaterials({
  recruiterInput,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_HH_FETCH_TIMEOUT_MS
}) {
  const rawInput = String(recruiterInput ?? "").trim();
  const hhUrl = extractHhVacancyUrl(rawInput);

  if (!rawInput || !hhUrl || typeof fetchImpl !== "function") {
    return {
      title: null,
      rawText: rawInput,
      sourceUrl: hhUrl
    };
  }

  try {
    const vacancy = await fetchHhVacancyPage({
      url: hhUrl,
      fetchImpl,
      timeoutMs
    });
    return {
      title: vacancy.title || null,
      rawText: buildHhVacancyRawText(vacancy, {
        sourceUrl: hhUrl,
        recruiterInput: rawInput
      }),
      sourceUrl: hhUrl
    };
  } catch {
    return {
      title: null,
      rawText: rawInput,
      sourceUrl: hhUrl
    };
  }
}

export function extractHhVacancyUrl(text) {
  return String(text ?? "").match(HH_VACANCY_URL_PATTERN)?.[0] ?? null;
}

async function fetchHhVacancyPage({ url, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": "hiring-agent/1.0 (+https://recruiter-assistant.com)",
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.8"
      },
      signal: controller.signal
    });

    if (!response?.ok) {
      throw new Error(`HH vacancy fetch failed with status ${response?.status ?? "unknown"}`);
    }

    const html = await response.text();
    return parseHhVacancyHtml(html);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function parseHhVacancyHtml(html) {
  const source = String(html ?? "");
  const title = extractTextByQa(source, "vacancy-title");
  const company = extractTextByQa(source, "vacancy-company-name");
  const salary = extractTextByQa(source, "vacancy-salary");
  const experience = extractTextByQa(source, "vacancy-experience");
  const employment = extractTextByQa(source, "common-employment-text");
  const schedule = extractTextByQa(source, "work-schedule-by-days-text");
  const workingHours = extractTextByQa(source, "working-hours-text");
  const descriptionHtml = extractElementInnerHtmlByQa(source, "vacancy-description");
  const description = htmlToPlainText(descriptionHtml);

  return {
    title,
    company,
    salary,
    experience,
    employment,
    schedule,
    workingHours,
    description
  };
}

function buildHhVacancyRawText(vacancy, { sourceUrl, recruiterInput }) {
  const originalInput = String(recruiterInput ?? "").trim();
  const additionalNotes = originalInput.replace(sourceUrl, "").trim();
  const lines = [
    `Источник HH: ${sourceUrl}`
  ];

  if (vacancy.title) lines.push(`Название: ${vacancy.title}`);
  if (vacancy.company) lines.push(`Компания: ${vacancy.company}`);
  if (vacancy.salary) lines.push(`Зарплата: ${vacancy.salary}`);
  if (vacancy.experience) lines.push(`Опыт: ${vacancy.experience}`);
  if (vacancy.employment) lines.push(`Занятость: ${vacancy.employment}`);
  if (vacancy.schedule) lines.push(`График: ${vacancy.schedule}`);
  if (vacancy.workingHours) lines.push(`Часы работы: ${vacancy.workingHours}`);
  if (vacancy.description) {
    lines.push("", "Описание вакансии:", vacancy.description);
  }
  if (additionalNotes) {
    lines.push("", "Дополнительные материалы от рекрутера:", additionalNotes);
  }

  return lines.join("\n").trim();
}

function extractTextByQa(html, qa) {
  return htmlToPlainText(extractElementInnerHtmlByQa(html, qa));
}

function extractElementInnerHtmlByQa(html, qa) {
  const marker = `data-qa="${qa}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return "";

  const openStart = html.lastIndexOf("<", markerIndex);
  const openEnd = html.indexOf(">", markerIndex);
  if (openStart < 0 || openEnd < 0) return "";

  const openingTag = html.slice(openStart, openEnd + 1);
  const tagNameMatch = openingTag.match(/^<([a-z0-9-]+)/i);
  const tagName = tagNameMatch?.[1];
  if (!tagName) return "";

  let depth = 1;
  let cursor = openEnd + 1;
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;

  while (cursor < html.length) {
    const nextOpen = html.indexOf(openToken, cursor);
    const nextClose = html.indexOf(closeToken, cursor);
    if (nextClose < 0) return "";

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + openToken.length;
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return html.slice(openEnd + 1, nextClose);
    }
    cursor = nextClose + closeToken.length;
  }

  return "";
}

function htmlToPlainText(html) {
  const normalized = String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(?:\/p|\/div|\/section|\/h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(?:li|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ");

  return decodeHtmlEntities(normalized)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join("\n")
    .trim();
}

function decodeHtmlEntities(text) {
  return String(text ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
