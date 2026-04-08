import crypto from "node:crypto";
import { AppError } from "../errors/appError.js";
import {
  buildCacheDescriptor,
  buildCanonicalKey,
  CACHE_RETENTION_MS,
  CachedServiceResult,
  createListingsCacheRow,
  createProviderApiUsageLog,
  createSpecsCacheRow,
  createValuesCacheRow,
  getListingsCacheKey,
  getSpecsCacheKey,
  getValuesCacheKey,
} from "../lib/providerCache.js";
import { logger } from "../lib/logger.js";
import { providers } from "../lib/providerRegistry.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { parseLiveVehicleId } from "../providers/marketcheck/vehicleId.js";
import { MockVehicleListingsProvider } from "../providers/mock/mockVehicleListingsProvider.js";
import { MockVehicleValueProvider } from "../providers/mock/mockVehicleValueProvider.js";
import { CanonicalVehicleRecord, ListingRecord, ValuationRecord, VehicleRecord } from "../types/domain.js";

const mockValueProvider = new MockVehicleValueProvider();
const mockListingsProvider = new MockVehicleListingsProvider();
const USAGE_LOG_RETENTION_DAYS = 60;

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

function mapCanonicalVehicleToRecord(record: CanonicalVehicleRecord): VehicleRecord | null {
  return record.specsJson ?? null;
}

function buildCanonicalVehicleCandidate(input: {
  vehicle: VehicleRecord;
  sourceProvider: string;
  sourceVehicleId: string;
}): CanonicalVehicleRecord {
  const currentIso = nowIso();
  const descriptor = buildCacheDescriptor({ vehicle: input.vehicle });
  if (!descriptor) {
    throw new Error("Unable to build canonical vehicle candidate descriptor.");
  }

  return {
    id: crypto.randomUUID(),
    year: input.vehicle.year,
    make: input.vehicle.make,
    model: input.vehicle.model,
    trim: input.vehicle.trim,
    vehicleType: input.vehicle.vehicleType,
    normalizedMake: descriptor.normalizedMake,
    normalizedModel: descriptor.normalizedModel,
    normalizedTrim: descriptor.normalizedTrim || null,
    normalizedVehicleType: input.vehicle.vehicleType,
    canonicalKey: buildCanonicalKey({
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
      trim: input.vehicle.trim,
      vehicleType: input.vehicle.vehicleType,
    }),
    specsJson: input.vehicle,
    overviewJson: {
      bodyStyle: input.vehicle.bodyStyle,
      mpgOrRange: input.vehicle.mpgOrRange,
      colors: input.vehicle.colors,
    },
    defaultImageUrl: null,
    sourceProvider: input.sourceProvider,
    sourceVehicleId: input.sourceVehicleId,
    popularityScore: 1,
    promotionStatus: "candidate",
    firstSeenAt: currentIso,
    lastSeenAt: currentIso,
    lastPromotedAt: null,
    createdAt: currentIso,
    updatedAt: currentIso,
  };
}

async function maybeUpsertCanonicalCandidate(input: {
  vehicle: VehicleRecord;
  sourceProvider: string;
  sourceVehicleId: string;
}) {
  const candidate = buildCanonicalVehicleCandidate(input);
  await repositories.canonicalVehicles.upsertCandidate(candidate);
  await repositories.canonicalVehicles.incrementPopularity(candidate.canonicalKey);
}

export class VehicleService {
  async searchVehicles(query: {
    year?: string;
    make?: string;
    model?: string;
  }) {
    const liveResults = await providers.specsProvider.searchVehicles(query).catch(() => []);
    if (liveResults.length > 0) {
      return liveResults;
    }
    return repositories.vehicles.search(query);
  }

  async getSpecs(vehicleId: string): Promise<CachedServiceResult<VehicleRecord>> {
    const currentIso = nowIso();
    const isLiveVehicle = Boolean(parseLiveVehicleId(vehicleId));
    const vehicle = isLiveVehicle ? null : await repositories.vehicles.findById(vehicleId);

    if (vehicle) {
      return {
        data: vehicle,
        source: "cache",
        fetchedAt: currentIso,
        expiresAt: currentIso,
      };
    }

    const descriptor = buildCacheDescriptor({
      vehicle,
      parsed: parseLiveVehicleId(vehicleId),
    });

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
          await repositories.canonicalVehicles.incrementPopularity(promotedCanonical.canonicalKey);
          return {
            data: canonicalVehicle,
            source: "cache",
            fetchedAt: promotedCanonical.updatedAt,
            expiresAt: promotedCanonical.updatedAt,
          };
        }
      }
    }

    const cacheKey = descriptor ? getSpecsCacheKey(descriptor) : null;
    if (cacheKey && providers.specsProviderName === "marketcheck") {
      const cached = await repositories.specsCache.findByCacheKey(cacheKey);
      if (cached) {
        if (isFresh(cached.expiresAt, currentIso)) {
          await repositories.specsCache.markAccessed(cacheKey, currentIso);
          await writeUsageLog({
            provider: cached.provider,
            endpointType: "specs",
            eventType: cached.responseJson.isEmpty ? "empty_hit" : "cache_hit",
            cacheKey,
            requestSummary: { vehicleId },
            responseSummary: {
              isEmpty: cached.responseJson.isEmpty,
              fetchedAt: cached.fetchedAt,
              expiresAt: cached.expiresAt,
            },
          });
          if (cached.responseJson.data) {
            return {
              data: cached.responseJson.data,
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
            requestSummary: { vehicleId },
            responseSummary: { previousFetchedAt: cached.fetchedAt, previousExpiresAt: cached.expiresAt },
          });
        }
      } else {
        await writeUsageLog({
          provider: providers.specsProviderName,
          endpointType: "specs",
          eventType: "miss",
          cacheKey,
          requestSummary: { vehicleId },
          responseSummary: {},
        });
      }
    }

    try {
      const liveVehicle = await providers.specsProvider.getVehicleSpecs({ vehicleId, vehicle });
      if (liveVehicle) {
        if (!vehicle) {
          await maybeUpsertCanonicalCandidate({
            vehicle: liveVehicle,
            sourceProvider: providers.specsProviderName,
            sourceVehicleId: vehicleId,
          });
        }
        if (descriptor && cacheKey && providers.specsProviderName === "marketcheck") {
          await repositories.specsCache.upsert(
            createSpecsCacheRow({
              descriptor,
              cacheKey,
              provider: providers.specsProviderName,
              payload: liveVehicle,
            }),
          );
          await fireAndForgetCleanup("specs");
        }
        return {
          data: liveVehicle,
          source: "provider",
          fetchedAt: currentIso,
          expiresAt: descriptor && cacheKey && providers.specsProviderName === "marketcheck"
            ? createSpecsCacheRow({
                descriptor,
                cacheKey,
                provider: providers.specsProviderName,
                payload: liveVehicle,
              }).expiresAt
            : currentIso,
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
    vehicleId: string;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<CachedServiceResult<ValuationRecord>> {
    const currentIso = nowIso();
    const isLiveVehicle = Boolean(parseLiveVehicleId(input.vehicleId));
    const vehicle = isLiveVehicle ? null : await repositories.vehicles.findById(input.vehicleId);
    const descriptor = buildCacheDescriptor({
      vehicle,
      parsed: parseLiveVehicleId(input.vehicleId),
    });
    const cacheKey = descriptor ? getValuesCacheKey(descriptor, input) : null;

    if (cacheKey && providers.valueProviderName === "marketcheck") {
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
            return {
              data: cached.responseJson.data,
              source: "cache",
              fetchedAt: cached.fetchedAt,
              expiresAt: cached.expiresAt,
            };
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

    try {
      const liveValue = await providers.valueProvider.getValuation({ ...input, vehicle });
      if (descriptor && cacheKey && providers.valueProviderName === "marketcheck") {
        await repositories.valuesCache.upsert(
          createValuesCacheRow({
            descriptor,
            cacheKey,
            provider: providers.valueProviderName,
            payload: liveValue,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
          }),
        );
        await fireAndForgetCleanup("values");
      }

      if (liveValue) {
        const cacheRow = descriptor && cacheKey && providers.valueProviderName === "marketcheck"
          ? createValuesCacheRow({
              descriptor,
              cacheKey,
              provider: providers.valueProviderName,
              payload: liveValue,
              zip: input.zip,
              mileage: input.mileage,
              condition: input.condition,
            })
          : null;
        return {
          data: liveValue,
          source: "provider",
          fetchedAt: cacheRow?.fetchedAt ?? currentIso,
          expiresAt: cacheRow?.expiresAt ?? currentIso,
        };
      }
    } catch (error) {
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
    }

    const seededFallback = vehicle
      ? await mockValueProvider.getValuation({
          ...input,
          vehicle,
        })
      : null;

    if (seededFallback) {
      return {
        data: seededFallback,
        source: "provider",
        fetchedAt: currentIso,
        expiresAt: currentIso,
      };
    }

    const value = await repositories.valuations.findLatest(input);
    if (value) {
      return {
        data: value,
        source: "provider",
        fetchedAt: value.generatedAt,
        expiresAt: currentIso,
      };
    }

    throw new AppError(404, "VALUATION_NOT_FOUND", "Valuation not found for the requested vehicle.");
  }

  async getListings(input: {
    vehicleId: string;
    zip: string;
    radiusMiles: number;
  }): Promise<CachedServiceResult<ListingRecord[]>> {
    const currentIso = nowIso();
    const isLiveVehicle = Boolean(parseLiveVehicleId(input.vehicleId));
    const vehicle = isLiveVehicle ? null : await repositories.vehicles.findById(input.vehicleId);
    const descriptor = buildCacheDescriptor({
      vehicle,
      parsed: parseLiveVehicleId(input.vehicleId),
    });
    const cacheKey = descriptor ? getListingsCacheKey(descriptor, input) : null;

    if (cacheKey && providers.listingsProviderName === "marketcheck") {
      const cached = await repositories.listingsCache.findByCacheKey(cacheKey);
      if (cached) {
        if (isFresh(cached.expiresAt, currentIso)) {
          await repositories.listingsCache.markAccessed(cacheKey, currentIso);
          await writeUsageLog({
            provider: cached.provider,
            endpointType: "listings",
            eventType: cached.responseJson.isEmpty ? "empty_hit" : "cache_hit",
            cacheKey,
            requestSummary: input,
            responseSummary: { count: cached.responseJson.data.length, expiresAt: cached.expiresAt },
          });
          if (!cached.responseJson.isEmpty) {
            return {
              data: cached.responseJson.data,
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

    try {
      const liveListings = await providers.listingsProvider.getListings({ ...input, vehicle });
      if (descriptor && cacheKey && providers.listingsProviderName === "marketcheck") {
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
        await fireAndForgetCleanup("listings");
      }

      if (liveListings.length > 0) {
        const cacheRow = descriptor && cacheKey && providers.listingsProviderName === "marketcheck"
          ? createListingsCacheRow({
              descriptor,
              cacheKey,
              provider: providers.listingsProviderName,
              payload: liveListings,
              zip: input.zip,
              radiusMiles: input.radiusMiles,
            })
          : null;
        return {
          data: liveListings,
          source: "provider",
          fetchedAt: cacheRow?.fetchedAt ?? currentIso,
          expiresAt: cacheRow?.expiresAt ?? currentIso,
        };
      }
    } catch (error) {
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
    }

    const storedListings = await repositories.listingResults.listByVehicle(input);
    if (storedListings.length > 0) {
      return {
        data: storedListings,
        source: "provider",
        fetchedAt: currentIso,
        expiresAt: currentIso,
      };
    }

    if (vehicle) {
      const listings = await mockListingsProvider.getListings({
        ...input,
        vehicle,
      });
      return {
        data: listings,
        source: "provider",
        fetchedAt: currentIso,
        expiresAt: currentIso,
      };
    }

    return {
      data: [],
      source: "provider",
      fetchedAt: currentIso,
      expiresAt: currentIso,
    };
  }
}
