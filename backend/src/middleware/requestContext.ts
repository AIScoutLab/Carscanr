import crypto from "node:crypto";
import { NextFunction, Request, Response } from "express";

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.header("x-request-id") ?? crypto.randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}
