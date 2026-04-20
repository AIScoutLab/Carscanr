import { Request, Response } from "express";
import { AppError } from "../errors/appError.js";
import { sendSuccess } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { ScanService } from "../services/scanService.js";
import { AuthContext } from "../types/domain.js";

function buildGuestFallbackAuth(req: Request): AuthContext {
  const guestIdHeader = req.header("x-carscanr-guest-id")?.trim().toLowerCase();
  const safeGuestId = guestIdHeader && /^[a-z0-9_-]{8,64}$/.test(guestIdHeader) ? guestIdHeader : "controller-fallback";
  return {
    userId: `guest:${safeGuestId}`,
    plan: "free",
    isGuest: true,
  };
}

export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  identify = async (req: Request, res: Response) => {
    logger.error(
      {
        requestId: res.locals.requestId,
        hasFile: Boolean(req.file),
        authUserId: req.auth?.userId ?? null,
      },
      "IDENTIFY_HANDLER_ENTERED",
    );
    try {
      const auth = req.auth ?? buildGuestFallbackAuth(req);

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          error: {
            code: "IMAGE_REQUIRED",
            message: "Image upload is required under field name \"image\".",
          },
          requestId: res.locals.requestId,
        });
      }

      const { scan, visionProvider, entitlement, payloadPreview } = await this.scanService.identifyVehicle({
        auth,
        imageBuffer: file.buffer,
        mimeType: file.mimetype,
        imageUrl: `memory://${file.originalname}`,
        allowPremium: false,
      });

      return sendSuccess(res, scan, {
        provider: visionProvider,
        topCandidateVehicleId: scan.candidates[0]?.vehicleId ?? null,
        premium: entitlement ?? null,
        identificationConfidence: payloadPreview.identificationConfidence,
        dataConfidence: payloadPreview.dataConfidence,
        payloadStrength: payloadPreview.payloadStrength,
        enrichmentMode: payloadPreview.enrichmentMode,
        unlockEligible: payloadPreview.unlockEligible,
        unlockRecommendationReason: payloadPreview.unlockRecommendationReason,
        scanRuntimeVersion: "ocr-visual-fallback-enforce-v3",
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Unknown identify controller error.");
      const appError = err instanceof AppError ? err : null;
      logger.error(
        {
          label: "IDENTIFY_CONTROLLER_ERROR",
          requestId: res.locals.requestId,
          message: error.message,
          stack: error.stack,
          code: appError?.code,
          details: appError?.details,
          hint:
            appError?.details && typeof appError.details === "object" && "hint" in appError.details
              ? (appError.details as { hint?: unknown }).hint
              : undefined,
        },
        "IDENTIFY_CONTROLLER_ERROR",
      );
      throw err;
    }
  };

  premium = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        error: {
          code: "IMAGE_REQUIRED",
          message: "Image upload is required under field name \"image\".",
        },
        requestId: res.locals.requestId,
      });
    }

    const { scan, visionProvider, entitlement, payloadPreview } = await this.scanService.identifyVehicle({
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
      identificationConfidence: payloadPreview.identificationConfidence,
      dataConfidence: payloadPreview.dataConfidence,
      payloadStrength: payloadPreview.payloadStrength,
      enrichmentMode: payloadPreview.enrichmentMode,
      unlockEligible: payloadPreview.unlockEligible,
      unlockRecommendationReason: payloadPreview.unlockRecommendationReason,
      scanRuntimeVersion: "ocr-visual-fallback-enforce-v3",
    });
  };
}
