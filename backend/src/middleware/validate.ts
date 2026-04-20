import { NextFunction, Request, Response } from "express";
import { ParsedQs } from "qs";
import { ZodSchema } from "zod";
import { sendError } from "../lib/http.js";
import { logger } from "../lib/logger.js";

type Source = "body" | "query" | "params";

function normalizeVehicleDescriptorQuery(query: Request["query"]) {
  const normalized: ParsedQs = { ...query };
  const normalizeString = (value: ParsedQs[string]): ParsedQs[string] => (typeof value === "string" ? value.trim() : value);
  const normalizeModelToken = (value: ParsedQs[string]): ParsedQs[string] => {
    if (typeof value !== "string") {
      return value;
    }
    const compact = value
      .trim()
      .toLowerCase()
      .replace(/\+/g, " ")
      .replace(/[\s-]+/g, "")
      .replace(/[^a-z0-9]/g, "");
    return compact.length > 0 ? compact : undefined;
  };

  normalized.make = normalizeString(normalized.make);
  normalized.model = normalizeString(normalized.model);
  normalized.trim = normalizeString(normalized.trim);
  normalized.bodyStyle = normalizeString(normalized.bodyStyle);
  normalized.zip = normalizeString(normalized.zip);

  if (typeof normalized.vehicleType === "string") {
    const vehicleType = normalized.vehicleType.trim().toLowerCase();
    normalized.vehicleType = vehicleType.length > 0 ? vehicleType : undefined;
  }

  if (typeof normalized.condition === "string") {
    const condition = normalized.condition
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    normalized.condition = condition.length > 0 ? condition : undefined;
  }

  normalized.normalizedModel = normalizeModelToken(normalized.normalizedModel ?? normalized.model);

  return normalized;
}

function normalizeSourcePayload(req: Request, source: Source) {
  if (source !== "query") {
    return req[source];
  }

  const path = req.path || req.originalUrl;
  if (
    path === "/api/vehicle/specs" ||
    path === "/vehicle/specs" ||
    path === "/api/vehicle/value" ||
    path === "/vehicle/value" ||
    path === "/api/vehicle/listings" ||
    path === "/vehicle/listings" ||
    req.originalUrl.includes("/vehicle/specs") ||
    req.originalUrl.includes("/vehicle/value") ||
    req.originalUrl.includes("/vehicle/listings")
  ) {
    return normalizeVehicleDescriptorQuery(req.query);
  }

  return req[source];
}

export function validate(schema: ZodSchema, source: Source) {
  return (req: Request, res: Response, next: NextFunction) => {
    const normalizedSource = normalizeSourcePayload(req, source);
    const result = schema.safeParse(normalizedSource);
    if (!result.success) {
      const path = req.path || req.originalUrl;
      const fieldErrors = result.error.flatten().fieldErrors;
      const firstRejectedField = Object.entries(fieldErrors).find(([, errors]) => Array.isArray(errors) && errors.length > 0) ?? null;
      const logBadRequest = (label: "SPECS_API_BAD_REQUEST" | "VALUE_API_BAD_REQUEST" | "LISTINGS_API_BAD_REQUEST") =>
        logger.error(
          {
            label,
            requestId: res.locals.requestId,
            parsedQueryPayload: normalizedSource,
            validationFailureReason: firstRejectedField?.[1]?.[0] ?? "Request validation failed.",
            rejectedField: firstRejectedField?.[0] ?? null,
            fieldErrors,
            formErrors: result.error.flatten().formErrors,
          },
          label,
        );

      if (path === "/api/vehicle/specs" || path === "/vehicle/specs" || req.originalUrl.includes("/vehicle/specs")) {
        logBadRequest("SPECS_API_BAD_REQUEST");
      }
      if (path === "/api/vehicle/value" || path === "/vehicle/value" || req.originalUrl.includes("/vehicle/value")) {
        logBadRequest("VALUE_API_BAD_REQUEST");
      }
      if (path === "/api/vehicle/listings" || path === "/vehicle/listings" || req.originalUrl.includes("/vehicle/listings")) {
        logBadRequest("LISTINGS_API_BAD_REQUEST");
      }
      return sendError(res, 400, "VALIDATION_ERROR", "Request validation failed.", result.error.flatten());
    }
    req[source] = result.data;
    next();
  };
}
