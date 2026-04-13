const PLAYBOOKS = [
  {
    playbook_key: "candidate_funnel",
    title: "Визуализация воронки",
    enabled: true,
    status: "ready"
  },
  {
    playbook_key: "communication_plan",
    title: "План коммуникации",
    enabled: false,
    status: "paid"
  },
  {
    playbook_key: "candidate_broadcast",
    title: "Выборочная рассылка кандидатам",
    enabled: false,
    status: "paid"
  }
];

export function getPlaybookRegistry() {
  return structuredClone(PLAYBOOKS);
}

export function findPlaybook(playbookKey) {
  return PLAYBOOKS.find((playbook) => playbook.playbook_key === playbookKey) ?? null;
}
