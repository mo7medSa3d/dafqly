/** Uniform API error shape: { error: { code, message, details } } (BUILD_PLAN F0). */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function toApiErrorBody(err: unknown): ApiErrorBody {
  if (err instanceof AppError) {
    return { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } };
  }
  // Unknown errors never leak internals (connection strings, passwords, SQL).
  return { error: { code: "INTERNAL", message: "Internal error" } };
}
