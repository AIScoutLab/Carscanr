import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { sendError } from "../lib/http.js";

type Source = "body" | "query" | "params";

export function validate(schema: ZodSchema, source: Source) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Request validation failed.", result.error.flatten());
    }
    req[source] = result.data;
    next();
  };
}
