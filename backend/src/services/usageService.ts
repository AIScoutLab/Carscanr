import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import { enableMockRepositories, isSupabaseNetworkError, isUsingMockRepositories, repositories } from "../lib/repositoryRegistry.js";
import { AuthContext, UsageCounterRecord } from "../types/domain.js";
import { SubscriptionService } from "./subscriptionService.js";
import { UnlockService } from "./unlockService.js";

const LIFETIME_USAGE_DATE = "1970-01-01";
const FREE_LIFETIME_SCAN_LIMIT = 5;

export class UsageService {
  constructor(
    private readonly subscriptionService = new SubscriptionService(),
    private readonly unlockService = new UnlockService(),
  ) {}

  async canScan(userId: string) {
    const summary = await this.getUsageSummary(userId);
    return summary.isPro || summary.scansUsed < FREE_LIFETIME_SCAN_LIMIT;
  }

  async getUsageSummary(userId: string): Promise<{
    userId: string;
    plan: "free" | "pro";
    isPro: boolean;
    scansUsed: number;
    scansRemaining: number | null;
    limitType: "lifetime";
    limit: number;
    scansUsedToday: number;
    dailyScanLimit: number | null;
    scansRemainingToday: number | null;
    abuseWindowLimit: number;
    freeUnlocksTotal: number;
    freeUnlocksUsed: number;
    freeUnlocksRemaining: number;
    unlockedVehicleCount: number;
    unlockedVehicleIds: string[];
  }> {
    try {
      const plan = await this.subscriptionService.getActivePlan(userId);
      const record = await this.ensureLifetimeRecord(userId);
      const unlockStatus = await this.unlockService.getStatus(userId);
      const scansUsed = plan === "pro" ? record.totalScans : record.totalScans;
      const scansRemaining = plan === "pro" ? null : Math.max(FREE_LIFETIME_SCAN_LIMIT - scansUsed, 0);

      return {
        userId,
        plan,
        isPro: plan === "pro",
        scansUsed,
        scansRemaining,
        limitType: "lifetime" as const,
        limit: FREE_LIFETIME_SCAN_LIMIT,
        scansUsedToday: scansUsed,
        dailyScanLimit: plan === "pro" ? null : FREE_LIFETIME_SCAN_LIMIT,
        scansRemainingToday: scansRemaining,
        abuseWindowLimit: env.ABUSE_MAX_SCAN_ATTEMPTS_PER_10_MIN,
        freeUnlocksTotal: unlockStatus.freeUnlocksTotal,
        freeUnlocksUsed: unlockStatus.freeUnlocksUsed,
        freeUnlocksRemaining: unlockStatus.freeUnlocksRemaining,
        unlockedVehicleCount: unlockStatus.unlockedVehicleIds.length,
        unlockedVehicleIds: unlockStatus.unlockedVehicleIds,
      };
    } catch (error) {
      if (env.ALLOW_MOCK_FALLBACKS && !isUsingMockRepositories() && isSupabaseNetworkError(error)) {
        enableMockRepositories("supabase network failure", error);
        return this.getUsageSummary(userId);
      }
      throw error;
    }
  }

  async getTodayUsage(auth: AuthContext) {
    return this.getUsageSummary(auth.userId);
  }

  async assertScanAllowed(auth: AuthContext) {
    const summary = await this.getUsageSummary(auth.userId);
    const record = await this.ensureLifetimeRecord(auth.userId);
    const now = Date.now();
    const recentAttempts = record.recentAttemptTimestamps.filter(
      (timestamp) => now - new Date(timestamp).getTime() < 10 * 60 * 1000,
    );

    if (recentAttempts.length >= summary.abuseWindowLimit) {
      throw new AppError(
        429,
        "ABUSE_GUARD_TRIGGERED",
        "Too many scan attempts in a short window. Please wait a few minutes and try again.",
      );
    }

    if (!summary.isPro && summary.scansUsed >= FREE_LIFETIME_SCAN_LIMIT) {
      throw new AppError(
        403,
        "SCAN_LIMIT_REACHED",
        "Free scan limit reached",
        summary,
      );
    }

    record.recentAttemptTimestamps = [...recentAttempts, new Date().toISOString()];
    await repositories.usageCounters.upsertLifetime(record);

    return summary;
  }

  async incrementScanUsage(userId: string) {
    const plan = await this.subscriptionService.getActivePlan(userId);
    const record = await this.ensureLifetimeRecord(userId);
    if (plan === "free") {
      record.totalScans += 1;
    }
    record.lastScanAt = new Date().toISOString();
    await repositories.usageCounters.upsertLifetime(record);
  }

  private async ensureLifetimeRecord(userId: string): Promise<UsageCounterRecord> {
    let record = await repositories.usageCounters.findLifetimeByUser(userId);
    if (!record) {
      record = {
        id: crypto.randomUUID(),
        userId,
        date: LIFETIME_USAGE_DATE,
        scanCount: 0,
        totalScans: 0,
        recentAttemptTimestamps: [],
      };
      record = await repositories.usageCounters.upsertLifetime(record);
    }
    return record;
  }
}
