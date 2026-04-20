import { AppError } from "../errors/appError.js";
import { env } from "../config/env.js";
import { upsertCanonicalVehicleFromAiLearned, upsertCanonicalVehicleFromProvider } from "../lib/canonicalVehicleCatalog.js";
import { logger } from "../lib/logger.js";
import { providers } from "../lib/providerRegistry.js";
import { buildCanonicalKey, normalizeLookupText } from "../lib/providerCache.js";
import { repositories } from "../lib/repositoryRegistry.js";

const TRENDING_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const TRENDING_PRESEED_THRESHOLD = 20;
const PRELOAD_BATCH_LIMIT = 50;
const POPULAR_BRANDS = new Set(["ford", "toyota", "honda", "bmw", "chevrolet", "chevy", "nissan", "hyundai", "kia", "gmc", "ram", "jeep", "subaru", "lexus", "tesla"]);
const HIGH_VOLUME_MODEL_HINTS = ["suv", "truck", "f150", "f-150", "rav4", "crv", "cr-v", "silverado", "camry", "accord", "civic", "corolla", "explorer", "expedition", "tacoma"];

function titleize(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 && /\d/.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function computeRecentScanCount(globalScanCount: number, lastSeenAt: string) {
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (ageMs <= 24 * 60 * 60 * 1000) {
    return globalScanCount;
  }
  if (ageMs <= 72 * 60 * 60 * 1000) {
    return Math.max(1, Math.ceil(globalScanCount / 2));
  }
  return 0;
}

function computePriorityBoost(input: { normalizedMake: string; normalizedModel: string }) {
  let boost = 0;
  if (POPULAR_BRANDS.has(input.normalizedMake)) {
    boost += 5;
  }
  if (HIGH_VOLUME_MODEL_HINTS.some((hint) => input.normalizedModel.includes(normalizeLookupText(hint).replace(/\s+/g, "")) || input.normalizedModel.includes(normalizeLookupText(hint)))) {
    boost += 4;
  }
  return boost;
}

function isRateLimitError(error: unknown) {
  return error instanceof AppError && error.statusCode === 429;
}

function describeTrendingFailure(error: unknown) {
  if (!(error instanceof AppError)) {
    return {
      code: null,
      message: error instanceof Error ? error.message : "Unknown trending refresh failure",
      details: null,
      probableCause: "unknown",
    };
  }

  const details = (error.details && typeof error.details === "object") ? (error.details as Record<string, unknown>) : null;
  const pgCode = typeof details?.code === "string" ? details.code : null;
  let probableCause = "query_or_runtime_error";
  if (pgCode === "42P01") probableCause = "missing_table";
  else if (pgCode === "42703") probableCause = "missing_column";
  else if (pgCode === "42501") probableCause = "insufficient_privilege";

  return {
    code: error.code,
    message: error.message,
    details,
    probableCause,
  };
}

export class TrendingVehicleService {
  async refreshGlobalTrending() {
    const popularityRows = await repositories.vehicleScanPopularity.listTop(500);
    for (const row of popularityRows) {
      const recentScanCount = computeRecentScanCount(row.scanCount, row.lastSeenAt);
      const priorityBoost = computePriorityBoost({
        normalizedMake: row.normalizedMake,
        normalizedModel: row.normalizedModel,
      });
      if (priorityBoost > 0) {
        logger.error(
          {
            label: "TREND_PRIORITY_BOOST_APPLIED",
            normalizedKey: row.normalizedKey,
            normalizedMake: row.normalizedMake,
            normalizedModel: row.normalizedModel,
            boost: priorityBoost,
          },
          "TREND_PRIORITY_BOOST_APPLIED",
        );
      }
      const trendScore = (recentScanCount * 2) + row.scanCount + priorityBoost;
      await repositories.vehicleGlobalTrending.upsert({
        id: row.id,
        normalizedKey: row.normalizedKey,
        year: row.year,
        normalizedMake: row.normalizedMake,
        normalizedModel: row.normalizedModel,
        normalizedTrim: row.normalizedTrim,
        globalScanCount: row.scanCount,
        recentScanCount,
        trendScore,
        lastSeenAt: row.lastSeenAt,
        createdAt: row.createdAt,
        updatedAt: new Date().toISOString(),
      });
    }
    logger.error(
      {
        label: "GLOBAL_TRENDING_UPDATED",
        rowCount: popularityRows.length,
      },
      "GLOBAL_TRENDING_UPDATED",
    );
  }

  async preloadTrendingCanonicalBatch() {
    logger.error(
      {
        label: "CANONICAL_PRELOAD_BATCH_STARTED",
        limit: PRELOAD_BATCH_LIMIT,
        threshold: TRENDING_PRESEED_THRESHOLD,
      },
      "CANONICAL_PRELOAD_BATCH_STARTED",
    );
    const trendingRows = await repositories.vehicleGlobalTrending.listTop(PRELOAD_BATCH_LIMIT);
    let processed = 0;
    for (const row of trendingRows) {
      if (row.trendScore < TRENDING_PRESEED_THRESHOLD) {
        continue;
      }
      const canonicalKey = buildCanonicalKey({
        year: row.year,
        make: titleize(row.normalizedMake),
        model: titleize(row.normalizedModel),
        trim: titleize(row.normalizedTrim === "base" ? "" : row.normalizedTrim),
        vehicleType: "car",
      });
      const existing = await repositories.canonicalVehicles.findByCanonicalKey(canonicalKey);
      if (existing) {
        continue;
      }
      try {
        const providerCandidates = await providers.specsProvider.searchCandidates({
          year: row.year,
          make: titleize(row.normalizedMake),
          model: titleize(row.normalizedModel),
          trim: row.normalizedTrim === "base" ? undefined : titleize(row.normalizedTrim),
        });
        if (providerCandidates.length > 0) {
          const canonical = await upsertCanonicalVehicleFromProvider({
            vehicle: providerCandidates[0],
            sourceProvider: "preseed_provider",
            sourceVehicleId: providerCandidates[0].id,
          });
          logger.error(
            {
              label: "CANONICAL_PRESEEDED_FROM_TREND",
              normalizedKey: row.normalizedKey,
              canonicalId: canonical.id,
              trendScore: row.trendScore,
            },
            "CANONICAL_PRESEEDED_FROM_TREND",
          );
        } else {
          const canonical = await upsertCanonicalVehicleFromAiLearned({
            year: row.year,
            make: titleize(row.normalizedMake),
            model: titleize(row.normalizedModel),
            trim: row.normalizedTrim === "base" ? "" : titleize(row.normalizedTrim),
            vehicleType: "car",
          });
          logger.error(
            {
              label: "CANONICAL_PRESEEDED_AI_FALLBACK",
              normalizedKey: row.normalizedKey,
              canonicalId: canonical.id,
              trendScore: row.trendScore,
            },
            "CANONICAL_PRESEEDED_AI_FALLBACK",
          );
        }
        processed += 1;
      } catch (error) {
        if (isRateLimitError(error)) {
          logger.error(
            {
              label: "PRESEED_RATE_LIMIT_BACKOFF",
              normalizedKey: row.normalizedKey,
              trendScore: row.trendScore,
              message: error instanceof Error ? error.message : "Provider rate limited during preseed.",
            },
            "PRESEED_RATE_LIMIT_BACKOFF",
          );
          break;
        }
        const canonical = await upsertCanonicalVehicleFromAiLearned({
          year: row.year,
          make: titleize(row.normalizedMake),
          model: titleize(row.normalizedModel),
          trim: row.normalizedTrim === "base" ? "" : titleize(row.normalizedTrim),
          vehicleType: "car",
        });
        logger.error(
          {
            label: "CANONICAL_PRESEEDED_AI_FALLBACK",
            normalizedKey: row.normalizedKey,
            canonicalId: canonical.id,
            trendScore: row.trendScore,
            message: error instanceof Error ? error.message : "Unknown preseed provider failure",
          },
          "CANONICAL_PRESEEDED_AI_FALLBACK",
        );
      }
    }
    logger.error(
      {
        label: "CANONICAL_PRELOAD_BATCH_COMPLETED",
        processed,
      },
      "CANONICAL_PRELOAD_BATCH_COMPLETED",
    );
  }

  startScheduler() {
    const run = async () => {
      try {
        await this.refreshGlobalTrending();
      } catch (error) {
        const failure = describeTrendingFailure(error);
        logger.error(
          {
            label: "GLOBAL_TRENDING_REFRESH_FAILED",
            message: failure.message,
            code: failure.code,
            probableCause: failure.probableCause,
            details: failure.details,
            stack: error instanceof Error ? error.stack : undefined,
          },
          "GLOBAL_TRENDING_REFRESH_FAILED",
        );
      }

      const preloadDisabledInProduction = env.APP_ENV === "production";
      if (preloadDisabledInProduction || !env.ALLOW_PRELOAD) {
        logger.info(
          {
            label: "PRELOAD_SKIPPED_PRODUCTION",
            appEnv: env.APP_ENV,
            allowPreload: env.ALLOW_PRELOAD,
            reason: preloadDisabledInProduction ? "production-app-env" : "allow-preload-disabled",
          },
          "PRELOAD_SKIPPED_PRODUCTION",
        );
        return;
      }

      try {
        await this.preloadTrendingCanonicalBatch();
      } catch (error) {
        const failure = describeTrendingFailure(error);
        logger.error(
          {
            label: "GLOBAL_TRENDING_PRELOAD_FAILED",
            message: failure.message,
            code: failure.code,
            probableCause: failure.probableCause,
            details: failure.details,
            stack: error instanceof Error ? error.stack : undefined,
          },
          "GLOBAL_TRENDING_PRELOAD_FAILED",
        );
      }
    };
    run().catch((error) => {
      logger.error(
        {
          label: "GLOBAL_TRENDING_SCHEDULER_FAILED",
          message: error instanceof Error ? error.message : "Unknown scheduler failure",
          stack: error instanceof Error ? error.stack : undefined,
        },
        "GLOBAL_TRENDING_SCHEDULER_FAILED",
      );
    });
    return setInterval(() => {
      run().catch((error) => {
        logger.error(
          {
            label: "GLOBAL_TRENDING_SCHEDULER_FAILED",
            message: error instanceof Error ? error.message : "Unknown scheduler failure",
            stack: error instanceof Error ? error.stack : undefined,
          },
          "GLOBAL_TRENDING_SCHEDULER_FAILED",
        );
      });
    }, TRENDING_REFRESH_INTERVAL_MS);
  }
}

export const trendingVehicleService = new TrendingVehicleService();
export const TRENDING_JOB_INTERVAL_MS = TRENDING_REFRESH_INTERVAL_MS;
export const TRENDING_PRESEED_SCORE_THRESHOLD = TRENDING_PRESEED_THRESHOLD;
