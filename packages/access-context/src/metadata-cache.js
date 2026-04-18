export const DEFAULT_ACCESS_CONTEXT_METADATA_CACHE_TTL_MS = 30_000;

export function createAccessContextMetadataCache(options = {}) {
  const ttlMs = resolveAccessContextMetadataCacheTtlMs(options.ttlMs);
  const now = options.now ?? (() => Date.now());
  const bindingEntries = new Map();
  const dbConnectionEntries = new Map();

  return {
    getBinding({ appEnv, tenantId }) {
      return getCachedValue(bindingEntries, bindingCacheKey({ appEnv, tenantId }), now);
    },

    setBinding({ appEnv, tenantId, binding }) {
      setCachedValue(bindingEntries, bindingCacheKey({ appEnv, tenantId }), binding, ttlMs, now);
      return binding;
    },

    getDatabaseConnection({ appEnv, dbAlias }) {
      return getCachedValue(dbConnectionEntries, dbConnectionCacheKey({ appEnv, dbAlias }), now);
    },

    setDatabaseConnection({ appEnv, dbAlias, databaseConnection }) {
      setCachedValue(dbConnectionEntries, dbConnectionCacheKey({ appEnv, dbAlias }), databaseConnection, ttlMs, now);
      return databaseConnection;
    },

    clear() {
      bindingEntries.clear();
      dbConnectionEntries.clear();
    }
  };
}

export function resolveAccessContextMetadataCacheTtlMs(ttlMs = null) {
  const candidate = ttlMs ?? process.env.ACCESS_CONTEXT_METADATA_CACHE_TTL_MS;
  const resolved = Number(candidate);
  if (Number.isFinite(resolved) && resolved >= 0) {
    return resolved;
  }
  return DEFAULT_ACCESS_CONTEXT_METADATA_CACHE_TTL_MS;
}

function bindingCacheKey({ appEnv, tenantId }) {
  return `${appEnv}:${tenantId}`;
}

function dbConnectionCacheKey({ appEnv, dbAlias }) {
  return `${appEnv}:${dbAlias}`;
}

function getCachedValue(entries, key, now) {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    entries.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue(entries, key, value, ttlMs, now) {
  if (ttlMs <= 0) return;
  entries.set(key, {
    value,
    expiresAt: now() + ttlMs
  });
}
