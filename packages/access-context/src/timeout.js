import { AccessContextError } from "./access-context-error.js";

export const DEFAULT_ACCESS_CONTEXT_TIMEOUT_MS = 3000;

export function resolveAccessContextTimeoutMs(timeoutMs = null) {
  const raw = timeoutMs ?? process.env.ACCESS_CONTEXT_TIMEOUT_MS ?? DEFAULT_ACCESS_CONTEXT_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ACCESS_CONTEXT_TIMEOUT_MS;
}

export async function withAccessContextTimeout(promise, options = {}) {
  const timeoutMs = resolveAccessContextTimeoutMs(options.timeoutMs);
  const code = options.code ?? "ERROR_ACCESS_CONTEXT_TIMEOUT";
  const message = options.message ?? `Access context lookup timed out after ${timeoutMs}ms`;

  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new AccessContextError(code, message, { httpStatus: 503 }));
    }, timeoutMs);
    timeoutHandle.unref?.();
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
