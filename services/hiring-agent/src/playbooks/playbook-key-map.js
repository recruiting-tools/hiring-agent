const LEGACY_PLAYBOOK_KEY_ALIASES = Object.freeze({
  candidate_broadcast: "mass_broadcast",
  write_vacancy_text: "view_vacancy",
  "vacancy-text": "view_vacancy",
  vacancy_text: "view_vacancy"
});

const TENANT_LOCK_BYPASS_PLAYBOOK_KEYS = Object.freeze(
  new Set([
    "create_vacancy",
    "view_vacancy"
  ])
);

export function canonicalizePlaybookKey(playbookKey) {
  const key = String(playbookKey ?? "").trim();
  if (!key) return key;

  return LEGACY_PLAYBOOK_KEY_ALIASES[key] ?? key;
}

export function canBypassTenantPlaybookLock(playbookKey) {
  return TENANT_LOCK_BYPASS_PLAYBOOK_KEYS.has(canonicalizePlaybookKey(playbookKey));
}
