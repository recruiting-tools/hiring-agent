import { hasFallbackSteps } from "./local-seed-fallback.js";
import { ALWAYS_RUNNABLE_PLAYBOOK_KEYS, FALLBACK_ROUTES } from "./playbook-contracts.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

function canonicalizePlaybookKey(playbookKey) {
  return playbookKey === "candidate_broadcast" ? "mass_broadcast" : playbookKey;
}

const STATIC_FALLBACK_ROUTES = FALLBACK_ROUTES.map((route) => ({
  ...route,
  playbook_key: canonicalizePlaybookKey(route.playbook_key)
}));

const RUSSIAN_SUFFIXES = [
  "ироваться",
  "ирования",
  "ирование",
  "ировала",
  "ировали",
  "ируют",
  "ирует",
  "ировать",
  "аться",
  "яться",
  "ются",
  "ется",
  "утся",
  "ешь",
  "ете",
  "ите",
  "ем",
  "им",
  "ут",
  "ют",
  "ого",
  "его",
  "ому",
  "ему",
  "ыми",
  "ими",
  "овать",
  "ать",
  "ять",
  "еть",
  "ить",
  "ть",
  "ти",
  "ий",
  "ый",
  "ой",
  "ая",
  "яя",
  "ое",
  "ее",
  "ые",
  "ие",
  "ов",
  "ев",
  "ом",
  "ем",
  "ам",
  "ям",
  "ах",
  "ях",
  "ию",
  "ия",
  "ью",
  "ья",
  "а",
  "я",
  "о",
  "е",
  "ы",
  "и",
  "у",
  "ю",
  "ь"
];

let cachedDefinitions = null;
let cachedAt = 0;
let cachePromise = null;

export async function routePlaybook(message, managementSql = null) {
  const normalized = String(message ?? "").trim().toLowerCase();
  if (!managementSql) {
    return matchRoute(normalized, STATIC_FALLBACK_ROUTES);
  }

  const { routes, fromCache } = await getDbRoutes(managementSql);
  const matched = matchRoute(normalized, routes);
  if (matched) return matched;

  if (!fromCache) return null;

  // Cache might be stale after playbook keyword updates; retry once with fresh DB routes.
  const { routes: freshRoutes } = await getDbRoutes(managementSql, { forceRefresh: true });
  return matchRoute(normalized, freshRoutes);
}

async function getDbRoutes(managementSql, options = {}) {
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && cachedDefinitions && (Date.now() - cachedAt) < CACHE_TTL_MS) {
    return {
      fromCache: true,
      routes: cachedDefinitions.map((row) => ({
        playbook_key: row.playbook_key,
        keywords: row.keywords ?? []
      }))
    };
  }

  if (!cachePromise || forceRefresh) {
    const queryPromise = managementSql`
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
      const filtered = rows.filter((row) => (
        ALWAYS_RUNNABLE_PLAYBOOK_KEYS.has(canonicalizePlaybookKey(row.playbook_key))
        || Number(row.step_count ?? 0) > 0
        || hasFallbackSteps(row.playbook_key)
      ));
      cachedDefinitions = filtered.map((row) => ({
        ...row,
        playbook_key: canonicalizePlaybookKey(row.playbook_key)
      }));
      cachedAt = Date.now();
      return cachedDefinitions;
    });

    if (!forceRefresh) {
      cachePromise = queryPromise.finally(() => {
        cachePromise = null;
      });
    }

    const rows = forceRefresh ? await queryPromise : await cachePromise;
    return {
      fromCache: false,
      routes: rows.map((row) => ({
        playbook_key: row.playbook_key,
        keywords: row.keywords ?? []
      }))
    };
  }

  const rows = await cachePromise;
  return {
    fromCache: false,
    routes: rows.map((row) => ({
      playbook_key: row.playbook_key,
      keywords: row.keywords ?? []
    }))
  };
}

function matchRoute(normalizedMessage, routes) {
  const normalizedStemmedMessage = normalizeForKeywordSearch(normalizedMessage);

  for (const route of routes) {
    const keywords = Array.isArray(route?.keywords) ? route.keywords : [];
    const playbookKey = canonicalizePlaybookKey(route?.playbook_key ?? null);
    if (keywords.some((keyword) => matchesKeyword(normalizedMessage, normalizedStemmedMessage, keyword))) {
      return playbookKey;
    }
  }
  return null;
}

function matchesKeyword(normalizedMessage, normalizedStemmedMessage, keyword) {
  const normalizedKeyword = String(keyword ?? "").trim().toLowerCase();
  if (!normalizedKeyword) return false;

  if (normalizedMessage.includes(normalizedKeyword)) {
    return true;
  }

  const normalizedStemmedKeyword = normalizeForKeywordSearch(normalizedKeyword);
  if (!normalizedStemmedKeyword) return false;

  return normalizedStemmedMessage.includes(normalizedStemmedKeyword);
}

function normalizeForKeywordSearch(text) {
  return String(text ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .match(/[a-zа-я0-9]+/g)?.map((token) => stemToken(token)).join(" ") ?? "";
}

function stemToken(token) {
  if (!/[а-я]/.test(token)) return token;

  for (const suffix of RUSSIAN_SUFFIXES) {
    if (!token.endsWith(suffix)) continue;
    const stem = token.slice(0, -suffix.length);
    if (stem.length >= 4) {
      return stem;
    }
  }

  return token;
}
