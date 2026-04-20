import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { VehicleService } from "../services/vehicleService.js";
import { VehicleLookupDescriptor, VehicleType } from "../types/domain.js";

function normalizeModelToken(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\+/g, " ")
    .replace(/[\s-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
  return normalized.length > 0 ? normalized : null;
}

function readLookupDescriptor(query: Request["query"]): VehicleLookupDescriptor | null {
  const year = Number(query.year);
  const make = typeof query.make === "string" ? query.make.trim() : "";
  const model = typeof query.model === "string" ? query.model.trim() : "";
  if (!Number.isFinite(year) || !make || !model) {
    return null;
  }

  return {
    year,
    make,
    model,
    trim: typeof query.trim === "string" && query.trim.trim().length > 0 ? query.trim.trim() : null,
    vehicleType:
      typeof query.vehicleType === "string" && query.vehicleType.trim().length > 0
        ? (query.vehicleType.trim().toLowerCase() as VehicleType)
        : null,
    bodyStyle: typeof query.bodyStyle === "string" && query.bodyStyle.trim().length > 0 ? query.bodyStyle.trim() : null,
    normalizedModel: normalizeModelToken(query.normalizedModel ?? query.model),
  };
}

export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  search = async (req: Request, res: Response) => {
    const result = await this.vehicleService.searchVehicles({
      year: req.query.year as string | undefined,
      make: req.query.make as string | undefined,
      model: req.query.model as string | undefined,
    });
    return sendSuccess(res, result, { count: result.length });
  };

  getSpecs = async (req: Request, res: Response) => {
    logger.info(
      {
        label: "SPECS_API_REQUEST_RECEIVED",
        requestId: res.locals.requestId,
        vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
        parsedDescriptor: readLookupDescriptor(req.query),
      },
      "SPECS_API_REQUEST_RECEIVED",
    );
    const result = await this.vehicleService.getSpecs({
      vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
      descriptor: readLookupDescriptor(req.query),
      requestId: res.locals.requestId,
    });
    return sendSuccess(res, result.data, { source: result.source, fetchedAt: result.fetchedAt, expiresAt: result.expiresAt });
  };

  getValue = async (req: Request, res: Response) => {
    try {
      const descriptor = readLookupDescriptor(req.query);
      const normalizedCondition =
        typeof req.query.condition === "string"
          ? req.query.condition.trim().toLowerCase().replace(/[\s-]+/g, "_")
          : req.query.condition;
      logger.info(
        {
          label: "VALUE_API_REQUEST_RECEIVED",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          zip: req.query.zip ?? null,
          mileage: req.query.mileage ?? null,
          condition: req.query.condition ?? null,
          oldDisplayedValue: null,
        },
        "VALUE_API_REQUEST_RECEIVED",
      );
      logger.info(
        {
          label: "VALUE_API_INPUTS",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          parsedDescriptor: descriptor,
          parsedCondition: normalizedCondition ?? null,
          zip: req.query.zip ?? null,
          mileage: req.query.mileage ?? null,
        },
        "VALUE_API_INPUTS",
      );
      logger.info(
        {
          label: "VALUE_RECALC_REQUEST_RECEIVED",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          zip: req.query.zip ?? null,
          mileage: req.query.mileage ?? null,
          condition: req.query.condition ?? null,
          oldDisplayedValue: null,
        },
        "VALUE_RECALC_REQUEST_RECEIVED",
      );
      const result = await this.vehicleService.getValue({
        requestId: res.locals.requestId,
        vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
        descriptor,
        zip: req.query.zip as string,
        mileage: Number(req.query.mileage),
        condition: normalizedCondition as string,
      });
      return sendSuccess(res, result.data, { source: result.source, fetchedAt: result.fetchedAt, expiresAt: result.expiresAt });
    } catch (error) {
      logger.error(
        {
          label: "VALUE_LOOKUP_FAILURE",
          requestId: res.locals.requestId,
          vehicleId: req.query.vehicleId as string,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          bodyStyle: req.query.bodyStyle ?? null,
          message: error instanceof Error ? error.message : "Unknown valuation controller error",
          stack: error instanceof Error ? error.stack : undefined,
          code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
          details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
          hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
        },
        "VALUE_LOOKUP_FAILURE",
      );
      throw error;
    }
  };

  getListings = async (req: Request, res: Response) => {
    try {
      const descriptor = readLookupDescriptor(req.query);
      logger.info(
        {
          label: "FORSALE_PIPELINE_START",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          zip: req.query.zip ?? null,
          radiusMiles: req.query.radiusMiles ?? null,
        },
        "FORSALE_PIPELINE_START",
      );
      logger.info(
        {
          label: "LISTINGS_PIPELINE_START",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          zip: req.query.zip ?? null,
          radiusMiles: req.query.radiusMiles ?? null,
        },
        "LISTINGS_PIPELINE_START",
      );
      logger.info(
        {
          label: "LISTINGS_API_INPUTS",
          requestId: res.locals.requestId,
          vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
          parsedDescriptor: descriptor,
          zip: req.query.zip ?? null,
          radiusMiles: req.query.radiusMiles ?? null,
        },
        "LISTINGS_API_INPUTS",
      );
      const result = await this.vehicleService.getListings({
        requestId: res.locals.requestId,
        vehicleId: typeof req.query.vehicleId === "string" ? req.query.vehicleId : null,
        descriptor,
        zip: req.query.zip as string,
        radiusMiles: Number(req.query.radiusMiles),
      });
      return sendSuccess(res, result.data, {
        count: result.data.length,
        source: result.source,
        fetchedAt: result.fetchedAt,
        expiresAt: result.expiresAt,
        ...(result.meta ?? {}),
      });
    } catch (error) {
      logger.error(
        {
          label: "LISTINGS_LOOKUP_FAILURE",
          requestId: res.locals.requestId,
          vehicleId: req.query.vehicleId as string,
          year: req.query.year ?? null,
          make: req.query.make ?? null,
          model: req.query.model ?? null,
          trim: req.query.trim ?? null,
          bodyStyle: req.query.bodyStyle ?? null,
          message: error instanceof Error ? error.message : "Unknown listings controller error",
          stack: error instanceof Error ? error.stack : undefined,
          code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
          details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
          hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
        },
        "LISTINGS_LOOKUP_FAILURE",
      );
      throw error;
    }
  };
}
