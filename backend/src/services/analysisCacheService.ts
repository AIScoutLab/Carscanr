import crypto from "node:crypto";
import { logger } from "../lib/logger.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { CachedAnalysisRecord, ImageCacheRecord } from "../types/domain.js";
import { hammingDistanceHex } from "../lib/imageProcessing.js";

const DEFAULT_WAIT_MS = 400;
const DEFAULT_WAIT_LIMIT_MS = 12000;
const SIMILAR_HASH_DISTANCE = 8;
const SIMILAR_IMAGE_LOOKBACK = 25;

function nowIso() {
  return new Date().toISOString();
}

function isSupabaseConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export class AnalysisCacheService {
  async findAnalysisByKey(analysisKey: string) {
    return repositories.cachedAnalysis.findByAnalysisKey(analysisKey);
  }

  async markAnalysisAccessed(analysisKey: string) {
    await repositories.cachedAnalysis.markAccessed(analysisKey, nowIso());
  }

  async waitForAnalysis(analysisKey: string, timeoutMs = DEFAULT_WAIT_LIMIT_MS) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const entry = await repositories.cachedAnalysis.findByAnalysisKey(analysisKey);
      if (entry && entry.status !== "processing") {
        return entry;
      }
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_WAIT_MS));
    }
    return null;
  }

  async beginProcessing(input: {
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
  }) {
    const record: CachedAnalysisRecord = {
      id: crypto.randomUUID(),
      analysisKey: input.analysisKey,
      analysisType: input.analysisType,
      identityType: input.identityType ?? null,
      identityValue: input.identityValue ?? null,
      vin: input.vin ?? null,
      vinKey: input.vinKey ?? null,
      vehicleKey: input.vehicleKey ?? null,
      listingKey: input.listingKey ?? null,
      imageKey: input.imageKey ?? null,
      visualHash: input.visualHash ?? null,
      promptVersion: input.promptVersion,
      modelName: input.modelName,
      status: "processing",
      resultJson: null,
      errorText: null,
      costEstimate: input.costEstimate ?? null,
      expiresAt: input.expiresAt ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastAccessedAt: nowIso(),
      hitCount: 0,
    };

    try {
      return await repositories.cachedAnalysis.insert(record);
    } catch (error) {
      if (isSupabaseConflict(error)) {
        return null;
      }
      throw error;
    }
  }

  async completeAnalysis(
    analysisKey: string,
    resultJson: unknown,
    updates?: {
      costEstimate?: number | null;
      vehicleKey?: string | null;
      imageKey?: string | null;
      visualHash?: string | null;
    },
  ) {
    return repositories.cachedAnalysis.update(analysisKey, {
      status: "completed",
      resultJson,
      errorText: null,
      costEstimate: updates?.costEstimate ?? null,
      vehicleKey: updates?.vehicleKey ?? undefined,
      imageKey: updates?.imageKey ?? undefined,
      visualHash: updates?.visualHash ?? undefined,
      updatedAt: nowIso(),
      lastAccessedAt: nowIso(),
    });
  }

  async failAnalysis(analysisKey: string, errorText: string) {
    return repositories.cachedAnalysis.update(analysisKey, {
      status: "failed",
      errorText,
      updatedAt: nowIso(),
      lastAccessedAt: nowIso(),
    });
  }

  async findImageByKey(imageKey: string) {
    return repositories.imageCache.findByImageKey(imageKey);
  }

  async findSimilarImageByHash(visualHash: string | null | undefined) {
    if (!visualHash) return null;
    const recent = await repositories.imageCache.listRecent(SIMILAR_IMAGE_LOOKBACK);
    let best: ImageCacheRecord | null = null;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (const entry of recent) {
      if (!entry.visualHash) continue;
      const distance = hammingDistanceHex(visualHash, entry.visualHash);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    if (best && bestDistance <= SIMILAR_HASH_DISTANCE) {
      return best;
    }
    return null;
  }

  async upsertImageCache(entry: ImageCacheRecord) {
    return repositories.imageCache.upsert(entry);
  }

  async markImageAccessed(imageKey: string) {
    await repositories.imageCache.markAccessed(imageKey, nowIso());
  }

  logSupabaseMissingWarning() {
    if (!repositories.cachedAnalysis || !repositories.imageCache) {
      logger.warn("Supabase-backed cache repositories are not configured; AI cache will run in fallback mode.");
    }
  }
}
