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
