export class AppError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function errorDetails(error: unknown): unknown {
  if (error instanceof AppError) {
    return error.details;
  }
  if (error instanceof Error) {
    return { name: error.name, stack: error.stack };
  }
  return error;
}

export function asAppError(error: unknown, fallbackCode = "INTERNAL_ERROR"): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError(fallbackCode, errorMessage(error), errorDetails(error));
}
