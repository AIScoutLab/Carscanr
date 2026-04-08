import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { UsageService } from "../services/usageService.js";

export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  getToday = async (req: Request, res: Response) => {
    const result = await this.usageService.getTodayUsage(req.auth!);
    return sendSuccess(res, result);
  };
}
