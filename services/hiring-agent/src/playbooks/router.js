const CACHE_TTL_MS = 5 * 60 * 1000;

const FALLBACK_ROUTES = [
  {
    playbook_key: "candidate_funnel",
    keywords: ["воронк", "статус кандидат", "funnel", "pipeline"]
  },
  {
    playbook_key: "communication_plan",
    keywords: ["план коммуникац", "скрининг", "communication plan"]
  },
  {
    playbook_key: "candidate_broadcast",
    keywords: ["всем кандидатам", "бродкаст", "массовое сообщение", "broadcast", "календарь"]
  }
];

let cachedDefinitions = null;
let cachedAt = 0;
let cachePromise = null;

export async function routePlaybook(message, managementSql = null) {
  const normalized = String(message ?? "").trim();
  const routes = managementSql ? await getDbRoutes(managementSql) : FALLBACK_ROUTES;

  for (const route of routes) {
    if (route.keywords.some((keyword) => normalized.toLowerCase().includes(keyword.toLowerCase()))) {
      return route.playbook_key;
    }
  }
  return null;
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
      SELECT playbook_key, keywords
      FROM management.playbook_definitions
      WHERE status = 'available'
      ORDER BY sort_order ASC, playbook_key ASC
    `.then((rows) => {
      cachedDefinitions = rows;
      cachedAt = Date.now();
      return rows;
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
