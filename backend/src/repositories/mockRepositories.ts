import crypto from "node:crypto";
import { FREE_PRO_UNLOCKS_TOTAL } from "../config/product.js";
import { db } from "./mockDatabase.js";
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
  CanonicalVehiclesRepository,
  CanonicalGapQueueRepository,
  CachedAnalysisRepository,
  CanonicalVehicleImagesRepository,
  UnlockBalanceRepository,
  ListingsCacheRepository,
  ListingClicksRepository,
  VehiclePhotoClustersRepository,
  GarageItemsRepository,
  ImageCacheRepository,
  ListingResultsRepository,
  ProviderApiUsageLogsRepository,
  RevenueCatEventsRepository,
  ScansRepository,
  SpecsCacheRepository,
  SubscriptionsRepository,
  UsageCountersRepository,
  ValuationsRepository,
  ValuesCacheRepository,
  VehicleGlobalTrendingRepository,
  VehicleScanPopularityRepository,
  VehiclesRepository,
  VehicleUnlockRepository,
  VisionDebugRepository,
} from "./interfaces.js";
import {
  ProviderEndpointType,
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

  async listSearchYears(): Promise<number[]> {
    return Array.from(
      new Set(
        db.canonicalVehicles
          .filter((vehicle) => vehicle.promotionStatus === "promoted" && vehicle.specsJson)
          .map((vehicle) => vehicle.year),
      ),
    ).sort((left, right) => right - left);
  }

  async listSearchMakes(year: number): Promise<string[]> {
    return Array.from(
      new Set(
        db.canonicalVehicles
          .filter((vehicle) => vehicle.promotionStatus === "promoted" && vehicle.specsJson && vehicle.year === year)
          .map((vehicle) => vehicle.make)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  async listSearchModels(input: { year: number; make: string }): Promise<string[]> {
    const normalizedMake = input.make.trim().toLowerCase();
    return Array.from(
      new Set(
        db.canonicalVehicles
          .filter(
            (vehicle) =>
              vehicle.promotionStatus === "promoted" &&
              vehicle.specsJson &&
              vehicle.year === input.year &&
              vehicle.make.trim().toLowerCase() === normalizedMake,
          )
          .map((vehicle) => vehicle.model)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  async listSearchTrims(input: { year: number; make: string; model: string }): Promise<CanonicalVehicleRecord[]> {
    const normalizedMake = input.make.trim().toLowerCase();
    const normalizedModel = input.model.trim().toLowerCase();
    return db.canonicalVehicles
      .filter(
        (vehicle) =>
          vehicle.promotionStatus === "promoted" &&
          vehicle.specsJson &&
          vehicle.year === input.year &&
          vehicle.make.trim().toLowerCase() === normalizedMake &&
          vehicle.model.trim().toLowerCase() === normalizedModel,
      )
      .sort((left, right) => {
        const leftTrim = left.trim?.trim() || "Base";
        const rightTrim = right.trim?.trim() || "Base";
        return leftTrim.localeCompare(rightTrim);
      });
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

export class MockCanonicalGapQueueRepository implements CanonicalGapQueueRepository {
  async findByGapKey(gapKey: string): Promise<CanonicalGapQueueRecord | null> {
    return db.canonicalGapQueue.find((entry) => entry.gapKey === gapKey) ?? null;
  }

  async recordGap(record: CanonicalGapQueueRecord): Promise<{ record: CanonicalGapQueueRecord; action: "insert" | "increment" }> {
    const existing = db.canonicalGapQueue.find((entry) => entry.gapKey === record.gapKey) ?? null;
    if (!existing) {
      db.canonicalGapQueue = [record, ...db.canonicalGapQueue.filter((entry) => entry.gapKey !== record.gapKey)];
      return { record, action: "insert" };
    }
    const updated: CanonicalGapQueueRecord = {
      ...existing,
      canonicalKey: record.canonicalKey,
      year: record.year,
      make: record.make,
      model: record.model,
      trim: existing.trim ?? record.trim ?? null,
      normalizedMake: record.normalizedMake,
      normalizedModel: record.normalizedModel,
      normalizedTrim: record.normalizedTrim,
      bodyType: existing.bodyType ?? record.bodyType ?? null,
      vehicleType: existing.vehicleType ?? record.vehicleType ?? null,
      finalResultType: record.finalResultType,
      payloadStrength: record.payloadStrength,
      exampleConfidence: record.exampleConfidence ?? existing.exampleConfidence ?? null,
      exampleScanId: record.exampleScanId ?? existing.exampleScanId ?? null,
      visibleBadgeText: record.visibleBadgeText ?? existing.visibleBadgeText ?? null,
      visibleMakeText: record.visibleMakeText ?? existing.visibleMakeText ?? null,
      visibleModelText: record.visibleModelText ?? existing.visibleModelText ?? null,
      visibleTrimText: record.visibleTrimText ?? existing.visibleTrimText ?? null,
      notes: record.notes ?? existing.notes ?? null,
      hitCount: existing.hitCount + 1,
      firstSeenAt: existing.firstSeenAt,
      lastSeenAt: record.lastSeenAt,
      updatedAt: record.updatedAt,
    };
    db.canonicalGapQueue = [updated, ...db.canonicalGapQueue.filter((entry) => entry.gapKey !== record.gapKey)];
    return { record: updated, action: "increment" };
  }

  async listTop(limit: number): Promise<CanonicalGapQueueRecord[]> {
    return [...db.canonicalGapQueue]
      .sort((left, right) => right.hitCount - left.hitCount || right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, limit);
  }
}

export class MockVehicleScanPopularityRepository implements VehicleScanPopularityRepository {
  async increment(input: {
    normalizedKey: string;
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim: string;
    lastSeenAt: string;
  }): Promise<VehicleScanPopularityRecord> {
    const existing = db.vehicleScanPopularity.find((entry) => entry.normalizedKey === input.normalizedKey);
    const next: VehicleScanPopularityRecord = existing
      ? {
          ...existing,
          year: input.year,
          normalizedMake: input.normalizedMake,
          normalizedModel: input.normalizedModel,
          normalizedTrim: input.normalizedTrim,
          scanCount: existing.scanCount + 1,
          lastSeenAt: input.lastSeenAt,
          updatedAt: input.lastSeenAt,
        }
      : {
          id: crypto.randomUUID(),
          normalizedKey: input.normalizedKey,
          year: input.year,
          normalizedMake: input.normalizedMake,
          normalizedModel: input.normalizedModel,
          normalizedTrim: input.normalizedTrim,
          scanCount: 1,
          lastSeenAt: input.lastSeenAt,
          createdAt: input.lastSeenAt,
          updatedAt: input.lastSeenAt,
        };
    db.vehicleScanPopularity = [next, ...db.vehicleScanPopularity.filter((entry) => entry.normalizedKey !== input.normalizedKey)];
    return next;
  }

  async findByNormalizedKey(normalizedKey: string): Promise<VehicleScanPopularityRecord | null> {
    return db.vehicleScanPopularity.find((entry) => entry.normalizedKey === normalizedKey) ?? null;
  }

  async searchLikelyMatches(input: { year: number; normalizedMake: string; normalizedModel: string }): Promise<VehicleScanPopularityRecord[]> {
    return db.vehicleScanPopularity
      .filter((entry) => entry.year === input.year && entry.normalizedMake === input.normalizedMake && entry.normalizedModel.includes(input.normalizedModel))
      .sort((left, right) => right.scanCount - left.scanCount);
  }

  async findConflicts(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim: string;
    minScanCount: number;
  }): Promise<VehicleScanPopularityRecord[]> {
    return db.vehicleScanPopularity
      .filter((entry) =>
        entry.year === input.year &&
        entry.normalizedMake === input.normalizedMake &&
        entry.normalizedModel !== input.normalizedModel &&
        entry.scanCount >= input.minScanCount,
      )
      .sort((left, right) => right.scanCount - left.scanCount);
  }

  async listTop(limit: number): Promise<VehicleScanPopularityRecord[]> {
    return [...db.vehicleScanPopularity].sort((left, right) => right.scanCount - left.scanCount).slice(0, limit);
  }
}

export class MockVehicleGlobalTrendingRepository implements VehicleGlobalTrendingRepository {
  async upsert(record: VehicleGlobalTrendingRecord): Promise<VehicleGlobalTrendingRecord> {
    db.vehicleGlobalTrending = [record, ...db.vehicleGlobalTrending.filter((entry) => entry.normalizedKey !== record.normalizedKey)];
    return record;
  }

  async findByNormalizedKey(normalizedKey: string): Promise<VehicleGlobalTrendingRecord | null> {
    return db.vehicleGlobalTrending.find((entry) => entry.normalizedKey === normalizedKey) ?? null;
  }

  async searchLikelyMatches(input: { year: number; normalizedMake: string; normalizedModel: string }): Promise<VehicleGlobalTrendingRecord[]> {
    return db.vehicleGlobalTrending
      .filter((entry) => entry.year === input.year && entry.normalizedMake === input.normalizedMake && entry.normalizedModel.includes(input.normalizedModel))
      .sort((left, right) => right.trendScore - left.trendScore);
  }

  async listTop(limit: number): Promise<VehicleGlobalTrendingRecord[]> {
    return [...db.vehicleGlobalTrending].sort((left, right) => right.trendScore - left.trendScore).slice(0, limit);
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

export class MockListingClicksRepository implements ListingClicksRepository {
  async create(record: ListingClickRecord): Promise<ListingClickRecord> {
    return record;
  }
}

export class MockCanonicalVehicleImagesRepository implements CanonicalVehicleImagesRepository {
  async findApprovedPrimaryByCanonicalKey(canonicalKey: string): Promise<CanonicalVehicleImageRecord | null> {
    return (
      db.canonicalVehicleImages.find(
        (record) =>
          record.canonicalKey === canonicalKey &&
          record.isPrimary &&
          record.status === "approved" &&
          record.safetyStatus === "passed",
      ) ?? null
    );
  }

  async findApprovedByCanonicalKey(canonicalKey: string, limit: number): Promise<CanonicalVehicleImageRecord[]> {
    return db.canonicalVehicleImages
      .filter(
        (record) =>
          record.canonicalKey === canonicalKey &&
          record.status === "approved" &&
          record.safetyStatus === "passed",
      )
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || right.qualityScore - left.qualityScore)
      .slice(0, limit);
  }

  async upsertCandidateImage(record: CanonicalVehicleImageRecord): Promise<CanonicalVehicleImageRecord> {
    const existing = db.canonicalVehicleImages.find(
      (entry) => entry.canonicalKey === record.canonicalKey && entry.imageKey && entry.imageKey === record.imageKey,
    );
    if (existing) {
      const merged = { ...existing, ...record, id: existing.id, createdAt: existing.createdAt };
      db.canonicalVehicleImages = [merged, ...db.canonicalVehicleImages.filter((entry) => entry.id !== existing.id)];
      return merged;
    }
    db.canonicalVehicleImages.unshift(record);
    return record;
  }

  async markApprovedPrimary(input: { canonicalKey: string; imageId: string }): Promise<CanonicalVehicleImageRecord | null> {
    let selected: CanonicalVehicleImageRecord | null = null;
    db.canonicalVehicleImages = db.canonicalVehicleImages.map((record) => {
      if (record.canonicalKey !== input.canonicalKey) return record;
      const next =
        record.id === input.imageId
          ? { ...record, isPrimary: true, status: "approved" as const, safetyStatus: "passed" as const }
          : { ...record, isPrimary: false };
      if (record.id === input.imageId) selected = next;
      return next;
    });
    return selected;
  }

  async incrementImageStats(input: {
    imageId: string;
    scanCountDelta: number;
    uniqueUserCountDelta: number;
    lastSeenAt: string;
  }): Promise<CanonicalVehicleImageRecord | null> {
    let updated: CanonicalVehicleImageRecord | null = null;
    db.canonicalVehicleImages = db.canonicalVehicleImages.map((record) => {
      if (record.id !== input.imageId) return record;
      updated = {
        ...record,
        scanCount: record.scanCount + input.scanCountDelta,
        uniqueUserCount: record.uniqueUserCount + input.uniqueUserCountDelta,
        lastSeenAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
      return updated;
    });
    return updated;
  }

  async rejectOrQuarantine(input: {
    imageId: string;
    status: "rejected" | "quarantined";
    safetyStatus: "failed" | "manual_review";
  }): Promise<CanonicalVehicleImageRecord | null> {
    let updated: CanonicalVehicleImageRecord | null = null;
    db.canonicalVehicleImages = db.canonicalVehicleImages.map((record) => {
      if (record.id !== input.imageId) return record;
      updated = { ...record, status: input.status, safetyStatus: input.safetyStatus, isPrimary: false };
      return updated;
    });
    return updated;
  }
}

export class MockVehiclePhotoClustersRepository implements VehiclePhotoClustersRepository {
  private getCanonicalPriorityRank(strength?: "exact" | "strong" | "possible" | null) {
    switch (strength) {
      case "exact":
        return 3;
      case "strong":
        return 2;
      case "possible":
        return 1;
      default:
        return 0;
    }
  }

  private getCanonicalMetadataRichness(input: {
    canonicalVehicleId?: string | null;
    canonicalKey?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    normalizedMake?: string | null;
    normalizedModel?: string | null;
    normalizedTrim?: string | null;
  }) {
    return [
      input.canonicalVehicleId,
      input.canonicalKey,
      input.year,
      input.make,
      input.model,
      input.trim,
      input.normalizedMake,
      input.normalizedModel,
      input.normalizedTrim,
    ].filter((value) => value !== null && value !== undefined && value !== "").length;
  }

  private shouldUpgradeCanonicalIdentity(current: VehiclePhotoClusterRecord, input: {
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
    canonicalScanId?: string | null;
    canonicalPhotoHash?: string | null;
    canonicalMake?: string | null;
    canonicalModel?: string | null;
    canonicalBadge?: string | null;
    canonicalYear?: number | null;
    matchStrength?: "exact" | "strong" | "possible" | null;
    hammingDistance?: number | null;
    representativeVisualHash?: string | null;
    lastSeenAt?: string | null;
  }) {
    if (!current.canonicalKey && !current.canonicalVehicleId) return true;

    const currentRank = this.getCanonicalPriorityRank(current.canonicalMatchStrength);
    const nextRank = this.getCanonicalPriorityRank(input.matchStrength);
    if (nextRank > currentRank) return true;
    if (nextRank < currentRank) return false;

    const currentDistance = current.canonicalHammingDistance;
    const nextDistance = input.hammingDistance;
    if (currentDistance != null && nextDistance != null) {
      if (nextDistance < currentDistance) return true;
      if (nextDistance > currentDistance) return false;
    } else if (nextDistance != null && currentDistance == null) {
      return true;
    } else if (currentDistance != null && nextDistance == null) {
      return false;
    }

    const currentRichness = this.getCanonicalMetadataRichness(current);
    const nextRichness = this.getCanonicalMetadataRichness(input);
    if (nextRichness > currentRichness) return true;
    if (nextRichness < currentRichness) return false;

    const currentConfidence = current.confidence ?? 0;
    const nextConfidence = input.confidence ?? 0;
    if (nextConfidence > currentConfidence) return true;
    if (nextConfidence < currentConfidence) return false;

    return Boolean(input.lastSeenAt && input.lastSeenAt > current.lastSeenAt);
  }

  async findRecentCandidates(input: {
    normalizedMake?: string | null;
    normalizedModel?: string | null;
    normalizedTrim?: string | null;
    canonicalKey?: string | null;
    limit?: number;
  }): Promise<VehiclePhotoClusterRecord[]> {
    return [...db.vehiclePhotoClusters]
      .filter((cluster) => {
        if (input.canonicalKey && cluster.canonicalKey === input.canonicalKey) return true;
        if (input.normalizedMake && cluster.normalizedMake !== input.normalizedMake) return false;
        if (input.normalizedModel && cluster.normalizedModel !== input.normalizedModel) return false;
        if (input.normalizedTrim && cluster.normalizedTrim && cluster.normalizedTrim !== input.normalizedTrim) return false;
        return true;
      })
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
      .slice(0, input.limit ?? 25);
  }

  async findMemberByClusterAndScan(input: {
    clusterId: string;
    scanId: string;
  }): Promise<VehiclePhotoClusterMemberRecord | null> {
    return db.vehiclePhotoClusterMembers.find((member) => member.clusterId === input.clusterId && member.scanId === input.scanId) ?? null;
  }

  async createCluster(record: VehiclePhotoClusterRecord): Promise<VehiclePhotoClusterRecord> {
    const existing = db.vehiclePhotoClusters.find(
      (cluster) => cluster.representativeVisualHash === record.representativeVisualHash,
    );
    if (existing) return existing;
    db.vehiclePhotoClusters.unshift(record);
    return record;
  }

  async addMember(record: VehiclePhotoClusterMemberRecord): Promise<VehiclePhotoClusterMemberRecord> {
    const existing = db.vehiclePhotoClusterMembers.find(
      (member) => member.clusterId === record.clusterId && member.scanId === record.scanId,
    );
    if (existing) return existing;
    db.vehiclePhotoClusterMembers.unshift(record);
    return record;
  }

  async findUserContribution(input: { clusterId: string; userId: string }): Promise<VehiclePhotoClusterMemberRecord | null> {
    return (
      db.vehiclePhotoClusterMembers.find(
        (member) => member.clusterId === input.clusterId && member.userId === input.userId,
      ) ?? null
    );
  }

  async incrementClusterStats(input: {
    clusterId: string;
    memberCountDelta?: number;
    scanCountDelta: number;
    uniqueUserCountDelta: number;
    lastSeenAt: string;
  }): Promise<VehiclePhotoClusterRecord | null> {
    let updated: VehiclePhotoClusterRecord | null = null;
    db.vehiclePhotoClusters = db.vehiclePhotoClusters.map((cluster) => {
      if (cluster.id !== input.clusterId) return cluster;
      updated = {
        ...cluster,
        memberCount: Math.max(0, (cluster.memberCount ?? 0) + (input.memberCountDelta ?? 0)),
        scanCount: (cluster.scanCount ?? 0) + input.scanCountDelta,
        uniqueUserCount: (cluster.uniqueUserCount ?? 0) + input.uniqueUserCountDelta,
        lastSeenAt: input.lastSeenAt,
        updatedAt: input.lastSeenAt,
      };
      return updated;
    });
    return updated;
  }

  async updateCanonicalIdentity(input: {
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
  }): Promise<VehiclePhotoClusterRecord | null> {
    let updated: VehiclePhotoClusterRecord | null = null;
    db.vehiclePhotoClusters = db.vehiclePhotoClusters.map((cluster) => {
      if (cluster.id !== input.clusterId) return cluster;
      const shouldUpgrade = this.shouldUpgradeCanonicalIdentity(cluster, input);
      updated = {
        ...cluster,
        canonicalScanId: shouldUpgrade ? input.canonicalScanId ?? cluster.canonicalScanId ?? null : cluster.canonicalScanId ?? null,
        canonicalPhotoHash: shouldUpgrade
          ? input.canonicalPhotoHash ?? input.representativeVisualHash ?? cluster.canonicalPhotoHash ?? cluster.representativeVisualHash
          : cluster.canonicalPhotoHash ?? cluster.representativeVisualHash,
        canonicalVehicleId: shouldUpgrade ? input.canonicalVehicleId ?? cluster.canonicalVehicleId ?? null : cluster.canonicalVehicleId ?? null,
        canonicalKey: shouldUpgrade ? input.canonicalKey ?? cluster.canonicalKey ?? null : cluster.canonicalKey ?? null,
        canonicalMake: shouldUpgrade ? input.canonicalMake ?? input.make ?? cluster.canonicalMake ?? cluster.make ?? null : cluster.canonicalMake ?? cluster.make ?? null,
        canonicalModel: shouldUpgrade ? input.canonicalModel ?? input.model ?? cluster.canonicalModel ?? cluster.model ?? null : cluster.canonicalModel ?? cluster.model ?? null,
        canonicalBadge: shouldUpgrade ? input.canonicalBadge ?? input.trim ?? cluster.canonicalBadge ?? cluster.trim ?? null : cluster.canonicalBadge ?? cluster.trim ?? null,
        canonicalYear: shouldUpgrade ? input.canonicalYear ?? input.year ?? cluster.canonicalYear ?? cluster.year ?? null : cluster.canonicalYear ?? cluster.year ?? null,
        canonicalMatchStrength: shouldUpgrade ? input.matchStrength ?? cluster.canonicalMatchStrength ?? null : cluster.canonicalMatchStrength ?? null,
        canonicalHammingDistance: shouldUpgrade ? input.hammingDistance ?? cluster.canonicalHammingDistance ?? null : cluster.canonicalHammingDistance ?? null,
        year: shouldUpgrade ? input.year ?? cluster.year ?? null : cluster.year ?? null,
        make: shouldUpgrade ? input.make ?? cluster.make ?? null : cluster.make ?? null,
        model: shouldUpgrade ? input.model ?? cluster.model ?? null : cluster.model ?? null,
        trim: shouldUpgrade ? input.trim ?? cluster.trim ?? null : cluster.trim ?? null,
        normalizedMake: shouldUpgrade ? input.normalizedMake ?? cluster.normalizedMake ?? null : cluster.normalizedMake ?? null,
        normalizedModel: shouldUpgrade ? input.normalizedModel ?? cluster.normalizedModel ?? null : cluster.normalizedModel ?? null,
        normalizedTrim: shouldUpgrade ? input.normalizedTrim ?? cluster.normalizedTrim ?? null : cluster.normalizedTrim ?? null,
        confidence: shouldUpgrade ? Math.max(cluster.confidence, input.confidence ?? 0) : cluster.confidence,
        representativeVisualHash: input.representativeVisualHash ?? cluster.representativeVisualHash,
        lastSeenAt: input.lastSeenAt ?? cluster.lastSeenAt,
        updatedAt: input.lastSeenAt ?? cluster.updatedAt,
      };
      return updated;
    });
    return updated;
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

export class MockRevenueCatEventsRepository implements RevenueCatEventsRepository {
  async findById(id: string): Promise<RevenueCatEventRecord | null> {
    return db.revenueCatEvents.find((event) => event.id === id) ?? null;
  }

  async findProcessedByTransactionId(transactionId: string): Promise<RevenueCatEventRecord | null> {
    return (
      db.revenueCatEvents.find((event) => event.transactionId === transactionId && event.processed) ?? null
    );
  }

  async findProcessedSubscriptionGrantByOriginalTransaction(input: {
    userId: string;
    originalTransactionId: string;
  }): Promise<RevenueCatEventRecord | null> {
    return (
      db.revenueCatEvents.find(
        (event) =>
          event.userId === input.userId &&
          event.originalTransactionId === input.originalTransactionId &&
          event.processed &&
          event.processedAction === "pro_granted",
      ) ?? null
    );
  }

  async findProcessedSubscriptionGrantByAppUserId(input: {
    userId: string;
    appUserId: string;
  }): Promise<RevenueCatEventRecord | null> {
    return (
      db.revenueCatEvents.find(
        (event) =>
          event.userId === input.userId &&
          event.appUserId === input.appUserId &&
          event.processed &&
          event.processedAction === "pro_granted",
      ) ?? null
    );
  }

  async findRecentProcessedInitialPurchaseGrant(input: {
    userId: string;
    productIds: string[];
    since: string;
    appUserId?: string | null;
    originalTransactionId?: string | null;
  }): Promise<RevenueCatEventRecord | null> {
    const sinceMs = new Date(input.since).getTime();
    return (
      db.revenueCatEvents.find((event) => {
        if (
          event.userId !== input.userId ||
          event.eventType !== "INITIAL_PURCHASE" ||
          !event.productId ||
          !input.productIds.includes(event.productId) ||
          !event.processed ||
          event.processedAction !== "pro_granted" ||
          new Date(event.createdAt).getTime() < sinceMs
        ) {
          return false;
        }
        if (input.appUserId && event.appUserId !== input.appUserId) {
          return false;
        }
        if (input.originalTransactionId && event.originalTransactionId !== input.originalTransactionId) {
          return false;
        }
        return true;
      }) ?? null
    );
  }

  async findLatestSubscriptionEventByProduct(input: {
    userId: string;
    productIds: string[];
  }): Promise<RevenueCatEventRecord | null> {
    return (
      db.revenueCatEvents
        .filter((event) => event.userId === input.userId && Boolean(event.productId && input.productIds.includes(event.productId)))
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] ?? null
    );
  }

  async create(record: RevenueCatEventRecord): Promise<RevenueCatEventRecord> {
    const existing = await this.findById(record.id);
    if (existing) {
      throw Object.assign(new Error("revenuecat_events unique constraint"), { code: "23505" });
    }
    db.revenueCatEvents.unshift(record);
    return record;
  }

  async markProcessed(id: string, updates: {
    processedAction: string;
    userId?: string | null;
    productId?: string | null;
    transactionId?: string | null;
    originalTransactionId?: string | null;
    payloadSummary?: Record<string, unknown> | null;
    processedAt: string;
  }): Promise<RevenueCatEventRecord> {
    const index = db.revenueCatEvents.findIndex((event) => event.id === id);
    if (index === -1) {
      throw Object.assign(new Error("RevenueCat event not found"), { code: "PGRST116" });
    }
    const updated: RevenueCatEventRecord = {
      ...db.revenueCatEvents[index],
      userId: updates.userId ?? db.revenueCatEvents[index].userId ?? null,
      productId: updates.productId ?? db.revenueCatEvents[index].productId ?? null,
      transactionId: updates.transactionId ?? db.revenueCatEvents[index].transactionId ?? null,
      originalTransactionId: updates.originalTransactionId ?? db.revenueCatEvents[index].originalTransactionId ?? null,
      payloadSummary: updates.payloadSummary ?? db.revenueCatEvents[index].payloadSummary ?? null,
      processed: true,
      processedAction: updates.processedAction,
      processedAt: updates.processedAt,
    };
    db.revenueCatEvents[index] = updated;
    return updated;
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
  ): Promise<CachedAnalysisRecord | null> {
    const index = db.cachedAnalysis.findIndex((entry) => entry.analysisKey === analysisKey);
    if (index === -1) {
      return null;
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
      freeUnlocksTotal: FREE_PRO_UNLOCKS_TOTAL,
      freeUnlocksUsed: 0,
      unlockCredits: 0,
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
        usedUnlockCredit: false,
        freeUnlocksTotal: balance.freeUnlocksTotal,
        freeUnlocksUsed: balance.freeUnlocksUsed,
        freeUnlocksRemaining: Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed),
        unlockCreditsRemaining: balance.unlockCredits,
      };
    }
    if (balance.freeUnlocksUsed >= balance.freeUnlocksTotal && balance.unlockCredits <= 0) {
      return {
        allowed: false,
        alreadyUnlocked: false,
        usedUnlock: false,
        usedUnlockCredit: false,
        freeUnlocksTotal: balance.freeUnlocksTotal,
        freeUnlocksUsed: balance.freeUnlocksUsed,
        freeUnlocksRemaining: 0,
        unlockCreditsRemaining: balance.unlockCredits,
      };
    }
    const consumedCredit = balance.freeUnlocksUsed >= balance.freeUnlocksTotal && balance.unlockCredits > 0;
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
    if (!consumedCredit) {
      balance.freeUnlocksUsed += 1;
    } else {
      balance.unlockCredits -= 1;
    }
    balance.updatedAt = new Date().toISOString();
    await balanceRepo.update(balance);
    return {
      allowed: true,
      alreadyUnlocked: false,
      usedUnlock: true,
      usedUnlockCredit: consumedCredit,
      freeUnlocksTotal: balance.freeUnlocksTotal,
      freeUnlocksUsed: balance.freeUnlocksUsed,
      freeUnlocksRemaining: Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed),
      unlockCreditsRemaining: balance.unlockCredits,
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

  async summarizeSince(input: {
    sinceIso: string;
    provider?: string;
  }): Promise<{
    total: number;
    byEndpoint: Record<ProviderEndpointType, number>;
    byEvent: Record<string, number>;
  }> {
    const filtered = db.providerApiUsageLogs.filter(
      (entry) => entry.createdAt >= input.sinceIso && (!input.provider || entry.provider === input.provider),
    );
    const byEndpoint: Record<ProviderEndpointType, number> = {
      specs: 0,
      values: 0,
      listings: 0,
    };
    const byEvent: Record<string, number> = {};

    for (const entry of filtered) {
      byEvent[entry.eventType] = (byEvent[entry.eventType] ?? 0) + 1;
      if (entry.eventType === "provider_request") {
        byEndpoint[entry.endpointType] += 1;
      }
    }

    return {
      total: byEvent.provider_request ?? 0,
      byEndpoint,
      byEvent,
    };
  }

  async listSince(input: {
    sinceIso: string;
    provider?: string;
    limit?: number;
  }): Promise<ProviderApiUsageLogRecord[]> {
    const filtered = db.providerApiUsageLogs.filter(
      (entry) => entry.createdAt >= input.sinceIso && (!input.provider || entry.provider === input.provider),
    );
    return filtered.slice(0, input.limit ?? 200);
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const before = db.providerApiUsageLogs.length;
    db.providerApiUsageLogs = db.providerApiUsageLogs.filter((entry) => entry.createdAt >= cutoffIso);
    return before - db.providerApiUsageLogs.length;
  }
}
