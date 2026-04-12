import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import { logger } from "../lib/logger.js";
import { providers } from "../lib/providerRegistry.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { buildAnalysisKey, buildImageKey, buildVehicleKey } from "../lib/cacheKeys.js";
import { resizeForVision, computeDhashHex } from "../lib/imageProcessing.js";
import { AuthContext, MatchedVehicleCandidate, ScanRecord, VisionProviderResult, VisionResult } from "../types/domain.js";
import { AnalysisCacheService } from "./analysisCacheService.js";
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
      const normalizedResult = normalizeVisionResult(visionResult.normalized);
      const matchedVehicles = await this.matchVehicles(normalizedResult);

      if (matchedVehicles.length === 0) {
        throw new AppError(404, "NO_VEHICLE_MATCH", "No vehicle candidates matched the normalized AI result.");
      }
      logIdentifyStage("VEHICLE_MATCH", "success", {
        scanId,
        userId: input.auth.userId,
        candidateCount: matchedVehicles.length,
      });

      const scanRecord: ScanRecord = {
        id: scanId,
        userId: input.auth.userId,
        imageUrl: input.imageUrl,
        detectedVehicleType: normalizedResult.vehicle_type,
        confidence: normalizedResult.confidence,
        createdAt: new Date().toISOString(),
        normalizedResult,
        candidates: matchedVehicles,
      };

      let entitlement: { usedUnlock: boolean; alreadyUnlocked: boolean; remainingUnlocks: number; isPro: boolean } | undefined;
      if (premiumRequested && !usage.isPro && matchedVehicles[0]) {
        const vehicle = await repositories.vehicles.findById(matchedVehicles[0].vehicleId);
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
      const normalized = normalizeVisionResult(cachedImage.normalizedVehicleJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "image_cache", imageKey: input.imageKey },
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
      const normalized = normalizeVisionResult(similarImage.normalizedVehicleJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "image_cache_similar", imageKey: similarImage.imageKey, visualHash: input.visualHash },
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
      const normalized = normalizeVisionResult(cachedAnalysis.resultJson as VisionResult);
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
        const normalized = normalizeVisionResult(waited.resultJson as VisionResult);
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
        const normalized = normalizeVisionResult(waited.resultJson as VisionResult);
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
      const normalized = normalizeVisionResult(result.normalized);
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
          ocrJson: null,
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
      return { ...result, normalized };
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

  private async matchVehicles(result: VisionResult): Promise<MatchedVehicleCandidate[]> {
    const candidates = [
      { year: result.likely_year, make: result.likely_make, model: result.likely_model, trim: result.likely_trim, confidence: result.confidence },
      ...result.alternate_candidates.map((candidate) => ({
        year: candidate.likely_year,
        make: candidate.likely_make,
        model: candidate.likely_model,
        trim: candidate.likely_trim,
        confidence: candidate.confidence,
      })),
    ];

    const matched: MatchedVehicleCandidate[] = [];

    for (const candidate of candidates) {
      const vehicles = await repositories.vehicles.searchCandidates(candidate);
      for (const vehicle of vehicles) {
        matched.push({
          vehicleId: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim,
          confidence: candidate.confidence,
          matchReason: `Matched ${vehicle.year} ${vehicle.make} ${vehicle.model} from normalized vision output.`,
        });
      }
    }

    return matched
      .filter((entry, index, array) => array.findIndex((item) => item.vehicleId === entry.vehicleId) === index)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
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
      ocrJson: null;
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
