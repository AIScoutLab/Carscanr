import { AppError } from "../errors/appError.js";

export function extractBearerToken(authorizationHeader?: string | null) {
  if (!authorizationHeader) return null;

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AppError(401, "INVALID_AUTH_HEADER", "Authorization header must use Bearer token format.");
  }

  return token.trim();
}
