import { AppError } from "../errors/appError.js";
import { logger } from "../lib/logger.js";
import { MockVehicleListingsProvider } from "../providers/mock/mockVehicleListingsProvider.js";
import { MockVehicleSpecsProvider } from "../providers/mock/mockVehicleSpecsProvider.js";
import { MockVehicleValueProvider } from "../providers/mock/mockVehicleValueProvider.js";
import { ListingRecord, ValuationRecord, VehicleRecord } from "../types/domain.js";
import { env } from "../config/env.js";

export type ForcedProviderMode = "live" | "mock" | "success" | "quota_exhausted";
export type ProviderBudgetUserTier = "free" | "pro" | "unknown";
export type ProviderBudgetOperation = "specs" | "value" | "listings";

export type ProviderBudgetDecision = {
  allowLiveProvider: boolean;
  reason: string;
  cooldownActive: boolean;
  forcedMode: ForcedProviderMode;
  shouldUseFallback: boolean;
  shouldSimulateSuccess: boolean;
  shouldSimulateQuotaExhausted: boolean;
};

type ProviderBudgetInput = {
  provider: string;
  operation: ProviderBudgetOperation;
  userTier?: ProviderBudgetUserTier | null;
  confidence?: number | null;
  duplicateRequest?: boolean;
  cacheFresh?: boolean;
  providerCooldownActive?: boolean;
  providerModeOverride?: ForcedProviderMode | null;
};

const mockSpecsProvider = new MockVehicleSpecsProvider();
const mockValueProvider = new MockVehicleValueProvider();
const mockListingsProvider = new MockVehicleListingsProvider();

function isMarketCheckProvider(provider: string) {
  return provider === "marketcheck";
}

class ProviderBudgetService {
  resetForTests() {
    // Stateless for now. This hook keeps the existing test harness stable.
  }

  getForcedMode(modeOverride?: ForcedProviderMode | null): ForcedProviderMode {
    return modeOverride ?? env.FORCE_PROVIDER_MODE;
  }

  evaluate(input: ProviderBudgetInput): ProviderBudgetDecision {
    const forcedMode = this.getForcedMode(input.providerModeOverride);
    const cooldownActive = Boolean(input.providerCooldownActive);

    let decision: ProviderBudgetDecision;

    if (!isMarketCheckProvider(input.provider)) {
      decision = {
        allowLiveProvider: true,
        reason: "non-marketcheck-provider",
        cooldownActive,
        forcedMode,
        shouldUseFallback: false,
        shouldSimulateSuccess: false,
        shouldSimulateQuotaExhausted: false,
      };
    } else if (forcedMode === "mock") {
      decision = {
        allowLiveProvider: false,
        reason: "forced-mock-mode",
        cooldownActive,
        forcedMode,
        shouldUseFallback: true,
        shouldSimulateSuccess: false,
        shouldSimulateQuotaExhausted: false,
      };
    } else if (forcedMode === "success") {
      decision = {
        allowLiveProvider: false,
        reason: "forced-success-mode",
        cooldownActive,
        forcedMode,
        shouldUseFallback: false,
        shouldSimulateSuccess: true,
        shouldSimulateQuotaExhausted: false,
      };
    } else if (forcedMode === "quota_exhausted") {
      decision = {
        allowLiveProvider: false,
        reason: "forced-quota-exhausted-mode",
        cooldownActive,
        forcedMode,
        shouldUseFallback: true,
        shouldSimulateSuccess: false,
        shouldSimulateQuotaExhausted: true,
      };
    } else if (cooldownActive) {
      decision = {
        allowLiveProvider: false,
        reason: "provider-cooldown-active",
        cooldownActive,
        forcedMode,
        shouldUseFallback: true,
        shouldSimulateSuccess: false,
        shouldSimulateQuotaExhausted: false,
      };
    } else {
      decision = {
        allowLiveProvider: true,
        reason: "live-provider-allowed",
        cooldownActive,
        forcedMode,
        shouldUseFallback: false,
        shouldSimulateSuccess: false,
        shouldSimulateQuotaExhausted: false,
      };
    }

    logger.info(
      {
        label: "PROVIDER_BUDGET_DECISION",
        provider: input.provider,
        operation: input.operation,
        userTier: input.userTier ?? "unknown",
        confidence: input.confidence ?? null,
        duplicateRequest: Boolean(input.duplicateRequest),
        cacheFresh: Boolean(input.cacheFresh),
        cooldownActive,
        forcedMode,
        allowLiveProvider: decision.allowLiveProvider,
        reason: decision.reason,
        shouldUseFallback: decision.shouldUseFallback,
      },
      "PROVIDER_BUDGET_DECISION",
    );

    return decision;
  }

  createQuotaExhaustedError(operation: ProviderBudgetOperation) {
    return new AppError(
      429,
      "MARKETCHECK_RATE_LIMITED",
      `Simulated MarketCheck quota exhausted for ${operation}.`,
    );
  }

  async simulateSpecsSearchVehicles(input: {
    year?: string;
    make?: string;
    model?: string;
  }): Promise<VehicleRecord[]> {
    const results = await mockSpecsProvider.searchVehicles(input);
    this.logSimulatedSuccess("specs", { resultCount: results.length, query: input });
    return results;
  }

  async simulateSpecsSearchCandidates(input: {
    year: number;
    make: string;
    model: string;
    trim?: string;
  }): Promise<VehicleRecord[]> {
    const results = await mockSpecsProvider.searchCandidates(input);
    this.logSimulatedSuccess("specs", { resultCount: results.length, query: input });
    return results;
  }

  async simulateVehicleSpecs(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
  }): Promise<VehicleRecord | null> {
    const result = await mockSpecsProvider.getVehicleSpecs(input);
    this.logSimulatedSuccess("specs", { vehicleId: input.vehicleId, found: Boolean(result) });
    return result;
  }

  async simulateValue(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<ValuationRecord | null> {
    const result = await mockValueProvider.getValuation(input);
    this.logSimulatedSuccess("value", { vehicleId: input.vehicleId, found: Boolean(result) });
    return result;
  }

  async simulateListings(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    radiusMiles: number;
  }): Promise<ListingRecord[]> {
    const result = await mockListingsProvider.getListings(input);
    this.logSimulatedSuccess("listings", { vehicleId: input.vehicleId, resultCount: result.length });
    return result;
  }

  private logSimulatedSuccess(operation: ProviderBudgetOperation, details: Record<string, unknown>) {
    logger.info(
      {
        label: "PROVIDER_SIMULATED_SUCCESS",
        provider: "marketcheck",
        operation,
        mode: env.FORCE_PROVIDER_MODE,
        ...details,
      },
      "PROVIDER_SIMULATED_SUCCESS",
    );
  }
}

export const providerBudgetService = new ProviderBudgetService();
