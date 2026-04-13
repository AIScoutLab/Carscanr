import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { VehicleService } from "../services/vehicleService.js";

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
    const result = await this.vehicleService.getSpecs(req.query.vehicleId as string);
    return sendSuccess(res, result.data, { source: result.source, fetchedAt: result.fetchedAt, expiresAt: result.expiresAt });
  };

  getValue = async (req: Request, res: Response) => {
    try {
      const result = await this.vehicleService.getValue({
        requestId: res.locals.requestId,
        vehicleId: req.query.vehicleId as string,
        zip: req.query.zip as string,
        mileage: Number(req.query.mileage),
        condition: req.query.condition as string,
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
      const result = await this.vehicleService.getListings({
        requestId: res.locals.requestId,
        vehicleId: req.query.vehicleId as string,
        zip: req.query.zip as string,
        radiusMiles: Number(req.query.radiusMiles),
      });
      return sendSuccess(res, result.data, {
        count: result.data.length,
        source: result.source,
        fetchedAt: result.fetchedAt,
        expiresAt: result.expiresAt,
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
