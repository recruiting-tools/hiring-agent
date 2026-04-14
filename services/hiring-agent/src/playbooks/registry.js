const CACHE_TTL_MS = 5 * 60 * 1000;
const ALWAYS_RUNNABLE_PLAYBOOKS = new Set();

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
    playbook_key: "view_vacancy",
    title: "Карточка вакансии",
    name: "Карточка вакансии",
    enabled: true,
    status: "available"
  },
  {
    playbook_key: "mass_broadcast",
    title: "Массовая рассылка кандидатам",
    name: "Массовая рассылка кандидатам",
    enabled: true,
    status: "available"
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
      SELECT
        d.playbook_key,
        d.name,
        d.trigger_description,
        d.status,
        d.sort_order,
        COUNT(s.step_key)::int AS step_count
      FROM management.playbook_definitions d
      LEFT JOIN management.playbook_steps s
        ON s.playbook_key = d.playbook_key
      WHERE d.status != 'deprecated'
      GROUP BY d.playbook_key, d.name, d.trigger_description, d.status, d.sort_order
      ORDER BY d.sort_order ASC, d.playbook_key ASC
    `.then((rows) => {
      cachedPlaybooks = rows.map((row) => ({
        ...row,
        title: row.name,
        enabled: row.status === "available" && isRunnablePlaybook(row.playbook_key, row.step_count)
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

function isRunnablePlaybook(playbookKey, stepCount) {
  return ALWAYS_RUNNABLE_PLAYBOOKS.has(playbookKey) || Number(stepCount ?? 0) > 0;
}
