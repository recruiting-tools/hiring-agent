export class AccessContextError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "AccessContextError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? 500;
    this.details = options.details ?? null;
  }
}

export function toAccessContextError(error) {
  if (error instanceof AccessContextError) return error;
  return new AccessContextError(
    "ERROR_DATABASE_CONNECTION_UNAVAILABLE",
    error instanceof Error ? error.message : String(error),
    { httpStatus: 503 }
  );
}
