import { NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import { extractBearerToken } from "../lib/auth.js";
import { sendError } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { supabaseAdmin } from "../lib/supabase.js";
import { AuthContext } from "../types/domain.js";

const GUEST_ID_HEADER = "x-carscanr-guest-id";

type TokenClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
};

function normalizeGuestId(value: string | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return /^[a-z0-9_-]{8,64}$/.test(trimmed) ? trimmed : null;
}

function buildFallbackGuestId(req: Request) {
  const source = `${req.ip}|${req.get("user-agent") ?? "unknown-user-agent"}`;
  return `fp_${crypto.createHash("sha256").update(source).digest("hex").slice(0, 24)}`;
}

function buildGuestAuthContext(req: Request) {
  const guestId = normalizeGuestId(req.header(GUEST_ID_HEADER)) ?? buildFallbackGuestId(req);
  return {
    userId: `guest:${guestId}`,
    plan: "free" as const,
    isGuest: true,
  };
}

function decodeTokenClaims(token: string): TokenClaims | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as TokenClaims;
  } catch {
    return null;
  }
}

function classifyTokenVerificationFailure(token: string, error: unknown) {
  const claims = decodeTokenClaims(token);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expectedIssuerPrefix = env.SUPABASE_URL ? `${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1` : null;
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (!claims) {
    return { reason: "malformed-token", claims: null };
  }

  if (typeof claims.exp === "number" && claims.exp <= nowSeconds) {
    return { reason: "expired-token", claims };
  }

  if (expectedIssuerPrefix && claims.iss && !claims.iss.startsWith(expectedIssuerPrefix)) {
    return { reason: "issuer-mismatch", claims };
  }

  if (claims.aud && claims.aud !== "authenticated" && !(Array.isArray(claims.aud) && claims.aud.includes("authenticated"))) {
    return { reason: "audience-mismatch", claims };
  }

  if (message.includes("signature")) {
    return { reason: "signature-mismatch", claims };
  }

  if (message.includes("jwt") || message.includes("token")) {
    return { reason: "token-verification-failed", claims };
  }

  return { reason: "unknown-verification-failure", claims };
}

function buildTokenFailureMessage(reason: string) {
  switch (reason) {
    case "expired-token":
      return "Supabase token is expired.";
    case "issuer-mismatch":
      return "Supabase token issuer does not match the backend Supabase project configuration.";
    case "audience-mismatch":
      return "Supabase token audience is invalid for this backend.";
    case "signature-mismatch":
      return "Supabase token signature does not match the backend Supabase project configuration.";
    case "malformed-token":
      return "Supabase token is malformed.";
    default:
      return "Supabase token verification failed.";
  }
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

async function resolveAuthContext(req: Request, options?: { allowGuestFallbackOnInvalidToken?: boolean }): Promise<AuthContext | null> {
  const allowGuestFallbackOnInvalidToken = options?.allowGuestFallbackOnInvalidToken ?? false;
  const authHeader = req.header("authorization");
  let token: string | null = null;
  try {
    token = extractBearerToken(authHeader);
  } catch (error) {
    logger.warn(
      {
        path: req.originalUrl,
        tokenPresent: Boolean(authHeader),
        verificationStage: "extract-bearer-token",
        reason: "invalid-auth-header",
      },
      "Auth header parsing failed",
    );
    if (allowGuestFallbackOnInvalidToken) {
      return buildGuestAuthContext(req);
    }
    throw error;
  }
  const allowDevBypass = env.APP_ENV === "local" && env.AUTH_DEV_BYPASS_ENABLED;
  if (env.APP_ENV === "local") {
    const prefix = token ? token.split(":").slice(0, 2).join(":") : "none";
    logger.debug({ hasAuthorizationHeader: Boolean(authHeader), tokenPrefix: prefix }, "Auth middleware request");
  }

  if (allowDevBypass && token?.startsWith("dev-session:")) {
    const [, rawUserId, rawEmail] = token.split(":");
    const email = decodeURIComponent((rawEmail ?? "").trim()).toLowerCase();
    const auth = {
      userId: rawUserId?.trim(),
      email,
      plan: "free" as const,
    };
    if (!auth.userId || !auth.email) {
      throw new AppError(401, "INVALID_TOKEN", "Dev session token is invalid.");
    }
    return auth;
  }

  if (allowDevBypass && token?.startsWith("dev-user:")) {
    const email = token.slice("dev-user:".length).trim().toLowerCase();
    const safeUserId = `dev-${email.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user"}`;
    if (!email) {
      throw new AppError(401, "INVALID_TOKEN", "Dev user token is invalid.");
    }
    return {
      userId: safeUserId,
      email,
      plan: "free",
    };
  }

  if (token) {
    if (!supabaseAdmin) {
      logger.error(
        {
          path: req.originalUrl,
          tokenPresent: true,
          verificationStage: "supabase-admin-client",
          reason: "supabase-not-configured",
          supabaseUrl: env.SUPABASE_URL || "unset",
        },
        "Supabase admin client is not configured for token verification",
      );
      if (allowGuestFallbackOnInvalidToken) {
        return buildGuestAuthContext(req);
      }
      throw new AppError(500, "SUPABASE_NOT_CONFIGURED", "Supabase auth verification is not configured on the server.");
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      const classification = classifyTokenVerificationFailure(token, error);
      const failureMessage = buildTokenFailureMessage(classification.reason);
      logger.warn(
        {
          path: req.originalUrl,
          tokenPresent: true,
          verificationStage: "supabase-auth-get-user",
          reason: classification.reason,
          supabaseUrl: env.SUPABASE_URL || "unset",
          tokenIssuer: classification.claims?.iss ?? null,
          tokenAudience: classification.claims?.aud ?? null,
          tokenExpiredAt: classification.claims?.exp ?? null,
          tokenSubject: classification.claims?.sub ?? null,
        },
        "Supabase token verification failed",
      );
      if (allowGuestFallbackOnInvalidToken) {
        return buildGuestAuthContext(req);
      }
      throw new AppError(401, "INVALID_TOKEN", failureMessage, error ?? undefined);
    }

    return {
      userId: data.user.id,
      email: data.user.email ?? undefined,
      plan: "free",
    };
  }

  return buildGuestAuthContext(req);
}

export async function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    req.auth = (await resolveAuthContext(req, { allowGuestFallbackOnInvalidToken: true })) ?? undefined;
    return next();
  } catch (error) {
    return sendError(_res, 401, "AUTH_ERROR", error instanceof Error ? error.message : "Authentication failed.");
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    req.auth = (await resolveAuthContext(req)) ?? undefined;
    if (!req.auth || req.auth.isGuest) {
      return sendError(res, 401, "AUTH_REQUIRED", "Bearer token is required.");
    }
    return next();
  } catch (error) {
    return sendError(res, 401, "AUTH_ERROR", error instanceof Error ? error.message : "Authentication failed.");
  }
}
