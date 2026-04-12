import { NextFunction, Request, Response } from "express";
import multer from "multer";
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

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "IMAGE_TOO_LARGE", "The uploaded image is too large. Try a smaller photo or crop it first.");
    }
    return sendError(res, 400, "UPLOAD_ERROR", err.message);
  }

  if (err instanceof Error) {
    return sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message);
  }

  return sendError(res, 500, "INTERNAL_SERVER_ERROR", "Unknown server error.");
}
