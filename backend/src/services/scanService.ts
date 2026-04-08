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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const usage = await this.usageService.assertScanAllowed(input.auth);
    const scanId = crypto.randomUUID();

    const premiumRequested = Boolean(input.allowPremium);
    const entitlementCheck = await this.unlockService.canRequestPremium(input.auth.userId);

    const imageKey = buildImageKey(input.imageBuffer);
    const processed = await resizeForVision(input.imageBuffer);
    const visualHash = await computeDhashHex(processed.buffer);

    let visionResult: VisionProviderResult;
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
      });
    }
    logger.info(
      {
        scanId,
        userId: input.auth.userId,
        provider: visionResult.provider,
      },
      "Vision provider selected",
    );

    const normalizedResult = normalizeVisionResult(visionResult.normalized);
    const matchedVehicles = await this.matchVehicles(normalizedResult);

    if (matchedVehicles.length === 0) {
      throw new AppError(404, "NO_VEHICLE_MATCH", "No vehicle candidates matched the normalized AI result.");
    }

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

    const persistedScan = await repositories.scans.create(scanRecord);
    await repositories.visionDebug.create({
      id: crypto.randomUUID(),
      scanId,
      userId: input.auth.userId,
      provider: visionResult.provider,
      rawResponse: visionResult.rawResponse,
      normalizedResult,
      createdAt: new Date().toISOString(),
    });
    await this.usageService.incrementScanUsage(input.auth.userId);

    if (!usage.isPro) {
      await sleep(2000);
    }

    return { scan: persistedScan, visionProvider: visionResult.provider, entitlement };
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
    },
  ): Promise<VisionProviderResult> {
    // Pipeline order: image key -> visual hash -> cached analysis -> OpenAI.
    const analysisKey = buildAnalysisKey({
      analysisType: "vision_identify",
      identityType: "image_key",
      identityValue: input.imageKey,
      promptVersion: "v1",
      modelName: env.OPENAI_VISION_MODEL,
    });

    const cachedImage = await this.analysisCacheService.findImageByKey(input.imageKey);
    if (cachedImage?.normalizedVehicleJson) {
      await this.analysisCacheService.markImageAccessed(input.imageKey);
      const normalized = normalizeVisionResult(cachedImage.normalizedVehicleJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "image_cache", imageKey: input.imageKey },
        provider: "cache:image",
      };
    }

    const similarImage = await this.analysisCacheService.findSimilarImageByHash(input.visualHash);
    if (similarImage?.normalizedVehicleJson) {
      await this.analysisCacheService.markImageAccessed(similarImage.imageKey);
      const normalized = normalizeVisionResult(similarImage.normalizedVehicleJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "image_cache_similar", imageKey: similarImage.imageKey, visualHash: input.visualHash },
        provider: "cache:image_similar",
      };
    }

    const cachedAnalysis = await this.analysisCacheService.findAnalysisByKey(analysisKey);
    if (cachedAnalysis?.status === "completed" && cachedAnalysis.resultJson) {
      await this.analysisCacheService.markAnalysisAccessed(analysisKey);
      const normalized = normalizeVisionResult(cachedAnalysis.resultJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "analysis_cache", analysisKey },
        provider: "cache:analysis",
      };
    }

    if (cachedAnalysis?.status === "processing") {
      const waited = await this.analysisCacheService.waitForAnalysis(analysisKey);
      if (waited?.status === "completed" && waited.resultJson) {
        await this.analysisCacheService.markAnalysisAccessed(analysisKey);
        const normalized = normalizeVisionResult(waited.resultJson as VisionResult);
        return {
          normalized,
          rawResponse: { source: "analysis_cache_wait", analysisKey },
          provider: "cache:analysis_wait",
        };
      }
    }

    const inserted = await this.analysisCacheService.beginProcessing({
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
    });

    if (!inserted) {
      const waited = await this.analysisCacheService.waitForAnalysis(analysisKey);
      if (waited?.status === "completed" && waited.resultJson) {
        await this.analysisCacheService.markAnalysisAccessed(analysisKey);
        const normalized = normalizeVisionResult(waited.resultJson as VisionResult);
        return {
          normalized,
          rawResponse: { source: "analysis_cache_wait", analysisKey },
          provider: "cache:analysis_wait",
        };
      }
      logger.warn({ scanId, analysisKey }, "Analysis already in progress; returning fallback preview.");
      if (!env.ALLOW_MOCK_FALLBACKS) {
        throw new AppError(503, "VISION_ANALYSIS_PENDING", "Vehicle analysis is still processing. Please retry in a moment.");
      }
      return providers.fallbackVisionProvider.identifyFromImage({
        imageBuffer: input.processedBuffer,
        mimeType: input.processedMime,
        fileName: input.imageUrl.split("/").pop(),
      });
    }

    try {
      const result = await providers.visionProvider.identifyFromImage({
        imageBuffer: input.processedBuffer,
        mimeType: input.processedMime,
        fileName: input.imageUrl.split("/").pop(),
      });
      const normalized = normalizeVisionResult(result.normalized);
      const vehicleKey = buildVehicleKey({
        year: normalized.likely_year,
        make: normalized.likely_make,
        model: normalized.likely_model,
        trim: normalized.likely_trim,
        vehicleType: normalized.vehicle_type,
      });

      await this.analysisCacheService.completeAnalysis(analysisKey, normalized, {
        costEstimate: null,
        vehicleKey,
        imageKey: input.imageKey,
        visualHash: input.visualHash,
      });
      await this.analysisCacheService.upsertImageCache({
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
      });
      return { ...result, normalized };
    } catch (error) {
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
      await this.analysisCacheService.failAnalysis(
        analysisKey,
        error instanceof Error ? error.message : "Unknown vision provider error.",
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
    const cachedImage = await this.analysisCacheService.findImageByKey(input.imageKey);
    if (cachedImage?.normalizedVehicleJson) {
      await this.analysisCacheService.markImageAccessed(input.imageKey);
      const normalized = normalizeVisionResult(cachedImage.normalizedVehicleJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "image_cache", imageKey: input.imageKey },
        provider: "cache:image",
      };
    }

    const similarImage = await this.analysisCacheService.findSimilarImageByHash(input.visualHash);
    if (similarImage?.normalizedVehicleJson) {
      await this.analysisCacheService.markImageAccessed(similarImage.imageKey);
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
    const cachedAnalysis = await this.analysisCacheService.findAnalysisByKey(analysisKey);
    if (cachedAnalysis?.status === "completed" && cachedAnalysis.resultJson) {
      await this.analysisCacheService.markAnalysisAccessed(analysisKey);
      const normalized = normalizeVisionResult(cachedAnalysis.resultJson as VisionResult);
      return {
        normalized,
        rawResponse: { source: "analysis_cache", analysisKey },
        provider: "cache:analysis",
      };
    }

    return null;
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
