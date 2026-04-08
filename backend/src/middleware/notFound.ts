import { Request, Response } from "express";
import { sendError } from "../lib/http.js";

export function notFoundHandler(_req: Request, res: Response) {
  return sendError(res, 404, "NOT_FOUND", "Route not found.");
}
