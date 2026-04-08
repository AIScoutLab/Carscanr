import crypto from "node:crypto";
import { seedListings, seedValuations, seedVehicles } from "../data/seedVehicles.js";
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

class MockDatabase {
  vehicles: VehicleRecord[] = [...seedVehicles];
  scans: ScanRecord[] = [];
  garageItems: GarageItemRecord[] = [];
  valuations: ValuationRecord[] = [...seedValuations];
  listings: ListingRecord[] = [...seedListings];
  subscriptions: SubscriptionRecord[] = [
    {
      id: crypto.randomUUID(),
      userId: "demo-user",
      plan: "free",
      status: "active",
      verifiedAt: new Date().toISOString(),
    },
  ];
  usageCounters: UsageCounterRecord[] = [
    {
      id: crypto.randomUUID(),
      userId: "demo-user",
      date: new Date().toISOString().slice(0, 10),
      scanCount: 2,
      totalScans: 2,
      lastScanAt: new Date().toISOString(),
      recentAttemptTimestamps: [],
    },
  ];
  visionDebugRecords: VisionDebugRecord[] = [];
  specsCache: VehicleSpecsCacheRow[] = [];
  valuesCache: VehicleValuesCacheRow[] = [];
  listingsCache: VehicleListingsCacheRow[] = [];
  providerApiUsageLogs: ProviderApiUsageLogRecord[] = [];
  canonicalVehicles: CanonicalVehicleRecord[] = [];
  cachedAnalysis: CachedAnalysisRecord[] = [];
  imageCache: ImageCacheRecord[] = [];
  unlockBalances: UnlockBalanceRecord[] = [];
  vehicleUnlocks: UserVehicleUnlockRecord[] = [];
}

export const db = new MockDatabase();
