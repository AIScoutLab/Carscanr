import { ListingRecord, MarketListingsCacheRecord, MarketValueCacheRecord, ValuationRecord } from "../types/domain.js";
import {
  buildGenerationBucket,
  buildVehicleFamilyDescriptor,
  isPopularVehicleFamily,
  normalizeConditionBand,
  normalizeMileageBand,
  normalizeZipRegion,
} from "./vehicleFamily.js";

const VALUE_FRESHNESS_MS = 3 * 24 * 60 * 60 * 1000;
const LISTINGS_FRESHNESS_MS = 12 * 60 * 60 * 1000;

function createKey(parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => String(part ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(":");
}

export function buildMarketValueCacheKeys(input: {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  bodyStyle?: string | null;
  zip: string;
  mileage: number;
  condition: string;
}) {
  const family = buildVehicleFamilyDescriptor(input);
  const zipRegion = normalizeZipRegion(input.zip);
  const mileageBand = normalizeMileageBand(input.mileage);
  const conditionBand = normalizeConditionBand(input.condition);
  const generation = buildGenerationBucket(input);
  return {
    exact: createKey(["market-value", input.year, family.makeFamily, family.modelFamily, family.trimFamily, zipRegion, mileageBand, conditionBand]),
    family: createKey(["market-value", input.year, family.makeFamily, family.modelFamily, "any", zipRegion, mileageBand, conditionBand]),
    previousYear: createKey(["market-value", input.year - 1, family.makeFamily, family.modelFamily, "any", zipRegion, mileageBand, conditionBand]),
    nextYear: createKey(["market-value", input.year + 1, family.makeFamily, family.modelFamily, "any", zipRegion, mileageBand, conditionBand]),
    generation: createKey(["market-value", generation, family.makeFamily, family.modelFamily, "any", zipRegion, mileageBand, conditionBand]),
    popularFamily: isPopularVehicleFamily(input.make, input.model),
    familyDescriptor: family,
    zipRegion,
    mileageBand,
    conditionBand,
  };
}

export function buildMarketListingsCacheKeys(input: {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  bodyStyle?: string | null;
  zip: string;
  listingMode?: string;
}) {
  const family = buildVehicleFamilyDescriptor(input);
  const zipRegion = normalizeZipRegion(input.zip);
  const generation = buildGenerationBucket(input);
  return {
    exact: createKey(["market-listings", input.year, family.makeFamily, family.modelFamily, family.trimFamily, zipRegion, "exact"]),
    family: createKey(["market-listings", input.year, family.makeFamily, family.modelFamily, "any", zipRegion, "family"]),
    previousYear: createKey(["market-listings", input.year - 1, family.makeFamily, family.modelFamily, "any", zipRegion, "adjacent"]),
    nextYear: createKey(["market-listings", input.year + 1, family.makeFamily, family.modelFamily, "any", zipRegion, "adjacent"]),
    generation: createKey(["market-listings", generation, family.makeFamily, family.modelFamily, "any", zipRegion, "generation"]),
    comparable: createKey(["market-listings", family.makeFamily, family.modelFamily, zipRegion, "comparable"]),
    popularFamily: isPopularVehicleFamily(input.make, input.model),
    familyDescriptor: family,
    zipRegion,
  };
}

export function createMarketValueCacheRecord(input: {
  cacheKey: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  bodyStyle?: string | null;
  zip: string;
  mileage: number;
  condition: string;
  valuation: ValuationRecord;
  rawProviderPayload?: unknown | null;
}) {
  const family = buildVehicleFamilyDescriptor(input);
  const now = new Date().toISOString();
  return {
    cacheKey: input.cacheKey,
    year: input.year,
    make: input.make,
    modelFamily: family.modelFamily,
    trimFamily: family.trimFamily,
    zipRegion: normalizeZipRegion(input.zip),
    mileageBand: normalizeMileageBand(input.mileage),
    conditionBand: normalizeConditionBand(input.condition),
    tradeInLow: input.valuation.tradeInLow ?? null,
    tradeInMid: input.valuation.tradeIn ?? null,
    tradeInHigh: input.valuation.tradeInHigh ?? null,
    privateLow: input.valuation.privatePartyLow ?? null,
    privateMid: input.valuation.privateParty ?? null,
    privateHigh: input.valuation.privatePartyHigh ?? null,
    retailLow: input.valuation.dealerRetailLow ?? null,
    retailMid: input.valuation.dealerRetail ?? null,
    retailHigh: input.valuation.dealerRetailHigh ?? null,
    sourceLabel: input.valuation.sourceLabel ?? "Estimated market range",
    confidenceLabel: input.valuation.confidenceLabel ?? null,
    freshnessExpiresAt: new Date(Date.now() + VALUE_FRESHNESS_MS).toISOString(),
    rawProviderPayload: input.rawProviderPayload ?? input.valuation,
    createdAt: now,
    updatedAt: now,
  } satisfies MarketValueCacheRecord;
}

export function marketValueCacheToValuation(input: {
  cache: MarketValueCacheRecord;
  vehicleId: string;
  zip: string;
  mileage: number;
  condition: string;
  sourceLabel?: string;
  providerSkippedReason?: string | null;
}) {
  const conditionBand = normalizeConditionBand(input.condition);
  return {
    id: `market-cache:${input.cache.cacheKey}`,
    vehicleId: input.vehicleId,
    zip: input.zip,
    mileage: input.mileage,
    condition: conditionBand,
    tradeIn: input.cache.tradeInMid ?? 0,
    tradeInLow: input.cache.tradeInLow ?? undefined,
    tradeInHigh: input.cache.tradeInHigh ?? undefined,
    privateParty: input.cache.privateMid ?? 0,
    privatePartyLow: input.cache.privateLow ?? undefined,
    privatePartyHigh: input.cache.privateHigh ?? undefined,
    dealerRetail: input.cache.retailMid ?? 0,
    dealerRetailLow: input.cache.retailLow ?? undefined,
    dealerRetailHigh: input.cache.retailHigh ?? undefined,
    currency: "USD" as const,
    generatedAt: input.cache.updatedAt,
    sourceLabel: input.sourceLabel ?? input.cache.sourceLabel,
    confidenceLabel: input.cache.confidenceLabel ?? undefined,
    modelType:
      input.cache.sourceLabel === "Estimated from similar vehicles"
        ? "listing_derived"
        : input.cache.sourceLabel === "Estimated market range"
          ? "modeled"
          : "provider_range",
    isCached: true,
    isModeled: input.cache.sourceLabel === "Estimated market range",
    isListingDerived: input.cache.sourceLabel === "Estimated from similar vehicles",
    providerSkippedReason: input.providerSkippedReason ?? null,
  } as ValuationRecord;
}

export function createMarketListingsCacheRecord(input: {
  cacheKey: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  bodyStyle?: string | null;
  zip: string;
  listings: ListingRecord[];
  listingMode: string;
  sourceLabel: string;
  rawProviderPayload?: unknown | null;
}) {
  const family = buildVehicleFamilyDescriptor(input);
  const now = new Date().toISOString();
  return {
    cacheKey: input.cacheKey,
    year: input.year,
    make: input.make,
    modelFamily: family.modelFamily,
    trimFamily: family.trimFamily,
    zipRegion: normalizeZipRegion(input.zip),
    listingMode: input.listingMode,
    listingsJson: input.listings,
    believableCount: input.listings.length,
    sourceLabel: input.sourceLabel,
    freshnessExpiresAt: new Date(Date.now() + LISTINGS_FRESHNESS_MS).toISOString(),
    rawProviderPayload: input.rawProviderPayload ?? input.listings,
    createdAt: now,
    updatedAt: now,
  } satisfies MarketListingsCacheRecord;
}
