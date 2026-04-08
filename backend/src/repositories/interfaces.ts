import {
  CanonicalVehicleRecord,
  GarageItemRecord,
  ListingRecord,
  ScanRecord,
  SubscriptionRecord,
  UsageCounterRecord,
  ValuationRecord,
  VehicleRecord,
  VisionDebugRecord,
  CachedAnalysisRecord,
  ImageCacheRecord,
  UnlockBalanceRecord,
  UserVehicleUnlockRecord,
} from "../types/domain.js";
import {
  ProviderApiUsageLogRecord,
  VehicleListingsCacheRow,
  VehicleSpecsCacheRow,
  VehicleValuesCacheRow,
} from "../lib/providerCache.js";

export interface ScansRepository {
  create(scan: ScanRecord): Promise<ScanRecord>;
}

export interface VehiclesRepository {
  findById(vehicleId: string): Promise<VehicleRecord | null>;
  search(input: { year?: string; make?: string; model?: string }): Promise<VehicleRecord[]>;
  searchCandidates(input: {
    year: number;
    make: string;
    model: string;
    trim?: string;
  }): Promise<VehicleRecord[]>;
}

export interface CanonicalVehiclesRepository {
  findByCanonicalKey(canonicalKey: string): Promise<CanonicalVehicleRecord | null>;
  findPromotedMatch(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim?: string | null;
  }): Promise<CanonicalVehicleRecord | null>;
  upsertCandidate(record: CanonicalVehicleRecord): Promise<CanonicalVehicleRecord>;
  promote(canonicalKey: string): Promise<void>;
  incrementPopularity(canonicalKey: string): Promise<void>;
}

export interface GarageItemsRepository {
  listByUser(userId: string): Promise<GarageItemRecord[]>;
  create(item: GarageItemRecord): Promise<GarageItemRecord>;
  deleteByUserAndId(userId: string, id: string): Promise<boolean>;
}

export interface ValuationsRepository {
  findLatest(input: {
    vehicleId: string;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<ValuationRecord | null>;
}

export interface ListingResultsRepository {
  listByVehicle(input: {
    vehicleId: string;
    zip: string;
    radiusMiles: number;
  }): Promise<ListingRecord[]>;
}

export interface SubscriptionsRepository {
  findActiveByUser(userId: string): Promise<SubscriptionRecord | null>;
  replaceActiveForUser(record: SubscriptionRecord): Promise<SubscriptionRecord>;
}

export interface UsageCountersRepository {
  findByUserAndDate(userId: string, date: string): Promise<UsageCounterRecord | null>;
  findLifetimeByUser(userId: string): Promise<UsageCounterRecord | null>;
  upsert(record: UsageCounterRecord): Promise<UsageCounterRecord>;
  upsertLifetime(record: UsageCounterRecord): Promise<UsageCounterRecord>;
}

export interface VisionDebugRepository {
  create(record: VisionDebugRecord): Promise<VisionDebugRecord>;
}

export interface SpecsCacheRepository {
  findByCacheKey(cacheKey: string): Promise<VehicleSpecsCacheRow | null>;
  upsert(entry: VehicleSpecsCacheRow): Promise<VehicleSpecsCacheRow>;
  markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void>;
  deleteOlderThan(cutoffIso: string): Promise<number>;
}

export interface ValuesCacheRepository {
  findByCacheKey(cacheKey: string): Promise<VehicleValuesCacheRow | null>;
  upsert(entry: VehicleValuesCacheRow): Promise<VehicleValuesCacheRow>;
  markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void>;
  deleteOlderThan(cutoffIso: string): Promise<number>;
}

export interface ListingsCacheRepository {
  findByCacheKey(cacheKey: string): Promise<VehicleListingsCacheRow | null>;
  upsert(entry: VehicleListingsCacheRow): Promise<VehicleListingsCacheRow>;
  markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void>;
  deleteOlderThan(cutoffIso: string): Promise<number>;
}

export interface ProviderApiUsageLogsRepository {
  create(record: ProviderApiUsageLogRecord): Promise<ProviderApiUsageLogRecord>;
  deleteOlderThan(cutoffIso: string): Promise<number>;
}

export interface CachedAnalysisRepository {
  findByAnalysisKey(analysisKey: string): Promise<CachedAnalysisRecord | null>;
  insert(record: CachedAnalysisRecord): Promise<CachedAnalysisRecord>;
  update(
    analysisKey: string,
    updates: Partial<Omit<CachedAnalysisRecord, "id" | "analysisKey" | "createdAt">>,
  ): Promise<CachedAnalysisRecord>;
  markAccessed(analysisKey: string, lastAccessedAt: string): Promise<void>;
}

export interface ImageCacheRepository {
  findByImageKey(imageKey: string): Promise<ImageCacheRecord | null>;
  upsert(record: ImageCacheRecord): Promise<ImageCacheRecord>;
  markAccessed(imageKey: string, lastAccessedAt: string): Promise<void>;
  listRecent(limit: number): Promise<ImageCacheRecord[]>;
}

export interface UnlockBalanceRepository {
  getByUser(userId: string): Promise<UnlockBalanceRecord | null>;
  getOrCreate(userId: string): Promise<UnlockBalanceRecord>;
  update(record: UnlockBalanceRecord): Promise<UnlockBalanceRecord>;
}

export type GrantUnlockResult = {
  allowed: boolean;
  alreadyUnlocked: boolean;
  usedUnlock: boolean;
  freeUnlocksTotal: number;
  freeUnlocksUsed: number;
  freeUnlocksRemaining: number;
};

export interface VehicleUnlockRepository {
  findByUserAndKey(userId: string, unlockKey: string): Promise<UserVehicleUnlockRecord | null>;
  listByUser(userId: string): Promise<UserVehicleUnlockRecord[]>;
  create(record: UserVehicleUnlockRecord): Promise<UserVehicleUnlockRecord>;
  grantUnlock(input: {
    userId: string;
    unlockKey: string;
    unlockType: string;
    vin?: string | null;
    vinKey?: string | null;
    vehicleKey?: string | null;
    listingKey?: string | null;
    sourceVehicleId?: string | null;
    scanId?: string | null;
  }): Promise<GrantUnlockResult>;
}
