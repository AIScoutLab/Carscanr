import crypto from "node:crypto";
import { env, isMarketCheckScanEnrichmentEnabled } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import { mapCanonicalVehicleToRecord, resolveStoredVehicleRecordById, upsertCanonicalVehicleFromAiLearned, upsertCanonicalVehicleFromProvider } from "../lib/canonicalVehicleCatalog.js";
import { logger } from "../lib/logger.js";
import { providers } from "../lib/providerRegistry.js";
import { buildCanonicalKey, normalizeLookupText } from "../lib/providerCache.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { buildAnalysisKey, buildImageKey, buildVehicleKey } from "../lib/cacheKeys.js";
import { resizeForVision, computeDhashHex } from "../lib/imageProcessing.js";
import { createVehicleFocusCrop } from "../lib/vehicleImageCrop.js";
import { matchesCanonicalLookupModel, normalizeMercedesSlIdentity, shouldBroadenCanonicalLookupModelSearch } from "../lib/vehicleAliases.js";
import { refineVehicleYearEstimate } from "../lib/yearRefinement.js";
import { buildLiveVehicleId } from "../providers/marketcheck/vehicleId.js";
import { AuthContext, CanonicalGapQueueRecord, EnrichmentMode, ListingRecord, MatchedVehicleCandidate, PayloadEvaluation, ScanRecord, VehicleRecord, VisionProviderResult, VisionResult } from "../types/domain.js";
import { AnalysisCacheService } from "./analysisCacheService.js";
import { coverageInstrumentationService } from "./coverageInstrumentationService.js";
import { GoogleVisionOcrResult, googleVisionOcrService } from "./googleVisionOcrService.js";
import { providerBudgetService } from "./providerBudgetService.js";
import { photoClusterService } from "./photoClusterService.js";
import { UsageService } from "./usageService.js";
import { UnlockService } from "./unlockService.js";
import { VehicleService, evaluateVehiclePayloadStrength } from "./vehicleService.js";

type ScanFailureStage =
  | "USAGE_CHECK"
  | "ENTITLEMENT_CHECK"
  | "IMAGE_PROCESSING"
  | "CACHE_LOOKUP"
  | "VISION_REQUEST"
  | "VEHICLE_MATCH"
  | "SCAN_PERSIST"
  | "VISION_DEBUG_WRITE"
  | "USAGE_WRITE";

type ProviderEnrichmentContext = {
  scanId: string;
  allowScanProviderEnrichment: boolean;
  providerAttempted: boolean;
  providerSkipped: boolean;
  providerRateLimited: boolean;
  providerAttemptCount: number;
  canonicalHit: boolean;
  visibleBadgeText?: string;
  visibleMakeText?: string;
  visibleModelText?: string;
  visibleTrimText?: string;
  displayYearRange?: {
    start: number;
    end: number;
  } | null;
  yearConfidence?: VisionResult["yearConfidence"];
  yearEvidence?: VisionResult["yearEvidence"];
  popularityMatches?: Array<{
    normalizedKey: string;
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim: string;
    scanCount: number;
  }>;
  trendingMatches?: Array<{
    normalizedKey: string;
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim: string;
    trendScore: number;
  }>;
};

type LockedDisplayIdentity = {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  source?: VisionResult["source"];
  confidence: number;
  visibleBadgeText?: string | null;
  visibleMakeText?: string | null;
  visibleModelText?: string | null;
  visibleTrimText?: string | null;
};

type YearClassification = {
  yearConfidence: "exact" | "estimated" | "range";
  yearEvidence: string | null;
  yearRange: {
    start: number;
    end: number;
  } | null;
  candidateYears: number[];
};

type CanonicalIdentityDecision =
  | "exact_identity_match"
  | "adjacent_year_enrichment"
  | "family_enrichment_only"
  | "rejected_identity_mismatch";

const MAX_PROVIDER_CALLS_PER_SCAN = 1;
const STABILITY_CACHE_TTL_MS = 20 * 60 * 1000;
const STABILITY_CACHE_PREFIX_LENGTH = 12;
const MAX_STABILITY_CACHE_ENTRIES = 200;
const AUTO_PROMOTION_THRESHOLD = 5;
const LIVE_CANONICAL_MISS_PROVIDER_RESCUE_MIN_CONFIDENCE = 0.88;
const DEFAULT_PREVIEW_ZIP = "60610";
const DEFAULT_PREVIEW_MILEAGE = 25000;
const DEFAULT_PREVIEW_CONDITION = "good";
const DEFAULT_PREVIEW_RADIUS_MILES = 50;

type StabilityCacheEntry = {
  userId: string;
  visualHash: string;
  normalizedResult: VisionResult;
  resolvedVehicles: MatchedVehicleCandidate[];
  confidence: number;
  createdAt: number;
};

type StabilityCacheMatch = StabilityCacheEntry & {
  matchType: "exact";
};

const scanStabilityCache: StabilityCacheEntry[] = [];

export function resetScanStabilityCache() {
  scanStabilityCache.splice(0, scanStabilityCache.length);
}

function serializeScanError(error: unknown) {
  const baseError =
    error instanceof Error
      ? error
      : new Error(typeof error === "string" ? error : `Non-Error thrown: ${safeSerializeUnknown(error)}`);
  const appError = error instanceof AppError ? error : null;
  const details = appError?.details;
  const hint = details && typeof details === "object" && "hint" in details ? (details as { hint?: unknown }).hint : undefined;
  return {
    message: baseError.message,
    stack: baseError.stack,
    code: appError?.code,
    details,
    hint,
  };
}

function safeSerializeUnknown(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeUnknownError(error: unknown) {
  if (error instanceof AppError) {
    const details = error.details && typeof error.details === "object" ? (error.details as Record<string, unknown>) : null;
    const supabase = details?.supabase && typeof details.supabase === "object" ? (details.supabase as Record<string, unknown>) : null;
    return {
      reason: error.message,
      errorCode: error.code,
      details: error.details,
      hint: supabase?.hint ?? null,
      supabase,
    };
  }
  if (error instanceof Error) {
    return {
      reason: error.message,
      errorCode: null,
      details: null,
      hint: null,
      supabase: null,
    };
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      reason: typeof record.message === "string" ? record.message : safeSerializeUnknown(error),
      errorCode: typeof record.code === "string" ? record.code : null,
      details: "details" in record ? record.details : null,
      hint: typeof record.hint === "string" ? record.hint : null,
      supabase: null,
    };
  }
  return {
    reason: String(error),
    errorCode: null,
    details: null,
    hint: null,
    supabase: null,
  };
}

function buildUnknownVisionFailureProviderResult(error: unknown): VisionProviderResult {
  const described = describeUnknownError(error);
  return {
    normalized: {
      vehicle_type: "car",
      likely_year: 0,
      likely_make: "",
      likely_model: "",
      likely_trim: "",
      source: "visual_candidate",
      confidence: 0,
      alternate_candidates: [],
      visible_clues: [],
    },
    rawResponse: {
      mode: "unknown_after_vision_failure",
      error: described,
    },
    provider: "unknown_after_vision_failure",
  };
}

function normalizeMatchText(value: string | undefined | null) {
  return normalizeLookupText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(sedan|coupe|hatchback|wagon|suv|crossover|truck|van|convertible|standard|base|sport|limited|premium|luxury|touring|edition)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildModelFamily(value: string | undefined | null) {
  const normalized = normalizeMatchText(value);
  return normalized.split(" ").slice(0, 2).join(" ").trim();
}

function buildLockedDisplayIdentity(result: VisionResult): LockedDisplayIdentity {
  return {
    year: result.likely_year,
    make: result.likely_make,
    model: result.likely_model,
    trim: result.likely_trim ?? null,
    source: result.source,
    confidence: result.confidence,
    visibleBadgeText: result.visible_badge_text ?? null,
    visibleMakeText: result.visible_make_text ?? null,
    visibleModelText: result.visible_model_text ?? null,
    visibleTrimText: result.visible_trim_text ?? null,
  };
}

function classifyYearEvidence(result: VisionResult): YearClassification {
  if (result.yearEvidence === "profile_refined_visual_generation" && result.yearRange) {
    const candidateYears = buildOrderedYearsWithinRange(
      result.likely_year,
      result.yearRange.start,
      result.yearRange.end,
    );
    return {
      yearConfidence: result.yearConfidence === "exact" ? "range" : (result.yearConfidence ?? "range"),
      yearEvidence: "profile_refined_visual_generation",
      yearRange: result.yearRange,
      candidateYears,
    };
  }

  const visibleYearEvidence = extractVisibleYearEvidence(
    result.visible_badge_text,
    result.visible_make_text,
    result.visible_model_text,
    result.visible_trim_text,
    result.visible_clues,
  );
  if (typeof visibleYearEvidence === "number" && visibleYearEvidence > 0) {
    return {
      yearConfidence: "exact",
      yearEvidence: "visible_text",
      yearRange: null,
      candidateYears: [visibleYearEvidence],
    };
  }

  const nearbyYears = [
    result.likely_year,
    ...result.alternate_candidates
      .filter(
        (candidate) =>
          normalizeMatchText(candidate.likely_make) === normalizeMatchText(result.likely_make) &&
          normalizeModelFamily(candidate.likely_model) === normalizeModelFamily(result.likely_model) &&
          Math.abs(candidate.likely_year - result.likely_year) <= 3 &&
          Math.abs(candidate.confidence - result.confidence) <= 0.08,
      )
      .map((candidate) => candidate.likely_year),
  ]
    .filter((year) => Number.isFinite(year) && year > 0)
    .filter((year, index, array) => array.indexOf(year) === index)
    .sort((left, right) => left - right);

  if (nearbyYears.length >= 2) {
    return {
      yearConfidence: "range",
      yearEvidence: "visual_generation_estimate",
      yearRange: {
        start: nearbyYears[0],
        end: nearbyYears[nearbyYears.length - 1],
      },
      candidateYears: nearbyYears,
    };
  }

  if (result.likely_year > 0) {
    const defaultRange = {
      start: Math.max(1980, result.likely_year - 2),
      end: Math.min(new Date().getFullYear() + 1, result.likely_year + 3),
    };
    return {
      yearConfidence: "estimated",
      yearEvidence: "visual_only",
      yearRange: defaultRange,
      candidateYears: Array.from(
        new Set(
          buildOrderedYearDeltas(3)
            .map((delta) => result.likely_year + delta)
            .filter((year) => year >= defaultRange.start && year <= defaultRange.end),
        ),
      ),
    };
  }

  return {
    yearConfidence: "estimated",
    yearEvidence: "visual_only",
    yearRange: null,
    candidateYears: result.likely_year > 0 ? [result.likely_year] : [],
  };
}

function buildOrderedYearDeltas(maxDistance: number) {
  const deltas = [0];
  for (let distance = 1; distance <= maxDistance; distance += 1) {
    deltas.push(distance, -distance);
  }
  return deltas;
}

function buildOrderedYearsWithinRange(center: number, start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index).sort((left, right) => {
    const leftDistance = Math.abs(left - center);
    const rightDistance = Math.abs(right - center);
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    if (left >= center && right < center) {
      return -1;
    }
    if (right >= center && left < center) {
      return 1;
    }
    return left - right;
  });
}

function buildYearRangeLabel(yearRange: { start: number; end: number } | null) {
  if (!yearRange) {
    return null;
  }
  return yearRange.start === yearRange.end ? `${yearRange.start}` : `${yearRange.start}-${yearRange.end}`;
}

function buildGenerationFallbackRangeForExactYear(result: VisionResult) {
  if (!result.exactYearConfirmed || result.likely_year <= 0) {
    return result.yearRange ?? null;
  }
  return {
    start: Math.max(1980, result.likely_year - 2),
    end: Math.min(new Date().getFullYear() + 1, result.likely_year + 1),
  };
}

function buildEnrichmentAllowedYearRange(result: VisionResult) {
  return buildGenerationFallbackRangeForExactYear(result) ?? result.yearRange ?? null;
}

function buildGenerationFallbackDisplayLabel(result: VisionResult) {
  return buildYearRangeLabel(buildGenerationFallbackRangeForExactYear(result));
}

function classifyExactYearConfirmation(result: VisionResult, classification: {
  yearConfidence: "exact" | "estimated" | "range";
  yearEvidence: string | null;
  yearRange: { start: number; end: number } | null;
}) {
  const visibleYearEvidence = extractVisibleYearEvidence(
    result.visible_badge_text,
    result.visible_make_text,
    result.visible_model_text,
    result.visible_trim_text,
    result.visible_clues,
  );
  const yearRangeWidth =
    classification.yearRange != null ? Math.max(0, classification.yearRange.end - classification.yearRange.start) : 0;
  const exactYearConfirmed =
    classification.yearConfidence === "exact" &&
    classification.yearEvidence === "visible_text" &&
    typeof visibleYearEvidence === "number" &&
    visibleYearEvidence > 0;

  if (
    !exactYearConfirmed &&
    classification.yearRange &&
    yearRangeWidth > 2 &&
    visibleYearEvidence == null &&
    (classification.yearEvidence === "visual_only" ||
      classification.yearEvidence === "visual_generation_estimate" ||
      classification.yearEvidence === "profile_refined_visual_generation")
  ) {
    return {
      exactYearConfirmed: false,
      displayYearLabel: buildYearRangeLabel(classification.yearRange),
    };
  }

  if (!exactYearConfirmed && classification.yearRange && hasUnconfirmedVisualYear({
    ...result,
    yearConfidence: classification.yearConfidence,
    yearEvidence: classification.yearEvidence,
    yearRange: classification.yearRange,
  })) {
    return {
      exactYearConfirmed: false,
      displayYearLabel: buildYearRangeLabel(classification.yearRange),
    };
  }

  return {
    exactYearConfirmed,
    displayYearLabel:
      exactYearConfirmed && result.likely_year > 0 ? `${result.likely_year}` : buildYearRangeLabel(classification.yearRange),
  };
}

function applyYearClassification(result: VisionResult, scanId?: string) {
  const classification = classifyYearEvidence(result);
  const display = classifyExactYearConfirmation(result, classification);
  if (scanId) {
    logger.info(
      {
        label: "YEAR_CONFIDENCE_CLASSIFIED",
        scanId,
        likelyYear: result.likely_year,
        yearConfidence: classification.yearConfidence,
        yearEvidence: classification.yearEvidence,
        exactYearConfirmed: display.exactYearConfirmed,
        displayYearLabel: display.displayYearLabel,
        yearRange: classification.yearRange,
      },
      "YEAR_CONFIDENCE_CLASSIFIED",
    );
    if (classification.candidateYears.length > 1) {
      logger.info(
        {
          label: "YEAR_RANGE_CANDIDATES_BUILT",
          scanId,
          likelyYear: result.likely_year,
          candidateYears: classification.candidateYears,
        },
        "YEAR_RANGE_CANDIDATES_BUILT",
      );
    }
    if (classification.yearEvidence === "visual_only" && classification.yearRange) {
      logger.info(
        {
          label: "YEAR_RANGE_DEFAULTED_FOR_VISUAL_ONLY",
          scanId,
          likelyYear: result.likely_year,
          yearRange: classification.yearRange,
        },
        "YEAR_RANGE_DEFAULTED_FOR_VISUAL_ONLY",
      );
    }
  }
  return normalizeVisionResult({
    ...result,
    yearConfidence: classification.yearConfidence,
    yearEvidence: classification.yearEvidence,
    exactYearConfirmed: display.exactYearConfirmed,
    displayYearLabel: display.displayYearLabel,
    yearRange: classification.yearRange,
  });
}

function hasMeaningfulExtraModelTokens(baseModel: string, candidateModel: string) {
  const baseTokens = tokenizeMatchText(baseModel);
  const candidateTokens = tokenizeMatchText(candidateModel);
  if (baseTokens.length === 0 || candidateTokens.length === 0) {
    return false;
  }
  const baseSet = new Set(baseTokens);
  const allowedExtraTokens = new Set(["base", "sport", "limited", "premium", "luxury", "touring", "standard", "special"]);
  return candidateTokens.some((token) => !baseSet.has(token) && !allowedExtraTokens.has(token));
}

function isStrictModelSiblingMismatch(locked: LockedDisplayIdentity, candidate: Pick<MatchedVehicleCandidate, "make" | "model" | "trim">) {
  const lockedMake = normalizeMatchText(locked.make);
  const lockedModel = normalizeMatchText(locked.model);
  const lockedTrim = normalizeMatchText(locked.trim ?? "");
  const visibleBadge = normalizeMatchText(locked.visibleBadgeText ?? "");
  const visibleModel = normalizeMatchText(locked.visibleModelText ?? "");
  const candidateMake = normalizeMatchText(candidate.make);
  const candidateModel = normalizeMatchText(candidate.model);

  if (!lockedMake || !lockedModel || !candidateMake || !candidateModel) {
    return false;
  }
  if (lockedMake !== candidateMake) {
    return true;
  }
  if (
    (lockedMake === "toyota" && ((lockedModel === "highlander" && candidateModel === "grand highlander") || (lockedModel === "grand highlander" && candidateModel === "highlander"))) ||
    (lockedMake === "honda" && ((lockedModel === "civic" && candidateModel === "civic del sol") || (lockedModel === "civic del sol" && candidateModel === "civic")))
  ) {
    return true;
  }
  if (lockedMake === "aston martin" && lockedModel === "vantage") {
    if (candidateModel === "v8 vantage") {
      return false;
    }
    if (candidateModel === "v12 vantage" && !/\bv12\b/.test(lockedTrim) && !/\bv12\b/.test(visibleBadge) && !/\bv12\b/.test(visibleModel)) {
      return true;
    }
  }
  if (lockedModel !== candidateModel) {
    if (candidateModel.includes(lockedModel) && hasMeaningfulExtraModelTokens(locked.model, candidate.model)) {
      return true;
    }
    if (lockedModel.includes(candidateModel) && hasMeaningfulExtraModelTokens(candidate.model, locked.model)) {
      return true;
    }
  }
  return false;
}

function isAstonMartinVantageFamily(input: { make?: string | null; model?: string | null }) {
  return normalizeMatchText(input.make) === "aston martin" && normalizeMatchText(input.model) === "vantage";
}

function hasAstonMartinV12Evidence(input: {
  trim?: string | null;
  visibleBadgeText?: string | null;
  visibleModelText?: string | null;
}) {
  const evidence = [input.trim, input.visibleBadgeText, input.visibleModelText]
    .map((value) => normalizeMatchText(value))
    .join(" ");
  return /\bv12\b/.test(evidence);
}

function isAllowedAstonMartinVantageCanonicalModel(input: {
  requestedMake?: string | null;
  requestedModel?: string | null;
  candidateModel?: string | null;
  trim?: string | null;
  visibleBadgeText?: string | null;
  visibleModelText?: string | null;
}) {
  if (!isAstonMartinVantageFamily({ make: input.requestedMake, model: input.requestedModel })) {
    return normalizeMatchText(input.requestedModel) === normalizeMatchText(input.candidateModel);
  }

  const candidateModel = normalizeMatchText(input.candidateModel);
  if (candidateModel === "vantage" || candidateModel === "v8 vantage") {
    return true;
  }
  if (candidateModel === "v12 vantage") {
    return hasAstonMartinV12Evidence(input);
  }
  return false;
}

function hasUsableFreeDisplaySpecs(vehicle: Pick<VehicleRecord, "drivetrain" | "bodyStyle" | "engine" | "horsepower" | "transmission" | "fuelType" | "msrp"> | null | undefined) {
  if (!vehicle) {
    return false;
  }
  return (
    Boolean(vehicle.drivetrain?.trim()) ||
    Boolean(vehicle.bodyStyle?.trim()) ||
    Boolean(vehicle.engine?.trim()) ||
    (typeof vehicle.horsepower === "number" && Number.isFinite(vehicle.horsepower) && vehicle.horsepower > 0) ||
    Boolean(vehicle.transmission?.trim()) ||
    Boolean(vehicle.fuelType?.trim()) ||
    (typeof vehicle.msrp === "number" && Number.isFinite(vehicle.msrp) && vehicle.msrp > 0)
  );
}

function getAstonMartinVantageCanonicalPreferenceScore(input: {
  requestedMake?: string | null;
  requestedModel?: string | null;
  candidateModel?: string | null;
  trim?: string | null;
  visibleBadgeText?: string | null;
  visibleModelText?: string | null;
}) {
  if (!isAstonMartinVantageFamily({ make: input.requestedMake, model: input.requestedModel })) {
    return 0;
  }

  const candidateModel = normalizeMatchText(input.candidateModel);
  const prefersV12 = hasAstonMartinV12Evidence(input);
  if (prefersV12) {
    if (candidateModel === "v12 vantage") return 0;
    if (candidateModel === "v8 vantage") return 1;
    if (candidateModel === "vantage") return 2;
    return 3;
  }
  if (candidateModel === "v8 vantage") return 0;
  if (candidateModel === "vantage") return 1;
  if (candidateModel === "v12 vantage") return 2;
  return 3;
}

function isAstonMartinVantageFamilyCompatible(input: {
  lockedMake?: string | null;
  lockedModel?: string | null;
  candidateMake?: string | null;
  candidateModel?: string | null;
  trim?: string | null;
  visibleBadgeText?: string | null;
  visibleModelText?: string | null;
}) {
  if (
    normalizeMatchText(input.lockedMake) !== "aston martin" ||
    normalizeMatchText(input.candidateMake) !== "aston martin"
  ) {
    return false;
  }

  const lockedIsFamily = normalizeMatchText(input.lockedModel) === "vantage";
  const candidateAllowed = isAllowedAstonMartinVantageCanonicalModel({
    requestedMake: input.lockedMake,
    requestedModel: input.lockedModel,
    candidateModel: input.candidateModel,
    trim: input.trim,
    visibleBadgeText: input.visibleBadgeText,
    visibleModelText: input.visibleModelText,
  });

  return lockedIsFamily && candidateAllowed;
}

function classifyCanonicalIdentityDecision(
  locked: LockedDisplayIdentity,
  candidate: Pick<MatchedVehicleCandidate, "year" | "make" | "model" | "trim">,
): CanonicalIdentityDecision {
  if (normalizeMatchText(locked.make) !== normalizeMatchText(candidate.make)) {
    return "rejected_identity_mismatch";
  }
  if (isStrictModelSiblingMismatch(locked, candidate)) {
    return "rejected_identity_mismatch";
  }

  const sameModel = normalizeMatchText(locked.model) === normalizeMatchText(candidate.model);
  const sameFamily =
    normalizeModelFamily(locked.model) === normalizeModelFamily(candidate.model) ||
    isAstonMartinVantageFamilyCompatible({
      lockedMake: locked.make,
      lockedModel: locked.model,
      candidateMake: candidate.make,
      candidateModel: candidate.model,
      trim: candidate.trim,
      visibleBadgeText: locked.visibleBadgeText,
      visibleModelText: locked.visibleModelText,
    });
  const yearDistance = Math.abs(candidate.year - locked.year);

  if (sameModel && yearDistance === 0) {
    return "exact_identity_match";
  }
  if (sameModel && yearDistance <= 1) {
    return "adjacent_year_enrichment";
  }
  if (sameFamily && yearDistance <= 1) {
    return "family_enrichment_only";
  }
  return "rejected_identity_mismatch";
}

function isSafeModelCompatibility(locked: LockedDisplayIdentity, candidate: Pick<MatchedVehicleCandidate, "year" | "make" | "model" | "trim">) {
  if (normalizeMatchText(locked.make) !== normalizeMatchText(candidate.make)) {
    return false;
  }
  if (isStrictModelSiblingMismatch(locked as LockedDisplayIdentity, candidate)) {
    return false;
  }
  return (
    normalizeModelFamily(locked.model) === normalizeModelFamily(candidate.model) ||
    isAstonMartinVantageFamilyCompatible({
      lockedMake: locked.make,
      lockedModel: locked.model,
      candidateMake: candidate.make,
      candidateModel: candidate.model,
      trim: candidate.trim,
      visibleBadgeText: locked.visibleBadgeText,
      visibleModelText: locked.visibleModelText,
    })
  );
}

function classifyEnrichmentIdentityDecision(
  locked: LockedDisplayIdentity,
  candidate: Pick<MatchedVehicleCandidate, "year" | "make" | "model" | "trim">,
  mode: EnrichmentMode,
) {
  if (!isSafeModelCompatibility(locked, candidate)) {
    return {
      allowed: false,
      reason: "model_or_make_mismatch",
    };
  }

  const yearDistance = Math.abs(candidate.year - locked.year);
  if (mode === "exact") {
    return {
      allowed: yearDistance === 0,
      reason: yearDistance === 0 ? "exact_year_match" : "year_mismatch_for_exact_mode",
    };
  }
  if (mode === "adjacent_year") {
    return {
      allowed: yearDistance <= 1,
      reason: yearDistance <= 1 ? "adjacent_year_match" : "adjacent_year_out_of_range",
    };
  }
  if (mode === "generation_fallback") {
    return {
      allowed: true,
      reason: "generation_level_enrichment_only",
    };
  }
  return {
    allowed: false,
    reason: "unsupported_enrichment_mode",
  };
}

function preserveLockedDisplayIdentity(input: {
  scanId: string;
  lockedDisplayIdentity: LockedDisplayIdentity;
  candidates: MatchedVehicleCandidate[];
  yearConfidence?: VisionResult["yearConfidence"];
  yearEvidence?: VisionResult["yearEvidence"];
  yearRange?: VisionResult["yearRange"];
}) {
  if (!env.STRICT_DISPLAY_IDENTITY_LOCK || input.candidates.length === 0) {
    return input.candidates;
  }

  const [primary, ...rest] = input.candidates;
  const decision = classifyCanonicalIdentityDecision(input.lockedDisplayIdentity, primary);

  if (decision === "rejected_identity_mismatch") {
    logger.warn(
      {
        label: "CANONICAL_IDENTITY_REJECTED",
        scanId: input.scanId,
        lockedDisplayIdentity: input.lockedDisplayIdentity,
        canonicalCandidate: primary,
        decision,
      },
      "CANONICAL_IDENTITY_REJECTED",
    );
  } else if (decision !== "exact_identity_match") {
    logger.info(
      {
        label: "CANONICAL_USED_FOR_ENRICHMENT_ONLY",
        scanId: input.scanId,
        lockedDisplayIdentity: input.lockedDisplayIdentity,
        canonicalCandidate: primary,
        decision,
      },
      "CANONICAL_USED_FOR_ENRICHMENT_ONLY",
    );
  }

  if (decision === "family_enrichment_only") {
    logger.info(
      {
        label: "GENERATION_FALLBACK_IDENTITY_PRESERVED",
        scanId: input.scanId,
        lockedDisplayIdentity: input.lockedDisplayIdentity,
        canonicalCandidate: primary,
      },
      "GENERATION_FALLBACK_IDENTITY_PRESERVED",
    );
  }

  logger.info(
      {
        label: "DISPLAY_IDENTITY_PRESERVED",
        scanId: input.scanId,
        lockedDisplayIdentity: input.lockedDisplayIdentity,
        canonicalCandidate: primary,
        decision,
        yearConfidence: input.yearConfidence ?? null,
        yearEvidence: input.yearEvidence ?? null,
        yearRange: input.yearRange ?? null,
        bestYear: input.lockedDisplayIdentity.year,
      },
      "DISPLAY_IDENTITY_PRESERVED",
    );

  return [
    {
      ...primary,
      year: input.lockedDisplayIdentity.year,
      make: input.lockedDisplayIdentity.make,
      model: input.lockedDisplayIdentity.model,
      trim: input.lockedDisplayIdentity.trim ?? primary.trim,
      confidence: Math.max(primary.confidence, input.lockedDisplayIdentity.confidence),
    },
    ...rest,
  ];
}

function preferredMercedesSlTrimRank(trim: string | undefined | null) {
  const normalized = normalizeLookupText(trim);
  if (normalized === "sl500") return 0;
  if (normalized === "sl320") return 1;
  if (normalized === "sl600") return 2;
  return 3;
}

function hasMercedesSlContradictoryBadge(input: {
  visibleBadgeText?: string;
  visibleTrimText?: string;
  candidateTrim?: string | null;
}) {
  const badgeTrim = extractMercedesSlBadgeTrim(
    input.visibleBadgeText,
    input.visibleTrimText,
    input.candidateTrim ?? null,
    null,
  );
  if (!badgeTrim || !input.candidateTrim) {
    return false;
  }
  return normalizeLookupText(badgeTrim) !== normalizeLookupText(input.candidateTrim);
}

function stripTrimTokens(value: string | undefined | null) {
  return normalizeMatchText(value)
    .replace(/\b(lx|ex|ex l|exl|sport|touring|limited|premium|luxury|special|standard|base|se|sel|xle|le|s|sl|sv|lt|ls|gt|xlt|lariat|platinum|long range|performance)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeMatchText(value: string | undefined | null) {
  return normalizeMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function tokenizeEvidence(value: string | undefined | null) {
  return normalizeMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeModelFamily(model: string | undefined | null) {
  return normalizeMatchText(model)
    .replace(/\b(competition|comp|lariat|eddie bauer|platinum|limited|premium|luxury|sport|touring|special|standard|base|xlt|gt|ex|lx|se|sel|xle|le)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function extractMercedesSlBadgeTrim(...values: Array<string | undefined | null>) {
  const normalized = normalizeMercedesSlIdentity({
    make: "Mercedes-Benz",
    model: values[0] ?? "SL-Class",
    trim: values[1] ?? null,
    badgeText: values[2] ?? null,
    modelText: values[3] ?? null,
  });
  return normalized.normalizationApplied ? normalized.trim : null;
}

function isMercedesSlFamilyCandidate(input: { make: string; model: string; trim?: string | null }) {
  return normalizeMatchText(input.make) === "mercedes benz" && normalizeModelFamily(input.model) === "slclass";
}

function isMercedesSlBadgeEvidence(value: string | undefined | null) {
  const normalized = normalizeMatchText(value);
  return /\bsl\s*(320|500|600)\b/.test(normalized);
}

function areMercedesSlEquivalent(left: string | undefined | null, right: string | undefined | null) {
  const normalizedLeft = normalizeMatchText(left);
  const normalizedRight = normalizeMatchText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  const leftIsFamily = normalizedLeft === "sl class";
  const rightIsFamily = normalizedRight === "sl class";
  const leftIsBadge = isMercedesSlBadgeEvidence(normalizedLeft);
  const rightIsBadge = isMercedesSlBadgeEvidence(normalizedRight);
  return (leftIsFamily && rightIsBadge) || (rightIsFamily && leftIsBadge);
}

function normalizeMercedesSlFamilyCandidate(input: {
  make: string;
  model: string;
  trim?: string | null;
  badgeText?: string | null;
  modelText?: string | null;
}) {
  const normalized = normalizeMercedesSlIdentity({
    make: input.make,
    model: input.model,
    trim: input.trim,
    badgeText: input.badgeText,
    modelText: input.modelText,
  });
  return {
    make: normalized.make,
    model: normalized.model,
    trim: normalized.trim ?? undefined,
    applied: normalized.normalizationApplied,
  };
}

function logMercedesSlStage(input: {
  label: "MERCEDES_SL_PRE_CANONICAL_LOOKUP" | "MERCEDES_SL_POST_BADGE_FILTER" | "MERCEDES_SL_ENRICHMENT_CANDIDATE";
  scanId: string;
  year?: number | null;
  make: string;
  model: string;
  trim?: string | null;
  visibleBadgeText?: string | null;
  visibleModelText?: string | null;
  canonicalKey?: string | null;
}) {
  if (normalizeMatchText(input.make) !== "mercedes benz") {
    return;
  }
  logger.info(
    {
      label: input.label,
      scanId: input.scanId,
      year: input.year ?? null,
      make: input.make,
      model: input.model,
      trim: input.trim ?? null,
      visibleBadgeText: input.visibleBadgeText ?? null,
      visibleModelText: input.visibleModelText ?? null,
      canonicalKey: input.canonicalKey ?? null,
    },
    input.label,
  );
}

function extractVisibleYearEvidence(...values: Array<string | string[] | undefined | null>) {
  for (const value of values) {
    const text = Array.isArray(value) ? value.join(" ") : value;
    const normalized = normalizeLookupText(text);
    if (!normalized) {
      continue;
    }
    const matched = normalized.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    if (!matched) {
      continue;
    }
    const parsed = Number(matched[1]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function buildPopularityKey(input: {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
}) {
  return [
    input.year,
    normalizeMatchText(input.make),
    normalizeModelFamily(input.model),
    normalizeModelFamily(input.trim ?? "base") || "base",
  ].join(":");
}

function buildCanonicalGapKey(input: {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
}) {
  return [
    "canonical-gap",
    input.year,
    normalizeMatchText(input.make),
    normalizeMatchText(input.model),
    normalizeModelFamily(input.trim || "base") || "base",
  ].join(":");
}

export function hasEvidenceTokenMatch(candidateText: string | undefined | null, evidenceText: string | undefined | null) {
  const candidateNormalized = normalizeMatchText(candidateText);
  const evidenceNormalized = normalizeMatchText(evidenceText);
  if (!candidateNormalized || !evidenceNormalized) {
    return false;
  }
  if (areMercedesSlEquivalent(candidateText, evidenceText)) {
    return true;
  }
  return (
    candidateNormalized === evidenceNormalized ||
    candidateNormalized.includes(evidenceNormalized) ||
    evidenceNormalized.includes(candidateNormalized)
  );
}

export function contradictsEvidence(candidateText: string | undefined | null, evidenceText: string | undefined | null) {
  if (areMercedesSlEquivalent(candidateText, evidenceText)) {
    return false;
  }
  const candidateTokens = tokenizeEvidence(candidateText);
  const evidenceTokens = tokenizeEvidence(evidenceText);
  if (candidateTokens.length === 0 || evidenceTokens.length === 0) {
    return false;
  }
  return evidenceTokens.every((token) => !candidateTokens.includes(token));
}

function visualHashPrefix(hash: string) {
  return hash.slice(0, STABILITY_CACHE_PREFIX_LENGTH);
}

function readScanStabilityCache(input: { userId: string; visualHash: string }): StabilityCacheMatch | null {
  const now = Date.now();
  const exact = scanStabilityCache.find((entry) => entry.userId === input.userId && entry.visualHash === input.visualHash && now - entry.createdAt < STABILITY_CACHE_TTL_MS);
  if (exact) {
    return { ...exact, matchType: "exact" };
  }
  return null;
}

function findScanStabilityNearMatch(input: { userId: string; visualHash: string }): StabilityCacheEntry | null {
  const now = Date.now();
  const prefixMatch = scanStabilityCache.find(
    (entry) =>
      entry.userId === input.userId &&
      visualHashPrefix(entry.visualHash) === visualHashPrefix(input.visualHash) &&
      now - entry.createdAt < STABILITY_CACHE_TTL_MS,
  );
  return prefixMatch ?? null;
}

function writeScanStabilityCache(entry: StabilityCacheEntry) {
  const filtered = scanStabilityCache.filter(
    (existing) => !(existing.userId === entry.userId && existing.visualHash === entry.visualHash),
  );
  filtered.unshift(entry);
  scanStabilityCache.splice(0, scanStabilityCache.length, ...filtered.slice(0, MAX_STABILITY_CACHE_ENTRIES));
}

function getTokenOverlapScore(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  const matches = left.filter((token) => rightSet.has(token)).length;
  return matches / Math.max(left.length, right.length);
}

function buildCandidateSignature(input: {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
}) {
  return [
    input.year,
    normalizeMatchText(input.make),
    normalizeModelFamily(input.model),
    normalizeModelFamily(input.trim ?? "base") || "base",
  ].join("|");
}

function buildOlderMercedesSlRangeLabel(years: number[]) {
  const uniqueYears = [...new Set(years)].sort((left, right) => left - right);
  if (uniqueYears.length === 0) {
    return null;
  }
  const minYear = uniqueYears[0];
  const maxYear = uniqueYears[uniqueYears.length - 1];
  if (minYear === maxYear) {
    return `${minYear}`;
  }
  if (maxYear - minYear <= 3) {
    return `${minYear}-${maxYear}`;
  }
  return `Late ${Math.floor(minYear / 10) * 10}s`;
}

function buildVisionResultSignature(result: Pick<VisionResult, "likely_year" | "likely_make" | "likely_model" | "likely_trim">) {
  return buildCandidateSignature({
    year: result.likely_year,
    make: result.likely_make,
    model: result.likely_model,
    trim: result.likely_trim,
  });
}

function buildMatchedVehicleSignature(candidate: Pick<MatchedVehicleCandidate, "year" | "make" | "model" | "trim">) {
  return buildCandidateSignature({
    year: candidate.year,
    make: candidate.make,
    model: candidate.model,
    trim: candidate.trim,
  });
}

function hasHardTextConfirmation(result: VisionResult) {
  return result.visible_clues.some((clue) => clue.toLowerCase().startsWith("readable text confirms "));
}

function buildOcrCandidateHints(result: VisionResult) {
  const hints: Array<{
    year: number;
    make: string;
    model: string;
    trim?: string;
  } | null> = [
    {
      year: result.likely_year,
      make: result.likely_make,
      model: result.likely_model,
      trim: result.likely_trim,
    },
    ...(result.alternate_candidates ?? []).map((candidate) => ({
      year: candidate.likely_year,
      make: candidate.likely_make,
      model: candidate.likely_model,
      trim: candidate.likely_trim,
    })),
    result.visible_make_text && result.visible_model_text
      ? {
          year: result.likely_year,
          make: result.visible_make_text,
          model: result.visible_model_text,
          trim: result.visible_trim_text,
        }
      : null,
  ];

  return hints.filter((candidate) => Boolean(candidate?.make && candidate.model)) as Array<{
    year: number;
    make: string;
    model: string;
    trim?: string;
  }>;
}

function hasValidStructuredOcrFields(ocr: GoogleVisionOcrResult | null) {
  if (!ocr?.detectedYear || !ocr.detectedMake || !ocr.detectedModel) {
    return false;
  }
  const currentYear = new Date().getFullYear();
  return ocr.detectedYear >= 1980 && ocr.detectedYear <= currentYear + 1;
}

function extractStructuredOcrFromRawResponse(rawResponse: unknown): {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
} | null {
  if (!rawResponse || typeof rawResponse !== "object" || !("ocr" in rawResponse)) {
    return null;
  }
  const rawOcr = (rawResponse as { ocr?: GoogleVisionOcrResult | null }).ocr ?? null;
  if (!hasValidStructuredOcrFields(rawOcr)) {
    return null;
  }
  const ocr = rawOcr as GoogleVisionOcrResult & {
    detectedYear: number;
    detectedMake: string;
    detectedModel: string;
  };
  return {
    year: ocr.detectedYear,
    make: ocr.detectedMake,
    model: ocr.detectedModel,
    trim: ocr.detectedTrim ?? null,
  };
}

function hasStructuredOcrConfirmation(input: { normalizedResult: VisionResult; rawResponse: unknown }) {
  return (
    input.normalizedResult.source === "ocr_override" ||
    hasHardTextConfirmation(input.normalizedResult) ||
    Boolean(extractStructuredOcrFromRawResponse(input.rawResponse))
  );
}

function hasStrongStructuredVisualResult(normalizedResult: VisionResult) {
  return Boolean(
    normalizedResult.likely_year &&
      normalizedResult.likely_make &&
      normalizedResult.likely_model &&
      normalizedResult.confidence >= 0.9,
  );
}

function enforceFinalVisibleOcrCandidate(input: {
  scanId: string;
  normalizedResult: VisionResult;
  candidates: MatchedVehicleCandidate[];
  rawResponse: unknown;
}) {
  const ocrConfirmed = hasStructuredOcrConfirmation({
    normalizedResult: input.normalizedResult,
    rawResponse: input.rawResponse,
  });
  const strongStructuredVisual = hasStrongStructuredVisualResult(input.normalizedResult);
  const shouldApplyEnforcement = ocrConfirmed || strongStructuredVisual;

  if (!shouldApplyEnforcement) {
    return {
      normalizedResult: input.normalizedResult,
      candidates: input.candidates,
      applied: false,
    };
  }

  const pinnedSource = ocrConfirmed ? "ocr_override" : "visual_override";
  const pinnedMatchReason = ocrConfirmed ? "OCR-confirmed result" : "Visual result override";

  const pinnedNormalizedResult =
    input.normalizedResult.source === pinnedSource
      ? input.normalizedResult
      : normalizeVisionResult({
          ...input.normalizedResult,
          source: pinnedSource,
        });

  const desiredSignature = buildVisionResultSignature(pinnedNormalizedResult);
  const exactExisting =
    input.candidates.find((candidate) => buildMatchedVehicleSignature(candidate) === desiredSignature) ?? null;

  const pinnedCandidate: MatchedVehicleCandidate = exactExisting ?? {
    vehicleId: "",
    year: pinnedNormalizedResult.likely_year,
    make: pinnedNormalizedResult.likely_make,
    model: pinnedNormalizedResult.likely_model,
    trim: pinnedNormalizedResult.likely_trim ?? "",
    confidence: pinnedNormalizedResult.confidence,
    matchReason: pinnedMatchReason,
  };

  const normalizedPinnedCandidate: MatchedVehicleCandidate = {
    ...pinnedCandidate,
    year: pinnedNormalizedResult.likely_year,
    make: pinnedNormalizedResult.likely_make,
    model: pinnedNormalizedResult.likely_model,
    confidence: pinnedNormalizedResult.confidence,
    matchReason: pinnedMatchReason,
  };

  const remaining = input.candidates.filter(
    (candidate) => buildMatchedVehicleSignature(candidate) !== buildMatchedVehicleSignature(normalizedPinnedCandidate),
  );

  return {
    normalizedResult: pinnedNormalizedResult,
    candidates: [normalizedPinnedCandidate, ...remaining],
    applied: true,
  };
}

export function applyGoogleOcrOverride(result: VisionResult, ocr: GoogleVisionOcrResult | null): VisionResult {
  if (!hasValidStructuredOcrFields(ocr)) {
    return result;
  }
  const structuredOcr = ocr as GoogleVisionOcrResult & {
    detectedYear: number;
    detectedMake: string;
    detectedModel: string;
  };
  const ocrConfidence = structuredOcr.confidence ?? 0;

  const structured = {
    year: structuredOcr.detectedYear,
    make: structuredOcr.detectedMake,
    model: structuredOcr.detectedModel,
    trim: structuredOcr.detectedTrim ?? result.likely_trim,
  };

  const previousPrimary = {
    likely_year: result.likely_year,
    likely_make: result.likely_make,
    likely_model: result.likely_model,
    likely_trim: result.likely_trim,
    confidence: Math.max(0.6, Math.min(result.confidence, 0.96)),
  };

  const overridden = normalizeVisionResult({
    ...result,
    likely_year: structured.year,
    likely_make: structured.make,
    likely_model: structured.model,
    likely_trim: structured.trim ?? result.likely_trim,
    source: "ocr_override",
    confidence: Math.max(result.confidence, 0.993),
    visible_text_evidence: {
      raw_text: [`${structured.year} ${structured.make} ${structured.model}`.trim()],
      make_text: structured.make,
      model_text: structured.model,
      trim_text: structured.trim ?? null,
      badge_text: [structured.trim ?? structured.model].filter(Boolean),
      text_confidence: Math.max(ocrConfidence, 0.93),
      evidence_regions: ["ocr"],
    },
    visible_make_text: structured.make,
    visible_model_text: structured.model,
    visible_trim_text: structured.trim ?? result.visible_trim_text,
    visible_clues: [
      `Readable text confirms ${structured.year} ${structured.make} ${structured.model}`.trim(),
      ...result.visible_clues,
    ],
    alternate_candidates: [
      previousPrimary,
      ...result.alternate_candidates,
    ].filter(
      (candidate, index, array) =>
        array.findIndex(
          (entry) =>
            entry.likely_year === candidate.likely_year &&
            normalizeMatchText(entry.likely_make) === normalizeMatchText(candidate.likely_make) &&
            normalizeModelFamily(entry.likely_model) === normalizeModelFamily(candidate.likely_model),
        ) === index,
    ),
    textDominanceApplied: true,
    matchEvidence: {
      source: "badge_text",
      readableText: [`${structured.year} ${structured.make} ${structured.model}`.trim(), structured.trim ?? structured.model].filter(Boolean),
    },
  });
  logger.info(
    {
      label: "OCR_OVERRIDE_APPLIED",
      before: {
        year: result.likely_year,
        make: result.likely_make,
        model: result.likely_model,
      },
      after: {
        year: overridden.likely_year,
        make: overridden.likely_make,
        model: overridden.likely_model,
      },
    },
    "OCR_OVERRIDE_APPLIED",
  );
  return overridden;
}

function summarizeOcrDecision(input: {
  before: VisionResult;
  after: VisionResult;
  ocrResult: GoogleVisionOcrResult | null;
}) {
  if (!input.ocrResult) {
    return {
      ocrAvailable: false,
      overrideTriggered: false,
      confirmationApplied: false,
      ignoredReason: "ocr_unavailable",
      finalWinningSource: "visual_candidate" as const,
    };
  }

  const beforeSignature = buildCandidateSignature({
    year: input.before.likely_year,
    make: input.before.likely_make,
    model: input.before.likely_model,
    trim: input.before.likely_trim,
  });
  const afterSignature = buildCandidateSignature({
    year: input.after.likely_year,
    make: input.after.likely_make,
    model: input.after.likely_model,
    trim: input.after.likely_trim,
  });
  const overrideTriggered = beforeSignature !== afterSignature;
  const confirmationApplied = false;

  if (overrideTriggered) {
    return {
      ocrAvailable: true,
      overrideTriggered: true,
      confirmationApplied: false,
      ignoredReason: null,
      finalWinningSource: "text_override" as const,
    };
  }

  return {
    ocrAvailable: true,
    overrideTriggered: false,
    confirmationApplied: false,
    ignoredReason: hasValidStructuredOcrFields(input.ocrResult)
      ? "already_aligned_with_visual_result"
      : input.ocrResult.decisionReason,
    finalWinningSource: "visual_candidate" as const,
  };
}

function enforceOcrResolvedPrimaryCandidate(input: {
  normalizedResult: VisionResult;
  resolvedVehicles: MatchedVehicleCandidate[];
}) {
  const shouldForceOcrPrimary =
    input.normalizedResult.source === "ocr_override" || hasHardTextConfirmation(input.normalizedResult);

  if (!shouldForceOcrPrimary) {
    return {
      resolvedVehicles: input.resolvedVehicles,
      overwrittenLater: false,
      applied: false,
    };
  }

  const normalizedSignature = buildVisionResultSignature(input.normalizedResult);
  const topCandidate = input.resolvedVehicles[0] ?? null;
  const topSignature = topCandidate ? buildMatchedVehicleSignature(topCandidate) : null;
  const overwrittenLater = Boolean(topCandidate) && topSignature !== normalizedSignature;

  const exactResolvedCandidate =
    input.resolvedVehicles.find((candidate) => buildMatchedVehicleSignature(candidate) === normalizedSignature) ?? null;

  const ocrPrimaryCandidate: MatchedVehicleCandidate = exactResolvedCandidate ?? {
    vehicleId: "",
    year: input.normalizedResult.likely_year,
    make: input.normalizedResult.likely_make,
    model: input.normalizedResult.likely_model,
    trim: input.normalizedResult.likely_trim ?? "",
    confidence: Math.max(input.normalizedResult.confidence, input.resolvedVehicles[0]?.confidence ?? 0),
    matchReason: "OCR-confirmed result",
  };

  const remaining = input.resolvedVehicles.filter(
    (candidate) => buildMatchedVehicleSignature(candidate) !== buildMatchedVehicleSignature(ocrPrimaryCandidate),
  );

  return {
    resolvedVehicles: [ocrPrimaryCandidate, ...remaining],
    overwrittenLater,
    applied: true,
  };
}

function stageFailureMessage(stage: ScanFailureStage) {
  switch (stage) {
    case "VISION_REQUEST":
      return "Vision request failed";
    case "IMAGE_PROCESSING":
      return "Image processing failed";
    case "USAGE_WRITE":
      return "Usage counter update failed";
    case "SCAN_PERSIST":
      return "Scan persistence failed";
    case "VISION_DEBUG_WRITE":
      return "Vision debug write failed";
    case "VEHICLE_MATCH":
      return "Vehicle matching failed";
    case "ENTITLEMENT_CHECK":
      return "Entitlement check failed";
    case "USAGE_CHECK":
      return "Usage check failed";
    case "CACHE_LOOKUP":
      return "Vision request failed";
  }
}

function isProviderRateLimitError(error: unknown) {
  return error instanceof AppError && error.statusCode === 429;
}

function hasGenerationSensitiveTrimEvidence(...values: Array<string | undefined | null>) {
  const combined = values
    .map((value) => normalizeMatchText(value))
    .filter(Boolean)
    .join(" ");
  return /\brubicon|shelby|raptor|z06|trx|hellcat|392|scat pack|mach 1|gt500|zl1|denali|platinum|king ranch\b/.test(combined);
}

function buildApproximateYearLabel(years: number[]) {
  if (years.length === 0) {
    return null;
  }
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  if (minYear === maxYear) {
    return String(minYear);
  }
  if (maxYear - minYear <= 2) {
    return `${minYear}-${maxYear}`;
  }
  const decade = Math.floor(minYear / 10) * 10;
  if (minYear - decade <= 3 && maxYear - decade <= 6) {
    return `likely early/mid-${decade}s`;
  }
  if (minYear - decade >= 4) {
    return `likely mid/late-${decade}s`;
  }
  return `${minYear}-${maxYear}`;
}

function hasBelievableListing(listing: ListingRecord) {
  return Boolean(
    listing.title?.trim() &&
      typeof listing.price === "number" &&
      Number.isFinite(listing.price) &&
      listing.price > 0 &&
      (listing.dealer?.trim() || listing.location?.trim()) &&
      ((typeof listing.mileage === "number" && Number.isFinite(listing.mileage)) ||
        (typeof listing.distanceMiles === "number" && Number.isFinite(listing.distanceMiles))),
  );
}

type EnrichmentCandidateRequest = {
  year?: number;
  make: string;
  model: string;
  trim?: string | null;
  mode: EnrichmentMode;
  sourceLabel: string;
  vehicleId?: string | null;
  allowedYearRange?: {
    start: number;
    end: number;
  } | null;
};

type EnrichmentPreview = {
  vehicle: VehicleRecord | null;
  payload: PayloadEvaluation;
  enrichmentMode: EnrichmentMode;
  rescuedByAdjacentYear: boolean;
  unlockEligible: boolean;
  valuation: Awaited<ReturnType<VehicleService["getValue"]>>["data"] | null;
  listings: ListingRecord[];
  freeSpecFieldCount?: number;
  sourceLabel?: string | null;
};

function hasConfirmedExactYear(result: VisionResult) {
  return result.exactYearConfirmed === true;
}

function hasUnconfirmedVisualYear(result: VisionResult) {
  return (
    result.yearConfidence === "estimated" ||
    result.yearConfidence === "range" ||
    result.yearEvidence === "visual_only" ||
    result.yearEvidence === "visual_generation_estimate" ||
    result.yearEvidence === "profile_refined_visual_generation"
  );
}

function isYearWithinInclusiveRange(
  year: number,
  range?: {
    start: number;
    end: number;
  } | null,
) {
  if (!range) {
    return true;
  }
  return year >= range.start && year <= range.end;
}

function getFreeDisplaySpecFieldCount(vehicle: VehicleRecord | null | undefined) {
  if (!vehicle) {
    return 0;
  }
  let count = 0;
  if (vehicle.drivetrain?.trim()) count += 1;
  if (vehicle.bodyStyle?.trim()) count += 1;
  if (vehicle.engine?.trim()) count += 1;
  if (typeof vehicle.horsepower === "number" && Number.isFinite(vehicle.horsepower) && vehicle.horsepower > 0) count += 1;
  if (vehicle.transmission?.trim()) count += 1;
  if (typeof vehicle.msrp === "number" && Number.isFinite(vehicle.msrp) && vehicle.msrp > 0) count += 1;
  if (vehicle.fuelType?.trim()) count += 1;
  return count;
}

function hasFreeDisplaySpecs(vehicle: VehicleRecord | null | undefined) {
  return getFreeDisplaySpecFieldCount(vehicle) > 0;
}

function isEmptyAiLearnedCanonicalShell(vehicle: VehicleRecord | null | undefined) {
  if (!vehicle) {
    return false;
  }
  return vehicle.id.startsWith("canonical:") && getFreeDisplaySpecFieldCount(vehicle) === 0;
}

function shouldPreserveCurrentOcrYearEvidence(current: VisionResult, cached: VisionResult) {
  const hasCurrentExactYearEvidence =
    current.exactYearConfirmed === true ||
    current.yearEvidence === "visible_text" ||
    current.source === "ocr_override" ||
    hasHardTextConfirmation(current);
  if (!hasCurrentExactYearEvidence) {
    return false;
  }
  return (
    normalizeMatchText(current.likely_make) === normalizeMatchText(cached.likely_make) &&
    normalizeModelFamily(current.likely_model) === normalizeModelFamily(cached.likely_model)
  );
}

function mergePreservedOcrYearEvidence(current: VisionResult, cached: VisionResult) {
  return normalizeVisionResult({
    ...cached,
    likely_year: current.likely_year,
    bestYear: current.bestYear ?? current.likely_year,
    yearConfidence: current.yearConfidence ?? "exact",
    yearEvidence: current.yearEvidence ?? "visible_text",
    exactYearConfirmed: current.exactYearConfirmed ?? true,
    displayYearLabel: current.displayYearLabel ?? (current.likely_year ? String(current.likely_year) : cached.displayYearLabel ?? null),
    yearRange: current.yearRange ?? cached.yearRange ?? null,
    yearReasoning: current.yearReasoning ?? cached.yearReasoning ?? null,
    visible_badge_text: current.visible_badge_text ?? cached.visible_badge_text,
    visible_make_text: current.visible_make_text ?? cached.visible_make_text,
    visible_model_text: current.visible_model_text ?? cached.visible_model_text,
    visible_trim_text: current.visible_trim_text ?? cached.visible_trim_text,
    source: current.source ?? cached.source,
  });
}

function logIdentifyStage(stage: ScanFailureStage, event: "start" | "success", context: Record<string, unknown>) {
  logger.info(
    {
      label: "IDENTIFY_STAGE",
      stage,
      event,
      ...context,
    },
    "IDENTIFY_STAGE",
  );
}

function logScanBootstrapProviderSkip(input: {
  label:
    | "SCAN_PROVIDER_ENRICHMENT_SKIPPED_BOOTSTRAP"
    | "SCAN_PROVIDER_SEARCH_SKIPPED_INITIAL_IDENTIFY"
    | "SCAN_VALUE_LOOKUP_SKIPPED_INITIAL_IDENTIFY"
    | "SCAN_LISTINGS_LOOKUP_SKIPPED_INITIAL_IDENTIFY";
  scanId?: string;
  vehicleId?: string | null;
  candidate?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    confidence?: number | null;
  };
  sourceLabel?: string;
  reason?: string;
}) {
  logger.info(
    {
      label: input.label,
      scanId: input.scanId,
      vehicleId: input.vehicleId ?? null,
      candidate: input.candidate ?? null,
      sourceLabel: input.sourceLabel ?? null,
      reason: input.reason ?? "bootstrap_initial_identify",
    },
    input.label,
  );
}

function logLiveCanonicalMissProviderRescueDecision(input: {
  scanId: string;
  candidate: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    confidence: number;
  };
  forcedMode: string;
  confidence: number;
  isPrimaryCandidate: boolean;
  providerRateLimited: boolean;
  bootstrapInitialIdentify: boolean;
  canonicalMiss: boolean;
  allowRescue: boolean;
  reason:
    | "high_confidence_primary_candidate_live_mode"
    | "provider_enrichment_not_requested"
    | "forced_mode_not_live"
    | "confidence_below_rescue_threshold"
    | "provider_rate_limited"
    | "alternate_candidate"
    | "unknown";
}) {
  const label = input.allowRescue
    ? "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_STARTED"
    : "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_SKIPPED";
  logger.info(
    {
      label,
      scanId: input.scanId,
      candidate: input.candidate,
      forcedMode: input.forcedMode,
      confidence: input.confidence,
      isPrimaryCandidate: input.isPrimaryCandidate,
      providerRateLimited: input.providerRateLimited,
      bootstrapInitialIdentify: input.bootstrapInitialIdentify,
      canonicalMiss: input.canonicalMiss,
      reason: input.reason,
    },
    label,
  );
}

export class ScanService {
  constructor(
    private readonly usageService: UsageService,
    private readonly analysisCacheService = new AnalysisCacheService(),
    private readonly unlockService = new UnlockService(),
    private readonly vehicleService = new VehicleService(),
  ) {}

  private async applyYearRefinement(result: VisionResult, scanId: string): Promise<VisionResult> {
    logger.info(
      {
        label: "YEAR_REFINEMENT_STARTED",
        scanId,
        likelyYear: result.likely_year,
        make: result.likely_make,
        model: result.likely_model,
        trim: result.likely_trim ?? null,
        yearConfidence: result.yearConfidence ?? null,
        yearEvidence: result.yearEvidence ?? null,
      },
      "YEAR_REFINEMENT_STARTED",
    );

    const canonicalFamily = await repositories.canonicalVehicles.searchPromoted({
      normalizedMake: normalizeMatchText(result.likely_make),
      normalizedModel: normalizeMatchText(result.likely_model),
    });
    const canonicalAvailableYears = Array.from(new Set(canonicalFamily.map((record) => record.year))).sort((left, right) => left - right);
    const refinement = refineVehicleYearEstimate({
      normalizedResult: result,
      canonicalAvailableYears,
    });

    if (!refinement) {
      logger.info(
        {
          label: "YEAR_REFINEMENT_SELECTED",
          scanId,
          likelyYear: result.likely_year,
          bestYear: result.likely_year,
          yearRange: result.yearRange ?? null,
          yearConfidence: result.yearConfidence ?? null,
          yearReasoning: result.yearReasoning ?? null,
        },
        "YEAR_REFINEMENT_SELECTED",
      );
      return result;
    }

    logger.info(
      {
        label: "YEAR_REFINEMENT_CANDIDATES",
        scanId,
        likelyYear: result.likely_year,
        canonicalAvailableYears,
        candidates: refinement.candidates.map((candidate) => ({
          year: candidate.year,
          score: candidate.score,
          reasons: candidate.reasons,
        })),
      },
      "YEAR_REFINEMENT_CANDIDATES",
    );

    if (refinement.profileApplied) {
      logger.info(
        {
          label: "YEAR_REFINEMENT_PROFILE_APPLIED",
          scanId,
          family: `${result.likely_make} ${result.likely_model}`,
          aiLikelyYear: result.likely_year,
          bestYear: refinement.bestYear,
          yearRange: refinement.yearRange,
          yearReasoning: refinement.yearReasoning,
        },
        "YEAR_REFINEMENT_PROFILE_APPLIED",
      );
    }
    if (refinement.rangeWidenedByProfile) {
      logger.info(
        {
          label: "YEAR_RANGE_WIDENED_BY_PROFILE",
          scanId,
          aiLikelyYear: result.likely_year,
          previousYearRange: result.yearRange ?? null,
          widenedYearRange: refinement.yearRange,
        },
        "YEAR_RANGE_WIDENED_BY_PROFILE",
      );
    }

    const refinedResult = normalizeVisionResult({
      ...result,
      likely_year: refinement.bestYear,
      bestYear: refinement.bestYear,
      yearRange: refinement.yearRange,
      yearConfidence: refinement.yearConfidence,
      yearEvidence: refinement.profileApplied ? "profile_refined_visual_generation" : result.yearEvidence,
      yearReasoning: refinement.yearReasoning,
      alternate_candidates: result.alternate_candidates
        .map((candidate) => ({
          ...candidate,
          likely_year: candidate.likely_year,
        }))
        .sort((left, right) => {
          const leftDistance = Math.abs(left.likely_year - refinement.bestYear);
          const rightDistance = Math.abs(right.likely_year - refinement.bestYear);
          if (leftDistance !== rightDistance) {
            return leftDistance - rightDistance;
          }
          return right.confidence - left.confidence;
        }),
    });

    logger.info(
      {
        label: "YEAR_REFINEMENT_SELECTED",
        scanId,
        aiLikelyYear: result.likely_year,
        bestYear: refinement.bestYear,
        yearRange: refinement.yearRange,
        yearConfidence: refinement.yearConfidence,
        yearReasoning: refinement.yearReasoning,
      },
      "YEAR_REFINEMENT_SELECTED",
    );

    if (refinement.overruledAiYear) {
      logger.info(
        {
          label: "YEAR_REFINEMENT_OVERRULED_AI_YEAR",
          scanId,
          aiLikelyYear: result.likely_year,
          refinedBestYear: refinement.bestYear,
          yearRange: refinement.yearRange,
          yearReasoning: refinement.yearReasoning,
        },
        "YEAR_REFINEMENT_OVERRULED_AI_YEAR",
      );
    }

    if (
      normalizeMatchText(result.likely_make) === "bmw" &&
      normalizeMatchText(result.likely_model) === "z3"
    ) {
      logger.info(
        {
          label: "BMW_Z3_RUNTIME_YEAR_REFINEMENT_CHECK",
          scanId,
          beforeYear: result.likely_year,
          afterBestYear: refinement.bestYear,
          afterRange: refinement.yearRange,
          appliedProfile: refinement.profileApplied,
          activePathFunctionName: "ScanService.identifyVehicle",
        },
        "BMW_Z3_RUNTIME_YEAR_REFINEMENT_CHECK",
      );
    }

    return refinedResult;
  }

  private async preferMercedesSlCanonicalYearCandidate(input: {
    candidates: Array<{
      year: number;
      make: string;
      model: string;
      trim?: string;
      confidence: number;
    }>;
    result: VisionResult;
    context: ProviderEnrichmentContext;
  }) {
    const badgeTrim = extractMercedesSlBadgeTrim(
      input.result.visible_badge_text,
      input.result.visible_trim_text,
      input.result.likely_trim,
      input.result.likely_model,
    );
    if (!badgeTrim) {
      return input.candidates;
    }

    const familyCandidates = input.candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => isMercedesSlFamilyCandidate(candidate))
      .filter(({ candidate }) => normalizeMatchText(candidate.trim) === normalizeMatchText(badgeTrim));

    if (familyCandidates.length < 2) {
      return input.candidates;
    }

    const supportRows = await Promise.all(
      familyCandidates.map(async ({ candidate, index }) => {
        const supported = await repositories.canonicalVehicles.searchPromoted({
          year: candidate.year,
          normalizedMake: normalizeMatchText(candidate.make),
          normalizedModel: normalizeMatchText(candidate.model),
          normalizedTrim: normalizeMatchText(candidate.trim),
        });
        return {
          candidate,
          index,
          hasCanonicalSupport: supported.length > 0,
        };
      }),
    );

    const preferredSupported = supportRows
      .filter((entry) => entry.hasCanonicalSupport)
      .sort(
        (left, right) =>
          right.candidate.confidence - left.candidate.confidence ||
          Math.abs(left.candidate.year - input.result.likely_year) - Math.abs(right.candidate.year - input.result.likely_year),
      )[0];
    const highestUnsupported = supportRows
      .filter((entry) => !entry.hasCanonicalSupport)
      .sort((left, right) => right.candidate.confidence - left.candidate.confidence)[0];

    if (!preferredSupported || !highestUnsupported) {
      return input.candidates;
    }

    const confidenceGap = highestUnsupported.candidate.confidence - preferredSupported.candidate.confidence;
    if (confidenceGap > 0.08 || preferredSupported.index < highestUnsupported.index) {
      return input.candidates;
    }

    const reordered = [...input.candidates];
    reordered.splice(preferredSupported.index, 1);
    reordered.splice(highestUnsupported.index, 0, preferredSupported.candidate);
    logger.info(
      {
        label: "MERCEDES_SL_CANONICAL_YEAR_PREFERENCE",
        scanId: input.context.scanId,
        badgeTrim,
        preferredCandidate: preferredSupported.candidate,
        displacedCandidate: highestUnsupported.candidate,
        confidenceGap,
      },
      "MERCEDES_SL_CANONICAL_YEAR_PREFERENCE",
    );
    return reordered;
  }

  private buildOlderMercedesSlFallbackCandidate(result: VisionResult) {
    const badgeTrim = extractMercedesSlBadgeTrim(
      result.visible_badge_text,
      result.visible_trim_text,
      result.likely_trim,
      result.likely_model,
    );
    const visibleYearEvidence = extractVisibleYearEvidence(
      result.visible_badge_text,
      result.visible_make_text,
      result.visible_model_text,
      result.visible_trim_text,
      result.visible_clues,
    );
    if (
      !badgeTrim ||
      visibleYearEvidence != null ||
      !isMercedesSlFamilyCandidate({
        make: result.likely_make,
        model: result.likely_model,
        trim: result.likely_trim,
      })
    ) {
      return null;
    }

    const nearbyYears = [
      {
        year: result.likely_year,
        make: result.likely_make,
        model: result.likely_model,
        trim: result.likely_trim ?? "",
        confidence: result.confidence,
      },
      ...result.alternate_candidates.map((candidate) => ({
        year: candidate.likely_year,
        make: candidate.likely_make,
        model: candidate.likely_model,
        trim: candidate.likely_trim ?? "",
        confidence: candidate.confidence,
      })),
    ].filter(
      (candidate) =>
        isMercedesSlFamilyCandidate(candidate) &&
        normalizeMatchText(candidate.trim) === normalizeMatchText(badgeTrim) &&
        Math.abs(candidate.year - result.likely_year) <= 2 &&
        Math.abs(candidate.confidence - result.confidence) <= 0.08,
    );

    if (nearbyYears.length < 2) {
      return null;
    }

    const yearRangeLabel = buildOlderMercedesSlRangeLabel(nearbyYears.map((candidate) => candidate.year));
    if (!yearRangeLabel) {
      return null;
    }

    logger.info(
      {
        label: "MERCEDES_SL_YEAR_RANGE_ESTIMATE",
        yearRangeLabel,
        likelyYear: result.likely_year,
        nearbyYears: nearbyYears.map((candidate) => ({
          year: candidate.year,
          confidence: candidate.confidence,
        })),
        badgeTrim,
      },
      "MERCEDES_SL_YEAR_RANGE_ESTIMATE",
    );

    return {
      vehicleId: "",
      year: result.likely_year,
      make: result.likely_make,
      model: result.likely_model,
      trim: result.likely_trim ?? "",
      confidence: Math.min(result.confidence, 0.58),
      matchReason: `Estimated ${yearRangeLabel} ${result.likely_make} ${result.likely_model} ${badgeTrim}. Exact year is uncertain without VIN or readable year text.`,
    };
  }

  private buildYearUncertainFallbackCandidate(result: VisionResult) {
    const visibleYearEvidence = extractVisibleYearEvidence(
      result.visible_badge_text,
      result.visible_make_text,
      result.visible_model_text,
      result.visible_trim_text,
      result.visible_clues,
    );
    if (visibleYearEvidence != null) {
      return null;
    }

    const nearbyYears = [
      {
        year: result.likely_year,
        make: result.likely_make,
        model: result.likely_model,
        trim: result.likely_trim ?? "",
        confidence: result.confidence,
      },
      ...result.alternate_candidates.map((candidate) => ({
        year: candidate.likely_year,
        make: candidate.likely_make,
        model: candidate.likely_model,
        trim: candidate.likely_trim ?? "",
        confidence: candidate.confidence,
      })),
    ].filter(
      (candidate) =>
        normalizeMatchText(candidate.make) === normalizeMatchText(result.likely_make) &&
        normalizeModelFamily(candidate.model) === normalizeModelFamily(result.likely_model) &&
        Math.abs(candidate.year - result.likely_year) <= 3 &&
        Math.abs(candidate.confidence - result.confidence) <= 0.08,
    );

    if (nearbyYears.length < 2) {
      return null;
    }

    const yearLabel = buildApproximateYearLabel(nearbyYears.map((candidate) => candidate.year));
    if (!yearLabel) {
      return null;
    }

    return {
      vehicleId: "",
      year: result.likely_year,
      make: result.likely_make,
      model: result.likely_model,
      trim: result.likely_trim ?? "",
      confidence: Math.max(0.45, Math.min(0.72, result.confidence - 0.18)),
      matchReason: `Estimated ${yearLabel} ${result.likely_make} ${result.likely_model}${result.likely_trim ? ` ${result.likely_trim}` : ""}. Exact year is uncertain without VIN or readable year text.`,
    };
  }

  private buildEnrichmentCandidateRequests(input: {
    normalizedResult: VisionResult;
    resolvedCandidates: MatchedVehicleCandidate[];
  }): EnrichmentCandidateRequest[] {
    const requests: EnrichmentCandidateRequest[] = [];
    const primary = input.resolvedCandidates[0] ?? null;
    const normalizedPrimaryIdentity = normalizeMercedesSlFamilyCandidate({
      make: input.normalizedResult.likely_make,
      model: input.normalizedResult.likely_model,
      trim: input.normalizedResult.likely_trim,
      badgeText: input.normalizedResult.visible_badge_text,
      modelText: input.normalizedResult.visible_model_text,
    });
    const normalizedPrimary = {
      year: input.normalizedResult.likely_year,
      make: normalizedPrimaryIdentity.make,
      model: normalizedPrimaryIdentity.model,
      trim: normalizedPrimaryIdentity.trim ?? "",
      vehicleId: primary?.vehicleId ?? "",
    };
    const allowedYearRange = buildEnrichmentAllowedYearRange(input.normalizedResult);
    requests.push({
      year: normalizedPrimary.year,
      make: normalizedPrimary.make,
      model: normalizedPrimary.model,
      trim: normalizedPrimary.trim,
      vehicleId: normalizedPrimary.vehicleId,
      mode: "exact",
      sourceLabel: "identified_candidate_exact",
      allowedYearRange,
    });

    if (!hasGenerationSensitiveTrimEvidence(input.normalizedResult.likely_trim, input.normalizedResult.visible_trim_text)) {
      const orderedCandidateYears =
        input.normalizedResult.yearConfidence === "exact"
          ? buildOrderedYearDeltas(3)
              .filter((delta) => delta !== 0)
              .map((delta) => normalizedPrimary.year + delta)
          : input.normalizedResult.yearRange
            ? buildOrderedYearsWithinRange(
                normalizedPrimary.year,
                input.normalizedResult.yearRange.start,
                input.normalizedResult.yearRange.end,
              ).filter((year) => year !== normalizedPrimary.year)
            : buildOrderedYearDeltas(3)
                .filter((delta) => delta !== 0)
                .map((delta) => normalizedPrimary.year + delta);
      for (const candidateYear of orderedCandidateYears) {
        const delta = candidateYear - normalizedPrimary.year;
        requests.push({
          year: candidateYear,
          make: normalizedPrimary.make,
          model: normalizedPrimary.model,
          trim: normalizedPrimary.trim,
          mode: Math.abs(delta) <= 1 ? "adjacent_year" : "generation_fallback",
          sourceLabel: `identified_candidate_${delta < 0 ? "previous" : "next"}_${Math.abs(delta)}y`,
          allowedYearRange,
        });
      }
    }

    requests.push({
      make: normalizedPrimary.make,
      model: normalizedPrimary.model,
      trim: null,
      mode: "generation_fallback",
      sourceLabel: "canonical_family_fallback",
      allowedYearRange,
    });

    const deduped = requests.filter(
      (request, index, array) =>
        array.findIndex(
          (entry) =>
            entry.mode === request.mode &&
            (entry.year ?? null) === (request.year ?? null) &&
            normalizeMatchText(entry.make) === normalizeMatchText(request.make) &&
            normalizeModelFamily(entry.model) === normalizeModelFamily(request.model),
        ) === index,
    );
    logger.info(
      {
        label: "YEAR_CANDIDATE_ORDER_BUILT",
        likelyYear: normalizedPrimary.year,
        yearConfidence: input.normalizedResult.yearConfidence ?? null,
        orderedYears: deduped.map((request) => request.year ?? null).filter((year): year is number => typeof year === "number"),
      },
      "YEAR_CANDIDATE_ORDER_BUILT",
    );
    return deduped;
  }

  private async resolveVehiclesForEnrichmentCandidate(
    request: EnrichmentCandidateRequest,
    options?: { allowLiveMarketData?: boolean },
  ): Promise<VehicleRecord[]> {
    const allowLiveMarketData = options?.allowLiveMarketData ?? false;
    if (request.vehicleId) {
      const exact = await resolveStoredVehicleRecordById(request.vehicleId);
      if (
        exact &&
        matchesCanonicalLookupModel({
          make: request.make,
          model: request.model,
          trim: request.trim ?? null,
          candidateModel: exact.model,
        }) &&
        isYearWithinInclusiveRange(exact.year, request.allowedYearRange ?? null) &&
        hasUsableFreeDisplaySpecs(exact)
      ) {
        return [exact];
      }
      logger.info(
        {
          label: "ENRICHMENT_DIRECT_VEHICLE_ID_BYPASSED",
          vehicleId: request.vehicleId,
          year: request.year ?? null,
          make: request.make,
          model: request.model,
          trim: request.trim ?? null,
          hasExactRecord: Boolean(exact),
          exactModel: exact?.model ?? null,
          exactYear: exact?.year ?? null,
          usableFreeSpecs: hasUsableFreeDisplaySpecs(exact),
          sourceLabel: request.sourceLabel,
        },
        "ENRICHMENT_DIRECT_VEHICLE_ID_BYPASSED",
      );
      // Fall through to local canonical alias search so plain-family ids like
      // Aston Martin Vantage can still use richer V8-family canonical rows.
    }

    const canonicalMatches = await repositories.canonicalVehicles.searchPromoted({
      year: request.year,
      normalizedMake: normalizeMatchText(request.make),
      normalizedModel: shouldBroadenCanonicalLookupModelSearch({
        make: request.make,
        model: request.model,
        trim: request.trim ?? null,
      })
        ? undefined
        : normalizeMatchText(request.model),
    });
    const localMatches = canonicalMatches
      .map((record) => mapCanonicalVehicleToRecord(record))
      .filter((vehicle): vehicle is VehicleRecord => vehicle !== null)
      .filter(
        (vehicle) =>
          normalizeMatchText(vehicle.make) === normalizeMatchText(request.make) &&
          isAllowedAstonMartinVantageCanonicalModel({
            requestedMake: request.make,
            requestedModel: request.model,
            candidateModel: vehicle.model,
            trim: request.trim ?? null,
          }) &&
          matchesCanonicalLookupModel({
            make: request.make,
            model: request.model,
            trim: request.trim ?? null,
            candidateModel: vehicle.model,
          }) &&
          (typeof request.year !== "number" || vehicle.year === request.year) &&
          isYearWithinInclusiveRange(vehicle.year, request.allowedYearRange ?? null),
      )
      .sort(
        (left, right) =>
          getAstonMartinVantageCanonicalPreferenceScore({
            requestedMake: request.make,
            requestedModel: request.model,
            candidateModel: left.model,
            trim: request.trim ?? null,
          }) -
            getAstonMartinVantageCanonicalPreferenceScore({
              requestedMake: request.make,
              requestedModel: request.model,
              candidateModel: right.model,
              trim: request.trim ?? null,
            }) ||
          Math.abs(left.year - (request.year ?? left.year)) - Math.abs(right.year - (request.year ?? right.year)),
      );
    if (localMatches.length > 0 || !allowLiveMarketData) {
      return localMatches;
    }
    logger.info(
      {
        label: "SCAN_PROVIDER_SEARCH_SKIPPED_INITIAL_IDENTIFY",
        year: request.year ?? null,
        make: request.make,
        model: request.model,
        trim: request.trim ?? null,
        sourceLabel: request.sourceLabel,
        reason: "enrichment-local-canonical-only",
      },
      "SCAN_PROVIDER_SEARCH_SKIPPED_INITIAL_IDENTIFY",
    );
    return localMatches;
  }

  private async evaluateEnrichmentCandidate(
    request: EnrichmentCandidateRequest,
    options: {
      scanId: string;
      allowLiveMarketData: boolean;
      lockedDisplayIdentity: LockedDisplayIdentity;
      normalizedResult: VisionResult;
    },
  ): Promise<EnrichmentPreview | null> {
    const vehicles = await this.resolveVehiclesForEnrichmentCandidate(request, {
      allowLiveMarketData: options.allowLiveMarketData,
    });
    logger.info(
      {
        label: "ENRICHMENT_CANDIDATE_SET",
        scanId: options.scanId,
        request: {
          mode: request.mode,
          year: request.year ?? null,
          make: request.make,
          model: request.model,
          trim: request.trim ?? null,
          sourceLabel: request.sourceLabel,
        },
        resolvedVehicles: vehicles.map((vehicle) => ({
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim ?? null,
        })),
      },
      "ENRICHMENT_CANDIDATE_SET",
    );
    if (vehicles.length === 0) {
      return null;
    }

    let bestPreview: EnrichmentPreview | null = null;
    for (const vehicle of vehicles.slice(0, 3)) {
      const compatibility = classifyEnrichmentIdentityDecision(
        options.lockedDisplayIdentity,
        {
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim,
        },
        request.mode,
      );
      if (!isYearWithinInclusiveRange(vehicle.year, request.allowedYearRange ?? null)) {
        logger.warn(
          {
            label: "CANONICAL_LOOKUP_DISTANCE_REJECTED",
            scanId: options.scanId,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            normalizedKey: buildCanonicalKey({
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              trim: vehicle.trim ?? "base",
            }),
            source: request.sourceLabel,
            allowedYearRange: request.allowedYearRange ?? null,
          },
          "CANONICAL_LOOKUP_DISTANCE_REJECTED",
        );
        continue;
      }
      if (!compatibility.allowed) {
        if (
          request.mode === "adjacent_year" &&
          Math.abs(vehicle.year - options.lockedDisplayIdentity.year) > 1
        ) {
          logger.warn(
            {
              label: "ENRICHMENT_YEAR_DISTANCE_REJECTED",
              scanId: options.scanId,
              lockedYear: options.lockedDisplayIdentity.year,
              candidateYear: vehicle.year,
              mode: request.mode,
              sourceLabel: request.sourceLabel,
            },
            "ENRICHMENT_YEAR_DISTANCE_REJECTED",
          );
        }
        logger.warn(
          {
            label: "ENRICHMENT_REJECTED_IDENTITY_MISMATCH",
            scanId: options.scanId,
            lockedDisplayIdentity: options.lockedDisplayIdentity,
            attemptedCandidate: {
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              trim: vehicle.trim,
              vehicleId: vehicle.id,
            },
            sourceLabel: request.sourceLabel,
            reason: compatibility.reason,
          },
          "ENRICHMENT_REJECTED_IDENTITY_MISMATCH",
        );
        continue;
      }
      let valuation: Awaited<ReturnType<VehicleService["getValue"]>>["data"] | null = null;
      let listings: ListingRecord[] = [];
      logScanBootstrapProviderSkip({
        label: "SCAN_VALUE_LOOKUP_SKIPPED_INITIAL_IDENTIFY",
        scanId: options.scanId,
        vehicleId: vehicle.id,
        sourceLabel: request.sourceLabel,
      });
      logScanBootstrapProviderSkip({
        label: "SCAN_LISTINGS_LOOKUP_SKIPPED_INITIAL_IDENTIFY",
        scanId: options.scanId,
        vehicleId: vehicle.id,
        sourceLabel: request.sourceLabel,
      });

      const payload = evaluateVehiclePayloadStrength({
        vehicle,
        valuation,
        listings,
      });
      const freeSpecFieldCount = getFreeDisplaySpecFieldCount(vehicle);
      logger.info(
        {
          label: "ENRICHMENT_CANDIDATE_FIELD_COUNT",
          scanId: options.scanId,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vehicleId: vehicle.id,
          sourceProvider: vehicle.id.startsWith("canonical:") ? "ai_learned" : "catalog_vehicle",
          sourceLabel: request.sourceLabel,
          payloadStrength: payload.payloadStrength,
          freeSpecFieldCount,
          unlockEligible: payload.unlockEligible,
        },
        "ENRICHMENT_CANDIDATE_FIELD_COUNT",
      );
      const yearDistance = Math.abs(vehicle.year - options.lockedDisplayIdentity.year);
      const visualOnlyYear = hasUnconfirmedVisualYear(options.normalizedResult);
      const exactConfirmedYear = hasConfirmedExactYear(options.normalizedResult);
      let adjustedPayload: PayloadEvaluation = payload;

      if (request.mode === "exact" && freeSpecFieldCount === 0 && isEmptyAiLearnedCanonicalShell(vehicle)) {
        logger.info(
          {
            label: "ENRICHMENT_EXACT_EMPTY_CONTINUING",
            scanId: options.scanId,
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            vehicleId: vehicle.id,
            sourceProvider: "ai_learned",
            payloadStrength: payload.payloadStrength,
            freeSpecFieldCount,
          },
          "ENRICHMENT_EXACT_EMPTY_CONTINUING",
        );
      }

      if (request.mode === "generation_fallback") {
        adjustedPayload = {
          ...payload,
          payloadStrength: (
            payload.payloadStrength === "empty"
              ? "empty"
              : payload.payloadStrength === "thin"
                ? "thin"
                : "usable"
          ) as PayloadEvaluation["payloadStrength"],
          dataConfidence: Math.min(payload.dataConfidence, yearDistance > 1 ? 0.56 : 0.62),
          unlockEligible: false,
          unlockRecommendationReason:
            "This is generic generation-level data for a nearby year, not full verified details for the identified vehicle.",
        };
        logger.info(
          {
            label: "GENERATION_FALLBACK_DOWNGRADED",
            scanId: options.scanId,
            lockedYear: options.lockedDisplayIdentity.year,
            fallbackYear: vehicle.year,
            yearDistance,
            originalPayloadStrength: payload.payloadStrength,
            downgradedPayloadStrength: adjustedPayload.payloadStrength,
          },
          "GENERATION_FALLBACK_DOWNGRADED",
        );
      }

      if (request.mode === "adjacent_year" && visualOnlyYear) {
        adjustedPayload = {
          ...adjustedPayload,
          payloadStrength: (
            adjustedPayload.payloadStrength === "empty"
              ? "empty"
              : adjustedPayload.payloadStrength === "thin"
                ? "thin"
                : "usable"
          ) as PayloadEvaluation["payloadStrength"],
          dataConfidence: Math.min(adjustedPayload.dataConfidence, 0.6),
          unlockEligible: false,
          unlockRecommendationReason:
            "The exact year is not confirmed yet, so nearby-year details are shown as a cautious estimate only.",
        };
        logger.info(
          {
            label: "ADJACENT_YEAR_DOWNGRADED_VISUAL_ONLY",
            scanId: options.scanId,
            lockedYear: options.lockedDisplayIdentity.year,
            candidateYear: vehicle.year,
            yearConfidence: options.normalizedResult.yearConfidence ?? null,
            yearEvidence: options.normalizedResult.yearEvidence ?? null,
            originalPayloadStrength: payload.payloadStrength,
            downgradedPayloadStrength: adjustedPayload.payloadStrength,
          },
          "ADJACENT_YEAR_DOWNGRADED_VISUAL_ONLY",
        );
      }

      if (!exactConfirmedYear) {
        adjustedPayload = {
          ...adjustedPayload,
          unlockEligible: false,
          unlockRecommendationReason:
            request.mode === "exact"
              ? "The vehicle family looks right, but the exact year is not confirmed yet."
              : adjustedPayload.unlockRecommendationReason || "The exact year is not confirmed yet.",
        };
        logger.info(
          {
            label: "UNLOCK_BLOCKED_UNCONFIRMED_YEAR",
            scanId: options.scanId,
            mode: request.mode,
            lockedYear: options.lockedDisplayIdentity.year,
            candidateYear: vehicle.year,
            yearConfidence: options.normalizedResult.yearConfidence ?? null,
            yearEvidence: options.normalizedResult.yearEvidence ?? null,
          },
          "UNLOCK_BLOCKED_UNCONFIRMED_YEAR",
        );
      }

      const preview: EnrichmentPreview = {
        vehicle,
        payload: adjustedPayload,
        enrichmentMode: request.mode,
        rescuedByAdjacentYear: request.mode === "adjacent_year",
        unlockEligible: adjustedPayload.unlockEligible,
        valuation,
        listings,
        freeSpecFieldCount,
        sourceLabel: request.sourceLabel,
      };

      const previewScore =
        freeSpecFieldCount * 100 +
        adjustedPayload.meaningfulSpecFieldCount * 10 +
        adjustedPayload.dataConfidence;
      const bestScore =
        (bestPreview?.freeSpecFieldCount ?? 0) * 100 +
        (bestPreview?.payload.meaningfulSpecFieldCount ?? 0) * 10 +
        (bestPreview?.payload.dataConfidence ?? 0);
      if (!bestPreview || previewScore > bestScore) {
        bestPreview = preview;
      }
      if (
        (adjustedPayload.payloadStrength === "strong" || adjustedPayload.payloadStrength === "usable") &&
        freeSpecFieldCount > 0
      ) {
        return preview;
      }
    }

    return bestPreview;
  }

  private enforceFinalUnconfirmedYearPreviewSafety(input: {
    scanId: string;
    preview: EnrichmentPreview;
    normalizedResult: VisionResult;
    lockedDisplayIdentity: LockedDisplayIdentity;
  }): EnrichmentPreview {
    const visualOnlyYear = hasUnconfirmedVisualYear(input.normalizedResult);
    const exactConfirmedYear = hasConfirmedExactYear(input.normalizedResult);
    const yearDistance = input.preview.vehicle
      ? Math.abs(input.preview.vehicle.year - input.lockedDisplayIdentity.year)
      : 0;

    let payload = input.preview.payload;

    if (input.preview.enrichmentMode === "generation_fallback") {
      const downgradedStrength =
        payload.payloadStrength === "empty"
          ? "empty"
          : payload.payloadStrength === "thin"
            ? "thin"
            : "usable";
      if (payload.payloadStrength !== downgradedStrength || payload.unlockEligible) {
        payload = {
          ...payload,
          payloadStrength: downgradedStrength,
          dataConfidence: Math.min(payload.dataConfidence, yearDistance > 1 ? 0.56 : 0.62),
          unlockEligible: false,
          unlockRecommendationReason:
            "This is generic generation-level data for a nearby year, not full verified details for the identified vehicle.",
        };
        logger.info(
          {
            label: "GENERATION_FALLBACK_DOWNGRADED",
            scanId: input.scanId,
            lockedYear: input.lockedDisplayIdentity.year,
            fallbackYear: input.preview.vehicle?.year ?? null,
            yearDistance,
            originalPayloadStrength: input.preview.payload.payloadStrength,
            downgradedPayloadStrength: payload.payloadStrength,
            activePathFunctionName: "ScanService.evaluateScanPayloadPreview",
          },
          "GENERATION_FALLBACK_DOWNGRADED",
        );
      }
    }

    if (input.preview.enrichmentMode === "adjacent_year" && visualOnlyYear) {
      const downgradedStrength =
        payload.payloadStrength === "empty"
          ? "empty"
          : payload.payloadStrength === "thin"
            ? "thin"
            : "usable";
      if (payload.payloadStrength !== downgradedStrength || payload.unlockEligible) {
        payload = {
          ...payload,
          payloadStrength: downgradedStrength,
          dataConfidence: Math.min(payload.dataConfidence, 0.6),
          unlockEligible: false,
          unlockRecommendationReason:
            "The exact year is not confirmed yet, so nearby-year details are shown as a cautious estimate only.",
        };
        logger.info(
          {
            label: "ADJACENT_YEAR_DOWNGRADED_VISUAL_ONLY",
            scanId: input.scanId,
            lockedYear: input.lockedDisplayIdentity.year,
            candidateYear: input.preview.vehicle?.year ?? null,
            yearConfidence: input.normalizedResult.yearConfidence ?? null,
            yearEvidence: input.normalizedResult.yearEvidence ?? null,
            originalPayloadStrength: input.preview.payload.payloadStrength,
            downgradedPayloadStrength: payload.payloadStrength,
            activePathFunctionName: "ScanService.evaluateScanPayloadPreview",
          },
          "ADJACENT_YEAR_DOWNGRADED_VISUAL_ONLY",
        );
      }
    }

    if (!exactConfirmedYear && payload.unlockEligible) {
      payload = {
        ...payload,
        unlockEligible: false,
        unlockRecommendationReason:
          input.preview.enrichmentMode === "exact"
            ? "The vehicle family looks right, but the exact year is not confirmed yet."
            : payload.unlockRecommendationReason || "The exact year is not confirmed yet.",
      };
      logger.info(
        {
          label: "UNLOCK_BLOCKED_UNCONFIRMED_YEAR",
          scanId: input.scanId,
          mode: input.preview.enrichmentMode,
          lockedYear: input.lockedDisplayIdentity.year,
          candidateYear: input.preview.vehicle?.year ?? null,
          yearConfidence: input.normalizedResult.yearConfidence ?? null,
          yearEvidence: input.normalizedResult.yearEvidence ?? null,
          activePathFunctionName: "ScanService.evaluateScanPayloadPreview",
        },
        "UNLOCK_BLOCKED_UNCONFIRMED_YEAR",
      );
    }

    if (payload === input.preview.payload) {
      return input.preview;
    }

    return {
      ...input.preview,
      payload,
      unlockEligible: payload.unlockEligible,
    };
  }

  private async evaluateScanPayloadPreview(input: {
    scanId: string;
    normalizedResult: VisionResult;
    resolvedCandidates: MatchedVehicleCandidate[];
    allowLiveMarketData: boolean;
  }): Promise<EnrichmentPreview> {
    const lockedDisplayIdentity = buildLockedDisplayIdentity(input.normalizedResult);
    logger.info(
      {
        label: "UNLOCK_PROTECTION_IDENTIFIED_CANDIDATE",
        scanId: input.scanId,
        identifiedCandidate: {
          year: input.normalizedResult.likely_year ?? null,
          make: input.normalizedResult.likely_make ?? null,
          model: input.normalizedResult.likely_model ?? null,
          trim: input.normalizedResult.likely_trim ?? null,
          source: input.normalizedResult.source ?? null,
          confidence: input.normalizedResult.confidence ?? null,
        },
      },
      "UNLOCK_PROTECTION_IDENTIFIED_CANDIDATE",
    );

    const requests = this.buildEnrichmentCandidateRequests(input);
    logger.info(
      {
        label: "ENRICHMENT_CANDIDATE_SET",
        scanId: input.scanId,
        candidates: requests.map((request) => ({
          mode: request.mode,
          year: request.year ?? null,
          make: request.make,
          model: request.model,
          trim: request.trim ?? null,
          sourceLabel: request.sourceLabel,
        })),
      },
      "ENRICHMENT_CANDIDATE_SET",
    );
    for (const request of requests) {
      logMercedesSlStage({
        label: "MERCEDES_SL_ENRICHMENT_CANDIDATE",
        scanId: input.scanId,
        year: request.year ?? null,
        make: request.make,
        model: request.model,
        trim: request.trim ?? null,
        visibleBadgeText: input.normalizedResult.visible_badge_text ?? null,
        visibleModelText: input.normalizedResult.visible_model_text ?? null,
        canonicalKey:
          typeof request.year === "number"
            ? buildCanonicalKey({
                year: request.year,
                make: request.make,
                model: request.model,
                trim: request.trim,
              })
            : null,
      });
    }

    let bestPreview: EnrichmentPreview | null = null;
    for (const request of requests) {
      const rawPreview = await this.evaluateEnrichmentCandidate(request, {
        scanId: input.scanId,
        allowLiveMarketData: input.allowLiveMarketData,
        lockedDisplayIdentity,
        normalizedResult: input.normalizedResult,
      });
      if (!rawPreview) {
        logger.warn(
          {
            label:
              request.mode === "exact"
                ? "ENRICHMENT_FAILED"
                : request.mode === "adjacent_year"
                  ? "ENRICHMENT_FAILED"
                  : "ENRICHMENT_FAILED",
            scanId: input.scanId,
            mode: request.mode,
            year: request.year ?? null,
            make: request.make,
            model: request.model,
            sourceLabel: request.sourceLabel,
            reason: "no_vehicle_candidates",
          },
          "ENRICHMENT_FAILED",
        );
        continue;
      }
      const preview = this.enforceFinalUnconfirmedYearPreviewSafety({
        scanId: input.scanId,
        preview: rawPreview,
        normalizedResult: input.normalizedResult,
        lockedDisplayIdentity,
      });

      if (!bestPreview || preview.payload.dataConfidence > bestPreview.payload.dataConfidence) {
        bestPreview = preview;
      }

      logger.info(
        {
          label:
            request.mode === "exact"
              ? "ENRICHMENT_EXACT_MATCH"
              : request.mode === "adjacent_year"
                ? "ENRICHMENT_ADJACENT_YEAR_MATCH"
                : "ENRICHMENT_GENERATION_FALLBACK",
          scanId: input.scanId,
          vehicleId: preview.vehicle?.id ?? null,
          year: preview.vehicle?.year ?? request.year ?? null,
          make: preview.vehicle?.make ?? request.make,
          model: preview.vehicle?.model ?? request.model,
          sourceLabel: request.sourceLabel,
          payloadStrength: preview.payload.payloadStrength,
          unlockEligible: preview.payload.unlockEligible,
          reasons: preview.payload.reasons,
          rescuedByAdjacentYear: preview.rescuedByAdjacentYear,
        },
          request.mode === "exact"
            ? "ENRICHMENT_EXACT_MATCH"
            : request.mode === "adjacent_year"
              ? "ENRICHMENT_ADJACENT_YEAR_MATCH"
              : "ENRICHMENT_GENERATION_FALLBACK",
      );

      if (preview.payload.payloadStrength === "strong" || preview.payload.payloadStrength === "usable") {
        break;
      }
    }

    const fallbackPayload = bestPreview?.payload ?? {
      payloadStrength: "empty" as const,
      dataConfidence: 0.12,
      unlockEligible: false,
      unlockRecommendationReason: "We found the vehicle, but this result still needs more useful detail before an unlock would be worth it.",
      meaningfulSpecFieldCount: 0,
      believableListingCount: 0,
      hasMarketValue: false,
      reasons: ["no_usable_enrichment_found"],
    };

    logger.info(
      {
        label:
          fallbackPayload.payloadStrength === "strong"
            ? "PAYLOAD_STRONG"
            : fallbackPayload.payloadStrength === "usable"
              ? "PAYLOAD_USABLE"
              : fallbackPayload.payloadStrength === "thin"
                ? "PAYLOAD_THIN"
                : "PAYLOAD_EMPTY",
        scanId: input.scanId,
        payloadStrength: fallbackPayload.payloadStrength,
        unlockEligible: fallbackPayload.unlockEligible,
        reasons: fallbackPayload.reasons,
        rescuedByAdjacentYear: bestPreview?.rescuedByAdjacentYear ?? false,
      },
      fallbackPayload.payloadStrength === "strong"
        ? "PAYLOAD_STRONG"
        : fallbackPayload.payloadStrength === "usable"
          ? "PAYLOAD_USABLE"
          : fallbackPayload.payloadStrength === "thin"
            ? "PAYLOAD_THIN"
            : "PAYLOAD_EMPTY",
    );

    logger.info(
      {
        label: "UNLOCK_PROTECTION_RESULT",
        scanId: input.scanId,
        payloadStrength: fallbackPayload.payloadStrength,
        unlockEligible: fallbackPayload.unlockEligible,
        unlockRecommendationReason: fallbackPayload.unlockRecommendationReason,
        enrichmentMode: bestPreview?.enrichmentMode ?? "fallback_only",
        rescuedByAdjacentYear: bestPreview?.rescuedByAdjacentYear ?? false,
      },
      "UNLOCK_PROTECTION_RESULT",
    );

    if (bestPreview?.vehicle) {
      logger.info(
        {
          label: "ENRICHMENT_BEST_SPEC_SOURCE_SELECTED",
          scanId: input.scanId,
          year: bestPreview.vehicle.year,
          make: bestPreview.vehicle.make,
          model: bestPreview.vehicle.model,
          vehicleId: bestPreview.vehicle.id,
          sourceProvider: bestPreview.vehicle.id.startsWith("canonical:") ? "ai_learned" : "catalog_vehicle",
          sourceLabel: bestPreview.sourceLabel ?? null,
          payloadStrength: bestPreview.payload.payloadStrength,
          freeSpecFieldCount: bestPreview.freeSpecFieldCount ?? getFreeDisplaySpecFieldCount(bestPreview.vehicle),
          unlockEligible: bestPreview.payload.unlockEligible,
          displayYearLabel: input.normalizedResult.displayYearLabel ?? null,
          yearConfidence: input.normalizedResult.yearConfidence ?? null,
          yearEvidence: input.normalizedResult.yearEvidence ?? null,
        },
        "ENRICHMENT_BEST_SPEC_SOURCE_SELECTED",
      );
      logger.info(
        {
          label: "FREE_DISPLAY_SPECS_RETURNED",
          scanId: input.scanId,
          year: bestPreview.vehicle.year,
          make: bestPreview.vehicle.make,
          model: bestPreview.vehicle.model,
          vehicleId: bestPreview.vehicle.id,
          sourceProvider: bestPreview.vehicle.id.startsWith("canonical:") ? "ai_learned" : "catalog_vehicle",
          payloadStrength: bestPreview.payload.payloadStrength,
          freeSpecFieldCount: bestPreview.freeSpecFieldCount ?? getFreeDisplaySpecFieldCount(bestPreview.vehicle),
          unlockEligible: bestPreview.payload.unlockEligible,
          displayYearLabel: input.normalizedResult.displayYearLabel ?? null,
          yearConfidence: input.normalizedResult.yearConfidence ?? null,
          yearEvidence: input.normalizedResult.yearEvidence ?? null,
        },
        "FREE_DISPLAY_SPECS_RETURNED",
      );
    }

    return {
      vehicle: bestPreview?.vehicle ?? null,
      payload: fallbackPayload,
      enrichmentMode: bestPreview?.enrichmentMode ?? "fallback_only",
      rescuedByAdjacentYear: bestPreview?.rescuedByAdjacentYear ?? false,
      unlockEligible: fallbackPayload.unlockEligible,
      valuation: bestPreview?.valuation ?? null,
      listings: bestPreview?.listings ?? [],
    };
  }

  private recordCoverageMetrics(input: {
    scanId: string;
    normalizedResult: VisionResult;
    payloadPreview: EnrichmentPreview;
  }) {
    const vehicle = input.payloadPreview.vehicle;
    const valuation = input.payloadPreview.valuation;
    const listings = input.payloadPreview.listings;
    const providerVehicleSource = vehicle
      ? vehicle.id.startsWith("live:")
        ? "provider_vehicle"
        : "catalog_vehicle"
      : null;
    const nhtsaHint = vehicle?.vin ? "nhtsa_or_vehicle_record" : null;
    const hasMarketValue =
      Boolean(valuation) &&
      [valuation?.tradeIn, valuation?.privateParty, valuation?.dealerRetail].some(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
      );
    const believableListings = listings.some((listing) => hasBelievableListing(listing));

    coverageInstrumentationService.recordScan({
      scanId: input.scanId,
      identifiedYear: input.normalizedResult.likely_year ?? null,
      identifiedMake: input.normalizedResult.likely_make ?? null,
      identifiedModel: input.normalizedResult.likely_model ?? null,
      vehicleType: input.normalizedResult.vehicle_type ?? null,
      vinPresent: Boolean(vehicle?.vin),
      enrichmentMode: input.payloadPreview.enrichmentMode,
      payloadStrength: input.payloadPreview.payload.payloadStrength,
      unlockEligible: input.payloadPreview.unlockEligible,
      unlockRecommendationReason: input.payloadPreview.payload.unlockRecommendationReason,
      fieldPopulation: {
        horsepower: typeof vehicle?.horsepower === "number" && Number.isFinite(vehicle.horsepower) && vehicle.horsepower > 0,
        drivetrain: Boolean(vehicle?.drivetrain?.trim()),
        bodyStyle: Boolean(vehicle?.bodyStyle?.trim()),
        fuelType: Boolean(vehicle?.fuelType?.trim()),
        msrp: typeof vehicle?.msrp === "number" && Number.isFinite(vehicle.msrp) && vehicle.msrp > 0,
        marketValue: hasMarketValue,
        believableListings,
        totalMeaningfulSpecFields: input.payloadPreview.payload.meaningfulSpecFieldCount,
      },
      fieldSources: {
        horsepower:
          typeof vehicle?.horsepower === "number" && vehicle.horsepower > 0 ? nhtsaHint ?? providerVehicleSource : null,
        drivetrain: vehicle?.drivetrain?.trim() ? providerVehicleSource : null,
        bodyStyle: vehicle?.bodyStyle?.trim() ? providerVehicleSource : null,
        fuelType: vehicle?.fuelType?.trim() ? nhtsaHint ?? providerVehicleSource : null,
        msrp: typeof vehicle?.msrp === "number" && vehicle.msrp > 0 ? providerVehicleSource : null,
        marketValue: hasMarketValue ? valuation?.sourceLabel ?? valuation?.modelType ?? "valuation_provider" : null,
        believableListings: believableListings ? "listings_provider" : null,
      },
      rescuedByAdjacentYear: input.payloadPreview.rescuedByAdjacentYear,
    });
  }

  private async recordCanonicalGapIfNeeded(input: {
    scanId: string;
    normalizedResult: VisionResult;
    payloadPreview: EnrichmentPreview;
    canonicalHit: boolean;
    finalResultType: "canonical" | "ai_only";
  }) {
    if (input.canonicalHit) {
      return;
    }
    if (
      input.finalResultType !== "ai_only" &&
      input.payloadPreview.payload.payloadStrength !== "empty"
    ) {
      return;
    }

    const trim = input.normalizedResult.likely_trim?.trim() || null;
    const canonicalKey = buildCanonicalKey({
      year: input.normalizedResult.likely_year,
      make: input.normalizedResult.likely_make,
      model: input.normalizedResult.likely_model,
      trim,
    });
    const nowIso = new Date().toISOString();
    const record: CanonicalGapQueueRecord = {
      id: crypto.randomUUID(),
      gapKey: buildCanonicalGapKey({
        year: input.normalizedResult.likely_year,
        make: input.normalizedResult.likely_make,
        model: input.normalizedResult.likely_model,
        trim,
      }),
      canonicalKey,
      year: input.normalizedResult.likely_year,
      make: input.normalizedResult.likely_make,
      model: input.normalizedResult.likely_model,
      trim,
      normalizedMake: normalizeMatchText(input.normalizedResult.likely_make),
      normalizedModel: normalizeLookupText(input.normalizedResult.likely_model),
      normalizedTrim: normalizeModelFamily(trim || "base") || "base",
      bodyType: input.payloadPreview.vehicle?.bodyStyle ?? null,
      vehicleType: input.normalizedResult.vehicle_type ?? null,
      finalResultType: input.finalResultType,
      payloadStrength: input.payloadPreview.payload.payloadStrength,
      exampleConfidence: input.normalizedResult.confidence,
      exampleScanId: input.scanId,
      visibleBadgeText: input.normalizedResult.visible_badge_text ?? null,
      visibleMakeText: input.normalizedResult.visible_make_text ?? null,
      visibleModelText: input.normalizedResult.visible_model_text ?? null,
      visibleTrimText: input.normalizedResult.visible_trim_text ?? null,
      notes: input.payloadPreview.payload.unlockRecommendationReason,
      hitCount: 1,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    try {
      const result = await repositories.canonicalGapQueue.recordGap(record);
      logger.info(
        {
          label:
            result.action === "insert"
              ? "CANONICAL_GAP_RECORDED"
              : "CANONICAL_GAP_INCREMENTED",
          scanId: input.scanId,
          gapKey: record.gapKey,
          canonicalKey: record.canonicalKey,
          finalResultType: record.finalResultType,
          payloadStrength: record.payloadStrength,
          hitCount: result.record.hitCount,
        },
        result.action === "insert"
          ? "CANONICAL_GAP_RECORDED"
          : "CANONICAL_GAP_INCREMENTED",
      );
    } catch (error) {
      const described = describeUnknownError(error);
      logger.warn(
        {
          label: "CANONICAL_GAP_QUEUE_WRITE_FAILED",
          scanId: input.scanId,
          gapKey: record.gapKey,
          canonicalKey: record.canonicalKey,
          reason: described.reason,
          errorCode: described.errorCode,
          details: described.details,
          hint: described.hint,
          supabase: described.supabase,
        },
        "CANONICAL_GAP_QUEUE_WRITE_FAILED",
      );
    }
  }

  private async applyGoogleOcrEvidence(input: {
    scanId: string;
    normalized: VisionResult;
    imageBuffer: Buffer;
    mimeType: string;
  }) {
    const ocrResult = await googleVisionOcrService.extractVehicleText({
      imageBuffer: input.imageBuffer,
      mimeType: input.mimeType,
      candidateHints: buildOcrCandidateHints(input.normalized),
    });

    if (!ocrResult) {
      logger.info(
        {
          label: "GOOGLE_VISION_OCR_DECISION",
          scanId: input.scanId,
          ocrAvailable: false,
          parsedStructuredCandidate: null,
          overrideTriggered: false,
          confirmationApplied: false,
          ignoredReason: "ocr_unavailable",
          finalWinningSource: "visual_candidate",
        },
        "GOOGLE_VISION_OCR_DECISION",
      );
      return { normalized: input.normalized, ocrResult: null as GoogleVisionOcrResult | null };
    }

    const normalizedWithOcr = applyGoogleOcrOverride(input.normalized, ocrResult);
    const decision = summarizeOcrDecision({
      before: input.normalized,
      after: normalizedWithOcr,
      ocrResult,
    });
    logger.info(
      {
        label: "GOOGLE_VISION_OCR_APPLIED",
        scanId: input.scanId,
        detectedYear: ocrResult.detectedYear,
        detectedMake: ocrResult.detectedMake,
        detectedModel: ocrResult.detectedModel,
        detectedTrim: ocrResult.detectedTrim,
        structuredVehicle: ocrResult.structuredVehicle,
        credentialSource: ocrResult.credentialSource,
        before: {
          year: input.normalized.likely_year,
          make: input.normalized.likely_make,
          model: input.normalized.likely_model,
          trim: input.normalized.likely_trim ?? null,
          confidence: input.normalized.confidence,
        },
        after: {
          year: normalizedWithOcr.likely_year,
          make: normalizedWithOcr.likely_make,
          model: normalizedWithOcr.likely_model,
          trim: normalizedWithOcr.likely_trim ?? null,
          confidence: normalizedWithOcr.confidence,
        },
      },
      "GOOGLE_VISION_OCR_APPLIED",
    );
    logger.info(
      {
        label: "GOOGLE_VISION_OCR_DECISION",
        scanId: input.scanId,
        rawTextSummary: ocrResult.rawText.replace(/\s+/g, " ").trim().slice(0, 220),
        parsedStructuredCandidate: ocrResult.structuredVehicle,
        detectedYear: ocrResult.detectedYear,
        detectedMake: ocrResult.detectedMake,
        detectedModel: ocrResult.detectedModel,
        detectedTrim: ocrResult.detectedTrim,
        textCandidateValidated: Boolean(ocrResult.structuredVehicle),
        overrideTriggered: decision.overrideTriggered,
        confirmationApplied: decision.confirmationApplied,
        ignoredReason: decision.ignoredReason,
        finalWinningSource: decision.finalWinningSource,
      },
      "GOOGLE_VISION_OCR_DECISION",
    );

    return { normalized: normalizedWithOcr, ocrResult };
  }

  async identifyVehicle(input: {
    auth: AuthContext;
    imageBuffer: Buffer;
    mimeType: string;
    imageUrl: string;
    allowPremium?: boolean;
  }): Promise<{
    scan: ScanRecord;
    visionProvider: string;
    entitlement?: { usedUnlock: boolean; alreadyUnlocked: boolean; remainingUnlocks: number; isPro: boolean };
    payloadPreview: {
      identificationConfidence: number;
      dataConfidence: number;
      payloadStrength: PayloadEvaluation["payloadStrength"];
      enrichmentMode: EnrichmentMode;
      unlockEligible: boolean;
      unlockRecommendationReason: string;
      freeDisplaySpecs?: {
        sourceLabel: string | null;
        displayNote: string | null;
        sourceYear: number | null;
        engine: string | null;
        horsepower: number | null;
        drivetrain: string | null;
        transmission: string | null;
        bodyStyle: string | null;
        fuelType: string | null;
        msrp: number | null;
        freeSpecFieldCount: number;
      } | null;
      unknownAfterVisionFailure?: boolean;
    };
  }> {
    const scanId = crypto.randomUUID();
    let stage: ScanFailureStage = "USAGE_CHECK";
    try {
      logIdentifyStage("USAGE_CHECK", "start", {
        scanId,
        userId: input.auth.userId,
        imageUrl: input.imageUrl,
      });
      const usage = await this.usageService.assertScanAllowed(input.auth);
      logIdentifyStage("USAGE_CHECK", "success", {
        scanId,
        userId: input.auth.userId,
        plan: usage.plan,
      });

      stage = "ENTITLEMENT_CHECK";
      logIdentifyStage("ENTITLEMENT_CHECK", "start", {
        scanId,
        userId: input.auth.userId,
      });
      const premiumRequested = Boolean(input.allowPremium);
      const entitlementCheck = await this.unlockService.canRequestPremium(input.auth.userId);
      logger.info(
        {
          label: "IDENTIFY_ENTITLEMENT_DECISION",
          scanId,
          userId: input.auth.userId,
          premiumRequested,
          isPro: usage.isPro,
          remainingUnlocks: entitlementCheck.remainingUnlocks,
        },
        "IDENTIFY_ENTITLEMENT_DECISION",
      );
      logger.info(
        {
          label: "PREMIUM_UNLOCK_GATE_CHECK",
          scanId,
          userId: input.auth.userId,
          premiumRequested,
          isPro: usage.isPro,
          remainingUnlocks: entitlementCheck.remainingUnlocks,
          decision: premiumRequested && !usage.isPro && entitlementCheck.remainingUnlocks <= 0 ? "premium_cached_only" : "basic_scan_allowed",
        },
        "PREMIUM_UNLOCK_GATE_CHECK",
      );
      logIdentifyStage("ENTITLEMENT_CHECK", "success", {
        scanId,
        userId: input.auth.userId,
        premiumRequested,
        remainingUnlocks: entitlementCheck.remainingUnlocks,
      });

      stage = "IMAGE_PROCESSING";
      logIdentifyStage("IMAGE_PROCESSING", "start", {
        scanId,
        userId: input.auth.userId,
        mimeType: input.mimeType,
        imageBytes: input.imageBuffer.length,
      });
      const imageKey = buildImageKey(input.imageBuffer);
      const processed = await resizeForVision(input.imageBuffer);
      let focusCropBuffer: Buffer | null = null;
      let focusCropMime: "image/jpeg" | null = null;
      try {
        logger.info(
          {
            label: "VEHICLE_FOCUS_CROP_START",
            scanId,
            width: processed.width,
            height: processed.height,
          },
          "VEHICLE_FOCUS_CROP_START",
        );
        const focusCrop = await createVehicleFocusCrop(processed.buffer, {
          width: processed.width,
          height: processed.height,
        });
        focusCropBuffer = focusCrop.buffer;
        focusCropMime = "image/jpeg";
        logger.info(
          {
            label: "VEHICLE_FOCUS_CROP_CREATED",
            scanId,
            width: focusCrop.width,
            height: focusCrop.height,
            bytes: focusCrop.buffer.length,
          },
          "VEHICLE_FOCUS_CROP_CREATED",
        );
      } catch (error) {
        logger.warn(
          {
            label: "VEHICLE_FOCUS_CROP_FAILED",
            scanId,
            message: error instanceof Error ? error.message : "Unknown vehicle focus crop failure",
          },
          "VEHICLE_FOCUS_CROP_FAILED",
        );
      }
      const visualHash = await computeDhashHex(processed.buffer);
      logIdentifyStage("IMAGE_PROCESSING", "success", {
        scanId,
        userId: input.auth.userId,
        imageKey,
        visualHash,
        width: processed.width,
        height: processed.height,
      });
      logger.info(
        {
          scanId,
          userId: input.auth.userId,
          imageSourceType: "multipart-upload",
          multipartFilePresent: input.imageBuffer.length > 0,
          imageKey,
          visualHash,
          imageUrl: input.imageUrl,
        },
        "Starting vehicle identification from uploaded image",
      );

      let visionResult: VisionProviderResult;
      stage = "CACHE_LOOKUP";
      logIdentifyStage("CACHE_LOOKUP", "start", {
        scanId,
        userId: input.auth.userId,
        imageKey,
        visualHash,
      });
      if (premiumRequested && !usage.isPro && entitlementCheck.remainingUnlocks <= 0) {
        logger.error(
          {
            label: "SCAN_BLOCKED_REASON",
            scanId,
            userId: input.auth.userId,
            reason: "PREMIUM_UNLOCKS_EXHAUSTED_CACHED_ONLY",
          },
          "SCAN_BLOCKED_REASON",
        );
        const cachedOnly = await this.identifyFromCacheOnly({
          imageKey,
          visualHash,
          imageUrl: input.imageUrl,
        });
        if (!cachedOnly) {
          throw new AppError(403, "FREE_UNLOCKS_EXHAUSTED", "No free Pro unlocks remaining for premium analysis.");
        }
        visionResult = cachedOnly;
      } else {
        logger.info(
          {
            label: "SCAN_ALLOWED_BASIC_RESULT",
            scanId,
            userId: input.auth.userId,
            premiumRequested,
            path: "identifyWithCache",
          },
          "SCAN_ALLOWED_BASIC_RESULT",
        );
        visionResult = await this.identifyWithCache(scanId, {
          ...input,
          imageKey,
          processedBuffer: processed.buffer,
          processedMime: "image/jpeg",
          focusCropBuffer,
          focusCropMime,
          visualHash,
          width: processed.width,
          height: processed.height,
          onDegradedToLiveVision: () => {
            logger.warn(
              {
                label: "CACHE_LOOKUP_DEGRADED_TO_LIVE_VISION",
                scanId,
                userId: input.auth.userId,
                imageKey,
                multipartFilePresent: input.imageBuffer.length > 0,
              },
              "CACHE_LOOKUP_DEGRADED_TO_LIVE_VISION",
            );
            stage = "VISION_REQUEST";
          },
        });
      }
      logIdentifyStage("CACHE_LOOKUP", "success", {
        scanId,
        userId: input.auth.userId,
        provider: visionResult.provider,
      });
      logger.info(
        {
          scanId,
          userId: input.auth.userId,
          provider: visionResult.provider,
        },
        "Vision provider selected",
      );

      stage = "VEHICLE_MATCH";
      logIdentifyStage("VEHICLE_MATCH", "start", {
        scanId,
        userId: input.auth.userId,
      });
      let normalizedResult = applyYearClassification(
        await this.applyYearRefinement(normalizeVisionResult(visionResult.normalized), scanId),
        scanId,
      );
      if (visionResult.provider === "unknown_after_vision_failure") {
        logger.warn(
          {
            label: "SCAN_RESULT_UNKNOWN_AFTER_VISION_FAILURE",
            scanId,
            userId: input.auth.userId,
            provider: visionResult.provider,
            rawResponse: visionResult.rawResponse,
          },
          "SCAN_RESULT_UNKNOWN_AFTER_VISION_FAILURE",
        );

        const scanRecord: ScanRecord = {
          id: scanId,
          userId: input.auth.userId,
          imageUrl: input.imageUrl,
          detectedVehicleType: normalizedResult.vehicle_type,
          confidence: 0,
          createdAt: new Date().toISOString(),
          normalizedResult,
          candidates: [],
        };

        logIdentifyStage("VEHICLE_MATCH", "success", {
          scanId,
          userId: input.auth.userId,
          candidateCount: 0,
          unknownAfterVisionFailure: true,
        });

        stage = "SCAN_PERSIST";
        logIdentifyStage("SCAN_PERSIST", "start", {
          scanId,
          userId: input.auth.userId,
        });
        const persistedScan = await repositories.scans.create(scanRecord);
        logIdentifyStage("SCAN_PERSIST", "success", {
          scanId,
          userId: input.auth.userId,
          persistedScanId: persistedScan.id,
        });

        stage = "VISION_DEBUG_WRITE";
        logIdentifyStage("VISION_DEBUG_WRITE", "start", {
          scanId,
          userId: input.auth.userId,
        });
        await repositories.visionDebug.create({
          id: crypto.randomUUID(),
          scanId,
          userId: input.auth.userId,
          provider: visionResult.provider,
          rawResponse: visionResult.rawResponse,
          normalizedResult,
          createdAt: new Date().toISOString(),
        });
        logIdentifyStage("VISION_DEBUG_WRITE", "success", {
          scanId,
          userId: input.auth.userId,
        });

        stage = "USAGE_WRITE";
        logIdentifyStage("USAGE_WRITE", "start", {
          scanId,
          userId: input.auth.userId,
        });
        await this.usageService.incrementScanUsage(input.auth.userId);
        logIdentifyStage("USAGE_WRITE", "success", {
          scanId,
          userId: input.auth.userId,
        });

        return {
          scan: persistedScan,
          visionProvider: visionResult.provider,
          payloadPreview: {
            identificationConfidence: 0,
            dataConfidence: 0,
            payloadStrength: "empty",
            enrichmentMode: "fallback_only",
            unlockEligible: false,
            unlockRecommendationReason:
              "We couldn’t identify this vehicle from the photo. Try a clearer photo, a different angle, or a shot with the badge or VIN visible.",
            unknownAfterVisionFailure: true,
          },
        };
      }
      const enrichmentContext: ProviderEnrichmentContext = {
        scanId,
        allowScanProviderEnrichment: premiumRequested,
        providerAttempted: false,
        providerSkipped: false,
        providerRateLimited: false,
        providerAttemptCount: 0,
        canonicalHit: false,
        visibleBadgeText: normalizedResult.visible_badge_text,
        visibleMakeText: normalizedResult.visible_make_text,
        visibleModelText: normalizedResult.visible_model_text,
        visibleTrimText: normalizedResult.visible_trim_text,
        displayYearRange: normalizedResult.yearRange ?? null,
        yearConfidence: normalizedResult.yearConfidence ?? undefined,
        yearEvidence: normalizedResult.yearEvidence ?? undefined,
        popularityMatches: await repositories.vehicleScanPopularity.searchLikelyMatches({
          year: normalizedResult.likely_year,
          normalizedMake: normalizeMatchText(normalizedResult.likely_make),
          normalizedModel: normalizeModelFamily(normalizedResult.likely_model),
        }),
        trendingMatches: await repositories.vehicleGlobalTrending.searchLikelyMatches({
          year: normalizedResult.likely_year,
          normalizedMake: normalizeMatchText(normalizedResult.likely_make),
          normalizedModel: normalizeModelFamily(normalizedResult.likely_model),
        }),
      };
      const stabilityCacheHit = readScanStabilityCache({
        userId: input.auth.userId,
        visualHash,
      });
      const stabilityCacheNearMatch = stabilityCacheHit
        ? null
        : findScanStabilityNearMatch({
            userId: input.auth.userId,
            visualHash,
          });
      let matchedVehicles: MatchedVehicleCandidate[];
      let usedStabilityCache = false;
      const shouldBypassStabilityCache =
        Boolean(stabilityCacheHit) &&
        hasHardTextConfirmation(normalizedResult) &&
        buildCandidateSignature({
          year: normalizedResult.likely_year,
          make: normalizedResult.likely_make,
          model: normalizedResult.likely_model,
          trim: normalizedResult.likely_trim,
        }) !==
          buildCandidateSignature({
            year: stabilityCacheHit!.normalizedResult.likely_year,
            make: stabilityCacheHit!.normalizedResult.likely_make,
            model: stabilityCacheHit!.normalizedResult.likely_model,
            trim: stabilityCacheHit!.normalizedResult.likely_trim,
          });
      if (stabilityCacheNearMatch) {
        logger.error(
          {
            label: "SCAN_STABILITY_CACHE_SKIPPED_NEAR_MATCH",
            scanId,
            userId: input.auth.userId,
            visualHash,
            cachedVisualHash: stabilityCacheNearMatch.visualHash,
            cachedConfidence: stabilityCacheNearMatch.confidence,
            cachedNormalizedResult: stabilityCacheNearMatch.normalizedResult,
            cachedVehicleIds: stabilityCacheNearMatch.resolvedVehicles.map((vehicle) => vehicle.vehicleId),
          },
          "SCAN_STABILITY_CACHE_SKIPPED_NEAR_MATCH",
        );
      }
      if (stabilityCacheHit && stabilityCacheHit.confidence >= 0.8 && !shouldBypassStabilityCache) {
        usedStabilityCache = true;
        const currentNormalizedResult = normalizedResult;
        let cachedNormalizedResult = applyYearClassification(
          await this.applyYearRefinement(stabilityCacheHit.normalizedResult, scanId),
          scanId,
        );
        if (shouldPreserveCurrentOcrYearEvidence(currentNormalizedResult, cachedNormalizedResult)) {
          logger.info(
            {
              label: "STABILITY_CACHE_YEAR_EVIDENCE_DOWNGRADE_BLOCKED",
              scanId,
              beforeYear: cachedNormalizedResult.likely_year,
              preservedYear: currentNormalizedResult.likely_year,
              displayYearLabel: currentNormalizedResult.displayYearLabel ?? null,
              yearConfidence: currentNormalizedResult.yearConfidence ?? null,
              yearEvidence: currentNormalizedResult.yearEvidence ?? null,
            },
            "STABILITY_CACHE_YEAR_EVIDENCE_DOWNGRADE_BLOCKED",
          );
          cachedNormalizedResult = applyYearClassification(
            mergePreservedOcrYearEvidence(currentNormalizedResult, cachedNormalizedResult),
            scanId,
          );
          logger.info(
            {
              label: "OCR_YEAR_EVIDENCE_PRESERVED",
              scanId,
              year: cachedNormalizedResult.likely_year,
              make: cachedNormalizedResult.likely_make,
              model: cachedNormalizedResult.likely_model,
              displayYearLabel: cachedNormalizedResult.displayYearLabel ?? null,
              yearConfidence: cachedNormalizedResult.yearConfidence ?? null,
              yearEvidence: cachedNormalizedResult.yearEvidence ?? null,
            },
            "OCR_YEAR_EVIDENCE_PRESERVED",
          );
        }
        normalizedResult = cachedNormalizedResult;
        logger.info(
          {
            label: "SCAN_STABILITY_CACHE_HIT_EXACT",
            scanId,
            userId: input.auth.userId,
            visualHash,
            matchType: stabilityCacheHit.matchType,
            cachedVisualHash: stabilityCacheHit.visualHash,
            cachedConfidence: stabilityCacheHit.confidence,
            cachedNormalizedResult: stabilityCacheHit.normalizedResult,
            cachedVehicleIds: stabilityCacheHit.resolvedVehicles.map((vehicle) => vehicle.vehicleId),
          },
          "SCAN_STABILITY_CACHE_HIT_EXACT",
        );
        matchedVehicles = stabilityCacheHit.resolvedVehicles;
      } else {
        if (shouldBypassStabilityCache) {
          logger.error(
            {
              label: "SCAN_STABILITY_CACHE_BYPASSED_FOR_OCR",
              scanId,
              userId: input.auth.userId,
              visualHash,
              cachedResult: stabilityCacheHit?.normalizedResult,
              ocrConfirmedResult: normalizedResult,
            },
            "SCAN_STABILITY_CACHE_BYPASSED_FOR_OCR",
          );
        }
        logger.info(
          {
            label: "SCAN_FORCE_FRESH_IDENTIFY",
            scanId,
            userId: input.auth.userId,
            visualHash,
            reason: shouldBypassStabilityCache
              ? "ocr_confirmation_conflict"
              : stabilityCacheNearMatch
                ? "stability_near_match_requires_fresh_identify"
                : "no_exact_stability_cache_match",
          },
          "SCAN_FORCE_FRESH_IDENTIFY",
        );
        try {
          // Internal DB-only hint lookup is allowed here because it does not call providers,
          // does not block on external systems, and only nudges the normalized identity when safe.
          const clusterHint = await photoClusterService.findCanonicalIdentityHint({
            scanId,
            visualHash,
            normalizedResult,
          });
          if (clusterHint) {
            normalizedResult = normalizeVisionResult({
              ...normalizedResult,
              likely_year: clusterHint.year,
              likely_make: clusterHint.make,
              likely_model: clusterHint.model,
              likely_trim: clusterHint.trim ?? normalizedResult.likely_trim,
              confidence: Math.max(normalizedResult.confidence, clusterHint.confidence),
              source: normalizedResult.source === "ocr_override" ? "ocr_override" : "visual_override",
            });
            normalizedResult = applyYearClassification(
              await this.applyYearRefinement(normalizedResult, scanId),
              scanId,
            );
          }
        } catch (error) {
          logger.warn(
            {
              label: "PHOTO_CLUSTER_FAILURE",
              scanId,
              phase: "hint_lookup",
              operation: "findCanonicalIdentityHint",
              error: serializeScanError(error),
            },
            "PHOTO_CLUSTER_FAILURE",
          );
        }
        matchedVehicles = await this.resolveCatalogMatches(normalizedResult, enrichmentContext);
      }
      const resolvedVehiclesBeforeOcrLock =
        matchedVehicles.length > 0
          ? matchedVehicles
          : [
              this.buildOlderMercedesSlFallbackCandidate(normalizedResult) ??
                this.buildYearUncertainFallbackCandidate(normalizedResult) ?? {
                vehicleId: "",
                year: normalizedResult.likely_year,
                make: normalizedResult.likely_make,
                model: normalizedResult.likely_model,
                trim: normalizedResult.likely_trim ?? "",
                confidence: normalizedResult.confidence,
                matchReason: "Estimated match. Full catalog details are still being linked.",
              },
            ];
      const ocrLocked = enforceOcrResolvedPrimaryCandidate({
        normalizedResult,
        resolvedVehicles: resolvedVehiclesBeforeOcrLock,
      });
      if (ocrLocked.applied && normalizedResult.source !== "ocr_override") {
        normalizedResult = normalizeVisionResult({
          ...normalizedResult,
          source: "ocr_override",
        });
        normalizedResult = applyYearClassification(
          await this.applyYearRefinement(normalizedResult, scanId),
          scanId,
        );
      }
      const resolvedVehicles = ocrLocked.resolvedVehicles;
      const hasCanonicalVehicle = resolvedVehicles.some((vehicle) => Boolean(vehicle.vehicleId));

      if (!hasCanonicalVehicle) {
        logger.warn(
          {
            label: "VEHICLE_MATCH_FALLBACK_RESULT",
            scanId,
            userId: input.auth.userId,
            branch: "standard-scan-ai-fallback",
            normalizedResult,
          },
          "VEHICLE_MATCH_FALLBACK_RESULT",
        );
      }
      logger.info(
        {
          label: "VEHICLE_MATCH_FINAL_SUMMARY",
          scanId,
          userId: input.auth.userId,
          canonicalHit: enrichmentContext.canonicalHit,
          providerAttempted: enrichmentContext.providerAttempted,
          providerSkipped: enrichmentContext.providerSkipped,
          providerRateLimited: enrichmentContext.providerRateLimited,
          providerAttemptCount: enrichmentContext.providerAttemptCount,
          usedStabilityCache,
          finalResultType: hasCanonicalVehicle ? "canonical" : "ai_only",
        },
        "VEHICLE_MATCH_FINAL_SUMMARY",
      );
      const finalVisible = enforceFinalVisibleOcrCandidate({
        scanId,
        normalizedResult,
        candidates: resolvedVehicles,
        rawResponse: visionResult.rawResponse,
      });
      const lockedDisplayIdentity = buildLockedDisplayIdentity(finalVisible.normalizedResult);
      logger.info(
        {
          label: "DISPLAY_IDENTITY_LOCKED",
          scanId,
          lockedDisplayIdentity,
        },
        "DISPLAY_IDENTITY_LOCKED",
      );
      const displayLockedCandidates = preserveLockedDisplayIdentity({
        scanId,
        lockedDisplayIdentity,
        candidates: finalVisible.candidates,
        yearConfidence: finalVisible.normalizedResult.yearConfidence,
        yearEvidence: finalVisible.normalizedResult.yearEvidence,
        yearRange: finalVisible.normalizedResult.yearRange,
      });
      if (finalVisible.normalizedResult.yearConfidence && finalVisible.normalizedResult.yearConfidence !== "exact") {
        logger.info(
          {
            label: "YEAR_ESTIMATE_PRESERVED",
            scanId,
            likelyYear: finalVisible.normalizedResult.likely_year,
            yearConfidence: finalVisible.normalizedResult.yearConfidence,
            yearRange: finalVisible.normalizedResult.yearRange ?? null,
            preservedDisplayYear: displayLockedCandidates[0]?.year ?? finalVisible.normalizedResult.likely_year,
          },
          "YEAR_ESTIMATE_PRESERVED",
        );
      }
      logger.info(
        {
          label: "OCR_FINAL_RESULT",
          requestedPath: "/api/scan/identify",
          parsed:
            finalVisible.normalizedResult.source === "ocr_override"
              ? {
                  year: finalVisible.normalizedResult.likely_year,
                  make: finalVisible.normalizedResult.likely_make,
                  model: finalVisible.normalizedResult.likely_model,
                }
              : null,
          final: {
            year: displayLockedCandidates[0]?.year ?? finalVisible.normalizedResult.likely_year,
            make: displayLockedCandidates[0]?.make ?? finalVisible.normalizedResult.likely_make,
            model: displayLockedCandidates[0]?.model ?? finalVisible.normalizedResult.likely_model,
            source: finalVisible.normalizedResult.source ?? "visual_candidate",
            bestYear: finalVisible.normalizedResult.bestYear ?? finalVisible.normalizedResult.likely_year,
            yearConfidence: finalVisible.normalizedResult.yearConfidence ?? null,
            yearEvidence: finalVisible.normalizedResult.yearEvidence ?? null,
            exactYearConfirmed: finalVisible.normalizedResult.exactYearConfirmed ?? null,
            displayYearLabel: finalVisible.normalizedResult.displayYearLabel ?? null,
            yearRange: finalVisible.normalizedResult.yearRange ?? null,
            yearReasoning: finalVisible.normalizedResult.yearReasoning ?? null,
          },
          overrideApplied: ocrLocked.applied || finalVisible.applied,
          confirmationApplied: false,
          overwrittenLater: ocrLocked.overwrittenLater,
        },
        "OCR_FINAL_RESULT",
      );
      await this.trackVehiclePopularityAndPromotion({
        scanId,
        normalizedResult: finalVisible.normalizedResult,
        resolvedVehicles: displayLockedCandidates,
        hasCanonicalVehicle: displayLockedCandidates.some((vehicle) => Boolean(vehicle.vehicleId)),
      });
      writeScanStabilityCache({
        userId: input.auth.userId,
        visualHash,
        normalizedResult: finalVisible.normalizedResult,
        resolvedVehicles: displayLockedCandidates,
        confidence: displayLockedCandidates[0]?.confidence ?? finalVisible.normalizedResult.confidence,
        createdAt: Date.now(),
      });
      logger.info(
        {
          label: "SCAN_STABILITY_CACHE_WRITE",
          scanId,
          userId: input.auth.userId,
          visualHash,
          confidence: displayLockedCandidates[0]?.confidence ?? finalVisible.normalizedResult.confidence,
          vehicleIds: displayLockedCandidates.map((vehicle) => vehicle.vehicleId).filter((vehicleId) => Boolean(vehicleId)),
          finalResultType: displayLockedCandidates.some((vehicle) => Boolean(vehicle.vehicleId)) ? "canonical" : "ai_only",
        },
        "SCAN_STABILITY_CACHE_WRITE",
      );
      logIdentifyStage("VEHICLE_MATCH", "success", {
        scanId,
        userId: input.auth.userId,
        candidateCount: finalVisible.candidates.length,
      });

      const scanRecord: ScanRecord = {
        id: scanId,
        userId: input.auth.userId,
        imageUrl: input.imageUrl,
        detectedVehicleType: finalVisible.normalizedResult.vehicle_type,
        confidence: finalVisible.normalizedResult.confidence,
        createdAt: new Date().toISOString(),
        normalizedResult: finalVisible.normalizedResult,
        candidates: displayLockedCandidates,
      };
      const payloadPreview = await this.evaluateScanPayloadPreview({
        scanId,
        normalizedResult: finalVisible.normalizedResult,
        resolvedCandidates: displayLockedCandidates,
        allowLiveMarketData: premiumRequested,
      });
      const payloadPreviewFreeDisplaySpecs = payloadPreview.vehicle
        ? {
            sourceLabel: payloadPreview.sourceLabel ?? null,
            displayNote: (() => {
              if (
                normalizeMatchText(finalVisible.normalizedResult.likely_make) === "aston martin" &&
                normalizeMatchText(finalVisible.normalizedResult.likely_model) === "vantage" &&
                normalizeMatchText(payloadPreview.vehicle.model) === "v8 vantage"
              ) {
                return "Specs shown are for the likely V8 Vantage variant.";
              }
              if (payloadPreview.enrichmentMode !== "generation_fallback" || !finalVisible.normalizedResult.likely_model) {
                return null;
              }
              const generationLabel =
                buildGenerationFallbackDisplayLabel(finalVisible.normalizedResult) ??
                finalVisible.normalizedResult.displayYearLabel ??
                null;
              return generationLabel
                ? `Specs shown are generation-level estimates for the ${generationLabel} ${finalVisible.normalizedResult.likely_model}.`
                : "Specs shown are generation-level estimates for this vehicle family.";
            })(),
            sourceYear: payloadPreview.vehicle.year,
            engine: payloadPreview.vehicle.engine ?? null,
            horsepower: payloadPreview.vehicle.horsepower ?? null,
            drivetrain: payloadPreview.vehicle.drivetrain ?? null,
            transmission: payloadPreview.vehicle.transmission ?? null,
            bodyStyle: payloadPreview.vehicle.bodyStyle ?? null,
            fuelType: payloadPreview.vehicle.fuelType ?? null,
            msrp: payloadPreview.vehicle.msrp ?? null,
            freeSpecFieldCount: getFreeDisplaySpecFieldCount(payloadPreview.vehicle),
          }
        : null;
      await this.recordCanonicalGapIfNeeded({
        scanId,
        normalizedResult: finalVisible.normalizedResult,
        payloadPreview,
        canonicalHit: enrichmentContext.canonicalHit,
        finalResultType: displayLockedCandidates.some((vehicle) => Boolean(vehicle.vehicleId)) ? "canonical" : "ai_only",
      });
      this.recordCoverageMetrics({
        scanId,
        normalizedResult: finalVisible.normalizedResult,
        payloadPreview,
      });
      let entitlement: { usedUnlock: boolean; alreadyUnlocked: boolean; remainingUnlocks: number; isPro: boolean } | undefined;
      if (premiumRequested && !usage.isPro && displayLockedCandidates[0]) {
        const vehicle = payloadPreview.vehicle ?? (await resolveStoredVehicleRecordById(displayLockedCandidates[0].vehicleId));
        if (!payloadPreview.unlockEligible) {
          logger.warn(
            {
              label: "UNLOCK_BLOCKED",
              scanId,
              userId: input.auth.userId,
              payloadStrength: payloadPreview.payload.payloadStrength,
              enrichmentMode: payloadPreview.enrichmentMode,
              reason: payloadPreview.payload.unlockRecommendationReason,
            },
            "UNLOCK_BLOCKED",
          );
        } else if (vehicle) {
          const unlockResult = await this.unlockService.grantUnlockForVehicle({
            userId: input.auth.userId,
            vehicle,
            scanId,
            requested: true,
          });
          if (!unlockResult.allowed) {
            throw new AppError(403, "UNLOCK_NOT_ALLOWED", "Premium access is not available for this vehicle.");
          }
          logger.info(
            {
              label: "UNLOCK_ALLOWED",
              scanId,
              userId: input.auth.userId,
              payloadStrength: payloadPreview.payload.payloadStrength,
              enrichmentMode: payloadPreview.enrichmentMode,
            },
            "UNLOCK_ALLOWED",
          );
          entitlement = {
            usedUnlock: unlockResult.usedUnlock,
            alreadyUnlocked: unlockResult.alreadyUnlocked,
            remainingUnlocks: unlockResult.remainingUnlocks,
            isPro: unlockResult.isPro,
          };
        }
      } else if (usage.isPro) {
        entitlement = {
          usedUnlock: false,
          alreadyUnlocked: true,
          remainingUnlocks: Number.POSITIVE_INFINITY,
          isPro: true,
        };
      }

      stage = "SCAN_PERSIST";
      logIdentifyStage("SCAN_PERSIST", "start", {
        scanId,
        userId: input.auth.userId,
      });
      const persistedScan = await repositories.scans.create(scanRecord);
      logIdentifyStage("SCAN_PERSIST", "success", {
        scanId,
        userId: input.auth.userId,
        persistedScanId: persistedScan.id,
      });
      const selectedClusterVehicle =
        displayLockedCandidates.find((candidate) => Boolean(candidate.vehicleId)) ?? displayLockedCandidates[0] ?? null;
      // Photo clustering is intentionally fire-and-forget.
      // It must never delay scan responses, and any failure is isolated to logging only.
      void photoClusterService
        .recordScanPhotoCluster({
          scanId,
          userId: input.auth.userId,
          imageKey,
          imageUrl: input.imageUrl,
          visualHash,
          width: processed.width,
          height: processed.height,
          normalizedResult: finalVisible.normalizedResult,
          selectedVehicle: selectedClusterVehicle,
        })
        .catch((error) => {
          logger.warn(
            {
              label: "PHOTO_CLUSTER_FAILURE",
              scanId,
              phase: "record",
              operation: "recordScanPhotoCluster",
              error: serializeScanError(error),
            },
            "PHOTO_CLUSTER_FAILURE",
          );
        });

      stage = "VISION_DEBUG_WRITE";
      logIdentifyStage("VISION_DEBUG_WRITE", "start", {
        scanId,
        userId: input.auth.userId,
      });
      await repositories.visionDebug.create({
        id: crypto.randomUUID(),
        scanId,
        userId: input.auth.userId,
        provider: visionResult.provider,
        rawResponse: visionResult.rawResponse,
        normalizedResult,
        createdAt: new Date().toISOString(),
      });
      logIdentifyStage("VISION_DEBUG_WRITE", "success", {
        scanId,
        userId: input.auth.userId,
      });

      stage = "USAGE_WRITE";
      logIdentifyStage("USAGE_WRITE", "start", {
        scanId,
        userId: input.auth.userId,
      });
      await this.usageService.incrementScanUsage(input.auth.userId);
      logIdentifyStage("USAGE_WRITE", "success", {
        scanId,
        userId: input.auth.userId,
      });

      return {
        scan: persistedScan,
        visionProvider: visionResult.provider,
        entitlement,
        payloadPreview: {
          identificationConfidence: finalVisible.normalizedResult.confidence,
          dataConfidence: payloadPreview.payload.dataConfidence,
          payloadStrength: payloadPreview.payload.payloadStrength,
          enrichmentMode: payloadPreview.enrichmentMode,
          unlockEligible: payloadPreview.unlockEligible,
          unlockRecommendationReason: payloadPreview.payload.unlockRecommendationReason,
          freeDisplaySpecs: payloadPreviewFreeDisplaySpecs,
          unknownAfterVisionFailure: false,
        },
      };
    } catch (error) {
      const serialized = serializeScanError(error);
      logger.error(
        {
          label: "IDENTIFY_PIPELINE_ERROR",
          scanId,
          stage,
          userId: input.auth.userId,
          imageUrl: input.imageUrl,
          ...serialized,
        },
        "IDENTIFY_PIPELINE_ERROR",
      );

      if (error instanceof AppError) {
        if (error.statusCode >= 500) {
          throw new AppError(
            error.statusCode,
            error.code,
            stageFailureMessage(stage),
            {
              stage,
              originalMessage: error.message,
              originalDetails: error.details,
            },
          );
        }
        throw error;
      }

      throw new AppError(500, "IDENTIFY_PIPELINE_FAILED", stageFailureMessage(stage), {
        stage,
        originalMessage: serialized.message,
      });
    }
  }

  private async identifyWithCache(
    scanId: string,
    input: {
      auth: AuthContext;
      imageBuffer: Buffer;
      mimeType: string;
      imageUrl: string;
      imageKey: string;
      processedBuffer: Buffer;
      processedMime: string;
      focusCropBuffer?: Buffer | null;
      focusCropMime?: string | null;
      visualHash: string;
      width: number;
      height: number;
      onDegradedToLiveVision?: () => void;
    },
  ): Promise<VisionProviderResult> {
    let degradedToLiveVision = false;
    const markDegradedToLiveVision = () => {
      if (degradedToLiveVision) return;
      degradedToLiveVision = true;
      input.onDegradedToLiveVision?.();
    };
    // Pipeline order: image key -> visual hash -> cached analysis -> OpenAI.
    const analysisKey = buildAnalysisKey({
      analysisType: "vision_identify",
      identityType: "image_key",
      identityValue: input.imageKey,
      promptVersion: "v1",
      modelName: env.OPENAI_VISION_MODEL,
    });

    const cachedImage = await this.tryFindImageCacheEntry(input.imageKey, {
      scanId,
      source: "primary-image-key",
      imageUrl: input.imageUrl,
      multipartFilePresent: input.imageBuffer.length > 0,
    });
    if (cachedImage?.normalizedVehicleJson) {
      await this.tryMarkImageCacheAccess(input.imageKey, {
        scanId,
        source: "primary-image-key",
      });
      const baseNormalized = normalizeVisionResult(cachedImage.normalizedVehicleJson as VisionResult);
      const { normalized } = await this.applyGoogleOcrEvidence({
        scanId,
        normalized: baseNormalized,
        imageBuffer: input.processedBuffer,
        mimeType: input.processedMime,
      });
      return {
        normalized,
        rawResponse: { source: "image_cache", imageKey: input.imageKey, ocr: cachedImage.ocrJson ?? null },
        provider: "cache:image",
      };
    }

    const similarImage = await this.tryFindSimilarImageByHash(input.visualHash, {
      scanId,
      source: "similar-image-hash",
      imageKey: input.imageKey,
    });
    if (similarImage?.normalizedVehicleJson) {
      logger.info(
        {
          label: "SCAN_FORCE_FRESH_IDENTIFY",
          scanId,
          visualHash: input.visualHash,
          imageKey: input.imageKey,
          nearMatchImageKey: similarImage.imageKey,
          reason: "similar_image_hash_requires_fresh_identify",
        },
        "SCAN_FORCE_FRESH_IDENTIFY",
      );
    }

    const cachedAnalysis = await this.tryFindAnalysisCacheEntry(analysisKey, {
      scanId,
      source: "analysis-key",
      imageKey: input.imageKey,
    });
    if (cachedAnalysis?.status === "completed" && cachedAnalysis.resultJson) {
      await this.tryMarkAnalysisCacheAccess(analysisKey, {
        scanId,
        source: "analysis-key",
      });
      const baseNormalized = normalizeVisionResult(cachedAnalysis.resultJson as VisionResult);
      const { normalized } = await this.applyGoogleOcrEvidence({
        scanId,
        normalized: baseNormalized,
        imageBuffer: input.processedBuffer,
        mimeType: input.processedMime,
      });
      return {
        normalized,
        rawResponse: { source: "analysis_cache", analysisKey },
        provider: "cache:analysis",
      };
    }

    if (cachedAnalysis?.status === "processing") {
      const waited = await this.tryWaitForAnalysisCache(analysisKey, {
        scanId,
        source: "analysis-wait",
      });
      if (waited?.status === "completed" && waited.resultJson) {
        await this.tryMarkAnalysisCacheAccess(analysisKey, {
          scanId,
          source: "analysis-wait",
        });
        const baseNormalized = normalizeVisionResult(waited.resultJson as VisionResult);
        const { normalized } = await this.applyGoogleOcrEvidence({
          scanId,
          normalized: baseNormalized,
          imageBuffer: input.processedBuffer,
          mimeType: input.processedMime,
        });
        return {
          normalized,
          rawResponse: { source: "analysis_cache_wait", analysisKey },
          provider: "cache:analysis_wait",
        };
      }
    }

    const inserted = await this.tryBeginAnalysisProcessing(
      {
        analysisKey,
        analysisType: "vision_identify",
        identityType: "image_key",
        identityValue: input.imageKey,
        imageKey: input.imageKey,
        visualHash: input.visualHash,
        promptVersion: "v1",
        modelName: env.OPENAI_VISION_MODEL,
        costEstimate: null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        scanId,
        source: "analysis-begin",
      },
    );

    if (!inserted) {
      const waited = await this.tryWaitForAnalysisCache(analysisKey, {
        scanId,
        source: "analysis-begin-wait",
      });
      if (waited?.status === "completed" && waited.resultJson) {
        await this.tryMarkAnalysisCacheAccess(analysisKey, {
          scanId,
          source: "analysis-begin-wait",
        });
        const baseNormalized = normalizeVisionResult(waited.resultJson as VisionResult);
        const { normalized } = await this.applyGoogleOcrEvidence({
          scanId,
          normalized: baseNormalized,
          imageBuffer: input.processedBuffer,
          mimeType: input.processedMime,
        });
        return {
          normalized,
          rawResponse: { source: "analysis_cache_wait", analysisKey },
          provider: "cache:analysis_wait",
        };
      }
      logger.warn(
        {
          scanId,
          analysisKey,
          imageKey: input.imageKey,
        },
        "Analysis cache unavailable or already processing; continuing to live vision provider",
      );
    }

    try {
      markDegradedToLiveVision();
      logger.info(
        {
          label: "LIVE_VISION_REQUEST_START",
          scanId,
          userId: input.auth.userId,
          imageKey: input.imageKey,
          imageSourceType: "multipart-upload",
          multipartFilePresent: input.imageBuffer.length > 0,
        },
        "LIVE_VISION_REQUEST_START",
      );
      const result = await providers.visionProvider.identifyFromImage({
        imageBuffer: input.processedBuffer,
        mimeType: input.processedMime,
        fileName: input.imageUrl.split("/").pop(),
        focusCropBuffer: input.focusCropBuffer,
        focusCropMimeType: input.focusCropMime,
      });
      logIdentifyStage("VISION_REQUEST", "success", {
        scanId,
        userId: input.auth.userId,
        provider: result.provider,
      });
      const baseNormalized = normalizeVisionResult(result.normalized);
      const shouldApplyStandaloneGoogleOcr = result.provider !== "ensemble" && result.provider !== "google";
      const { normalized, ocrResult } = shouldApplyStandaloneGoogleOcr
        ? await this.applyGoogleOcrEvidence({
            scanId,
            normalized: baseNormalized,
            imageBuffer: input.processedBuffer,
            mimeType: input.processedMime,
          })
        : { normalized: baseNormalized, ocrResult: null as GoogleVisionOcrResult | null };
      if (normalized.confidence < 0.7) {
        logger.warn(
          {
            label: "LOW_CONFIDENCE_IDENTIFICATION",
            scanId,
            provider: result.provider,
            year: normalized.likely_year,
            make: normalized.likely_make,
            model: normalized.likely_model,
            confidence: normalized.confidence,
          },
          "LOW_CONFIDENCE_IDENTIFICATION",
        );
      }
      const vehicleKey = buildVehicleKey({
        year: normalized.likely_year,
        make: normalized.likely_make,
        model: normalized.likely_model,
        trim: normalized.likely_trim,
        vehicleType: normalized.vehicle_type,
      });

      await this.tryCompleteAnalysisCache(
        analysisKey,
        normalized,
        {
          costEstimate: null,
          vehicleKey,
          imageKey: input.imageKey,
          visualHash: input.visualHash,
        },
        {
          scanId,
          source: "analysis-complete",
        },
      );
      await this.tryUpsertImageCache(
        {
          id: cachedImage?.id ?? crypto.randomUUID(),
          imageKey: input.imageKey,
          visualHash: input.visualHash,
          fileWidth: input.width,
          fileHeight: input.height,
          normalizedVehicleJson: normalized,
          ocrJson: ocrResult,
          extractionJson: normalized,
          createdAt: cachedImage?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          hitCount: cachedImage?.hitCount ?? 0,
        },
        {
          scanId,
          source: "primary-upload-result",
        },
      );
      return { ...result, normalized, rawResponse: { providerRaw: result.rawResponse, ocr: ocrResult } };
    } catch (error) {
      markDegradedToLiveVision();
      logger.warn(
        {
          scanId,
          userId: input.auth.userId,
          provider: providers.visionProvider.constructor?.name ?? "primary",
          error: error instanceof Error ? error.message : "Unknown vision provider error.",
          errorCode: error instanceof AppError ? error.code : undefined,
        },
        "Vision provider failed, falling back",
      );
      await this.tryFailAnalysisCache(
        analysisKey,
        error instanceof Error ? error.message : "Unknown vision provider error.",
        {
          scanId,
          source: "analysis-fail",
        },
      );
      const rawFailureResponse =
        error instanceof AppError && error.details && typeof error.details === "object"
          ? error.details
          : null;

      try {
        await repositories.visionDebug.create({
          id: crypto.randomUUID(),
          scanId,
          userId: input.auth.userId,
          provider: "primary-failure",
          rawResponse: rawFailureResponse,
          error: error instanceof Error ? error.message : "Unknown vision provider error.",
          createdAt: new Date().toISOString(),
        });
      } catch (debugError) {
        logger.warn(
          {
            scanId,
            userId: input.auth.userId,
            error: debugError instanceof Error ? debugError.message : "Unknown debug persistence error.",
          },
          "Skipping pre-scan vision debug persistence after provider failure",
        );
      }

      const forcedMode = providerBudgetService.getForcedMode();
      if (!env.ALLOW_MOCK_FALLBACKS || forcedMode === "live") {
        logger.warn(
          {
            label: "LIVE_VISION_REFUSAL_NO_MOCK_FALLBACK",
            scanId,
            userId: input.auth.userId,
            forcedMode,
            provider: providers.visionProvider.constructor?.name ?? "primary",
            error: error instanceof Error ? error.message : "Unknown vision provider error.",
            errorCode: error instanceof AppError ? error.code : undefined,
          },
          "LIVE_VISION_REFUSAL_NO_MOCK_FALLBACK",
        );
        return buildUnknownVisionFailureProviderResult(error);
      }

      logger.error(
        {
          label: "IDENTIFY_STAGE",
          stage: "VISION_REQUEST",
          event: "success",
          scanId,
          userId: input.auth.userId,
          provider: "fallback",
        },
        "IDENTIFY_STAGE",
      );
      return providers.fallbackVisionProvider.identifyFromImage({
        imageBuffer: input.processedBuffer,
        mimeType: input.processedMime,
        fileName: input.imageUrl.split("/").pop(),
        focusCropBuffer: input.focusCropBuffer,
        focusCropMimeType: input.focusCropMime,
      });
    }
  }

  private async resolveCatalogMatches(result: VisionResult, context: ProviderEnrichmentContext): Promise<MatchedVehicleCandidate[]> {
    const normalizedTextEvidence = normalizeVisibleTextEvidence(result);
    const textConfidence = normalizedTextEvidence.text_confidence;
    const lockedDisplayIdentity = buildLockedDisplayIdentity(result);
    const visibleYearEvidence = extractVisibleYearEvidence(
      result.visible_badge_text,
      result.visible_make_text,
      result.visible_model_text,
      result.visible_trim_text,
      result.visible_clues,
    );
    logger.info(
      {
        label: "VISIBLE_TEXT_EVIDENCE_EXTRACTED",
        scanId: context.scanId,
        visibleTextEvidence: normalizedTextEvidence,
        visibleBadgeText: result.visible_badge_text ?? null,
        visibleMakeText: result.visible_make_text ?? null,
        visibleModelText: result.visible_model_text ?? null,
        visibleTrimText: result.visible_trim_text ?? null,
        visibleYearEvidence,
        emblemLogoClues: result.emblem_logo_clues ?? [],
      },
      "VISIBLE_TEXT_EVIDENCE_EXTRACTED",
    );
    logger.info(
      {
        label: "VEHICLE_MATCH_INPUT",
        rawAiOutput: result,
        normalizedMatchFields: {
          year: result.likely_year,
          make: result.likely_make,
          model: result.likely_model,
          trim: result.likely_trim ?? null,
          vehicleType: result.vehicle_type,
          confidence: result.confidence,
        },
      },
      "VEHICLE_MATCH_INPUT",
    );
    const normalizeCandidateBoundary = (candidate: {
      year: number;
      make: string;
      model: string;
      trim?: string;
      confidence: number;
    }) => {
      const normalizedMercedesSl = normalizeMercedesSlFamilyCandidate({
        make: candidate.make,
        model: candidate.model,
        trim: candidate.trim,
        badgeText: result.visible_badge_text,
        modelText: result.visible_model_text,
      });
      return {
        ...candidate,
        make: normalizedMercedesSl.make,
        model: normalizedMercedesSl.model,
        trim: normalizedMercedesSl.trim,
      };
    };

    const normalizeCandidateWithEvidence = (candidate: {
      year: number;
      make: string;
      model: string;
      trim?: string;
      confidence: number;
    }) => {
      candidate = normalizeCandidateBoundary(candidate);
      let nextConfidence = candidate.confidence;
      const mercedesSlBadgeTrim = extractMercedesSlBadgeTrim(
        result.visible_badge_text,
        result.visible_trim_text,
        result.likely_trim,
        result.likely_model,
      );
      const candidatePopularityKey = buildPopularityKey({
        year: candidate.year,
        make: candidate.make,
        model: candidate.model,
        trim: candidate.trim,
      });
      const contradictoryModel = contradictsEvidence(candidate.model, result.visible_model_text ?? result.visible_badge_text);
      const contradictoryMake = contradictsEvidence(candidate.make, result.visible_make_text);
      const trimEvidenceMatch = hasEvidenceTokenMatch(candidate.trim, result.visible_trim_text ?? result.visible_badge_text);
      const modelEvidenceMatch = hasEvidenceTokenMatch(candidate.model, result.visible_model_text ?? result.visible_badge_text);
      const makeEvidenceMatch = hasEvidenceTokenMatch(candidate.make, result.visible_make_text);
      if (contradictoryModel || contradictoryMake) {
        nextConfidence = Math.max(0.05, nextConfidence - 0.4);
        logger.info(
          {
            label: "OCR_CANDIDATE_REJECTED_TEXT_CONFLICT",
            scanId: context.scanId,
            candidate,
            contradictoryModel,
            contradictoryMake,
            adjustedConfidence: nextConfidence,
          },
          "OCR_CANDIDATE_REJECTED_TEXT_CONFLICT",
        );
      } else if (modelEvidenceMatch || makeEvidenceMatch || trimEvidenceMatch) {
        const evidenceBoost = (modelEvidenceMatch ? 0.24 : 0) + (makeEvidenceMatch ? 0.14 : 0) + (trimEvidenceMatch ? 0.1 : 0);
        nextConfidence = Math.min(0.995, nextConfidence + evidenceBoost);
        if (trimEvidenceMatch) {
          logger.info(
            {
              label: "OCR_TRIM_BOOST_APPLIED",
              scanId: context.scanId,
              candidate,
              trimEvidence: normalizedTextEvidence.trim_text ?? normalizedTextEvidence.badge_text,
              adjustedConfidence: nextConfidence,
            },
            "OCR_TRIM_BOOST_APPLIED",
          );
        }
      }
      if (
        mercedesSlBadgeTrim &&
        isMercedesSlFamilyCandidate(candidate) &&
        normalizeMatchText(candidate.trim) === normalizeMatchText(mercedesSlBadgeTrim)
      ) {
        nextConfidence = Math.min(0.998, nextConfidence + 0.12);
      }
      if (typeof visibleYearEvidence === "number") {
        if (candidate.year === visibleYearEvidence) {
          nextConfidence = Math.min(0.999, nextConfidence + 0.3);
        } else if (Math.abs(candidate.year - visibleYearEvidence) > 1) {
          nextConfidence = Math.max(0.05, nextConfidence - 0.22);
        }
      }
      const popularityMatch = context.popularityMatches?.find((entry) => entry.normalizedKey === candidatePopularityKey);
      if (popularityMatch) {
        nextConfidence = Math.min(0.995, nextConfidence + Math.min(0.08, popularityMatch.scanCount * 0.01));
        logger.info(
          {
            label: "POPULARITY_RANKING_BOOST_APPLIED",
            scanId: context.scanId,
            candidate,
            normalizedKey: candidatePopularityKey,
            scanCount: popularityMatch.scanCount,
            adjustedConfidence: nextConfidence,
          },
          "POPULARITY_RANKING_BOOST_APPLIED",
        );
      }
      const trendingMatch = context.trendingMatches?.find((entry) => entry.normalizedKey === candidatePopularityKey);
      if (trendingMatch) {
        nextConfidence = Math.min(0.998, nextConfidence + Math.min(0.06, trendingMatch.trendScore * 0.002));
        logger.info(
          {
            label: "TRENDING_MATCH_BOOST_APPLIED",
            scanId: context.scanId,
            candidate,
            normalizedKey: candidatePopularityKey,
            trendScore: trendingMatch.trendScore,
            adjustedConfidence: nextConfidence,
          },
          "TRENDING_MATCH_BOOST_APPLIED",
        );
      }
      return { ...candidate, confidence: nextConfidence };
    };

    const primaryCandidate = normalizeCandidateWithEvidence({
      year: result.likely_year,
      make: result.likely_make,
      model: result.likely_model,
      trim: result.likely_trim,
      confidence: result.confidence,
    });
    const visibleTextDominantCandidate =
      (Boolean(normalizedTextEvidence.make_text) || Boolean(normalizedTextEvidence.model_text ?? normalizedTextEvidence.badge_text[0]) || typeof visibleYearEvidence === "number")
        ? normalizeCandidateWithEvidence({
            year: visibleYearEvidence ?? result.likely_year,
            make: normalizedTextEvidence.make_text ?? result.likely_make,
            model: normalizedTextEvidence.model_text ?? result.likely_model,
            trim: normalizedTextEvidence.trim_text ?? normalizedTextEvidence.badge_text[0] ?? result.likely_trim,
            confidence:
              typeof visibleYearEvidence === "number"
                ? 0.997
                : Math.max(0.985, textConfidence),
          })
        : null;
    const visibleYearCandidate =
      typeof visibleYearEvidence === "number" &&
      visibleYearEvidence !== result.likely_year
        ? normalizeCandidateWithEvidence({
            year: visibleYearEvidence,
            make: normalizedTextEvidence.make_text ?? result.likely_make,
            model: normalizedTextEvidence.model_text ?? result.likely_model,
            trim: normalizedTextEvidence.trim_text ?? result.likely_trim,
            confidence: 0.994,
          })
        : null;

    const baseCandidates = [
      primaryCandidate,
      visibleTextDominantCandidate,
      visibleYearCandidate,
      ...result.alternate_candidates.map((candidate) => ({
        year: candidate.likely_year,
        make: candidate.likely_make,
        model: candidate.likely_model,
        trim: candidate.likely_trim,
        confidence: candidate.confidence,
      })).map(normalizeCandidateWithEvidence),
    ]
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
      .filter((candidate, index, array) => {
        const signature = buildCandidateSignature(candidate);
        return array.findIndex((entry) => buildCandidateSignature(entry) === signature) === index;
      });

    const visibleModelFamily = normalizeModelFamily(normalizedTextEvidence.model_text ?? normalizedTextEvidence.badge_text[0] ?? result.visible_model_text ?? result.visible_badge_text);
    const visibleMakeFamily = normalizeMatchText(normalizedTextEvidence.make_text ?? result.visible_make_text);
    let candidates = baseCandidates;
    const shouldApplyHardModelFilter = Boolean(visibleModelFamily) && textConfidence >= 0.75;
    const shouldApplyHardMakeFilter = Boolean(visibleMakeFamily) && textConfidence >= 0.75;
    if (shouldApplyHardModelFilter || shouldApplyHardMakeFilter) {
        const filteredCandidates = baseCandidates.filter((candidate) => {
          const candidateModelFamily = normalizeModelFamily(candidate.model);
          const candidateMake = normalizeMatchText(candidate.make);
          const makeMatches = !shouldApplyHardMakeFilter || candidateMake === visibleMakeFamily;
          const modelMatches =
            !shouldApplyHardModelFilter ||
            (Boolean(candidateModelFamily) &&
              (candidateModelFamily.includes(visibleModelFamily) ||
                visibleModelFamily.includes(candidateModelFamily)));
        const keep = makeMatches && modelMatches;
        if (!keep) {
          logger.info(
            {
              label: "OCR_CANDIDATE_REJECTED_TEXT_CONFLICT",
              scanId: context.scanId,
              candidate,
              visibleMakeText: normalizedTextEvidence.make_text ?? result.visible_make_text ?? null,
              visibleModelText: normalizedTextEvidence.model_text ?? normalizedTextEvidence.badge_text[0] ?? result.visible_model_text ?? result.visible_badge_text ?? null,
              makeMatches,
              modelMatches,
            },
            "OCR_CANDIDATE_REJECTED_TEXT_CONFLICT",
          );
        }
        return keep;
      });

      if (filteredCandidates.length > 0) {
        candidates = filteredCandidates;
        if (shouldApplyHardMakeFilter) {
          logger.info(
            {
              label: "OCR_MAKE_HARD_FILTER_APPLIED",
              scanId: context.scanId,
              visibleMakeText: normalizedTextEvidence.make_text ?? null,
              originalCandidateCount: baseCandidates.length,
              filteredCandidateCount: filteredCandidates.length,
            },
            "OCR_MAKE_HARD_FILTER_APPLIED",
          );
        }
        if (shouldApplyHardModelFilter) {
          logger.info(
            {
              label: "OCR_MODEL_HARD_FILTER_APPLIED",
              scanId: context.scanId,
              visibleModelText: normalizedTextEvidence.model_text ?? normalizedTextEvidence.badge_text[0] ?? null,
              originalCandidateCount: baseCandidates.length,
              filteredCandidateCount: filteredCandidates.length,
            },
            "OCR_MODEL_HARD_FILTER_APPLIED",
          );
        }
        Object.assign(
          result,
          normalizeVisionResult({
            ...result,
            likely_make: normalizedTextEvidence.make_text ?? result.likely_make,
            likely_model: normalizedTextEvidence.model_text ?? result.likely_model,
            likely_trim: normalizedTextEvidence.trim_text ?? result.likely_trim,
            confidence: Math.max(result.confidence, textConfidence),
            source: "ocr_override",
            textDominanceApplied: true,
            matchEvidence: {
              source: "badge_text",
              readableText: [...normalizedTextEvidence.raw_text, ...normalizedTextEvidence.badge_text].filter(Boolean),
            },
          }),
        );
      } else {
        logger.warn(
          {
            label: "OCR_HARD_FILTER_NO_MATCH_AI_TEXT_RESULT",
            scanId: context.scanId,
            visibleMakeText: normalizedTextEvidence.make_text ?? null,
            visibleModelText: normalizedTextEvidence.model_text ?? normalizedTextEvidence.badge_text[0] ?? null,
            originalCandidateCount: baseCandidates.length,
          },
          "OCR_HARD_FILTER_NO_MATCH_AI_TEXT_RESULT",
        );
        const aiTextResult = normalizeVisionResult({
          ...result,
          likely_year: visibleYearEvidence ?? result.likely_year,
          likely_make: normalizedTextEvidence.make_text ?? result.likely_make,
          likely_model: normalizedTextEvidence.model_text ?? result.likely_model,
          likely_trim: normalizedTextEvidence.trim_text ?? normalizedTextEvidence.badge_text[0] ?? result.likely_trim,
          confidence: Math.max(result.confidence, textConfidence, 0.92),
          source: "ocr_override",
          textDominanceApplied: true,
          matchEvidence: {
            source: "badge_text",
            readableText: [...normalizedTextEvidence.raw_text, ...normalizedTextEvidence.badge_text].filter(Boolean),
          },
        });
        Object.assign(result, aiTextResult);
        return [
          {
            vehicleId: "",
            year: aiTextResult.likely_year,
            make: aiTextResult.likely_make,
            model: aiTextResult.likely_model,
            trim: aiTextResult.likely_trim ?? "",
            confidence: Math.max(aiTextResult.confidence, textConfidence),
            matchReason: "Matched using visible badge text.",
          },
        ];
      }
    }

    candidates = candidates.map(normalizeCandidateBoundary);
    for (const candidate of candidates) {
      logMercedesSlStage({
        label: "MERCEDES_SL_POST_BADGE_FILTER",
        scanId: context.scanId,
        year: candidate.year,
        make: candidate.make,
        model: candidate.model,
        trim: candidate.trim ?? null,
        visibleBadgeText: result.visible_badge_text ?? null,
        visibleModelText: result.visible_model_text ?? null,
        canonicalKey: buildCanonicalKey({
          year: candidate.year,
          make: candidate.make,
          model: candidate.model,
          trim: candidate.trim,
        }),
      });
    }

    candidates = await this.preferMercedesSlCanonicalYearCandidate({
      candidates,
      result,
      context,
    });

    logger.info(
      {
        label: "IDENTIFY_RESULT_TEXT_DOMINANCE_DECISION",
        scanId: context.scanId,
        primaryCandidate,
        alternateCandidates: candidates.slice(1),
        visibleModelText: normalizedTextEvidence.model_text ?? null,
        visibleBadgeText: normalizedTextEvidence.badge_text ?? null,
        textConfidence,
        textDominanceApplied: result.textDominanceApplied ?? false,
      },
      "IDENTIFY_RESULT_TEXT_DOMINANCE_DECISION",
    );

    const matched: MatchedVehicleCandidate[] = [];

    for (const [index, candidate] of candidates.entries()) {
      const allowProviderEnrichment = index === 0;
      const matches = await this.findVehicleMatches(candidate, context, allowProviderEnrichment);
      matched.push(...matches);
      if (matches.length > 0) {
        break;
      }
      if (context.providerRateLimited) {
        logger.warn(
          {
            label: "PROVIDER_ENRICH_SKIPPED_AFTER_429",
            scanId: context.scanId,
            skippedAlternateCandidates: candidates.slice(index + 1).map((entry) => ({
              year: entry.year,
              make: entry.make,
              model: entry.model,
              trim: entry.trim ?? null,
              confidence: entry.confidence,
            })),
          },
          "PROVIDER_ENRICH_SKIPPED_AFTER_429",
        );
        break;
      }
    }

    const uniqueMatches = matched
      .filter((entry, index, array) => array.findIndex((item) => item.vehicleId === entry.vehicleId) === index)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    const compatibleMatches = uniqueMatches.filter((entry) => {
      const decision = classifyCanonicalIdentityDecision(lockedDisplayIdentity, entry);
      if (decision === "rejected_identity_mismatch") {
        logger.warn(
          {
            label: "CANONICAL_IDENTITY_REJECTED",
            scanId: context.scanId,
            lockedDisplayIdentity,
            canonicalCandidate: entry,
            reason: "resolve-catalog-matches-filter",
          },
          "CANONICAL_IDENTITY_REJECTED",
        );
        return false;
      }
      return true;
    });

    if (compatibleMatches.length > 0) {
      logger.info(
        {
          label: "VEHICLE_MATCH_SELECTED",
          selectedCount: compatibleMatches.length,
          selectedVehicleIds: compatibleMatches.map((entry) => entry.vehicleId),
          selectedVehicles: compatibleMatches.map((entry) => ({
            vehicleId: entry.vehicleId,
            year: entry.year,
            make: entry.make,
            model: entry.model,
            trim: entry.trim,
            confidence: entry.confidence,
          })),
        },
        "VEHICLE_MATCH_SELECTED",
      );
      return compatibleMatches;
    }
    return [];
  }

  private async trackVehiclePopularityAndPromotion(input: {
    scanId: string;
    normalizedResult: VisionResult;
    resolvedVehicles: MatchedVehicleCandidate[];
    hasCanonicalVehicle: boolean;
  }) {
    const rawPrimary = input.resolvedVehicles[0];
    if (!rawPrimary) {
      return;
    }
    const normalizedPrimaryIdentity = normalizeMercedesSlFamilyCandidate({
      make: rawPrimary.make,
      model: rawPrimary.model,
      trim: rawPrimary.trim,
      badgeText: input.normalizedResult.visible_badge_text,
      modelText: input.normalizedResult.visible_model_text,
    });
    const primary = {
      ...rawPrimary,
      make: normalizedPrimaryIdentity.make,
      model: normalizedPrimaryIdentity.model,
      trim: normalizedPrimaryIdentity.trim ?? rawPrimary.trim,
    };

    const normalizedKey = buildPopularityKey({
      year: primary.year,
      make: primary.make,
      model: primary.model,
      trim: primary.trim,
    });
    const popularity = await repositories.vehicleScanPopularity.increment({
      normalizedKey,
      year: primary.year,
      normalizedMake: normalizeMatchText(primary.make),
      normalizedModel: normalizeModelFamily(primary.model),
      normalizedTrim: normalizeModelFamily(primary.trim || "base") || "base",
      lastSeenAt: new Date().toISOString(),
    });
    logger.info(
      {
        label: "VEHICLE_POPULARITY_INCREMENTED",
        scanId: input.scanId,
        normalizedKey,
        scanCount: popularity.scanCount,
        hasCanonicalVehicle: input.hasCanonicalVehicle,
      },
      "VEHICLE_POPULARITY_INCREMENTED",
    );

    if (input.hasCanonicalVehicle) {
      return;
    }

    if (input.normalizedResult.confidence < 0.85) {
      logger.error(
        {
          label: "CANONICAL_PROMOTION_SKIPPED_LOW_CONFIDENCE",
          scanId: input.scanId,
          normalizedKey,
          confidence: input.normalizedResult.confidence,
          threshold: 0.85,
          scanCount: popularity.scanCount,
        },
        "CANONICAL_PROMOTION_SKIPPED_LOW_CONFIDENCE",
      );
      return;
    }

    if (popularity.scanCount < AUTO_PROMOTION_THRESHOLD) {
      return;
    }

    const conflictRows = await repositories.vehicleScanPopularity.findConflicts({
      year: primary.year,
      normalizedMake: normalizeMatchText(primary.make),
      normalizedModel: normalizeModelFamily(primary.model),
      normalizedTrim: normalizeModelFamily(primary.trim || "base") || "base",
      minScanCount: Math.max(2, AUTO_PROMOTION_THRESHOLD - 1),
    });
    if (conflictRows.length > 0) {
      logger.error(
        {
          label: "CANONICAL_PROMOTION_CONFLICT_DETECTED",
          scanId: input.scanId,
          normalizedKey,
          conflicts: conflictRows.map((row) => ({
            normalizedKey: row.normalizedKey,
            scanCount: row.scanCount,
            normalizedModel: row.normalizedModel,
          })),
        },
        "CANONICAL_PROMOTION_CONFLICT_DETECTED",
      );
      return;
    }

    const canonical = await upsertCanonicalVehicleFromAiLearned({
      year: primary.year,
      make: primary.make,
      model: primary.model,
      trim: primary.trim,
      vehicleType: input.normalizedResult.vehicle_type,
    });
    logger.error(
      {
        label: "CANONICAL_AUTO_PROMOTED",
        scanId: input.scanId,
        normalizedKey,
        canonicalId: canonical.id,
        scanCount: popularity.scanCount,
        source: "ai_learned",
      },
      "CANONICAL_AUTO_PROMOTED",
    );
    logger.error(
      {
        label: "CANONICAL_BACKGROUND_ENRICH_QUEUED",
        scanId: input.scanId,
        normalizedKey,
        canonicalId: canonical.id,
        source: "ai_learned",
      },
      "CANONICAL_BACKGROUND_ENRICH_QUEUED",
    );
  }

  private buildCanonicalMatchedCandidate(input: {
    vehicleId: string;
    vehicle: VehicleRecord;
    confidence: number;
    matchReason: string;
  }): MatchedVehicleCandidate {
    return {
      vehicleId: input.vehicleId,
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
      trim: input.vehicle.trim,
      confidence: input.confidence,
      matchReason: input.matchReason,
    };
  }

  private markProviderShortCircuit(context: ProviderEnrichmentContext, candidate: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    confidence: number;
  }, branch: string, error: unknown) {
    context.providerRateLimited = true;
    context.providerSkipped = true;
    logger.warn(
      {
        label: "PROVIDER_RATE_LIMIT_SHORT_CIRCUIT",
        scanId: context.scanId,
        branch,
        candidate,
        providerAttemptCount: context.providerAttemptCount,
        message: error instanceof Error ? error.message : "Provider rate limited",
        code: error instanceof AppError ? error.code : undefined,
        details: error instanceof AppError ? error.details : undefined,
      },
      "PROVIDER_RATE_LIMIT_SHORT_CIRCUIT",
    );
  }

  private shouldSkipProviderEnrichment(context: ProviderEnrichmentContext, candidate: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    confidence: number;
  }) {
    if (context.providerRateLimited || context.providerAttemptCount >= MAX_PROVIDER_CALLS_PER_SCAN) {
      context.providerSkipped = true;
      logger.warn(
        {
          label: "PROVIDER_ENRICH_SKIPPED_AFTER_429",
          scanId: context.scanId,
          candidate,
          providerRateLimited: context.providerRateLimited,
          providerAttemptCount: context.providerAttemptCount,
        },
        "PROVIDER_ENRICH_SKIPPED_AFTER_429",
      );
      return true;
    }
    return false;
  }

  private async findVehicleMatches(candidate: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    confidence: number;
  }, context: ProviderEnrichmentContext, allowProviderEnrichment: boolean): Promise<MatchedVehicleCandidate[]> {
    let didLogLiveCanonicalMissProviderRescueDecision = false;
    const normalizedMercedesSlCandidate = normalizeMercedesSlFamilyCandidate({
      make: candidate.make,
      model: candidate.model,
      trim: candidate.trim,
      badgeText: context.visibleBadgeText,
      modelText: context.visibleModelText,
    });
    if (
      normalizeMatchText(candidate.make) === "mercedes benz" &&
      normalizeMatchText(candidate.model).match(/^sl[\s-]?(320|500|600)$/)
    ) {
      logger.warn(
        {
          label: "MERCEDES_SL_BAD_RUNTIME_MODEL",
          scanId: context.scanId,
          rawCandidate: candidate,
          normalizedCandidate: {
            year: candidate.year,
            make: normalizedMercedesSlCandidate.make,
            model: normalizedMercedesSlCandidate.model,
            trim: normalizedMercedesSlCandidate.trim ?? null,
            confidence: candidate.confidence,
          },
        },
        "MERCEDES_SL_BAD_RUNTIME_MODEL",
      );
    }
    candidate = {
      ...candidate,
      make: normalizedMercedesSlCandidate.make,
      model: normalizedMercedesSlCandidate.model,
      trim: normalizedMercedesSlCandidate.trim,
    };
    const logStrategy = (
      strategy: string,
      vehicles: Array<VehicleRecord | MatchedVehicleCandidate | { id: string; year: number; make: string; model: string; trim?: string | null }>,
      extra: Record<string, unknown> = {},
    ) => {
      const sampleIds = vehicles.slice(0, 5).map((vehicle) => ("vehicleId" in vehicle ? vehicle.vehicleId : vehicle.id));
      logger.info(
        {
          label: "VEHICLE_MATCH_STRATEGY",
          strategy,
          candidate,
          candidateCount: vehicles.length,
          sampleVehicleIds: sampleIds,
          ...extra,
        },
        "VEHICLE_MATCH_STRATEGY",
      );
      logger.info(
        {
          label: "VEHICLE_MATCH_CANDIDATE_COUNT",
          strategy,
          count: vehicles.length,
          candidate,
        },
        "VEHICLE_MATCH_CANDIDATE_COUNT",
      );
    };

    const normalizedMake = normalizeMatchText(candidate.make);
    const normalizedModel = normalizeMatchText(candidate.model);
    const normalizedTrim = stripTrimTokens(candidate.trim ?? "");
    const exactCanonicalKey = buildCanonicalKey({
      year: candidate.year,
      make: candidate.make,
      model: candidate.model,
      trim: candidate.trim,
    });
    logMercedesSlStage({
      label: "MERCEDES_SL_PRE_CANONICAL_LOOKUP",
      scanId: context.scanId,
      year: candidate.year,
      make: candidate.make,
      model: candidate.model,
      trim: candidate.trim ?? null,
      visibleBadgeText: context.visibleBadgeText ?? null,
      visibleModelText: context.visibleModelText ?? null,
      canonicalKey: exactCanonicalKey,
    });
    logger.info(
      {
        label: "CANONICAL_LOOKUP_START",
        canonicalKey: exactCanonicalKey,
        candidate,
      },
      "CANONICAL_LOOKUP_START",
    );

    const exactCanonical = await repositories.canonicalVehicles.findByCanonicalKey(exactCanonicalKey);
    if (exactCanonical) {
      context.canonicalHit = true;
      logger.info(
        {
          label: "CANONICAL_CACHE_HIT",
          canonicalKey: exactCanonicalKey,
          source: "exact-key",
          canonicalId: exactCanonical.id,
          candidate,
        },
        "CANONICAL_CACHE_HIT",
      );
      const exactCanonicalVehicle = mapCanonicalVehicleToRecord(exactCanonical);
      logStrategy("canonical-exact-key", exactCanonicalVehicle ? [exactCanonical] : [], {
        canonicalKey: exactCanonicalKey,
      });
      if (exactCanonicalVehicle) {
        logger.info(
          {
            label: "CANONICAL_LOOKUP_HIT",
            canonicalKey: exactCanonicalKey,
            canonicalId: exactCanonical.id,
            source: "exact-key",
          },
          "CANONICAL_LOOKUP_HIT",
        );
        await repositories.canonicalVehicles.incrementPopularity(exactCanonical.canonicalKey);
        return [
          this.buildCanonicalMatchedCandidate({
            vehicleId: exactCanonical.id,
            vehicle: exactCanonicalVehicle,
            confidence: candidate.confidence,
            matchReason: `Matched canonical catalog key for ${exactCanonical.year} ${exactCanonical.make} ${exactCanonical.model}.`,
          }),
        ];
      }
    } else {
      logger.info(
        {
          label: "CANONICAL_CACHE_MISS",
          canonicalKey: exactCanonicalKey,
          source: "exact-key",
          candidate,
        },
        "CANONICAL_CACHE_MISS",
      );
      logger.info(
        {
          label: "CANONICAL_LOOKUP_MISS",
          canonicalKey: exactCanonicalKey,
          source: "exact-key",
        },
        "CANONICAL_LOOKUP_MISS",
      );
      logger.info(
        {
          label: "CANONICAL_LOOKUP_EXACT_MISS",
          year: candidate.year,
          make: candidate.make,
          model: candidate.model,
          normalizedKey: exactCanonicalKey,
          source: "exact-key",
        },
        "CANONICAL_LOOKUP_EXACT_MISS",
      );
      logStrategy("canonical-exact-key", [], { canonicalKey: exactCanonicalKey });
    }

    const shouldTryTrimRelaxedCanonicalLookup =
      Boolean(candidate.trim && normalizeLookupText(candidate.trim) !== "base");
    if (shouldTryTrimRelaxedCanonicalLookup) {
      const baseCanonicalKey = buildCanonicalKey({
        year: candidate.year,
        make: candidate.make,
        model: candidate.model,
        trim: "base",
      });
      logger.info(
        {
          label: "CANONICAL_TRIM_RELAXED_LOOKUP_START",
          exactCanonicalKey,
          relaxedCanonicalKey: baseCanonicalKey,
          candidate,
        },
        "CANONICAL_TRIM_RELAXED_LOOKUP_START",
      );
      const relaxedCanonical = await repositories.canonicalVehicles.findByCanonicalKey(baseCanonicalKey);
      if (relaxedCanonical) {
        context.canonicalHit = true;
        logger.info(
          {
            label: "CANONICAL_TRIM_RELAXED_LOOKUP_HIT",
            exactCanonicalKey,
            relaxedCanonicalKey: baseCanonicalKey,
            canonicalId: relaxedCanonical.id,
            candidate,
          },
          "CANONICAL_TRIM_RELAXED_LOOKUP_HIT",
        );
        const relaxedCanonicalVehicle = mapCanonicalVehicleToRecord(relaxedCanonical);
        logStrategy("canonical-trim-relaxed-key", relaxedCanonicalVehicle ? [relaxedCanonical] : [], {
          exactCanonicalKey,
          relaxedCanonicalKey: baseCanonicalKey,
        });
        if (relaxedCanonicalVehicle) {
          logger.info(
            {
              label: "CANONICAL_LOOKUP_HIT",
              canonicalKey: baseCanonicalKey,
              canonicalId: relaxedCanonical.id,
              source: "trim-relaxed-base-key",
            },
            "CANONICAL_LOOKUP_HIT",
          );
          await repositories.canonicalVehicles.incrementPopularity(relaxedCanonical.canonicalKey);
          return [
            this.buildCanonicalMatchedCandidate({
              vehicleId: relaxedCanonical.id,
              vehicle: relaxedCanonicalVehicle,
              confidence: candidate.confidence,
              matchReason: `Matched trim-relaxed canonical base key for ${relaxedCanonical.year} ${relaxedCanonical.make} ${relaxedCanonical.model}.`,
            }),
          ];
        }
      } else {
        logger.info(
          {
            label: "CANONICAL_TRIM_RELAXED_LOOKUP_MISS",
            exactCanonicalKey,
            relaxedCanonicalKey: baseCanonicalKey,
            candidate,
          },
          "CANONICAL_TRIM_RELAXED_LOOKUP_MISS",
        );
        logStrategy("canonical-trim-relaxed-key", [], {
          exactCanonicalKey,
          relaxedCanonicalKey: baseCanonicalKey,
        });
      }
    }

    const canonicalCandidates = await repositories.canonicalVehicles.searchPromoted({
      year: candidate.year,
      normalizedMake: normalizeLookupText(candidate.make),
      normalizedModel: shouldBroadenCanonicalLookupModelSearch({
        make: candidate.make,
        model: candidate.model,
        trim: candidate.trim ?? null,
        badgeText: context.visibleBadgeText ?? null,
        modelText: context.visibleModelText ?? null,
      })
        ? undefined
        : normalizeLookupText(candidate.model),
    });
    logStrategy("canonical-make-slice", canonicalCandidates, {
      normalizedMake,
      normalizedModel,
    });
    if (canonicalCandidates.length > 0) {
      context.canonicalHit = true;
      logger.info(
        {
          label: "CANONICAL_CACHE_HIT",
          canonicalKey: exactCanonicalKey,
          source: "promoted-search",
          candidateCount: canonicalCandidates.length,
          candidate,
        },
        "CANONICAL_CACHE_HIT",
      );
      logger.info(
        {
          label: "CANONICAL_LOOKUP_HIT",
          canonicalKey: exactCanonicalKey,
          source: "promoted-search",
          candidateCount: canonicalCandidates.length,
        },
        "CANONICAL_LOOKUP_HIT",
      );
    } else {
      logger.info(
        {
          label: "CANONICAL_CACHE_MISS",
          canonicalKey: exactCanonicalKey,
          source: "promoted-search",
          candidate,
        },
        "CANONICAL_CACHE_MISS",
      );
      logger.info(
        {
          label: "CANONICAL_LOOKUP_MISS",
          canonicalKey: exactCanonicalKey,
          source: "promoted-search",
          candidateCount: 0,
        },
        "CANONICAL_LOOKUP_MISS",
      );
    }

    const exactCanonicalMatches = canonicalCandidates.filter((record) => {
      const vehicle = mapCanonicalVehicleToRecord(record);
      if (!vehicle) return false;
      return (
        vehicle.year === candidate.year &&
        isAllowedAstonMartinVantageCanonicalModel({
          requestedMake: candidate.make,
          requestedModel: candidate.model,
          candidateModel: vehicle.model,
          trim: candidate.trim,
          visibleBadgeText: context.visibleBadgeText,
          visibleModelText: context.visibleModelText,
        }) &&
        matchesCanonicalLookupModel({
          make: candidate.make,
          model: candidate.model,
          trim: candidate.trim ?? null,
          badgeText: context.visibleBadgeText ?? null,
          modelText: context.visibleModelText ?? null,
          candidateModel: vehicle.model,
        })
      );
    }).sort((left, right) => {
      const leftVehicle = mapCanonicalVehicleToRecord(left);
      const rightVehicle = mapCanonicalVehicleToRecord(right);
      const leftScore = getAstonMartinVantageCanonicalPreferenceScore({
        requestedMake: candidate.make,
        requestedModel: candidate.model,
        candidateModel: leftVehicle?.model ?? null,
        trim: candidate.trim,
        visibleBadgeText: context.visibleBadgeText,
        visibleModelText: context.visibleModelText,
      });
      const rightScore = getAstonMartinVantageCanonicalPreferenceScore({
        requestedMake: candidate.make,
        requestedModel: candidate.model,
        candidateModel: rightVehicle?.model ?? null,
        trim: candidate.trim,
        visibleBadgeText: context.visibleBadgeText,
        visibleModelText: context.visibleModelText,
      });
      return leftScore - rightScore || right.popularityScore - left.popularityScore;
    });
    if (
      exactCanonicalMatches.length > 1 &&
      isMercedesSlFamilyCandidate(candidate) &&
      !candidate.trim &&
      !hasMercedesSlContradictoryBadge({
        visibleBadgeText: context.visibleBadgeText,
        visibleTrimText: context.visibleTrimText,
        candidateTrim: candidate.trim,
      })
    ) {
      exactCanonicalMatches.sort((left, right) => {
        const trimRank = preferredMercedesSlTrimRank(left.trim) - preferredMercedesSlTrimRank(right.trim);
        if (trimRank !== 0) {
          return trimRank;
        }
        return right.popularityScore - left.popularityScore;
      });
    }
    logStrategy("canonical-exact-year-make-model", exactCanonicalMatches);
    if (exactCanonicalMatches.length > 0) {
      context.canonicalHit = true;
      return exactCanonicalMatches
        .map((record) => {
          const vehicle = mapCanonicalVehicleToRecord(record);
          return vehicle
            ? this.buildCanonicalMatchedCandidate({
                vehicleId: record.id,
                vehicle,
                confidence: candidate.confidence,
                matchReason: `Matched canonical ${vehicle.year} ${vehicle.make} ${vehicle.model}.`,
              })
            : null;
        })
        .filter((entry): entry is MatchedVehicleCandidate => entry !== null);
    }

    const displayYearRange = context.displayYearRange ?? null;
    const rangeCanonicalMatches =
      displayYearRange && (displayYearRange.end - displayYearRange.start >= 1)
        ? canonicalCandidates.filter((record) => {
            const vehicle = mapCanonicalVehicleToRecord(record);
            if (!vehicle) {
              return false;
            }
            return (
              normalizeMatchText(vehicle.make) === normalizedMake &&
              isAllowedAstonMartinVantageCanonicalModel({
                requestedMake: candidate.make,
                requestedModel: candidate.model,
                candidateModel: vehicle.model,
                trim: candidate.trim,
                visibleBadgeText: context.visibleBadgeText,
                visibleModelText: context.visibleModelText,
              }) &&
              matchesCanonicalLookupModel({
                make: candidate.make,
                model: candidate.model,
                trim: candidate.trim ?? null,
                badgeText: context.visibleBadgeText ?? null,
                modelText: context.visibleModelText ?? null,
                candidateModel: vehicle.model,
              }) &&
              vehicle.year >= displayYearRange.start &&
              vehicle.year <= displayYearRange.end
            );
          })
        : [];
    logStrategy("canonical-display-range", rangeCanonicalMatches, {
      normalizedMake,
      normalizedModel,
      displayYearRange,
    });
    if (rangeCanonicalMatches.length > 0) {
      const sortedRangeMatches = rangeCanonicalMatches
        .slice()
        .sort(
          (left, right) =>
            getAstonMartinVantageCanonicalPreferenceScore({
              requestedMake: candidate.make,
              requestedModel: candidate.model,
              candidateModel: left.model,
              trim: candidate.trim,
              visibleBadgeText: context.visibleBadgeText,
              visibleModelText: context.visibleModelText,
            }) -
              getAstonMartinVantageCanonicalPreferenceScore({
                requestedMake: candidate.make,
                requestedModel: candidate.model,
                candidateModel: right.model,
                trim: candidate.trim,
                visibleBadgeText: context.visibleBadgeText,
                visibleModelText: context.visibleModelText,
              }) ||
            Math.abs(left.year - candidate.year) - Math.abs(right.year - candidate.year) ||
            right.popularityScore - left.popularityScore,
        );
      const selectedRange = sortedRangeMatches[0];
      const selectedRangeVehicle = mapCanonicalVehicleToRecord(selectedRange);
      if (selectedRangeVehicle) {
        context.canonicalHit = true;
        logger.info(
          {
            label: "CANONICAL_LOOKUP_RANGE_HIT",
            year: selectedRange.year,
            make: selectedRange.make,
            model: selectedRange.model,
            normalizedKey: selectedRange.canonicalKey,
            source: "display-year-range",
            displayYearRange,
          },
          "CANONICAL_LOOKUP_RANGE_HIT",
        );
        return [
          this.buildCanonicalMatchedCandidate({
            vehicleId: selectedRange.id,
            vehicle: selectedRangeVehicle,
            confidence: candidate.confidence,
            matchReason: `Matched canonical ${selectedRange.year} ${selectedRange.make} ${selectedRange.model} within the identified display year range.`,
          }),
        ];
      }
    }

    const generationCanonicalMatches =
      displayYearRange && (displayYearRange.end - displayYearRange.start >= 1)
        ? (await repositories.canonicalVehicles.searchPromoted({
            normalizedMake: normalizedMake,
            normalizedModel: shouldBroadenCanonicalLookupModelSearch({
              make: candidate.make,
              model: candidate.model,
              trim: candidate.trim ?? null,
              badgeText: context.visibleBadgeText ?? null,
              modelText: context.visibleModelText ?? null,
            })
              ? undefined
              : normalizedModel,
          })).filter(
            (record) =>
              record.year >= displayYearRange.start &&
              record.year <= displayYearRange.end &&
              normalizeMatchText(record.make) === normalizedMake &&
              isAllowedAstonMartinVantageCanonicalModel({
                requestedMake: candidate.make,
                requestedModel: candidate.model,
                candidateModel: record.model,
                trim: candidate.trim,
                visibleBadgeText: context.visibleBadgeText,
                visibleModelText: context.visibleModelText,
              }) &&
              matchesCanonicalLookupModel({
                make: candidate.make,
                model: candidate.model,
                trim: candidate.trim ?? null,
                badgeText: context.visibleBadgeText ?? null,
                modelText: context.visibleModelText ?? null,
                candidateModel: record.model,
              }),
          )
        : [];
    logStrategy("canonical-generation-range", generationCanonicalMatches, {
      normalizedMake,
      normalizedModel,
      displayYearRange,
    });
    if (generationCanonicalMatches.length > 0) {
      const sortedGenerationMatches = generationCanonicalMatches
        .slice()
        .sort(
          (left, right) =>
            getAstonMartinVantageCanonicalPreferenceScore({
              requestedMake: candidate.make,
              requestedModel: candidate.model,
              candidateModel: left.model,
              trim: candidate.trim,
              visibleBadgeText: context.visibleBadgeText,
              visibleModelText: context.visibleModelText,
            }) -
              getAstonMartinVantageCanonicalPreferenceScore({
                requestedMake: candidate.make,
                requestedModel: candidate.model,
                candidateModel: right.model,
                trim: candidate.trim,
                visibleBadgeText: context.visibleBadgeText,
                visibleModelText: context.visibleModelText,
              }) ||
            Math.abs(left.year - candidate.year) - Math.abs(right.year - candidate.year) ||
            right.popularityScore - left.popularityScore,
        );
      const selectedGeneration = sortedGenerationMatches[0];
      const selectedGenerationVehicle = mapCanonicalVehicleToRecord(selectedGeneration);
      if (selectedGenerationVehicle) {
        context.canonicalHit = true;
        logger.info(
          {
            label: "CANONICAL_LOOKUP_GENERATION_HIT",
            year: selectedGeneration.year,
            make: selectedGeneration.make,
            model: selectedGeneration.model,
            normalizedKey: selectedGeneration.canonicalKey,
            source: "generation-range",
            displayYearRange,
          },
          "CANONICAL_LOOKUP_GENERATION_HIT",
        );
        return [
          this.buildCanonicalMatchedCandidate({
            vehicleId: selectedGeneration.id,
            vehicle: selectedGenerationVehicle,
            confidence: candidate.confidence,
            matchReason: `Matched canonical ${selectedGeneration.year} ${selectedGeneration.make} ${selectedGeneration.model} from the identified generation range.`,
          }),
        ];
      }
    }

    if (
      isMercedesSlFamilyCandidate(candidate) &&
      !candidate.trim &&
      !hasMercedesSlContradictoryBadge({
        visibleBadgeText: context.visibleBadgeText,
        visibleTrimText: context.visibleTrimText,
        candidateTrim: candidate.trim,
      })
    ) {
      const visibleMercedesBadgeTrim = extractMercedesSlBadgeTrim(
        context.visibleBadgeText,
        context.visibleTrimText,
        null,
        context.visibleModelText,
      );
      const sameYearMercedesSlCandidates = canonicalCandidates
        .filter((record) => {
          if (record.year !== candidate.year || normalizeLookupText(record.model) !== "sl-class") {
            return false;
          }
          if (visibleMercedesBadgeTrim) {
            return normalizeLookupText(record.trim) === normalizeLookupText(visibleMercedesBadgeTrim);
          }
          return true;
        })
        .sort((left, right) => {
          const trimRank = preferredMercedesSlTrimRank(left.trim) - preferredMercedesSlTrimRank(right.trim);
          if (trimRank !== 0) {
            return trimRank;
          }
          return right.popularityScore - left.popularityScore;
        });
      logStrategy("canonical-mercedes-sl-no-trim-fallback", sameYearMercedesSlCandidates, {
        visibleBadgeText: context.visibleBadgeText ?? null,
        visibleTrimText: context.visibleTrimText ?? null,
        visibleMercedesBadgeTrim: visibleMercedesBadgeTrim ?? null,
      });
      if (sameYearMercedesSlCandidates.length > 0) {
        context.canonicalHit = true;
        return sameYearMercedesSlCandidates
          .map((record) => {
            const vehicle = mapCanonicalVehicleToRecord(record);
            return vehicle
              ? this.buildCanonicalMatchedCandidate({
                  vehicleId: record.id,
                  vehicle,
                  confidence: candidate.confidence,
                  matchReason: `Matched canonical Mercedes SL-Class fallback ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim ?? ""}`.trim(),
                })
              : null;
          })
          .filter((entry): entry is MatchedVehicleCandidate => entry !== null);
      }
    }

    const normalizedCandidateMake = normalizedMake;
    const normalizedCandidateModel = normalizedModel;
    const strippedCandidateModel = stripTrimTokens(candidate.model);
    const candidateModelFamily = buildModelFamily(candidate.model);
    const candidateTokens = tokenizeMatchText(candidate.model);
    const visibleModelEvidence = context.visibleModelText ?? context.visibleBadgeText;
    const visibleMakeEvidence = context.visibleMakeText;
    const visibleTrimEvidence = context.visibleTrimText;
    const visibleYearEvidence = extractVisibleYearEvidence(
      context.visibleBadgeText,
      context.visibleMakeText,
      context.visibleModelText,
      context.visibleTrimText,
    );

    const canonicalRankedMatches = canonicalCandidates
      .map((record) => {
        const vehicle = mapCanonicalVehicleToRecord(record);
        if (!vehicle) return null;
        if (displayYearRange && !isYearWithinInclusiveRange(vehicle.year, displayYearRange)) {
          logger.warn(
            {
              label: "CANONICAL_LOOKUP_DISTANCE_REJECTED",
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              normalizedKey: record.canonicalKey,
              source: "canonical-ranked-fallback",
              allowedYearRange: displayYearRange,
            },
            "CANONICAL_LOOKUP_DISTANCE_REJECTED",
          );
          return null;
        }
        if (
          !isSafeModelCompatibility(
            {
              year: candidate.year,
              make: candidate.make,
              model: candidate.model,
              trim: candidate.trim ?? null,
              confidence: candidate.confidence,
              visibleBadgeText: context.visibleBadgeText ?? null,
              visibleMakeText: context.visibleMakeText ?? null,
              visibleModelText: context.visibleModelText ?? null,
              visibleTrimText: context.visibleTrimText ?? null,
            },
            {
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              trim: vehicle.trim,
            },
          )
        ) {
          return null;
        }
        const vehicleModel = normalizeMatchText(vehicle.model);
        const vehicleFamily = buildModelFamily(vehicle.model);
        const vehicleTokens = tokenizeMatchText(vehicle.model);
        const overlapScore = getTokenOverlapScore(candidateTokens, vehicleTokens);
        const yearDistance = Math.abs(vehicle.year - candidate.year);
        if (yearDistance > 0) {
          return null;
        }

        let score = 0;
        const badgeModelMatch = hasEvidenceTokenMatch(vehicle.model, candidate.model) && hasEvidenceTokenMatch(vehicle.model, visibleModelEvidence);
        const badgeTrimMatch = hasEvidenceTokenMatch(vehicle.trim, visibleTrimEvidence);
        const makeEvidenceMatch = hasEvidenceTokenMatch(vehicle.make, visibleMakeEvidence);
        if (vehicleModel === normalizedCandidateModel) score += 100;
        else if (normalizedCandidateModel && (vehicleModel.includes(normalizedCandidateModel) || normalizedCandidateModel.includes(vehicleModel))) score += 85;
        else if (candidateModelFamily && vehicleFamily === candidateModelFamily) score += 70;
        else if (strippedCandidateModel) {
          const strippedVehicleModel = stripTrimTokens(vehicle.model);
          if (strippedVehicleModel && (strippedVehicleModel === strippedCandidateModel || strippedVehicleModel.includes(strippedCandidateModel) || strippedCandidateModel.includes(strippedVehicleModel))) {
            score += 65;
          }
        }

        if (normalizedTrim && record.normalizedTrim && record.normalizedTrim.includes(normalizedTrim)) {
          score += 10;
        }

        const popularityMatch = context.popularityMatches?.find(
          (entry) =>
            entry.year === vehicle.year &&
            entry.normalizedMake === normalizeMatchText(vehicle.make) &&
            entry.normalizedModel === normalizeModelFamily(vehicle.model),
        );
        if (popularityMatch) {
          const popularityBoost = Math.min(30, popularityMatch.scanCount * 2);
          score += popularityBoost;
          logger.info(
            {
              label: "POPULARITY_RANKING_BOOST_APPLIED",
              scanId: context.scanId,
              candidate,
              vehicleId: record.id,
              normalizedKey: popularityMatch.normalizedKey,
              scanCount: popularityMatch.scanCount,
              boost: popularityBoost,
            },
            "POPULARITY_RANKING_BOOST_APPLIED",
          );
        }
        const trendingMatch = context.trendingMatches?.find(
          (entry) =>
            entry.year === vehicle.year &&
            entry.normalizedMake === normalizeMatchText(vehicle.make) &&
            entry.normalizedModel === normalizeModelFamily(vehicle.model),
        );
        if (trendingMatch) {
          const trendBoost = Math.min(24, trendingMatch.trendScore * 0.4);
          score += trendBoost;
          logger.info(
            {
              label: "TRENDING_MATCH_BOOST_APPLIED",
              scanId: context.scanId,
              candidate,
              vehicleId: record.id,
              normalizedKey: trendingMatch.normalizedKey,
              trendScore: trendingMatch.trendScore,
              boost: trendBoost,
            },
            "TRENDING_MATCH_BOOST_APPLIED",
          );
        }

        if (badgeModelMatch || makeEvidenceMatch || badgeTrimMatch) {
          const boost = (badgeModelMatch ? 52 : 0) + (makeEvidenceMatch ? 24 : 0) + (badgeTrimMatch ? 18 : 0);
          score += boost;
          logger.info(
            {
              label: "BADGE_MATCH_BOOST_APPLIED",
              scanId: context.scanId,
              candidate,
              vehicleId: record.id,
              badgeModelMatch,
              makeEvidenceMatch,
              badgeTrimMatch,
              boost,
            },
            "BADGE_MATCH_BOOST_APPLIED",
          );
        }

        if (
          contradictsEvidence(vehicle.model, visibleModelEvidence) ||
          contradictsEvidence(vehicle.make, visibleMakeEvidence)
        ) {
          score -= 72;
          logger.error(
            {
              label: "CANDIDATE_CONTRADICTS_VISIBLE_TEXT",
              scanId: context.scanId,
              candidate,
              vehicleId: record.id,
              vehicleMake: vehicle.make,
              vehicleModel: vehicle.model,
            },
            "CANDIDATE_CONTRADICTS_VISIBLE_TEXT",
          );
        }

        score += Math.round(overlapScore * 40);
        if (typeof visibleYearEvidence === "number" && vehicle.year === visibleYearEvidence) score += 28;
        else if (typeof visibleYearEvidence === "number" && Math.abs(vehicle.year - visibleYearEvidence) > 1) score -= 18;
        if (yearDistance === 0) score += 20;
        else if (yearDistance === 1) score += 12;
        else if (yearDistance === 2) score += 8;
        else if (yearDistance === 3) score += 4;

        return { record, vehicle, score, yearDistance };
      })
      .filter((entry): entry is { record: NonNullable<typeof entry>["record"]; vehicle: VehicleRecord; score: number; yearDistance: number } => entry !== null && entry.score >= 45)
      .sort((left, right) => right.score - left.score || left.yearDistance - right.yearDistance)
      .slice(0, 5);

    logStrategy("canonical-ranked-fallback", canonicalRankedMatches.map((entry) => entry.record), {
      normalizedCandidateModel,
      strippedCandidateModel,
      candidateModelFamily,
    });
    if (canonicalRankedMatches.length > 0) {
      context.canonicalHit = true;
      const selected = canonicalRankedMatches.map((entry) =>
        this.buildCanonicalMatchedCandidate({
          vehicleId: entry.record.id,
          vehicle: entry.vehicle,
          confidence: candidate.confidence,
          matchReason: `Matched canonical fallback ${entry.vehicle.year} ${entry.vehicle.make} ${entry.vehicle.model}.`,
        }),
      );
      logger.info(
        {
          label: "CANONICAL_SELECTED",
          source: "canonical-ranked-fallback",
          selectedVehicleIds: selected.map((entry) => entry.vehicleId),
        },
        "CANONICAL_SELECTED",
      );
      return selected;
    }

    if (!allowProviderEnrichment) {
      didLogLiveCanonicalMissProviderRescueDecision = true;
      logLiveCanonicalMissProviderRescueDecision({
        scanId: context.scanId,
        candidate,
        forcedMode: providerBudgetService.getForcedMode(),
        confidence: candidate.confidence,
        isPrimaryCandidate: false,
        providerRateLimited: context.providerRateLimited,
        bootstrapInitialIdentify: !context.allowScanProviderEnrichment,
        canonicalMiss: true,
        allowRescue: false,
        reason: "alternate_candidate",
      });
      logger.info(
        {
          label: "PROVIDER_ENRICH_PRIMARY_ONLY",
          scanId: context.scanId,
          candidate,
          decision: "alternate-candidate-skip-provider",
        },
        "PROVIDER_ENRICH_PRIMARY_ONLY",
      );
      return [];
    }

    if (!context.allowScanProviderEnrichment) {
      didLogLiveCanonicalMissProviderRescueDecision = true;
      logLiveCanonicalMissProviderRescueDecision({
        scanId: context.scanId,
        candidate,
        forcedMode: providerBudgetService.getForcedMode(),
        confidence: candidate.confidence,
        isPrimaryCandidate: true,
        providerRateLimited: context.providerRateLimited,
        bootstrapInitialIdentify: true,
        canonicalMiss: true,
        allowRescue: false,
        reason: "provider_enrichment_not_requested",
      });
      if (
        process.env.NODE_ENV !== "production" &&
        providerBudgetService.getForcedMode() === "live" &&
        !didLogLiveCanonicalMissProviderRescueDecision
      ) {
        logger.warn(
          {
            label: "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_MISSING_GATE",
            scanId: context.scanId,
            candidate,
            forcedMode: providerBudgetService.getForcedMode(),
            confidence: candidate.confidence,
            isPrimaryCandidate: true,
            providerRateLimited: context.providerRateLimited,
            bootstrapInitialIdentify: true,
            canonicalMiss: true,
          },
          "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_MISSING_GATE",
        );
      }
      context.providerSkipped = true;
      logScanBootstrapProviderSkip({
        label: "SCAN_PROVIDER_ENRICHMENT_SKIPPED_BOOTSTRAP",
        scanId: context.scanId,
        candidate,
        reason: "initial_identify_disables_provider_enrichment",
      });
      logScanBootstrapProviderSkip({
        label: "SCAN_PROVIDER_SEARCH_SKIPPED_INITIAL_IDENTIFY",
        scanId: context.scanId,
        candidate,
        reason: "initial_identify_disables_provider_search",
      });
      return [];
    }

    if (this.shouldSkipProviderEnrichment(context, candidate)) {
      return [];
    }

    const providerDecision = providerBudgetService.evaluate({
      provider: providers.specsProviderName,
      operation: "specs",
      userTier: "unknown",
      confidence: candidate.confidence,
      duplicateRequest: context.providerAttemptCount > 0,
      cacheFresh: false,
      providerCooldownActive: context.providerRateLimited,
    });

    didLogLiveCanonicalMissProviderRescueDecision = true;
    logLiveCanonicalMissProviderRescueDecision({
      scanId: context.scanId,
      candidate,
      forcedMode: providerDecision.forcedMode,
      confidence: candidate.confidence,
      isPrimaryCandidate: true,
      providerRateLimited: context.providerRateLimited || providerDecision.shouldSimulateQuotaExhausted,
      bootstrapInitialIdentify: false,
      canonicalMiss: true,
      allowRescue: !providerDecision.shouldUseFallback && !providerDecision.shouldSimulateQuotaExhausted,
      reason:
        !providerDecision.shouldUseFallback && !providerDecision.shouldSimulateQuotaExhausted
          ? "high_confidence_primary_candidate_live_mode"
          : providerDecision.shouldSimulateQuotaExhausted || context.providerRateLimited
            ? "provider_rate_limited"
            : providerDecision.forcedMode !== "live" && providerDecision.forcedMode !== "success"
              ? "forced_mode_not_live"
              : "unknown",
    });

    if (providerDecision.shouldUseFallback || providerDecision.shouldSimulateQuotaExhausted) {
      context.providerSkipped = true;
      if (providerDecision.shouldSimulateQuotaExhausted) {
        const simulatedError = providerBudgetService.createQuotaExhaustedError("specs");
        this.markProviderShortCircuit(context, candidate, "provider-search-candidates", simulatedError);
      }
      return [];
    }

    logger.info(
      {
        label: "PROVIDER_ENRICH_PRIMARY_ONLY",
        scanId: context.scanId,
        candidate,
        decision: "primary-candidate-provider-allowed",
        providerAttemptCount: context.providerAttemptCount,
      },
      "PROVIDER_ENRICH_PRIMARY_ONLY",
    );

    logger.info(
      {
        label: "CANONICAL_PROVIDER_ENRICH_START",
        source: "provider-search-candidates",
        candidate,
        provider: providers.specsProviderName,
      },
      "CANONICAL_PROVIDER_ENRICH_START",
    );
    let providerCandidateResults: VehicleRecord[] = [];
    context.providerAttempted = true;
    context.providerAttemptCount += 1;
    const scanEnrichmentAllowed = isMarketCheckScanEnrichmentEnabled();
    if (!scanEnrichmentAllowed && providers.specsProviderName === "marketcheck") {
      context.providerSkipped = true;
      logger.info(
        {
          label: "MARKETCHECK_DISABLED_SKIP",
          endpoint: "/v2/search/car/active",
          reason: "scan_enrichment_disabled",
          allowLive: false,
          scanId: context.scanId,
          vehicleId: null,
          year: candidate.year,
          make: candidate.make,
          model: candidate.model,
          trim: candidate.trim ?? null,
          caller: "ScanService.provider-search-candidates",
          sourceScreen: "scan",
          stackTag: "scan-identify",
        },
        "MARKETCHECK_DISABLED_SKIP",
      );
      logger.warn(
        {
          label: "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
          scanId: context.scanId,
          action: "scan",
          endpointType: "specs",
          reason: "scan_enrichment_disabled",
          allowedCalls: 0,
        },
        "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
      );
      return [];
    }
    providerCandidateResults = providerDecision.shouldSimulateSuccess
      ? await providerBudgetService.simulateSpecsSearchCandidates({
          year: candidate.year,
          make: candidate.make,
          model: candidate.model,
          trim: candidate.trim,
        })
      : await (providers.specsProviderName === "marketcheck"
          ? (logger.info(
              {
                label: "MARKETCHECK_CALL_SITE",
                route: "scan-identify-provider-enrichment",
                service: "ScanService.provider-search-candidates",
                provider: providers.specsProviderName,
                reason: "scan_identify_provider_enrichment",
                requestMeta: {
                  allowLive: scanEnrichmentAllowed,
                  scanId: context.scanId,
                  year: candidate.year,
                  make: candidate.make,
                  model: candidate.model,
                  trim: candidate.trim ?? null,
                  sourceScreen: "scan",
                  action: "scan",
                  route: "scan-identify-provider-enrichment",
                  caller: "ScanService.provider-search-candidates",
                  stackTag: "scan-identify",
                },
              },
              "MARKETCHECK_CALL_SITE",
            ),
            providers.specsProvider.searchCandidates({
              year: candidate.year,
              make: candidate.make,
              model: candidate.model,
              trim: candidate.trim,
              requestMeta: {
                reason: "scan_identify_provider_enrichment",
                allowLive: scanEnrichmentAllowed,
                scanId: context.scanId,
                year: candidate.year,
                make: candidate.make,
                model: candidate.model,
                trim: candidate.trim ?? null,
                sourceScreen: "scan",
                action: "scan",
                route: "scan-identify-provider-enrichment",
                caller: "ScanService.provider-search-candidates",
                stackTag: "scan-identify",
              },
            }))
          : providers.specsProvider.searchCandidates({
          year: candidate.year,
          make: candidate.make,
          model: candidate.model,
          trim: candidate.trim,
          requestMeta: {
            reason: "scan_identify_provider_enrichment",
            allowLive: scanEnrichmentAllowed,
            scanId: context.scanId,
            year: candidate.year,
            make: candidate.make,
            model: candidate.model,
            trim: candidate.trim ?? null,
            sourceScreen: "scan",
            action: "scan",
            route: "scan-identify-provider-enrichment",
            caller: "ScanService.provider-search-candidates",
            stackTag: "scan-identify",
          },
        })).catch((error) => {
          if (isProviderRateLimitError(error)) {
            this.markProviderShortCircuit(context, candidate, "provider-search-candidates", error);
            return [];
          }
          logger.error(
            {
              label: "CANONICAL_PROVIDER_ENRICH_FAILURE",
              source: "provider-search-candidates",
              provider: providers.specsProviderName,
              candidate,
              message: error instanceof Error ? error.message : "Unknown provider searchCandidates error",
              stack: error instanceof Error ? error.stack : undefined,
              code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
              details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
              hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
            },
            "CANONICAL_PROVIDER_ENRICH_FAILURE",
          );
          return [];
        });
    logStrategy("provider-search-candidates", providerCandidateResults);

    let enrichmentVehicles = providerCandidateResults;
    const shouldTryDirectSpecs =
      enrichmentVehicles.length === 0 &&
      !context.providerRateLimited &&
      context.providerAttemptCount < MAX_PROVIDER_CALLS_PER_SCAN &&
      candidate.confidence >= 0.82 &&
      normalizeMatchText(candidate.model).split(" ").length <= 2;
    if (shouldTryDirectSpecs) {
      const liveVehicleId = buildLiveVehicleId({
        year: candidate.year,
        make: candidate.make,
        model: candidate.model,
        trim: candidate.trim,
      });
      if (!scanEnrichmentAllowed && providers.specsProviderName === "marketcheck") {
        context.providerSkipped = true;
        logger.info(
          {
            label: "MARKETCHECK_DISABLED_SKIP",
            endpoint: "/v2/search/car/active",
            reason: "scan_enrichment_disabled",
            allowLive: false,
            scanId: context.scanId,
            vehicleId: liveVehicleId,
            year: candidate.year,
            make: candidate.make,
            model: candidate.model,
            trim: candidate.trim ?? null,
            caller: "ScanService.provider-direct-specs",
            sourceScreen: "scan",
            stackTag: "scan-identify",
          },
          "MARKETCHECK_DISABLED_SKIP",
        );
        logger.warn(
          {
            label: "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
            scanId: context.scanId,
            action: "scan",
            endpointType: "specs",
            reason: "scan_enrichment_disabled",
            allowedCalls: 0,
          },
          "MARKETCHECK_ACTION_BUDGET_EXCEEDED",
        );
        return [];
      }
      logger.info(
        {
          label: "CANONICAL_PROVIDER_ENRICH_START",
          source: "provider-direct-specs",
          provider: providers.specsProviderName,
          candidate,
          liveVehicleId,
        },
        "CANONICAL_PROVIDER_ENRICH_START",
      );
      const directSpecsDecision = providerBudgetService.evaluate({
        provider: providers.specsProviderName,
        operation: "specs",
        userTier: "unknown",
        confidence: candidate.confidence,
        duplicateRequest: true,
        cacheFresh: false,
        providerCooldownActive: context.providerRateLimited,
      });
      let directVehicle: VehicleRecord | null = null;
      if (directSpecsDecision.shouldSimulateQuotaExhausted) {
        const simulatedError = providerBudgetService.createQuotaExhaustedError("specs");
        logger.warn(
          {
            label: "PROVIDER_QUOTA_EXHAUSTED",
            provider: providers.specsProviderName,
            operation: "specs",
            candidate,
            mode: directSpecsDecision.forcedMode,
          },
          "PROVIDER_QUOTA_EXHAUSTED",
        );
        logger.info(
          {
            label: "FALLBACK_USED",
            provider: providers.specsProviderName,
            operation: "specs",
            candidate,
            mode: directSpecsDecision.forcedMode,
            reason: directSpecsDecision.reason,
            route: "scan-provider-direct-specs",
          },
          "FALLBACK_USED",
        );
        this.markProviderShortCircuit(context, candidate, "provider-direct-specs", simulatedError);
      } else if (directSpecsDecision.shouldUseFallback) {
        context.providerSkipped = true;
        logger.info(
          {
            label: "FALLBACK_USED",
            provider: providers.specsProviderName,
            operation: "specs",
            candidate,
            mode: directSpecsDecision.forcedMode,
            reason: directSpecsDecision.reason,
            route: "scan-provider-direct-specs",
          },
          "FALLBACK_USED",
        );
      } else {
        context.providerAttempted = true;
        context.providerAttemptCount += 1;
        directVehicle = directSpecsDecision.shouldSimulateSuccess
          ? await providerBudgetService.simulateVehicleSpecs({
              vehicleId: liveVehicleId,
              vehicle: null,
            })
          : await (providers.specsProviderName === "marketcheck"
              ? (logger.info(
                  {
                    label: "MARKETCHECK_CALL_SITE",
                    route: "scan-identify-provider-direct-specs",
                    service: "ScanService.provider-direct-specs",
                    provider: providers.specsProviderName,
                    reason: "scan_identify_provider_enrichment",
                    requestMeta: {
                      allowLive: scanEnrichmentAllowed,
                      scanId: context.scanId,
                      vehicleId: liveVehicleId,
                      year: candidate.year,
                      make: candidate.make,
                      model: candidate.model,
                      trim: candidate.trim ?? null,
                      sourceScreen: "scan",
                      action: "scan",
                      route: "scan-identify-provider-direct-specs",
                      caller: "ScanService.provider-direct-specs",
                      stackTag: "scan-identify",
                    },
                  },
                  "MARKETCHECK_CALL_SITE",
                ),
                providers.specsProvider.getVehicleSpecs({
                  vehicleId: liveVehicleId,
                  vehicle: null,
                  requestMeta: {
                    reason: "scan_identify_provider_enrichment",
                    allowLive: scanEnrichmentAllowed,
                    scanId: context.scanId,
                    vehicleId: liveVehicleId,
                    year: candidate.year,
                    make: candidate.make,
                    model: candidate.model,
                    trim: candidate.trim ?? null,
                    sourceScreen: "scan",
                    action: "scan",
                    route: "scan-identify-provider-direct-specs",
                    caller: "ScanService.provider-direct-specs",
                    stackTag: "scan-identify",
                  },
                }))
              : providers.specsProvider.getVehicleSpecs({
              vehicleId: liveVehicleId,
              vehicle: null,
              requestMeta: {
                reason: "scan_identify_provider_enrichment",
                allowLive: scanEnrichmentAllowed,
                scanId: context.scanId,
                vehicleId: liveVehicleId,
                year: candidate.year,
                make: candidate.make,
                model: candidate.model,
                trim: candidate.trim ?? null,
                sourceScreen: "scan",
                action: "scan",
                route: "scan-identify-provider-direct-specs",
                caller: "ScanService.provider-direct-specs",
                stackTag: "scan-identify",
              },
            })).catch((error) => {
              if (isProviderRateLimitError(error)) {
                this.markProviderShortCircuit(context, candidate, "provider-direct-specs", error);
                return null;
              }
              logger.error(
                {
                  label: "CANONICAL_PROVIDER_ENRICH_FAILURE",
                  source: "provider-direct-specs",
                  provider: providers.specsProviderName,
                  candidate,
                  liveVehicleId,
                  message: error instanceof Error ? error.message : "Unknown provider getVehicleSpecs error",
                  stack: error instanceof Error ? error.stack : undefined,
                  code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
                  details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
                  hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
                },
                "CANONICAL_PROVIDER_ENRICH_FAILURE",
              );
              return null;
            });
      }
      enrichmentVehicles = directVehicle ? [directVehicle] : [];
      logStrategy("provider-direct-specs", enrichmentVehicles, { liveVehicleId });
    }

    if (enrichmentVehicles.length > 0) {
      logger.error(
        {
          label: "CANONICAL_PROVIDER_ENRICH_SUCCESS",
          provider: providers.specsProviderName,
          candidate,
          resultCount: enrichmentVehicles.length,
          sampleVehicleIds: enrichmentVehicles.slice(0, 5).map((vehicle) => vehicle.id),
        },
        "CANONICAL_PROVIDER_ENRICH_SUCCESS",
      );
      const canonicalizedProviderResults = (
        await Promise.all(
        enrichmentVehicles.slice(0, 5).map(async (vehicle) => {
          try {
            const canonical = await upsertCanonicalVehicleFromProvider({
              vehicle,
              sourceProvider: providers.specsProviderName,
              sourceVehicleId: vehicle.id,
            });
            logger.error(
              {
                label: "CANONICAL_PROMOTED_FROM_PROVIDER",
                provider: providers.specsProviderName,
                candidate,
                canonicalId: canonical.id,
                sourceVehicleId: vehicle.id,
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model,
                trim: vehicle.trim ?? null,
              },
              "CANONICAL_PROMOTED_FROM_PROVIDER",
            );
            return this.buildCanonicalMatchedCandidate({
              vehicleId: canonical.id,
              vehicle,
              confidence: candidate.confidence,
              matchReason: `Matched live provider result ${vehicle.year} ${vehicle.make} ${vehicle.model} and stored canonical catalog entry.`,
            });
          } catch (error) {
            logger.error(
              {
                label: "CANONICAL_UPSERT_FAILURE",
                provider: providers.specsProviderName,
                candidate,
                vehicleId: vehicle.id,
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model,
                trim: vehicle.trim,
                message: error instanceof Error ? error.message : "Unknown canonicalization error",
                stack: error instanceof Error ? error.stack : undefined,
                code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
                details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
                hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
              },
              "CANONICAL_UPSERT_FAILURE",
            );
            return null;
          }
        }),
      )
      ).filter((entry): entry is MatchedVehicleCandidate => entry !== null);
      logStrategy("provider-canonicalized", canonicalizedProviderResults);
      if (canonicalizedProviderResults.length > 0) {
        logger.info(
          {
            label: "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_SUCCEEDED",
            scanId: context.scanId,
            candidate,
            selectedVehicleIds: canonicalizedProviderResults.map((entry) => entry.vehicleId),
            resultCount: canonicalizedProviderResults.length,
          },
          "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_SUCCEEDED",
        );
        logger.error(
          {
            label: "CANONICAL_SELECTED",
            source: "provider-canonicalized",
            selectedVehicleIds: canonicalizedProviderResults.map((entry) => entry.vehicleId),
          },
          "CANONICAL_SELECTED",
        );
        return canonicalizedProviderResults;
      }
      logger.warn(
        {
          label: "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_FAILED",
          scanId: context.scanId,
          candidate,
          reason: "provider_results_not_canonicalized",
          resultCount: enrichmentVehicles.length,
        },
        "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_FAILED",
      );
      logger.warn(
        {
          label: "CANONICAL_PROVIDER_ENRICH_FAILURE",
          source: "provider-canonicalized",
          provider: providers.specsProviderName,
          candidate,
          message: "Provider returned vehicles but canonical upsert did not produce any persisted canonical rows.",
        },
        "CANONICAL_PROVIDER_ENRICH_FAILURE",
      );
    }
    logger.warn(
      {
        label: "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_FAILED",
        scanId: context.scanId,
        candidate,
        reason: "no_provider_enrichment_result",
      },
      "LIVE_CANONICAL_MISS_PROVIDER_RESCUE_FAILED",
    );
    logger.warn(
      {
        label: "CANONICAL_PROVIDER_ENRICH_FAILURE",
        source: "final-fallback",
        provider: providers.specsProviderName,
        candidate,
        message: "No provider enrichment result was available; falling back to AI-only result.",
      },
      "CANONICAL_PROVIDER_ENRICH_FAILURE",
    );
    return [];
  }

  private async identifyFromCacheOnly(input: {
    imageKey: string;
    visualHash: string;
    imageUrl: string;
  }): Promise<VisionProviderResult | null> {
    const cachedImage = await this.tryFindImageCacheEntry(input.imageKey, {
      source: "cache-only-image-key",
      imageUrl: input.imageUrl,
      multipartFilePresent: false,
    });
    if (cachedImage?.normalizedVehicleJson) {
      await this.tryMarkImageCacheAccess(input.imageKey, {
        source: "cache-only-image-key",
      });
      const normalized = normalizeVisionResult(cachedImage.normalizedVehicleJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "image_cache", imageKey: input.imageKey },
        provider: "cache:image",
      };
    }

    const similarImage = await this.tryFindSimilarImageByHash(input.visualHash, {
      source: "cache-only-similar-image-hash",
      imageKey: input.imageKey,
    });
    if (similarImage?.normalizedVehicleJson) {
      logger.info(
        {
          label: "SCAN_FORCE_FRESH_IDENTIFY",
          visualHash: input.visualHash,
          imageKey: input.imageKey,
          nearMatchImageKey: similarImage.imageKey,
          reason: "cache_only_similar_image_hash_requires_fresh_identify",
        },
        "SCAN_FORCE_FRESH_IDENTIFY",
      );
    }

    const analysisKey = buildAnalysisKey({
      analysisType: "vision_identify",
      identityType: "image_key",
      identityValue: input.imageKey,
      promptVersion: "v1",
      modelName: env.OPENAI_VISION_MODEL,
    });
    const cachedAnalysis = await this.tryFindAnalysisCacheEntry(analysisKey, {
      source: "cache-only-analysis-key",
      imageKey: input.imageKey,
    });
    if (cachedAnalysis?.status === "completed" && cachedAnalysis.resultJson) {
      await this.tryMarkAnalysisCacheAccess(analysisKey, {
        source: "cache-only-analysis-key",
      });
      const normalized = normalizeVisionResult(cachedAnalysis.resultJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "analysis_cache", analysisKey },
        provider: "cache:analysis",
      };
    }

    return null;
  }

  private async tryFindImageCacheEntry(
    imageKey: string,
    context: {
      scanId?: string;
      source: string;
      imageUrl?: string;
      multipartFilePresent?: boolean;
    },
  ) {
    logger.info(
      {
        scanId: context.scanId,
        imageSourceType: context.multipartFilePresent === false ? "cache-only" : "multipart-upload",
        cacheLookupSource: context.source,
        cacheKey: imageKey,
        imageUrl: context.imageUrl,
        multipartFilePresent: context.multipartFilePresent ?? true,
      },
      "Looking up image cache entry",
    );
    try {
      return await this.analysisCacheService.findImageByKey(imageKey);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          cacheKey: imageKey,
          imageUrl: context.imageUrl,
          multipartFilePresent: context.multipartFilePresent ?? true,
          reason: error instanceof Error ? error.message : "Unknown image cache lookup error",
          details: error instanceof AppError ? error.details : undefined,
        },
        "Image cache lookup failed; continuing with uploaded image data",
      );
      return null;
    }
  }

  private async tryFindSimilarImageByHash(
    visualHash: string,
    context: {
      scanId?: string;
      source: string;
      imageKey: string;
    },
  ) {
    try {
      return await this.analysisCacheService.findSimilarImageByHash(visualHash);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          imageKey: context.imageKey,
          visualHash,
          reason: error instanceof Error ? error.message : "Unknown similar-image cache lookup error",
          details: error instanceof AppError ? error.details : undefined,
        },
        "Similar image cache lookup failed; continuing with uploaded image data",
      );
      return null;
    }
  }

  private async tryMarkImageCacheAccess(
    imageKey: string,
    context: {
      scanId?: string;
      source: string;
    },
  ) {
    try {
      await this.analysisCacheService.markImageAccessed(imageKey);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          cacheKey: imageKey,
          reason: error instanceof Error ? error.message : "Unknown image cache access update error",
          details: error instanceof AppError ? error.details : undefined,
        },
        "Skipping image cache hit update after cache lookup failure",
      );
    }
  }

  private async tryUpsertImageCache(
    entry: {
      id: string;
      imageKey: string;
      visualHash: string;
      fileWidth: number;
      fileHeight: number;
      normalizedVehicleJson: VisionResult;
      ocrJson: unknown | null;
      extractionJson: VisionResult;
      createdAt: string;
      updatedAt: string;
      lastAccessedAt: string;
      hitCount: number;
    },
    context: {
      scanId?: string;
      source: string;
    },
  ) {
    try {
      await this.analysisCacheService.upsertImageCache(entry);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          cacheKey: entry.imageKey,
          visualHash: entry.visualHash,
          reason: error instanceof Error ? error.message : "Unknown image cache upsert error",
          details: error instanceof AppError ? error.details : undefined,
        },
        "Skipping image cache persistence after successful identify result",
      );
    }
  }

  private async tryFindAnalysisCacheEntry(
    analysisKey: string,
    context: {
      scanId?: string;
      source: string;
      imageKey?: string;
    },
  ) {
    try {
      return await this.analysisCacheService.findAnalysisByKey(analysisKey);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey,
          imageKey: context.imageKey,
          reason: error instanceof Error ? error.message : "Unknown cached analysis lookup error",
          details: error instanceof AppError ? error.details : undefined,
        },
        "Cached analysis lookup failed; continuing with uploaded image data",
      );
      return null;
    }
  }

  private async tryMarkAnalysisCacheAccess(
    analysisKey: string,
    context: {
      scanId?: string;
      source: string;
    },
  ) {
    try {
      await this.analysisCacheService.markAnalysisAccessed(analysisKey);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey,
          reason: error instanceof Error ? error.message : "Unknown cached analysis access update error",
          details: error instanceof AppError ? error.details : undefined,
        },
        "Skipping cached analysis hit update after lookup failure",
      );
    }
  }

  private async tryWaitForAnalysisCache(
    analysisKey: string,
    context: {
      scanId?: string;
      source: string;
    },
  ) {
    try {
      return await this.analysisCacheService.waitForAnalysis(analysisKey);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey,
          reason: error instanceof Error ? error.message : "Unknown cached analysis wait error",
          details: error instanceof AppError ? error.details : undefined,
        },
        "Cached analysis wait failed; continuing with uploaded image data",
      );
      return null;
    }
  }

  private async tryBeginAnalysisProcessing(
    input: {
      analysisKey: string;
      analysisType: string;
      identityType?: string | null;
      identityValue?: string | null;
      vin?: string | null;
      vinKey?: string | null;
      vehicleKey?: string | null;
      listingKey?: string | null;
      imageKey?: string | null;
      visualHash?: string | null;
      promptVersion: string;
      modelName: string;
      costEstimate?: number | null;
      expiresAt?: string | null;
    },
    context: {
      scanId?: string;
      source: string;
    },
  ) {
    try {
      const begun = await this.analysisCacheService.beginProcessing(input);
      logger.info(
        {
          label: "ANALYSIS_CACHE_BEGIN_RESULT",
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey: input.analysisKey,
          imageKey: input.imageKey,
          cacheStatus: begun ? "reserved" : "already_processing",
        },
        "ANALYSIS_CACHE_BEGIN_RESULT",
      );
      return begun;
    } catch (error) {
      const described = describeUnknownError(error);
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey: input.analysisKey,
          imageKey: input.imageKey,
          cacheStatus: "begin_failed",
          reason: described.reason,
          errorCode: described.errorCode,
          details: described.details,
          hint: described.hint,
          supabase: described.supabase,
        },
        "Cached analysis begin failed; continuing with uploaded image data",
      );
      return null;
    }
  }

  private async tryCompleteAnalysisCache(
    analysisKey: string,
    resultJson: unknown,
    updates: {
      costEstimate?: number | null;
      vehicleKey?: string | null;
      imageKey?: string | null;
      visualHash?: string | null;
    },
    context: {
      scanId?: string;
      source: string;
    },
  ) {
    try {
      await this.analysisCacheService.completeAnalysis(analysisKey, resultJson, updates);
      logger.info(
        {
          label: "ANALYSIS_CACHE_COMPLETE_RESULT",
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey,
          imageKey: updates.imageKey,
          cacheStatus: "completed",
        },
        "ANALYSIS_CACHE_COMPLETE_RESULT",
      );
    } catch (error) {
      const described = describeUnknownError(error);
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey,
          imageKey: updates.imageKey,
          cacheStatus: "complete_failed",
          reason: described.reason,
          errorCode: described.errorCode,
          details: described.details,
          hint: described.hint,
          supabase: described.supabase,
        },
        "Skipping cached analysis completion after successful identify result",
      );
    }
  }

  private async tryFailAnalysisCache(
    analysisKey: string,
    errorText: string,
    context: {
      scanId?: string;
      source: string;
    },
  ) {
    try {
      await this.analysisCacheService.failAnalysis(analysisKey, errorText);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey,
          reason: error instanceof Error ? error.message : "Unknown cached analysis fail-update error",
          details: error instanceof AppError ? error.details : undefined,
        },
        "Skipping cached analysis failure update after provider error",
      );
    }
  }
}

function normalizeVisibleTextEvidence(result: VisionResult) {
  const baseEvidence = result.visible_text_evidence ?? {
    raw_text: [],
    make_text: result.visible_make_text ?? null,
    model_text: result.visible_model_text ?? null,
    trim_text: result.visible_trim_text ?? null,
    badge_text: result.visible_badge_text ? [result.visible_badge_text] : [],
    text_confidence: 0,
    evidence_regions: [],
  };
  const combinedText = [
    ...baseEvidence.raw_text,
    ...baseEvidence.badge_text,
    result.visible_badge_text ?? null,
    result.visible_make_text ?? null,
    result.visible_model_text ?? null,
    result.visible_trim_text ?? null,
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedCombined = normalizeLookupText(combinedText);
  const cadillacContext =
    normalizeMatchText(baseEvidence.make_text ?? result.visible_make_text ?? result.likely_make) === "cadillac" ||
    normalizedCombined.includes("cadillac");

  let modelText = baseEvidence.model_text?.trim() || result.visible_model_text?.trim() || null;
  let trimText = baseEvidence.trim_text?.trim() || result.visible_trim_text?.trim() || null;
  let makeText = baseEvidence.make_text?.trim() || result.visible_make_text?.trim() || null;
  const badgeText = [
    ...baseEvidence.badge_text,
    ...(result.visible_badge_text ? [result.visible_badge_text] : []),
  ]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, array) => array.findIndex((candidate) => normalizeLookupText(candidate) === normalizeLookupText(entry)) === index);

  if (cadillacContext && normalizedCombined.includes("lyriq")) {
    makeText = makeText || "Cadillac";
    modelText = "Lyriq";
    if (/\b600e\b/.test(normalizedCombined)) {
      trimText = "600e";
    } else if (/\b600\b/.test(normalizedCombined)) {
      trimText = trimText || "600";
    }
  }

  return {
    raw_text: baseEvidence.raw_text.map((entry) => entry.trim()).filter(Boolean).slice(0, 12),
    make_text: makeText,
    model_text: modelText,
    trim_text: trimText,
    badge_text: badgeText.slice(0, 8),
    text_confidence: Math.max(0, Math.min(1, baseEvidence.text_confidence ?? 0)),
    evidence_regions: baseEvidence.evidence_regions?.map((entry) => entry.trim()).filter(Boolean).slice(0, 8),
  };
}

export function normalizeVisionResult(result: VisionResult): VisionResult {
  const normalizedTextEvidence = normalizeVisibleTextEvidence(result);
  const normalizedBadgeText = normalizedTextEvidence.badge_text[0] ?? result.visible_badge_text;
  const normalizedPrimary = normalizeMercedesSlFamilyCandidate({
    make: result.likely_make,
    model: result.likely_model,
    trim: result.likely_trim,
    badgeText: normalizedBadgeText,
    modelText: normalizedTextEvidence.model_text ?? result.visible_model_text,
  });
  const normalizedVisibleModel = normalizeMercedesSlFamilyCandidate({
    make: result.likely_make,
    model: normalizedTextEvidence.model_text ?? result.visible_model_text ?? result.likely_model,
    trim: normalizedTextEvidence.trim_text ?? result.visible_trim_text ?? result.likely_trim,
    badgeText: normalizedBadgeText,
    modelText: normalizedTextEvidence.model_text ?? result.visible_model_text,
  });
  const normalizedAlternates = result.alternate_candidates
    .map((candidate) => {
      const normalizedAlternate = normalizeMercedesSlFamilyCandidate({
        make: candidate.likely_make,
        model: candidate.likely_model,
        trim: candidate.likely_trim,
        badgeText: normalizedBadgeText,
        modelText: normalizedTextEvidence.model_text ?? result.visible_model_text,
      });
      return {
        ...candidate,
        likely_year: candidate.likely_year,
        likely_make: normalizedAlternate.make,
        likely_model: normalizedAlternate.model,
        likely_trim: normalizedAlternate.trim,
        confidence: Math.max(0, Math.min(1, candidate.confidence)),
      };
    })
    .filter((candidate) => candidate.confidence >= 0.2 && candidate.likely_year > 0);

  if (normalizeMatchText(result.likely_make) === "mercedes benz" && (normalizeMatchText(result.likely_model).startsWith("sl") || normalizeMatchText(normalizedBadgeText).startsWith("sl"))) {
    logger.info(
      {
        label: "MERCEDES_SL_NORMALIZATION",
        raw: {
          make: result.likely_make,
          model: result.likely_model,
          trim: result.likely_trim ?? null,
          badge: normalizedBadgeText ?? null,
        },
        normalized: {
          make: normalizedPrimary.make,
          model: normalizedPrimary.model,
          trim: normalizedPrimary.trim ?? null,
        },
        normalizationApplied: normalizedPrimary.applied,
      },
      "MERCEDES_SL_NORMALIZATION",
    );
  }

  return {
    ...result,
    likely_year: result.likely_year,
    bestYear: result.bestYear ?? null,
    yearConfidence: result.yearConfidence,
    yearEvidence: result.yearEvidence ?? null,
    exactYearConfirmed: result.exactYearConfirmed ?? null,
    displayYearLabel: result.displayYearLabel ?? null,
    yearRange: result.yearRange ?? null,
    yearReasoning: result.yearReasoning ?? null,
    likely_make: normalizedPrimary.make,
    likely_model: normalizedPrimary.model,
    likely_trim: normalizedPrimary.trim,
    confidence: Math.max(0, Math.min(1, result.confidence)),
    visible_text_evidence: normalizedTextEvidence,
    visible_clues: result.visible_clues.map((clue) => clue.trim()).filter(Boolean),
    visible_badge_text: normalizedBadgeText?.trim(),
    visible_make_text: normalizedTextEvidence.make_text ?? result.visible_make_text?.trim(),
    visible_model_text: normalizedVisibleModel.applied ? normalizedVisibleModel.model : normalizedTextEvidence.model_text ?? result.visible_model_text?.trim(),
    visible_trim_text: normalizedVisibleModel.applied
      ? normalizedVisibleModel.trim ?? normalizedTextEvidence.trim_text ?? result.visible_trim_text?.trim()
      : normalizedTextEvidence.trim_text ?? result.visible_trim_text?.trim(),
    emblem_logo_clues: (result.emblem_logo_clues ?? []).map((clue) => clue.trim()).filter(Boolean),
    alternate_candidates: normalizedAlternates,
    textDominanceApplied: result.textDominanceApplied ?? false,
    focusCropUsed: result.focusCropUsed ?? false,
    matchEvidence: result.matchEvidence ?? null,
  };
}
