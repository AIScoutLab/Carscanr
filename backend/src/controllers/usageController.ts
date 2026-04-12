import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { UsageService } from "../services/usageService.js";
import { AuthContext } from "../types/domain.js";

function buildGuestFallbackAuth(req: Request): AuthContext {
  const guestIdHeader = req.header("x-carscanr-guest-id")?.trim().toLowerCase();
  const safeGuestId = guestIdHeader && /^[a-z0-9_-]{8,64}$/.test(guestIdHeader) ? guestIdHeader : "usage-fallback";
  return {
    userId: `guest:${safeGuestId}`,
    plan: "free",
    isGuest: true,
  };
}

export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  getToday = async (req: Request, res: Response) => {
    const result = await this.usageService.getTodayUsage(req.auth ?? buildGuestFallbackAuth(req));
    return sendSuccess(res, result);
  };
}
