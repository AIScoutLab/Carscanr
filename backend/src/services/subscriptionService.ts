import crypto from "node:crypto";
import { normalizePlan } from "../lib/subscription.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { SubscriptionRecord, UserPlan } from "../types/domain.js";

export class SubscriptionService {
  private isUnlockPackProduct(productId: string) {
    const normalized = productId.toLowerCase();
    return normalized.includes("unlock");
  }

  async getActivePlan(userId: string): Promise<UserPlan> {
    return normalizePlan((await repositories.subscriptions.findActiveByUser(userId))?.plan ?? "free");
  }

  private resolvePlanFromProductId(productId: string, receiptData: string): UserPlan {
    const normalizedProductId = productId.toLowerCase();
    const normalizedReceipt = receiptData.toLowerCase();

    if (normalizedProductId.includes("year") || normalizedProductId.includes("annual") || normalizedReceipt.includes("year")) {
      return "pro_yearly";
    }

    if (normalizedProductId.includes("month") || normalizedReceipt.includes("pro")) {
      return "pro_monthly";
    }

    return "free";
  }

  async verifySubscription(input: {
    userId: string;
    platform: "ios";
    receiptData: string;
    productId: string;
  }): Promise<SubscriptionRecord> {
    if (this.isUnlockPackProduct(input.productId)) {
      const balance = await repositories.unlockBalances.getOrCreate(input.userId);
      await repositories.unlockBalances.update({
        ...balance,
        unlockCredits: balance.unlockCredits + 5,
        updatedAt: new Date().toISOString(),
      });
      return (
        (await repositories.subscriptions.findActiveByUser(input.userId)) ?? {
          id: crypto.randomUUID(),
          userId: input.userId,
          plan: "free",
          status: "active",
          productId: input.productId,
          expiresAt: undefined,
          verifiedAt: new Date().toISOString(),
        }
      );
    }

    const status = this.resolvePlanFromProductId(input.productId, input.receiptData);
    const record: SubscriptionRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      plan: normalizePlan(status),
      status: "active",
      productId: input.productId,
      expiresAt:
        status === "pro_yearly"
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
          : status === "pro_monthly"
            ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            : undefined,
      verifiedAt: new Date().toISOString(),
    };
    return repositories.subscriptions.replaceActiveForUser(record);
  }

  async cancelSubscription(userId: string): Promise<SubscriptionRecord> {
    const record: SubscriptionRecord = {
      id: crypto.randomUUID(),
      userId,
      plan: "free",
      status: "active",
      productId: undefined,
      expiresAt: undefined,
      verifiedAt: new Date().toISOString(),
    };
    return repositories.subscriptions.replaceActiveForUser(record);
  }
}
