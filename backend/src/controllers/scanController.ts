import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { ScanService } from "../services/scanService.js";

export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  identify = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        error: {
          code: "IMAGE_REQUIRED",
          message: "Image upload is required under field name `image`.",
        },
        requestId: res.locals.requestId,
      });
    }

    const { scan, visionProvider, entitlement } = await this.scanService.identifyVehicle({
      auth: req.auth!,
      imageBuffer: file.buffer,
      mimeType: file.mimetype,
      imageUrl: `memory://${file.originalname}`,
      allowPremium: false,
    });

    return sendSuccess(res, scan, {
      provider: visionProvider,
      topCandidateVehicleId: scan.candidates[0]?.vehicleId ?? null,
      premium: entitlement ?? null,
    });
  };

  premium = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        error: {
          code: "IMAGE_REQUIRED",
          message: "Image upload is required under field name `image`.",
        },
        requestId: res.locals.requestId,
      });
    }

    const { scan, visionProvider, entitlement } = await this.scanService.identifyVehicle({
      auth: req.auth!,
      imageBuffer: file.buffer,
      mimeType: file.mimetype,
      imageUrl: `memory://${file.originalname}`,
      allowPremium: true,
    });

    return sendSuccess(res, scan, {
      provider: visionProvider,
      topCandidateVehicleId: scan.candidates[0]?.vehicleId ?? null,
      premium: entitlement ?? null,
    });
  };
}
