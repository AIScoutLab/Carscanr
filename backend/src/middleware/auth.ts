import { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { extractBearerToken } from "../lib/auth.js";
import { sendError } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { AuthContext } from "../types/domain.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.header("authorization");
    const token = extractBearerToken(authHeader);
    const allowDevBypass = env.APP_ENV === "local" && env.AUTH_DEV_BYPASS_ENABLED;
    if (env.APP_ENV === "local") {
      const prefix = token ? token.split(":").slice(0, 2).join(":") : "none";
      logger.debug({ hasAuthorizationHeader: Boolean(authHeader), tokenPrefix: prefix }, "Auth middleware request");
    }

    if (allowDevBypass && token?.startsWith("dev-session:")) {
      const [, rawUserId, rawEmail] = token.split(":");
      const email = decodeURIComponent((rawEmail ?? "").trim()).toLowerCase();
      req.auth = {
        userId: rawUserId?.trim(),
        email,
        plan: "free",
      };
      if (!req.auth.userId || !req.auth.email) {
        return sendError(res, 401, "INVALID_TOKEN", "Dev session token is invalid.");
      }
      return next();
    }

    if (allowDevBypass && token?.startsWith("dev-user:")) {
      const email = token.slice("dev-user:".length).trim().toLowerCase();
      const safeUserId = `dev-${email.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user"}`;
      req.auth = {
        userId: safeUserId,
        email,
        plan: "free",
      };
      if (!req.auth.email) {
        return sendError(res, 401, "INVALID_TOKEN", "Dev user token is invalid.");
      }
      return next();
    }

    if (!token) {
      return sendError(res, 401, "AUTH_REQUIRED", "Bearer token is required.");
    }

    if (!supabaseAdmin) {
      return sendError(res, 500, "SUPABASE_NOT_CONFIGURED", "Supabase auth verification is not configured on the server.");
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      return sendError(res, 401, "INVALID_TOKEN", "Supabase token is invalid or expired.", error ?? undefined);
    }

    req.auth = {
      userId: data.user.id,
      email: data.user.email ?? undefined,
      plan: "free",
    };
    return next();
  } catch (error) {
    return sendError(res, 401, "AUTH_ERROR", error instanceof Error ? error.message : "Authentication failed.");
  }
}
