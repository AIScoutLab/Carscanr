import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { UnlockService } from "../services/unlockService.js";

export class UnlockController {
  constructor(private readonly unlockService: UnlockService) {}

  status = async (req: Request, res: Response) => {
    const status = await this.unlockService.getStatus(req.auth!.userId);
    return sendSuccess(res, status);
  };

  useUnlock = async (req: Request, res: Response) => {
    const { vehicleId, scanId } = req.body as { vehicleId: string; scanId?: string | null };
    const entitlement = await this.unlockService.grantUnlockByVehicleId({
      userId: req.auth!.userId,
      vehicleId,
      scanId,
    });
    const status = await this.unlockService.getStatus(req.auth!.userId);
    return sendSuccess(res, {
      entitlement,
      status,
    });
  };
}
