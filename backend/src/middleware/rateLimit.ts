import { Request, Response, NextFunction } from "express";
import { sendError } from "../lib/http.js";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function getKey(req: Request, prefix: string) {
  const userPart = req.auth?.userId ?? "anon";
  const ipPart = req.ip ?? "unknown";
  return `${prefix}:${userPart}:${ipPart}`;
}

export function rateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = getKey(req, options.keyPrefix);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (bucket.count >= options.max) {
      return sendError(res, 429, "RATE_LIMITED", "Too many requests. Please slow down.");
    }

    bucket.count += 1;
    return next();
  };
}
