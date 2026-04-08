import { Request, Response } from "express";
import { sendSuccess } from "../lib/http.js";
import { SubscriptionService } from "../services/subscriptionService.js";

export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  verify = async (req: Request, res: Response) => {
    const result = await this.subscriptionService.verifySubscription({
      userId: req.auth!.userId,
      platform: req.body.platform,
      receiptData: req.body.receiptData,
      productId: req.body.productId,
    });
    req.auth!.plan = result.plan;
    return sendSuccess(res, result);
  };

  cancel = async (req: Request, res: Response) => {
    const result = await this.subscriptionService.cancelSubscription(req.auth!.userId);
    req.auth!.plan = result.plan;
    return sendSuccess(res, result);
  };
}
