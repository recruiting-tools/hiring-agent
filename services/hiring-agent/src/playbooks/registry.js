const CACHE_TTL_MS = 5 * 60 * 1000;

const FALLBACK_PLAYBOOKS = [
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
    playbook_key: "candidate_broadcast",
    title: "Выборочная рассылка кандидатам",
    name: "Выборочная рассылка кандидатам",
    enabled: false,
    status: "coming_soon"
  }
];

let cachedPlaybooks = null;
let cachedAt = 0;
let cachePromise = null;

export async function getPlaybookRegistry(managementSql = null) {
  if (!managementSql) {
    return structuredClone(FALLBACK_PLAYBOOKS);
  }

  if (cachedPlaybooks && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    return structuredClone(cachedPlaybooks);
  }

  if (!cachePromise) {
    cachePromise = managementSql`
      SELECT playbook_key, name, trigger_description, status, sort_order
      FROM management.playbook_definitions
      WHERE status != 'deprecated'
      ORDER BY sort_order ASC, playbook_key ASC
    `.then((rows) => {
      cachedPlaybooks = rows.map((row) => ({
        ...row,
        title: row.name,
        enabled: row.status === "available"
      }));
      cachedAt = Date.now();
      return cachedPlaybooks;
    }).finally(() => {
      cachePromise = null;
    });
  }

  return structuredClone(await cachePromise);
}

export async function findPlaybook(playbookKey, managementSql = null) {
  const playbooks = await getPlaybookRegistry(managementSql);
  return playbooks.find((playbook) => playbook.playbook_key === playbookKey) ?? null;
}
