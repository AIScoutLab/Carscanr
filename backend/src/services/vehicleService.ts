import { AppError } from "../errors/appError.js";
import {
  buildCacheDescriptor,
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
import { mapCanonicalVehicleToRecord, resolveStoredVehicleRecordById, upsertCanonicalVehicleFromProvider } from "../lib/canonicalVehicleCatalog.js";
import { logger } from "../lib/logger.js";
import { providers } from "../lib/providerRegistry.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { parseLiveVehicleId } from "../providers/marketcheck/vehicleId.js";
import { MockVehicleListingsProvider } from "../providers/mock/mockVehicleListingsProvider.js";
import { MockVehicleValueProvider } from "../providers/mock/mockVehicleValueProvider.js";
import { ListingRecord, ValuationRecord, VehicleRecord } from "../types/domain.js";

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

function normalizeVehicleLookupText(value: string | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(lx|ex|ex l|exl|sport|touring|limited|premium|luxury|special|standard|base|se|sel|xle|le|s|sl|sv|lt|ls|gt|xlt|lariat|platinum|long range|performance)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function getErrorDetails(error: unknown) {
  return {
    message: error instanceof Error ? error.message : "Unknown vehicle service error",
    stack: error instanceof Error ? error.stack : undefined,
    code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
    details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
    hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
  };
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
  async searchVehicles(query: {
    year?: string;
    make?: string;
    model?: string;
  }) {
    const liveResults = await providers.specsProvider.searchVehicles(query).catch(() => []);
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

  async getSpecs(vehicleId: string): Promise<CachedServiceResult<VehicleRecord>> {
    const currentIso = nowIso();
    const isLiveVehicle = Boolean(parseLiveVehicleId(vehicleId));
    const vehicle = isLiveVehicle ? null : await resolveStoredVehicleRecordById(vehicleId);

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
          await upsertCanonicalVehicleFromProvider({
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
    requestId?: string;
    vehicleId: string;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<CachedServiceResult<ValuationRecord>> {
    try {
      const currentIso = nowIso();
      const parsedVehicleId = parseLiveVehicleId(input.vehicleId);
      const isLiveVehicle = Boolean(parsedVehicleId);
      const vehicle = isLiveVehicle ? null : await resolveStoredVehicleRecordById(input.vehicleId);
      logger.error(
        {
          label: "VALUE_LOOKUP_START",
          requestId: input.requestId,
          vehicleId: input.vehicleId,
          vehicleFound: Boolean(vehicle),
          year: vehicle?.year ?? null,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
          trim: vehicle?.trim ?? null,
          bodyStyle: vehicle?.bodyStyle ?? null,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
        },
        "VALUE_LOOKUP_START",
      );
      const descriptor = buildCacheDescriptor({
        vehicle,
        parsed: parsedVehicleId,
      });
      const cacheKey = descriptor ? getValuesCacheKey(descriptor, input) : null;

      if (cacheKey && providers.valueProviderName === "marketcheck") {
        const cacheDescriptor = descriptor;
        logger.error(
          {
            label: "VALUE_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "cache-read",
            vehicleId: input.vehicleId,
            cacheKey,
            year: cacheDescriptor?.year ?? null,
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

      const lookupVariants = buildVehicleLookupVariants(vehicle);
      let liveValue: ValuationRecord | null = null;

      for (const [index, variant] of lookupVariants.entries()) {
        logger.error(
          {
            label: "VALUE_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "provider-request",
            strategy: index === 0 ? "exact-canonical-fields" : index === 1 ? "trim-stripped" : "model-family",
            vehicleId: input.vehicleId,
            year: variant.year,
            make: variant.make,
            model: variant.model,
            trim: variant.trim,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
          },
          "VALUE_LOOKUP_QUERY",
        );
        liveValue = await providers.valueProvider.getValuation({ ...input, vehicle: variant });
        if (liveValue) {
          logger.error(
            {
              label: "VALUE_LOOKUP_SUCCESS",
              requestId: input.requestId,
              strategy: index === 0 ? "exact-canonical-fields" : index === 1 ? "trim-stripped" : "model-family",
              vehicleId: input.vehicleId,
              year: variant.year,
              make: variant.make,
              model: variant.model,
              trim: variant.trim,
            },
            "VALUE_LOOKUP_SUCCESS",
          );
          break;
        }
      }

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
      logger.error(
        {
          label: "VALUE_LOOKUP_EMPTY",
          requestId: input.requestId,
          vehicleId: input.vehicleId,
          year: vehicle?.year ?? null,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
          trim: vehicle?.trim ?? null,
        },
        "VALUE_LOOKUP_EMPTY",
      );
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
        logger.error(
          {
            label: "VALUE_LOOKUP_SUCCESS",
            requestId: input.requestId,
            strategy: "stored-valuation-fallback",
            vehicleId: input.vehicleId,
          },
          "VALUE_LOOKUP_SUCCESS",
        );
        return {
          data: value,
          source: "provider",
          fetchedAt: value.generatedAt,
          expiresAt: currentIso,
        };
      }

      logger.error(
        {
          label: "VALUE_LOOKUP_EMPTY",
          requestId: input.requestId,
          vehicleId: input.vehicleId,
          year: vehicle?.year ?? null,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
          trim: vehicle?.trim ?? null,
          reason: "No provider valuation and no stored valuation were found.",
        },
        "VALUE_LOOKUP_EMPTY",
      );
      throw new AppError(404, "VALUATION_NOT_FOUND", "Valuation not found for the requested vehicle.");
    } catch (error) {
      const parsedVehicleId = parseLiveVehicleId(input.vehicleId);
      const isLiveVehicle = Boolean(parsedVehicleId);
      const vehicle = isLiveVehicle ? null : await resolveStoredVehicleRecordById(input.vehicleId).catch(() => null);
      const descriptor = buildCacheDescriptor({
        vehicle,
        parsed: parsedVehicleId,
      });
      const cacheKey = descriptor ? getValuesCacheKey(descriptor, input) : null;
      logger.error(
        {
          label: "VALUE_LOOKUP_FAILURE",
          requestId: input.requestId,
          vehicleId: input.vehicleId,
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
    vehicleId: string;
    zip: string;
    radiusMiles: number;
  }): Promise<CachedServiceResult<ListingRecord[]>> {
    try {
      const currentIso = nowIso();
      const parsedVehicleId = parseLiveVehicleId(input.vehicleId);
      const isLiveVehicle = Boolean(parsedVehicleId);
      const vehicle = isLiveVehicle ? null : await resolveStoredVehicleRecordById(input.vehicleId);
      logger.error(
        {
          label: "LISTINGS_LOOKUP_START",
          requestId: input.requestId,
          vehicleId: input.vehicleId,
          vehicleFound: Boolean(vehicle),
          year: vehicle?.year ?? null,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
          trim: vehicle?.trim ?? null,
          bodyStyle: vehicle?.bodyStyle ?? null,
          zip: input.zip,
          radiusMiles: input.radiusMiles,
        },
        "LISTINGS_LOOKUP_START",
      );
      const descriptor = buildCacheDescriptor({
        vehicle,
        parsed: parsedVehicleId,
      });
      const cacheKey = descriptor ? getListingsCacheKey(descriptor, input) : null;

      if (cacheKey && providers.listingsProviderName === "marketcheck") {
        const cacheDescriptor = descriptor;
        logger.error(
          {
            label: "LISTINGS_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "cache-read",
            vehicleId: input.vehicleId,
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

      const lookupVariants = buildVehicleLookupVariants(vehicle);
      let liveListings: ListingRecord[] = [];
      for (const [index, variant] of lookupVariants.entries()) {
        logger.error(
          {
            label: "LISTINGS_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "provider-request",
            strategy: index === 0 ? "exact-canonical-fields" : index === 1 ? "trim-stripped" : "model-family",
            vehicleId: input.vehicleId,
            year: variant.year,
            make: variant.make,
            model: variant.model,
            trim: variant.trim,
            zip: input.zip,
            radiusMiles: input.radiusMiles,
          },
          "LISTINGS_LOOKUP_QUERY",
        );
        liveListings = await providers.listingsProvider.getListings({ ...input, vehicle: variant });
        if (liveListings.length > 0) {
          logger.error(
            {
              label: "LISTINGS_LOOKUP_SUCCESS",
              requestId: input.requestId,
              strategy: index === 0 ? "exact-canonical-fields" : index === 1 ? "trim-stripped" : "model-family",
              vehicleId: input.vehicleId,
              resultCount: liveListings.length,
            },
            "LISTINGS_LOOKUP_SUCCESS",
          );
          break;
        }
      }
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
      logger.error(
        {
          label: "LISTINGS_LOOKUP_EMPTY",
          requestId: input.requestId,
          vehicleId: input.vehicleId,
          year: vehicle?.year ?? null,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
          trim: vehicle?.trim ?? null,
        },
        "LISTINGS_LOOKUP_EMPTY",
      );
      const storedListings = await repositories.listingResults.listByVehicle(input);
      if (storedListings.length > 0) {
        logger.error(
          {
            label: "LISTINGS_LOOKUP_SUCCESS",
            requestId: input.requestId,
            strategy: "stored-listings-fallback",
            vehicleId: input.vehicleId,
            resultCount: storedListings.length,
          },
          "LISTINGS_LOOKUP_SUCCESS",
        );
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
        logger.error(
          {
            label: listings.length > 0 ? "LISTINGS_LOOKUP_SUCCESS" : "LISTINGS_LOOKUP_EMPTY",
            requestId: input.requestId,
            strategy: "mock-fallback",
            vehicleId: input.vehicleId,
            resultCount: listings.length,
          },
          listings.length > 0 ? "LISTINGS_LOOKUP_SUCCESS" : "LISTINGS_LOOKUP_EMPTY",
        );
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
    } catch (error) {
      const parsedVehicleId = parseLiveVehicleId(input.vehicleId);
      const isLiveVehicle = Boolean(parsedVehicleId);
      const vehicle = isLiveVehicle ? null : await resolveStoredVehicleRecordById(input.vehicleId).catch(() => null);
      const descriptor = buildCacheDescriptor({
        vehicle,
        parsed: parsedVehicleId,
      });
      const cacheKey = descriptor ? getListingsCacheKey(descriptor, input) : null;
      logger.error(
        {
          label: "LISTINGS_LOOKUP_FAILURE",
          requestId: input.requestId,
          vehicleId: input.vehicleId,
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
}
