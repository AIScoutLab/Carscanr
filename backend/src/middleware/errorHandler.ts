import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../errors/appError.js";
import { sendError } from "../lib/http.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    return sendError(res, 400, "VALIDATION_ERROR", "Request validation failed.", err.flatten());
  }

  if (err instanceof Error) {
    return sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message);
  }

  return sendError(res, 500, "INTERNAL_SERVER_ERROR", "Unknown server error.");
}
