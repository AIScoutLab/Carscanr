import crypto from "node:crypto";
import { db } from "./mockDatabase.js";
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
  CanonicalVehiclesRepository,
  CachedAnalysisRepository,
  UnlockBalanceRepository,
  ListingsCacheRepository,
  GarageItemsRepository,
  ImageCacheRepository,
  ListingResultsRepository,
  ProviderApiUsageLogsRepository,
  ScansRepository,
  SpecsCacheRepository,
  SubscriptionsRepository,
  UsageCountersRepository,
  ValuationsRepository,
  ValuesCacheRepository,
  VehiclesRepository,
  VehicleUnlockRepository,
  VisionDebugRepository,
} from "./interfaces.js";
import {
  ProviderApiUsageLogRecord,
  VehicleListingsCacheRow,
  VehicleSpecsCacheRow,
  VehicleValuesCacheRow,
} from "../lib/providerCache.js";
import { GrantUnlockResult } from "./interfaces.js";

export class MockScansRepository implements ScansRepository {
  async create(scan: ScanRecord): Promise<ScanRecord> {
    db.scans.unshift(scan);
    return scan;
  }
}

export class MockVehiclesRepository implements VehiclesRepository {
  async findById(vehicleId: string): Promise<VehicleRecord | null> {
    return db.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
  }

  async search(input: { year?: string; make?: string; model?: string }): Promise<VehicleRecord[]> {
    return db.vehicles.filter((vehicle) => {
      const yearMatch = input.year ? String(vehicle.year).includes(input.year) : true;
      const makeMatch = input.make ? vehicle.make.toLowerCase().includes(input.make.toLowerCase()) : true;
      const modelMatch = input.model ? vehicle.model.toLowerCase().includes(input.model.toLowerCase()) : true;
      return yearMatch && makeMatch && modelMatch;
    });
  }

  async searchCandidates(input: { year: number; make: string; model: string; trim?: string }): Promise<VehicleRecord[]> {
    return db.vehicles.filter((vehicle) => {
      const yearMatch = vehicle.year === input.year;
      const makeMatch = vehicle.make.toLowerCase() === input.make.toLowerCase();
      const modelMatch = vehicle.model.toLowerCase() === input.model.toLowerCase();
      const trimMatch = input.trim ? vehicle.trim.toLowerCase().includes(input.trim.toLowerCase()) : true;
      return yearMatch && makeMatch && modelMatch && trimMatch;
    });
  }
}

export class MockCanonicalVehiclesRepository implements CanonicalVehiclesRepository {
  async findById(id: string): Promise<CanonicalVehicleRecord | null> {
    return db.canonicalVehicles.find((vehicle) => vehicle.id === id) ?? null;
  }

  async findByCanonicalKey(canonicalKey: string): Promise<CanonicalVehicleRecord | null> {
    return db.canonicalVehicles.find((vehicle) => vehicle.canonicalKey === canonicalKey) ?? null;
  }

  async findPromotedMatch(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim?: string | null;
  }): Promise<CanonicalVehicleRecord | null> {
    return (
      db.canonicalVehicles.find((vehicle) => {
        if (vehicle.promotionStatus !== "promoted" || !vehicle.specsJson) return false;
        if (vehicle.year !== input.year) return false;
        if (vehicle.normalizedMake !== input.normalizedMake) return false;
        if (vehicle.normalizedModel !== input.normalizedModel) return false;
        if (input.normalizedTrim) {
          return vehicle.normalizedTrim === input.normalizedTrim;
        }
        return vehicle.normalizedTrim == null;
      }) ?? null
    );
  }

  async searchPromoted(input: {
    year?: number;
    normalizedMake?: string;
    normalizedModel?: string;
    normalizedTrim?: string | null;
  }): Promise<CanonicalVehicleRecord[]> {
    return db.canonicalVehicles.filter((vehicle) => {
      if (vehicle.promotionStatus !== "promoted" || !vehicle.specsJson) return false;
      if (input.year && Math.abs(vehicle.year - input.year) > 3) return false;
      if (input.normalizedMake && vehicle.normalizedMake !== input.normalizedMake) return false;
      if (input.normalizedModel && !vehicle.normalizedModel.includes(input.normalizedModel)) return false;
      if (input.normalizedTrim && !(vehicle.normalizedTrim ?? "").includes(input.normalizedTrim)) return false;
      return true;
    });
  }

  async upsertCandidate(record: CanonicalVehicleRecord): Promise<CanonicalVehicleRecord> {
    const existing = db.canonicalVehicles.find((vehicle) => vehicle.canonicalKey === record.canonicalKey);
    if (existing?.promotionStatus === "promoted" && existing.specsJson) {
      return existing;
    }
    db.canonicalVehicles = [record, ...db.canonicalVehicles.filter((vehicle) => vehicle.canonicalKey !== record.canonicalKey)];
    return record;
  }

  async promote(canonicalKey: string): Promise<void> {
    db.canonicalVehicles = db.canonicalVehicles.map((vehicle) =>
      vehicle.canonicalKey === canonicalKey
        ? {
            ...vehicle,
            promotionStatus: "promoted",
            lastPromotedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : vehicle,
    );
  }

  async incrementPopularity(canonicalKey: string): Promise<void> {
    db.canonicalVehicles = db.canonicalVehicles.map((vehicle) =>
      vehicle.canonicalKey === canonicalKey
        ? {
            ...vehicle,
            popularityScore: vehicle.popularityScore + 1,
            lastSeenAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
        : vehicle,
    );
  }
}

export class MockGarageItemsRepository implements GarageItemsRepository {
  async listByUser(userId: string): Promise<GarageItemRecord[]> {
    return db.garageItems.filter((item) => item.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(item: GarageItemRecord): Promise<GarageItemRecord> {
    db.garageItems.unshift(item);
    return item;
  }

  async deleteByUserAndId(userId: string, id: string): Promise<boolean> {
    const index = db.garageItems.findIndex((item) => item.userId === userId && item.id === id);
    if (index === -1) return false;
    db.garageItems.splice(index, 1);
    return true;
  }
}

export class MockValuationsRepository implements ValuationsRepository {
  async findLatest(input: {
    vehicleId: string;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<ValuationRecord | null> {
    const exact = db.valuations.find(
      (value) =>
        value.vehicleId === input.vehicleId &&
        value.zip === input.zip &&
        value.condition === input.condition &&
        value.mileage === input.mileage,
    );
    if (exact) return exact;

    const sameVehicle = db.valuations
      .filter((value) => value.vehicleId === input.vehicleId && value.zip === input.zip)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return sameVehicle[0] ?? null;
  }
}

export class MockListingResultsRepository implements ListingResultsRepository {
  async listByVehicle(input: { vehicleId: string; zip: string; radiusMiles: number }): Promise<ListingRecord[]> {
    return db.listings
      .filter((listing) => listing.vehicleId === input.vehicleId && listing.distanceMiles <= input.radiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);
  }
}

export class MockSubscriptionsRepository implements SubscriptionsRepository {
  async findActiveByUser(userId: string): Promise<SubscriptionRecord | null> {
    return db.subscriptions.find((subscription) => subscription.userId === userId && subscription.status === "active") ?? null;
  }

  async replaceActiveForUser(record: SubscriptionRecord): Promise<SubscriptionRecord> {
    db.subscriptions = db.subscriptions.map((subscription) =>
      subscription.userId === record.userId && subscription.status === "active"
        ? { ...subscription, status: "inactive" }
        : subscription,
    );
    db.subscriptions.unshift(record);
    return record;
  }
}

export class MockUsageCountersRepository implements UsageCountersRepository {
  async findByUserAndDate(userId: string, date: string): Promise<UsageCounterRecord | null> {
    return db.usageCounters.find((record) => record.userId === userId && record.date === date) ?? null;
  }

  async findLifetimeByUser(userId: string): Promise<UsageCounterRecord | null> {
    return db.usageCounters.find((record) => record.userId === userId && record.date === "1970-01-01") ?? null;
  }

  async upsert(record: UsageCounterRecord): Promise<UsageCounterRecord> {
    const index = db.usageCounters.findIndex((item) => item.userId === record.userId && item.date === record.date);
    if (index === -1) {
      db.usageCounters.push(record);
      return record;
    }

    db.usageCounters[index] = record;
    return record;
  }

  async upsertLifetime(record: UsageCounterRecord): Promise<UsageCounterRecord> {
    return this.upsert({ ...record, date: "1970-01-01" });
  }
}

export class MockVisionDebugRepository implements VisionDebugRepository {
  async create(record: VisionDebugRecord): Promise<VisionDebugRecord> {
    db.visionDebugRecords.unshift(record);
    return record;
  }
}

export class MockCachedAnalysisRepository implements CachedAnalysisRepository {
  async findByAnalysisKey(analysisKey: string): Promise<CachedAnalysisRecord | null> {
    return db.cachedAnalysis.find((entry) => entry.analysisKey === analysisKey) ?? null;
  }

  async insert(record: CachedAnalysisRecord): Promise<CachedAnalysisRecord> {
    const existing = db.cachedAnalysis.find((entry) => entry.analysisKey === record.analysisKey);
    if (existing) {
      throw Object.assign(new Error("cached_analysis unique constraint"), { code: "23505" });
    }
    db.cachedAnalysis.unshift(record);
    return record;
  }

  async update(
    analysisKey: string,
    updates: Partial<Omit<CachedAnalysisRecord, "id" | "analysisKey" | "createdAt">>,
  ): Promise<CachedAnalysisRecord> {
    const index = db.cachedAnalysis.findIndex((entry) => entry.analysisKey === analysisKey);
    if (index === -1) {
      throw new Error("cached_analysis row not found");
    }
    const current = db.cachedAnalysis[index];
    const next = { ...current, ...updates, updatedAt: updates.updatedAt ?? new Date().toISOString() };
    db.cachedAnalysis[index] = next;
    return next;
  }

  async markAccessed(analysisKey: string, lastAccessedAt: string): Promise<void> {
    const entry = db.cachedAnalysis.find((row) => row.analysisKey === analysisKey);
    if (entry) {
      entry.hitCount += 1;
      entry.lastAccessedAt = lastAccessedAt;
      entry.updatedAt = lastAccessedAt;
    }
  }
}

export class MockImageCacheRepository implements ImageCacheRepository {
  async findByImageKey(imageKey: string): Promise<ImageCacheRecord | null> {
    return db.imageCache.find((entry) => entry.imageKey === imageKey) ?? null;
  }

  async upsert(record: ImageCacheRecord): Promise<ImageCacheRecord> {
    const index = db.imageCache.findIndex((entry) => entry.imageKey === record.imageKey);
    if (index === -1) {
      db.imageCache.unshift(record);
    } else {
      db.imageCache[index] = record;
    }
    return record;
  }

  async markAccessed(imageKey: string, lastAccessedAt: string): Promise<void> {
    const entry = db.imageCache.find((row) => row.imageKey === imageKey);
    if (entry) {
      entry.hitCount += 1;
      entry.lastAccessedAt = lastAccessedAt;
      entry.updatedAt = lastAccessedAt;
    }
  }

  async listRecent(limit: number): Promise<ImageCacheRecord[]> {
    return db.imageCache.slice(0, limit);
  }
}

export class MockUnlockBalanceRepository implements UnlockBalanceRepository {
  async getByUser(userId: string): Promise<UnlockBalanceRecord | null> {
    return db.unlockBalances.find((entry) => entry.userId === userId) ?? null;
  }

  async getOrCreate(userId: string): Promise<UnlockBalanceRecord> {
    const existing = await this.getByUser(userId);
    if (existing) return existing;
    const record: UnlockBalanceRecord = {
      userId,
      freeUnlocksTotal: 5,
      freeUnlocksUsed: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.unlockBalances.push(record);
    return record;
  }

  async update(record: UnlockBalanceRecord): Promise<UnlockBalanceRecord> {
    const index = db.unlockBalances.findIndex((entry) => entry.userId === record.userId);
    if (index === -1) {
      db.unlockBalances.push(record);
    } else {
      db.unlockBalances[index] = record;
    }
    return record;
  }
}

export class MockVehicleUnlockRepository implements VehicleUnlockRepository {
  async findByUserAndKey(userId: string, unlockKey: string): Promise<UserVehicleUnlockRecord | null> {
    return db.vehicleUnlocks.find((entry) => entry.userId === userId && entry.unlockKey === unlockKey) ?? null;
  }

  async listByUser(userId: string): Promise<UserVehicleUnlockRecord[]> {
    return db.vehicleUnlocks.filter((entry) => entry.userId === userId);
  }

  async create(record: UserVehicleUnlockRecord): Promise<UserVehicleUnlockRecord> {
    const existing = await this.findByUserAndKey(record.userId, record.unlockKey);
    if (existing) {
      throw Object.assign(new Error("user_vehicle_unlocks unique constraint"), { code: "23505" });
    }
    db.vehicleUnlocks.push(record);
    return record;
  }

  async grantUnlock(input: {
    userId: string;
    unlockKey: string;
    unlockType: string;
    vin?: string | null;
    vinKey?: string | null;
    vehicleKey?: string | null;
    listingKey?: string | null;
    sourceVehicleId?: string | null;
    scanId?: string | null;
  }): Promise<GrantUnlockResult> {
    const balanceRepo = new MockUnlockBalanceRepository();
    const balance = await balanceRepo.getOrCreate(input.userId);
    const existing = await this.findByUserAndKey(input.userId, input.unlockKey);
    if (existing) {
      return {
        allowed: true,
        alreadyUnlocked: true,
        usedUnlock: false,
        freeUnlocksTotal: balance.freeUnlocksTotal,
        freeUnlocksUsed: balance.freeUnlocksUsed,
        freeUnlocksRemaining: Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed),
      };
    }
    if (balance.freeUnlocksUsed >= balance.freeUnlocksTotal) {
      return {
        allowed: false,
        alreadyUnlocked: false,
        usedUnlock: false,
        freeUnlocksTotal: balance.freeUnlocksTotal,
        freeUnlocksUsed: balance.freeUnlocksUsed,
        freeUnlocksRemaining: 0,
      };
    }
    const record: UserVehicleUnlockRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      unlockKey: input.unlockKey,
      unlockType: input.unlockType,
      vin: input.vin ?? null,
      vinKey: input.vinKey ?? null,
      vehicleKey: input.vehicleKey ?? null,
      listingKey: input.listingKey ?? null,
      sourceVehicleId: input.sourceVehicleId ?? null,
      scanId: input.scanId ?? null,
      createdAt: new Date().toISOString(),
    };
    db.vehicleUnlocks.push(record);
    balance.freeUnlocksUsed += 1;
    balance.updatedAt = new Date().toISOString();
    await balanceRepo.update(balance);
    return {
      allowed: true,
      alreadyUnlocked: false,
      usedUnlock: true,
      freeUnlocksTotal: balance.freeUnlocksTotal,
      freeUnlocksUsed: balance.freeUnlocksUsed,
      freeUnlocksRemaining: Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed),
    };
  }
}

export class MockSpecsCacheRepository implements SpecsCacheRepository {
  async findByCacheKey(cacheKey: string): Promise<VehicleSpecsCacheRow | null> {
    return db.specsCache.find((entry) => entry.cacheKey === cacheKey) ?? null;
  }

  async upsert(entry: VehicleSpecsCacheRow): Promise<VehicleSpecsCacheRow> {
    db.specsCache = [entry, ...db.specsCache.filter((current) => current.cacheKey !== entry.cacheKey)];
    return entry;
  }

  async markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void> {
    db.specsCache = db.specsCache.map((entry) =>
      entry.cacheKey === cacheKey
        ? { ...entry, hitCount: entry.hitCount + 1, lastAccessedAt, updatedAt: lastAccessedAt }
        : entry,
    );
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const before = db.specsCache.length;
    db.specsCache = db.specsCache.filter((entry) => entry.fetchedAt >= cutoffIso);
    return before - db.specsCache.length;
  }
}

export class MockValuesCacheRepository implements ValuesCacheRepository {
  async findByCacheKey(cacheKey: string): Promise<VehicleValuesCacheRow | null> {
    return db.valuesCache.find((entry) => entry.cacheKey === cacheKey) ?? null;
  }

  async upsert(entry: VehicleValuesCacheRow): Promise<VehicleValuesCacheRow> {
    db.valuesCache = [entry, ...db.valuesCache.filter((current) => current.cacheKey !== entry.cacheKey)];
    return entry;
  }

  async markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void> {
    db.valuesCache = db.valuesCache.map((entry) =>
      entry.cacheKey === cacheKey
        ? { ...entry, hitCount: entry.hitCount + 1, lastAccessedAt, updatedAt: lastAccessedAt }
        : entry,
    );
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const before = db.valuesCache.length;
    db.valuesCache = db.valuesCache.filter((entry) => entry.fetchedAt >= cutoffIso);
    return before - db.valuesCache.length;
  }
}

export class MockListingsCacheRepository implements ListingsCacheRepository {
  async findByCacheKey(cacheKey: string): Promise<VehicleListingsCacheRow | null> {
    return db.listingsCache.find((entry) => entry.cacheKey === cacheKey) ?? null;
  }

  async upsert(entry: VehicleListingsCacheRow): Promise<VehicleListingsCacheRow> {
    db.listingsCache = [entry, ...db.listingsCache.filter((current) => current.cacheKey !== entry.cacheKey)];
    return entry;
  }

  async markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void> {
    db.listingsCache = db.listingsCache.map((entry) =>
      entry.cacheKey === cacheKey
        ? { ...entry, hitCount: entry.hitCount + 1, lastAccessedAt, updatedAt: lastAccessedAt }
        : entry,
    );
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const before = db.listingsCache.length;
    db.listingsCache = db.listingsCache.filter((entry) => entry.fetchedAt >= cutoffIso);
    return before - db.listingsCache.length;
  }
}

export class MockProviderApiUsageLogsRepository implements ProviderApiUsageLogsRepository {
  async create(record: ProviderApiUsageLogRecord): Promise<ProviderApiUsageLogRecord> {
    db.providerApiUsageLogs.unshift(record);
    return record;
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const before = db.providerApiUsageLogs.length;
    db.providerApiUsageLogs = db.providerApiUsageLogs.filter((entry) => entry.createdAt >= cutoffIso);
    return before - db.providerApiUsageLogs.length;
  }
}
