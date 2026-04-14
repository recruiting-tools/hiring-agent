const CACHE_TTL_MS = 5 * 60 * 1000;
const ALWAYS_RUNNABLE_PLAYBOOKS = new Set([
  "candidate_funnel",
  "setup_communication"
]);

const FALLBACK_ROUTES = [
  {
    playbook_key: "candidate_funnel",
    keywords: ["воронк", "статус кандидат", "funnel", "pipeline"]
  },
  {
    playbook_key: "setup_communication",
    keywords: ["план коммуникац", "скрининг", "communication plan", "настроить общение", "настройте общение"]
  },
  {
    playbook_key: "candidate_broadcast",
    keywords: ["всем кандидатам", "бродкаст", "массовое сообщение", "broadcast", "календарь"]
  }
];

const RUSSIAN_SUFFIXES = [
  "ироваться",
  "ирования",
  "ирование",
  "ировала",
  "ировали",
  "ируют",
  "ирует",
  "ировать",
  "аться",
  "яться",
  "ются",
  "ется",
  "утся",
  "ешь",
  "ете",
  "ите",
  "ем",
  "им",
  "ут",
  "ют",
  "ого",
  "его",
  "ому",
  "ему",
  "ыми",
  "ими",
  "овать",
  "ать",
  "ять",
  "еть",
  "ить",
  "ть",
  "ти",
  "ий",
  "ый",
  "ой",
  "ая",
  "яя",
  "ое",
  "ее",
  "ые",
  "ие",
  "ов",
  "ев",
  "ом",
  "ем",
  "ам",
  "ям",
  "ах",
  "ях",
  "ию",
  "ия",
  "ью",
  "ья",
  "а",
  "я",
  "о",
  "е",
  "ы",
  "и",
  "у",
  "ю",
  "ь"
];

let cachedDefinitions = null;
let cachedAt = 0;
let cachePromise = null;

export async function routePlaybook(message, managementSql = null) {
  const normalized = String(message ?? "").trim().toLowerCase();
  const routes = managementSql ? await getDbRoutes(managementSql) : FALLBACK_ROUTES;

  return matchRoute(normalized, routes);
}

async function getDbRoutes(managementSql) {
  if (cachedDefinitions && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    return cachedDefinitions.map((row) => ({
      playbook_key: row.playbook_key,
      keywords: row.keywords ?? []
    }));
  }

  if (!cachePromise) {
    cachePromise = managementSql`
      SELECT
        d.playbook_key,
        d.keywords,
        COUNT(s.step_key)::int AS step_count
      FROM management.playbook_definitions d
      LEFT JOIN management.playbook_steps s
        ON s.playbook_key = d.playbook_key
      WHERE d.status = 'available'
      GROUP BY d.playbook_key, d.keywords, d.sort_order
      ORDER BY d.sort_order ASC, d.playbook_key ASC
    `.then((rows) => {
      cachedDefinitions = rows.filter((row) => (
        ALWAYS_RUNNABLE_PLAYBOOKS.has(row.playbook_key) || Number(row.step_count ?? 0) > 0
      ));
      cachedAt = Date.now();
      return cachedDefinitions;
    }).finally(() => {
      cachePromise = null;
    });
  }

  const rows = await cachePromise;
  return rows.map((row) => ({
    playbook_key: row.playbook_key,
    keywords: row.keywords ?? []
  }));
}

function matchRoute(normalizedMessage, routes) {
  const normalizedStemmedMessage = normalizeForKeywordSearch(normalizedMessage);

  for (const route of routes) {
    const keywords = Array.isArray(route?.keywords) ? route.keywords : [];
    if (keywords.some((keyword) => matchesKeyword(normalizedMessage, normalizedStemmedMessage, keyword))) {
      return route.playbook_key;
    }
  }
  return null;
}

function matchesKeyword(normalizedMessage, normalizedStemmedMessage, keyword) {
  const normalizedKeyword = String(keyword ?? "").trim().toLowerCase();
  if (!normalizedKeyword) return false;

  if (normalizedMessage.includes(normalizedKeyword)) {
    return true;
  }

  const normalizedStemmedKeyword = normalizeForKeywordSearch(normalizedKeyword);
  if (!normalizedStemmedKeyword) return false;

  return normalizedStemmedMessage.includes(normalizedStemmedKeyword);
}

function normalizeForKeywordSearch(text) {
  return String(text ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .match(/[a-zа-я0-9]+/g)?.map((token) => stemToken(token)).join(" ") ?? "";
}

function stemToken(token) {
  if (!/[а-я]/.test(token)) return token;

  for (const suffix of RUSSIAN_SUFFIXES) {
    if (!token.endsWith(suffix)) continue;
    const stem = token.slice(0, -suffix.length);
    if (stem.length >= 4) {
      return stem;
    }
  }

  return token;
}
