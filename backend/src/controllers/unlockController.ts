import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { UnlockService } from "../services/unlockService.js";
import { VehicleLookupDescriptor, VehicleLookupVehicleType } from "../types/domain.js";

function readLookupDescriptor(body: Request["body"]): VehicleLookupDescriptor | null {
  const year = Number(body.year);
  const make = typeof body.make === "string" ? body.make.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!Number.isFinite(year) || !make || !model) {
    return null;
  }

  const normalizedModel =
    typeof body.normalizedModel === "string" && body.normalizedModel.trim().length > 0
      ? body.normalizedModel.trim().toLowerCase()
      : null;

  return {
    year,
    make,
    model,
    trim: typeof body.trim === "string" && body.trim.trim().length > 0 ? body.trim.trim() : null,
    vehicleType:
      typeof body.vehicleType === "string" && body.vehicleType.trim().length > 0
        ? (body.vehicleType.trim().toLowerCase() as VehicleLookupVehicleType)
        : null,
    bodyStyle: typeof body.bodyStyle === "string" && body.bodyStyle.trim().length > 0 ? body.bodyStyle.trim() : null,
    normalizedModel,
  };
}

export class UnlockController {
  constructor(private readonly unlockService: UnlockService) {}

  status = async (req: Request, res: Response) => {
    const status = await this.unlockService.getStatus(req.auth!.userId);
    return sendSuccess(res, status);
  };

  useUnlock = async (req: Request, res: Response) => {
    const { vehicleId, scanId } = req.body as { vehicleId?: string; scanId?: string | null };
    const descriptor = readLookupDescriptor(req.body);
    logger.info(
      {
        label: "UNLOCK_REQUEST_RECEIVED",
        authUserPresent: Boolean(req.auth?.userId),
        userId: req.auth!.userId,
        hasVehicleId: Boolean(vehicleId),
        hasDescriptor: Boolean(descriptor),
        descriptorYear: descriptor?.year ?? null,
        descriptorMake: descriptor?.make ?? null,
        descriptorModel: descriptor?.model ?? null,
        descriptorHasTrim: Boolean(descriptor?.trim),
        descriptorVehicleType: descriptor?.vehicleType ?? null,
        scanId: scanId ?? null,
      },
      "UNLOCK_REQUEST_RECEIVED",
    );
    const entitlement = await this.unlockService.grantUnlockForLookup({
      userId: req.auth!.userId,
      vehicleId: vehicleId ?? null,
      descriptor,
      scanId,
    });
    const status = await this.unlockService.getStatus(req.auth!.userId);
    return sendSuccess(res, {
      entitlement,
      status,
    });
  };
}
