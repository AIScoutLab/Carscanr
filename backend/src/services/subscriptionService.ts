import crypto from "node:crypto";
import { repositories } from "../lib/repositoryRegistry.js";
import { SubscriptionRecord } from "../types/domain.js";

export class SubscriptionService {
  async getActivePlan(userId: string): Promise<"free" | "pro"> {
    return (await repositories.subscriptions.findActiveByUser(userId))?.plan ?? "free";
  }

  async verifySubscription(input: {
    userId: string;
    platform: "ios";
    receiptData: string;
    productId: string;
  }): Promise<SubscriptionRecord> {
    const status = input.receiptData.includes("pro") ? "pro" : "free";
    const record: SubscriptionRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      plan: status,
      status: "active",
      productId: input.productId,
      expiresAt: status === "pro" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined,
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
