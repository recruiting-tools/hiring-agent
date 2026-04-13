import postgres from "postgres";
import { AccessContextError } from "./access-context-error.js";

export function createPoolRegistry(options = {}) {
  const sqlFactory = options.sqlFactory ?? ((connectionString) => postgres(connectionString));
  const pools = new Map();

  return {
    getOrCreate({ appEnv, dbAlias, connectionString }) {
      if (!appEnv || !dbAlias || !connectionString) {
        throw new AccessContextError(
          "ERROR_DATABASE_CONNECTION_UNAVAILABLE",
          "Pool registry requires appEnv, dbAlias, and connectionString",
          { httpStatus: 503 }
        );
      }

      const key = `${appEnv}:${dbAlias}`;
      const existing = pools.get(key);
      if (existing) return existing;

      const sql = sqlFactory(connectionString);
      pools.set(key, sql);
      return sql;
    },

    async closeAll() {
      const closers = [];
      for (const sql of pools.values()) {
        if (typeof sql?.end === "function") {
          closers.push(sql.end({ timeout: 5 }).catch(() => {}));
        }
      }
      pools.clear();
      await Promise.all(closers);
    },

    size() {
      return pools.size;
    }
  };
}
