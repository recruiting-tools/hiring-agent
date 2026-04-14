const FALLBACK_PLAYBOOKS = [
  {
    playbook_key: "candidate_funnel",
    title: "Визуализация воронки",
    name: "Визуализация воронки",
    enabled: true,
    status: "available"
  },
  {
    playbook_key: "communication_plan",
    title: "План коммуникации",
    name: "План коммуникации",
    enabled: false,
    status: "coming_soon"
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

export async function getPlaybookRegistry(managementSql = null) {
  if (!managementSql) {
    return structuredClone(FALLBACK_PLAYBOOKS);
  }

  if (!cachedPlaybooks) {
    const rows = await managementSql`
      SELECT playbook_key, name, trigger_description, status, sort_order
      FROM management.playbook_definitions
      WHERE status != 'deprecated'
      ORDER BY sort_order ASC, playbook_key ASC
    `;

    cachedPlaybooks = rows.map((row) => ({
      ...row,
      title: row.name,
      enabled: row.status === "available"
    }));
  }

  return structuredClone(cachedPlaybooks);
}

export async function findPlaybook(playbookKey, managementSql = null) {
  const playbooks = await getPlaybookRegistry(managementSql);
  return playbooks.find((playbook) => playbook.playbook_key === playbookKey) ?? null;
}
