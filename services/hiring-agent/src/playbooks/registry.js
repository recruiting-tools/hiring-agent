import { ALWAYS_RUNNABLE_PLAYBOOK_KEYS, FALLBACK_PLAYBOOKS } from "./playbook-contracts.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedPlaybooks = null;
let cachedAt = 0;
let cachePromise = null;

export function clearPlaybookRegistryCache() {
  cachedPlaybooks = null;
  cachedAt = 0;
  cachePromise = null;
}

export async function getPlaybookRegistry(managementSql = null, tenantId = null) {
  if (!managementSql) {
    return structuredClone(FALLBACK_PLAYBOOKS);
  }

  const baseRegistry = await getBaseRegistry(managementSql);
  if (!tenantId) {
    return structuredClone(baseRegistry);
  }

  const tenantOverrides = await getTenantPlaybookOverrides(managementSql, tenantId).catch(() => new Map());
  return structuredClone(baseRegistry.map((playbook) => ({
    ...playbook,
    enabled: tenantOverrides.has(playbook.playbook_key)
      ? (playbook.enabled && tenantOverrides.get(playbook.playbook_key))
      : playbook.enabled
  })));
}

async function getBaseRegistry(managementSql) {
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

async function getTenantPlaybookOverrides(managementSql, tenantId) {
  if (!tenantId) {
    return new Map();
  }

  const rows = await managementSql`
    SELECT playbook_key, enabled
    FROM management.tenant_playbook_access
    WHERE tenant_id = ${tenantId}
  `;

  const overrides = new Map();
  for (const row of rows) {
    overrides.set(row.playbook_key, row.enabled === true);
  }

  return overrides;
}

export async function findPlaybook(playbookKey, managementSql = null, tenantId = null) {
  const playbooks = await getPlaybookRegistry(managementSql, tenantId);
  return playbooks.find((playbook) => playbook.playbook_key === playbookKey) ?? null;
}

function isRunnablePlaybook(playbookKey, stepCount) {
  return ALWAYS_RUNNABLE_PLAYBOOK_KEYS.has(playbookKey) || Number(stepCount ?? 0) > 0;
}
