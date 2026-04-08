import { Response } from "express";
import { ApiError, ApiSuccess } from "../types/api.js";

export function sendSuccess<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    meta,
    requestId: res.locals.requestId,
  };
  return res.json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const body: ApiError = {
    success: false,
    error: { code, message, details },
    requestId: res.locals.requestId,
  };
  return res.status(statusCode).json(body);
}
