import { hasFallbackSteps } from "./local-seed-fallback.js";
import { ALWAYS_RUNNABLE_PLAYBOOK_KEYS, FALLBACK_PLAYBOOKS } from "./playbook-contracts.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

function canonicalizePlaybookKey(playbookKey) {
  return playbookKey === "candidate_broadcast" ? "mass_broadcast" : playbookKey;
}

function dedupeByPlaybookKey(playbooks) {
  const byKey = new Map();
  for (const playbook of playbooks) {
    const playbookKey = String(playbook?.playbook_key ?? "");
    if (!playbookKey) continue;
    byKey.set(playbookKey, playbook);
  }
  return [...byKey.values()];
}

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
    return dedupeByPlaybookKey(
      FALLBACK_PLAYBOOKS.map((playbook) => ({
        ...playbook,
        playbook_key: canonicalizePlaybookKey(playbook.playbook_key)
      }))
    );
  }

  const baseRegistry = await getBaseRegistry(managementSql);
  if (!tenantId) {
    return structuredClone(baseRegistry);
  }

  const tenantOverrides = await getTenantPlaybookOverrides(managementSql, tenantId).catch(() => new Map());
  return structuredClone(
    baseRegistry.map((playbook) => ({
      ...playbook,
      enabled: resolveTenantEnabledState(playbook, tenantOverrides)
    }))
  );
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
      const normalizedRows = rows.map((row) => {
        const playbookKey = canonicalizePlaybookKey(row.playbook_key);
        return {
          ...row,
          playbook_key: playbookKey,
          title: row.name,
          enabled: row.status === "available" && isRunnablePlaybook(playbookKey, row.step_count)
        };
      });
      cachedPlaybooks = dedupeByPlaybookKey(normalizedRows);
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
    overrides.set(canonicalizePlaybookKey(row.playbook_key), row.enabled === true);
  }

  return overrides;
}

export async function findPlaybook(playbookKey, managementSql = null, tenantId = null) {
  const playbooks = await getPlaybookRegistry(managementSql, tenantId);
  const normalizedPlaybookKey = canonicalizePlaybookKey(playbookKey);
  return playbooks.find((playbook) => playbook.playbook_key === normalizedPlaybookKey) ?? null;
}

function isRunnablePlaybook(playbookKey, stepCount) {
  return (
    ALWAYS_RUNNABLE_PLAYBOOK_KEYS.has(playbookKey)
    || hasFallbackSteps(playbookKey)
    || Number(stepCount ?? 0) > 0
  );
}

function resolveTenantEnabledState(playbook, tenantOverrides) {
  if (!playbook?.enabled) {
    return false;
  }

  // create_vacancy must remain available even when stale tenant override rows exist.
  if (playbook.playbook_key === "create_vacancy") {
    return true;
  }

  if (!tenantOverrides.has(playbook.playbook_key)) {
    return true;
  }

  return tenantOverrides.get(playbook.playbook_key) === true;
}
