export class AppError extends Error {
  constructor(message, code = "APP_ERROR", status = 500, details = undefined) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeError(error) {
  if (error instanceof AppError) return error;

  const message = error?.message || "Unexpected error occurred";
  return new AppError(message, "INTERNAL_ERROR", 500);
}

export function errorResponse(error) {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details
    }
  };
}

export function okResponse(data) {
  return {
    ok: true,
    data
  };
}
