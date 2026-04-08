import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
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
    const result = await this.vehicleService.getValue({
      vehicleId: req.query.vehicleId as string,
      zip: req.query.zip as string,
      mileage: Number(req.query.mileage),
      condition: req.query.condition as string,
    });
    return sendSuccess(res, result.data, { source: result.source, fetchedAt: result.fetchedAt, expiresAt: result.expiresAt });
  };

  getListings = async (req: Request, res: Response) => {
    const result = await this.vehicleService.getListings({
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
  };
}
