import crypto from "node:crypto";
import { ListingRecord, ValuationRecord, VehicleCondition, VehicleRecord, VehicleType } from "../types/domain.js";

export type ProviderEndpointType = "specs" | "values" | "listings";
export type CacheSource = "cache" | "provider";
export type ProviderApiLogEvent = "cache_hit" | "miss" | "stale_refresh" | "empty_hit" | "provider_error";

type BaseDescriptor = {
  year: number;
  make: string;
  model: string;
  trim?: string;
  vehicleType?: VehicleType;
};

export type CacheDescriptor = BaseDescriptor & {
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim: string;
};

export type CachePayload<T> = {
  data: T;
  isEmpty: boolean;
};

type BaseCacheRow<T> = {
  id: string;
  cacheKey: string;
  provider: string;
  responseJson: CachePayload<T>;
  fetchedAt: string;
  expiresAt: string;
  hitCount: number;
  lastAccessedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type VehicleSpecsCacheRow = BaseCacheRow<VehicleRecord | null> & {
  year: number;
  vehicleType: VehicleType;
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim: string;
};

export type VehicleValuesCacheRow = BaseCacheRow<ValuationRecord | null> & {
  year: number;
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim: string;
  zipPrefix: string;
  mileageBucket: string;
  condition: VehicleCondition;
};

export type VehicleListingsCacheRow = BaseCacheRow<ListingRecord[]> & {
  year: number;
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim: string;
  zipCode: string;
  radiusMiles: number;
};

export type ProviderApiUsageLogRecord = {
  id: string;
  provider: string;
  endpointType: ProviderEndpointType;
  eventType: ProviderApiLogEvent;
  cacheKey: string;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  createdAt: string;
};

export type CachedServiceResult<T> = {
  data: T;
  source: CacheSource;
  fetchedAt: string;
  expiresAt: string;
};

const CACHE_TTLS_MS = {
  specs: {
    default: 30 * 24 * 60 * 60 * 1000,
    empty: 7 * 24 * 60 * 60 * 1000,
  },
  values: {
    default: 3 * 24 * 60 * 60 * 1000,
    empty: 24 * 60 * 60 * 1000,
  },
  listings: {
    default: 12 * 60 * 60 * 1000,
    empty: 2 * 60 * 60 * 1000,
  },
} as const;

export const CACHE_RETENTION_MS = {
  specs: 180 * 24 * 60 * 60 * 1000,
  values: 30 * 24 * 60 * 60 * 1000,
  listings: 7 * 24 * 60 * 60 * 1000,
} as const;

export function normalizeLookupText(value: string | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/[’'`]/g, "")
    .replace(/[./_,;:()[\]{}]+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeVehicleType(value: string | undefined | null): VehicleType | null {
  const normalized = normalizeLookupText(value);
  if (normalized === "car" || normalized === "motorcycle") {
    return normalized;
  }
  return null;
}

export function normalizeCondition(value: string | undefined | null): VehicleCondition {
  const normalized = normalizeLookupText(value).replace(/ /g, "_");
  if (normalized === "excellent" || normalized === "very_good" || normalized === "good" || normalized === "fair" || normalized === "poor") {
    return normalized;
  }
  return "good";
}

export function normalizeZip5(value: string | undefined | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(0, 5);
}

export function normalizeZipPrefix(value: string | undefined | null) {
  return normalizeZip5(value).slice(0, 3);
}

export function getMileageBucket(mileage: number) {
  const safeMileage = Math.max(0, mileage);
  if (safeMileage < 25000) return "0-24999";
  if (safeMileage < 50000) return "25000-49999";
  if (safeMileage < 75000) return "50000-74999";
  if (safeMileage < 100000) return "75000-99999";
  if (safeMileage < 125000) return "100000-124999";
  return "125000+";
}

function normalizeKeyPart(value: string | number | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createCacheKey(parts: Array<string | number | undefined | null>) {
  return parts.map((part) => normalizeKeyPart(part)).filter(Boolean).join(":");
}

export function buildCacheDescriptor(input: { vehicle?: VehicleRecord | null; parsed?: BaseDescriptor | null }): CacheDescriptor | null {
  const base = input.vehicle
    ? {
        year: input.vehicle.year,
        make: input.vehicle.make,
        model: input.vehicle.model,
        trim: input.vehicle.trim,
        vehicleType: input.vehicle.vehicleType,
      }
    : input.parsed;

  if (!base) {
    return null;
  }

  return {
    ...base,
    normalizedMake: normalizeLookupText(base.make),
    normalizedModel: normalizeLookupText(base.model),
    normalizedTrim: normalizeLookupText(base.trim ?? "base"),
  };
}

export function buildCanonicalKey(input: {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  vehicleType?: string | null;
}) {
  return createCacheKey([
    "canonical",
    input.year,
    normalizeLookupText(input.make),
    normalizeLookupText(input.model),
    normalizeLookupText(input.trim ?? "base"),
    normalizeVehicleType(input.vehicleType) ?? "unknown",
  ]);
}

export function getSpecsCacheKey(descriptor: CacheDescriptor) {
  return createCacheKey([
    "specs",
    descriptor.year,
    descriptor.normalizedMake,
    descriptor.normalizedModel,
    descriptor.normalizedTrim,
    descriptor.vehicleType ?? "car",
  ]);
}

export function getValuesCacheKey(
  descriptor: CacheDescriptor,
  input: { zip: string; mileage: number; condition: string },
) {
  return createCacheKey([
    "values",
    descriptor.year,
    descriptor.normalizedMake,
    descriptor.normalizedModel,
    descriptor.normalizedTrim,
    normalizeZipPrefix(input.zip),
    getMileageBucket(input.mileage),
    normalizeCondition(input.condition),
  ]);
}

export function getListingsCacheKey(descriptor: CacheDescriptor, input: { zip: string; radiusMiles: number }) {
  return createCacheKey([
    "listings",
    descriptor.year,
    descriptor.normalizedMake,
    descriptor.normalizedModel,
    descriptor.normalizedTrim,
    normalizeZip5(input.zip),
    input.radiusMiles,
  ]);
}

function getTtlMs(endpointType: ProviderEndpointType, isEmpty: boolean) {
  return isEmpty ? CACHE_TTLS_MS[endpointType].empty : CACHE_TTLS_MS[endpointType].default;
}

function createBaseCacheRow<T>(input: {
  cacheKey: string;
  provider: string;
  payload: T;
  endpointType: ProviderEndpointType;
  isEmpty: boolean;
}) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + getTtlMs(input.endpointType, input.isEmpty)).toISOString();

  return {
    id: crypto.randomUUID(),
    cacheKey: input.cacheKey,
    provider: input.provider,
    responseJson: {
      data: input.payload,
      isEmpty: input.isEmpty,
    },
    fetchedAt: now,
    expiresAt,
    hitCount: 0,
    lastAccessedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export function createSpecsCacheRow(input: {
  descriptor: CacheDescriptor;
  cacheKey: string;
  provider: string;
  payload: VehicleRecord | null;
}) {
  return {
    ...createBaseCacheRow({
      cacheKey: input.cacheKey,
      provider: input.provider,
      payload: input.payload,
      endpointType: "specs",
      isEmpty: !input.payload,
    }),
    year: input.descriptor.year,
    vehicleType: input.descriptor.vehicleType ?? "car",
    normalizedMake: input.descriptor.normalizedMake,
    normalizedModel: input.descriptor.normalizedModel,
    normalizedTrim: input.descriptor.normalizedTrim,
  } satisfies VehicleSpecsCacheRow;
}

export function createValuesCacheRow(input: {
  descriptor: CacheDescriptor;
  cacheKey: string;
  provider: string;
  payload: ValuationRecord | null;
  zip: string;
  mileage: number;
  condition: string;
}) {
  return {
    ...createBaseCacheRow({
      cacheKey: input.cacheKey,
      provider: input.provider,
      payload: input.payload,
      endpointType: "values",
      isEmpty: !input.payload,
    }),
    year: input.descriptor.year,
    normalizedMake: input.descriptor.normalizedMake,
    normalizedModel: input.descriptor.normalizedModel,
    normalizedTrim: input.descriptor.normalizedTrim,
    zipPrefix: normalizeZipPrefix(input.zip),
    mileageBucket: getMileageBucket(input.mileage),
    condition: normalizeCondition(input.condition),
  } satisfies VehicleValuesCacheRow;
}

export function createListingsCacheRow(input: {
  descriptor: CacheDescriptor;
  cacheKey: string;
  provider: string;
  payload: ListingRecord[];
  zip: string;
  radiusMiles: number;
}) {
  return {
    ...createBaseCacheRow({
      cacheKey: input.cacheKey,
      provider: input.provider,
      payload: input.payload,
      endpointType: "listings",
      isEmpty: input.payload.length === 0,
    }),
    year: input.descriptor.year,
    normalizedMake: input.descriptor.normalizedMake,
    normalizedModel: input.descriptor.normalizedModel,
    normalizedTrim: input.descriptor.normalizedTrim,
    zipCode: normalizeZip5(input.zip),
    radiusMiles: input.radiusMiles,
  } satisfies VehicleListingsCacheRow;
}

export function createProviderApiUsageLog(input: {
  provider: string;
  endpointType: ProviderEndpointType;
  eventType: ProviderApiLogEvent;
  cacheKey: string;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
}) {
  return {
    id: crypto.randomUUID(),
    provider: input.provider,
    endpointType: input.endpointType,
    eventType: input.eventType,
    cacheKey: input.cacheKey,
    requestSummary: input.requestSummary,
    responseSummary: input.responseSummary,
    createdAt: new Date().toISOString(),
  } satisfies ProviderApiUsageLogRecord;
}
