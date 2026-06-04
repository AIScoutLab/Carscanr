import { env, isMarketCheckAutoSpecsEnabled } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import {
  buildCacheDescriptor,
  CACHE_RETENTION_MS,
  CachedServiceResult,
  createListingsCacheRow,
  createProviderApiUsageLog,
  createSpecsCacheRow,
  createValuesCacheRow,
  getFamilyListingsCacheKey,
  getFamilyValuesCacheKey,
  getListingsCacheKey,
  getSpecsCacheKey,
  getValuesCacheKey,
  normalizeCondition,
  normalizeLookupText,
} from "../lib/providerCache.js";
import { mapCanonicalVehicleToRecord, resolveStoredVehicleRecordById, upsertCanonicalVehicleFromProvider } from "../lib/canonicalVehicleCatalog.js";
import { applyCuratedSpecialtySpecs } from "../lib/curatedSpecialtySpecs.js";
import { logger } from "../lib/logger.js";
import { providers } from "../lib/providerRegistry.js";
import { repositories } from "../lib/repositoryRegistry.js";
import {
  buildSpecialtyUnavailableValuation,
  getSpecialtyModelAliases,
  isGenericFallbackValuation,
  isSpecialtyExoticMake,
  isSpecialtyModelFamilyMatch,
  isTrustedSpecialtyValuationSource,
} from "../lib/specialtyVehicles.js";
import {
  buildConditionSetValuation,
  isConditionSetValuation,
  normalizeSupportedValueCondition,
} from "../lib/valueConditionSet.js";
import { parseLiveVehicleId } from "../providers/marketcheck/vehicleId.js";
import { MockVehicleValueProvider } from "../providers/mock/mockVehicleValueProvider.js";
import { ListingRecord, PayloadEvaluation, ValuationRecord, VehicleLookupDescriptor, VehicleRecord, VehicleType } from "../types/domain.js";
import { fetchNhtsaData } from "./nhtsaService.js";
import { providerBudgetService } from "./providerBudgetService.js";
import { normalizeVehicleBadgeAlias } from "../lib/vehicleAliases.js";

const mockValueProvider = new MockVehicleValueProvider();
const USAGE_LOG_RETENTION_DAYS = 60;
const DEFAULT_UNLOCK_EVALUATION_ZIP = "";
const DEFAULT_UNLOCK_EVALUATION_MILEAGE = 25000;
const DEFAULT_UNLOCK_EVALUATION_CONDITION = "good";
const DEFAULT_UNLOCK_EVALUATION_RADIUS_MILES = 50;
const LISTING_DERIVATION_RADIUS_MILES = [50, 100, 250, 500];
const MIN_BELIEVABLE_LIVE_LISTINGS = 5;
const MAX_LIVE_LISTING_ATTEMPTS = 2;
const MAX_DISPLAY_LIVE_LISTINGS = 12;

function nowIso() {
  return new Date().toISOString();
}

function isFresh(expiresAt: string, currentIso: string) {
  return expiresAt > currentIso;
}

function retentionCutoffIso(retentionMs: number) {
  return new Date(Date.now() - retentionMs).toISOString();
}

function usageLogsCutoffIso() {
  return new Date(Date.now() - USAGE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function isExplicitUserRequestedValueRefresh(input: {
  allowLive?: boolean;
  fetchReason?: string | null;
  sourceScreen?: string | null;
  action?: string | null;
  forceLive?: boolean | null;
}) {
  const sourceScreen = input.sourceScreen ?? "valueScreen";
  const action = input.action ?? null;
  const fetchReason = input.fetchReason ?? null;
  return (
    isDeveloperForceLiveValueRefresh(input) ||
    action === "valueRefresh" ||
    (input.allowLive === true && fetchReason === "user_requested_value_refresh") ||
    (input.allowLive === true && sourceScreen === "valueScreen")
  );
}

function isNormalValueScreenRefresh(input: {
  allowLive?: boolean;
  fetchReason?: string | null;
  sourceScreen?: string | null;
  action?: string | null;
}) {
  const sourceScreen = input.sourceScreen ?? "valueScreen";
  const action = input.action ?? null;
  const fetchReason = input.fetchReason ?? null;
  return (
    sourceScreen === "valueScreen" &&
    (action === "valueRefresh" || fetchReason === "user_requested_value_refresh" || input.allowLive === true)
  );
}

function isDeveloperForceLiveValueRefresh(input: {
  fetchReason?: string | null;
  sourceScreen?: string | null;
  action?: string | null;
  forceLive?: boolean | null;
}) {
  if (input.forceLive !== true) {
    return false;
  }
  const sourceScreen = String(input.sourceScreen ?? "").toLowerCase();
  const action = String(input.action ?? "").toLowerCase();
  const fetchReason = String(input.fetchReason ?? "").toLowerCase();
  return (
    sourceScreen.includes("admin") ||
    sourceScreen.includes("debug") ||
    sourceScreen.includes("developer") ||
    action.includes("admin") ||
    action.includes("debug") ||
    action.includes("force") ||
    fetchReason.includes("admin") ||
    fetchReason.includes("debug") ||
    fetchReason.includes("force")
  );
}

function isAdjacentYearValueStrategy(strategy: ValueLookupAttempt["strategy"]) {
  return strategy.startsWith("adjacent-year");
}

function selectMarketCheckValueProviderAttempts(input: {
  attempts: ValueLookupAttempt[];
  normalValueScreenRefresh: boolean;
}) {
  const nonAdjacentAttempts = input.attempts.filter((attempt) => !isAdjacentYearValueStrategy(attempt.strategy));
  const liveSafeAttempts = nonAdjacentAttempts.length > 0 ? nonAdjacentAttempts : input.attempts;
  return input.normalValueScreenRefresh ? liveSafeAttempts.slice(0, 1) : liveSafeAttempts;
}

function isDeveloperForceLiveListingsRefresh(input: {
  fetchReason?: string | null;
  sourceScreen?: string | null;
  action?: string | null;
  forceLive?: boolean | null;
}) {
  if (input.forceLive !== true) {
    return false;
  }
  const sourceScreen = String(input.sourceScreen ?? "").toLowerCase();
  const action = String(input.action ?? "").toLowerCase();
  const fetchReason = String(input.fetchReason ?? "").toLowerCase();
  return (
    sourceScreen.includes("admin") ||
    sourceScreen.includes("debug") ||
    sourceScreen.includes("developer") ||
    action.includes("admin") ||
    action.includes("debug") ||
    action.includes("force") ||
    fetchReason.includes("admin") ||
    fetchReason.includes("debug") ||
    fetchReason.includes("force")
  );
}

function isExplicitUserRequestedListingsRefresh(input: {
  allowLive?: boolean;
  fetchReason?: string | null;
  sourceScreen?: string | null;
  action?: string | null;
  forceLive?: boolean | null;
}) {
  const sourceScreen = input.sourceScreen ?? "listingsScreen";
  const action = input.action ?? null;
  const fetchReason = input.fetchReason ?? null;
  return (
    isDeveloperForceLiveListingsRefresh(input) ||
    action === "listingsRefresh" ||
    (input.allowLive === true && fetchReason === "user_requested_listings_refresh") ||
    (input.allowLive === true && sourceScreen === "listingsScreen")
  );
}

function isNormalListingsRefresh(input: {
  allowLive?: boolean;
  fetchReason?: string | null;
  sourceScreen?: string | null;
  action?: string | null;
  forceLive?: boolean | null;
}) {
  if (isDeveloperForceLiveListingsRefresh(input)) {
    return false;
  }
  const sourceScreen = input.sourceScreen ?? "listingsScreen";
  const action = input.action ?? null;
  const fetchReason = input.fetchReason ?? null;
  return (
    action === "listingsRefresh" ||
    fetchReason === "user_requested_listings_refresh" ||
    (input.allowLive === true && (sourceScreen === "listingsScreen" || sourceScreen === "valueScreen"))
  );
}

function isGenericListingsTrimValue(value: string | null | undefined) {
  const normalized = normalizeVehicleLookupText(value);
  return (
    normalized.length === 0 ||
    normalized === "base" ||
    normalized === "standard" ||
    normalized === "unknown" ||
    normalized === "unspecified" ||
    normalized === "visual only" ||
    normalized === "visual" ||
    normalized === "estimated"
  );
}

function isAdjacentOrExpandedListingsStrategy(strategy: ListingsLookupAttempt["strategy"]) {
  return (
    strategy === "adjacent-year-previous" ||
    strategy === "adjacent-year-next" ||
    strategy === "adjacent-year-previous-2" ||
    strategy === "adjacent-year-next-2" ||
    strategy === "adjacent-year-family-model" ||
    strategy === "wider-radius-250" ||
    strategy === "wider-radius-500"
  );
}

function selectMarketCheckListingsProviderAttempts(input: {
  attempts: ListingsLookupAttempt[];
  normalListingsRefresh: boolean;
  requestedTrim?: string | null;
  forceLive?: boolean | null;
}) {
  if (!input.normalListingsRefresh && input.forceLive !== true) {
    return input.attempts.slice(0, MAX_LIVE_LISTING_ATTEMPTS);
  }

  const liveSafeAttempts = input.attempts.filter((attempt) => !isAdjacentOrExpandedListingsStrategy(attempt.strategy));
  const genericTrim = isGenericListingsTrimValue(input.requestedTrim);
  if (input.forceLive !== true) {
    const preferredAttempt =
      genericTrim
        ? liveSafeAttempts.find((attempt) => attempt.strategy === "same-year-any-trim") ??
          liveSafeAttempts.find((attempt) => attempt.strategy === "same-year-family-model") ??
          liveSafeAttempts.find((attempt) => attempt.strategy === "exact-year-make-model")
        : liveSafeAttempts.find((attempt) => attempt.strategy === "exact-year-make-model") ??
          liveSafeAttempts.find((attempt) => attempt.strategy === "same-year-any-trim") ??
          liveSafeAttempts.find((attempt) => attempt.strategy === "same-year-family-model");

    return preferredAttempt ? [preferredAttempt] : liveSafeAttempts.slice(0, 1);
  }

  const preferredStrategies: ListingsLookupAttempt["strategy"][] = genericTrim
    ? ["same-year-any-trim", "same-year-family-model", "exact-year-make-model", "adjacent-year-previous", "adjacent-year-next", "wider-radius-250"]
    : ["exact-year-make-model", "same-year-any-trim", "same-year-family-model", "adjacent-year-previous", "adjacent-year-next", "wider-radius-250"];
  const selected: ListingsLookupAttempt[] = [];
  for (const strategy of preferredStrategies) {
    const attempt =
      (isAdjacentOrExpandedListingsStrategy(strategy) ? input.attempts : liveSafeAttempts).find((entry) => entry.strategy === strategy) ?? null;
    if (attempt && !selected.some((entry) => listingsAttemptKey(entry) === listingsAttemptKey(attempt))) {
      selected.push(attempt);
    }
  }

  return selected.length > 0 ? selected.slice(0, MAX_LIVE_LISTING_ATTEMPTS) : liveSafeAttempts.slice(0, 1);
}

function isMissingSupabaseRelationError(error: unknown, relationName: string) {
  if (!(error instanceof AppError) || error.code !== "SUPABASE_QUERY_FAILED") {
    return false;
  }
  const details = error.details as { code?: string; message?: string } | undefined;
  return details?.code === "PGRST205" && typeof details.message === "string" && details.message.includes(relationName);
}

function getSimulatedProviderVehicleId(input: {
  requestedVehicleId: string;
  attemptVehicle: VehicleRecord;
}) {
  const attemptVehicleId = input.attemptVehicle.id;
  if (typeof attemptVehicleId === "string" && attemptVehicleId.trim().length > 0 && !attemptVehicleId.startsWith("lookup:")) {
    return attemptVehicleId;
  }
  return input.requestedVehicleId;
}

function normalizeVehicleLookupText(value: string | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(lx|ex|ex l|exl|sport|touring|limited|premium|luxury|special|standard|base|se|sel|xle|le|s|sl|sv|lt|ls|gt|xlt|lariat|platinum|long range|performance)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchMake(value: string) {
  return normalizeLookupText(value).replace(/\s+/g, " ").trim();
}

function normalizeSearchModel(value: string) {
  return normalizeLookupText(value).replace(/\s+/g, " ").trim();
}

function buildVehicleLookupVariants(vehicle: VehicleRecord | null) {
  if (!vehicle) {
    return [];
  }

  const variants = [
    vehicle,
    {
      ...vehicle,
      trim: "",
    },
  ];

  const normalizedModel = normalizeVehicleLookupText(vehicle.model);
  const familyModel = normalizedModel.split(" ").slice(0, 2).join(" ").trim();
  if (familyModel && familyModel !== normalizedModel) {
    variants.push({
      ...vehicle,
      model: familyModel
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      trim: "",
    });
  }

  if (vehicle.year > 1981) {
    variants.push({
      ...vehicle,
      year: vehicle.year - 1,
      trim: "",
    });
  }

  variants.push({
    ...vehicle,
    year: vehicle.year + 1,
    trim: "",
  });

  return variants.filter(
    (variant, index, array) =>
      array.findIndex((entry) => `${entry.year}|${entry.make}|${entry.model}|${entry.trim}` === `${variant.year}|${variant.make}|${variant.model}|${variant.trim}`) === index,
  );
}

type ListingsLookupAttempt = {
  label:
    | "LISTINGS_EXACT_TRIM_MATCH"
    | "LISTINGS_SAME_MODEL_MIXED_TRIMS"
    | "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS"
    | "LISTINGS_MODEL_NORMALIZED"
    | "LISTINGS_WIDER_RADIUS";
  strategy:
    | "exact-year-make-model"
    | "same-year-any-trim"
    | "same-year-family-model"
    | "adjacent-year-previous"
    | "adjacent-year-next"
    | "adjacent-year-previous-2"
    | "adjacent-year-next-2"
    | "adjacent-year-family-model"
    | "wider-radius-250"
    | "wider-radius-500";
  vehicle: VehicleRecord;
  radiusMiles: number;
};

type ValueLookupAttempt = {
  strategy:
    | "exact-year-make-model"
    | "same-year-any-trim"
    | "same-year-family-model"
    | "adjacent-year-previous"
    | "adjacent-year-next"
    | "adjacent-year-family-model"
    | "same-generation"
    | "similar-vehicle";
  vehicle: VehicleRecord;
};

type ListingsDebugMode =
  | "exact_trim"
  | "same_model_mixed_trims"
  | "adjacent_year_mixed_trims"
  | "none";

type ListingsDebugMeta = {
  sourceLabel: string | null;
  rawCount: number;
  believableCount: number;
  mode: ListingsDebugMode;
  fallbackReason: string | null;
  liveFetchDeferred?: boolean;
};

type MarketFetchReason =
  | "initial_load"
  | "user_requested_specs_refresh"
  | "user_requested_value_refresh"
  | "user_requested_listings_refresh"
  | "cached_listings_value_sync"
  | "locked_preview"
  | "estimate_guard"
  | "unknown";

function normalizeMarketFetchReason(reason: string | null | undefined): MarketFetchReason {
  if (
    reason === "initial_load" ||
    reason === "user_requested_specs_refresh" ||
    reason === "user_requested_value_refresh" ||
    reason === "user_requested_listings_refresh" ||
    reason === "cached_listings_value_sync" ||
    reason === "locked_preview" ||
    reason === "estimate_guard"
  ) {
    return reason;
  }
  return "unknown";
}

function isMarketCheckEnabled() {
  return env.MARKETCHECK_ENABLED;
}

function isSpecsLiveFetchAllowed(allowLive: boolean, fetchReason: MarketFetchReason) {
  if (!allowLive) {
    return false;
  }
  if (providers.specsProviderName !== "marketcheck") {
    return true;
  }
  return fetchReason === "user_requested_specs_refresh" && isMarketCheckEnabled() && isMarketCheckAutoSpecsEnabled();
}

function isValueLiveFetchAllowed(input: {
  allowLive: boolean;
  fetchReason: MarketFetchReason;
  sourceScreen?: string | null;
  action?: string | null;
  forceLive?: boolean | null;
}) {
  const explicitRefresh = isExplicitUserRequestedValueRefresh(input);
  if (!explicitRefresh) {
    return false;
  }
  if (providers.valueProviderName !== "marketcheck") {
    return true;
  }
  return isMarketCheckEnabled();
}

function isListingsLiveFetchAllowed(input: {
  allowLive: boolean;
  fetchReason: MarketFetchReason;
  sourceScreen?: string | null;
  action?: string | null;
  forceLive?: boolean | null;
}) {
  const explicitRefresh = isExplicitUserRequestedListingsRefresh(input);
  if (!explicitRefresh) {
    return false;
  }
  if (providers.listingsProviderName !== "marketcheck") {
    return true;
  }
  return isMarketCheckEnabled();
}

function logMarketGateEvaluated(input: {
  label: "VALUE_LIVE_FETCH_GATE_EVALUATED" | "LISTINGS_LIVE_FETCH_GATE_EVALUATED";
  requestId?: string;
  vehicleId: string;
  allowLive: boolean;
  fetchReason: MarketFetchReason;
  sourceScreen?: string | null;
  action?: string | null;
  forceLive?: boolean | null;
  zipSource?: string | null;
  cacheKey?: string | null;
  familyCacheKey?: string | null;
  explicitRefresh: boolean;
}) {
  logger.info(
    {
      label: input.label,
      requestId: input.requestId,
      vehicleId: input.vehicleId,
      allowLive: input.allowLive,
      fetchReason: input.fetchReason,
      sourceScreen: input.sourceScreen ?? null,
      action: input.action ?? null,
      forceLive: input.forceLive ?? null,
      zipSource: input.zipSource ?? null,
      explicitRefresh: input.explicitRefresh,
      cacheKey: input.cacheKey ?? null,
      familyCacheKey: input.familyCacheKey ?? null,
    },
    input.label,
  );
}

function logMarketGateAllowed(input: {
  label: "VALUE_LIVE_FETCH_ALLOWED" | "LISTINGS_LIVE_FETCH_ALLOWED";
  requestId?: string;
  vehicleId: string;
  fetchReason: MarketFetchReason;
}) {
  logger.info(
    {
      label: input.label,
      requestId: input.requestId,
      vehicleId: input.vehicleId,
      fetchReason: input.fetchReason,
    },
    input.label,
  );
}

function logMarketGateSkipped(input: {
  label: "VALUE_LIVE_FETCH_SKIPPED" | "LISTINGS_LIVE_FETCH_SKIPPED";
  requestId?: string;
  vehicleId: string;
  fetchReason: MarketFetchReason;
  reason: string;
}) {
  logger.info(
    {
      label: input.label,
      requestId: input.requestId,
      vehicleId: input.vehicleId,
      fetchReason: input.fetchReason,
      reason: input.reason,
    },
    input.label,
  );

  logger.warn(
    {
      label: "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
      requestId: input.requestId,
      vehicleId: input.vehicleId,
      action:
        input.label === "VALUE_LIVE_FETCH_SKIPPED"
          ? "valueScreen"
          : "listingsScreen",
      endpointType: input.label === "VALUE_LIVE_FETCH_SKIPPED" ? "value" : "listings",
      fetchReason: input.fetchReason,
      reason: input.reason,
      allowedCalls: 0,
      budgetInputs: {
        fetchReason: input.fetchReason,
      },
    },
    "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
  );

  if (input.reason === "marketcheck-disabled") {
    logger.info(
      {
        label: "MARKETCHECK_DISABLED_SKIP",
        endpoint: input.label === "VALUE_LIVE_FETCH_SKIPPED" ? "/v2/search/car/active" : "/v2/search/car/active",
        reason: input.fetchReason,
        allowLive: true,
        scanId: null,
        vehicleId: input.vehicleId,
        year: null,
        make: null,
        model: null,
        trim: null,
        caller: input.label === "VALUE_LIVE_FETCH_SKIPPED" ? "VehicleService.getValue" : "VehicleService.getListings",
        stackTag: input.label === "VALUE_LIVE_FETCH_SKIPPED" ? "vehicle-value" : "vehicle-listings",
      },
      "MARKETCHECK_DISABLED_SKIP",
    );
  }

  if (input.fetchReason === "locked_preview") {
    logger.info(
      {
        label: "PROVIDER_CALL_SKIPPED_NOT_UNLOCKED",
        requestId: input.requestId,
        vehicleId: input.vehicleId,
      },
      "PROVIDER_CALL_SKIPPED_NOT_UNLOCKED",
    );
    return;
  }

  if (input.fetchReason === "estimate_guard") {
    logger.info(
      {
        label: "PROVIDER_CALL_SKIPPED_ESTIMATE_GUARD",
        requestId: input.requestId,
        vehicleId: input.vehicleId,
      },
      "PROVIDER_CALL_SKIPPED_ESTIMATE_GUARD",
    );
    return;
  }

  logger.info(
    {
      label: "PROVIDER_CALL_SKIPPED_INITIAL_LOAD",
      requestId: input.requestId,
      vehicleId: input.vehicleId,
      fetchReason: input.fetchReason,
    },
    "PROVIDER_CALL_SKIPPED_INITIAL_LOAD",
  );
}

function logCacheHitProviderSkip(input: {
  requestId?: string;
  vehicleId: string;
  operation: "value" | "listings";
  cacheLevel: "exact" | "family";
}) {
  logger.info(
    {
      label: "PROVIDER_CALL_SKIPPED_CACHE_HIT",
      requestId: input.requestId,
      vehicleId: input.vehicleId,
      operation: input.operation,
      cacheLevel: input.cacheLevel,
    },
    "PROVIDER_CALL_SKIPPED_CACHE_HIT",
  );
}

function logMarketCheckApiCacheHit(input: {
  requestId?: string;
  userId?: string | null;
  endpointType: "specs" | "value" | "listings";
  vehicleId: string;
  cacheKey: string;
  cacheLevel: "exact" | "family";
  make?: string | null;
  model?: string | null;
  year?: number | null;
  trim?: string | null;
  zip?: string | null;
  mileage?: number | null;
  condition?: string | null;
  radiusMiles?: number | null;
  resultCount?: number | null;
}) {
  logger.info(
    {
      label: "MARKETCHECK_API_CACHE_HIT",
      requestId: input.requestId,
      userId: input.userId ?? null,
      endpointType: input.endpointType,
      vehicleId: input.vehicleId,
      cacheKey: input.cacheKey,
      cacheHit: true,
      cacheLevel: input.cacheLevel,
      year: input.year ?? null,
      make: input.make ?? null,
      model: input.model ?? null,
      trim: input.trim ?? null,
      zip: input.zip ?? null,
      mileage: input.mileage ?? null,
      condition: input.condition ?? null,
      radiusMiles: input.radiusMiles ?? null,
      resultCount: input.resultCount ?? null,
    },
    "MARKETCHECK_API_CACHE_HIT",
  );
}

function logMarketCheckApiFallbackAttempt(input: {
  requestId?: string;
  endpointType: "specs" | "value" | "listings";
  vehicleId: string;
  cacheKey?: string | null;
  strategy: string;
  reason: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  zip?: string | null;
  mileage?: number | null;
  condition?: string | null;
  radiusMiles?: number | null;
}) {
  logger.info(
    {
      label: "MARKETCHECK_API_FALLBACK_ATTEMPT",
      requestId: input.requestId,
      endpointType: input.endpointType,
      vehicleId: input.vehicleId,
      cacheKey: input.cacheKey ?? null,
      strategy: input.strategy,
      reason: input.reason,
      year: input.year ?? null,
      make: input.make ?? null,
      model: input.model ?? null,
      trim: input.trim ?? null,
      zip: input.zip ?? null,
      mileage: input.mileage ?? null,
      condition: input.condition ?? null,
      radiusMiles: input.radiusMiles ?? null,
    },
    "MARKETCHECK_API_FALLBACK_ATTEMPT",
  );
}

function resolveListingsDebugMode(strategy: ListingsLookupAttempt["strategy"] | null): ListingsDebugMode {
  if (strategy === "exact-year-make-model") {
    return "exact_trim";
  }
  if (strategy === "same-year-any-trim" || strategy === "same-year-family-model" || strategy === "adjacent-year-family-model") {
    return "same_model_mixed_trims";
  }
  if (
    strategy === "adjacent-year-previous" ||
    strategy === "adjacent-year-next" ||
    strategy === "adjacent-year-previous-2" ||
    strategy === "adjacent-year-next-2" ||
    strategy === "wider-radius-250" ||
    strategy === "wider-radius-500"
  ) {
    return "adjacent_year_mixed_trims";
  }
  return "none";
}

function buildLookupVehicleFromDescriptor(descriptor: ReturnType<typeof buildCacheDescriptor>): VehicleRecord | null {
  if (!descriptor) {
    return null;
  }

  return {
    id: `lookup:${descriptor.year}:${descriptor.make}:${descriptor.model}:${descriptor.trim ?? ""}`,
    year: descriptor.year,
    make: descriptor.make,
    model: descriptor.model,
    trim: descriptor.trim ?? "",
    bodyStyle: "",
    vehicleType: normalizeDescriptorVehicleType(descriptor.vehicleType),
    msrp: 0,
    engine: "",
    horsepower: null,
    torque: "",
    transmission: "",
    drivetrain: "",
    mpgOrRange: "",
    colors: [],
  };
}

function buildLookupVehicleFromRawDescriptor(descriptor: VehicleLookupDescriptor | null | undefined): VehicleRecord | null {
  if (!descriptor) {
    return null;
  }

  return {
    id: `lookup:${descriptor.year}:${normalizeVehicleLookupText(descriptor.make)}:${normalizeVehicleLookupText(descriptor.model)}:${normalizeVehicleLookupText(descriptor.trim)}`,
    year: descriptor.year,
    make: descriptor.make,
    model: descriptor.model,
    trim: descriptor.trim ?? "",
    bodyStyle: descriptor.bodyStyle ?? "",
    vehicleType: normalizeDescriptorVehicleType(descriptor.vehicleType),
    msrp: 0,
    engine: "",
    horsepower: null,
    torque: "",
    transmission: "",
    drivetrain: "",
    mpgOrRange: "",
    colors: [],
  };
}

function buildDescriptorLookupVehicleId(descriptor: VehicleLookupDescriptor | null | undefined) {
  if (!descriptor) {
    return "descriptor:unknown";
  }
  return [
    "descriptor",
    descriptor.year,
    normalizeVehicleLookupText(descriptor.make).replace(/\s+/g, "-"),
    normalizeVehicleLookupText(descriptor.model).replace(/\s+/g, "-"),
    normalizeVehicleLookupText(descriptor.trim ?? "family").replace(/\s+/g, "-") || "family",
  ].join(":");
}

async function resolveLookupContext(input: {
  requestId?: string;
  vehicleId?: string | null;
  descriptor?: VehicleLookupDescriptor | null;
}) {
  const requestedVehicleId = String(input.vehicleId ?? "").trim() || null;
  const parsedVehicleId = requestedVehicleId ? parseLiveVehicleId(requestedVehicleId) : null;
  const isLiveVehicle = Boolean(parsedVehicleId);
  const rawDescriptor = input.descriptor ?? null;
  let vehicle: VehicleRecord | null = null;
  let invalidVehicleId = false;

  if (!isLiveVehicle && requestedVehicleId) {
    vehicle = await resolveStoredVehicleRecordById(requestedVehicleId).catch(() => {
      invalidVehicleId = true;
      return null;
    });
  }

  const supplementedVehicle = vehicle
    ? {
        ...vehicle,
        trim: preferMeaningfulRequiredText(vehicle.trim, rawDescriptor?.trim),
        bodyStyle: preferMeaningfulRequiredText(vehicle.bodyStyle, rawDescriptor?.bodyStyle),
        vehicleType: preferVehicleType(vehicle.vehicleType, rawDescriptor?.vehicleType),
      }
    : null;

  const effectiveDescriptor = supplementedVehicle
    ? {
        year: supplementedVehicle.year,
        make: supplementedVehicle.make,
        model: supplementedVehicle.model,
        trim: supplementedVehicle.trim,
        vehicleType: supplementedVehicle.vehicleType,
        bodyStyle: supplementedVehicle.bodyStyle,
        normalizedModel: null,
      }
    : parsedVehicleId
      ? {
          year: parsedVehicleId.year,
          make: parsedVehicleId.make,
          model: parsedVehicleId.model,
          trim: parsedVehicleId.trim ?? null,
          vehicleType: rawDescriptor?.vehicleType ?? null,
          bodyStyle: rawDescriptor?.bodyStyle ?? null,
          normalizedModel: rawDescriptor?.normalizedModel ?? null,
        }
      : rawDescriptor;

  const cacheDescriptor = effectiveDescriptor
    ? buildCacheDescriptor({
        vehicle: supplementedVehicle,
        parsed: {
          year: effectiveDescriptor.year,
          make: effectiveDescriptor.make,
          model: effectiveDescriptor.model,
          trim: effectiveDescriptor.trim ?? undefined,
          vehicleType: normalizeDescriptorVehicleType(effectiveDescriptor.vehicleType),
        },
      })
    : null;

  const lookupVehicle =
    supplementedVehicle ?? buildLookupVehicleFromRawDescriptor(effectiveDescriptor) ?? buildLookupVehicleFromDescriptor(cacheDescriptor);
  const lookupVehicleId = requestedVehicleId ?? buildDescriptorLookupVehicleId(effectiveDescriptor);
  const resolutionMode = vehicle || parsedVehicleId ? "real_id" : effectiveDescriptor ? "descriptor" : "unresolved";

  if (resolutionMode === "real_id") {
    logger.info(
      {
        label: "DETAIL_REAL_ID_RESOLUTION_USED",
        requestId: input.requestId,
        vehicleId: requestedVehicleId,
        liveVehicle: isLiveVehicle,
        descriptorSupplemented: Boolean(rawDescriptor),
      },
      "DETAIL_REAL_ID_RESOLUTION_USED",
    );
  } else if (effectiveDescriptor) {
    logger.info(
      {
        label: "DETAIL_DESCRIPTOR_RESOLUTION_USED",
        requestId: input.requestId,
        vehicleId: requestedVehicleId,
        reason: invalidVehicleId ? "unresolvable-client-only-id" : "descriptor-request",
        descriptor: effectiveDescriptor,
      },
      "DETAIL_DESCRIPTOR_RESOLUTION_USED",
    );
  } else {
    logger.error(
      {
        label: "DETAIL_DESCRIPTOR_RESOLUTION_FAILED",
        requestId: input.requestId,
        vehicleId: requestedVehicleId,
        reason: invalidVehicleId ? "invalid-id-and-no-descriptor" : "missing-id-and-descriptor",
      },
      "DETAIL_DESCRIPTOR_RESOLUTION_FAILED",
    );
  }

  return {
    requestedVehicleId,
    parsedVehicleId,
    isLiveVehicle,
    vehicle: supplementedVehicle,
    invalidVehicleId,
    effectiveDescriptor,
    cacheDescriptor,
    lookupVehicle,
    lookupVehicleId,
    resolutionMode,
  };
}

function vehicleLookupKey(vehicle: VehicleRecord, radiusMiles: number) {
  return [
    vehicle.year,
    normalizeVehicleLookupText(vehicle.make),
    normalizeVehicleLookupText(vehicle.model),
    normalizeLookupText(vehicle.trim),
    normalizeVehicleLookupText(vehicle.bodyStyle),
    radiusMiles,
  ].join("|");
}

function listingsAttemptKey(attempt: ListingsLookupAttempt) {
  return [
    attempt.strategy,
    attempt.vehicle.year,
    normalizeVehicleLookupText(attempt.vehicle.make),
    normalizeVehicleLookupText(attempt.vehicle.model),
    attempt.vehicle.trim.trim().toLowerCase(),
    normalizeVehicleLookupText(attempt.vehicle.bodyStyle),
    attempt.radiusMiles,
  ].join("|");
}

function isGenerationSensitiveVehicle(vehicle: VehicleRecord) {
  const make = normalizeVehicleLookupText(vehicle.make);
  const model = normalizeVehicleLookupText(vehicle.model);
  const body = normalizeVehicleLookupText(vehicle.bodyStyle);
  const combined = `${make} ${model}`.trim();
  return (
    isHighRetentionOffRoadVehicle(vehicle) ||
    /wrangler|gladiator/.test(combined) ||
    /f 150|f150|silverado|sierra|ram|tacoma|tundra|ranger|colorado|canyon/.test(combined) ||
    /mustang|camaro|challenger|charger|corvette/.test(combined) ||
    /truck|pickup/.test(body)
  );
}

function isHighRetentionOffRoadVehicle(vehicle: VehicleRecord) {
  const make = normalizeVehicleLookupText(vehicle.make);
  const model = normalizeVehicleLookupText(vehicle.model);
  const combined = `${make} ${model}`.trim();
  return (
    /\btoyota 4runner\b|\btoyota tacoma\b|\btoyota land cruiser\b/.test(combined) ||
    /\bjeep wrangler\b|\bjeep gladiator\b/.test(combined) ||
    /\blexus gx\b|\blexus lx\b/.test(combined)
  );
}

function getWranglerGenerationBucket(year: number) {
  if (year >= 1997 && year <= 2006) return "TJ";
  if (year >= 2007 && year <= 2018) return "JK";
  if (year >= 2018) return "JL";
  return null;
}

function getGenerationBucket(vehicle: VehicleRecord) {
  const model = normalizeVehicleLookupText(vehicle.model);
  if (/wrangler/.test(model)) {
    return getWranglerGenerationBucket(vehicle.year);
  }
  if (isGenerationSensitiveVehicle(vehicle)) {
    return null;
  }
  return `${Math.floor(vehicle.year / 4) * 4}s`;
}

function getTrimFamily(vehicle: VehicleRecord) {
  const normalizedTrim = normalizeVehicleLookupText(vehicle.trim);
  if (!normalizedTrim) {
    return null;
  }
  return normalizedTrim.split(" ")[0] ?? null;
}

function hasExplicitTrimValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function preferMeaningfulRequiredText(primary: string, fallback: string | null | undefined) {
  if (primary.trim().length > 0) {
    return primary;
  }
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback;
  }
  return primary;
}

function preferVehicleType(primary: VehicleType, fallback: VehicleLookupDescriptor["vehicleType"] | null | undefined): VehicleType {
  return primary ?? normalizeDescriptorVehicleType(fallback);
}

function normalizeDescriptorVehicleType(vehicleType: VehicleLookupDescriptor["vehicleType"] | null | undefined): VehicleType {
  if (vehicleType === "motorcycle") {
    return "motorcycle";
  }
  return "car";
}

function inferMsrpAnchorFromVehicle(vehicle: VehicleRecord) {
  if (isSpecialtyExoticMake(vehicle.make)) {
    return null;
  }
  if (isHighRetentionOffRoadVehicle(vehicle)) {
    return null;
  }
  const directMsrp = typeof vehicle.msrp === "number" && Number.isFinite(vehicle.msrp) && vehicle.msrp > 0 ? vehicle.msrp : null;
  if (directMsrp) {
    return { anchorMsrp: directMsrp, modelType: "estimated_depreciation" as const };
  }

  const make = normalizeVehicleLookupText(vehicle.make);
  const model = normalizeVehicleLookupText(vehicle.model);
  const trim = normalizeVehicleLookupText(vehicle.trim);
  const body = normalizeVehicleLookupText(vehicle.bodyStyle);
  const engine = normalizeVehicleLookupText(vehicle.engine);
  const family = `${make} ${model} ${trim} ${body} ${engine}`.trim();

  let anchorMsrp: number | null = null;
  if (vehicle.vehicleType === "motorcycle") {
    anchorMsrp = 14000;
  } else if (/rolls royce|bentley|ferrari|lamborghini|mclaren|aston martin|porsche|maserati/.test(make)) {
    anchorMsrp = 95000;
  } else if (/bmw|mercedes|audi|lexus|cadillac|lincoln|genesis|infiniti|acura|volvo|land rover/.test(make)) {
    anchorMsrp = 52000;
  } else if (
    /pickup|truck/.test(body) ||
    /\bf 150\b|\bf150\b|\bsilverado\b|\bsierra\b|\bram 1500\b|\btacoma\b|\btundra\b|\branger\b|\bfrontier\b|\bcanyon\b|\bcolorado\b|\bridgeline\b|\bmaverick\b|\bgladiator\b|\bsanta cruz\b/.test(family)
  ) {
    anchorMsrp = 42000;
  } else if (/suv|crossover|utility/.test(body) || /\bcr v\b|\brav4\b|\bpilot\b|\bhighlander\b|\bexplorer\b|\bwrangler\b/.test(family)) {
    anchorMsrp = 34000;
  } else if (/coupe|convertible|performance|sport/.test(body) || /mustang|camaro|corvette|charger|challenger|supra|m3|m4/.test(family)) {
    anchorMsrp = 47000;
  } else if (/luxury|platinum|limited|touring/.test(trim)) {
    anchorMsrp = 38000;
  } else if (/civic|corolla|sentra|elantra|forte|mazda3|impreza/.test(family)) {
    anchorMsrp = 24000;
  } else if (/camry|accord|altima|malibu|sonata|k5/.test(family)) {
    anchorMsrp = 29000;
  }

  if (anchorMsrp == null) {
    return null;
  }

  return { anchorMsrp, modelType: "estimated_family_model" as const };
}

function buildEstimatedMarketRangeFromVehicle(input: {
  vehicle: VehicleRecord;
  vehicleId: string;
  zip: string;
  mileage: number;
  condition: string;
}): ValuationRecord | null {
  const msrpAnchor = inferMsrpAnchorFromVehicle(input.vehicle);
  if (!msrpAnchor) {
    return null;
  }
  const msrp = msrpAnchor.anchorMsrp;

  const age = Math.max(0, new Date().getFullYear() - input.vehicle.year);
  const body = normalizeVehicleLookupText(input.vehicle.bodyStyle);
  const isTruckOrSuv = /truck|pickup|suv/.test(body);
  const baseRetention = Math.max(0.18, Math.min(0.88, Math.pow(isTruckOrSuv ? 0.87 : 0.84, Math.min(age, 12))));
  const mileagePenalty = Math.max(0.82, 1 - Math.max(0, input.mileage - 30000) / 220000);
  const conditionMultiplier = getConditionMultiplier(input.condition);
  const anchor = Math.round(msrp * baseRetention * mileagePenalty * conditionMultiplier);
  if (!Number.isFinite(anchor) || anchor <= 0) {
    return null;
  }

  const privateWidth = getVehicleRangeProfile(input.vehicle, anchor);
  const retailWidth = Math.min(0.18, privateWidth + 0.02);
  const tradeWidth = Math.max(0.05, privateWidth - 0.01);
  const tradeRange = buildDynamicRange(Math.round(anchor * 0.92), tradeWidth);
  const privateRange = buildDynamicRange(anchor, privateWidth);
  const retailRange = buildDynamicRange(Math.round(anchor * 1.08), retailWidth);

  return {
    id: `estimated-market-range:${input.vehicleId}:${input.zip}:${input.mileage}`,
    vehicleId: input.vehicleId,
    zip: input.zip,
    mileage: input.mileage,
    condition: normalizeCondition(input.condition),
    status: "loaded_value",
    tradeIn: Math.round(anchor * 0.92),
    tradeInLow: tradeRange.low,
    tradeInHigh: tradeRange.high,
    privateParty: anchor,
    privatePartyLow: privateRange.low,
    privatePartyHigh: privateRange.high,
    dealerRetail: Math.round(anchor * 1.08),
    dealerRetailLow: retailRange.low,
    dealerRetailHigh: retailRange.high,
    currency: "USD",
    generatedAt: new Date().toISOString(),
    sourceLabel: msrpAnchor.modelType === "estimated_depreciation" ? "Estimated from vehicle data" : "Estimated from vehicle family data",
    confidenceLabel:
      msrpAnchor.modelType === "estimated_depreciation"
        ? "Built from vehicle year, class, and original pricing data."
        : "Built from vehicle year, class, and family pricing data.",
    modelType: msrpAnchor.modelType,
    listingCount: null,
  };
}

function percentileFromSorted(values: number[], percentile: number) {
  if (values.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * percentile)));
  return values[index] ?? null;
}

function buildDerivedValuationFromListings(input: {
  vehicle: VehicleRecord;
  vehicleId: string;
  zip: string;
  mileage: number;
  condition: string;
  listings: ListingRecord[];
}): ValuationRecord | null {
  const prices = input.listings
    .filter(isBelievableListing)
    .map((listing) => listing.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) {
    return null;
  }

  const median = percentileFromSorted(prices, 0.5);
  const low = percentileFromSorted(prices, prices.length >= 4 ? 0.2 : 0);
  const high = percentileFromSorted(prices, prices.length >= 4 ? 0.8 : 1);
  if (!median || !low || !high) {
    return null;
  }

  const conditionMultiplier = getConditionMultiplier(input.condition);
  const adjustedMedian = Math.round(median * conditionMultiplier);
  const adjustedLow = Math.round(low * conditionMultiplier);
  const adjustedHigh = Math.round(high * conditionMultiplier);
  const tradeIn = Math.round(adjustedMedian * 0.92);
  const dealerRetail = Math.round(adjustedMedian * 1.08);
  const confidenceLabel =
    prices.length >= 6
      ? `Based on ${prices.length} nearby comparable listings. Market confidence is moderate.`
      : prices.length >= 3
        ? `Based on ${prices.length} nearby comparable listings. Limited market confidence.`
        : `Based on ${prices.length} nearby comparable listing${prices.length === 1 ? "" : "s"}. Very limited market confidence.`;
  const confidence = prices.length >= 6 ? "moderate" : "limited";

  return {
    id: `derived-market-range:${input.vehicleId}:${input.zip}:${input.mileage}`,
    vehicleId: input.vehicleId,
    zip: input.zip,
    mileage: input.mileage,
    condition: normalizeCondition(input.condition),
    status: "loaded_listing_range",
    tradeIn,
    tradeInLow: Math.round(adjustedLow * 0.92),
    tradeInHigh: Math.round(adjustedHigh * 0.92),
    privateParty: adjustedMedian,
    privatePartyLow: adjustedLow,
    privatePartyHigh: adjustedHigh,
    dealerRetail,
    dealerRetailLow: Math.round(adjustedLow * 1.08),
    dealerRetailHigh: Math.round(adjustedHigh * 1.08),
    low: adjustedLow,
    high: adjustedHigh,
    median: adjustedMedian,
    currency: "USD",
    generatedAt: new Date().toISOString(),
    sourceLabel: "Estimated from nearby comparable listings",
    confidenceLabel,
    valuationSource: "listing_comps",
    compCount: prices.length,
    confidence,
    rangeLow: adjustedLow,
    rangeHigh: adjustedHigh,
    midpoint: adjustedMedian,
    modelType: "listing_derived",
    listingCount: prices.length,
    sourceBasis: "listing_median_adjusted",
  };
}

async function deriveValuationFromSimilarVehicles(input: {
  vehicle: VehicleRecord;
  vehicleId: string;
  zip: string;
  mileage: number;
  condition: string;
}): Promise<ValuationRecord | null> {
  const listingAttempts = await buildListingsFallbackAttempts({
    vehicle: input.vehicle,
    radiusMiles: DEFAULT_UNLOCK_EVALUATION_RADIUS_MILES,
  });
  logger.info(
    {
      label: "VALUE_COMP_DERIVATION_STARTED",
      vehicleId: input.vehicleId,
      zip: input.zip,
      mileage: input.mileage,
      condition: input.condition,
      attemptCount: listingAttempts.length,
      radiiChecked: LISTING_DERIVATION_RADIUS_MILES,
      attempts: listingAttempts.map((attempt) => ({
        strategy: attempt.strategy,
        year: attempt.vehicle.year,
        make: attempt.vehicle.make,
        model: attempt.vehicle.model,
        trim: attempt.vehicle.trim ?? null,
        radiusMiles: attempt.radiusMiles,
      })),
    },
    "VALUE_COMP_DERIVATION_STARTED",
  );

  const collectedListings: ListingRecord[] = [];
  const seenListingIds = new Set<string>();

  for (const attempt of listingAttempts) {
    for (const radiusMiles of LISTING_DERIVATION_RADIUS_MILES) {
      const cachedDescriptor = buildCacheDescriptor({ vehicle: attempt.vehicle });
      const cachedListingsKey = cachedDescriptor
        ? getListingsCacheKey(cachedDescriptor, { zip: input.zip, radiusMiles })
        : null;
      const familyCachedListingsKey = cachedDescriptor
        ? getFamilyListingsCacheKey(cachedDescriptor, { zip: input.zip, radiusMiles })
        : null;
      const cachedListingsRows = [
        cachedListingsKey ? await repositories.listingsCache.findByCacheKey(cachedListingsKey).catch(() => null) : null,
        familyCachedListingsKey ? await repositories.listingsCache.findByCacheKey(familyCachedListingsKey).catch(() => null) : null,
      ].filter((row): row is NonNullable<typeof row> => Boolean(row));

      for (const cachedRow of cachedListingsRows) {
        for (const listing of cachedRow.responseJson.data ?? []) {
          if (seenListingIds.has(listing.id) || !isBelievableListing(listing)) {
            continue;
          }
          seenListingIds.add(listing.id);
          collectedListings.push(listing);
        }
      }

      const listings = await repositories.listingResults.listByVehicle({
        vehicleId: attempt.vehicle.id,
        zip: input.zip,
        radiusMiles,
      }).catch(() => []);

      for (const listing of listings) {
        if (seenListingIds.has(listing.id) || !isBelievableListing(listing)) {
          continue;
        }
        seenListingIds.add(listing.id);
        collectedListings.push(listing);
      }
    }

    if (collectedListings.length >= 1 && attempt.strategy.startsWith("adjacent-year")) {
      // Adjacent-year rescue is already good enough to produce a usable estimate.
      break;
    }
  }

  const derived = buildDerivedValuationFromListings({
    vehicle: input.vehicle,
    vehicleId: input.vehicleId,
    zip: input.zip,
    mileage: input.mileage,
    condition: input.condition,
    listings: collectedListings,
  });
  if (!derived) {
    logger.info(
      {
        label: "VALUE_COMP_DERIVATION_REJECTED",
        vehicleId: input.vehicleId,
        zip: input.zip,
        acceptedListingsCount: collectedListings.length,
        reason: collectedListings.length === 0 ? "no_believable_listings" : "insufficient_pricing_data",
      },
      "VALUE_COMP_DERIVATION_REJECTED",
    );
    return null;
  }

  logger.info(
    {
      label: "VALUE_COMP_DERIVATION_RESULT",
      vehicleId: input.vehicleId,
      zip: input.zip,
      acceptedListingsCount: collectedListings.length,
      listingCount: derived.listingCount ?? null,
      sourceLabel: derived.sourceLabel ?? null,
      confidenceLabel: derived.confidenceLabel ?? null,
      low: derived.low ?? null,
      median: derived.median ?? null,
      high: derived.high ?? null,
    },
    "VALUE_COMP_DERIVATION_RESULT",
  );
  return derived;
}

function buildConditionAwareValuation(input: {
  valuation: ValuationRecord;
  vehicle: VehicleRecord | null;
  selectedCondition: string;
}) {
  if (
    input.valuation.status === "loaded_value" ||
    input.valuation.status === "loaded_listing_range" ||
    (input.valuation.status == null &&
      (input.valuation.modelType === "provider_range" || input.valuation.modelType === "listing_derived"))
  ) {
    return buildConditionSetValuation({
      valuation: input.valuation,
      vehicle: input.vehicle,
      selectedCondition: input.selectedCondition,
    });
  }

  return input.valuation;
}

async function buildValueFallbackAttempts(vehicle: VehicleRecord): Promise<ValueLookupAttempt[]> {
  const attempts: ValueLookupAttempt[] = [];
  const pushAttempt = (attempt: ValueLookupAttempt | null) => {
    if (!attempt) {
      return;
    }
    const key = vehicleLookupKey(attempt.vehicle, 0);
    if (!attempts.some((entry) => vehicleLookupKey(entry.vehicle, 0) === key)) {
      attempts.push(attempt);
    }
  };

  pushAttempt({ strategy: "exact-year-make-model", vehicle: { ...vehicle } });
  if (hasExplicitTrimValue(vehicle.trim)) {
    pushAttempt({ strategy: "same-year-any-trim", vehicle: { ...vehicle, trim: "" } });
  }
  pushAttempt(
    buildSpecialtyFamilyVehicleVariant(vehicle)
      ? { strategy: "same-year-family-model", vehicle: buildSpecialtyFamilyVehicleVariant(vehicle)! }
      : null,
  );
  if (vehicle.year > 1981) {
    pushAttempt({ strategy: "adjacent-year-previous", vehicle: { ...vehicle, year: vehicle.year - 1, trim: "" } });
  }
  pushAttempt({ strategy: "adjacent-year-next", vehicle: { ...vehicle, year: vehicle.year + 1, trim: "" } });
  pushAttempt(
    buildSpecialtyFamilyVehicleVariant(vehicle, {
      year: Math.max(1981, vehicle.year - 1),
    })
      ? {
          strategy: "adjacent-year-family-model",
          vehicle: buildSpecialtyFamilyVehicleVariant(vehicle, { year: Math.max(1981, vehicle.year - 1) })!,
        }
      : null,
  );
  pushAttempt(
    buildSpecialtyFamilyVehicleVariant(vehicle, {
      year: vehicle.year + 1,
    })
      ? {
          strategy: "adjacent-year-family-model",
          vehicle: buildSpecialtyFamilyVehicleVariant(vehicle, { year: vehicle.year + 1 })!,
        }
      : null,
  );

  const descriptor = buildCacheDescriptor({ vehicle });
  if (!descriptor) {
    return attempts;
  }

  const familyCandidates = await repositories.canonicalVehicles.searchPromoted({
    normalizedMake: descriptor.normalizedMake,
    normalizedModel: descriptor.normalizedModel,
  });
  const generationBucket = getGenerationBucket(vehicle);
  const sameGeneration = familyCandidates
    .map((candidate) => mapCanonicalVehicleToRecord(candidate))
    .filter((candidate): candidate is VehicleRecord => Boolean(candidate))
    .find((candidate) => {
      if (candidate.id === vehicle.id) {
        return false;
      }
      if (generationBucket) {
        return getGenerationBucket(candidate) === generationBucket;
      }
      return Math.abs(candidate.year - vehicle.year) <= 3;
    });
  pushAttempt(sameGeneration ? { strategy: "same-generation", vehicle: { ...sameGeneration, trim: "" } } : null);
  if (!sameGeneration) {
    pushAttempt({ strategy: "same-generation", vehicle: { ...vehicle, trim: "" } });
  }

  const sameMakeCandidates = await repositories.canonicalVehicles.searchPromoted({
    normalizedMake: descriptor.normalizedMake,
  });
  const trimFamily = getTrimFamily(vehicle);
  const similarVehicle = sameMakeCandidates
    .map((candidate) => mapCanonicalVehicleToRecord(candidate))
    .filter((candidate): candidate is VehicleRecord => Boolean(candidate))
    .find((candidate) => {
      if (candidate.id === vehicle.id) {
        return false;
      }
      if (candidate.vehicleType !== vehicle.vehicleType) {
        return false;
      }
      if (Math.abs(candidate.year - vehicle.year) > 4) {
        return false;
      }
      if (normalizeVehicleLookupText(candidate.bodyStyle) !== normalizeVehicleLookupText(vehicle.bodyStyle)) {
        return false;
      }
      return trimFamily ? getTrimFamily(candidate) === trimFamily : Math.abs(candidate.year - vehicle.year) <= 2;
    });
  pushAttempt(similarVehicle ? { strategy: "similar-vehicle", vehicle: { ...similarVehicle, trim: "" } } : null);

  return attempts;
}

function ensureValueAttempts(vehicle: VehicleRecord, attempts: ValueLookupAttempt[]) {
  if (attempts.length > 0) {
    return attempts;
  }

  const fallbackAttempts: ValueLookupAttempt[] = [{ strategy: "exact-year-make-model", vehicle: { ...vehicle } }];
  if (hasExplicitTrimValue(vehicle.trim)) {
    fallbackAttempts.push({ strategy: "same-year-any-trim", vehicle: { ...vehicle, trim: "" } });
  }
  const familyVariant = buildSpecialtyFamilyVehicleVariant(vehicle);
  if (familyVariant) {
    fallbackAttempts.push({ strategy: "same-year-family-model", vehicle: familyVariant });
  }
  if (vehicle.year > 1981) {
    fallbackAttempts.push({ strategy: "adjacent-year-previous", vehicle: { ...vehicle, year: vehicle.year - 1, trim: "" } });
  }
  fallbackAttempts.push({ strategy: "adjacent-year-next", vehicle: { ...vehicle, year: vehicle.year + 1, trim: "" } });
  const previousFamily = buildSpecialtyFamilyVehicleVariant(vehicle, { year: Math.max(1981, vehicle.year - 1) });
  const nextFamily = buildSpecialtyFamilyVehicleVariant(vehicle, { year: vehicle.year + 1 });
  if (previousFamily) {
    fallbackAttempts.push({ strategy: "adjacent-year-family-model", vehicle: previousFamily });
  }
  if (nextFamily) {
    fallbackAttempts.push({ strategy: "adjacent-year-family-model", vehicle: nextFamily });
  }
  fallbackAttempts.push({ strategy: "same-generation", vehicle: { ...vehicle, trim: "" } });
  return fallbackAttempts;
}

async function buildListingsFallbackAttempts(input: {
  vehicle: VehicleRecord;
  radiusMiles: number;
}): Promise<ListingsLookupAttempt[]> {
  const attempts: ListingsLookupAttempt[] = [];
  const pushAttempt = (attempt: ListingsLookupAttempt | null) => {
    if (!attempt) {
      return;
    }
    const key = listingsAttemptKey(attempt);
    if (!attempts.some((entry) => listingsAttemptKey(entry) === key)) {
      attempts.push(attempt);
    }
  };

  pushAttempt({
    label: "LISTINGS_EXACT_TRIM_MATCH",
    strategy: "exact-year-make-model",
    vehicle: { ...input.vehicle },
    radiusMiles: input.radiusMiles,
  });

  if (hasExplicitTrimValue(input.vehicle.trim)) {
    pushAttempt({
      label: "LISTINGS_SAME_MODEL_MIXED_TRIMS",
      strategy: "same-year-any-trim",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: input.radiusMiles,
    });
  }
  const familyVariant = buildSpecialtyFamilyVehicleVariant(input.vehicle);
  pushAttempt(
    familyVariant
      ? {
          label: "LISTINGS_MODEL_NORMALIZED",
          strategy: "same-year-family-model",
          vehicle: familyVariant,
          radiusMiles: Math.max(input.radiusMiles, 100),
        }
      : null,
  );

  if (input.vehicle.year > 1981) {
    pushAttempt({
      label: "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS",
      strategy: "adjacent-year-previous",
      vehicle: { ...input.vehicle, year: input.vehicle.year - 1, trim: "" },
      radiusMiles: input.radiusMiles,
    });
  }

  pushAttempt({
    label: "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS",
    strategy: "adjacent-year-next",
    vehicle: { ...input.vehicle, year: input.vehicle.year + 1, trim: "" },
    radiusMiles: input.radiusMiles,
  });
  if (input.vehicle.year > 1982) {
    pushAttempt({
      label: "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS",
      strategy: "adjacent-year-previous-2",
      vehicle: { ...input.vehicle, year: input.vehicle.year - 2, trim: "" },
      radiusMiles: input.radiusMiles,
    });
  }
  pushAttempt({
    label: "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS",
    strategy: "adjacent-year-next-2",
    vehicle: { ...input.vehicle, year: input.vehicle.year + 2, trim: "" },
    radiusMiles: input.radiusMiles,
  });
  const familyPrevious = buildSpecialtyFamilyVehicleVariant(input.vehicle, { year: Math.max(1981, input.vehicle.year - 1) });
  const familyNext = buildSpecialtyFamilyVehicleVariant(input.vehicle, { year: input.vehicle.year + 1 });
  pushAttempt(
    familyPrevious
      ? {
          label: "LISTINGS_MODEL_NORMALIZED",
          strategy: "adjacent-year-family-model",
          vehicle: familyPrevious,
          radiusMiles: Math.max(input.radiusMiles, 100),
        }
      : null,
  );
  pushAttempt(
    familyNext
      ? {
          label: "LISTINGS_MODEL_NORMALIZED",
          strategy: "adjacent-year-family-model",
          vehicle: familyNext,
          radiusMiles: Math.max(input.radiusMiles, 100),
        }
      : null,
  );
  if (isSpecialtyExoticMake(input.vehicle.make)) {
    pushAttempt({
      label: "LISTINGS_WIDER_RADIUS",
      strategy: "wider-radius-250",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: Math.max(input.radiusMiles, 250),
    });
    pushAttempt({
      label: "LISTINGS_WIDER_RADIUS",
      strategy: "wider-radius-500",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: Math.max(input.radiusMiles, 500),
    });
  } else {
    pushAttempt({
      label: "LISTINGS_WIDER_RADIUS",
      strategy: "wider-radius-250",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: Math.max(input.radiusMiles, 250),
    });
  }

  return attempts;
}

function ensureListingsAttempts(input: {
  vehicle: VehicleRecord;
  radiusMiles: number;
  attempts: ListingsLookupAttempt[];
}) {
  if (input.attempts.length > 0) {
    return input.attempts;
  }

  const fallbackAttempts: ListingsLookupAttempt[] = [
    {
      label: "LISTINGS_EXACT_TRIM_MATCH",
      strategy: "exact-year-make-model",
      vehicle: { ...input.vehicle },
      radiusMiles: input.radiusMiles,
    },
  ];
  if (hasExplicitTrimValue(input.vehicle.trim)) {
    fallbackAttempts.push({
      label: "LISTINGS_SAME_MODEL_MIXED_TRIMS",
      strategy: "same-year-any-trim",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: input.radiusMiles,
    });
  }
  const ensuredFamilyVariant = buildSpecialtyFamilyVehicleVariant(input.vehicle);
  if (ensuredFamilyVariant) {
    fallbackAttempts.push({
      label: "LISTINGS_MODEL_NORMALIZED",
      strategy: "same-year-family-model",
      vehicle: ensuredFamilyVariant,
      radiusMiles: Math.max(input.radiusMiles, 100),
    });
  }
  if (input.vehicle.year > 1981) {
    fallbackAttempts.push({
      label: "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS",
      strategy: "adjacent-year-previous",
      vehicle: { ...input.vehicle, year: input.vehicle.year - 1, trim: "" },
      radiusMiles: input.radiusMiles,
    });
  }
  fallbackAttempts.push({
    label: "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS",
    strategy: "adjacent-year-next",
    vehicle: { ...input.vehicle, year: input.vehicle.year + 1, trim: "" },
    radiusMiles: input.radiusMiles,
  });
  if (input.vehicle.year > 1982) {
    fallbackAttempts.push({
      label: "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS",
      strategy: "adjacent-year-previous-2",
      vehicle: { ...input.vehicle, year: input.vehicle.year - 2, trim: "" },
      radiusMiles: input.radiusMiles,
    });
  }
  fallbackAttempts.push({
    label: "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS",
    strategy: "adjacent-year-next-2",
    vehicle: { ...input.vehicle, year: input.vehicle.year + 2, trim: "" },
    radiusMiles: input.radiusMiles,
  });
  const ensuredPreviousFamily = buildSpecialtyFamilyVehicleVariant(input.vehicle, { year: Math.max(1981, input.vehicle.year - 1) });
  const ensuredNextFamily = buildSpecialtyFamilyVehicleVariant(input.vehicle, { year: input.vehicle.year + 1 });
  if (ensuredPreviousFamily) {
    fallbackAttempts.push({
      label: "LISTINGS_MODEL_NORMALIZED",
      strategy: "adjacent-year-family-model",
      vehicle: ensuredPreviousFamily,
      radiusMiles: Math.max(input.radiusMiles, 100),
    });
  }
  if (ensuredNextFamily) {
    fallbackAttempts.push({
      label: "LISTINGS_MODEL_NORMALIZED",
      strategy: "adjacent-year-family-model",
      vehicle: ensuredNextFamily,
      radiusMiles: Math.max(input.radiusMiles, 100),
    });
  }
  if (isSpecialtyExoticMake(input.vehicle.make)) {
    fallbackAttempts.push({
      label: "LISTINGS_WIDER_RADIUS",
      strategy: "wider-radius-250",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: Math.max(input.radiusMiles, 250),
    });
    fallbackAttempts.push({
      label: "LISTINGS_WIDER_RADIUS",
      strategy: "wider-radius-500",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: Math.max(input.radiusMiles, 500),
    });
  } else {
    fallbackAttempts.push({
      label: "LISTINGS_WIDER_RADIUS",
      strategy: "wider-radius-250",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: Math.max(input.radiusMiles, 250),
    });
  }
  return fallbackAttempts;
}

async function buildPartialSpecFallbackVehicle(vehicle: VehicleRecord): Promise<VehicleRecord | null> {
  const curatedVehicle = applyCuratedSpecialtySpecs(vehicle);
  const descriptor = buildCacheDescriptor({ vehicle });
  if (!descriptor) {
    return hasUsefulSpecBundle(curatedVehicle) ? applyInferredHorsepower(curatedVehicle) : null;
  }

  const familyCandidates = await repositories.canonicalVehicles.searchPromoted({
    normalizedMake: descriptor.normalizedMake,
    normalizedModel: descriptor.normalizedModel,
  });

  const mappedCandidates = familyCandidates
    .map((candidate) => mapCanonicalVehicleToRecord(candidate))
    .filter((candidate): candidate is VehicleRecord => Boolean(candidate))
    .sort((left, right) => Math.abs(left.year - vehicle.year) - Math.abs(right.year - vehicle.year));

  const nearest = mappedCandidates[0] ?? null;
  if (!nearest) {
    return hasUsefulSpecBundle(curatedVehicle) ? applyInferredHorsepower(curatedVehicle) : null;
  }

  return applyInferredHorsepower(
    applyCuratedSpecialtySpecs({
      ...curatedVehicle,
      bodyStyle: coalesceString(curatedVehicle.bodyStyle, nearest.bodyStyle) ?? curatedVehicle.bodyStyle,
      engine: coalesceString(curatedVehicle.engine, nearest.engine) ?? curatedVehicle.engine,
      horsepower: coalescePositiveNumber(curatedVehicle.horsepower, nearest.horsepower),
      torque: coalesceString(curatedVehicle.torque, nearest.torque) ?? curatedVehicle.torque,
      transmission: coalesceString(curatedVehicle.transmission, nearest.transmission) ?? curatedVehicle.transmission,
      drivetrain: coalesceString(curatedVehicle.drivetrain, nearest.drivetrain) ?? curatedVehicle.drivetrain,
      mpgOrRange: coalesceString(curatedVehicle.mpgOrRange, nearest.mpgOrRange) ?? curatedVehicle.mpgOrRange,
      msrp: coalescePositiveNumber(curatedVehicle.msrp, nearest.msrp) ?? curatedVehicle.msrp,
      engineDisplacementL: coalescePositiveNumber(curatedVehicle.engineDisplacementL, nearest.engineDisplacementL),
      cylinders: coalescePositiveNumber(curatedVehicle.cylinders, nearest.cylinders),
      fuelType: coalesceString(curatedVehicle.fuelType, nearest.fuelType),
      doors: coalescePositiveNumber(curatedVehicle.doors, nearest.doors),
    }),
  );
}

function inferHorsepowerFromVehicle(vehicle: VehicleRecord): number | null {
  const make = normalizeVehicleLookupText(vehicle.make);
  const model = normalizeVehicleLookupText(vehicle.model);
  const engine = normalizeVehicleLookupText(vehicle.engine);

  if (make === "honda" && (model === "cr v" || model === "cr-v" || model === "crv")) {
    if (engine.includes("1 5l")) {
      return 190;
    }
    if (engine.includes("2 0l")) {
      return 204;
    }
    return 190;
  }

  if (make === "toyota" && model === "4runner" && engine.includes("4 0l") && engine.includes("v6")) {
    if (vehicle.year >= 2010 && vehicle.year <= 2024) return 270;
    if (vehicle.year >= 2005 && vehicle.year <= 2009) return 236;
  }

  if (engine.includes("1 5l turbo i4")) return 190;
  if (engine.includes("2 0l turbo i4")) return 237;
  if (engine.includes("2 4l i4")) return 185;
  if (engine.includes("5 0l v8")) return 460;

  return null;
}

function applyInferredHorsepower(vehicle: VehicleRecord): VehicleRecord {
  if (typeof vehicle.horsepower === "number" && Number.isFinite(vehicle.horsepower) && vehicle.horsepower > 0) {
    return vehicle;
  }
  const inferredHorsepower = inferHorsepowerFromVehicle(vehicle);
  return inferredHorsepower ? { ...vehicle, horsepower: inferredHorsepower } : vehicle;
}

function getErrorDetails(error: unknown) {
  return {
    message: error instanceof Error ? error.message : "Unknown vehicle service error",
    stack: error instanceof Error ? error.stack : undefined,
    code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
    details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
    hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
  };
}

function getVehicleRangeProfile(vehicle: VehicleRecord | null, anchor: number) {
  const body = normalizeVehicleLookupText(vehicle?.bodyStyle ?? "");
  const make = normalizeVehicleLookupText(vehicle?.make ?? "");
  const model = normalizeVehicleLookupText(vehicle?.model ?? "");
  const isLuxuryOrPerformance =
    /bmw|mercedes|porsche|audi|lexus|tesla|rivian|lucid|ferrari|lamborghini|mclaren|maserati/.test(make) ||
    /m |amg|rs|type r|hellcat|plaid|gt|sport/.test(model);

  let width = 0.07;
  if (/truck|suv|pickup/.test(body)) {
    width = 0.09;
  } else if (/compact|coupe|sedan|hatch/.test(body)) {
    width = 0.06;
  }
  if (anchor >= 60000 || isLuxuryOrPerformance) {
    width += 0.04;
  } else if (anchor <= 22000) {
    width -= 0.01;
  }

  return Math.min(0.16, Math.max(0.05, width));
}

function getConditionMultiplier(condition: string) {
  switch (normalizeCondition(condition)) {
    case "excellent":
      return 1.04;
    case "very_good":
      return 1.02;
    case "good":
      return 1;
    case "fair":
      return 0.95;
    case "poor":
      return 0.9;
    default:
      return 1;
  }
}

function coalesceString(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function coalesceNumber(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function coalescePositiveNumber(...values: Array<number | null | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function isMeaningfulText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "unknown" && normalized !== "unavailable" && normalized !== "n/a";
}

function isMeaningfulCurrencyRange(value: string | null | undefined) {
  return isMeaningfulText(value) && value !== "Unavailable";
}

function hasMarketValue(valuation: ValuationRecord | null) {
  if (!valuation) {
    return false;
  }
  if (isConditionSetValuation(valuation)) {
    return Object.values(valuation.conditionValues ?? {}).some((entry) =>
      [entry.tradeIn, entry.privateParty, entry.dealerRetail, entry.low, entry.median, entry.high].some(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
      ),
    );
  }
  return [valuation.tradeIn, valuation.privateParty, valuation.dealerRetail].some((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
}

function isRetryableUnavailableValuation(valuation: ValuationRecord | null | undefined) {
  if (!valuation) {
    return false;
  }
  return (
    valuation.status === "no_comps_found" ||
    valuation.status === "provider_error" ||
    valuation.status === "specialty_unavailable" ||
    valuation.modelType === "specialty_unavailable"
  );
}

function isBelievableListing(listing: ListingRecord) {
  return Boolean(
    typeof listing.price === "number" &&
      Number.isFinite(listing.price) &&
      listing.price > 0 &&
      (isMeaningfulText(listing.title) || isMeaningfulText(listing.dealer) || isMeaningfulText(listing.location)),
  );
}

function listingDedupeKey(listing: ListingRecord) {
  const url = typeof listing.listingUrl === "string" ? listing.listingUrl.trim().toLowerCase() : "";
  if (url.length > 0) {
    return `url:${url}`;
  }
  const id = typeof listing.id === "string" ? listing.id.trim().toLowerCase() : "";
  if (id.length > 0) {
    return `id:${id}`;
  }
  return [
    listing.year ?? "",
    normalizeListingStrictText(listing.make),
    normalizeListingStrictText(listing.model),
    normalizeListingStrictText(listing.title),
    listing.price ?? "",
    listing.mileage ?? "",
  ].join("|");
}

function appendUniqueListings(current: ListingRecord[], additions: ListingRecord[]) {
  const seen = new Set(current.map(listingDedupeKey));
  const next = [...current];
  for (const listing of additions) {
    const key = listingDedupeKey(listing);
    if (!seen.has(key)) {
      seen.add(key);
      next.push(listing);
    }
  }
  return next;
}

function normalizeListingStrictText(value: string | number | null | undefined) {
  return normalizeVehicleLookupText(typeof value === "number" ? String(value) : value).replace(/[^a-z0-9]+/g, "");
}

function isStrictListingUrl(url: string | null | undefined) {
  if (typeof url !== "string") {
    return false;
  }
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) && !/example\.com/i.test(trimmed);
}

function hasOpenableListingUrl(listing: ListingRecord) {
  if (typeof listing.listingUrl !== "string" || listing.listingUrl.trim().length === 0) {
    return true;
  }
  return isStrictListingUrl(listing.listingUrl);
}

function isHighlanderLikeModel(value: string) {
  return value.includes("highlander") && !value.includes("grandhighlander");
}

function isCrvLikeModel(value: string) {
  return value === "crv" || value === "cr-v" || value === "cr v";
}

const GENERIC_MODEL_VARIANT_SUFFIXES = new Set([
  "allroad",
  "avant",
  "blackwing",
  "cabrio",
  "cabriolet",
  "carrera",
  "convertible",
  "coupe",
  "gran",
  "gt",
  "gts",
  "italia",
  "roadster",
  "sedan",
  "spider",
  "sportback",
  "superfast",
  "touring",
  "unlimited",
  "wagon",
]);

function getProviderFamilyModelAlias(make: string | null | undefined, model: string | null | undefined) {
  const specialtyAliases = getSpecialtyModelAliases(make, model);
  const normalizedCurrentModel = normalizeListingStrictText(model);
  const specialtyAlias =
    specialtyAliases.find((alias) => alias && normalizeListingStrictText(alias) !== normalizedCurrentModel) ?? null;
  if (specialtyAlias) {
    return specialtyAlias;
  }

  const rawModel = String(model ?? "").trim().replace(/\s+/g, " ");
  if (rawModel.length === 0) {
    return null;
  }
  const parts = rawModel.split(" ");
  if (parts.length < 2) {
    return null;
  }

  const first = parts[0] ?? "";
  const second = normalizeVehicleLookupText(parts[1] ?? "");
  const normalizedFirst = normalizeVehicleLookupText(first);
  if (!normalizedFirst) {
    return null;
  }

  if (normalizedFirst === "model" && parts[1]) {
    const alias = `${parts[0]} ${parts[1]}`.trim();
    return normalizeListingStrictText(alias) !== normalizedCurrentModel ? alias : null;
  }

  if (GENERIC_MODEL_VARIANT_SUFFIXES.has(second)) {
    return normalizeListingStrictText(first) !== normalizedCurrentModel ? first : null;
  }

  return null;
}

function buildSpecialtyFamilyVehicleVariant(vehicle: VehicleRecord, overrides?: Partial<VehicleRecord>) {
  const familyAlias = getProviderFamilyModelAlias(vehicle.make, vehicle.model);
  if (!familyAlias) {
    return null;
  }
  return {
    ...vehicle,
    model: familyAlias.toUpperCase() === familyAlias ? familyAlias : familyAlias,
    trim: "",
    ...overrides,
  };
}

function listingModelMatchesRequestedModel(requestedMake: string, requestedModel: string, listingModel: string) {
  if (!requestedModel || !listingModel) {
    return false;
  }

  if (requestedModel === listingModel) {
    return true;
  }

  if (isHighlanderLikeModel(requestedModel)) {
    return isHighlanderLikeModel(listingModel);
  }

  if (isCrvLikeModel(requestedModel)) {
    return isCrvLikeModel(listingModel);
  }

  if (isSpecialtyModelFamilyMatch(requestedMake, requestedModel, listingModel)) {
    return true;
  }

  const normalizedRequested = normalizeListingStrictText(requestedModel);
  const normalizedListing = normalizeListingStrictText(listingModel);
  const requestedFamilyAlias = getProviderFamilyModelAlias(requestedMake, requestedModel);
  const listingFamilyAlias = getProviderFamilyModelAlias(requestedMake, listingModel);
  const normalizedRequestedFamily = normalizeListingStrictText(requestedFamilyAlias);
  const normalizedListingFamily = normalizeListingStrictText(listingFamilyAlias);

  if (normalizedRequestedFamily && normalizedRequestedFamily === normalizedListing) {
    return true;
  }

  if (normalizedListingFamily && normalizedListingFamily === normalizedRequested) {
    return true;
  }

  if (
    normalizedRequestedFamily &&
    normalizedListingFamily &&
    normalizedRequestedFamily === normalizedListingFamily
  ) {
    return true;
  }

  if (normalizedRequested.includes(normalizedListing) || normalizedListing.includes(normalizedRequested)) {
    return true;
  }

  return false;
}

function listingYearMatchesRequestedVehicle(
  listingYear: number,
  vehicle: VehicleRecord,
  yearRange?: { start: number; end: number } | null,
) {
  if (yearRange && Number.isFinite(yearRange.start) && Number.isFinite(yearRange.end)) {
    return listingYear >= yearRange.start - 1 && listingYear <= yearRange.end + 1;
  }
  return Math.abs(listingYear - vehicle.year) <= 2;
}

function getListingsSourceLabel(strategy: ListingsLookupAttempt["strategy"] | null) {
  if (strategy === "exact-year-make-model") {
    return "Exact listings";
  }
  if (strategy === "same-year-any-trim") {
    return "Nearby listings for this model";
  }
  if (strategy === "same-year-family-model" || strategy === "adjacent-year-family-model") {
    return "Based on live MarketCheck listings";
  }
  if (
    strategy === "adjacent-year-previous" ||
    strategy === "adjacent-year-next" ||
    strategy === "adjacent-year-previous-2" ||
    strategy === "adjacent-year-next-2" ||
    strategy === "wider-radius-250" ||
    strategy === "wider-radius-500"
  ) {
    return "Limited comps from a wider live MarketCheck search";
  }
  return "Exact listings";
}

function listingMatchesRequestedVehicle(
  listing: ListingRecord,
  vehicle: VehicleRecord,
  yearRange?: { start: number; end: number } | null,
) {
  if (typeof listing.year !== "number" || !Number.isFinite(listing.year)) {
    return false;
  }

  const requestedMake = normalizeListingStrictText(vehicle.make);
  const requestedModel = normalizeListingStrictText(vehicle.model);
  const listingMake = normalizeListingStrictText(listing.make);
  const listingModel = normalizeListingStrictText(listing.model);

  return (
    requestedMake === listingMake &&
    listingModelMatchesRequestedModel(vehicle.make, requestedModel, listingModel) &&
    listingYearMatchesRequestedVehicle(listing.year, vehicle, yearRange)
  );
}

function filterDisplayableListings(
  listings: ListingRecord[],
  vehicle?: VehicleRecord | null,
  yearRange?: { start: number; end: number } | null,
  logContext?: {
    requestId?: string;
    vehicleId?: string | null;
    zip?: string | null;
    radiusMiles?: number | null;
    make?: string | null;
    model?: string | null;
    condition?: string | null;
  },
) {
  let afterUrlCount = 0;
  let afterMakeModelCount = 0;
  let afterYearCount = 0;
  let sampleRejectedInvalidUrl: Record<string, unknown> | null = null;
  let sampleRejectedMismatch: Record<string, unknown> | null = null;

  const filtered = listings.filter((listing) => {
    if (!isBelievableListing(listing)) {
      return false;
    }

    const rawListingUrl = typeof listing.listingUrl === "string" ? listing.listingUrl.trim() : "";
    if (!hasOpenableListingUrl(listing) && rawListingUrl.length > 0) {
      if (!sampleRejectedInvalidUrl) {
        sampleRejectedInvalidUrl = {
          listingId: listing.id,
          title: listing.title,
          make: listing.make ?? null,
          model: listing.model ?? null,
          year: listing.year ?? null,
          url: listing.listingUrl ?? null,
        };
      }
      logger.warn(
        {
          label: "LISTING_REJECTED_INVALID_URL",
          listingId: listing.id,
          vehicleId: listing.vehicleId,
          url: listing.listingUrl ?? null,
        },
        "LISTING_REJECTED_INVALID_URL",
      );
      return false;
    }
    if (!hasOpenableListingUrl(listing)) {
      logger.info(
        {
          label: "LISTING_URL_MISSING_ALLOWED",
          listingId: listing.id,
          vehicleId: listing.vehicleId,
        },
        "LISTING_URL_MISSING_ALLOWED",
      );
    }
    afterUrlCount += 1;

    if (vehicle) {
      const requestedMake = normalizeListingStrictText(vehicle.make);
      const requestedModel = normalizeListingStrictText(vehicle.model);
      const listingMake = normalizeListingStrictText(listing.make);
      const listingModel = normalizeListingStrictText(listing.model);
      const makeMatches = requestedMake === listingMake;
      const modelMatches = listingModelMatchesRequestedModel(vehicle.make, requestedModel, listingModel);
      if (!makeMatches || !modelMatches) {
        if (!sampleRejectedMismatch) {
          sampleRejectedMismatch = {
            listingId: listing.id,
            title: listing.title,
            make: listing.make ?? null,
            model: listing.model ?? null,
            year: listing.year ?? null,
            url: listing.listingUrl ?? null,
          };
        }
        logger.warn(
          {
            label: "LISTING_REJECTED_MISMATCH",
            listingId: listing.id,
            vehicleId: listing.vehicleId,
            requested: {
              year: vehicle.year,
              yearRange: yearRange ?? null,
              make: vehicle.make,
              model: vehicle.model,
            },
            actual: {
              year: listing.year ?? null,
              make: listing.make ?? null,
              model: listing.model ?? null,
            },
            mismatchStage: "make_model",
          },
          "LISTING_REJECTED_MISMATCH",
        );
        return false;
      }
      afterMakeModelCount += 1;
    }

    if (vehicle && !listingYearMatchesRequestedVehicle(listing.year ?? NaN, vehicle, yearRange)) {
      if (!sampleRejectedMismatch) {
        sampleRejectedMismatch = {
          listingId: listing.id,
          title: listing.title,
          make: listing.make ?? null,
          model: listing.model ?? null,
          year: listing.year ?? null,
          url: listing.listingUrl ?? null,
        };
      }
      logger.warn(
        {
          label: "LISTING_REJECTED_MISMATCH",
          listingId: listing.id,
          vehicleId: listing.vehicleId,
          requested: {
            year: vehicle.year,
            yearRange: yearRange ?? null,
            make: vehicle.make,
            model: vehicle.model,
          },
          actual: {
            year: listing.year ?? null,
            make: listing.make ?? null,
            model: listing.model ?? null,
          },
          mismatchStage: "year",
        },
        "LISTING_REJECTED_MISMATCH",
      );
      return false;
    }
    afterYearCount += 1;

    return true;
  });

  logger.info(
    {
      label: "LISTINGS_FILTERED_RESULT_COUNT",
      requestId: logContext?.requestId ?? null,
      requestedVehicleId: logContext?.vehicleId ?? vehicle?.id ?? null,
      zip: logContext?.zip ?? null,
      radiusMiles: logContext?.radiusMiles ?? null,
      condition: logContext?.condition ?? null,
      requestedMake: logContext?.make ?? vehicle?.make ?? null,
      requestedModel: logContext?.model ?? vehicle?.model ?? null,
      requestedYear: vehicle?.year ?? null,
      requestedYearRange: yearRange ?? null,
      rawCount: listings.length,
      afterUrlCount,
      afterMakeModelCount,
      afterYearCount,
      filteredCount: filtered.length,
      sampleRejectedInvalidUrl,
      sampleRejectedMismatch,
    },
    "LISTINGS_FILTERED_RESULT_COUNT",
  );

  return filtered;
}

function isCrvTraceTarget(input: {
  make?: string | null;
  model?: string | null;
}) {
  const make = normalizeVehicleLookupText(input.make);
  const model = normalizeVehicleLookupText(input.model);
  return make === "honda" && (model === "cr-v" || model === "crv" || model === "cr v");
}

function isCommonVehicleFamily(input: {
  make?: string | null;
  model?: string | null;
}) {
  const make = normalizeVehicleLookupText(input.make);
  const model = normalizeVehicleLookupText(input.model);
  const family = `${make} ${model}`.trim();
  return [
    "cadillac ct4",
    "honda cr v",
    "toyota corolla",
    "toyota camry",
    "honda civic",
    "honda accord",
    "toyota rav4",
    "ford f 150",
    "ford ranger",
    "bmw x3",
  ].includes(family);
}

function hasUsefulSpecBundle(vehicle: VehicleRecord | null) {
  if (!vehicle) {
    return false;
  }
  return Boolean(
    (typeof vehicle.horsepower === "number" && vehicle.horsepower > 0) ||
      isMeaningfulText(vehicle.engine) ||
      (isMeaningfulText(vehicle.bodyStyle) && isMeaningfulText(vehicle.drivetrain)) ||
      isMeaningfulText(vehicle.mpgOrRange) ||
      (typeof vehicle.msrp === "number" && vehicle.msrp > 0),
  );
}

function logCommonVehicleDetailTrace(input: {
  phase: "specs" | "value" | "listings";
  requestId?: string;
  descriptorResolved: boolean;
  vehicle: VehicleRecord | null;
  descriptor: VehicleLookupDescriptor | null | undefined;
  specsCandidateCount: number;
  valueCandidateCount: number;
  listingsCandidateCount: number;
  valuation?: ValuationRecord | null;
  listings?: ListingRecord[];
  thinReason?: string | null;
}) {
  const make = input.vehicle?.make ?? input.descriptor?.make ?? null;
  const model = input.vehicle?.model ?? input.descriptor?.model ?? null;
  if (!isCommonVehicleFamily({ make, model })) {
    return;
  }

  const payload = evaluateVehiclePayloadStrength({
    vehicle: input.vehicle,
    valuation: input.valuation ?? null,
    listings: input.listings ?? [],
  });

  logger.info(
    {
      label: "COMMON_VEHICLE_DETAIL_TRACE",
      phase: input.phase,
      requestId: input.requestId,
      year: input.vehicle?.year ?? input.descriptor?.year ?? null,
      make,
      model,
      normalizedModel: input.descriptor?.normalizedModel ?? null,
      descriptorResolved: input.descriptorResolved,
      candidateSetBuilt:
        input.specsCandidateCount > 0 || input.valueCandidateCount > 0 || input.listingsCandidateCount > 0,
      specsCandidateCount: input.specsCandidateCount,
      valueCandidateCount: input.valueCandidateCount,
      listingsCandidateCount: input.listingsCandidateCount,
      finalPayloadStrength: payload.payloadStrength,
      unlockEligible: payload.unlockEligible,
      detailThinReason:
        input.thinReason ??
        (payload.payloadStrength === "thin" || payload.payloadStrength === "empty"
          ? payload.reasons.join(",") || "common-vehicle-detail-thin"
          : null),
    },
    "COMMON_VEHICLE_DETAIL_TRACE",
  );
}

function countMeaningfulSpecFields(vehicle: VehicleRecord | null) {
  if (!vehicle) {
    return 0;
  }
  const flags = [
    typeof vehicle.horsepower === "number" && Number.isFinite(vehicle.horsepower) && vehicle.horsepower > 0,
    isMeaningfulText(vehicle.engine),
    isMeaningfulText(vehicle.drivetrain),
    isMeaningfulText(vehicle.bodyStyle),
    isMeaningfulText(vehicle.transmission),
    isMeaningfulText(vehicle.mpgOrRange),
    isMeaningfulText(vehicle.fuelType ?? null),
    typeof vehicle.engineDisplacementL === "number" && Number.isFinite(vehicle.engineDisplacementL) && vehicle.engineDisplacementL > 0,
    typeof vehicle.cylinders === "number" && Number.isFinite(vehicle.cylinders) && vehicle.cylinders > 0,
    typeof vehicle.doors === "number" && Number.isFinite(vehicle.doors) && vehicle.doors > 0,
    typeof vehicle.msrp === "number" && Number.isFinite(vehicle.msrp) && vehicle.msrp > 0,
  ];
  return flags.filter(Boolean).length;
}

export function evaluateVehiclePayloadStrength(input: {
  vehicle: VehicleRecord | null;
  valuation: ValuationRecord | null;
  listings: ListingRecord[];
}): PayloadEvaluation {
  const believableListingCount = input.listings.filter(isBelievableListing).length;
  const marketValuePresent = hasMarketValue(input.valuation);
  const meaningfulSpecFieldCount = countMeaningfulSpecFields(input.vehicle);
  const hasHorsepower = typeof input.vehicle?.horsepower === "number" && Number.isFinite(input.vehicle.horsepower) && input.vehicle.horsepower > 0;
  const hasBodyStyle = isMeaningfulText(input.vehicle?.bodyStyle ?? null);
  const hasDrivetrain = isMeaningfulText(input.vehicle?.drivetrain ?? null);
  const hasMinimumSpecTrio = hasHorsepower && hasBodyStyle && hasDrivetrain;
  const unlockEligible =
    believableListingCount >= 1 || marketValuePresent || meaningfulSpecFieldCount >= 5 || hasMinimumSpecTrio;

  let payloadStrength: PayloadEvaluation["payloadStrength"] = "empty";
  if (
    (believableListingCount >= 2 && marketValuePresent) ||
    (marketValuePresent && meaningfulSpecFieldCount >= 5) ||
    believableListingCount >= 2 ||
    meaningfulSpecFieldCount >= 7
  ) {
    payloadStrength = "strong";
  } else if (unlockEligible) {
    payloadStrength = "usable";
  } else if (meaningfulSpecFieldCount > 0 || believableListingCount > 0 || marketValuePresent) {
    payloadStrength = "thin";
  }

  const reasons: string[] = [];
  if (!hasHorsepower) reasons.push("horsepower_missing");
  if (!hasBodyStyle) reasons.push("body_style_missing");
  if (!hasDrivetrain) reasons.push("drivetrain_missing");
  if (!marketValuePresent) reasons.push("market_value_missing");
  if (believableListingCount === 0) reasons.push("believable_listings_missing");
  if (meaningfulSpecFieldCount < 5) reasons.push("spec_field_count_below_unlock_threshold");

  const dataConfidenceBase =
    payloadStrength === "strong" ? 0.9 : payloadStrength === "usable" ? 0.74 : payloadStrength === "thin" ? 0.42 : 0.16;
  const dataConfidence = Math.min(
    0.98,
    dataConfidenceBase +
      Math.min(0.04, meaningfulSpecFieldCount * 0.006) +
      Math.min(0.03, believableListingCount * 0.015) +
      (marketValuePresent ? 0.03 : 0),
  );

  const unlockRecommendationReason =
    payloadStrength === "strong"
      ? "Strong vehicle details are ready now."
      : payloadStrength === "usable"
        ? "Useful vehicle details are available now."
        : payloadStrength === "thin"
          ? "We found the vehicle, but there is not enough useful detail yet to make an unlock worth it."
          : "We found the vehicle, but this result still needs more useful detail before an unlock would be worth it.";

  return {
    payloadStrength,
    dataConfidence,
    unlockEligible,
    unlockRecommendationReason,
    meaningfulSpecFieldCount,
    believableListingCount,
    hasMarketValue: marketValuePresent,
    reasons,
  };
}

async function enrichVehicleWithNhtsa(vehicle: VehicleRecord): Promise<VehicleRecord> {
  if (!vehicle.vin) {
    return vehicle;
  }

  try {
    const nhtsa = await fetchNhtsaData(vehicle.vin);
    if (!nhtsa) {
      if (vehicle.horsepower == null) {
        logger.warn(
          {
            label: "NHTSA_HORSEPOWER_STILL_NULL",
            vehicleId: vehicle.id,
            vin: vehicle.vin,
            source: "nhtsa-empty",
          },
          "Horsepower remains null after NHTSA merge",
        );
      }
      return vehicle;
    }

    const engineParts = [
      typeof nhtsa.engineDisplacementL === "number" ? `${nhtsa.engineDisplacementL}L` : null,
      typeof nhtsa.cylinders === "number" ? `${nhtsa.cylinders}-cyl` : null,
      nhtsa.fuelType,
    ].filter((part): part is string => Boolean(part));
    const nhtsaEngine = engineParts.length > 0 ? engineParts.join(" ") : null;

    const enriched: VehicleRecord = {
      ...vehicle,
      make: coalesceString(vehicle.make, nhtsa.make) ?? vehicle.make,
      model: coalesceString(vehicle.model, nhtsa.model) ?? vehicle.model,
      year: coalesceNumber(vehicle.year, nhtsa.year) ?? vehicle.year,
      trim: coalesceString(vehicle.trim, nhtsa.trim) ?? vehicle.trim,
      bodyStyle: coalesceString(vehicle.bodyStyle, nhtsa.bodyStyle) ?? vehicle.bodyStyle,
      engine: coalesceString(vehicle.engine, nhtsaEngine) ?? vehicle.engine,
      horsepower: coalescePositiveNumber(vehicle.horsepower, nhtsa.horsepower),
      engineDisplacementL: coalescePositiveNumber(vehicle.engineDisplacementL, nhtsa.engineDisplacementL),
      cylinders: coalescePositiveNumber(vehicle.cylinders, nhtsa.cylinders),
      fuelType: coalesceString(vehicle.fuelType, nhtsa.fuelType),
      doors: coalescePositiveNumber(vehicle.doors, nhtsa.doors),
      drivetrain: coalesceString(vehicle.drivetrain, nhtsa.drivetrain) ?? vehicle.drivetrain,
      mpgOrRange: vehicle.mpgOrRange,
      transmission: vehicle.transmission,
      torque: vehicle.torque,
      msrp: vehicle.msrp,
      colors: vehicle.colors,
      vehicleType: vehicle.vehicleType,
      vin: vehicle.vin,
    };

    if (enriched.horsepower == null) {
      logger.warn(
        {
          label: "NHTSA_HORSEPOWER_STILL_NULL",
          vehicleId: vehicle.id,
          vin: vehicle.vin,
          existingHorsepower: vehicle.horsepower ?? null,
          nhtsaHorsepower: nhtsa.horsepower,
        },
        "Horsepower remains null after NHTSA merge",
      );
    }

    return enriched;
  } catch (error) {
    logger.warn(
      {
        label: "NHTSA_ENRICHMENT_FAILED",
        vehicleId: vehicle.id,
        vin: vehicle.vin,
        error: error instanceof Error ? error.message : "Unknown NHTSA enrichment error",
      },
      "NHTSA enrichment failed",
    );
    if (vehicle.horsepower == null) {
      logger.warn(
        {
          label: "NHTSA_HORSEPOWER_STILL_NULL",
          vehicleId: vehicle.id,
          vin: vehicle.vin,
          source: "nhtsa-error",
        },
        "Horsepower remains null after NHTSA merge",
      );
    }
    return vehicle;
  }
}

function buildDynamicRange(center: number, widthRatio: number) {
  return {
    low: Math.round(center * (1 - widthRatio)),
    high: Math.round(center * (1 + widthRatio)),
  };
}

function shapeValuationRecord(input: {
  valuation: ValuationRecord;
  vehicle: VehicleRecord | null;
  source: "cache" | "provider" | "stored";
}) {
  const valuation = { ...input.valuation };
  if (valuation.status === "loaded_condition_set" && valuation.conditionValues) {
    const selectedCondition = normalizeSupportedValueCondition(valuation.condition);
    const selected = valuation.conditionValues[selectedCondition];
    valuation.baseCondition = valuation.baseCondition ?? selectedCondition;
    valuation.condition = selectedCondition;
    valuation.tradeIn = selected.tradeIn;
    valuation.privateParty = selected.privateParty;
    valuation.dealerRetail = selected.dealerRetail;
    valuation.low = selected.low ?? null;
    valuation.median = selected.median ?? null;
    valuation.high = selected.high ?? null;
    valuation.sourceBasis = valuation.sourceBasis ?? (valuation.modelType === "listing_derived" ? "listing_median_adjusted" : "provider_direct");
    valuation.valuationSource = valuation.valuationSource ?? (input.source === "cache" ? "cache" : valuation.modelType === "listing_derived" ? "listing_comps" : "provider");
    valuation.compCount = valuation.compCount ?? valuation.listingCount ?? null;
    valuation.rangeLow = valuation.rangeLow ?? valuation.low ?? null;
    valuation.rangeHigh = valuation.rangeHigh ?? valuation.high ?? null;
    valuation.midpoint = valuation.midpoint ?? valuation.median ?? null;
    valuation.confidence =
      valuation.confidence ??
      (valuation.compCount != null ? (valuation.compCount <= 2 ? "limited" : valuation.compCount >= 6 ? "moderate" : "limited") : "moderate");
    return valuation;
  }
  if (
    valuation.status === "specialty_unavailable" ||
    valuation.status === "provider_error" ||
    valuation.status === "no_comps_found" ||
    valuation.status === "ready_to_load" ||
    valuation.modelType === "specialty_unavailable"
  ) {
    valuation.status =
      valuation.status ??
      (valuation.modelType === "specialty_unavailable" ? "specialty_unavailable" : "ready_to_load");
    valuation.tradeIn = null;
    valuation.privateParty = null;
    valuation.dealerRetail = null;
    valuation.low = valuation.low ?? null;
    valuation.high = valuation.high ?? null;
    valuation.median = valuation.median ?? null;
    valuation.sourceLabel =
      valuation.sourceLabel ??
      (valuation.status === "provider_error"
        ? "Live market data could not be loaded"
        : valuation.status === "no_comps_found"
          ? "No live market comps found"
          : "Specialty market value unavailable");
    valuation.confidenceLabel =
      valuation.confidenceLabel ??
      (valuation.status === "provider_error"
        ? "Live market data could not be loaded."
        : valuation.status === "no_comps_found"
          ? "No live market comps found for this ZIP, mileage, and condition."
          : "Load live market value. Specialty pricing can vary widely by mileage, condition, options, service history, and provenance.");
    valuation.valuationSource = valuation.valuationSource ?? "unavailable";
    valuation.compCount = valuation.compCount ?? valuation.listingCount ?? null;
    valuation.rangeLow = valuation.rangeLow ?? null;
    valuation.rangeHigh = valuation.rangeHigh ?? null;
    valuation.midpoint = valuation.midpoint ?? null;
    valuation.confidence = valuation.confidence ?? "unavailable";
    valuation.unavailableReason = valuation.unavailableReason ?? valuation.reason ?? null;
    return valuation;
  }
  valuation.status = valuation.status ?? (valuation.modelType === "listing_derived" ? "loaded_listing_range" : "loaded_value");
  const providerRangeAvailable =
    typeof valuation.privatePartyLow === "number" &&
    typeof valuation.privatePartyHigh === "number" &&
    typeof valuation.tradeInLow === "number" &&
    typeof valuation.tradeInHigh === "number" &&
    typeof valuation.dealerRetailLow === "number" &&
    typeof valuation.dealerRetailHigh === "number";
  const modelType =
    valuation.modelType && valuation.modelType !== "modeled"
      ? valuation.modelType
      : providerRangeAvailable
        ? "provider_range"
        : "estimated_depreciation";
  if (valuation.status === "loaded_listing_range") {
    valuation.low = valuation.low ?? valuation.privatePartyLow ?? valuation.tradeInLow ?? valuation.dealerRetailLow ?? null;
    valuation.high = valuation.high ?? valuation.privatePartyHigh ?? valuation.tradeInHigh ?? valuation.dealerRetailHigh ?? null;
    valuation.median = valuation.median ?? valuation.privateParty ?? null;
  }
  valuation.valuationSource =
    valuation.valuationSource ??
    (input.source === "cache" ? "cache" : modelType === "listing_derived" ? "listing_comps" : "provider");
  valuation.compCount = valuation.compCount ?? valuation.listingCount ?? null;
  valuation.rangeLow =
    valuation.rangeLow ?? valuation.low ?? valuation.privatePartyLow ?? valuation.tradeInLow ?? valuation.dealerRetailLow ?? null;
  valuation.rangeHigh =
    valuation.rangeHigh ?? valuation.high ?? valuation.privatePartyHigh ?? valuation.tradeInHigh ?? valuation.dealerRetailHigh ?? null;
  valuation.midpoint = valuation.midpoint ?? valuation.median ?? valuation.privateParty ?? null;
  logger.info(
    {
      label: "VALUE_MODEL_TYPE_SELECTED",
      vehicleId: valuation.vehicleId,
      source: input.source,
      modelType,
      providerRangeAvailable,
    },
    "VALUE_MODEL_TYPE_SELECTED",
  );

  if (providerRangeAvailable) {
    logger.info(
      {
        label: "VALUE_PROVIDER_RANGE_USED",
        vehicleId: valuation.vehicleId,
        fields: ["price.min", "price.median", "price.max", "price.mean"],
        source: input.source,
      },
      "VALUE_PROVIDER_RANGE_USED",
    );
  } else {
    const tradeIn = valuation.tradeIn as number;
    const privateParty = valuation.privateParty as number;
    const dealerRetail = valuation.dealerRetail as number;
    const privateWidth = getVehicleRangeProfile(input.vehicle, privateParty);
    const retailWidth = Math.min(0.18, privateWidth + 0.015);
    const tradeWidth = Math.max(0.04, privateWidth - 0.01);
    const tradeRange = buildDynamicRange(tradeIn, tradeWidth);
    const privateRange = buildDynamicRange(privateParty, privateWidth);
    const retailRange = buildDynamicRange(dealerRetail, retailWidth);
    valuation.tradeInLow = tradeRange.low;
    valuation.tradeInHigh = tradeRange.high;
    valuation.privatePartyLow = privateRange.low;
    valuation.privatePartyHigh = privateRange.high;
    valuation.dealerRetailLow = retailRange.low;
    valuation.dealerRetailHigh = retailRange.high;
    valuation.modelType = valuation.modelType ?? "estimated_depreciation";
    logger.info(
      {
        label: "VALUE_DYNAMIC_RANGE_APPLIED",
        vehicleId: valuation.vehicleId,
        source: input.source,
        bodyStyle: input.vehicle?.bodyStyle ?? null,
        width: privateWidth,
        anchor: valuation.privateParty,
      },
      "VALUE_DYNAMIC_RANGE_APPLIED",
    );
  }

  const exactTrimMatch = Boolean(input.vehicle?.trim && input.vehicle.trim.trim().length > 0);
  const confidenceLabel =
    modelType === "provider_range"
      ? exactTrimMatch
        ? "High confidence"
        : "Moderate confidence"
      : modelType === "estimated_depreciation"
        ? "Built from vehicle year, class, and original pricing data."
        : modelType === "estimated_family_model"
          ? "Built from vehicle year, class, and family pricing data."
      : exactTrimMatch
        ? "Moderate confidence"
        : "Limited data";
  const sourceLabel =
    modelType === "provider_range"
      ? "Based on market data"
      : modelType === "estimated_family_model"
        ? "Estimated from vehicle family data"
        : "Estimated from vehicle data";

  const preserveModeledFallbackLabel = valuation.valuationSource === "modeled_fallback";
  valuation.confidenceLabel = preserveModeledFallbackLabel ? valuation.confidenceLabel ?? confidenceLabel : confidenceLabel;
  valuation.sourceLabel = preserveModeledFallbackLabel ? valuation.sourceLabel ?? sourceLabel : sourceLabel;
  valuation.confidence =
    valuation.confidence ??
    (modelType === "provider_range"
      ? exactTrimMatch
        ? "high"
        : "moderate"
      : modelType === "listing_derived" || preserveModeledFallbackLabel
        ? "limited"
        : "moderate");
  logger.info(
    {
      label: "VALUE_CONFIDENCE_COMPUTED",
      vehicleId: valuation.vehicleId,
      confidenceLabel,
      exactTrimMatch,
      modelType,
      source: input.source,
    },
    "VALUE_CONFIDENCE_COMPUTED",
  );
  logger.info(
    {
      label: "VALUE_SOURCE_LABEL_SELECTED",
      vehicleId: valuation.vehicleId,
      sourceLabel,
      modelType,
      source: input.source,
    },
    "VALUE_SOURCE_LABEL_SELECTED",
  );
  logger.info(
    {
      label: "VALUE_RESPONSE_SHAPED",
      vehicleId: valuation.vehicleId,
      source: input.source,
      modelType,
      tradeIn: valuation.tradeIn,
      tradeInLow: valuation.tradeInLow,
      tradeInHigh: valuation.tradeInHigh,
      privateParty: valuation.privateParty,
      privatePartyLow: valuation.privatePartyLow,
      privatePartyHigh: valuation.privatePartyHigh,
      dealerRetail: valuation.dealerRetail,
      dealerRetailLow: valuation.dealerRetailLow,
      dealerRetailHigh: valuation.dealerRetailHigh,
      sourceLabel,
      confidenceLabel,
      valuationSource: valuation.valuationSource,
      compCount: valuation.compCount,
      confidence: valuation.confidence,
      rangeLow: valuation.rangeLow,
      rangeHigh: valuation.rangeHigh,
      midpoint: valuation.midpoint,
    },
    "VALUE_RESPONSE_SHAPED",
  );

  return valuation;
}

async function fireAndForgetCleanup(endpointType: "specs" | "values" | "listings") {
  const cacheCleanup =
    endpointType === "specs"
      ? repositories.specsCache.deleteOlderThan(retentionCutoffIso(CACHE_RETENTION_MS.specs))
      : endpointType === "values"
        ? repositories.valuesCache.deleteOlderThan(retentionCutoffIso(CACHE_RETENTION_MS.values))
        : repositories.listingsCache.deleteOlderThan(retentionCutoffIso(CACHE_RETENTION_MS.listings));

  await Promise.allSettled([cacheCleanup, repositories.providerApiUsageLogs.deleteOlderThan(usageLogsCutoffIso())]);
}

async function writeUsageLog(input: Parameters<typeof createProviderApiUsageLog>[0]) {
  const record = createProviderApiUsageLog(input);
  await repositories.providerApiUsageLogs.create(record).catch((error) => {
    logger.warn(
      {
        provider: input.provider,
        endpointType: input.endpointType,
        cacheKey: input.cacheKey,
        error: error instanceof Error ? error.message : "Unknown provider log error",
      },
      "Failed to persist provider API usage log",
    );
  });
}

export class VehicleService {
  async getSearchYears() {
    return repositories.canonicalVehicles.listSearchYears();
  }

  async getSearchMakes(year: number) {
    return repositories.canonicalVehicles.listSearchMakes(year);
  }

  async getSearchModels(input: { year: number; make: string }) {
    return repositories.canonicalVehicles.listSearchModels({
      year: input.year,
      make: normalizeSearchMake(input.make),
    });
  }

  async getSearchTrims(input: { year: number; make: string; model: string }) {
    const aliased = normalizeVehicleBadgeAlias({
      make: input.make,
      model: input.model,
      trim: null,
    });
    const rows = await repositories.canonicalVehicles.listSearchTrims({
      year: input.year,
      make: normalizeSearchMake(aliased.make),
      model: normalizeSearchModel(aliased.model),
    });

    const deduped = new Map<string, { id: string; trim: string; label: string; popularity: number }>();
    for (const row of rows) {
      const label = row.trim?.trim() || "Base";
      const key = normalizeLookupText(label) || label.toLowerCase();
      const current = deduped.get(key);
      if (!current || row.popularityScore > current.popularity) {
        deduped.set(key, {
          id: row.id,
          trim: label,
          label,
          popularity: row.popularityScore,
        });
      }
    }

    return Array.from(deduped.values())
      .map(({ id, trim, label }) => ({ id, trim, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  async searchVehicles(query: {
    year?: string;
    make?: string;
    model?: string;
  }) {
    const searchDecision = providerBudgetService.evaluate({
      provider: providers.specsProviderName,
      operation: "specs",
      userTier: "unknown",
      confidence: null,
      duplicateRequest: false,
      cacheFresh: false,
      providerCooldownActive: false,
    });
    let liveResults: VehicleRecord[] = [];
    if (searchDecision.shouldSimulateSuccess) {
      liveResults = await providerBudgetService.simulateSpecsSearchVehicles(query);
    } else if (searchDecision.allowLiveProvider) {
      if (providers.specsProviderName === "marketcheck") {
        logger.info(
          {
            label: "MARKETCHECK_CALL_SITE",
            route: "vehicle-search",
            service: "VehicleService.searchVehicles",
            provider: providers.specsProviderName,
            reason: "vehicle_search_request",
            requestMeta: {
              allowLive: true,
              year: query.year ?? null,
              make: query.make ?? null,
              model: query.model ?? null,
              caller: "VehicleService.searchVehicles",
              stackTag: "vehicle-search",
            },
          },
          "MARKETCHECK_CALL_SITE",
        );
      }
      liveResults = await providers.specsProvider.searchVehicles({
        ...query,
        requestMeta: {
          reason: "vehicle_search_request",
          allowLive: true,
          year: query.year ?? null,
          make: query.make ?? null,
          model: query.model ?? null,
          caller: "VehicleService.searchVehicles",
          stackTag: "vehicle-search",
        },
      }).catch(() => []);
    } else {
      if (searchDecision.shouldSimulateQuotaExhausted) {
        logger.warn(
          {
            label: "PROVIDER_QUOTA_EXHAUSTED",
            provider: providers.specsProviderName,
            operation: "specs",
            mode: searchDecision.forcedMode,
          },
          "PROVIDER_QUOTA_EXHAUSTED",
        );
      }
      logger.info(
        {
          label: "FALLBACK_USED",
          provider: providers.specsProviderName,
          operation: "specs",
          mode: searchDecision.forcedMode,
          reason: searchDecision.reason,
          route: "vehicle-search",
        },
        "FALLBACK_USED",
      );
    }
    if (liveResults.length > 0) {
      return liveResults;
    }
    const canonicalResults = await repositories.canonicalVehicles.searchPromoted({
      year: query.year ? Number(query.year) : undefined,
      normalizedMake: query.make ? query.make.toLowerCase().trim() : undefined,
      normalizedModel: query.model ? query.model.toLowerCase().trim() : undefined,
    });
    if (canonicalResults.length > 0) {
      return canonicalResults
        .map(mapCanonicalVehicleToRecord)
        .filter((vehicle): vehicle is VehicleRecord => vehicle !== null);
    }
    return repositories.vehicles.search(query);
  }

  async getSpecs(
    input:
      | string
      | {
          requestId?: string;
          vehicleId?: string | null;
          descriptor?: VehicleLookupDescriptor | null;
          allowLive?: boolean;
          fetchReason?: string;
          sourceScreen?: string | null;
        },
  ): Promise<CachedServiceResult<VehicleRecord>> {
    const currentIso = nowIso();
    const request = typeof input === "string" ? { vehicleId: input } : input;
    const allowLive = request.allowLive ?? false;
    const fetchReason = normalizeMarketFetchReason(request.fetchReason);
    const lookup = await resolveLookupContext(request);
    const vehicleId = lookup.lookupVehicleId;
    const vehicle = lookup.vehicle;
    const descriptor = lookup.cacheDescriptor;

    if (vehicle) {
      const enrichedVehicle = applyCuratedSpecialtySpecs(applyInferredHorsepower(vehicle));
      return {
        data: enrichedVehicle,
        source: "cache",
        fetchedAt: currentIso,
        expiresAt: currentIso,
      };
    }

    if (descriptor) {
      const promotedCanonical = await repositories.canonicalVehicles.findPromotedMatch({
        year: descriptor.year,
        normalizedMake: descriptor.normalizedMake,
        normalizedModel: descriptor.normalizedModel,
        normalizedTrim: descriptor.normalizedTrim === "base" ? null : descriptor.normalizedTrim,
      });
      if (promotedCanonical) {
        const canonicalVehicle = mapCanonicalVehicleToRecord(promotedCanonical);
        if (!canonicalVehicle) {
          // Conservative: only promoted rows with populated specs_json are authoritative.
        } else {
          const enrichedCanonicalVehicle = applyCuratedSpecialtySpecs(applyInferredHorsepower(canonicalVehicle));
          await repositories.canonicalVehicles.incrementPopularity(promotedCanonical.canonicalKey);
          return {
            data: enrichedCanonicalVehicle,
            source: "cache",
            fetchedAt: promotedCanonical.updatedAt,
            expiresAt: promotedCanonical.updatedAt,
          };
        }
      }
    }

    const cacheKey = descriptor ? getSpecsCacheKey(descriptor) : null;
    if (cacheKey && providers.specsProviderName === "marketcheck") {
      try {
        const cached = await repositories.specsCache.findByCacheKey(cacheKey);
        if (cached) {
          if (isFresh(cached.expiresAt, currentIso)) {
            await repositories.specsCache.markAccessed(cacheKey, currentIso);
            await writeUsageLog({
              provider: cached.provider,
              endpointType: "specs",
              eventType: cached.responseJson.isEmpty ? "empty_hit" : "cache_hit",
              cacheKey,
              requestSummary: { vehicleId, descriptor: lookup.effectiveDescriptor },
              responseSummary: {
                isEmpty: cached.responseJson.isEmpty,
                fetchedAt: cached.fetchedAt,
                expiresAt: cached.expiresAt,
              },
            });
            if (cached.responseJson.data) {
              logMarketCheckApiCacheHit({
                requestId: request.requestId,
                endpointType: "specs",
                vehicleId,
                cacheKey,
                cacheLevel: "exact",
                year: descriptor?.year ?? null,
                make: descriptor?.make ?? null,
                model: descriptor?.model ?? null,
                trim: descriptor?.trim ?? null,
                resultCount: 1,
              });
              const enrichedCachedVehicle = applyCuratedSpecialtySpecs(applyInferredHorsepower(cached.responseJson.data));
              return {
                data: enrichedCachedVehicle,
                source: "cache",
                fetchedAt: cached.fetchedAt,
                expiresAt: cached.expiresAt,
              };
            }
          } else {
            await writeUsageLog({
              provider: cached.provider,
              endpointType: "specs",
              eventType: "stale_refresh",
              cacheKey,
              requestSummary: { vehicleId, descriptor: lookup.effectiveDescriptor },
              responseSummary: { previousFetchedAt: cached.fetchedAt, previousExpiresAt: cached.expiresAt },
            });
          }
        } else {
          await writeUsageLog({
            provider: providers.specsProviderName,
            endpointType: "specs",
            eventType: "miss",
            cacheKey,
            requestSummary: { vehicleId, descriptor: lookup.effectiveDescriptor },
            responseSummary: {},
          });
        }
      } catch (error) {
        if (!isMissingSupabaseRelationError(error, "provider_vehicle_specs_cache")) {
          throw error;
        }
        logger.warn(
          {
            label: "SPECS_CACHE_UNAVAILABLE",
            requestId: request.requestId,
            cacheKey,
            reason: error instanceof Error ? error.message : "Unknown specs cache error",
          },
          "SPECS_CACHE_UNAVAILABLE",
        );
      }
    }

    try {
      const rawSpecAttempts = lookup.lookupVehicle ? await buildValueFallbackAttempts(lookup.lookupVehicle) : [];
      const specAttempts = lookup.lookupVehicle ? ensureValueAttempts(lookup.lookupVehicle, rawSpecAttempts) : [];
      logger.info(
        {
          label: "DETAIL_DESCRIPTOR_CANDIDATE_SET",
          requestId: request.requestId,
          resolutionMode: lookup.resolutionMode,
          vehicleId,
          attempts: specAttempts.map((attempt) => ({
            strategy: attempt.strategy,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim || null,
            bodyStyle: attempt.vehicle.bodyStyle || null,
          })),
        },
        "DETAIL_DESCRIPTOR_CANDIDATE_SET",
      );

      let liveVehicle: VehicleRecord | null = null;
      let specsWereSimulated = false;
      const specsDecision = isSpecsLiveFetchAllowed(allowLive, fetchReason)
        ? providerBudgetService.evaluate({
            provider: providers.specsProviderName,
            operation: "specs",
            userTier: "unknown",
            confidence: 0.95,
            duplicateRequest: false,
            cacheFresh: false,
            providerCooldownActive: false,
          })
        : {
            allowLiveProvider: false,
            shouldUseFallback: true,
            shouldSimulateSuccess: false,
            shouldSimulateQuotaExhausted: false,
            forcedMode: "live" as const,
            reason: !isMarketCheckEnabled()
              ? "marketcheck-disabled"
              : !allowLive
                ? "auto-specs-disabled"
                : fetchReason !== "user_requested_specs_refresh"
                  ? "specs-explicit-refresh-required"
                  : !isMarketCheckAutoSpecsEnabled()
                    ? "auto-specs-env-disabled"
                    : "specs-live-fetch-disallowed",
          };
      const specLookupAttempts = specAttempts.length > 0 ? specAttempts : lookup.lookupVehicle ? [{ strategy: "exact-year-make-model" as const, vehicle: lookup.lookupVehicle }] : [];
      if (specsDecision.shouldSimulateSuccess) {
        specsWereSimulated = true;
        for (const attempt of specLookupAttempts) {
          liveVehicle = await providerBudgetService.simulateVehicleSpecs({
            vehicleId: getSimulatedProviderVehicleId({ requestedVehicleId: vehicleId, attemptVehicle: attempt.vehicle }),
            vehicle: attempt.vehicle,
          });
          if (liveVehicle) {
            break;
          }
        }
      } else if (specsDecision.allowLiveProvider) {
        for (const attempt of specLookupAttempts) {
          logMarketCheckApiFallbackAttempt({
            requestId: request.requestId,
            endpointType: "specs",
            vehicleId,
            cacheKey,
            strategy: attempt.strategy,
            reason: "vehicle_specs_request",
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim ?? null,
          });
          if (providers.specsProviderName === "marketcheck") {
            logger.info(
              {
                label: "MARKETCHECK_CALL_SITE",
                route: "vehicle-specs",
                service: "VehicleService.getSpecs",
                provider: providers.specsProviderName,
                reason: "vehicle_specs_request",
                requestMeta: {
                  requestId: request.requestId,
                  allowLive,
                  vehicleId,
                  cacheKey,
                  sourceScreen: request.sourceScreen ?? "vehicleDetail",
                  year: attempt.vehicle.year,
                  make: attempt.vehicle.make,
                  model: attempt.vehicle.model,
                  trim: attempt.vehicle.trim ?? null,
                  caller: "VehicleService.getSpecs",
                  stackTag: "vehicle-specs",
                },
              },
              "MARKETCHECK_CALL_SITE",
            );
          }
          liveVehicle = await providers.specsProvider.getVehicleSpecs({
            vehicleId: vehicleId,
            vehicle: attempt.vehicle,
            requestMeta: {
              requestId: request.requestId,
              reason: "vehicle_specs_request",
              allowLive,
              vehicleId,
              cacheKey,
              sourceScreen: request.sourceScreen ?? "vehicleDetail",
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim ?? null,
              caller: "VehicleService.getSpecs",
              stackTag: "vehicle-specs",
            },
          });
          if (liveVehicle) {
            break;
          }
        }
      } else {
        if (providers.specsProviderName === "marketcheck") {
          logger.warn(
            {
              label: "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
              requestId: request.requestId,
              vehicleId,
              action: request.sourceScreen ?? "vehicleDetail",
              endpointType: "specs",
              fetchReason,
              reason: specsDecision.reason,
              allowedCalls: 0,
            },
            "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
          );
        }
        if (specsDecision.shouldSimulateQuotaExhausted) {
          logger.warn(
            {
              label: "PROVIDER_QUOTA_EXHAUSTED",
              provider: providers.specsProviderName,
              operation: "specs",
              vehicleId,
              mode: specsDecision.forcedMode,
            },
            "PROVIDER_QUOTA_EXHAUSTED",
          );
        }
        logger.info(
          {
            label: "FALLBACK_USED",
            provider: providers.specsProviderName,
            operation: "specs",
            vehicleId,
            mode: specsDecision.forcedMode,
            reason: specsDecision.reason,
            route: "vehicle-specs",
          },
          "FALLBACK_USED",
        );
      }

      if (liveVehicle) {
        const enrichedVehicle = applyCuratedSpecialtySpecs(applyInferredHorsepower(liveVehicle.vin ? await enrichVehicleWithNhtsa(liveVehicle) : liveVehicle));
        logCommonVehicleDetailTrace({
          phase: "specs",
          requestId: request.requestId,
          descriptorResolved: Boolean(lookup.effectiveDescriptor),
          vehicle: enrichedVehicle,
          descriptor: lookup.effectiveDescriptor,
          specsCandidateCount: specAttempts.length,
          valueCandidateCount: 0,
          listingsCandidateCount: 0,
        });
        if (!vehicle) {
          await upsertCanonicalVehicleFromProvider({
            vehicle: enrichedVehicle,
            sourceProvider: providers.specsProviderName,
            sourceVehicleId: vehicleId,
          });
        }
        if (!specsWereSimulated && descriptor && cacheKey && providers.specsProviderName === "marketcheck") {
          await repositories.specsCache.upsert(
            createSpecsCacheRow({
              descriptor,
              cacheKey,
              provider: providers.specsProviderName,
              payload: enrichedVehicle,
            }),
          );
          await fireAndForgetCleanup("specs");
        }
        return {
          data: enrichedVehicle,
          source: "provider",
          fetchedAt: currentIso,
          expiresAt: !specsWereSimulated && descriptor && cacheKey && providers.specsProviderName === "marketcheck"
            ? createSpecsCacheRow({
                descriptor,
                cacheKey,
                provider: providers.specsProviderName,
                payload: enrichedVehicle,
              }).expiresAt
            : currentIso,
        };
      }

      const partialSpecFallback = lookup.lookupVehicle ? await buildPartialSpecFallbackVehicle(lookup.lookupVehicle) : null;
      const enrichedPartialSpecFallback = partialSpecFallback ? applyCuratedSpecialtySpecs(applyInferredHorsepower(partialSpecFallback)) : null;
      if (enrichedPartialSpecFallback && hasUsefulSpecBundle(enrichedPartialSpecFallback)) {
        logCommonVehicleDetailTrace({
          phase: "specs",
          requestId: request.requestId,
          descriptorResolved: Boolean(lookup.effectiveDescriptor),
          vehicle: enrichedPartialSpecFallback,
          descriptor: lookup.effectiveDescriptor,
          specsCandidateCount: specAttempts.length,
          valueCandidateCount: 0,
          listingsCandidateCount: 0,
          thinReason: "partial-spec-fallback",
        });
        return {
          data: enrichedPartialSpecFallback,
          source: "cache",
          fetchedAt: currentIso,
          expiresAt: currentIso,
        };
      }

      if (descriptor && cacheKey && providers.specsProviderName === "marketcheck") {
        await repositories.specsCache.upsert(
          createSpecsCacheRow({
            descriptor,
            cacheKey,
            provider: providers.specsProviderName,
            payload: null,
          }),
        );
        await fireAndForgetCleanup("specs");
      }
    } catch (error) {
      if (cacheKey) {
        await writeUsageLog({
          provider: providers.specsProviderName,
          endpointType: "specs",
          eventType: "provider_error",
          cacheKey,
          requestSummary: { vehicleId },
          responseSummary: { error: error instanceof Error ? error.message : "Unknown provider error" },
        });
      }
    }

    throw new AppError(404, "VEHICLE_NOT_FOUND", "Vehicle not found.");
  }

  async getValue(input: {
    requestId?: string;
    vehicleId?: string | null;
    descriptor?: VehicleLookupDescriptor | null;
    zip: string;
    zipSource?: string | null;
    mileage: number;
    condition: string;
    allowLive?: boolean;
    fetchReason?: string;
    sourceScreen?: string | null;
    action?: string | null;
    forceLive?: boolean | null;
  }): Promise<CachedServiceResult<ValuationRecord>> {
    try {
      logger.info(
        {
          label: "VALUE_PIPELINE_STARTED",
          requestId: input.requestId,
          vehicleId: input.vehicleId ?? null,
          descriptor: input.descriptor ?? null,
          zip: input.zip,
          zipSource: input.zipSource ?? null,
          mileage: input.mileage,
          condition: input.condition,
          allowLive: input.allowLive ?? null,
          fetchReason: input.fetchReason ?? null,
          sourceScreen: input.sourceScreen ?? null,
          action: input.action ?? null,
          forceLive: input.forceLive ?? null,
        },
        "VALUE_PIPELINE_STARTED",
      );
      logger.info(
        {
          label: "VALUE_PIPELINE_INPUT",
          requestId: input.requestId,
          vehicleId: input.vehicleId ?? null,
          descriptor: input.descriptor ?? null,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
        },
        "VALUE_PIPELINE_INPUT",
      );
      const currentIso = nowIso();
      const lookup = await resolveLookupContext(input);
      const vehicle = lookup.vehicle;
      const descriptor = lookup.cacheDescriptor;
      const lookupVehicleId = lookup.lookupVehicleId;
      logger.error(
        {
          label: "VALUE_LOOKUP_START",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          vehicleFound: Boolean(vehicle),
          year: vehicle?.year ?? descriptor?.year ?? null,
          yearRange: input.descriptor?.yearRange ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          bodyStyle: vehicle?.bodyStyle ?? input.descriptor?.bodyStyle ?? null,
          zip: input.zip,
          zipSource: input.zipSource ?? null,
          radiusMiles: env.MARKETCHECK_VALUE_RADIUS_MILES,
          mileage: input.mileage,
          condition: input.condition,
        },
        "VALUE_LOOKUP_START",
      );
      logger.info(
        {
          label: "VALUE_API_INPUTS",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          year: vehicle?.year ?? descriptor?.year ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
          oldDisplayedValue: null,
        },
        "VALUE_API_INPUTS",
      );
      logger.info(
        {
          label: "VALUE_RECALC_INPUTS",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          year: vehicle?.year ?? descriptor?.year ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
          oldDisplayedValue: null,
        },
        "VALUE_RECALC_INPUTS",
      );
      const cacheKey = descriptor ? getValuesCacheKey(descriptor, { zip: input.zip, mileage: input.mileage }) : null;
      const familyCacheKey = descriptor ? getFamilyValuesCacheKey(descriptor, { zip: input.zip, mileage: input.mileage }) : null;
      const allowLive = input.allowLive ?? false;
      const fetchReason = normalizeMarketFetchReason(input.fetchReason);
      const normalizedSelectedCondition = normalizeSupportedValueCondition(input.condition);
      const shouldDebugCrv =
        isCrvTraceTarget({ make: vehicle?.make ?? descriptor?.make ?? null, model: vehicle?.model ?? descriptor?.model ?? null }) ||
        (!vehicle && !descriptor && String(lookupVehicleId).includes("cr"));
      const lookupBaseVehicle = lookup.lookupVehicle;
      const isSpecialtyLookupVehicle = Boolean(lookupBaseVehicle && isSpecialtyExoticMake(lookupBaseVehicle.make));
      const isExplicitValueRefresh = isExplicitUserRequestedValueRefresh({
        allowLive,
        fetchReason,
        sourceScreen: input.sourceScreen,
        action: input.action,
        forceLive: input.forceLive,
      });
      logger.info(
        {
          label: "VALUE_REFRESH_STARTED",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          explicitRefresh: isExplicitValueRefresh,
          allowLive,
          fetchReason,
          sourceScreen: input.sourceScreen ?? null,
          action: input.action ?? null,
          forceLive: input.forceLive ?? null,
        },
        "VALUE_REFRESH_STARTED",
      );
      if (isExplicitValueRefresh) {
        logger.info(
          {
            label: "VALUE_FALLBACK_CHAIN_STARTED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            make: lookupBaseVehicle?.make ?? descriptor?.make ?? null,
            model: lookupBaseVehicle?.model ?? descriptor?.model ?? null,
            trim: lookupBaseVehicle?.trim ?? descriptor?.trim ?? null,
            year: lookupBaseVehicle?.year ?? descriptor?.year ?? null,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            specialtySuppressed: isSpecialtyLookupVehicle,
          },
          "VALUE_FALLBACK_CHAIN_STARTED",
        );
      }
      const shouldBypassNegativeValueCache =
        isExplicitValueRefresh || fetchReason === "cached_listings_value_sync";
      if (isSpecialtyLookupVehicle && isExplicitValueRefresh) {
        logger.info(
          {
            label: "VALUE_REFRESH_SPECIALTY_EXPLICIT_PATH_ENTERED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            make: lookupBaseVehicle?.make ?? null,
            model: lookupBaseVehicle?.model ?? null,
            year: lookupBaseVehicle?.year ?? null,
            allowLive,
            fetchReason,
            sourceScreen: input.sourceScreen ?? null,
            action: input.action ?? null,
            forceLive: input.forceLive ?? null,
          },
          "VALUE_REFRESH_SPECIALTY_EXPLICIT_PATH_ENTERED",
        );
        if (env.MARKETCHECK_DISABLE_EXTERNAL_CALLS && lookupBaseVehicle) {
          logger.warn(
            {
              label: "VALUE_REFRESH_BLOCKED_DISABLE_EXTERNAL_CALLS",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              allowLive,
              fetchReason,
              sourceScreen: input.sourceScreen ?? null,
              action: input.action ?? null,
              forceLive: input.forceLive ?? null,
              reason: "external-calls-disabled",
            },
            "VALUE_REFRESH_BLOCKED_DISABLE_EXTERNAL_CALLS",
          );
          const unavailableValue = buildSpecialtyUnavailableValuation({
            vehicle: lookupBaseVehicle,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: normalizeCondition(input.condition),
            sourceLabel: "Live market data could not be loaded",
            confidenceLabel:
              "Live market data could not be loaded. Specialty pricing can vary widely by mileage, condition, options, service history, and provenance.",
          });
          logger.info(
            {
              label: "SPECIALTY_VALUE_UNAVAILABLE_RETURNED",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              reason: "external-calls-disabled",
              fetchReason,
            },
            "SPECIALTY_VALUE_UNAVAILABLE_RETURNED",
          );
          return {
            data: unavailableValue,
            source: "cache",
            fetchedAt: currentIso,
            expiresAt: currentIso,
          };
        }
      }
      logger.info(
        {
          label: "VALUE_LOOKUP_QUERY",
          requestId: input.requestId,
          queryType: "preflight",
          vehicleId: lookupVehicleId,
          year: vehicle?.year ?? descriptor?.year ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          bodyStyle: vehicle?.bodyStyle ?? null,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
          cacheKey,
        },
        "VALUE_LOOKUP_QUERY",
      );
      if (shouldDebugCrv) {
        logger.info(
          {
            label: "DEBUG_CRV_TRACE",
            phase: "value-pipeline-start",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            identificationResult: {
              year: vehicle?.year ?? descriptor?.year ?? null,
              make: vehicle?.make ?? descriptor?.make ?? null,
              model: vehicle?.model ?? descriptor?.model ?? null,
              normalizedModel: descriptor?.normalizedModel ?? null,
            },
            valuePipeline: {
              vehicleResolved: Boolean(vehicle),
              descriptorResolved: Boolean(descriptor),
              familyCacheKey,
              exactCacheKey: cacheKey,
              resolutionMode: lookup.resolutionMode,
              invalidVehicleId: lookup.invalidVehicleId,
            },
          },
          "DEBUG_CRV_TRACE",
        );
      }
      if (cacheKey && providers.valueProviderName === "marketcheck") {
        const cacheDescriptor = descriptor;
        logger.info(
          {
            label: "VALUE_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "cache-read",
            vehicleId: lookupVehicleId,
            cacheKey,
            year: cacheDescriptor?.year ?? null,
            yearRange: input.descriptor?.yearRange ?? null,
            make: cacheDescriptor?.make ?? null,
            model: cacheDescriptor?.model ?? null,
            trim: cacheDescriptor?.trim ?? null,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
          },
          "VALUE_LOOKUP_QUERY",
        );
        const cached = await repositories.valuesCache.findByCacheKey(cacheKey);
        if (cached) {
          if (isFresh(cached.expiresAt, currentIso)) {
            await repositories.valuesCache.markAccessed(cacheKey, currentIso);
            await writeUsageLog({
              provider: cached.provider,
              endpointType: "values",
              eventType: cached.responseJson.isEmpty ? "empty_hit" : "cache_hit",
              cacheKey,
              requestSummary: input,
              responseSummary: { isEmpty: cached.responseJson.isEmpty, expiresAt: cached.expiresAt },
            });
            if (cached.responseJson.data) {
              const shaped = shapeValuationRecord({
                valuation: buildConditionAwareValuation({
                  valuation: cached.responseJson.data,
                  vehicle,
                  selectedCondition: normalizedSelectedCondition,
                }),
                vehicle,
                source: "cache",
              });
              if (shouldBypassNegativeValueCache && isRetryableUnavailableValuation(shaped)) {
                logger.info(
                  {
                    label: "VALUE_EXPLICIT_REFRESH_BYPASSING_NEGATIVE_CACHE",
                    requestId: input.requestId,
                    vehicleId: lookupVehicleId,
                    cacheKey,
                    cacheLevel: "exact",
                    status: shaped.status ?? null,
                    reason: shaped.reason ?? null,
                    fetchReason,
                  },
                  "VALUE_EXPLICIT_REFRESH_BYPASSING_NEGATIVE_CACHE",
                );
              } else if (isSpecialtyLookupVehicle && isGenericFallbackValuation(shaped)) {
                logger.info(
                  {
                    label: "SPECIALTY_GENERIC_VALUE_CACHE_REJECTED",
                    requestId: input.requestId,
                    vehicleId: lookupVehicleId,
                    cacheKey,
                    cacheLevel: "exact",
                    modelType: shaped.modelType ?? null,
                    sourceLabel: shaped.sourceLabel ?? null,
                    explicitRefresh: isExplicitValueRefresh,
                  },
                  "SPECIALTY_GENERIC_VALUE_CACHE_REJECTED",
                );
                if (isExplicitValueRefresh) {
                  logger.info(
                    {
                      label: "SPECIALTY_VALUE_REFRESH_BYPASSING_GENERIC_CACHE",
                      requestId: input.requestId,
                      vehicleId: lookupVehicleId,
                      cacheKey,
                      cacheLevel: "exact",
                    },
                    "SPECIALTY_VALUE_REFRESH_BYPASSING_GENERIC_CACHE",
                  );
                } else if (lookupBaseVehicle) {
                  const unavailableValue = buildSpecialtyUnavailableValuation({
                    vehicle: lookupBaseVehicle,
                    vehicleId: lookupVehicleId,
                    zip: input.zip,
                    mileage: input.mileage,
                    condition: normalizeCondition(input.condition),
                  });
                  logger.info(
                    {
                      label: "SPECIALTY_VALUE_UNAVAILABLE_RETURNED",
                      requestId: input.requestId,
                      vehicleId: lookupVehicleId,
                      reason: "generic-exact-cache-rejected",
                      fetchReason,
                    },
                    "SPECIALTY_VALUE_UNAVAILABLE_RETURNED",
                  );
                  return {
                    data: unavailableValue,
                    source: "cache",
                    fetchedAt: cached.fetchedAt,
                    expiresAt: cached.expiresAt,
                  };
                }
              } else {
                logCacheHitProviderSkip({
                  requestId: input.requestId,
                  vehicleId: lookupVehicleId,
                  operation: "value",
                  cacheLevel: "exact",
                });
                logMarketCheckApiCacheHit({
                  requestId: input.requestId,
                  endpointType: "value",
                  vehicleId: lookupVehicleId,
                  cacheKey,
                  cacheLevel: "exact",
                  year: cacheDescriptor?.year ?? null,
                  make: cacheDescriptor?.make ?? null,
                  model: cacheDescriptor?.model ?? null,
                  trim: cacheDescriptor?.trim ?? null,
                  zip: input.zip,
                  mileage: input.mileage,
                  condition: input.condition,
                  resultCount: 1,
                });
              logger.info(
                {
                  label: "VALUE_CONDITION_COMPARISON",
                  requestId: input.requestId,
                  vehicleId: lookupVehicleId,
                  condition: input.condition,
                  cacheKey,
                  source: "cache",
                  value: shaped,
                },
                "VALUE_CONDITION_COMPARISON",
              );
              return {
                data: shaped,
                source: "cache",
                fetchedAt: cached.fetchedAt,
                expiresAt: cached.expiresAt,
              };
              }
            }
          } else {
            await writeUsageLog({
              provider: cached.provider,
              endpointType: "values",
              eventType: "stale_refresh",
              cacheKey,
              requestSummary: input,
              responseSummary: { previousFetchedAt: cached.fetchedAt, previousExpiresAt: cached.expiresAt },
            });
          }
        } else {
          await writeUsageLog({
            provider: providers.valueProviderName,
            endpointType: "values",
            eventType: "miss",
            cacheKey,
            requestSummary: input,
            responseSummary: {},
          });
        }
      }

      if (familyCacheKey && providers.valueProviderName === "marketcheck") {
        logger.info(
          {
            label: "VALUE_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "family-cache-read",
            vehicleId: lookupVehicleId,
            cacheKey: familyCacheKey,
            year: descriptor?.year ?? null,
            yearRange: input.descriptor?.yearRange ?? null,
            make: descriptor?.make ?? null,
            model: descriptor?.model ?? null,
            trim: "family",
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
          },
          "VALUE_LOOKUP_QUERY",
        );
        const familyCached = await repositories.valuesCache.findByCacheKey(familyCacheKey);
        if (familyCached && isFresh(familyCached.expiresAt, currentIso) && familyCached.responseJson.data) {
          const shapedFamilyValue = shapeValuationRecord({
            valuation: buildConditionAwareValuation({
              valuation: {
                ...familyCached.responseJson.data,
                vehicleId: lookupVehicleId,
              },
              vehicle,
              selectedCondition: normalizedSelectedCondition,
            }),
            vehicle,
            source: "cache",
          });
          if (shouldBypassNegativeValueCache && isRetryableUnavailableValuation(shapedFamilyValue)) {
            logger.info(
              {
                label: "VALUE_EXPLICIT_REFRESH_BYPASSING_NEGATIVE_CACHE",
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                cacheKey: familyCacheKey,
                cacheLevel: "family",
                status: shapedFamilyValue.status ?? null,
                reason: shapedFamilyValue.reason ?? null,
                fetchReason,
              },
              "VALUE_EXPLICIT_REFRESH_BYPASSING_NEGATIVE_CACHE",
            );
          } else if (isSpecialtyLookupVehicle && isGenericFallbackValuation(shapedFamilyValue)) {
            logger.info(
              {
                label: "SPECIALTY_GENERIC_VALUE_CACHE_REJECTED",
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                cacheKey: familyCacheKey,
                cacheLevel: "family",
                modelType: shapedFamilyValue.modelType ?? null,
                sourceLabel: shapedFamilyValue.sourceLabel ?? null,
                explicitRefresh: isExplicitValueRefresh,
              },
              "SPECIALTY_GENERIC_VALUE_CACHE_REJECTED",
            );
            if (isExplicitValueRefresh) {
              logger.info(
                {
                  label: "SPECIALTY_VALUE_REFRESH_BYPASSING_GENERIC_CACHE",
                  requestId: input.requestId,
                  vehicleId: lookupVehicleId,
                  cacheKey: familyCacheKey,
                  cacheLevel: "family",
                },
                "SPECIALTY_VALUE_REFRESH_BYPASSING_GENERIC_CACHE",
              );
            } else if (lookupBaseVehicle) {
              const unavailableValue = buildSpecialtyUnavailableValuation({
                vehicle: lookupBaseVehicle,
                vehicleId: lookupVehicleId,
                zip: input.zip,
                mileage: input.mileage,
                condition: normalizeCondition(input.condition),
              });
              logger.info(
                {
                  label: "SPECIALTY_VALUE_UNAVAILABLE_RETURNED",
                  requestId: input.requestId,
                  vehicleId: lookupVehicleId,
                  reason: "generic-family-cache-rejected",
                  fetchReason,
                },
                "SPECIALTY_VALUE_UNAVAILABLE_RETURNED",
              );
              return {
                data: unavailableValue,
                source: "cache",
                fetchedAt: familyCached.fetchedAt,
                expiresAt: familyCached.expiresAt,
              };
            }
          } else {
            await repositories.valuesCache.markAccessed(familyCacheKey, currentIso);
            logCacheHitProviderSkip({
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              operation: "value",
              cacheLevel: "family",
            });
            logMarketCheckApiCacheHit({
              requestId: input.requestId,
              endpointType: "value",
              vehicleId: lookupVehicleId,
              cacheKey: familyCacheKey,
              cacheLevel: "family",
              year: descriptor?.year ?? null,
              make: descriptor?.make ?? null,
              model: descriptor?.model ?? null,
              trim: "family",
              zip: input.zip,
              mileage: input.mileage,
              condition: input.condition,
              resultCount: 1,
            });
            logger.info(
              {
                label: "VALUE_FINAL_RESOLUTION",
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                finalValueSource: familyCached.responseJson.data.sourceLabel ?? familyCached.responseJson.data.modelType ?? "family_cache",
                familyCacheUsed: true,
                similarVehicleFallbackUsed:
                  familyCached.responseJson.data.sourceLabel === "Estimated from similar vehicles" ||
                  familyCached.responseJson.data.modelType === "listing_derived",
                adjacentYearRescueUsed: false,
                fallbackReason: "family-cache-hit",
              },
              "VALUE_FINAL_RESOLUTION",
            );
            return {
              data: shapedFamilyValue,
              source: "cache",
              fetchedAt: familyCached.fetchedAt,
              expiresAt: familyCached.expiresAt,
            };
          }
        }
      }

      const rawValueAttempts = lookupBaseVehicle ? await buildValueFallbackAttempts(lookupBaseVehicle) : [];
      const valueAttempts = lookupBaseVehicle ? ensureValueAttempts(lookupBaseVehicle, rawValueAttempts) : [];
      if (lookup.effectiveDescriptor && valueAttempts.length === 0) {
        logger.error(
          {
            label: "DETAIL_DESCRIPTOR_RESOLUTION_FAILED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            reason: "descriptor-present-but-value-attempts-empty",
            descriptor: lookup.effectiveDescriptor,
          },
          "DETAIL_DESCRIPTOR_RESOLUTION_FAILED",
        );
      }
      logger.info(
        {
          label: "DETAIL_DESCRIPTOR_CANDIDATE_SET",
          requestId: input.requestId,
          resolutionMode: lookup.resolutionMode,
          vehicleId: lookupVehicleId,
          attempts: valueAttempts.map((attempt) => ({
            strategy: attempt.strategy,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim || null,
            bodyStyle: attempt.vehicle.bodyStyle || null,
          })),
        },
        "DETAIL_DESCRIPTOR_CANDIDATE_SET",
      );
      logger.info(
        {
          label: "VALUE_CANDIDATE_SET",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          attempts: valueAttempts.map((attempt) => ({
            strategy: attempt.strategy,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim || null,
            bodyStyle: attempt.vehicle.bodyStyle || null,
          })),
        },
        "VALUE_CANDIDATE_SET",
      );
      if (shouldDebugCrv) {
        logger.info(
          {
            label: "DEBUG_CRV_TRACE",
            phase: "value-candidate-set",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            enrichmentCandidateSet: valueAttempts.map((attempt) => ({
              strategy: attempt.strategy,
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim || null,
            })),
          },
          "DEBUG_CRV_TRACE",
        );
      }
      logMarketGateEvaluated({
        label: "VALUE_LIVE_FETCH_GATE_EVALUATED",
        requestId: input.requestId,
        vehicleId: lookupVehicleId,
        allowLive,
        fetchReason,
        sourceScreen: input.sourceScreen ?? null,
        action: input.action ?? null,
        forceLive: input.forceLive ?? null,
        zipSource: input.zipSource ?? null,
        cacheKey,
        familyCacheKey,
        explicitRefresh: isExplicitValueRefresh,
      });
      let liveValue: ValuationRecord | null = null;
      let liveValueStrategy: ValueLookupAttempt["strategy"] | null = null;
      let valueWasSimulated = false;
      let providerFailureReason: string | null = null;
      const normalValueScreenRefresh = isNormalValueScreenRefresh({
        allowLive,
        fetchReason,
        sourceScreen: input.sourceScreen,
        action: input.action,
      });
      const effectiveForceLive = isDeveloperForceLiveValueRefresh({
        fetchReason,
        sourceScreen: input.sourceScreen,
        action: input.action,
        forceLive: input.forceLive,
      });
      const providerValueAttempts =
        providers.valueProviderName === "marketcheck"
          ? selectMarketCheckValueProviderAttempts({
              attempts: isExplicitValueRefresh ? valueAttempts : valueAttempts.slice(0, 1),
              normalValueScreenRefresh,
            })
          : valueAttempts;
      const blockedAdjacentValueAttempts =
        providers.valueProviderName === "marketcheck" ? valueAttempts.filter((attempt) => isAdjacentYearValueStrategy(attempt.strategy)) : [];
      if (providers.valueProviderName === "marketcheck" && blockedAdjacentValueAttempts.length > 0) {
        logger.info(
          {
            label: "VALUE_ADJACENT_YEAR_LIVE_BLOCKED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            blockedCount: blockedAdjacentValueAttempts.length,
            blockedAttempts: blockedAdjacentValueAttempts.map((attempt) => ({
              strategy: attempt.strategy,
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim || null,
            })),
          },
          "VALUE_ADJACENT_YEAR_LIVE_BLOCKED",
        );
      }
      if (providers.valueProviderName === "marketcheck" && providerValueAttempts.length < valueAttempts.length) {
        logger.info(
          {
            label: "VALUE_LIVE_ATTEMPT_CAPPED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            originalAttemptCount: valueAttempts.length,
            cappedAttemptCount: providerValueAttempts.length,
            normalValueScreenRefresh,
            requestedForceLive: input.forceLive ?? null,
            effectiveForceLive,
            selectedAttempts: providerValueAttempts.map((attempt) => ({
              strategy: attempt.strategy,
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim || null,
            })),
          },
          "VALUE_LIVE_ATTEMPT_CAPPED",
        );
      }
      const valueDecision = isValueLiveFetchAllowed({
        allowLive,
        fetchReason,
        sourceScreen: input.sourceScreen,
        action: input.action,
        forceLive: effectiveForceLive,
      })
        ? providerBudgetService.evaluate({
            provider: providers.valueProviderName,
            operation: "value",
            userTier: "unknown",
            confidence: 0.95,
            duplicateRequest: false,
            cacheFresh: false,
            providerCooldownActive: false,
          })
        : {
            allowLiveProvider: false,
            reason: !isMarketCheckEnabled()
              ? "marketcheck-disabled"
              : !isExplicitValueRefresh
                ? "live-fetch-requires-explicit-user-refresh"
                  : "live-fetch-disabled",
            cooldownActive: false,
            forcedMode: providerBudgetService.getForcedMode(),
            shouldUseFallback: true,
            shouldSimulateSuccess: false,
            shouldSimulateQuotaExhausted: false,
          };
      logger.info(
        {
          label: "VALUE_REFRESH_DIRECT_ATTEMPT",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          allowLiveProvider: valueDecision.allowLiveProvider,
          provider: providers.valueProviderName,
          attemptCount: providerValueAttempts.length,
          attempts: providerValueAttempts.map((attempt) => ({
            strategy: attempt.strategy,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim || null,
          })),
        },
        "VALUE_REFRESH_DIRECT_ATTEMPT",
      );
      logger.info(
        {
          label: "VALUE_LIVE_ATTEMPT_COUNT",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          provider: providers.valueProviderName,
          liveAttemptCount: providerValueAttempts.length,
          candidateAttemptCount: valueAttempts.length,
          normalValueScreenRefresh,
          requestedForceLive: input.forceLive ?? null,
          effectiveForceLive,
        },
        "VALUE_LIVE_ATTEMPT_COUNT",
      );
      if (isExplicitValueRefresh && !valueDecision.allowLiveProvider && !valueDecision.shouldSimulateSuccess) {
        const blockedReason = env.MARKETCHECK_DISABLE_EXTERNAL_CALLS ? "external-calls-disabled" : valueDecision.reason;
        logger.warn(
          {
            label: blockedReason === "external-calls-disabled" ? "VALUE_REFRESH_BLOCKED_DISABLE_EXTERNAL_CALLS" : "VALUE_REFRESH_BLOCKED_REASON",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            allowLive,
            fetchReason,
            sourceScreen: input.sourceScreen ?? null,
            action: input.action ?? null,
            forceLive: input.forceLive ?? null,
            reason: blockedReason,
          },
          blockedReason === "external-calls-disabled" ? "VALUE_REFRESH_BLOCKED_DISABLE_EXTERNAL_CALLS" : "VALUE_REFRESH_BLOCKED_REASON",
        );
      }
      if (valueDecision.shouldSimulateSuccess || valueDecision.allowLiveProvider) {
        if (fetchReason === "user_requested_value_refresh") {
          logger.info(
            {
              label: "VALUE_LIVE_REFRESH_REQUESTED",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              sourceScreen: input.sourceScreen ?? "valueScreen",
              action: input.action ?? "valueRefresh",
              cacheKey,
            },
            "VALUE_LIVE_REFRESH_REQUESTED",
          );
        }
        logMarketGateAllowed({
          label: "VALUE_LIVE_FETCH_ALLOWED",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          fetchReason,
        });
        if (isExplicitValueRefresh) {
          logger.info(
            {
              label: "VALUE_REFRESH_LIVE_PROVIDER_ATTEMPTED",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              sourceScreen: input.sourceScreen ?? "valueScreen",
              action: input.action ?? "valueRefresh",
              cacheKey,
            },
            "VALUE_REFRESH_LIVE_PROVIDER_ATTEMPTED",
          );
        }
        valueWasSimulated = valueDecision.shouldSimulateSuccess;
        for (const attempt of providerValueAttempts) {
          logMarketCheckApiFallbackAttempt({
            requestId: input.requestId,
            endpointType: "value",
            vehicleId: lookupVehicleId,
            cacheKey,
            strategy: attempt.strategy,
            reason: fetchReason,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim ?? null,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            radiusMiles: env.MARKETCHECK_VALUE_RADIUS_MILES,
          });
          logger.info(
            {
              label: "VALUE_LOOKUP_QUERY",
              requestId: input.requestId,
              queryType: valueWasSimulated ? "provider-simulated" : "provider-request",
              strategy: attempt.strategy,
              vehicleId: lookupVehicleId,
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim,
              zip: input.zip,
              radiusMiles: env.MARKETCHECK_VALUE_RADIUS_MILES,
              mileage: input.mileage,
              condition: input.condition,
            },
            "VALUE_LOOKUP_QUERY",
          );
          if (providers.valueProviderName === "marketcheck") {
            logger.info(
              {
                label: "MARKETCHECK_CALL_SITE",
                route: "vehicle-value",
                service: "VehicleService.getValue",
                provider: providers.valueProviderName,
                reason: fetchReason,
                requestMeta: {
                  requestId: input.requestId,
                  allowLive,
                  forceLive: effectiveForceLive,
                  action: input.action ?? "valueRefresh",
                  vehicleId: lookupVehicleId,
                  cacheKey,
                  year: attempt.vehicle.year,
                  yearRangeStart: input.descriptor?.yearRange?.start ?? null,
                  yearRangeEnd: input.descriptor?.yearRange?.end ?? null,
                  make: attempt.vehicle.make,
                  model: attempt.vehicle.model,
                  trim: attempt.vehicle.trim ?? null,
                  zip: input.zip,
                  radiusMiles: env.MARKETCHECK_VALUE_RADIUS_MILES,
                  mileage: input.mileage,
                  condition: input.condition,
                  sourceScreen: input.sourceScreen ?? "valueScreen",
                  route: "/api/vehicle/value",
                  caller: "VehicleService.getValue",
                  stackTag: "vehicle-value",
                },
              },
              "MARKETCHECK_CALL_SITE",
            );
          }
          liveValue = valueWasSimulated
            ? await providerBudgetService.simulateValue({
                ...input,
                vehicleId: getSimulatedProviderVehicleId({ requestedVehicleId: lookupVehicleId, attemptVehicle: attempt.vehicle }),
                vehicle: attempt.vehicle,
              })
            : await providers.valueProvider.getValuation({
                ...input,
                vehicleId: lookupVehicleId,
                vehicle: attempt.vehicle,
                requestMeta: {
                  requestId: input.requestId,
                  reason: fetchReason,
                  allowLive,
                  forceLive: effectiveForceLive,
                  action: input.action ?? "valueRefresh",
                  vehicleId: lookupVehicleId,
                  year: attempt.vehicle.year,
                  yearRangeStart: input.descriptor?.yearRange?.start ?? null,
                  yearRangeEnd: input.descriptor?.yearRange?.end ?? null,
                  make: attempt.vehicle.make,
                  model: attempt.vehicle.model,
                  trim: attempt.vehicle.trim ?? null,
                  zip: input.zip,
                  zipSource: input.zipSource ?? null,
                  radiusMiles: env.MARKETCHECK_VALUE_RADIUS_MILES,
                  mileage: input.mileage,
                  condition: input.condition,
                  sourceScreen: input.sourceScreen ?? "valueScreen",
                  route: "/api/vehicle/value",
                  caller: "VehicleService.getValue",
                  stackTag: "vehicle-value",
                },
              }).catch((error) => {
                if (error instanceof AppError && error.code === "MARKETCHECK_RATE_LIMITED") {
                  providerFailureReason = "provider_rate_limited";
                  logger.warn(
                    {
                      label: "PROVIDER_QUOTA_EXHAUSTED",
                      provider: providers.valueProviderName,
                      operation: "value",
                      vehicleId: lookupVehicleId,
                      strategy: attempt.strategy,
                    },
                    "PROVIDER_QUOTA_EXHAUSTED",
                  );
                  return null;
                }
                providerFailureReason =
                  error instanceof AppError
                    ? String(error.code ?? "provider_error").toLowerCase()
                    : error instanceof Error
                      ? error.message
                      : "provider_error";
                logger.warn(
                  {
                    label: "VALUE_PROVIDER_ATTEMPT_FAILED",
                    requestId: input.requestId,
                    vehicleId: lookupVehicleId,
                    strategy: attempt.strategy,
                    reason: providerFailureReason,
                    message: error instanceof Error ? error.message : String(error),
                  },
                  "VALUE_PROVIDER_ATTEMPT_FAILED",
                );
                return null;
              });
          if (liveValue && hasMarketValue(liveValue)) {
            liveValueStrategy = attempt.strategy;
            logger.error(
              {
                label: "VALUE_LOOKUP_SUCCESS",
                requestId: input.requestId,
                strategy: attempt.strategy,
                vehicleId: lookupVehicleId,
                year: attempt.vehicle.year,
                make: attempt.vehicle.make,
                model: attempt.vehicle.model,
                trim: attempt.vehicle.trim,
                condition: input.condition,
                cacheKey,
                source: valueWasSimulated ? "provider-simulated" : "provider",
                value: liveValue,
              },
              "VALUE_LOOKUP_SUCCESS",
            );
            break;
          }
          liveValue = null;
        }
      } else {
        logMarketGateSkipped({
          label: "VALUE_LIVE_FETCH_SKIPPED",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          fetchReason,
          reason: valueDecision.reason,
        });
        if (valueDecision.shouldSimulateQuotaExhausted) {
          logger.warn(
            {
              label: "PROVIDER_QUOTA_EXHAUSTED",
              provider: providers.valueProviderName,
              operation: "value",
              vehicleId: lookupVehicleId,
              mode: valueDecision.forcedMode,
            },
            "PROVIDER_QUOTA_EXHAUSTED",
          );
        }
        logger.info(
          {
            label: "FALLBACK_USED",
            provider: providers.valueProviderName,
            operation: "value",
            vehicleId: lookupVehicleId,
            mode: valueDecision.forcedMode,
            reason: valueDecision.reason,
            route: "vehicle-value",
            explicitRefresh: isExplicitValueRefresh,
          },
          "FALLBACK_USED",
        );
      }

      const normalizedLiveValue = liveValue
        ? buildConditionAwareValuation({
            valuation: liveValue,
            vehicle,
            selectedCondition: normalizedSelectedCondition,
          })
        : null;

      if (valueDecision.allowLiveProvider && descriptor && cacheKey && providers.valueProviderName === "marketcheck" && normalizedLiveValue) {
        await repositories.valuesCache.upsert(
          createValuesCacheRow({
            descriptor,
            cacheKey,
            provider: providers.valueProviderName,
            payload: normalizedLiveValue,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
          }),
        );
        if (familyCacheKey) {
          await repositories.valuesCache.upsert(
            createValuesCacheRow({
              descriptor: { ...descriptor, trim: "", normalizedTrim: "family" },
              cacheKey: familyCacheKey,
              provider: providers.valueProviderName,
              payload: normalizedLiveValue,
              zip: input.zip,
              mileage: input.mileage,
              condition: input.condition,
            }),
          );
        }
        if (Array.isArray(liveValue?.supportingListings) && liveValue.supportingListings.length > 0) {
          const listingsRadius = env.MARKETCHECK_VALUE_RADIUS_MILES;
          const listingsCacheKey = getListingsCacheKey(descriptor, { zip: input.zip, radiusMiles: listingsRadius });
          await repositories.listingsCache.upsert(
            createListingsCacheRow({
              descriptor,
              cacheKey: listingsCacheKey,
              provider: providers.valueProviderName,
              payload: liveValue.supportingListings,
              zip: input.zip,
              radiusMiles: listingsRadius,
            }),
          );
          if (familyCacheKey) {
            const listingsFamilyCacheKey = getFamilyListingsCacheKey(descriptor, { zip: input.zip, radiusMiles: listingsRadius });
            await repositories.listingsCache.upsert(
              createListingsCacheRow({
                descriptor: { ...descriptor, trim: "", normalizedTrim: "family" },
                cacheKey: listingsFamilyCacheKey,
                provider: providers.valueProviderName,
                payload: liveValue.supportingListings,
                zip: input.zip,
                radiusMiles: listingsRadius,
              }),
            );
          }
        }
        await fireAndForgetCleanup("values");
      }

      if (normalizedLiveValue) {
        const cacheRow = valueDecision.allowLiveProvider && descriptor && cacheKey && providers.valueProviderName === "marketcheck"
          ? createValuesCacheRow({
              descriptor,
              cacheKey,
              provider: providers.valueProviderName,
              payload: normalizedLiveValue,
              zip: input.zip,
              mileage: input.mileage,
            })
          : null;
        logger.error(
          {
            label: "VALUE_FINAL_RESOLUTION",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            finalValueSource: normalizedLiveValue.sourceLabel ?? normalizedLiveValue.modelType ?? "provider",
            familyCacheUsed: false,
            similarVehicleFallbackUsed: false,
            adjacentYearRescueUsed:
              liveValueStrategy === "adjacent-year-previous" || liveValueStrategy === "adjacent-year-next",
            fallbackReason: "provider-match",
          },
          "VALUE_FINAL_RESOLUTION",
        );
        logger.info(
          {
            label: "VALUE_API_RESULT",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            returnedValue: normalizedLiveValue,
            finalRenderedValue: normalizedLiveValue,
            acceptedReason: "provider-match",
          },
          "VALUE_API_RESULT",
        );
        logger.info(
          {
            label: "VALUE_API_RESULT_USED_SOURCE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            sourceLabel: normalizedLiveValue.sourceLabel ?? normalizedLiveValue.modelType ?? "provider",
          },
          "VALUE_API_RESULT_USED_SOURCE",
        );
        logger.info(
          {
            label: "VALUE_RECALC_RESULT",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            oldDisplayedValue: null,
            newReturnedValue: normalizedLiveValue,
            acceptedReason: "provider-match",
          },
          "VALUE_RECALC_RESULT",
        );
        logCommonVehicleDetailTrace({
          phase: "value",
          requestId: input.requestId,
          descriptorResolved: Boolean(descriptor),
          vehicle: lookupBaseVehicle,
          descriptor: lookup.effectiveDescriptor,
          specsCandidateCount: 0,
          valueCandidateCount: valueAttempts.length,
          listingsCandidateCount: 0,
          valuation: normalizedLiveValue,
        });
        logger.info(
          {
            label: "VALUE_REFRESH_FINAL_STATE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            status: normalizedLiveValue.status ?? null,
            valuationSource: normalizedLiveValue.valuationSource ?? normalizedLiveValue.modelType ?? "provider",
            listingCount: normalizedLiveValue.listingCount ?? null,
            confidence: normalizedLiveValue.confidence ?? null,
            source: "direct_value",
          },
          "VALUE_REFRESH_FINAL_STATE",
        );
        return {
          data: shapeValuationRecord({
            valuation: normalizedLiveValue,
            vehicle,
            source: "provider",
          }),
          source: "provider",
          fetchedAt: cacheRow?.fetchedAt ?? currentIso,
          expiresAt: cacheRow?.expiresAt ?? currentIso,
        };
      }
      let fallbackValue: ValuationRecord | null = null;
      for (const attempt of valueAttempts) {
        const variantDescriptor = buildCacheDescriptor({ vehicle: attempt.vehicle });
        const variantCacheKey = variantDescriptor ? getValuesCacheKey(variantDescriptor, { zip: input.zip, mileage: input.mileage }) : null;
        const cached = variantCacheKey ? await repositories.valuesCache.findByCacheKey(variantCacheKey) : null;
        if (cached?.responseJson.data) {
          const cachedValue = {
            ...cached.responseJson.data,
            vehicleId: lookupVehicleId,
            sourceLabel: cached.responseJson.data.sourceLabel ?? "Estimated from vehicle data",
            confidenceLabel: "Moderate confidence",
            modelType: cached.responseJson.data.modelType ?? "estimated_depreciation",
          };
          if (isSpecialtyLookupVehicle && !isTrustedSpecialtyValuationSource(cachedValue)) {
            logger.info(
              {
                label: "SPECIALTY_VALUE_FALLBACK_SUPPRESSED",
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                source: "cached-historical-value",
                sourceVehicleId: attempt.vehicle.id,
                modelType: cachedValue.modelType ?? null,
                sourceLabel: cachedValue.sourceLabel ?? null,
              },
              "SPECIALTY_VALUE_FALLBACK_SUPPRESSED",
            );
            continue;
          }
          fallbackValue = cachedValue;
          logger.error(
            {
              label: "VALUE_LOOKUP_SUCCESS",
              requestId: input.requestId,
              strategy: "cached-historical-value",
              vehicleId: lookupVehicleId,
              sourceVehicleId: attempt.vehicle.id,
            },
            "VALUE_LOOKUP_SUCCESS",
          );
          break;
        }
      }

      if (!fallbackValue) {
        for (const attempt of valueAttempts) {
          const stored = await repositories.valuations.findLatest({
            vehicleId: attempt.vehicle.id,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
          });
          if (stored) {
            const storedValue = {
              ...stored,
              vehicleId: lookupVehicleId,
              sourceLabel: stored.sourceLabel ?? "Estimated from vehicle data",
              confidenceLabel: "Moderate confidence",
              modelType: stored.modelType ?? "estimated_depreciation",
            };
            if (isSpecialtyLookupVehicle && !isTrustedSpecialtyValuationSource(storedValue)) {
              logger.info(
                {
                  label: "SPECIALTY_VALUE_FALLBACK_SUPPRESSED",
                  requestId: input.requestId,
                  vehicleId: lookupVehicleId,
                  source: "stored-valuation-fallback",
                  sourceVehicleId: attempt.vehicle.id,
                  modelType: storedValue.modelType ?? null,
                  sourceLabel: storedValue.sourceLabel ?? null,
                },
                "SPECIALTY_VALUE_FALLBACK_SUPPRESSED",
              );
              continue;
            }
            fallbackValue = storedValue;
            logger.error(
              {
                label: "VALUE_LOOKUP_SUCCESS",
                requestId: input.requestId,
                strategy: "stored-valuation-fallback",
                vehicleId: lookupVehicleId,
                sourceVehicleId: attempt.vehicle.id,
              },
              "VALUE_LOOKUP_SUCCESS",
            );
            break;
          }
        }
      }

      if (!fallbackValue && lookupBaseVehicle) {
        if (isExplicitValueRefresh) {
          logger.info(
            {
              label: "VALUE_FALLBACK_STEP",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              step: "local-listing-comps",
              source: "cached_or_stored_listings",
            },
            "VALUE_FALLBACK_STEP",
          );
        }
        logger.info(
          {
            label: "VALUE_COMP_SOURCE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            source: "cached_or_stored_listings",
            reason: normalizedLiveValue ? "provider_value_unusable" : "provider_value_unavailable",
          },
          "VALUE_COMP_SOURCE",
        );
        const derivedFromListings = await deriveValuationFromSimilarVehicles({
          vehicle: lookupBaseVehicle,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
        });
        if (derivedFromListings) {
          fallbackValue = derivedFromListings;
          if (isExplicitValueRefresh) {
            logger.info(
              {
                label: "VALUE_FALLBACK_RESULT",
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                step: "local-listing-comps",
                status: "resolved",
                source: derivedFromListings.valuationSource ?? derivedFromListings.modelType ?? null,
                listingCount: derivedFromListings.listingCount ?? null,
              },
              "VALUE_FALLBACK_RESULT",
            );
          }
          logger.info(
            {
              label: "VALUE_REFRESH_LISTINGS_REUSED",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              source: "cached_or_stored_listings",
              listingCount: derivedFromListings.listingCount ?? null,
              confidence: derivedFromListings.confidence ?? null,
            },
            "VALUE_REFRESH_LISTINGS_REUSED",
          );
          logger.error(
            {
              label: "VALUE_LOOKUP_SUCCESS",
              requestId: input.requestId,
              strategy: "derived-similar-vehicles",
              vehicleId: lookupVehicleId,
              listingCount: derivedFromListings.listingCount ?? null,
              sourceLabel: derivedFromListings.sourceLabel,
          },
          "VALUE_LOOKUP_SUCCESS",
        );
        }
      }

      if (!fallbackValue && isExplicitValueRefresh && lookupBaseVehicle && !isSpecialtyLookupVehicle) {
        logger.info(
          {
            label: "VALUE_REFRESH_COMP_FETCH_STARTED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            radiusMiles: DEFAULT_UNLOCK_EVALUATION_RADIUS_MILES,
            reason: "direct-value-unavailable",
          },
          "VALUE_REFRESH_COMP_FETCH_STARTED",
        );
        logger.info(
          {
            label: "VALUE_FALLBACK_STEP",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            step: "broadened-listing-comps",
            source: "listings-provider-fallback-chain",
          },
          "VALUE_FALLBACK_STEP",
        );
        const listingsForValue = await this.getListings({
          requestId: input.requestId,
          vehicleId: input.vehicleId ?? lookupVehicleId,
          descriptor: input.descriptor ?? null,
          zip: input.zip,
          radiusMiles: DEFAULT_UNLOCK_EVALUATION_RADIUS_MILES,
          mileage: input.mileage,
          allowLive: true,
          fetchReason: "user_requested_listings_refresh",
          sourceScreen: "valueScreen",
          action: "listingsRefresh",
        }).catch((error) => {
          logger.warn(
            {
              label: "VALUE_REFRESH_COMP_FETCH_RESULT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            },
            "VALUE_REFRESH_COMP_FETCH_RESULT",
          );
          return null;
        });

        logger.info(
          {
            label: "VALUE_REFRESH_COMP_FETCH_RESULT",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            status: listingsForValue ? "loaded" : "unavailable",
            source: listingsForValue?.source ?? null,
            listingCount: listingsForValue?.data.length ?? 0,
            sourceLabel: listingsForValue?.meta?.sourceLabel ?? null,
            fallbackReason: listingsForValue?.meta?.fallbackReason ?? null,
          },
          "VALUE_REFRESH_COMP_FETCH_RESULT",
        );

        if (listingsForValue?.data.length) {
          logger.info(
            {
              label: "VALUE_REFRESH_LISTINGS_FETCHED",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              listingCount: listingsForValue.data.length,
              source: listingsForValue.source,
              fallbackReason: listingsForValue.meta?.fallbackReason ?? null,
            },
            "VALUE_REFRESH_LISTINGS_FETCHED",
          );
          const derivedFromFetchedListings = buildDerivedValuationFromListings({
            vehicle: lookupBaseVehicle,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            listings: listingsForValue.data,
          });
          if (derivedFromFetchedListings) {
            fallbackValue = derivedFromFetchedListings;
            logger.info(
              {
                label: "VALUE_FALLBACK_RESULT",
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                step: "broadened-listing-comps",
                status: "resolved",
                source: derivedFromFetchedListings.valuationSource ?? derivedFromFetchedListings.modelType ?? null,
                listingCount: derivedFromFetchedListings.listingCount ?? null,
                confidence: derivedFromFetchedListings.confidence ?? null,
              },
              "VALUE_FALLBACK_RESULT",
            );
            logger.info(
              {
                label: "VALUE_COMP_DERIVATION_RESULT",
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                acceptedListingsCount: listingsForValue.data.length,
                listingCount: derivedFromFetchedListings.listingCount ?? null,
                sourceLabel: derivedFromFetchedListings.sourceLabel ?? null,
                confidenceLabel: derivedFromFetchedListings.confidenceLabel ?? null,
                confidence: derivedFromFetchedListings.confidence ?? null,
                low: derivedFromFetchedListings.low ?? null,
                median: derivedFromFetchedListings.median ?? null,
                high: derivedFromFetchedListings.high ?? null,
                source: "explicit-value-comp-fetch",
              },
              "VALUE_COMP_DERIVATION_RESULT",
            );
          }
        }
      }

      if (!fallbackValue && valueDecision.allowLiveProvider && !isSpecialtyLookupVehicle && !isExplicitValueRefresh) {
        const seededFallback = lookupBaseVehicle
          ? await mockValueProvider.getValuation({
              vehicleId: lookupVehicleId,
              zip: input.zip,
              mileage: input.mileage,
              condition: input.condition,
              vehicle: lookupBaseVehicle,
            })
          : null;
        fallbackValue = seededFallback
          ? {
              ...seededFallback,
              vehicleId: lookupVehicleId,
              sourceLabel: "Estimated from vehicle data",
              confidenceLabel: "Limited data",
              modelType: "estimated_depreciation",
            }
          : null;
      }

      if (!fallbackValue && lookupBaseVehicle && !isSpecialtyLookupVehicle) {
        if (isExplicitValueRefresh) {
          logger.info(
            {
              label: "VALUE_FALLBACK_STEP",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              step: "generation-model-family-baseline",
              source: "canonical_vehicle_model",
            },
            "VALUE_FALLBACK_STEP",
          );
        }
        fallbackValue = buildEstimatedMarketRangeFromVehicle({
          vehicle: lookupBaseVehicle,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
        });
        if (fallbackValue) {
          if (isExplicitValueRefresh) {
            fallbackValue = {
              ...fallbackValue,
              sourceLabel:
                fallbackValue.modelType === "estimated_family_model"
                  ? "Regional model-family estimate"
                  : "Limited vehicle-data estimate",
              confidenceLabel:
                "Low market confidence. Nearby listings were unavailable, so this uses vehicle and model-family data instead of live local comps.",
              valuationSource: "modeled_fallback",
              confidence: "limited",
              sourceBasis: "modeled_condition_adjusted",
              listingCount: 0,
              compCount: 0,
              reason: "modeled_baseline_after_no_local_comps",
            };
            logger.info(
              {
                label: "VALUE_FALLBACK_RESULT",
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                step: "generation-model-family-baseline",
                status: "resolved",
                source: fallbackValue.valuationSource ?? fallbackValue.modelType ?? null,
                confidence: fallbackValue.confidence ?? null,
              },
              "VALUE_FALLBACK_RESULT",
            );
          }
          logger.error(
            {
              label: "VALUE_LOOKUP_SUCCESS",
              requestId: input.requestId,
              strategy: "modeled-market-range",
              vehicleId: lookupVehicleId,
            },
            "VALUE_LOOKUP_SUCCESS",
          );
        } else if (isExplicitValueRefresh) {
          logger.info(
            {
              label: "VALUE_FALLBACK_RESULT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              step: "generation-model-family-baseline",
              status: "skipped",
              reason: "no_safe_baseline_data",
            },
            "VALUE_FALLBACK_RESULT",
          );
        }
      }

      const explicitLiveFailureReason =
        isExplicitValueRefresh && !valueDecision.allowLiveProvider
          ? env.MARKETCHECK_DISABLE_EXTERNAL_CALLS
            ? "external_calls_disabled"
            : valueDecision.reason ?? "live_fetch_blocked"
          : providerFailureReason;

      if (!fallbackValue && lookupBaseVehicle && isSpecialtyLookupVehicle) {
        fallbackValue = buildSpecialtyUnavailableValuation({
          vehicle: lookupBaseVehicle,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: normalizeCondition(input.condition),
          status:
            isExplicitValueRefresh
              ? explicitLiveFailureReason
                ? "provider_error"
                : "no_comps_found"
              : "specialty_unavailable",
          sourceLabel:
            isExplicitValueRefresh
              ? explicitLiveFailureReason
                ? "Live market data could not be loaded"
                : "No live market comps found"
              : "Specialty market value unavailable",
          confidenceLabel:
            isExplicitValueRefresh
              ? explicitLiveFailureReason
                ? "Live market data could not be loaded. Specialty pricing can vary widely by mileage, condition, options, service history, and provenance."
                : "No live market comps found for this ZIP, mileage, and condition. Specialty pricing can vary widely by mileage, condition, options, service history, and provenance."
              : "Load live market value. Specialty pricing can vary widely by mileage, condition, options, service history, and provenance.",
          message:
            isExplicitValueRefresh
              ? explicitLiveFailureReason
                ? "Live market data could not be loaded."
                : "No live market comps found for this ZIP, mileage, and condition."
              : null,
          reason:
            isExplicitValueRefresh
              ? explicitLiveFailureReason ?? "no_comps_found"
              : "specialty_unavailable",
        });
        logger.info(
          {
            label: "SPECIALTY_VALUE_UNAVAILABLE_RETURNED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            make: lookupBaseVehicle.make,
            model: lookupBaseVehicle.model,
            fetchReason,
            reason:
              isExplicitValueRefresh
                ? explicitLiveFailureReason ?? "live-provider-no-specialty-value"
                : "passive-specialty-value-unavailable",
          },
          "SPECIALTY_VALUE_UNAVAILABLE_RETURNED",
        );
      }

      const finalUnavailableReason =
        explicitLiveFailureReason ??
        (!lookupBaseVehicle
          ? "missing_required_vehicle_identity"
          : !isSpecialtyLookupVehicle
            ? "no_safe_baseline_data"
            : "no_comps_found");
      const finalUnavailableSourceLabel =
        finalUnavailableReason === "no_safe_baseline_data"
          ? "No safe baseline data available"
          : finalUnavailableReason === "missing_required_vehicle_identity"
            ? "Vehicle identity required"
          : explicitLiveFailureReason
            ? "Live market data could not be loaded"
            : "No live market comps found";
      const finalUnavailableMessage =
        finalUnavailableReason === "no_safe_baseline_data"
          ? "No safe baseline data is available for this vehicle after direct value, cached comps, listings, and modeled fallback checks."
          : finalUnavailableReason === "missing_required_vehicle_identity"
            ? "Year, make, and model are required before loading market value."
          : explicitLiveFailureReason
            ? "Live market data could not be loaded."
            : "No live market comps found for this ZIP, mileage, and condition.";

      if (!fallbackValue && isExplicitValueRefresh && !isSpecialtyLookupVehicle) {
        fallbackValue = {
          id: `market-value-unavailable:${lookupVehicleId}:${input.zip}:${input.mileage}`,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: normalizeCondition(input.condition),
          status: explicitLiveFailureReason ? "provider_error" : "no_comps_found",
          tradeIn: null,
          privateParty: null,
          dealerRetail: null,
          low: null,
          high: null,
          median: null,
          currency: "USD",
          generatedAt: new Date().toISOString(),
          sourceLabel: finalUnavailableSourceLabel,
          confidenceLabel: finalUnavailableMessage,
          message: finalUnavailableMessage,
          reason: finalUnavailableReason,
          modelType: "modeled",
          listingCount: 0,
          valuationSource: "unavailable",
          confidence: "unavailable",
          unavailableReason: finalUnavailableReason,
        };
        logger.info(
          {
            label: "VALUE_UNAVAILABLE_REASON",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            reason: finalUnavailableReason,
          },
          "VALUE_UNAVAILABLE_REASON",
        );
        logger.info(
          {
            label: "VALUE_UNAVAILABLE_FINAL_REASON",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            reason: finalUnavailableReason,
          },
          "VALUE_UNAVAILABLE_FINAL_REASON",
        );
        logger.info(
          {
            label: "VALUE_FALLBACK_FINAL_RESULT",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            status: fallbackValue.status ?? null,
            valuationSource: fallbackValue.valuationSource ?? fallbackValue.modelType ?? "unavailable",
            confidence: fallbackValue.confidence ?? null,
            sourceLabel: fallbackValue.sourceLabel ?? null,
            unavailableReason: fallbackValue.unavailableReason ?? fallbackValue.reason ?? null,
          },
          "VALUE_FALLBACK_FINAL_RESULT",
        );
      }

      const normalizedFallbackValue = fallbackValue
        ? buildConditionAwareValuation({
            valuation: fallbackValue,
            vehicle: lookupBaseVehicle,
            selectedCondition: normalizedSelectedCondition,
          })
        : null;

      if (normalizedFallbackValue) {
        if (
          descriptor &&
          familyCacheKey &&
          providers.valueProviderName === "marketcheck" &&
          (normalizedFallbackValue.status === "loaded_value" ||
            normalizedFallbackValue.status === "loaded_listing_range" ||
            normalizedFallbackValue.status === "loaded_condition_set")
        ) {
          await repositories.valuesCache.upsert(
            createValuesCacheRow({
              descriptor: { ...descriptor, trim: "", normalizedTrim: "family" },
              cacheKey: familyCacheKey,
              provider: providers.valueProviderName,
              payload: normalizedFallbackValue,
              zip: input.zip,
              mileage: input.mileage,
              condition: input.condition,
            }),
          );
        }
        logger.error(
          {
            label: "VALUE_FINAL_RESOLUTION",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            finalValueSource: normalizedFallbackValue.sourceLabel ?? normalizedFallbackValue.modelType ?? "fallback",
            familyCacheUsed: false,
            similarVehicleFallbackUsed:
              normalizedFallbackValue.sourceLabel === "Estimated from similar vehicles" ||
              normalizedFallbackValue.modelType === "listing_derived",
            adjacentYearRescueUsed: false,
            fallbackReason:
              normalizedFallbackValue.sourceLabel === "Estimated from similar vehicles"
                ? "similar-vehicle-derived-estimate"
                : normalizedFallbackValue.sourceLabel === "Estimated from vehicle data" || normalizedFallbackValue.sourceLabel === "Estimated from vehicle family data"
                  ? "modeled-market-range"
                  : "fallback-value",
          },
          "VALUE_FINAL_RESOLUTION",
        );
        logger.info(
          {
            label: "VALUE_API_RESULT",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            returnedValue: normalizedFallbackValue,
            finalRenderedValue: normalizedFallbackValue,
            acceptedReason: "fallback-value-resolved",
          },
          "VALUE_API_RESULT",
        );
        logger.info(
          {
            label: "VALUE_API_RESULT_USED_SOURCE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            sourceLabel: normalizedFallbackValue.sourceLabel ?? normalizedFallbackValue.modelType ?? "fallback",
          },
          "VALUE_API_RESULT_USED_SOURCE",
        );
        logger.info(
          {
            label: "VALUE_RECALC_RESULT",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            oldDisplayedValue: null,
            newReturnedValue: normalizedFallbackValue,
            acceptedReason: "fallback-value-resolved",
          },
          "VALUE_RECALC_RESULT",
        );
        logCommonVehicleDetailTrace({
          phase: "value",
          requestId: input.requestId,
          descriptorResolved: Boolean(descriptor),
          vehicle: lookupBaseVehicle,
          descriptor: lookup.effectiveDescriptor,
          specsCandidateCount: 0,
          valueCandidateCount: valueAttempts.length,
          listingsCandidateCount: 0,
          valuation: normalizedFallbackValue,
          thinReason: "fallback-value-resolved",
        });
        logger.info(
          {
            label: "VALUE_REFRESH_FINAL_STATE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            status: normalizedFallbackValue.status ?? null,
            valuationSource: normalizedFallbackValue.valuationSource ?? normalizedFallbackValue.modelType ?? "fallback",
            listingCount: normalizedFallbackValue.listingCount ?? null,
            confidence: normalizedFallbackValue.confidence ?? null,
            source: normalizedFallbackValue.valuationSource === "listing_comps" || normalizedFallbackValue.modelType === "listing_derived"
              ? "listing_comps"
              : "fallback_value",
          },
          "VALUE_REFRESH_FINAL_STATE",
        );
        logger.info(
          {
            label: "VALUE_FALLBACK_FINAL_RESULT",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            status: normalizedFallbackValue.status ?? null,
            valuationSource: normalizedFallbackValue.valuationSource ?? normalizedFallbackValue.modelType ?? "fallback",
            confidence: normalizedFallbackValue.confidence ?? null,
            sourceLabel: normalizedFallbackValue.sourceLabel ?? null,
            unavailableReason: normalizedFallbackValue.unavailableReason ?? normalizedFallbackValue.reason ?? null,
          },
          "VALUE_FALLBACK_FINAL_RESULT",
        );
        logger.info(
          {
            label: "VALUE_FALLBACK_CONFIDENCE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            confidence: normalizedFallbackValue.confidence ?? null,
            confidenceLabel: normalizedFallbackValue.confidenceLabel ?? null,
          },
          "VALUE_FALLBACK_CONFIDENCE",
        );
        logger.info(
          {
            label: "VALUE_FINAL_SOURCE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            source: normalizedFallbackValue.valuationSource ?? normalizedFallbackValue.modelType ?? "fallback",
            sourceLabel: normalizedFallbackValue.sourceLabel ?? null,
          },
          "VALUE_FINAL_SOURCE",
        );
        return {
          data: shapeValuationRecord({
            valuation: normalizedFallbackValue,
            vehicle: lookupBaseVehicle,
            source: "stored",
          }),
          source: "provider",
          fetchedAt: currentIso,
          expiresAt: currentIso,
        };
      }

      logger.error(
        {
          label: "VALUE_API_RESULT_EMPTY",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
          returnedValue: null,
          finalRenderedValue: null,
          acceptedReason: "value-not-found",
        },
        "VALUE_API_RESULT_EMPTY",
      );
      logger.error(
        {
          label: "VALUE_LOOKUP_EMPTY",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          year: vehicle?.year ?? descriptor?.year ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          reason: "No provider or fallback valuation was found.",
        },
        "VALUE_LOOKUP_EMPTY",
      );
      if (shouldDebugCrv) {
        logger.error(
          {
            label: "DEBUG_CRV_TRACE",
            phase: "value-pipeline-final",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            valuePipeline: {
              stepReturnedValue: null,
              derivedEstimateExecuted: Boolean(lookupBaseVehicle),
              sampleCountUsed: null,
              failureReason: !descriptor ? "descriptor-missing" : "no-provider-or-fallback-value",
            },
          },
          "DEBUG_CRV_TRACE",
        );
      }
      logger.error(
        {
          label: "VALUE_FINAL_RESOLUTION",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          finalValueSource: null,
          familyCacheUsed: false,
          similarVehicleFallbackUsed: false,
          adjacentYearRescueUsed: false,
          fallbackReason: "value-not-found",
        },
        "VALUE_FINAL_RESOLUTION",
      );
      logger.info(
        {
          label: "VALUE_RECALC_RESULT",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
          oldDisplayedValue: null,
          newReturnedValue: null,
          acceptedReason: "value-not-found",
        },
        "VALUE_RECALC_RESULT",
      );
      logCommonVehicleDetailTrace({
        phase: "value",
        requestId: input.requestId,
        descriptorResolved: Boolean(descriptor),
        vehicle: lookupBaseVehicle,
        descriptor: lookup.effectiveDescriptor,
        specsCandidateCount: 0,
        valueCandidateCount: valueAttempts.length,
        listingsCandidateCount: 0,
        valuation: null,
        thinReason: "value-not-found",
      });
      throw new AppError(404, "VALUATION_NOT_FOUND", "Valuation not found for the requested vehicle.");
    } catch (error) {
      let lookup: Awaited<ReturnType<typeof resolveLookupContext>> | null = null;
      let lookupResolutionError: unknown = null;
      try {
        lookup = await resolveLookupContext(input);
      } catch (lookupError) {
        lookupResolutionError = lookupError;
      }
      const vehicle = lookup?.vehicle ?? null;
      const descriptor = lookup?.cacheDescriptor ?? null;
      const lookupVehicleId = lookup?.lookupVehicleId ?? input.vehicleId ?? "descriptor:unresolved";
      const cacheKey = descriptor ? getValuesCacheKey(descriptor, { zip: input.zip, mileage: input.mileage }) : null;
      logger.error(
        {
          label: "VALUE_PIPELINE_ERROR",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          descriptor: input.descriptor ?? null,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
          lookupResolutionError: lookupResolutionError ? getErrorDetails(lookupResolutionError) : null,
          ...getErrorDetails(error),
        },
        "VALUE_PIPELINE_ERROR",
      );
      logger.error(
        {
          label: "VALUE_PIPELINE_EXCEPTION_STACK",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          stack: error instanceof Error ? error.stack ?? null : null,
          lookupResolutionStack: lookupResolutionError instanceof Error ? lookupResolutionError.stack ?? null : null,
        },
        "VALUE_PIPELINE_EXCEPTION_STACK",
      );
      logger.error(
        {
          label: "VALUE_LOOKUP_FAILURE",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          year: vehicle?.year ?? descriptor?.year ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          bodyStyle: vehicle?.bodyStyle ?? null,
          ...getErrorDetails(error),
        },
        "VALUE_LOOKUP_FAILURE",
      );
      if (cacheKey) {
        await writeUsageLog({
          provider: providers.valueProviderName,
          endpointType: "values",
          eventType: "provider_error",
          cacheKey,
          requestSummary: input,
          responseSummary: { error: error instanceof Error ? error.message : "Unknown provider error" },
        });
      }
      throw error;
    }
  }

  async getListings(input: {
    requestId?: string;
    vehicleId?: string | null;
    descriptor?: VehicleLookupDescriptor | null;
    zip: string;
    radiusMiles: number;
    mileage?: number;
    allowLive?: boolean;
    fetchReason?: string;
    sourceScreen?: string | null;
    action?: string | null;
    forceLive?: boolean | null;
  }): Promise<CachedServiceResult<ListingRecord[], ListingsDebugMeta>> {
    try {
      const currentIso = nowIso();
      const lookup = await resolveLookupContext(input);
      const vehicle = lookup.vehicle;
      const descriptor = lookup.cacheDescriptor;
      const lookupVehicleId = lookup.lookupVehicleId;
      logger.info(
        {
          label: "LISTINGS_LOAD_REQUESTED",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          year: vehicle?.year ?? descriptor?.year ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          zip: input.zip,
          radiusMiles: input.radiusMiles,
          mileage: input.mileage ?? null,
          condition: null,
          allowLive: input.allowLive ?? false,
          fetchReason: input.fetchReason ?? null,
          sourceScreen: input.sourceScreen ?? null,
          action: input.action ?? null,
          forceLive: input.forceLive ?? null,
        },
        "LISTINGS_LOAD_REQUESTED",
      );
      logger.info(
        {
          label: "LISTINGS_LOOKUP_START",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          vehicleFound: Boolean(vehicle),
          year: vehicle?.year ?? descriptor?.year ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          bodyStyle: vehicle?.bodyStyle ?? input.descriptor?.bodyStyle ?? null,
          zip: input.zip,
          radiusMiles: input.radiusMiles,
        },
        "LISTINGS_LOOKUP_START",
      );
      const cacheKey = descriptor ? getListingsCacheKey(descriptor, input) : null;
      const familyCacheKey = descriptor ? getFamilyListingsCacheKey(descriptor, input) : null;
      const allowLive = input.allowLive ?? false;
      const fetchReason = normalizeMarketFetchReason(input.fetchReason);
      const shouldDebugCrv =
        isCrvTraceTarget({ make: vehicle?.make ?? descriptor?.make ?? null, model: vehicle?.model ?? descriptor?.model ?? null }) ||
        (!vehicle && !descriptor && String(lookupVehicleId).includes("cr"));
      if (shouldDebugCrv) {
        logger.info(
          {
            label: "DEBUG_CRV_TRACE",
            phase: "listings-pipeline-start",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            identificationResult: {
              year: vehicle?.year ?? descriptor?.year ?? null,
              make: vehicle?.make ?? descriptor?.make ?? null,
              model: vehicle?.model ?? descriptor?.model ?? null,
              normalizedModel: descriptor?.normalizedModel ?? null,
            },
            listingsPipeline: {
              vehicleResolved: Boolean(vehicle),
              descriptorResolved: Boolean(descriptor),
              exactCacheKey: cacheKey,
              familyCacheKey,
              resolutionMode: lookup.resolutionMode,
              invalidVehicleId: lookup.invalidVehicleId,
            },
          },
          "DEBUG_CRV_TRACE",
        );
      }

      if (cacheKey && providers.listingsProviderName === "marketcheck") {
        const cacheDescriptor = descriptor;
        logger.info(
          {
            label: "LISTINGS_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "cache-read",
            vehicleId: lookupVehicleId,
            cacheKey,
            year: cacheDescriptor?.year ?? null,
            make: cacheDescriptor?.make ?? null,
            model: cacheDescriptor?.model ?? null,
            trim: cacheDescriptor?.trim ?? null,
            zip: input.zip,
            radiusMiles: input.radiusMiles,
          },
          "LISTINGS_LOOKUP_QUERY",
        );
        const cached = await repositories.listingsCache.findByCacheKey(cacheKey);
        if (cached) {
          const cachedDisplayListings = filterDisplayableListings(
            cached.responseJson.data,
            lookup.lookupVehicle ?? vehicle ?? null,
            input.descriptor?.yearRange ?? null,
            {
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              zip: input.zip,
              radiusMiles: input.radiusMiles,
              make: descriptor?.make ?? vehicle?.make ?? null,
              model: descriptor?.model ?? vehicle?.model ?? null,
              condition: null,
            },
          );
          if (isFresh(cached.expiresAt, currentIso)) {
            await repositories.listingsCache.markAccessed(cacheKey, currentIso);
            await writeUsageLog({
              provider: cached.provider,
              endpointType: "listings",
              eventType: cached.responseJson.isEmpty ? "empty_hit" : "cache_hit",
              cacheKey,
              requestSummary: input,
              responseSummary: { count: cachedDisplayListings.length, expiresAt: cached.expiresAt },
            });
            if (!cached.responseJson.isEmpty && cachedDisplayListings.length > 0) {
              logCacheHitProviderSkip({
                requestId: input.requestId,
                vehicleId: lookupVehicleId,
                operation: "listings",
                cacheLevel: "exact",
              });
              logMarketCheckApiCacheHit({
                requestId: input.requestId,
                endpointType: "listings",
                vehicleId: lookupVehicleId,
                cacheKey,
                cacheLevel: "exact",
                year: cacheDescriptor?.year ?? null,
                make: cacheDescriptor?.make ?? null,
                model: cacheDescriptor?.model ?? null,
                trim: cacheDescriptor?.trim ?? null,
                zip: input.zip,
                radiusMiles: input.radiusMiles,
                resultCount: cachedDisplayListings.length,
              });
              return {
                data: cachedDisplayListings,
                source: "cache",
                fetchedAt: cached.fetchedAt,
                expiresAt: cached.expiresAt,
              };
            }
          } else {
            await writeUsageLog({
              provider: cached.provider,
              endpointType: "listings",
              eventType: "stale_refresh",
              cacheKey,
              requestSummary: input,
              responseSummary: { previousFetchedAt: cached.fetchedAt, previousExpiresAt: cached.expiresAt },
            });
          }
        } else {
          await writeUsageLog({
            provider: providers.listingsProviderName,
            endpointType: "listings",
            eventType: "miss",
            cacheKey,
            requestSummary: input,
            responseSummary: {},
          });
        }
      }

      if (familyCacheKey && providers.listingsProviderName === "marketcheck") {
        logger.info(
          {
            label: "LISTINGS_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "family-cache-read",
            vehicleId: lookupVehicleId,
            cacheKey: familyCacheKey,
            year: descriptor?.year ?? null,
            make: descriptor?.make ?? null,
            model: descriptor?.model ?? null,
            trim: "family",
            zip: input.zip,
            radiusMiles: input.radiusMiles,
          },
          "LISTINGS_LOOKUP_QUERY",
        );
        const familyCached = await repositories.listingsCache.findByCacheKey(familyCacheKey);
        const familyDisplayListings = familyCached
          ? filterDisplayableListings(familyCached.responseJson.data, lookup.lookupVehicle ?? vehicle ?? null, input.descriptor?.yearRange ?? null, {
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              zip: input.zip,
              radiusMiles: input.radiusMiles,
              make: descriptor?.make ?? vehicle?.make ?? null,
              model: descriptor?.model ?? vehicle?.model ?? null,
              condition: null,
            })
          : [];
        if (familyCached && isFresh(familyCached.expiresAt, currentIso) && !familyCached.responseJson.isEmpty && familyDisplayListings.length > 0) {
          await repositories.listingsCache.markAccessed(familyCacheKey, currentIso);
          logCacheHitProviderSkip({
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            operation: "listings",
            cacheLevel: "family",
          });
          logMarketCheckApiCacheHit({
            requestId: input.requestId,
            endpointType: "listings",
            vehicleId: lookupVehicleId,
            cacheKey: familyCacheKey,
            cacheLevel: "family",
            year: descriptor?.year ?? null,
            make: descriptor?.make ?? null,
            model: descriptor?.model ?? null,
            trim: "family",
            zip: input.zip,
            radiusMiles: input.radiusMiles,
            resultCount: familyDisplayListings.length,
          });
          logger.info(
            {
              label: "LISTINGS_FINAL_RESOLUTION",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              finalListingsSource: "family_cache",
              familyCacheUsed: true,
              similarVehicleFallbackUsed: false,
              adjacentYearRescueUsed: false,
              fallbackReason: "family-cache-hit",
            },
            "LISTINGS_FINAL_RESOLUTION",
          );
          return {
            data: familyDisplayListings.map((listing) => ({
              ...listing,
              vehicleId: lookupVehicleId,
            })),
            source: "cache",
            fetchedAt: familyCached.fetchedAt,
            expiresAt: familyCached.expiresAt,
            meta: {
              sourceLabel: "Nearby listings for this model",
              rawCount: familyDisplayListings.length,
              believableCount: familyDisplayListings.length,
              mode: "same_model_mixed_trims",
              fallbackReason: "family-cache-hit",
            },
          };
        }
      }

      const lookupBaseVehicle = lookup.lookupVehicle;
      const rawFallbackAttempts = lookupBaseVehicle
        ? await buildListingsFallbackAttempts({
            vehicle: lookupBaseVehicle,
            radiusMiles: input.radiusMiles,
          })
        : [];
      const fallbackAttempts = lookupBaseVehicle
        ? ensureListingsAttempts({
            vehicle: lookupBaseVehicle,
            radiusMiles: input.radiusMiles,
            attempts: rawFallbackAttempts,
          })
        : [];
      const commonListingsAttemptSummary = {
        exactAttemptCount: fallbackAttempts.filter((attempt) => attempt.strategy === "exact-year-make-model" || attempt.strategy === "same-year-any-trim").length,
        adjacentYearAttemptCount: fallbackAttempts.filter(
          (attempt) =>
            attempt.strategy === "adjacent-year-previous" ||
            attempt.strategy === "adjacent-year-next" ||
            attempt.strategy === "adjacent-year-previous-2" ||
            attempt.strategy === "adjacent-year-next-2",
        ).length,
        radiusExpandedAttemptCount: 0,
        generationFallbackAttemptCount: 0,
        similarVehicleAttemptCount: 0,
      };
      const normalizedListingsQuery = {
        year: lookupBaseVehicle?.year ?? descriptor?.year ?? null,
        make: normalizeVehicleLookupText(lookupBaseVehicle?.make ?? descriptor?.make ?? null),
        model: normalizeVehicleLookupText(lookupBaseVehicle?.model ?? descriptor?.model ?? null),
        trim: normalizeVehicleLookupText(lookupBaseVehicle?.trim ?? descriptor?.trim ?? null),
        descriptorNormalizedModel: normalizeVehicleLookupText(lookup.effectiveDescriptor?.normalizedModel ?? null),
      };
      const normalizationMismatchLikely =
        Boolean(lookup.effectiveDescriptor?.normalizedModel) &&
        normalizedListingsQuery.descriptorNormalizedModel.length > 0 &&
        normalizedListingsQuery.descriptorNormalizedModel !== normalizedListingsQuery.model;
      const queryConstraintsTooNarrow =
        !fallbackAttempts.some((attempt) => normalizeVehicleLookupText(attempt.vehicle.trim) === "") ||
        !fallbackAttempts.some((attempt) => attempt.radiusMiles > input.radiusMiles) ||
        !fallbackAttempts.some(
          (attempt) => attempt.strategy === "adjacent-year-previous" || attempt.strategy === "adjacent-year-next",
        );
      const logCrvListingsRuntimeTrace = (inputPayload: {
        finalReason: string;
        finalSourceLabel: string | null;
        providerReturnedZeroAtAllAttempts: boolean;
        rawListingsEverReturned: boolean;
        believableListingsEverReturned: boolean;
      }) => {
        if (!shouldDebugCrv) {
          return;
        }
        logger.info(
          {
            label: "CRV_LISTINGS_RUNTIME_TRACE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            normalizedQuery: normalizedListingsQuery,
            attemptTypes: fallbackAttempts.map((attempt) => attempt.strategy),
            rawCountPerAttempt: liveListingsAttempts.map((attempt) => ({
              strategy: attempt.strategy,
              rawCount: attempt.returnedCount,
              believableCount: attempt.believableCount,
            })),
            finalReasonRawCountStayedZero: inputPayload.finalReason,
            providerReturnedZeroAtAllAttempts: inputPayload.providerReturnedZeroAtAllAttempts,
            rawListingsEverReturned: inputPayload.rawListingsEverReturned,
            believableListingsEverReturned: inputPayload.believableListingsEverReturned,
            normalizationMismatchLikely,
            queryConstraintsTooNarrow,
            finalSourceLabel: inputPayload.finalSourceLabel,
          },
          "CRV_LISTINGS_RUNTIME_TRACE",
        );
      };
      if (lookup.effectiveDescriptor && fallbackAttempts.length === 0) {
        logger.error(
          {
            label: "DETAIL_DESCRIPTOR_RESOLUTION_FAILED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            reason: "descriptor-present-but-listings-attempts-empty",
            descriptor: lookup.effectiveDescriptor,
          },
          "DETAIL_DESCRIPTOR_RESOLUTION_FAILED",
        );
      }
      logger.info(
        {
          label: "DETAIL_DESCRIPTOR_CANDIDATE_SET",
          requestId: input.requestId,
          resolutionMode: lookup.resolutionMode,
          vehicleId: lookupVehicleId,
          attempts: fallbackAttempts.map((attempt) => ({
            strategy: attempt.strategy,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim || null,
            bodyStyle: attempt.vehicle.bodyStyle || null,
            radiusMiles: attempt.radiusMiles,
          })),
        },
        "DETAIL_DESCRIPTOR_CANDIDATE_SET",
      );
      logger.info(
        {
          label: "LISTINGS_QUERY_BUILT",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          attempts: fallbackAttempts.map((attempt) => ({
            strategy: attempt.strategy,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim || null,
            radiusMiles: attempt.radiusMiles,
          })),
        },
        "LISTINGS_QUERY_BUILT",
      );
      logger.info(
        {
          label: "LISTINGS_CANDIDATE_SET",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          attempts: fallbackAttempts.map((attempt) => ({
            label: attempt.label,
            strategy: attempt.strategy,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim || null,
            bodyStyle: attempt.vehicle.bodyStyle || null,
            radiusMiles: attempt.radiusMiles,
          })),
        },
        "LISTINGS_CANDIDATE_SET",
      );
      if (shouldDebugCrv) {
        logger.info(
          {
            label: "DEBUG_CRV_TRACE",
            phase: "listings-candidate-set",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            enrichmentCandidateSet: fallbackAttempts.map((attempt) => ({
              strategy: attempt.strategy,
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim || null,
              radiusMiles: attempt.radiusMiles,
            })),
          },
          "DEBUG_CRV_TRACE",
        );
      }

      let liveListings: ListingRecord[] = [];
      let liveListingsStrategy: ListingsLookupAttempt["strategy"] | null = null;
      let liveListingsFinalStrategy: ListingsLookupAttempt["strategy"] | null = null;
      let acceptedLiveListings: ListingRecord[] = [];
      const acceptedLiveListingsStrategies: ListingsLookupAttempt["strategy"][] = [];
      const liveListingsAttempts: Array<{
        strategy: ListingsLookupAttempt["strategy"];
        returnedCount: number;
        believableCount: number;
      }> = [];
      let listingsWereSimulated = false;
      let liveListingsProviderAttempted = false;
      const isExplicitListingsRefresh = isExplicitUserRequestedListingsRefresh({
        allowLive,
        fetchReason,
        sourceScreen: input.sourceScreen,
        action: input.action,
        forceLive: input.forceLive,
      });
      const normalListingsRefresh = isNormalListingsRefresh({
        allowLive,
        fetchReason,
        sourceScreen: input.sourceScreen,
        action: input.action,
        forceLive: input.forceLive,
      });
      const effectiveForceLiveListings = isDeveloperForceLiveListingsRefresh({
        fetchReason,
        sourceScreen: input.sourceScreen,
        action: input.action,
        forceLive: input.forceLive,
      });
      const providerListingsAttempts =
        providers.listingsProviderName === "marketcheck"
          ? isExplicitListingsRefresh
            ? selectMarketCheckListingsProviderAttempts({
                attempts: fallbackAttempts,
                normalListingsRefresh,
                requestedTrim: lookupBaseVehicle?.trim ?? descriptor?.trim ?? null,
                forceLive: effectiveForceLiveListings,
              })
            : [
                fallbackAttempts.find((attempt) => attempt.strategy === "same-year-any-trim") ??
                  fallbackAttempts.find((attempt) => attempt.strategy === "same-year-family-model") ??
                fallbackAttempts[0],
              ].filter((attempt): attempt is ListingsLookupAttempt => Boolean(attempt))
          : fallbackAttempts;
      const blockedLiveListingsAttempts =
        providers.listingsProviderName === "marketcheck"
          ? fallbackAttempts.filter((attempt) => !providerListingsAttempts.some((entry) => listingsAttemptKey(entry) === listingsAttemptKey(attempt)))
          : [];
      if (providers.listingsProviderName === "marketcheck" && normalListingsRefresh && isGenericListingsTrimValue(lookupBaseVehicle?.trim ?? descriptor?.trim ?? null)) {
        const selectedAttempt = providerListingsAttempts[0] ?? null;
        if (selectedAttempt && selectedAttempt.strategy !== "exact-year-make-model") {
          logger.info(
            {
              label: "LISTINGS_GENERIC_TRIM_DROPPED",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              requestedTrim: lookupBaseVehicle?.trim ?? descriptor?.trim ?? null,
              selectedStrategy: selectedAttempt.strategy,
              year: selectedAttempt.vehicle.year,
              make: selectedAttempt.vehicle.make,
              model: selectedAttempt.vehicle.model,
              trim: selectedAttempt.vehicle.trim || null,
            },
            "LISTINGS_GENERIC_TRIM_DROPPED",
          );
        }
      }
      if (providers.listingsProviderName === "marketcheck" && normalListingsRefresh && blockedLiveListingsAttempts.length > 0) {
        logger.info(
          {
            label: "LISTINGS_LIVE_ATTEMPT_CAPPED",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            liveAttemptCount: providerListingsAttempts.length,
            requestedAttemptCount: fallbackAttempts.length,
            configuredMaxLiveListingAttempts: MAX_LIVE_LISTING_ATTEMPTS,
            blockedStrategies: blockedLiveListingsAttempts.map((attempt) => attempt.strategy),
            sourceScreen: input.sourceScreen ?? null,
            action: input.action ?? null,
            fetchReason,
            requestedForceLive: input.forceLive ?? null,
            effectiveForceLive: effectiveForceLiveListings,
          },
          "LISTINGS_LIVE_ATTEMPT_CAPPED",
        );
        const adjacentOrExpandedBlocked = blockedLiveListingsAttempts.filter((attempt) =>
          isAdjacentOrExpandedListingsStrategy(attempt.strategy),
        );
        if (adjacentOrExpandedBlocked.length > 0) {
          logger.info(
            {
              label: "LISTINGS_ADJACENT_YEAR_LIVE_BLOCKED",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              blockedStrategies: adjacentOrExpandedBlocked.map((attempt) => attempt.strategy),
              sourceScreen: input.sourceScreen ?? null,
              action: input.action ?? null,
              fetchReason,
            },
            "LISTINGS_ADJACENT_YEAR_LIVE_BLOCKED",
          );
        }
      }
      logMarketGateEvaluated({
        label: "LISTINGS_LIVE_FETCH_GATE_EVALUATED",
        requestId: input.requestId,
        vehicleId: lookupVehicleId,
        allowLive,
        fetchReason,
        sourceScreen: input.sourceScreen ?? null,
        action: input.action ?? null,
        forceLive: input.forceLive ?? null,
        cacheKey,
        familyCacheKey,
        explicitRefresh: isExplicitListingsRefresh,
      });
      const listingsDecision = isListingsLiveFetchAllowed({
        allowLive,
        fetchReason,
        sourceScreen: input.sourceScreen,
        action: input.action,
        forceLive: input.forceLive,
      })
        ? providerBudgetService.evaluate({
            provider: providers.listingsProviderName,
            operation: "listings",
            userTier: "unknown",
            confidence: 0.95,
            duplicateRequest: false,
            cacheFresh: false,
            providerCooldownActive: false,
          })
        : {
            allowLiveProvider: false,
            reason: !isMarketCheckEnabled()
              ? "marketcheck-disabled"
              : !isExplicitListingsRefresh
                ? "live-fetch-requires-explicit-user-refresh"
                  : "live-fetch-disabled",
            cooldownActive: false,
            forcedMode: providerBudgetService.getForcedMode(),
            shouldUseFallback: true,
            shouldSimulateSuccess: false,
            shouldSimulateQuotaExhausted: false,
          };
      if (listingsDecision.shouldSimulateSuccess || listingsDecision.allowLiveProvider) {
        if (fetchReason === "user_requested_listings_refresh") {
          logger.info(
            {
              label: "LISTINGS_LIVE_REFRESH_REQUESTED",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              sourceScreen: input.sourceScreen ?? "listingsScreen",
              action: input.action ?? "listingsRefresh",
              cacheKey,
            },
            "LISTINGS_LIVE_REFRESH_REQUESTED",
          );
        }
        logMarketGateAllowed({
          label: "LISTINGS_LIVE_FETCH_ALLOWED",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          fetchReason,
        });
        logger.info(
          {
            label: "LISTINGS_LIVE_ATTEMPT_COUNT",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            liveAttemptCount: providerListingsAttempts.length,
            requestedAttemptCount: fallbackAttempts.length,
            configuredMaxLiveListingAttempts: MAX_LIVE_LISTING_ATTEMPTS,
            normalListingsRefresh,
            sourceScreen: input.sourceScreen ?? null,
            action: input.action ?? null,
            fetchReason,
            requestedForceLive: input.forceLive ?? null,
            effectiveForceLive: effectiveForceLiveListings,
          },
          "LISTINGS_LIVE_ATTEMPT_COUNT",
        );
        listingsWereSimulated = listingsDecision.shouldSimulateSuccess;
        for (const [attemptIndex, attempt] of providerListingsAttempts.entries()) {
          const attemptNumber = attemptIndex + 1;
          const maxAttempts = providerListingsAttempts.length;
          const attemptDescriptor = buildCacheDescriptor({ vehicle: attempt.vehicle });
          const attemptCacheKey = attemptDescriptor
            ? getListingsCacheKey(attemptDescriptor, { zip: input.zip, radiusMiles: attempt.radiusMiles })
            : cacheKey;
          if (normalListingsRefresh && attemptCacheKey && providers.listingsProviderName === "marketcheck") {
            const cachedAttempt = await repositories.listingsCache.findByCacheKey(attemptCacheKey).catch(() => null);
            const shouldBypassEmptyListingsCache = input.forceLive === true;
            if (cachedAttempt && isFresh(cachedAttempt.expiresAt, currentIso) && cachedAttempt.responseJson.isEmpty && !shouldBypassEmptyListingsCache) {
              await repositories.listingsCache.markAccessed(attemptCacheKey, currentIso).catch(() => undefined);
              await writeUsageLog({
                provider: cachedAttempt.provider,
                endpointType: "listings",
                eventType: "empty_hit",
                cacheKey: attemptCacheKey,
                requestSummary: {
                  ...input,
                  selectedLiveStrategy: attempt.strategy,
                  selectedTrim: attempt.vehicle.trim || null,
                  attemptNumber,
                  maxAttempts,
                },
                responseSummary: { count: 0, expiresAt: cachedAttempt.expiresAt },
              });
              logger.info(
                {
                  label: "LISTINGS_ZERO_CACHE_RESPECTED",
                  requestId: input.requestId,
                  vehicleId: lookupVehicleId,
                  cacheKey: attemptCacheKey,
                  strategy: attempt.strategy,
                  year: attempt.vehicle.year,
                  make: attempt.vehicle.make,
                  model: attempt.vehicle.model,
                  trim: attempt.vehicle.trim || null,
                  zip: input.zip,
                  radiusMiles: attempt.radiusMiles,
                  attemptNumber,
                  maxAttempts,
                  reason: "normal-listings-refresh-zero-result-cache",
                },
                "LISTINGS_ZERO_CACHE_RESPECTED",
              );
              liveListingsAttempts.push({
                strategy: attempt.strategy,
                returnedCount: 0,
                believableCount: 0,
              });
              continue;
            }
            if (cachedAttempt && isFresh(cachedAttempt.expiresAt, currentIso) && cachedAttempt.responseJson.isEmpty && shouldBypassEmptyListingsCache) {
              logger.info(
                {
                  label: "LISTINGS_ZERO_CACHE_BYPASSED",
                  requestId: input.requestId,
                  vehicleId: lookupVehicleId,
                  cacheKey: attemptCacheKey,
                  strategy: attempt.strategy,
                  attemptNumber,
                  maxAttempts,
                  reason: "explicit-user-refresh",
                },
                "LISTINGS_ZERO_CACHE_BYPASSED",
              );
            }
          }
          logger.info(
            {
              label: "LISTINGS_FALLBACK_ATTEMPT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              strategy: attempt.strategy,
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim ?? null,
              zip: input.zip,
              radiusMiles: attempt.radiusMiles,
              attemptNumber,
              maxAttempts,
              fallbackReason: fetchReason,
            },
            "LISTINGS_FALLBACK_ATTEMPT",
          );
          logMarketCheckApiFallbackAttempt({
            requestId: input.requestId,
            endpointType: "listings",
            vehicleId: lookupVehicleId,
            cacheKey: attemptCacheKey,
            strategy: attempt.strategy,
            reason: fetchReason,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim ?? null,
            zip: input.zip,
            radiusMiles: attempt.radiusMiles,
          });
          logger.info(
            {
              label: "LISTINGS_PROVIDER_ATTEMPT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              provider: providers.listingsProviderName,
              strategy: attempt.strategy,
              attemptNumber,
              maxAttempts,
              simulated: listingsWereSimulated,
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim ?? null,
              zip: input.zip,
              radiusMiles: attempt.radiusMiles,
              fallbackReason: fetchReason,
            },
            "LISTINGS_PROVIDER_ATTEMPT",
          );
          logger.info(
            {
              label: "LISTINGS_LOOKUP_QUERY",
              requestId: input.requestId,
              queryType: listingsWereSimulated ? "provider-simulated" : "provider-request",
              strategy: attempt.strategy,
              vehicleId: lookupVehicleId,
              year: attempt.vehicle.year,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              trim: attempt.vehicle.trim,
              zip: input.zip,
              radiusMiles: attempt.radiusMiles,
              attemptNumber,
              maxAttempts,
              fallbackReason: fetchReason,
            },
            "LISTINGS_LOOKUP_QUERY",
          );
          if (providers.listingsProviderName === "marketcheck") {
            logger.info(
              {
                label: "MARKETCHECK_CALL_SITE",
                route: "vehicle-listings",
                service: "VehicleService.getListings",
                provider: providers.listingsProviderName,
                reason: fetchReason,
                requestMeta: {
                  requestId: input.requestId,
                  allowLive,
                  action: input.action ?? "listingsRefresh",
                  vehicleId: lookupVehicleId,
                  cacheKey: attemptCacheKey,
                  year: attempt.vehicle.year,
                  make: attempt.vehicle.make,
                  model: attempt.vehicle.model,
                  trim: attempt.vehicle.trim ?? null,
                  attemptNumber,
                  maxAttempts,
                  fallbackStrategy: attempt.strategy,
                  fallbackReason: fetchReason,
                  sourceScreen: input.sourceScreen ?? "listingsScreen",
                  caller: "VehicleService.getListings",
                  stackTag: "vehicle-listings",
                },
              },
              "MARKETCHECK_CALL_SITE",
            );
          }
          liveListings = listingsWereSimulated
            ? await providerBudgetService.simulateListings({
                ...input,
                vehicleId: getSimulatedProviderVehicleId({ requestedVehicleId: lookupVehicleId, attemptVehicle: attempt.vehicle }),
                vehicle: attempt.vehicle,
                radiusMiles: attempt.radiusMiles,
              })
            : await providers.listingsProvider.getListings({
                ...input,
                vehicleId: lookupVehicleId,
                vehicle: attempt.vehicle,
                radiusMiles: attempt.radiusMiles,
                requestMeta: {
                  requestId: input.requestId,
                  reason: fetchReason,
                  allowLive,
                  forceLive: input.forceLive ?? null,
                  action: input.action ?? "listingsRefresh",
                  vehicleId: lookupVehicleId,
                  cacheKey: attemptCacheKey,
                  year: attempt.vehicle.year,
                  make: attempt.vehicle.make,
                  model: attempt.vehicle.model,
                  trim: attempt.vehicle.trim ?? null,
                  zip: input.zip,
                  radiusMiles: attempt.radiusMiles,
                  attemptNumber,
                  maxAttempts,
                  fallbackStrategy: attempt.strategy,
                  fallbackReason: fetchReason,
                  sourceScreen: input.sourceScreen ?? "listingsScreen",
                  caller: "VehicleService.getListings",
                  stackTag: "vehicle-listings",
                },
              }).catch((error) => {
                if (error instanceof AppError && error.code === "MARKETCHECK_RATE_LIMITED") {
                  logger.warn(
                    {
                      label: "PROVIDER_QUOTA_EXHAUSTED",
                      provider: providers.listingsProviderName,
                      operation: "listings",
                      vehicleId: lookupVehicleId,
                      strategy: attempt.strategy,
                    },
                    "PROVIDER_QUOTA_EXHAUSTED",
                  );
                  return [];
                }
                throw error;
              });
          liveListingsProviderAttempted = true;
          logger.info(
            {
              label: "LISTINGS_PROVIDER_RESULT_COUNT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              provider: providers.listingsProviderName,
              strategy: attempt.strategy,
              rawCount: liveListings.length,
            },
            "LISTINGS_PROVIDER_RESULT_COUNT",
          );
          const believableListings = filterDisplayableListings(liveListings, attempt.vehicle, input.descriptor?.yearRange ?? null, {
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            zip: input.zip,
            radiusMiles: attempt.radiusMiles,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            condition: null,
          });
          logger.info(
            {
              label: "LISTINGS_FILTERED_RESULT_COUNT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              strategy: attempt.strategy,
              rawCount: liveListings.length,
              believableCount: believableListings.length,
            },
            "LISTINGS_FILTERED_RESULT_COUNT",
          );
          logger.info(
            {
              label: "FORSALE_ATTEMPT_RESULT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              year: attempt.vehicle.year,
              trim: attempt.vehicle.trim || null,
              attemptType: attempt.strategy,
              rawCount: liveListings.length,
              believableCount: believableListings.length,
              finalKeptCount: believableListings.length,
            },
            "FORSALE_ATTEMPT_RESULT",
          );
          logger.info(
            {
              label: "LISTINGS_ATTEMPT_RESULT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              year: attempt.vehicle.year,
              trim: attempt.vehicle.trim || null,
              attemptType: attempt.strategy,
              rawCount: liveListings.length,
              believableCount: believableListings.length,
            },
            "LISTINGS_ATTEMPT_RESULT",
          );
          logger.info(
            {
              label: "FORSALE_FILTER_RESULT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              year: attempt.vehicle.year,
              trim: attempt.vehicle.trim || null,
              attemptType: attempt.strategy,
              rawCount: liveListings.length,
              believableCount: believableListings.length,
              finalKeptCount: believableListings.length,
            },
            "FORSALE_FILTER_RESULT",
          );
          logger.info(
            {
              label: "LISTINGS_BELIEVABLE_FILTER_RESULT",
              requestId: input.requestId,
              vehicleId: lookupVehicleId,
              make: attempt.vehicle.make,
              model: attempt.vehicle.model,
              year: attempt.vehicle.year,
              trim: attempt.vehicle.trim || null,
              attemptType: attempt.strategy,
              rawCount: liveListings.length,
              believableCount: believableListings.length,
            },
            "LISTINGS_BELIEVABLE_FILTER_RESULT",
          );
          liveListingsAttempts.push({
            strategy: attempt.strategy,
            returnedCount: liveListings.length,
            believableCount: believableListings.length,
          });
          if (believableListings.length > 0) {
            acceptedLiveListings = appendUniqueListings(acceptedLiveListings, believableListings);
            if (!acceptedLiveListingsStrategies.includes(attempt.strategy)) {
              acceptedLiveListingsStrategies.push(attempt.strategy);
            }
            liveListingsStrategy = liveListingsStrategy ?? attempt.strategy;
            logger.error(
              {
                label: attempt.label,
                requestId: input.requestId,
                strategy: attempt.strategy,
                vehicleId: lookupVehicleId,
                resultCount: liveListings.length,
                believableCount: believableListings.length,
                acceptedBelievableCount: acceptedLiveListings.length,
                targetBelievableCount: MIN_BELIEVABLE_LIVE_LISTINGS,
              },
              attempt.label,
            );
            if (acceptedLiveListings.length >= MIN_BELIEVABLE_LIVE_LISTINGS) {
              break;
            }
          }
        }
      } else {
        logMarketGateSkipped({
          label: "LISTINGS_LIVE_FETCH_SKIPPED",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          fetchReason,
          reason: listingsDecision.reason,
        });
        logger.info(
          {
            label: "LISTINGS_PROVIDER_SKIPPED_REASON",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            provider: providers.listingsProviderName,
            reason: listingsDecision.reason,
            allowLive,
            fetchReason,
            sourceScreen: input.sourceScreen ?? null,
            action: input.action ?? null,
            marketcheckEnabled: isMarketCheckEnabled(),
          },
          "LISTINGS_PROVIDER_SKIPPED_REASON",
        );
        if (listingsDecision.shouldSimulateQuotaExhausted) {
          logger.warn(
            {
              label: "PROVIDER_QUOTA_EXHAUSTED",
              provider: providers.listingsProviderName,
              operation: "listings",
              vehicleId: lookupVehicleId,
              mode: listingsDecision.forcedMode,
            },
            "PROVIDER_QUOTA_EXHAUSTED",
          );
        }
        logger.info(
          {
            label: "FALLBACK_USED",
            provider: providers.listingsProviderName,
            operation: "listings",
            vehicleId: lookupVehicleId,
            mode: listingsDecision.forcedMode,
            reason: listingsDecision.reason,
            route: "vehicle-listings",
          },
          "FALLBACK_USED",
        );
      }
      if (acceptedLiveListings.length > 0) {
        liveListings = acceptedLiveListings.slice(0, MAX_DISPLAY_LIVE_LISTINGS);
        liveListingsFinalStrategy =
          acceptedLiveListingsStrategies.find((strategy) => isAdjacentOrExpandedListingsStrategy(strategy)) ??
          liveListingsStrategy ??
          acceptedLiveListingsStrategies[0] ??
          null;
      }
      if (liveListingsProviderAttempted && listingsDecision.allowLiveProvider && descriptor && cacheKey && providers.listingsProviderName === "marketcheck") {
        await repositories.listingsCache.upsert(
          createListingsCacheRow({
            descriptor,
            cacheKey,
            provider: providers.listingsProviderName,
            payload: liveListings,
            zip: input.zip,
            radiusMiles: input.radiusMiles,
          }),
        );
        if (familyCacheKey) {
          await repositories.listingsCache.upsert(
            createListingsCacheRow({
              descriptor: { ...descriptor, trim: "", normalizedTrim: "family" },
              cacheKey: familyCacheKey,
              provider: providers.listingsProviderName,
              payload: liveListings,
              zip: input.zip,
              radiusMiles: input.radiusMiles,
            }),
          );
        }
        await fireAndForgetCleanup("listings");
      }

      const displayableLiveListings = filterDisplayableListings(liveListings, lookupBaseVehicle ?? null, input.descriptor?.yearRange ?? null, {
        requestId: input.requestId,
        vehicleId: lookupVehicleId,
        zip: input.zip,
        radiusMiles: input.radiusMiles,
        make: descriptor?.make ?? vehicle?.make ?? null,
        model: descriptor?.model ?? vehicle?.model ?? null,
        condition: null,
      });
      if (
        listingsDecision.allowLiveProvider &&
        descriptor &&
        providers.listingsProviderName === "marketcheck" &&
        typeof input.mileage === "number" &&
        Number.isFinite(input.mileage) &&
        input.mileage > 0 &&
        lookupBaseVehicle &&
        displayableLiveListings.length > 0
      ) {
        const derivedFromLiveListings = buildDerivedValuationFromListings({
          vehicle: lookupBaseVehicle,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: "good",
          listings: displayableLiveListings,
        });
        if (derivedFromLiveListings) {
          const valueCacheKey = getValuesCacheKey(descriptor, { zip: input.zip, mileage: input.mileage });
          const derivedConditionSet = buildConditionAwareValuation({
            valuation: derivedFromLiveListings,
            vehicle: lookupBaseVehicle,
            selectedCondition: "good",
          });
          await repositories.valuesCache.upsert(
            createValuesCacheRow({
              descriptor,
              cacheKey: valueCacheKey,
              provider: providers.listingsProviderName,
              payload: derivedConditionSet,
              zip: input.zip,
              mileage: input.mileage,
              condition: "good",
            }),
          );
          if (familyCacheKey) {
            const familyValueCacheKey = getFamilyValuesCacheKey(descriptor, { zip: input.zip, mileage: input.mileage });
            await repositories.valuesCache.upsert(
              createValuesCacheRow({
                descriptor: { ...descriptor, trim: "", normalizedTrim: "family" },
                cacheKey: familyValueCacheKey,
                provider: providers.listingsProviderName,
                payload: derivedConditionSet,
                zip: input.zip,
                mileage: input.mileage,
                condition: "good",
              }),
            );
          }
        }
      }
      if (displayableLiveListings.length > 0) {
        const cacheRow = listingsDecision.allowLiveProvider && descriptor && cacheKey && providers.listingsProviderName === "marketcheck"
          ? createListingsCacheRow({
              descriptor,
              cacheKey,
              provider: providers.listingsProviderName,
              payload: liveListings,
              zip: input.zip,
              radiusMiles: input.radiusMiles,
            })
          : null;
        logger.error(
          {
            label: "LISTINGS_FINAL_RESOLUTION",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            finalListingsSource: "provider",
            familyCacheUsed: false,
            similarVehicleFallbackUsed: false,
            adjacentYearRescueUsed:
              liveListingsFinalStrategy === "adjacent-year-previous" ||
              liveListingsFinalStrategy === "adjacent-year-next" ||
              liveListingsFinalStrategy === "adjacent-year-previous-2" ||
              liveListingsFinalStrategy === "adjacent-year-next-2",
            fallbackReason: liveListingsFinalStrategy ?? "provider-match",
            acceptedStrategies: acceptedLiveListingsStrategies,
          },
          "LISTINGS_FINAL_RESOLUTION",
        );
        logger.info(
          {
            label: "FORSALE_FINAL_PAYLOAD",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            make: vehicle?.make ?? descriptor?.make ?? null,
            model: vehicle?.model ?? descriptor?.model ?? null,
            year: vehicle?.year ?? descriptor?.year ?? null,
            trim: vehicle?.trim ?? descriptor?.trim ?? null,
            count: displayableLiveListings.length,
            believableCount: displayableLiveListings.length,
            finalSourceLabel: getListingsSourceLabel(liveListingsFinalStrategy),
            fallbackReason: liveListingsFinalStrategy ?? "provider-match",
            acceptedStrategies: acceptedLiveListingsStrategies,
          },
          "FORSALE_FINAL_PAYLOAD",
        );
        logger.info(
          {
            label: "LISTINGS_FINAL_PAYLOAD",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            make: vehicle?.make ?? descriptor?.make ?? null,
            model: vehicle?.model ?? descriptor?.model ?? null,
            year: vehicle?.year ?? descriptor?.year ?? null,
            trim: vehicle?.trim ?? descriptor?.trim ?? null,
            count: displayableLiveListings.length,
            believableCount: displayableLiveListings.length,
            finalSourceLabel: getListingsSourceLabel(liveListingsFinalStrategy),
            fallbackReason: liveListingsFinalStrategy ?? "provider-match",
            acceptedStrategies: acceptedLiveListingsStrategies,
          },
          "LISTINGS_FINAL_PAYLOAD",
        );
        logCommonVehicleDetailTrace({
          phase: "listings",
          requestId: input.requestId,
          descriptorResolved: Boolean(descriptor),
          vehicle: lookupBaseVehicle,
          descriptor: lookup.effectiveDescriptor,
          specsCandidateCount: 0,
          valueCandidateCount: 0,
          listingsCandidateCount: fallbackAttempts.length,
          listings: displayableLiveListings,
        });
        if (isCommonVehicleFamily({ make: vehicle?.make ?? descriptor?.make ?? null, model: vehicle?.model ?? descriptor?.model ?? null })) {
          logger.info(
            {
              label: "COMMON_LISTINGS_TRACE",
              requestId: input.requestId,
              year: vehicle?.year ?? descriptor?.year ?? null,
              make: vehicle?.make ?? descriptor?.make ?? null,
              model: vehicle?.model ?? descriptor?.model ?? null,
              normalizedModel: lookup.effectiveDescriptor?.normalizedModel ?? null,
              ...commonListingsAttemptSummary,
              rawListingCountPerAttempt: liveListingsAttempts.map((attempt) => ({
                strategy: attempt.strategy,
                rawCount: attempt.returnedCount,
                believableCount: attempt.believableCount,
              })),
              finalDisplayedListingsSource: getListingsSourceLabel(liveListingsFinalStrategy),
              fallbackReasonShown: liveListingsFinalStrategy ?? "provider-match",
              acceptedStrategies: acceptedLiveListingsStrategies,
            },
            "COMMON_LISTINGS_TRACE",
          );
        }
        logCrvListingsRuntimeTrace({
          finalReason: liveListingsFinalStrategy ?? "provider-match",
          finalSourceLabel: getListingsSourceLabel(liveListingsFinalStrategy),
          providerReturnedZeroAtAllAttempts: liveListingsAttempts.length > 0 && liveListingsAttempts.every((attempt) => attempt.returnedCount === 0),
          rawListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.returnedCount > 0),
          believableListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.believableCount > 0),
        });
        return {
          data: displayableLiveListings,
          source: "provider",
          fetchedAt: cacheRow?.fetchedAt ?? currentIso,
          expiresAt: cacheRow?.expiresAt ?? currentIso,
          meta: {
            sourceLabel: getListingsSourceLabel(liveListingsFinalStrategy),
            rawCount: displayableLiveListings.length,
            believableCount: displayableLiveListings.length,
            mode: resolveListingsDebugMode(liveListingsFinalStrategy),
            fallbackReason: liveListingsFinalStrategy ?? "provider-match",
          },
        };
      }
      logger.error(
        {
          label: "LISTINGS_FAILED",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          year: vehicle?.year ?? null,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
          trim: vehicle?.trim ?? null,
          attemptedStrategies: fallbackAttempts.map((attempt) => attempt.strategy),
        },
        "LISTINGS_FAILED",
      );
      logger.info(
        {
          label: "LISTINGS_EMPTY_REASON",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          reason:
            liveListingsAttempts.length === 0
              ? "no-listing-attempts-created"
              : liveListingsAttempts.every((attempt) => attempt.returnedCount === 0)
                ? "provider-returned-zero-at-all-attempts"
                : liveListingsAttempts.some((attempt) => attempt.returnedCount > 0) &&
                    liveListingsAttempts.every((attempt) => attempt.believableCount === 0)
                  ? "raw-listings-filtered-out-as-unbelievable"
                  : "no-believable-listings-found",
          rawAttemptCount: liveListingsAttempts.length,
          attempts: liveListingsAttempts,
        },
        "LISTINGS_EMPTY_REASON",
      );
      if (isCommonVehicleFamily({ make: vehicle?.make ?? descriptor?.make ?? null, model: vehicle?.model ?? descriptor?.model ?? null })) {
        logger.info(
          {
            label: "COMMON_LISTINGS_TRACE",
            requestId: input.requestId,
            year: vehicle?.year ?? descriptor?.year ?? null,
            make: vehicle?.make ?? descriptor?.make ?? null,
            model: vehicle?.model ?? descriptor?.model ?? null,
            normalizedModel: lookup.effectiveDescriptor?.normalizedModel ?? null,
            ...commonListingsAttemptSummary,
            rawListingCountPerAttempt: liveListingsAttempts.map((attempt) => ({
              strategy: attempt.strategy,
              rawCount: attempt.returnedCount,
              believableCount: attempt.believableCount,
            })),
            finalDisplayedListingsSource: null,
            fallbackReasonShown: "no-believable-listings-found",
          },
          "COMMON_LISTINGS_TRACE",
        );
      }
      if (shouldDebugCrv) {
        logger.error(
          {
            label: "DEBUG_CRV_TRACE",
            phase: "listings-pipeline-final",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            listingsPipeline: {
              attempts: liveListingsAttempts,
              finalStrategy: liveListingsStrategy,
              failureReason: !descriptor ? "descriptor-missing" : "no-believable-listings-found",
            },
          },
          "DEBUG_CRV_TRACE",
        );
      }
      logCrvListingsRuntimeTrace({
        finalReason:
          liveListingsAttempts.length === 0
            ? "no-listing-attempts-created"
            : liveListingsAttempts.every((attempt) => attempt.returnedCount === 0)
              ? "provider-returned-zero-at-all-attempts"
              : liveListingsAttempts.some((attempt) => attempt.returnedCount > 0) &&
                  liveListingsAttempts.every((attempt) => attempt.believableCount === 0)
                ? "raw-listings-filtered-out-as-unbelievable"
                : "no-believable-listings-found",
        finalSourceLabel: null,
        providerReturnedZeroAtAllAttempts: liveListingsAttempts.length > 0 && liveListingsAttempts.every((attempt) => attempt.returnedCount === 0),
        rawListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.returnedCount > 0),
        believableListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.believableCount > 0),
      });
      const storedListings = await repositories.listingResults.listByVehicle({
        vehicleId: lookupVehicleId,
        zip: input.zip,
        radiusMiles: input.radiusMiles,
      });
      const displayableStoredListings = filterDisplayableListings(storedListings, lookupBaseVehicle ?? null, input.descriptor?.yearRange ?? null, {
        requestId: input.requestId,
        vehicleId: lookupVehicleId,
        zip: input.zip,
        radiusMiles: input.radiusMiles,
        make: descriptor?.make ?? vehicle?.make ?? null,
        model: descriptor?.model ?? vehicle?.model ?? null,
        condition: null,
      });
      if (displayableStoredListings.length > 0) {
        logger.error(
          {
            label: "LISTINGS_LOOKUP_SUCCESS",
            requestId: input.requestId,
            strategy: "stored-listings-fallback",
            vehicleId: lookupVehicleId,
            resultCount: displayableStoredListings.length,
          },
          "LISTINGS_LOOKUP_SUCCESS",
        );
        logger.error(
          {
            label: "LISTINGS_FINAL_RESOLUTION",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            finalListingsSource: "stored_listings",
            familyCacheUsed: false,
            similarVehicleFallbackUsed: false,
            adjacentYearRescueUsed: false,
            fallbackReason: "stored-listings-fallback",
          },
          "LISTINGS_FINAL_RESOLUTION",
        );
        logger.info(
          {
            label: "FORSALE_FINAL_PAYLOAD",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            make: vehicle?.make ?? descriptor?.make ?? null,
            model: vehicle?.model ?? descriptor?.model ?? null,
            year: vehicle?.year ?? descriptor?.year ?? null,
            trim: vehicle?.trim ?? descriptor?.trim ?? null,
            count: displayableStoredListings.length,
            believableCount: displayableStoredListings.length,
            finalSourceLabel: "Cached listings",
            fallbackReason: "stored-listings-fallback",
          },
          "FORSALE_FINAL_PAYLOAD",
        );
        logger.info(
          {
            label: "LISTINGS_FINAL_PAYLOAD",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            make: vehicle?.make ?? descriptor?.make ?? null,
            model: vehicle?.model ?? descriptor?.model ?? null,
            year: vehicle?.year ?? descriptor?.year ?? null,
            trim: vehicle?.trim ?? descriptor?.trim ?? null,
            count: displayableStoredListings.length,
            believableCount: displayableStoredListings.length,
            finalSourceLabel: "Cached listings",
            fallbackReason: "stored-listings-fallback",
          },
          "LISTINGS_FINAL_PAYLOAD",
        );
        logCommonVehicleDetailTrace({
          phase: "listings",
          requestId: input.requestId,
          descriptorResolved: Boolean(descriptor),
          vehicle: lookupBaseVehicle,
          descriptor: lookup.effectiveDescriptor,
          specsCandidateCount: 0,
          valueCandidateCount: 0,
          listingsCandidateCount: fallbackAttempts.length,
          listings: displayableStoredListings,
          thinReason: "stored-listings-fallback",
        });
        if (isCommonVehicleFamily({ make: vehicle?.make ?? descriptor?.make ?? null, model: vehicle?.model ?? descriptor?.model ?? null })) {
          logger.info(
            {
              label: "COMMON_LISTINGS_TRACE",
              requestId: input.requestId,
              year: vehicle?.year ?? descriptor?.year ?? null,
              make: vehicle?.make ?? descriptor?.make ?? null,
              model: vehicle?.model ?? descriptor?.model ?? null,
              normalizedModel: lookup.effectiveDescriptor?.normalizedModel ?? null,
              ...commonListingsAttemptSummary,
              rawListingCountPerAttempt: liveListingsAttempts.map((attempt) => ({
                strategy: attempt.strategy,
                rawCount: attempt.returnedCount,
                believableCount: attempt.believableCount,
              })),
              finalDisplayedListingsSource: "Cached listings",
              fallbackReasonShown: "stored-listings-fallback",
            },
            "COMMON_LISTINGS_TRACE",
          );
        }
        logCrvListingsRuntimeTrace({
          finalReason: "stored-listings-fallback",
          finalSourceLabel: "Cached listings",
          providerReturnedZeroAtAllAttempts: liveListingsAttempts.length > 0 && liveListingsAttempts.every((attempt) => attempt.returnedCount === 0),
          rawListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.returnedCount > 0),
          believableListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.believableCount > 0),
        });
        return {
          data: displayableStoredListings,
          source: "provider",
          fetchedAt: currentIso,
          expiresAt: currentIso,
          meta: {
            sourceLabel: "Cached listings",
            rawCount: displayableStoredListings.length,
            believableCount: displayableStoredListings.length,
            mode: "none",
            fallbackReason: "stored-listings-fallback",
          },
        };
      }

      if (!allowLive) {
        return {
          data: [],
          source: "cache",
          fetchedAt: currentIso,
          expiresAt: currentIso,
          meta: {
            sourceLabel: "Live listings available on demand",
            rawCount: 0,
            believableCount: 0,
            mode: "none",
            fallbackReason: "live-fetch-deferred",
            liveFetchDeferred: true,
          },
        };
      }

      logger.error(
        {
          label: "LISTINGS_FAILED",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          reason: "no-believable-listings-found",
        },
        "LISTINGS_FAILED",
      );
      logger.error(
        {
          label: "LISTINGS_FINAL_RESOLUTION",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          finalListingsSource: null,
          familyCacheUsed: false,
          similarVehicleFallbackUsed: false,
          adjacentYearRescueUsed: false,
          fallbackReason: "no-believable-listings-found",
        },
        "LISTINGS_FINAL_RESOLUTION",
      );
      logger.info(
        {
          label: "FORSALE_FINAL_PAYLOAD",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          year: vehicle?.year ?? descriptor?.year ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          count: 0,
          believableCount: 0,
          finalSourceLabel: null,
          fallbackReason: "no-believable-listings-found",
        },
        "FORSALE_FINAL_PAYLOAD",
      );
      logger.info(
        {
          label: "LISTINGS_FINAL_PAYLOAD",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          year: vehicle?.year ?? descriptor?.year ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          count: 0,
          believableCount: 0,
          finalSourceLabel: null,
          fallbackReason: "no-believable-listings-found",
        },
        "LISTINGS_FINAL_PAYLOAD",
      );
      logCommonVehicleDetailTrace({
        phase: "listings",
        requestId: input.requestId,
        descriptorResolved: Boolean(descriptor),
        vehicle: lookupBaseVehicle,
        descriptor: lookup.effectiveDescriptor,
        specsCandidateCount: 0,
        valueCandidateCount: 0,
        listingsCandidateCount: fallbackAttempts.length,
        listings: [],
        thinReason: "no-believable-listings-found",
      });
      if (isCommonVehicleFamily({ make: vehicle?.make ?? descriptor?.make ?? null, model: vehicle?.model ?? descriptor?.model ?? null })) {
        logger.error(
          {
            label: "COMMON_VEHICLE_LISTINGS_ZERO_SUSPICIOUS",
            requestId: input.requestId,
            normalizedQuery: normalizedListingsQuery,
            radiusMiles: input.radiusMiles,
            yearRange:
              input.descriptor?.yearRange
                ? [input.descriptor.yearRange.start - 1, input.descriptor.yearRange.end + 1]
                : normalizedListingsQuery.year
                  ? [normalizedListingsQuery.year - 1, normalizedListingsQuery.year + 1]
                  : null,
            trimMode: fallbackAttempts.some((attempt) => normalizeVehicleLookupText(attempt.vehicle.trim) === "") ? "any-trim-enabled" : "trim-restricted",
            providerUsed: providers.listingsProviderName,
            reasonBelievedZero:
              liveListingsAttempts.length === 0
                ? "no-listings-attempts-created"
                : liveListingsAttempts.every((attempt) => attempt.returnedCount === 0)
                  ? "provider-returned-zero-at-all-attempts"
                  : liveListingsAttempts.some((attempt) => attempt.returnedCount > 0) &&
                      liveListingsAttempts.every((attempt) => attempt.believableCount === 0)
                    ? "raw-listings-filtered-out-as-unbelievable"
                    : "no-believable-listings-found",
          },
          "COMMON_VEHICLE_LISTINGS_ZERO_SUSPICIOUS",
        );
      }
      logCrvListingsRuntimeTrace({
        finalReason:
          liveListingsAttempts.length === 0
            ? "no-listings-attempts-created"
            : liveListingsAttempts.every((attempt) => attempt.returnedCount === 0)
              ? "provider-returned-zero-at-all-attempts"
              : liveListingsAttempts.some((attempt) => attempt.returnedCount > 0) &&
                  liveListingsAttempts.every((attempt) => attempt.believableCount === 0)
                ? "raw-listings-filtered-out-as-unbelievable"
                : "no-believable-listings-found",
        finalSourceLabel: null,
        providerReturnedZeroAtAllAttempts: liveListingsAttempts.length > 0 && liveListingsAttempts.every((attempt) => attempt.returnedCount === 0),
        rawListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.returnedCount > 0),
        believableListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.believableCount > 0),
      });
      return {
        data: [],
        source: "provider",
        fetchedAt: currentIso,
        expiresAt: currentIso,
        meta: {
          sourceLabel: null,
          rawCount: 0,
          believableCount: 0,
          mode: "none",
          fallbackReason: "no-believable-listings-found",
        },
      };
    } catch (error) {
      const lookup = await resolveLookupContext(input);
      const vehicle = lookup.vehicle;
      const descriptor = lookup.cacheDescriptor;
      const lookupVehicleId = lookup.lookupVehicleId;
      const cacheKey = descriptor ? getListingsCacheKey(descriptor, input) : null;
      logger.error(
        {
          label: "LISTINGS_LOOKUP_FAILURE",
          requestId: input.requestId,
          vehicleId: lookupVehicleId,
          year: vehicle?.year ?? descriptor?.year ?? null,
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          bodyStyle: vehicle?.bodyStyle ?? null,
          ...getErrorDetails(error),
        },
        "LISTINGS_LOOKUP_FAILURE",
      );
      if (cacheKey) {
        await writeUsageLog({
          provider: providers.listingsProviderName,
          endpointType: "listings",
          eventType: "provider_error",
          cacheKey,
          requestSummary: input,
          responseSummary: { error: error instanceof Error ? error.message : "Unknown provider error" },
        });
      }
      throw error;
    }
  }

  async evaluateUnlockPayloadForVehicle(vehicle: VehicleRecord): Promise<PayloadEvaluation> {
    if (!DEFAULT_UNLOCK_EVALUATION_ZIP) {
      return evaluateVehiclePayloadStrength({
        vehicle,
        valuation: null,
        listings: [],
      });
    }
    const valuation = await this.getValue({
      vehicleId: vehicle.id,
      zip: DEFAULT_UNLOCK_EVALUATION_ZIP,
      mileage: DEFAULT_UNLOCK_EVALUATION_MILEAGE,
      condition: DEFAULT_UNLOCK_EVALUATION_CONDITION,
    })
      .then((result) => result.data)
      .catch(() => null);
    const listings = await this.getListings({
      vehicleId: vehicle.id,
      zip: DEFAULT_UNLOCK_EVALUATION_ZIP,
      radiusMiles: DEFAULT_UNLOCK_EVALUATION_RADIUS_MILES,
    })
      .then((result) => result.data)
      .catch(() => []);

    return evaluateVehiclePayloadStrength({
      vehicle,
      valuation,
      listings,
    });
  }
}
