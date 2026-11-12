import { HttpException, HttpStatus } from "@nestjs/common";

/** Errors always use the contract's ApiError shape: { error: { code, message, fields? } }. */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, fields?: Record<string, string>) {
    super({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
  }
}

export const notFound = (what = "resource") => new AppError(HttpStatus.NOT_FOUND, "not_found", `${what} not found`);
export const forbidden = (message = "You do not have permission to do this") => new AppError(HttpStatus.FORBIDDEN, "forbidden", message);
export const unauthorized = (message = "Authentication required") => new AppError(HttpStatus.UNAUTHORIZED, "unauthorized", message);
export const validation = (fields: Record<string, string>, message = "Some fields are invalid") =>
  new AppError(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed", message, fields);
export const conflict = (code: string, message: string, fields?: Record<string, string>) => new AppError(HttpStatus.CONFLICT, code, message, fields);

/** Postgres unique violation, with the constraint name. */
export function uniqueViolation(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = err?.code ? err : err?.cause;
  return pg?.code === "23505" ? (pg.constraint ?? "unique") : null;
}
