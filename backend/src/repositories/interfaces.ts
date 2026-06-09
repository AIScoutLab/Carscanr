import {
  CanonicalVehicleRecord,
  CanonicalGapQueueRecord,
  CanonicalVehicleImageRecord,
  GarageItemRecord,
  ListingRecord,
  ListingClickRecord,
  RevenueCatEventRecord,
  VehiclePhotoClusterMemberRecord,
  VehiclePhotoClusterRecord,
  ScanRecord,
  SubscriptionRecord,
  UsageCounterRecord,
  VehicleGlobalTrendingRecord,
  ValuationRecord,
  VehicleScanPopularityRecord,
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
  findById(id: string): Promise<CanonicalVehicleRecord | null>;
  findByCanonicalKey(canonicalKey: string): Promise<CanonicalVehicleRecord | null>;
  listSearchYears(): Promise<number[]>;
  listSearchMakes(year: number): Promise<string[]>;
  listSearchModels(input: {
    year: number;
    make: string;
  }): Promise<string[]>;
  listSearchTrims(input: {
    year: number;
    make: string;
    model: string;
  }): Promise<CanonicalVehicleRecord[]>;
  findPromotedMatch(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim?: string | null;
  }): Promise<CanonicalVehicleRecord | null>;
  searchPromoted(input: {
    year?: number;
    normalizedMake?: string;
    normalizedModel?: string;
    normalizedTrim?: string | null;
  }): Promise<CanonicalVehicleRecord[]>;
  upsertCandidate(record: CanonicalVehicleRecord): Promise<CanonicalVehicleRecord>;
  promote(canonicalKey: string): Promise<void>;
  incrementPopularity(canonicalKey: string): Promise<void>;
}

export interface CanonicalGapQueueRepository {
  findByGapKey(gapKey: string): Promise<CanonicalGapQueueRecord | null>;
  recordGap(record: CanonicalGapQueueRecord): Promise<{
    record: CanonicalGapQueueRecord;
    action: "insert" | "increment";
  }>;
  listTop(limit: number): Promise<CanonicalGapQueueRecord[]>;
}

export interface VehicleScanPopularityRepository {
  increment(input: {
    normalizedKey: string;
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim: string;
    lastSeenAt: string;
  }): Promise<VehicleScanPopularityRecord>;
  findByNormalizedKey(normalizedKey: string): Promise<VehicleScanPopularityRecord | null>;
  searchLikelyMatches(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
  }): Promise<VehicleScanPopularityRecord[]>;
  findConflicts(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim: string;
    minScanCount: number;
  }): Promise<VehicleScanPopularityRecord[]>;
  listTop(limit: number): Promise<VehicleScanPopularityRecord[]>;
}

export interface VehicleGlobalTrendingRepository {
  upsert(record: VehicleGlobalTrendingRecord): Promise<VehicleGlobalTrendingRecord>;
  findByNormalizedKey(normalizedKey: string): Promise<VehicleGlobalTrendingRecord | null>;
  searchLikelyMatches(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
  }): Promise<VehicleGlobalTrendingRecord[]>;
  listTop(limit: number): Promise<VehicleGlobalTrendingRecord[]>;
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

export interface ListingClicksRepository {
  create(record: ListingClickRecord): Promise<ListingClickRecord>;
}

export interface CanonicalVehicleImagesRepository {
  findApprovedPrimaryByCanonicalKey(canonicalKey: string): Promise<CanonicalVehicleImageRecord | null>;
  findApprovedByCanonicalKey(canonicalKey: string, limit: number): Promise<CanonicalVehicleImageRecord[]>;
  upsertCandidateImage(record: CanonicalVehicleImageRecord): Promise<CanonicalVehicleImageRecord>;
  markApprovedPrimary(input: { canonicalKey: string; imageId: string }): Promise<CanonicalVehicleImageRecord | null>;
  incrementImageStats(input: {
    imageId: string;
    scanCountDelta: number;
    uniqueUserCountDelta: number;
    lastSeenAt: string;
  }): Promise<CanonicalVehicleImageRecord | null>;
  rejectOrQuarantine(input: {
    imageId: string;
    status: "rejected" | "quarantined";
    safetyStatus: "failed" | "manual_review";
  }): Promise<CanonicalVehicleImageRecord | null>;
}

export interface VehiclePhotoClustersRepository {
  findRecentCandidates(input: {
    normalizedMake?: string | null;
    normalizedModel?: string | null;
    normalizedTrim?: string | null;
    canonicalKey?: string | null;
    limit?: number;
  }): Promise<VehiclePhotoClusterRecord[]>;
  findMemberByClusterAndScan(input: {
    clusterId: string;
    scanId: string;
  }): Promise<VehiclePhotoClusterMemberRecord | null>;
  createCluster(record: VehiclePhotoClusterRecord): Promise<VehiclePhotoClusterRecord>;
  addMember(record: VehiclePhotoClusterMemberRecord): Promise<VehiclePhotoClusterMemberRecord>;
  findUserContribution(input: {
    clusterId: string;
    userId: string;
  }): Promise<VehiclePhotoClusterMemberRecord | null>;
  incrementClusterStats(input: {
    clusterId: string;
    memberCountDelta?: number;
    scanCountDelta: number;
    uniqueUserCountDelta: number;
    lastSeenAt: string;
  }): Promise<VehiclePhotoClusterRecord | null>;
  updateCanonicalIdentity(input: {
    clusterId: string;
    canonicalVehicleId?: string | null;
    canonicalKey?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    normalizedMake?: string | null;
    normalizedModel?: string | null;
    normalizedTrim?: string | null;
    confidence?: number | null;
    representativeVisualHash?: string | null;
    canonicalScanId?: string | null;
    canonicalPhotoHash?: string | null;
    canonicalMake?: string | null;
    canonicalModel?: string | null;
    canonicalBadge?: string | null;
    canonicalYear?: number | null;
    matchStrength?: "exact" | "strong" | "possible" | null;
    hammingDistance?: number | null;
    lastSeenAt?: string | null;
  }): Promise<VehiclePhotoClusterRecord | null>;
}

export interface SubscriptionsRepository {
  findActiveByUser(userId: string): Promise<SubscriptionRecord | null>;
  replaceActiveForUser(record: SubscriptionRecord): Promise<SubscriptionRecord>;
}

export interface RevenueCatEventsRepository {
  findById(id: string): Promise<RevenueCatEventRecord | null>;
  findProcessedByTransactionId(transactionId: string): Promise<RevenueCatEventRecord | null>;
  findProcessedSubscriptionGrantByOriginalTransaction(input: {
    userId: string;
    originalTransactionId: string;
  }): Promise<RevenueCatEventRecord | null>;
  findProcessedSubscriptionGrantByAppUserId(input: {
    userId: string;
    appUserId: string;
  }): Promise<RevenueCatEventRecord | null>;
  findRecentProcessedInitialPurchaseGrant(input: {
    userId: string;
    productIds: string[];
    since: string;
    appUserId?: string | null;
    originalTransactionId?: string | null;
  }): Promise<RevenueCatEventRecord | null>;
  findLatestSubscriptionEventByProduct(input: {
    userId: string;
    productIds: string[];
  }): Promise<RevenueCatEventRecord | null>;
  create(record: RevenueCatEventRecord): Promise<RevenueCatEventRecord>;
  markProcessed(id: string, updates: {
    processedAction: string;
    userId?: string | null;
    productId?: string | null;
    transactionId?: string | null;
    originalTransactionId?: string | null;
    payloadSummary?: Record<string, unknown> | null;
    processedAt: string;
  }): Promise<RevenueCatEventRecord>;
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

import { ProviderEndpointType } from "../lib/providerCache.js";

export interface ProviderApiUsageLogsRepository {
  create(record: ProviderApiUsageLogRecord): Promise<ProviderApiUsageLogRecord>;
  summarizeSince(input: { sinceIso: string; provider?: string }): Promise<{
    total: number;
    byEndpoint: Record<ProviderEndpointType, number>;
    byEvent: Record<string, number>;
  }>;
  listSince(input: {
    sinceIso: string;
    provider?: string;
    limit?: number;
  }): Promise<ProviderApiUsageLogRecord[]>;
  deleteOlderThan(cutoffIso: string): Promise<number>;
}

export interface CachedAnalysisRepository {
  findByAnalysisKey(analysisKey: string): Promise<CachedAnalysisRecord | null>;
  insert(record: CachedAnalysisRecord): Promise<CachedAnalysisRecord>;
  update(
    analysisKey: string,
    updates: Partial<Omit<CachedAnalysisRecord, "id" | "analysisKey" | "createdAt">>,
  ): Promise<CachedAnalysisRecord | null>;
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
  usedUnlockCredit: boolean;
  freeUnlocksTotal: number;
  freeUnlocksUsed: number;
  freeUnlocksRemaining: number;
  unlockCreditsRemaining: number;
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
