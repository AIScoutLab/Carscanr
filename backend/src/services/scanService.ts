import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import { mapCanonicalVehicleToRecord, resolveStoredVehicleRecordById, upsertCanonicalVehicleFromAiLearned, upsertCanonicalVehicleFromProvider } from "../lib/canonicalVehicleCatalog.js";
import { logger } from "../lib/logger.js";
import { providers } from "../lib/providerRegistry.js";
import { buildCanonicalKey, normalizeLookupText } from "../lib/providerCache.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { buildAnalysisKey, buildImageKey, buildVehicleKey } from "../lib/cacheKeys.js";
import { resizeForVision, computeDhashHex } from "../lib/imageProcessing.js";
import { buildLiveVehicleId } from "../providers/marketcheck/vehicleId.js";
import { AuthContext, MatchedVehicleCandidate, ScanRecord, VehicleRecord, VisionProviderResult, VisionResult } from "../types/domain.js";
import { AnalysisCacheService } from "./analysisCacheService.js";
import { GoogleVisionOcrResult, googleVisionOcrService } from "./googleVisionOcrService.js";
import { UsageService } from "./usageService.js";
import { UnlockService } from "./unlockService.js";

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
  providerAttempted: boolean;
  providerSkipped: boolean;
  providerRateLimited: boolean;
  providerAttemptCount: number;
  canonicalHit: boolean;
  visibleBadgeText?: string;
  visibleMakeText?: string;
  visibleModelText?: string;
  visibleTrimText?: string;
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

const MAX_PROVIDER_CALLS_PER_SCAN = 2;
const STABILITY_CACHE_TTL_MS = 20 * 60 * 1000;
const STABILITY_CACHE_PREFIX_LENGTH = 12;
const MAX_STABILITY_CACHE_ENTRIES = 200;
const AUTO_PROMOTION_THRESHOLD = 5;

type StabilityCacheEntry = {
  userId: string;
  visualHash: string;
  normalizedResult: VisionResult;
  resolvedVehicles: MatchedVehicleCandidate[];
  confidence: number;
  createdAt: number;
};

type StabilityCacheMatch = StabilityCacheEntry & {
  matchType: "exact" | "prefix";
};

const scanStabilityCache: StabilityCacheEntry[] = [];

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

function hasEvidenceTokenMatch(candidateText: string | undefined | null, evidenceText: string | undefined | null) {
  const candidateNormalized = normalizeMatchText(candidateText);
  const evidenceNormalized = normalizeMatchText(evidenceText);
  if (!candidateNormalized || !evidenceNormalized) {
    return false;
  }
  return (
    candidateNormalized === evidenceNormalized ||
    candidateNormalized.includes(evidenceNormalized) ||
    evidenceNormalized.includes(candidateNormalized)
  );
}

function contradictsEvidence(candidateText: string | undefined | null, evidenceText: string | undefined | null) {
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
  const prefixMatch = scanStabilityCache.find(
    (entry) =>
      entry.userId === input.userId &&
      visualHashPrefix(entry.visualHash) === visualHashPrefix(input.visualHash) &&
      now - entry.createdAt < STABILITY_CACHE_TTL_MS,
  );
  return prefixMatch ? { ...prefixMatch, matchType: "prefix" } : null;
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

function buildOcrTracePayload(input: {
  scanId: string;
  normalizedResult: VisionResult;
  candidates: MatchedVehicleCandidate[];
  rawResponse?: unknown;
  ocrConfirmed?: boolean;
  enforcementApplied?: boolean;
}) {
  const top = input.candidates[0] ?? null;
  const sourceIsOcrOverride = input.normalizedResult.source === "ocr_override";
  const hardTextConfirmed = hasHardTextConfirmation(input.normalizedResult);
  const structuredOcr = input.rawResponse ? extractStructuredOcrFromRawResponse(input.rawResponse) : null;
  const derivedOcrConfirmed =
    input.ocrConfirmed ?? (sourceIsOcrOverride || hardTextConfirmed || Boolean(structuredOcr));
  return {
    scanId: input.scanId,
    normalizedResult: {
      source: input.normalizedResult.source ?? null,
      likely_year: input.normalizedResult.likely_year,
      likely_make: input.normalizedResult.likely_make,
      likely_model: input.normalizedResult.likely_model,
      visible_model_text: input.normalizedResult.visible_model_text ?? null,
    },
    topCandidate: top
      ? {
          year: top.year,
          make: top.make,
          model: top.model,
          matchReason: top.matchReason,
        }
      : null,
    gateInputs: {
      sourceIsOcrOverride,
      hardTextConfirmed,
      structuredOcrPresent: Boolean(structuredOcr),
      structuredOcr: structuredOcr
        ? {
            year: structuredOcr.year ?? null,
            make: structuredOcr.make ?? null,
            model: structuredOcr.model ?? null,
            trim: structuredOcr.trim ?? null,
          }
        : null,
    },
    ocrConfirmed: derivedOcrConfirmed,
    enforcementApplied: input.enforcementApplied ?? false,
  };
}

function enforceFinalVisibleOcrCandidate(input: {
  scanId: string;
  normalizedResult: VisionResult;
  candidates: MatchedVehicleCandidate[];
  rawResponse: unknown;
}) {
  logger.error(
    {
      label: "OCR_TRACE_ENFORCE_ENTRY",
      ...buildOcrTracePayload({
        scanId: input.scanId,
        normalizedResult: input.normalizedResult,
        candidates: input.candidates,
        rawResponse: input.rawResponse,
        enforcementApplied: false,
      }),
    },
    "OCR_TRACE_ENFORCE_ENTRY",
  );

  const ocrConfirmed = hasStructuredOcrConfirmation({
    normalizedResult: input.normalizedResult,
    rawResponse: input.rawResponse,
  });

  logger.error(
    {
      label: "OCR_TRACE_ENFORCE_DECISION",
      phase: "before-gate-check",
      ...buildOcrTracePayload({
        scanId: input.scanId,
        normalizedResult: input.normalizedResult,
        candidates: input.candidates,
        rawResponse: input.rawResponse,
        ocrConfirmed,
        enforcementApplied: false,
      }),
    },
    "OCR_TRACE_ENFORCE_DECISION",
  );

  if (!ocrConfirmed) {
    logger.error(
      {
        label: "OCR_TRACE_ENFORCE_DECISION",
        phase: "after-gate-check",
        ...buildOcrTracePayload({
          scanId: input.scanId,
          normalizedResult: input.normalizedResult,
          candidates: input.candidates,
          rawResponse: input.rawResponse,
          ocrConfirmed,
          enforcementApplied: false,
        }),
      },
      "OCR_TRACE_ENFORCE_DECISION",
    );
    logger.error(
      {
        label: "OCR_TRACE_ENFORCE_EXIT",
        ...buildOcrTracePayload({
          scanId: input.scanId,
          normalizedResult: input.normalizedResult,
          candidates: input.candidates,
          rawResponse: input.rawResponse,
          ocrConfirmed,
          enforcementApplied: false,
        }),
      },
      "OCR_TRACE_ENFORCE_EXIT",
    );
    return {
      normalizedResult: input.normalizedResult,
      candidates: input.candidates,
      applied: false,
    };
  }

  const pinnedNormalizedResult =
    input.normalizedResult.source === "ocr_override"
      ? input.normalizedResult
      : normalizeVisionResult({
          ...input.normalizedResult,
          source: "ocr_override",
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
    matchReason: "OCR-confirmed result",
  };

  const normalizedPinnedCandidate: MatchedVehicleCandidate = {
    ...pinnedCandidate,
    year: pinnedNormalizedResult.likely_year,
    make: pinnedNormalizedResult.likely_make,
    model: pinnedNormalizedResult.likely_model,
    confidence: pinnedNormalizedResult.confidence,
    matchReason: "OCR-confirmed result",
  };

  const remaining = input.candidates.filter(
    (candidate) => buildMatchedVehicleSignature(candidate) !== buildMatchedVehicleSignature(normalizedPinnedCandidate),
  );

  logger.error(
    {
      label: "OCR_TRACE_ENFORCE_DECISION",
      phase: "after-gate-check",
      ...buildOcrTracePayload({
        scanId: input.scanId,
        normalizedResult: pinnedNormalizedResult,
        candidates: [normalizedPinnedCandidate, ...remaining],
        rawResponse: input.rawResponse,
        ocrConfirmed,
        enforcementApplied: true,
      }),
    },
    "OCR_TRACE_ENFORCE_DECISION",
  );

  logger.error(
    {
      label: "OCR_TRACE_ENFORCE_EXIT",
      ...buildOcrTracePayload({
        scanId: input.scanId,
        normalizedResult: pinnedNormalizedResult,
        candidates: [normalizedPinnedCandidate, ...remaining],
        rawResponse: input.rawResponse,
        ocrConfirmed,
        enforcementApplied: true,
      }),
    },
    "OCR_TRACE_ENFORCE_EXIT",
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

function logIdentifyStage(stage: ScanFailureStage, event: "start" | "success", context: Record<string, unknown>) {
  logger.error(
    {
      label: "IDENTIFY_STAGE",
      stage,
      event,
      ...context,
    },
    "IDENTIFY_STAGE",
  );
}

export class ScanService {
  constructor(
    private readonly usageService: UsageService,
    private readonly analysisCacheService = new AnalysisCacheService(),
    private readonly unlockService = new UnlockService(),
  ) {}

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
    logger.error(
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
  }): Promise<{ scan: ScanRecord; visionProvider: string; entitlement?: { usedUnlock: boolean; alreadyUnlocked: boolean; remainingUnlocks: number; isPro: boolean } }> {
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
      logger.error(
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
      logger.error(
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
          throw new AppError(403, "FREE_UNLOCKS_EXHAUSTED", "No free unlocks remaining for premium analysis.");
        }
        visionResult = cachedOnly;
      } else {
        logger.error(
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
          visualHash,
          width: processed.width,
          height: processed.height,
          onDegradedToLiveVision: () => {
            logger.error(
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
      let normalizedResult = normalizeVisionResult(visionResult.normalized);
      const enrichmentContext: ProviderEnrichmentContext = {
        scanId,
        providerAttempted: false,
        providerSkipped: false,
        providerRateLimited: false,
        providerAttemptCount: 0,
        canonicalHit: false,
        visibleBadgeText: normalizedResult.visible_badge_text,
        visibleMakeText: normalizedResult.visible_make_text,
        visibleModelText: normalizedResult.visible_model_text,
        visibleTrimText: normalizedResult.visible_trim_text,
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
      if (stabilityCacheHit && stabilityCacheHit.confidence >= 0.8 && !shouldBypassStabilityCache) {
        usedStabilityCache = true;
        normalizedResult = stabilityCacheHit.normalizedResult;
        logger.error(
          {
            label: "SCAN_STABILITY_CACHE_HIT",
            scanId,
            userId: input.auth.userId,
            visualHash,
            matchType: stabilityCacheHit.matchType,
            cachedVisualHash: stabilityCacheHit.visualHash,
            cachedConfidence: stabilityCacheHit.confidence,
            cachedNormalizedResult: stabilityCacheHit.normalizedResult,
            cachedVehicleIds: stabilityCacheHit.resolvedVehicles.map((vehicle) => vehicle.vehicleId),
          },
          "SCAN_STABILITY_CACHE_HIT",
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
        matchedVehicles = await this.resolveCatalogMatches(normalizedResult, enrichmentContext);
      }
      const resolvedVehiclesBeforeOcrLock =
        matchedVehicles.length > 0
          ? matchedVehicles
          : [
              {
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
      }
      const resolvedVehicles = ocrLocked.resolvedVehicles;
      const hasCanonicalVehicle = resolvedVehicles.some((vehicle) => Boolean(vehicle.vehicleId));

      if (!hasCanonicalVehicle) {
        logger.error(
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
      logger.error(
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
      logger.error(
        {
          label: "OCR_TRACE_CALLSITE_BEFORE_FINAL_ENFORCE",
          ...buildOcrTracePayload({
            scanId,
            normalizedResult,
            candidates: resolvedVehicles,
            rawResponse: visionResult.rawResponse,
          }),
        },
        "OCR_TRACE_CALLSITE_BEFORE_FINAL_ENFORCE",
      );
      const finalVisible = enforceFinalVisibleOcrCandidate({
        scanId,
        normalizedResult,
        candidates: resolvedVehicles,
        rawResponse: visionResult.rawResponse,
      });
      logger.error(
        {
          label: "OCR_TRACE_AFTER_FINAL_ENFORCE",
          ...buildOcrTracePayload({
            scanId,
            normalizedResult: finalVisible.normalizedResult,
            candidates: finalVisible.candidates,
            rawResponse: visionResult.rawResponse,
            enforcementApplied: finalVisible.applied,
          }),
        },
        "OCR_TRACE_AFTER_FINAL_ENFORCE",
      );
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
            year: finalVisible.candidates[0]?.year ?? finalVisible.normalizedResult.likely_year,
            make: finalVisible.candidates[0]?.make ?? finalVisible.normalizedResult.likely_make,
            model: finalVisible.candidates[0]?.model ?? finalVisible.normalizedResult.likely_model,
            source: finalVisible.normalizedResult.source ?? "visual_candidate",
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
        resolvedVehicles: finalVisible.candidates,
        hasCanonicalVehicle: finalVisible.candidates.some((vehicle) => Boolean(vehicle.vehicleId)),
      });
      writeScanStabilityCache({
        userId: input.auth.userId,
        visualHash,
        normalizedResult: finalVisible.normalizedResult,
        resolvedVehicles: finalVisible.candidates,
        confidence: finalVisible.candidates[0]?.confidence ?? finalVisible.normalizedResult.confidence,
        createdAt: Date.now(),
      });
      logger.error(
        {
          label: "SCAN_STABILITY_CACHE_WRITE",
          scanId,
          userId: input.auth.userId,
          visualHash,
          confidence: finalVisible.candidates[0]?.confidence ?? finalVisible.normalizedResult.confidence,
          vehicleIds: finalVisible.candidates.map((vehicle) => vehicle.vehicleId),
          finalResultType: finalVisible.candidates.some((vehicle) => Boolean(vehicle.vehicleId)) ? "canonical" : "ai_only",
        },
        "SCAN_STABILITY_CACHE_WRITE",
      );
      logIdentifyStage("VEHICLE_MATCH", "success", {
        scanId,
        userId: input.auth.userId,
        candidateCount: finalVisible.candidates.length,
      });

      logger.error(
        {
          label: "OCR_TRACE_BEFORE_SCAN_RECORD",
          ...buildOcrTracePayload({
            scanId,
            normalizedResult: finalVisible.normalizedResult,
            candidates: finalVisible.candidates,
            rawResponse: visionResult.rawResponse,
            enforcementApplied: finalVisible.applied,
          }),
        },
        "OCR_TRACE_BEFORE_SCAN_RECORD",
      );
      const scanRecord: ScanRecord = {
        id: scanId,
        userId: input.auth.userId,
        imageUrl: input.imageUrl,
        detectedVehicleType: finalVisible.normalizedResult.vehicle_type,
        confidence: finalVisible.normalizedResult.confidence,
        createdAt: new Date().toISOString(),
        normalizedResult: finalVisible.normalizedResult,
        candidates: finalVisible.candidates,
      };
      logger.error(
        {
          label: "OCR_TRACE_BEFORE_PERSIST",
          ...buildOcrTracePayload({
            scanId,
            normalizedResult: scanRecord.normalizedResult,
            candidates: scanRecord.candidates,
            rawResponse: visionResult.rawResponse,
            enforcementApplied: finalVisible.applied,
          }),
        },
        "OCR_TRACE_BEFORE_PERSIST",
      );

      let entitlement: { usedUnlock: boolean; alreadyUnlocked: boolean; remainingUnlocks: number; isPro: boolean } | undefined;
      if (premiumRequested && !usage.isPro && resolvedVehicles[0]) {
        const vehicle = await resolveStoredVehicleRecordById(resolvedVehicles[0].vehicleId);
        if (vehicle) {
          const unlockResult = await this.unlockService.grantUnlockForVehicle({
            userId: input.auth.userId,
            vehicle,
            scanId,
            requested: true,
          });
          if (!unlockResult.allowed) {
            throw new AppError(403, "UNLOCK_NOT_ALLOWED", "Premium access is not available for this vehicle.");
          }
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
      logger.error(
        {
          label: "OCR_TRACE_AFTER_PERSIST",
          ...buildOcrTracePayload({
            scanId,
            normalizedResult: persistedScan.normalizedResult,
            candidates: persistedScan.candidates,
            rawResponse: visionResult.rawResponse,
            enforcementApplied: finalVisible.applied,
          }),
        },
        "OCR_TRACE_AFTER_PERSIST",
      );
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

      return { scan: persistedScan, visionProvider: visionResult.provider, entitlement };
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
      await this.tryMarkImageCacheAccess(similarImage.imageKey, {
        scanId,
        source: "similar-image-hash",
      });
      const baseNormalized = normalizeVisionResult(similarImage.normalizedVehicleJson as VisionResult);
      const { normalized } = await this.applyGoogleOcrEvidence({
        scanId,
        normalized: baseNormalized,
        imageBuffer: input.processedBuffer,
        mimeType: input.processedMime,
      });
      return {
        normalized,
        rawResponse: { source: "image_cache_similar", imageKey: similarImage.imageKey, visualHash: input.visualHash, ocr: similarImage.ocrJson ?? null },
        provider: "cache:image_similar",
      };
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
      logger.error(
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
      });
      logIdentifyStage("VISION_REQUEST", "success", {
        scanId,
        userId: input.auth.userId,
        provider: result.provider,
      });
      const baseNormalized = normalizeVisionResult(result.normalized);
      const { normalized, ocrResult } = await this.applyGoogleOcrEvidence({
        scanId,
        normalized: baseNormalized,
        imageBuffer: input.processedBuffer,
        mimeType: input.processedMime,
      });
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

      if (!env.ALLOW_MOCK_FALLBACKS) {
        throw error;
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
      });
    }
  }

  private async resolveCatalogMatches(result: VisionResult, context: ProviderEnrichmentContext): Promise<MatchedVehicleCandidate[]> {
    const visibleYearEvidence = extractVisibleYearEvidence(
      result.visible_badge_text,
      result.visible_make_text,
      result.visible_model_text,
      result.visible_trim_text,
      result.visible_clues,
    );
    logger.error(
      {
        label: "VISIBLE_TEXT_EVIDENCE",
        scanId: context.scanId,
        visibleBadgeText: result.visible_badge_text ?? null,
        visibleMakeText: result.visible_make_text ?? null,
        visibleModelText: result.visible_model_text ?? null,
        visibleTrimText: result.visible_trim_text ?? null,
        visibleYearEvidence,
        emblemLogoClues: result.emblem_logo_clues ?? [],
      },
      "VISIBLE_TEXT_EVIDENCE",
    );
    logger.error(
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
    const normalizeCandidateWithEvidence = (candidate: {
      year: number;
      make: string;
      model: string;
      trim?: string;
      confidence: number;
    }) => {
      let nextConfidence = candidate.confidence;
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
        logger.error(
          {
            label: "CANDIDATE_CONTRADICTS_VISIBLE_TEXT",
            scanId: context.scanId,
            candidate,
            contradictoryModel,
            contradictoryMake,
            adjustedConfidence: nextConfidence,
          },
          "CANDIDATE_CONTRADICTS_VISIBLE_TEXT",
        );
      } else if (modelEvidenceMatch || makeEvidenceMatch || trimEvidenceMatch) {
        const evidenceBoost = (modelEvidenceMatch ? 0.24 : 0) + (makeEvidenceMatch ? 0.14 : 0) + (trimEvidenceMatch ? 0.1 : 0);
        nextConfidence = Math.min(0.995, nextConfidence + evidenceBoost);
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
        logger.error(
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
        logger.error(
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
    const visibleTextSupportsPrimaryFamily =
      hasEvidenceTokenMatch(result.likely_make, result.visible_make_text) ||
      hasEvidenceTokenMatch(result.likely_model, result.visible_model_text ?? result.visible_badge_text);
    const visibleTextDominantCandidate =
      visibleTextSupportsPrimaryFamily &&
      (Boolean(result.visible_make_text) || Boolean(result.visible_model_text ?? result.visible_badge_text) || typeof visibleYearEvidence === "number")
        ? normalizeCandidateWithEvidence({
            year: visibleYearEvidence ?? result.likely_year,
            make: result.visible_make_text ?? result.likely_make,
            model: result.visible_model_text ?? result.visible_badge_text ?? result.likely_model,
            trim: result.visible_trim_text ?? result.likely_trim,
            confidence:
              typeof visibleYearEvidence === "number"
                ? 0.997
                : 0.985,
          })
        : null;
    const visibleYearCandidate =
      typeof visibleYearEvidence === "number" &&
      visibleYearEvidence !== result.likely_year &&
      visibleTextSupportsPrimaryFamily
        ? normalizeCandidateWithEvidence({
            year: visibleYearEvidence,
            make: result.likely_make,
            model: result.likely_model,
            trim: result.likely_trim,
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

    const visibleModelFamily = normalizeModelFamily(result.visible_model_text ?? result.visible_badge_text);
    const visibleMakeFamily = normalizeMatchText(result.visible_make_text);
    let candidates = baseCandidates;
    const shouldApplyHardModelFilter = Boolean(visibleModelFamily) && result.confidence >= 0.75;
    const shouldApplyHardMakeFilter = Boolean(visibleMakeFamily);
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
          logger.error(
            {
              label: "CANDIDATE_REMOVED_CONTRADICTS_TEXT",
              scanId: context.scanId,
              candidate,
              visibleMakeText: result.visible_make_text ?? null,
              visibleModelText: result.visible_model_text ?? result.visible_badge_text ?? null,
              makeMatches,
              modelMatches,
            },
            "CANDIDATE_REMOVED_CONTRADICTS_TEXT",
          );
        }
        return keep;
      });

      if (filteredCandidates.length > 0) {
        candidates = filteredCandidates;
        logger.error(
          {
            label: "BADGE_HARD_FILTER_APPLIED",
            scanId: context.scanId,
            visibleMakeText: result.visible_make_text ?? null,
            visibleModelText: result.visible_model_text ?? result.visible_badge_text ?? null,
            originalCandidateCount: baseCandidates.length,
            filteredCandidateCount: filteredCandidates.length,
          },
          "BADGE_HARD_FILTER_APPLIED",
        );
      } else {
        logger.error(
          {
            label: "BADGE_FILTER_FALLBACK_TRIGGERED",
            scanId: context.scanId,
            visibleMakeText: result.visible_make_text ?? null,
            visibleModelText: result.visible_model_text ?? result.visible_badge_text ?? null,
            originalCandidateCount: baseCandidates.length,
          },
          "BADGE_FILTER_FALLBACK_TRIGGERED",
        );
      }
    }

    logger.error(
      {
        label: "IDENTIFY_RESULT_STABILITY_DECISION",
        scanId: context.scanId,
        primaryCandidate,
        alternateCandidates: candidates.slice(1),
        visibleModelText: result.visible_model_text ?? null,
        visibleBadgeText: result.visible_badge_text ?? null,
      },
      "IDENTIFY_RESULT_STABILITY_DECISION",
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
        logger.error(
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

    if (uniqueMatches.length > 0) {
      logger.error(
        {
          label: "VEHICLE_MATCH_SELECTED",
          selectedCount: uniqueMatches.length,
          selectedVehicleIds: uniqueMatches.map((entry) => entry.vehicleId),
          selectedVehicles: uniqueMatches.map((entry) => ({
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
      return uniqueMatches;
    }
    return [];
  }

  private async trackVehiclePopularityAndPromotion(input: {
    scanId: string;
    normalizedResult: VisionResult;
    resolvedVehicles: MatchedVehicleCandidate[];
    hasCanonicalVehicle: boolean;
  }) {
    const primary = input.resolvedVehicles[0];
    if (!primary) {
      return;
    }

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
    logger.error(
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
    logger.error(
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
      logger.error(
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
    const logStrategy = (
      strategy: string,
      vehicles: Array<VehicleRecord | MatchedVehicleCandidate | { id: string; year: number; make: string; model: string; trim?: string | null }>,
      extra: Record<string, unknown> = {},
    ) => {
      const sampleIds = vehicles.slice(0, 5).map((vehicle) => ("vehicleId" in vehicle ? vehicle.vehicleId : vehicle.id));
      logger.error(
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
      logger.error(
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
    logger.error(
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
      logger.error(
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
        logger.error(
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
      logger.error(
        {
          label: "CANONICAL_CACHE_MISS",
          canonicalKey: exactCanonicalKey,
          source: "exact-key",
          candidate,
        },
        "CANONICAL_CACHE_MISS",
      );
      logger.error(
        {
          label: "CANONICAL_LOOKUP_MISS",
          canonicalKey: exactCanonicalKey,
          source: "exact-key",
        },
        "CANONICAL_LOOKUP_MISS",
      );
      logStrategy("canonical-exact-key", [], { canonicalKey: exactCanonicalKey });
    }

    const canonicalCandidates = await repositories.canonicalVehicles.searchPromoted({
      year: candidate.year,
      normalizedMake: normalizedMake,
    });
    logStrategy("canonical-make-slice", canonicalCandidates, {
      normalizedMake,
      normalizedModel,
    });
    if (canonicalCandidates.length > 0) {
      context.canonicalHit = true;
      logger.error(
        {
          label: "CANONICAL_CACHE_HIT",
          canonicalKey: exactCanonicalKey,
          source: "promoted-search",
          candidateCount: canonicalCandidates.length,
          candidate,
        },
        "CANONICAL_CACHE_HIT",
      );
      logger.error(
        {
          label: "CANONICAL_LOOKUP_HIT",
          canonicalKey: exactCanonicalKey,
          source: "promoted-search",
          candidateCount: canonicalCandidates.length,
        },
        "CANONICAL_LOOKUP_HIT",
      );
    } else {
      logger.error(
        {
          label: "CANONICAL_CACHE_MISS",
          canonicalKey: exactCanonicalKey,
          source: "promoted-search",
          candidate,
        },
        "CANONICAL_CACHE_MISS",
      );
      logger.error(
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
      return vehicle.year === candidate.year && normalizeMatchText(vehicle.model) === normalizedModel;
    });
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
        const vehicleModel = normalizeMatchText(vehicle.model);
        const vehicleFamily = buildModelFamily(vehicle.model);
        const vehicleTokens = tokenizeMatchText(vehicle.model);
        const overlapScore = getTokenOverlapScore(candidateTokens, vehicleTokens);
        const yearDistance = Math.abs(vehicle.year - candidate.year);

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
          logger.error(
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
          logger.error(
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
          logger.error(
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
      logger.error(
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
      logger.error(
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

    if (this.shouldSkipProviderEnrichment(context, candidate)) {
      return [];
    }

    logger.error(
      {
        label: "PROVIDER_ENRICH_PRIMARY_ONLY",
        scanId: context.scanId,
        candidate,
        decision: "primary-candidate-provider-allowed",
        providerAttemptCount: context.providerAttemptCount,
      },
      "PROVIDER_ENRICH_PRIMARY_ONLY",
    );

    logger.error(
      {
        label: "CANONICAL_PROVIDER_ENRICH_START",
        source: "provider-search-candidates",
        candidate,
        provider: providers.specsProviderName,
      },
      "CANONICAL_PROVIDER_ENRICH_START",
    );
    context.providerAttempted = true;
    context.providerAttemptCount += 1;
    const providerCandidateResults = await providers.specsProvider.searchCandidates({
      year: candidate.year,
      make: candidate.make,
      model: candidate.model,
      trim: candidate.trim,
    }).catch((error) => {
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
      logger.error(
        {
          label: "CANONICAL_PROVIDER_ENRICH_START",
          source: "provider-direct-specs",
          provider: providers.specsProviderName,
          candidate,
          liveVehicleId,
        },
        "CANONICAL_PROVIDER_ENRICH_START",
      );
      context.providerAttempted = true;
      context.providerAttemptCount += 1;
      const directVehicle = await providers.specsProvider.getVehicleSpecs({
        vehicleId: liveVehicleId,
        vehicle: null,
      }).catch((error) => {
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
      logger.error(
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
    logger.error(
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
      await this.tryMarkImageCacheAccess(similarImage.imageKey, {
        source: "cache-only-similar-image-hash",
      });
      const normalized = normalizeVisionResult(similarImage.normalizedVehicleJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "image_cache_similar", imageKey: similarImage.imageKey, visualHash: input.visualHash },
        provider: "cache:image_similar",
      };
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
      return await this.analysisCacheService.beginProcessing(input);
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey: input.analysisKey,
          imageKey: input.imageKey,
          reason: error instanceof Error ? error.message : "Unknown cached analysis begin error",
          details: error instanceof AppError ? error.details : undefined,
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
    } catch (error) {
      logger.warn(
        {
          scanId: context.scanId,
          cacheLookupSource: context.source,
          analysisKey,
          imageKey: updates.imageKey,
          reason: error instanceof Error ? error.message : "Unknown cached analysis completion error",
          details: error instanceof AppError ? error.details : undefined,
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

export function normalizeVisionResult(result: VisionResult): VisionResult {
  return {
    ...result,
    likely_year: result.likely_year,
    likely_make: result.likely_make.trim(),
    likely_model: result.likely_model.trim(),
    likely_trim: result.likely_trim?.trim(),
    confidence: Math.max(0, Math.min(1, result.confidence)),
    visible_clues: result.visible_clues.map((clue) => clue.trim()).filter(Boolean),
    visible_badge_text: result.visible_badge_text?.trim(),
    visible_make_text: result.visible_make_text?.trim(),
    visible_model_text: result.visible_model_text?.trim(),
    visible_trim_text: result.visible_trim_text?.trim(),
    emblem_logo_clues: (result.emblem_logo_clues ?? []).map((clue) => clue.trim()).filter(Boolean),
    alternate_candidates: result.alternate_candidates
      .map((candidate) => ({
        ...candidate,
        likely_year: candidate.likely_year,
        likely_make: candidate.likely_make.trim(),
        likely_model: candidate.likely_model.trim(),
        likely_trim: candidate.likely_trim?.trim(),
        confidence: Math.max(0, Math.min(1, candidate.confidence)),
      }))
      .filter((candidate) => candidate.confidence >= 0.2 && candidate.likely_year > 0),
  };
}
