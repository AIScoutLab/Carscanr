import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import { enableMockRepositories, isSupabaseNetworkError, isUsingMockRepositories, repositories } from "../lib/repositoryRegistry.js";
import { AuthContext, UsageCounterRecord } from "../types/domain.js";
import { SubscriptionService } from "./subscriptionService.js";
import { UnlockService } from "./unlockService.js";

const LIFETIME_USAGE_DATE = "1970-01-01";
const LEGACY_SCAN_COUNTER_LABEL = 5;

export class UsageService {
  constructor(
    private readonly subscriptionService = new SubscriptionService(),
    private readonly unlockService = new UnlockService(),
  ) {}

  async canScan(userId: string) {
    await this.getUsageSummary(userId);
    return true;
  }

  async getUsageSummary(userId: string): Promise<{
    userId: string;
    plan: "free" | "pro";
    isPro: boolean;
    scansUsed: number;
    scansRemaining: number | null;
    limitType: "lifetime";
    limit: number | null;
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
      if (userId.startsWith("guest:")) {
        const record = await this.ensureLifetimeRecord(userId);
        const scansUsed = record.totalScans;
        return {
          userId,
          plan: "free",
          isPro: false,
          scansUsed,
          scansRemaining: null,
          limitType: "lifetime" as const,
          limit: null,
          scansUsedToday: scansUsed,
          dailyScanLimit: null,
          scansRemainingToday: null,
          abuseWindowLimit: env.ABUSE_MAX_SCAN_ATTEMPTS_PER_10_MIN,
          freeUnlocksTotal: 5,
          freeUnlocksUsed: 0,
          freeUnlocksRemaining: 5,
          unlockedVehicleCount: 0,
          unlockedVehicleIds: [],
        };
      }

      const plan = await this.subscriptionService.getActivePlan(userId);
      const record = await this.ensureLifetimeRecord(userId);
      const unlockStatus = await this.unlockService.getStatus(userId);
      const scansUsed = plan === "pro" ? record.totalScans : record.totalScans;
      return {
        userId,
        plan,
        isPro: plan === "pro",
        scansUsed,
        scansRemaining: null,
        limitType: "lifetime" as const,
        limit: null,
        scansUsedToday: scansUsed,
        dailyScanLimit: null,
        scansRemainingToday: null,
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
      console.error("SCAN_BLOCKED_REASON", {
        userId: auth.userId,
        reason: "ABUSE_GUARD_TRIGGERED",
        recentAttempts: recentAttempts.length,
        abuseWindowLimit: summary.abuseWindowLimit,
      });
      throw new AppError(
        429,
        "ABUSE_GUARD_TRIGGERED",
        "Too many scan attempts in a short window. Please wait a few minutes and try again.",
      );
    }

    record.recentAttemptTimestamps = [...recentAttempts, new Date().toISOString()];
    await repositories.usageCounters.upsertLifetime(record);

    console.error("SCAN_ALLOWED_BASIC_RESULT", {
      userId: auth.userId,
      plan: summary.plan,
      scansUsed: summary.scansUsed,
      freeUnlocksUsed: summary.freeUnlocksUsed,
      freeUnlocksRemaining: summary.freeUnlocksRemaining,
      legacyCounterLabel: LEGACY_SCAN_COUNTER_LABEL,
    });

    return summary;
  }

  async incrementScanUsage(userId: string) {
    const record = await this.ensureLifetimeRecord(userId);
    if (userId.startsWith("guest:")) {
      record.totalScans += 1;
    } else {
      const plan = await this.subscriptionService.getActivePlan(userId);
      if (plan === "free") {
        record.totalScans += 1;
      }
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
