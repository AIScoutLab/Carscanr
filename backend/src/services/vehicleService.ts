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
} from "../lib/providerCache.js";
import { mapCanonicalVehicleToRecord, resolveStoredVehicleRecordById, upsertCanonicalVehicleFromProvider } from "../lib/canonicalVehicleCatalog.js";
import { logger } from "../lib/logger.js";
import { providers } from "../lib/providerRegistry.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { parseLiveVehicleId } from "../providers/marketcheck/vehicleId.js";
import { MockVehicleListingsProvider } from "../providers/mock/mockVehicleListingsProvider.js";
import { MockVehicleValueProvider } from "../providers/mock/mockVehicleValueProvider.js";
import { ListingRecord, PayloadEvaluation, ValuationRecord, VehicleLookupDescriptor, VehicleRecord } from "../types/domain.js";
import { fetchNhtsaData } from "./nhtsaService.js";

const mockValueProvider = new MockVehicleValueProvider();
const mockListingsProvider = new MockVehicleListingsProvider();
const USAGE_LOG_RETENTION_DAYS = 60;
const DEFAULT_UNLOCK_EVALUATION_ZIP = "60610";
const DEFAULT_UNLOCK_EVALUATION_MILEAGE = 25000;
const DEFAULT_UNLOCK_EVALUATION_CONDITION = "good";
const DEFAULT_UNLOCK_EVALUATION_RADIUS_MILES = 50;

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

type ListingsLookupAttempt = {
  label:
    | "LISTINGS_EXACT_TRIM_MATCH"
    | "LISTINGS_SAME_MODEL_MIXED_TRIMS"
    | "LISTINGS_ADJACENT_YEAR_MIXED_TRIMS"
    | "LISTINGS_GENERATION_MIXED_TRIMS"
    | "LISTINGS_SIMILAR_FALLBACK";
  strategy:
    | "exact-year-make-model"
    | "same-year-any-trim"
    | "adjacent-year-previous"
    | "adjacent-year-next"
    | "same-model-radius-100"
    | "same-model-radius-300"
    | "same-generation"
    | "similar-vehicle";
  vehicle: VehicleRecord;
  radiusMiles: number;
};

type ValueLookupAttempt = {
  strategy:
    | "exact-year-make-model"
    | "same-year-any-trim"
    | "adjacent-year-previous"
    | "adjacent-year-next"
    | "same-generation"
    | "similar-vehicle";
  vehicle: VehicleRecord;
};

type ListingsDebugMode =
  | "exact_trim"
  | "same_model_mixed_trims"
  | "adjacent_year_mixed_trims"
  | "generation_fallback"
  | "similar_vehicle_fallback"
  | "none";

type ListingsDebugMeta = {
  sourceLabel: string | null;
  rawCount: number;
  believableCount: number;
  mode: ListingsDebugMode;
  fallbackReason: string | null;
};

function resolveListingsDebugMode(strategy: ListingsLookupAttempt["strategy"] | null): ListingsDebugMode {
  if (strategy === "exact-year-make-model") {
    return "exact_trim";
  }
  if (strategy === "same-year-any-trim" || strategy === "same-model-radius-100" || strategy === "same-model-radius-300") {
    return "same_model_mixed_trims";
  }
  if (strategy === "adjacent-year-previous" || strategy === "adjacent-year-next") {
    return "adjacent_year_mixed_trims";
  }
  if (strategy === "same-generation") {
    return "generation_fallback";
  }
  if (strategy === "similar-vehicle") {
    return "similar_vehicle_fallback";
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
    vehicleType: descriptor.vehicleType === "motorcycle" ? "motorcycle" : "car",
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
    vehicleType: descriptor.vehicleType === "motorcycle" ? "motorcycle" : "car",
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

  const effectiveDescriptor = vehicle
    ? {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
        vehicleType: vehicle.vehicleType,
        bodyStyle: vehicle.bodyStyle,
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
        vehicle,
        parsed: {
          year: effectiveDescriptor.year,
          make: effectiveDescriptor.make,
          model: effectiveDescriptor.model,
          trim: effectiveDescriptor.trim ?? undefined,
          vehicleType: effectiveDescriptor.vehicleType ?? undefined,
        },
      })
    : null;

  const lookupVehicle = vehicle ?? buildLookupVehicleFromRawDescriptor(effectiveDescriptor) ?? buildLookupVehicleFromDescriptor(cacheDescriptor);
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
    vehicle,
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
    normalizeVehicleLookupText(vehicle.trim),
    normalizeVehicleLookupText(vehicle.bodyStyle),
    radiusMiles,
  ].join("|");
}

function isGenerationSensitiveVehicle(vehicle: VehicleRecord) {
  const make = normalizeVehicleLookupText(vehicle.make);
  const model = normalizeVehicleLookupText(vehicle.model);
  const body = normalizeVehicleLookupText(vehicle.bodyStyle);
  const combined = `${make} ${model}`.trim();
  return (
    /wrangler|gladiator/.test(combined) ||
    /f 150|f150|silverado|sierra|ram|tacoma|tundra|ranger|colorado|canyon/.test(combined) ||
    /mustang|camaro|challenger|charger|corvette/.test(combined) ||
    /truck|pickup/.test(body)
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

function buildEstimatedMarketRangeFromVehicle(input: {
  vehicle: VehicleRecord;
  vehicleId: string;
  zip: string;
  mileage: number;
  condition: string;
}): ValuationRecord | null {
  const msrp = typeof input.vehicle.msrp === "number" && Number.isFinite(input.vehicle.msrp) && input.vehicle.msrp > 0 ? input.vehicle.msrp : null;
  if (!msrp) {
    return null;
  }

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
    sourceLabel: "Estimated market range",
    confidenceLabel: "Limited data",
    modelType: "modeled",
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

  return {
    id: `derived-market-range:${input.vehicleId}:${input.zip}:${input.mileage}`,
    vehicleId: input.vehicleId,
    zip: input.zip,
    mileage: input.mileage,
    condition: normalizeCondition(input.condition),
    tradeIn,
    tradeInLow: Math.round(adjustedLow * 0.92),
    tradeInHigh: Math.round(adjustedHigh * 0.92),
    privateParty: adjustedMedian,
    privatePartyLow: adjustedLow,
    privatePartyHigh: adjustedHigh,
    dealerRetail,
    dealerRetailLow: Math.round(adjustedLow * 1.08),
    dealerRetailHigh: Math.round(adjustedHigh * 1.08),
    currency: "USD",
    generatedAt: new Date().toISOString(),
    sourceLabel: "Estimated from similar vehicles",
    confidenceLabel: prices.length >= 6 ? "Moderate confidence" : "Limited data",
    modelType: "listing_derived",
    listingCount: prices.length,
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

  const collectedListings: ListingRecord[] = [];
  const seenListingIds = new Set<string>();

  for (const attempt of listingAttempts) {
    const listings = await providers.listingsProvider.getListings({
      vehicleId: attempt.vehicle.id,
      vehicle: attempt.vehicle,
      zip: input.zip,
      radiusMiles: attempt.radiusMiles,
    }).catch(() => []);

    for (const listing of listings) {
      if (seenListingIds.has(listing.id) || !isBelievableListing(listing)) {
        continue;
      }
      seenListingIds.add(listing.id);
      collectedListings.push(listing);
    }

    if (collectedListings.length >= 1 && attempt.strategy.startsWith("adjacent-year")) {
      // Adjacent-year rescue is already good enough to produce a usable estimate.
      break;
    }
  }

  return buildDerivedValuationFromListings({
    vehicle: input.vehicle,
    vehicleId: input.vehicleId,
    zip: input.zip,
    mileage: input.mileage,
    condition: input.condition,
    listings: collectedListings,
  });
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
  if (normalizeVehicleLookupText(vehicle.trim)) {
    pushAttempt({ strategy: "same-year-any-trim", vehicle: { ...vehicle, trim: "" } });
  }
  if (vehicle.year > 1981) {
    pushAttempt({ strategy: "adjacent-year-previous", vehicle: { ...vehicle, year: vehicle.year - 1, trim: "" } });
  }
  pushAttempt({ strategy: "adjacent-year-next", vehicle: { ...vehicle, year: vehicle.year + 1, trim: "" } });

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
  if (normalizeVehicleLookupText(vehicle.trim)) {
    fallbackAttempts.push({ strategy: "same-year-any-trim", vehicle: { ...vehicle, trim: "" } });
  }
  if (vehicle.year > 1981) {
    fallbackAttempts.push({ strategy: "adjacent-year-previous", vehicle: { ...vehicle, year: vehicle.year - 1, trim: "" } });
  }
  fallbackAttempts.push({ strategy: "adjacent-year-next", vehicle: { ...vehicle, year: vehicle.year + 1, trim: "" } });
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
    const key = vehicleLookupKey(attempt.vehicle, attempt.radiusMiles);
    if (!attempts.some((entry) => vehicleLookupKey(entry.vehicle, entry.radiusMiles) === key)) {
      attempts.push(attempt);
    }
  };

  pushAttempt({
    label: "LISTINGS_EXACT_TRIM_MATCH",
    strategy: "exact-year-make-model",
    vehicle: { ...input.vehicle },
    radiusMiles: input.radiusMiles,
  });

  if (normalizeVehicleLookupText(input.vehicle.trim)) {
    pushAttempt({
      label: "LISTINGS_SAME_MODEL_MIXED_TRIMS",
      strategy: "same-year-any-trim",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: input.radiusMiles,
    });
  }

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

  for (const expandedRadius of [100, 300]) {
    if (expandedRadius > input.radiusMiles) {
      pushAttempt({
        label: "LISTINGS_SAME_MODEL_MIXED_TRIMS",
        strategy: expandedRadius === 100 ? "same-model-radius-100" : "same-model-radius-300",
        vehicle: { ...input.vehicle, trim: "" },
        radiusMiles: expandedRadius,
      });
    }
  }

  const descriptor = buildCacheDescriptor({ vehicle: input.vehicle });
  if (!descriptor) {
    return attempts;
  }

  const familyCandidates = await repositories.canonicalVehicles.searchPromoted({
    normalizedMake: descriptor.normalizedMake,
    normalizedModel: descriptor.normalizedModel,
  });
  const generationBucket = getGenerationBucket(input.vehicle);
  const sameGenerationCandidate = familyCandidates
    .map((candidate) => mapCanonicalVehicleToRecord(candidate))
    .filter((candidate): candidate is VehicleRecord => Boolean(candidate))
    .find((candidate) => {
      if (candidate.id === input.vehicle.id) {
        return false;
      }
      if (normalizeVehicleLookupText(candidate.bodyStyle) !== normalizeVehicleLookupText(input.vehicle.bodyStyle)) {
        return false;
      }
      if (generationBucket) {
        return getGenerationBucket(candidate) === generationBucket;
      }
      return Math.abs(candidate.year - input.vehicle.year) <= 3;
    });

  pushAttempt(
    sameGenerationCandidate
      ? {
          label: "LISTINGS_GENERATION_MIXED_TRIMS",
          strategy: "same-generation",
          vehicle: { ...sameGenerationCandidate, trim: "" },
          radiusMiles: Math.max(input.radiusMiles, 100),
        }
      : null,
  );
  if (!sameGenerationCandidate) {
    pushAttempt({
      label: "LISTINGS_GENERATION_MIXED_TRIMS",
      strategy: "same-generation",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: Math.max(input.radiusMiles, 100),
    });
  }

  const similarCandidates = await repositories.canonicalVehicles.searchPromoted({
    normalizedMake: descriptor.normalizedMake,
  });
  const trimFamily = getTrimFamily(input.vehicle);
  const similarVehicleCandidate = similarCandidates
    .map((candidate) => mapCanonicalVehicleToRecord(candidate))
    .filter((candidate): candidate is VehicleRecord => Boolean(candidate))
    .find((candidate) => {
      if (candidate.id === input.vehicle.id) {
        return false;
      }
      if (normalizeVehicleLookupText(candidate.model) === normalizeVehicleLookupText(input.vehicle.model)) {
        return false;
      }
      if (normalizeVehicleLookupText(candidate.bodyStyle) !== normalizeVehicleLookupText(input.vehicle.bodyStyle)) {
        return false;
      }
      if (candidate.vehicleType !== input.vehicle.vehicleType) {
        return false;
      }
      if (Math.abs(candidate.year - input.vehicle.year) > 4) {
        return false;
      }
      if (trimFamily) {
        return getTrimFamily(candidate) === trimFamily;
      }
      return Math.abs(candidate.year - input.vehicle.year) <= 2;
    });

  pushAttempt(
    similarVehicleCandidate
      ? {
          label: "LISTINGS_SIMILAR_FALLBACK",
          strategy: "similar-vehicle",
          vehicle: { ...similarVehicleCandidate, trim: "" },
          radiusMiles: Math.max(input.radiusMiles, 100),
        }
      : null,
  );

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
  if (normalizeVehicleLookupText(input.vehicle.trim)) {
    fallbackAttempts.push({
      label: "LISTINGS_SAME_MODEL_MIXED_TRIMS",
      strategy: "same-year-any-trim",
      vehicle: { ...input.vehicle, trim: "" },
      radiusMiles: input.radiusMiles,
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
  fallbackAttempts.push({
    label: "LISTINGS_GENERATION_MIXED_TRIMS",
    strategy: "same-generation",
    vehicle: { ...input.vehicle, trim: "" },
    radiusMiles: Math.max(input.radiusMiles, 100),
  });
  return fallbackAttempts;
}

async function buildPartialSpecFallbackVehicle(vehicle: VehicleRecord): Promise<VehicleRecord | null> {
  const descriptor = buildCacheDescriptor({ vehicle });
  if (!descriptor) {
    return hasUsefulSpecBundle(vehicle) ? vehicle : null;
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
    return hasUsefulSpecBundle(vehicle) ? vehicle : null;
  }

  return {
    ...vehicle,
    bodyStyle: coalesceString(vehicle.bodyStyle, nearest.bodyStyle) ?? vehicle.bodyStyle,
    engine: coalesceString(vehicle.engine, nearest.engine) ?? vehicle.engine,
    horsepower: coalescePositiveNumber(vehicle.horsepower, nearest.horsepower),
    torque: coalesceString(vehicle.torque, nearest.torque) ?? vehicle.torque,
    transmission: coalesceString(vehicle.transmission, nearest.transmission) ?? vehicle.transmission,
    drivetrain: coalesceString(vehicle.drivetrain, nearest.drivetrain) ?? vehicle.drivetrain,
    mpgOrRange: coalesceString(vehicle.mpgOrRange, nearest.mpgOrRange) ?? vehicle.mpgOrRange,
    msrp: coalescePositiveNumber(vehicle.msrp, nearest.msrp) ?? vehicle.msrp,
    engineDisplacementL: coalescePositiveNumber(vehicle.engineDisplacementL, nearest.engineDisplacementL),
    cylinders: coalescePositiveNumber(vehicle.cylinders, nearest.cylinders),
    fuelType: coalesceString(vehicle.fuelType, nearest.fuelType),
    doors: coalescePositiveNumber(vehicle.doors, nearest.doors),
  };
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
  return [valuation.tradeIn, valuation.privateParty, valuation.dealerRetail].some((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
}

function isBelievableListing(listing: ListingRecord) {
  return Boolean(
    typeof listing.price === "number" &&
      Number.isFinite(listing.price) &&
      listing.price > 0 &&
      (isMeaningfulText(listing.title) || isMeaningfulText(listing.dealer) || isMeaningfulText(listing.location)),
  );
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
  const providerRangeAvailable =
    typeof valuation.privatePartyLow === "number" &&
    typeof valuation.privatePartyHigh === "number" &&
    typeof valuation.tradeInLow === "number" &&
    typeof valuation.tradeInHigh === "number" &&
    typeof valuation.dealerRetailLow === "number" &&
    typeof valuation.dealerRetailHigh === "number";

  const modelType = providerRangeAvailable ? "provider_range" : valuation.modelType ?? "modeled";
  logger.error(
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
    logger.error(
      {
        label: "VALUE_PROVIDER_RANGE_USED",
        vehicleId: valuation.vehicleId,
        fields: ["price.min", "price.median", "price.max", "price.mean"],
        source: input.source,
      },
      "VALUE_PROVIDER_RANGE_USED",
    );
  } else {
    const privateWidth = getVehicleRangeProfile(input.vehicle, valuation.privateParty);
    const retailWidth = Math.min(0.18, privateWidth + 0.015);
    const tradeWidth = Math.max(0.04, privateWidth - 0.01);
    const tradeRange = buildDynamicRange(valuation.tradeIn, tradeWidth);
    const privateRange = buildDynamicRange(valuation.privateParty, privateWidth);
    const retailRange = buildDynamicRange(valuation.dealerRetail, retailWidth);
    valuation.tradeInLow = tradeRange.low;
    valuation.tradeInHigh = tradeRange.high;
    valuation.privatePartyLow = privateRange.low;
    valuation.privatePartyHigh = privateRange.high;
    valuation.dealerRetailLow = retailRange.low;
    valuation.dealerRetailHigh = retailRange.high;
    valuation.modelType = valuation.modelType ?? "modeled";
    logger.error(
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
      : exactTrimMatch
        ? "Moderate confidence"
        : "Limited data";
  const sourceLabel =
    modelType === "provider_range"
      ? "Based on market data"
      : "Estimated market range";

  valuation.confidenceLabel = confidenceLabel;
  valuation.sourceLabel = sourceLabel;
  logger.error(
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
  logger.error(
    {
      label: "VALUE_SOURCE_LABEL_SELECTED",
      vehicleId: valuation.vehicleId,
      sourceLabel,
      modelType,
      source: input.source,
    },
    "VALUE_SOURCE_LABEL_SELECTED",
  );
  logger.error(
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

  async getSpecs(
    input:
      | string
      | {
          requestId?: string;
          vehicleId?: string | null;
          descriptor?: VehicleLookupDescriptor | null;
        },
  ): Promise<CachedServiceResult<VehicleRecord>> {
    const currentIso = nowIso();
    const request = typeof input === "string" ? { vehicleId: input } : input;
    const lookup = await resolveLookupContext(request);
    const vehicleId = lookup.lookupVehicleId;
    const vehicle = lookup.vehicle;
    const descriptor = lookup.cacheDescriptor;

    if (vehicle) {
      return {
        data: vehicle,
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
            requestSummary: { vehicleId, descriptor: lookup.effectiveDescriptor },
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
      for (const attempt of specAttempts.length > 0 ? specAttempts : lookup.lookupVehicle ? [{ strategy: "exact-year-make-model" as const, vehicle: lookup.lookupVehicle }] : []) {
        liveVehicle = await providers.specsProvider.getVehicleSpecs({
          vehicleId: vehicleId,
          vehicle: attempt.vehicle,
        });
        if (liveVehicle) {
          break;
        }
      }

      if (liveVehicle) {
        const enrichedVehicle = liveVehicle.vin ? await enrichVehicleWithNhtsa(liveVehicle) : liveVehicle;
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
        if (descriptor && cacheKey && providers.specsProviderName === "marketcheck") {
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
          expiresAt: descriptor && cacheKey && providers.specsProviderName === "marketcheck"
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
      if (partialSpecFallback && hasUsefulSpecBundle(partialSpecFallback)) {
        logCommonVehicleDetailTrace({
          phase: "specs",
          requestId: request.requestId,
          descriptorResolved: Boolean(lookup.effectiveDescriptor),
          vehicle: partialSpecFallback,
          descriptor: lookup.effectiveDescriptor,
          specsCandidateCount: specAttempts.length,
          valueCandidateCount: 0,
          listingsCandidateCount: 0,
          thinReason: "partial-spec-fallback",
        });
        return {
          data: partialSpecFallback,
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
    mileage: number;
    condition: string;
  }): Promise<CachedServiceResult<ValuationRecord>> {
    try {
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
          make: vehicle?.make ?? descriptor?.make ?? null,
          model: vehicle?.model ?? descriptor?.model ?? null,
          trim: vehicle?.trim ?? descriptor?.trim ?? null,
          bodyStyle: vehicle?.bodyStyle ?? input.descriptor?.bodyStyle ?? null,
          zip: input.zip,
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
      const cacheKey = descriptor ? getValuesCacheKey(descriptor, input) : null;
      const familyCacheKey = descriptor ? getFamilyValuesCacheKey(descriptor, input) : null;
      const shouldDebugCrv =
        isCrvTraceTarget({ make: vehicle?.make ?? descriptor?.make ?? null, model: vehicle?.model ?? descriptor?.model ?? null }) ||
        (!vehicle && !descriptor && String(lookupVehicleId).includes("cr"));
      logger.error(
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
        logger.error(
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
        logger.error(
          {
            label: "VALUE_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "cache-read",
            vehicleId: lookupVehicleId,
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
              const shaped = shapeValuationRecord({
                valuation: cached.responseJson.data,
                vehicle,
                source: "cache",
              });
              logger.error(
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
        logger.error(
          {
            label: "VALUE_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "family-cache-read",
            vehicleId: lookupVehicleId,
            cacheKey: familyCacheKey,
            year: descriptor?.year ?? null,
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
          await repositories.valuesCache.markAccessed(familyCacheKey, currentIso);
          logger.error(
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
            data: shapeValuationRecord({
              valuation: {
                ...familyCached.responseJson.data,
                vehicleId: lookupVehicleId,
              },
              vehicle,
              source: "cache",
            }),
            source: "cache",
            fetchedAt: familyCached.fetchedAt,
            expiresAt: familyCached.expiresAt,
          };
        }
      }

      const lookupBaseVehicle = lookup.lookupVehicle;
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
      logger.error(
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
        logger.error(
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
      let liveValue: ValuationRecord | null = null;
      let liveValueStrategy: ValueLookupAttempt["strategy"] | null = null;
      for (const attempt of valueAttempts) {
        logger.error(
          {
            label: "VALUE_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "provider-request",
            strategy: attempt.strategy,
            vehicleId: lookupVehicleId,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
          },
          "VALUE_LOOKUP_QUERY",
        );
        liveValue = await providers.valueProvider.getValuation({ ...input, vehicleId: lookupVehicleId, vehicle: attempt.vehicle });
        if (liveValue) {
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
              source: "provider",
              value: liveValue,
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
        if (familyCacheKey) {
          await repositories.valuesCache.upsert(
            createValuesCacheRow({
              descriptor: { ...descriptor, trim: "", normalizedTrim: "family" },
              cacheKey: familyCacheKey,
              provider: providers.valueProviderName,
              payload: liveValue,
              zip: input.zip,
              mileage: input.mileage,
              condition: input.condition,
            }),
          );
        }
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
        logger.error(
          {
            label: "VALUE_FINAL_RESOLUTION",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            finalValueSource: liveValue.sourceLabel ?? liveValue.modelType ?? "provider",
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
            returnedValue: liveValue,
            finalRenderedValue: liveValue,
            acceptedReason: "provider-match",
          },
          "VALUE_API_RESULT",
        );
        logger.info(
          {
            label: "VALUE_API_RESULT_USED_SOURCE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            sourceLabel: liveValue.sourceLabel ?? liveValue.modelType ?? "provider",
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
            newReturnedValue: liveValue,
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
          valuation: liveValue,
        });
        return {
          data: shapeValuationRecord({
            valuation: liveValue,
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
        const variantCacheKey = variantDescriptor ? getValuesCacheKey(variantDescriptor, input) : null;
        const cached = variantCacheKey ? await repositories.valuesCache.findByCacheKey(variantCacheKey) : null;
        if (cached?.responseJson.data) {
          fallbackValue = {
            ...cached.responseJson.data,
            vehicleId: lookupVehicleId,
            sourceLabel: "Estimated market range",
            confidenceLabel: "Moderate confidence",
            modelType: cached.responseJson.data.modelType ?? "modeled",
          };
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
            fallbackValue = {
              ...stored,
              vehicleId: lookupVehicleId,
              sourceLabel: "Estimated market range",
              confidenceLabel: "Moderate confidence",
              modelType: stored.modelType ?? "modeled",
            };
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
        const derivedFromListings = await deriveValuationFromSimilarVehicles({
          vehicle: lookupBaseVehicle,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
        });
        if (derivedFromListings) {
          fallbackValue = derivedFromListings;
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

      if (!fallbackValue) {
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
              sourceLabel: "Estimated market range",
              confidenceLabel: "Limited data",
              modelType: "modeled",
            }
          : null;
      }

      if (!fallbackValue && lookupBaseVehicle) {
        fallbackValue = buildEstimatedMarketRangeFromVehicle({
          vehicle: lookupBaseVehicle,
          vehicleId: lookupVehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition,
        });
        if (fallbackValue) {
          logger.error(
            {
              label: "VALUE_LOOKUP_SUCCESS",
              requestId: input.requestId,
              strategy: "modeled-market-range",
              vehicleId: lookupVehicleId,
            },
            "VALUE_LOOKUP_SUCCESS",
          );
        }
      }

      if (fallbackValue) {
        if (descriptor && familyCacheKey && providers.valueProviderName === "marketcheck") {
          await repositories.valuesCache.upsert(
            createValuesCacheRow({
              descriptor: { ...descriptor, trim: "", normalizedTrim: "family" },
              cacheKey: familyCacheKey,
              provider: providers.valueProviderName,
              payload: fallbackValue,
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
            finalValueSource: fallbackValue.sourceLabel ?? fallbackValue.modelType ?? "fallback",
            familyCacheUsed: false,
            similarVehicleFallbackUsed:
              fallbackValue.sourceLabel === "Estimated from similar vehicles" ||
              fallbackValue.modelType === "listing_derived",
            adjacentYearRescueUsed: false,
            fallbackReason:
              fallbackValue.sourceLabel === "Estimated from similar vehicles"
                ? "similar-vehicle-derived-estimate"
                : fallbackValue.sourceLabel === "Estimated market range"
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
            returnedValue: fallbackValue,
            finalRenderedValue: fallbackValue,
            acceptedReason: "fallback-value-resolved",
          },
          "VALUE_API_RESULT",
        );
        logger.info(
          {
            label: "VALUE_API_RESULT_USED_SOURCE",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            sourceLabel: fallbackValue.sourceLabel ?? fallbackValue.modelType ?? "fallback",
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
            newReturnedValue: fallbackValue,
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
          valuation: fallbackValue,
          thinReason: "fallback-value-resolved",
        });
        return {
          data: shapeValuationRecord({
            valuation: fallbackValue,
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
      const lookup = await resolveLookupContext(input);
      const vehicle = lookup.vehicle;
      const descriptor = lookup.cacheDescriptor;
      const lookupVehicleId = lookup.lookupVehicleId;
      const cacheKey = descriptor ? getValuesCacheKey(descriptor, input) : null;
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
  }): Promise<CachedServiceResult<ListingRecord[], ListingsDebugMeta>> {
    try {
      const currentIso = nowIso();
      const lookup = await resolveLookupContext(input);
      const vehicle = lookup.vehicle;
      const descriptor = lookup.cacheDescriptor;
      const lookupVehicleId = lookup.lookupVehicleId;
      logger.error(
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
      const shouldDebugCrv =
        isCrvTraceTarget({ make: vehicle?.make ?? descriptor?.make ?? null, model: vehicle?.model ?? descriptor?.model ?? null }) ||
        (!vehicle && !descriptor && String(lookupVehicleId).includes("cr"));
      if (shouldDebugCrv) {
        logger.error(
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
        logger.error(
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

      if (familyCacheKey && providers.listingsProviderName === "marketcheck") {
        logger.error(
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
        if (familyCached && isFresh(familyCached.expiresAt, currentIso) && !familyCached.responseJson.isEmpty) {
          await repositories.listingsCache.markAccessed(familyCacheKey, currentIso);
          logger.error(
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
            data: familyCached.responseJson.data.map((listing) => ({
              ...listing,
              vehicleId: lookupVehicleId,
            })),
            source: "cache",
            fetchedAt: familyCached.fetchedAt,
            expiresAt: familyCached.expiresAt,
            meta: {
              sourceLabel: "Comparable listings",
              rawCount: familyCached.responseJson.data.length,
              believableCount: familyCached.responseJson.data.filter(isBelievableListing).length,
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
          (attempt) => attempt.strategy === "adjacent-year-previous" || attempt.strategy === "adjacent-year-next",
        ).length,
        radiusExpandedAttemptCount: fallbackAttempts.filter(
          (attempt) => attempt.strategy === "same-model-radius-100" || attempt.strategy === "same-model-radius-300",
        ).length,
        generationFallbackAttemptCount: fallbackAttempts.filter((attempt) => attempt.strategy === "same-generation").length,
        similarVehicleAttemptCount: fallbackAttempts.filter((attempt) => attempt.strategy === "similar-vehicle").length,
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
      logger.error(
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
        logger.error(
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
      const liveListingsAttempts: Array<{
        strategy: ListingsLookupAttempt["strategy"];
        returnedCount: number;
        believableCount: number;
      }> = [];
      for (const attempt of fallbackAttempts) {
        logger.error(
          {
            label: "LISTINGS_LOOKUP_QUERY",
            requestId: input.requestId,
            queryType: "provider-request",
            strategy: attempt.strategy,
            vehicleId: lookupVehicleId,
            year: attempt.vehicle.year,
            make: attempt.vehicle.make,
            model: attempt.vehicle.model,
            trim: attempt.vehicle.trim,
            zip: input.zip,
            radiusMiles: attempt.radiusMiles,
          },
          "LISTINGS_LOOKUP_QUERY",
        );
        liveListings = await providers.listingsProvider.getListings({
          ...input,
          vehicleId: lookupVehicleId,
          vehicle: attempt.vehicle,
          radiusMiles: attempt.radiusMiles,
        });
        const believableListings = liveListings.filter(isBelievableListing);
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
          liveListingsStrategy = attempt.strategy;
          logger.error(
            {
              label: attempt.label,
              requestId: input.requestId,
              strategy: attempt.strategy,
              vehicleId: lookupVehicleId,
              resultCount: liveListings.length,
              believableCount: believableListings.length,
            },
            attempt.label,
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
        logger.error(
          {
            label: "LISTINGS_FINAL_RESOLUTION",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            finalListingsSource: "provider",
            familyCacheUsed: false,
            similarVehicleFallbackUsed:
              liveListingsStrategy === "same-generation" || liveListingsStrategy === "similar-vehicle",
            adjacentYearRescueUsed:
              liveListingsStrategy === "adjacent-year-previous" || liveListingsStrategy === "adjacent-year-next",
            fallbackReason: liveListingsStrategy ?? "provider-match",
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
            count: liveListings.length,
            believableCount: liveListings.filter(isBelievableListing).length,
            finalSourceLabel:
              liveListingsStrategy === "exact-year-make-model"
                ? "Exact listings"
                : liveListingsStrategy === "same-year-any-trim" ||
                    liveListingsStrategy === "same-model-radius-100" ||
                    liveListingsStrategy === "same-model-radius-300"
                  ? "Nearby listings for this model"
                  : "Comparable listings",
            fallbackReason: liveListingsStrategy ?? "provider-match",
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
            count: liveListings.length,
            believableCount: liveListings.filter(isBelievableListing).length,
            finalSourceLabel:
              liveListingsStrategy === "exact-year-make-model"
                ? "Exact listings"
                : liveListingsStrategy === "same-year-any-trim" ||
                    liveListingsStrategy === "same-model-radius-100" ||
                    liveListingsStrategy === "same-model-radius-300"
                  ? "Nearby listings for this model"
                  : "Comparable listings",
            fallbackReason: liveListingsStrategy ?? "provider-match",
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
          listings: liveListings,
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
              finalDisplayedListingsSource:
                liveListingsStrategy === "same-year-any-trim" ||
                liveListingsStrategy === "same-model-radius-100" ||
                liveListingsStrategy === "same-model-radius-300"
                  ? "Nearby listings for this model"
                  : liveListingsStrategy === "same-generation" || liveListingsStrategy === "similar-vehicle"
                    ? "Comparable listings"
                    : "Exact listings",
              fallbackReasonShown: liveListingsStrategy ?? "provider-match",
            },
            "COMMON_LISTINGS_TRACE",
          );
        }
        logCrvListingsRuntimeTrace({
          finalReason: liveListingsStrategy ?? "provider-match",
          finalSourceLabel:
            liveListingsStrategy === "exact-year-make-model"
              ? "Exact listings"
              : liveListingsStrategy === "same-year-any-trim" ||
                  liveListingsStrategy === "same-model-radius-100" ||
                  liveListingsStrategy === "same-model-radius-300"
                ? "Nearby listings for this model"
                : "Comparable listings",
          providerReturnedZeroAtAllAttempts: liveListingsAttempts.length > 0 && liveListingsAttempts.every((attempt) => attempt.returnedCount === 0),
          rawListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.returnedCount > 0),
          believableListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.believableCount > 0),
        });
        return {
          data: liveListings,
          source: "provider",
          fetchedAt: cacheRow?.fetchedAt ?? currentIso,
          expiresAt: cacheRow?.expiresAt ?? currentIso,
          meta: {
            sourceLabel:
              liveListingsStrategy === "exact-year-make-model"
                ? "Exact listings"
                : liveListingsStrategy === "same-year-any-trim" ||
                    liveListingsStrategy === "same-model-radius-100" ||
                    liveListingsStrategy === "same-model-radius-300"
                  ? "Nearby listings for this model"
                  : "Comparable listings",
            rawCount: liveListings.length,
            believableCount: liveListings.filter(isBelievableListing).length,
            mode: resolveListingsDebugMode(liveListingsStrategy),
            fallbackReason: liveListingsStrategy ?? "provider-match",
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
      if (storedListings.length > 0) {
        logger.error(
          {
            label: "LISTINGS_LOOKUP_SUCCESS",
            requestId: input.requestId,
            strategy: "stored-listings-fallback",
            vehicleId: lookupVehicleId,
            resultCount: storedListings.length,
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
            count: storedListings.length,
            believableCount: storedListings.filter(isBelievableListing).length,
            finalSourceLabel: "Comparable listings",
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
            count: storedListings.length,
            believableCount: storedListings.filter(isBelievableListing).length,
            finalSourceLabel: "Comparable listings",
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
          listings: storedListings,
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
              finalDisplayedListingsSource: "Comparable listings",
              fallbackReasonShown: "stored-listings-fallback",
            },
            "COMMON_LISTINGS_TRACE",
          );
        }
        logCrvListingsRuntimeTrace({
          finalReason: "stored-listings-fallback",
          finalSourceLabel: "Comparable listings",
          providerReturnedZeroAtAllAttempts: liveListingsAttempts.length > 0 && liveListingsAttempts.every((attempt) => attempt.returnedCount === 0),
          rawListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.returnedCount > 0),
          believableListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.believableCount > 0),
        });
        return {
          data: storedListings,
          source: "provider",
          fetchedAt: currentIso,
          expiresAt: currentIso,
          meta: {
            sourceLabel: "Comparable listings",
            rawCount: storedListings.length,
            believableCount: storedListings.filter(isBelievableListing).length,
            mode: "similar_vehicle_fallback",
            fallbackReason: "stored-listings-fallback",
          },
        };
      }

      if (lookupBaseVehicle) {
        const listings = await mockListingsProvider.getListings({
          vehicleId: lookupVehicleId,
          zip: input.zip,
          radiusMiles: input.radiusMiles,
          vehicle: lookupBaseVehicle,
        });
        logger.error(
          {
            label: listings.length > 0 ? "LISTINGS_LOOKUP_SUCCESS" : "LISTINGS_FAILED",
            requestId: input.requestId,
            strategy: "mock-fallback",
            vehicleId: lookupVehicleId,
            resultCount: listings.length,
          },
          listings.length > 0 ? "LISTINGS_LOOKUP_SUCCESS" : "LISTINGS_FAILED",
        );
        logger.error(
          {
            label: "LISTINGS_FINAL_RESOLUTION",
            requestId: input.requestId,
            vehicleId: lookupVehicleId,
            finalListingsSource: listings.length > 0 ? "mock_fallback" : null,
            familyCacheUsed: false,
            similarVehicleFallbackUsed: false,
            adjacentYearRescueUsed: false,
            fallbackReason: listings.length > 0 ? "mock-fallback" : "no-believable-listings-found",
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
            count: listings.length,
            believableCount: listings.filter(isBelievableListing).length,
            finalSourceLabel: listings.length > 0 ? "Comparable listings" : null,
            fallbackReason: listings.length > 0 ? "mock-fallback" : "no-believable-listings-found",
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
            count: listings.length,
            believableCount: listings.filter(isBelievableListing).length,
            finalSourceLabel: listings.length > 0 ? "Comparable listings" : null,
            fallbackReason: listings.length > 0 ? "mock-fallback" : "no-believable-listings-found",
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
          listings,
          thinReason: listings.length > 0 ? "mock-fallback" : "no-believable-listings-found",
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
              finalDisplayedListingsSource: listings.length > 0 ? "Comparable listings" : null,
              fallbackReasonShown: listings.length > 0 ? "mock-fallback" : "no-believable-listings-found",
            },
            "COMMON_LISTINGS_TRACE",
          );
        }
        logCrvListingsRuntimeTrace({
          finalReason: listings.length > 0 ? "mock-fallback" : "no-believable-listings-found",
          finalSourceLabel: listings.length > 0 ? "Comparable listings" : null,
          providerReturnedZeroAtAllAttempts: liveListingsAttempts.length > 0 && liveListingsAttempts.every((attempt) => attempt.returnedCount === 0),
          rawListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.returnedCount > 0),
          believableListingsEverReturned: liveListingsAttempts.some((attempt) => attempt.believableCount > 0),
        });
        return {
          data: listings,
          source: "provider",
          fetchedAt: currentIso,
          expiresAt: currentIso,
          meta: {
            sourceLabel: listings.length > 0 ? "Comparable listings" : null,
            rawCount: listings.length,
            believableCount: listings.filter(isBelievableListing).length,
            mode: listings.length > 0 ? "similar_vehicle_fallback" : "none",
            fallbackReason: listings.length > 0 ? "mock-fallback" : "no-believable-listings-found",
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
            yearRange: normalizedListingsQuery.year ? [normalizedListingsQuery.year - 1, normalizedListingsQuery.year + 1] : null,
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
