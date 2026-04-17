import { AccessContextError, toAccessContextError } from "./access-context-error.js";
import { withAccessContextTimeout } from "./timeout.js";

export const DEFAULT_ACCESS_CONTEXT_RETRY_COUNT = 1;
export const DEFAULT_ACCESS_CONTEXT_RETRY_DELAY_MS = 150;
export const DEFAULT_ACCESS_CONTEXT_BREAKER_THRESHOLD = 3;
export const DEFAULT_ACCESS_CONTEXT_BREAKER_COOLDOWN_MS = 30000;

const circuitBreakers = new Map();

function resolvePositiveNumber(rawValue, fallback) {
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolveRetryCount(options = {}) {
  return resolvePositiveNumber(
    options.retryCount ?? process.env.ACCESS_CONTEXT_RETRY_COUNT ?? DEFAULT_ACCESS_CONTEXT_RETRY_COUNT,
    DEFAULT_ACCESS_CONTEXT_RETRY_COUNT
  );
}

function resolveRetryDelayMs(options = {}) {
  return resolvePositiveNumber(
    options.retryDelayMs ?? process.env.ACCESS_CONTEXT_RETRY_DELAY_MS ?? DEFAULT_ACCESS_CONTEXT_RETRY_DELAY_MS,
    DEFAULT_ACCESS_CONTEXT_RETRY_DELAY_MS
  );
}

function resolveBreakerThreshold(options = {}) {
  return resolvePositiveNumber(
    options.breakerThreshold ?? process.env.ACCESS_CONTEXT_BREAKER_THRESHOLD ?? DEFAULT_ACCESS_CONTEXT_BREAKER_THRESHOLD,
    DEFAULT_ACCESS_CONTEXT_BREAKER_THRESHOLD
  );
}

function resolveBreakerCooldownMs(options = {}) {
  return resolvePositiveNumber(
    options.breakerCooldownMs ?? process.env.ACCESS_CONTEXT_BREAKER_COOLDOWN_MS ?? DEFAULT_ACCESS_CONTEXT_BREAKER_COOLDOWN_MS,
    DEFAULT_ACCESS_CONTEXT_BREAKER_COOLDOWN_MS
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms);
    handle.unref?.();
  });
}

function nextRetryDelayMs(baseDelayMs, attempt) {
  const boundedAttempt = Math.max(0, attempt - 1);
  const exponentialDelay = Math.min(baseDelayMs * (2 ** boundedAttempt), 4000);
  const jitter = Math.round(exponentialDelay * 0.2 * Math.random());
  return exponentialDelay + jitter;
}

function getCircuitBreaker(key) {
  if (!circuitBreakers.has(key)) {
    circuitBreakers.set(key, {
      consecutiveFailures: 0,
      openUntil: 0
    });
  }
  return circuitBreakers.get(key);
}

function createBackendUnavailableError({ operationName, retryAfterMs }) {
  const retryAfter = Math.max(0, retryAfterMs);
  return new AccessContextError(
    "ERROR_ACCESS_CONTEXT_BACKEND_UNAVAILABLE",
    `${operationName} is temporarily unavailable after repeated transient failures`,
    {
      httpStatus: 503,
      details: {
        operation: operationName,
        retry_after_ms: retryAfter
      }
    }
  );
}

function isTransientDatabaseError(error) {
  if (!error) return false;

  if (error instanceof AccessContextError) {
    return error.code === "ERROR_ACCESS_CONTEXT_TIMEOUT"
      || error.code === "ERROR_ACCESS_CONTEXT_BACKEND_UNAVAILABLE";
  }

  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ENETUNREACH",
    "08001",
    "08006",
    "57P01",
    "57P02",
    "53300"
  ].includes(code) || /terminating connection|connection terminated|timeout|timed out|connection reset|too many clients/i.test(message);
}

function normalizeResilienceError(error, operationName) {
  const normalized = error instanceof AccessContextError ? error : toAccessContextError(error);
  if (normalized.details?.operation) return normalized;
  return new AccessContextError(normalized.code, normalized.message, {
    httpStatus: normalized.httpStatus,
    details: {
      ...(normalized.details ?? {}),
      operation: operationName
    }
  });
}

export function resetAccessContextCircuitBreaker(key = null) {
  if (key === null) {
    circuitBreakers.clear();
    return;
  }
  circuitBreakers.delete(key);
}

export async function withAccessContextResilience(operation, options = {}) {
  const operationName = options.operationName ?? "management auth backend";
  const breakerKey = options.breakerKey ?? "management-auth";
  const retryCount = resolveRetryCount(options);
  const retryDelayMs = resolveRetryDelayMs(options);
  const breakerThreshold = resolveBreakerThreshold(options);
  const breakerCooldownMs = resolveBreakerCooldownMs(options);
  const breaker = getCircuitBreaker(breakerKey);

  if (breaker.openUntil > Date.now()) {
    throw createBackendUnavailableError({
      operationName,
      retryAfterMs: breaker.openUntil - Date.now()
    });
  }

  let lastError = null;
  for (let attempt = 1; attempt <= retryCount + 1; attempt += 1) {
    try {
      const result = await withAccessContextTimeout(
        Promise.resolve().then(() => operation()),
        options
      );
      breaker.consecutiveFailures = 0;
      breaker.openUntil = 0;
      return result;
    } catch (error) {
      lastError = normalizeResilienceError(error, operationName);
      if (!isTransientDatabaseError(lastError)) {
        throw lastError;
      }

      breaker.consecutiveFailures += 1;
      if (breaker.consecutiveFailures >= breakerThreshold) {
        breaker.openUntil = Date.now() + breakerCooldownMs;
        throw createBackendUnavailableError({
          operationName,
          retryAfterMs: breakerCooldownMs
        });
      }

      if (attempt > retryCount) {
        throw lastError;
      }

      await sleep(nextRetryDelayMs(retryDelayMs, attempt));
    }
  }

  throw lastError ?? new AccessContextError(
    "ERROR_ACCESS_CONTEXT_BACKEND_UNAVAILABLE",
    `${operationName} failed without a usable error`,
    { httpStatus: 503 }
  );
}
