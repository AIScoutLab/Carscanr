import { logger } from "../lib/logger.js";
import { ProviderBudgetDecision, ProviderOperation, UserEntitlement } from "../types/domain.js";
import { isPopularVehicleFamily } from "../lib/vehicleFamily.js";

type BudgetInput = {
  provider: string;
  operation: ProviderOperation;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  entitlement?: UserEntitlement | null;
  identificationConfidence?: number | null;
  freshCacheExists: boolean;
  fallbackStrength: "none" | "thin" | "usable" | "strong";
};

type CooldownRecord = {
  expiresAt: number;
  reason: string;
};

const DAILY_SOFT_BUDGET: Record<ProviderOperation, number> = {
  specs: 120,
  value: 160,
  listings: 140,
};

class ProviderBudgetService {
  private readonly providerCounts = new Map<string, { day: string; count: number }>();
  private readonly recentFamilyCalls = new Map<string, number>();
  private readonly cooldowns = new Map<string, CooldownRecord>();

  private currentDay() {
    return new Date().toISOString().slice(0, 10);
  }

  private familyKey(input: BudgetInput) {
    return [input.provider, input.operation, input.year ?? "unknown", input.make ?? "unknown", input.model ?? "unknown"].join(":").toLowerCase();
  }

  evaluate(input: BudgetInput): ProviderBudgetDecision {
    const entitlement = input.entitlement ?? "unlocked";
    const confidence = input.identificationConfidence ?? 0.95;
    const familyKey = this.familyKey(input);
    const cacheFreshnessStatus = input.freshCacheExists ? "fresh" : "stale_or_missing";
    const cooldown = this.cooldowns.get(familyKey);

    let decision: ProviderBudgetDecision = {
      allowed: true,
      reason: "live-provider-allowed",
      fallbackPreferred: false,
    };

    if (input.provider !== "marketcheck") {
      decision = { allowed: true, reason: "non-marketcheck-provider", fallbackPreferred: false };
    } else if (cooldown && cooldown.expiresAt > Date.now()) {
      decision = { allowed: false, reason: cooldown.reason, fallbackPreferred: true };
    } else if (input.freshCacheExists) {
      decision = { allowed: false, reason: "fresh-cache-exists", fallbackPreferred: true };
    } else if (input.fallbackStrength === "strong") {
      decision = { allowed: false, reason: "fallback-strong-enough", fallbackPreferred: true };
    } else if (input.operation === "listings" && input.fallbackStrength === "usable" && isPopularVehicleFamily(input.make, input.model)) {
      decision = { allowed: false, reason: "popular-family-cache-reuse", fallbackPreferred: true };
    } else if (entitlement === "free" && confidence < 0.9) {
      decision = { allowed: false, reason: "low-confidence-free-request", fallbackPreferred: true };
    } else {
      const dailyKey = `${input.provider}:${input.operation}`;
      const existing = this.providerCounts.get(dailyKey);
      const currentDay = this.currentDay();
      const currentCount = existing?.day === currentDay ? existing.count : 0;
      if (currentCount >= DAILY_SOFT_BUDGET[input.operation] && entitlement !== "pro") {
        decision = { allowed: false, reason: "daily-soft-budget-threshold", fallbackPreferred: true };
      } else {
        const recentCallAt = this.recentFamilyCalls.get(familyKey);
        if (recentCallAt && Date.now() - recentCallAt < 30 * 60 * 1000 && entitlement !== "pro") {
          decision = { allowed: false, reason: "recent-family-call", fallbackPreferred: true };
        }
      }
    }

    logger.info(
      {
        label: decision.allowed ? "PROVIDER_BUDGET_GATE_ALLOWED" : "PROVIDER_BUDGET_GATE_BLOCKED",
        provider: input.provider,
        operation: input.operation,
        year: input.year ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        trim: input.trim ?? null,
        reason: decision.reason,
        entitlement,
        confidence,
        cacheFreshnessStatus,
      },
      decision.allowed ? "PROVIDER_BUDGET_GATE_ALLOWED" : "PROVIDER_BUDGET_GATE_BLOCKED",
    );

    return decision;
  }

  recordAllowed(input: BudgetInput) {
    const familyKey = this.familyKey(input);
    this.recentFamilyCalls.set(familyKey, Date.now());
    const dailyKey = `${input.provider}:${input.operation}`;
    const currentDay = this.currentDay();
    const existing = this.providerCounts.get(dailyKey);
    const count = existing?.day === currentDay ? existing.count + 1 : 1;
    this.providerCounts.set(dailyKey, { day: currentDay, count });
  }

  recordFailure(input: BudgetInput, error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown provider failure";
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
    const cooldownReason =
      code === "MARKETCHECK_RATE_LIMITED" || message.includes("429")
        ? "provider-rate-limited-cooldown"
        : message.toLowerCase().includes("timeout")
          ? "provider-timeout-cooldown"
          : "provider-failure-cooldown";
    const cooldownMs = cooldownReason === "provider-rate-limited-cooldown" ? 6 * 60 * 60 * 1000 : 45 * 60 * 1000;
    const familyKey = this.familyKey(input);
    this.cooldowns.set(familyKey, {
      expiresAt: Date.now() + cooldownMs,
      reason: cooldownReason,
    });
    if (cooldownReason === "provider-rate-limited-cooldown") {
      logger.error(
        {
          label: "PROVIDER_QUOTA_EXHAUSTED",
          provider: input.provider,
          operation: input.operation,
          year: input.year ?? null,
          make: input.make ?? null,
          model: input.model ?? null,
          trim: input.trim ?? null,
          reason: message,
        },
        "PROVIDER_QUOTA_EXHAUSTED",
      );
    }
    logger.warn(
      {
        label: "PROVIDER_COOLDOWN_APPLIED",
        provider: input.provider,
        operation: input.operation,
        year: input.year ?? null,
        make: input.make ?? null,
        model: input.model ?? null,
        trim: input.trim ?? null,
        reason: cooldownReason,
        cooldownMs,
      },
      "PROVIDER_COOLDOWN_APPLIED",
    );
  }

  resetForTests() {
    this.providerCounts.clear();
    this.recentFamilyCalls.clear();
    this.cooldowns.clear();
  }
}

export const providerBudgetService = new ProviderBudgetService();
