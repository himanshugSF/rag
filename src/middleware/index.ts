import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { logger } from "../logger.js";

/** Throw from a handler to send a specific status and error code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Terminal error handler. MUST take four arguments or Express ignores it. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let status = 500;
  let code = "internal_error";
  let message = "Internal server error";
  let details: unknown;

  if (err instanceof HttpError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof multer.MulterError) {
    status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    code = err.code.toLowerCase();
    message = err.message;
  }

  if (status >= 500) logger.error({ err }, "unhandled request error");
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
