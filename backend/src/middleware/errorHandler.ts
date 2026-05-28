import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { AppError } from "../errors/appError.js";
import { sendError } from "../lib/http.js";
import { logger } from "../lib/logger.js";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    logger.warn(
      {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
      },
      "REQUEST_APP_ERROR",
    );
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  if (err instanceof ZodError) {
    logger.warn(
      {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: 400,
        code: "VALIDATION_ERROR",
      },
      "REQUEST_VALIDATION_ERROR",
    );
    return sendError(res, 400, "VALIDATION_ERROR", "Request validation failed.", err.flatten());
  }

  if (err instanceof multer.MulterError) {
    logger.warn(
      {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: err.code === "LIMIT_FILE_SIZE" ? 413 : 400,
        code: err.code,
      },
      "REQUEST_UPLOAD_ERROR",
    );
    if (err.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, "IMAGE_TOO_LARGE", "The uploaded image is too large. Try a smaller photo or crop it first.");
    }
    return sendError(res, 400, "UPLOAD_ERROR", err.message);
  }

  if (err instanceof Error) {
    logger.error(
      {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.originalUrl,
        message: err.message,
      },
      "REQUEST_UNHANDLED_ERROR",
    );
    return sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message);
  }

  logger.error(
    {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.originalUrl,
    },
    "REQUEST_UNKNOWN_ERROR",
  );
  return sendError(res, 500, "INTERNAL_SERVER_ERROR", "Unknown server error.");
}
