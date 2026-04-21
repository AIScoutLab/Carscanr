import {
  CachedAnalysisRecord,
  CanonicalVehicleRecord,
  GarageItemRecord,
  ImageCacheRecord,
  ListingRecord,
  MarketListingsCacheRecord,
  MarketValueCacheRecord,
  ScanRecord,
  SubscriptionRecord,
  UnlockBalanceRecord,
  UserVehicleUnlockRecord,
  UsageCounterRecord,
  ValuationRecord,
  VehicleRecord,
  VisionDebugRecord,
  VisionProviderResult,
} from "../../src/types/domain.js";
import { ProviderRegistry } from "../../src/lib/providerRegistry.js";
import { RepositoryRegistry } from "../../src/lib/repositoryRegistry.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function createVehicleFixtures(): VehicleRecord[] {
  return [
    {
      id: "2021-cadillac-ct4-premium-luxury",
      year: 2021,
      make: "Cadillac",
      model: "CT4",
      trim: "Premium Luxury",
      bodyStyle: "Sedan",
      vehicleType: "car",
      msrp: 38690,
      engine: "2.0L turbo I4",
      horsepower: 237,
      torque: "258 lb-ft",
      transmission: "8-speed automatic",
      drivetrain: "RWD",
      mpgOrRange: "23 city / 34 highway",
      colors: ["Summit White", "Black Raven", "Infrared Tintcoat"],
    },
    {
      id: "2020-honda-civic-ex",
      year: 2020,
      make: "Honda",
      model: "Civic",
      trim: "EX",
      bodyStyle: "Sedan",
      vehicleType: "car",
      msrp: 24100,
      engine: "1.5L turbo I4",
      horsepower: 174,
      torque: "162 lb-ft",
      transmission: "CVT",
      drivetrain: "FWD",
      mpgOrRange: "32 city / 42 highway",
      colors: ["Platinum White Pearl", "Aegean Blue Metallic"],
    },
    {
      id: "2019-ford-mustang-gt",
      year: 2019,
      make: "Ford",
      model: "Mustang",
      trim: "GT",
      bodyStyle: "Coupe",
      vehicleType: "car",
      msrp: 35995,
      engine: "5.0L V8",
      horsepower: 460,
      torque: "420 lb-ft",
      transmission: "6-speed manual",
      drivetrain: "RWD",
      mpgOrRange: "15 city / 24 highway",
      colors: ["Race Red", "Oxford White"],
    },
  ];
}

export function createTestRepositories(seed?: {
  vehicles?: VehicleRecord[];
  canonicalVehicles?: CanonicalVehicleRecord[];
  valuations?: ValuationRecord[];
  listings?: ListingRecord[];
  subscriptions?: SubscriptionRecord[];
  usageCounters?: UsageCounterRecord[];
  garageItems?: GarageItemRecord[];
  scans?: ScanRecord[];
  visionDebug?: VisionDebugRecord[];
}) {
  const state = {
    vehicles: [...(seed?.vehicles ?? createVehicleFixtures())],
    valuations: [
      ...(seed?.valuations ?? [
        {
          id: "val-ct4",
          vehicleId: "2021-cadillac-ct4-premium-luxury",
          zip: "60610",
          mileage: 12000,
          condition: "good",
          tradeIn: 27000,
          privateParty: 28900,
          dealerRetail: 30900,
          currency: "USD" as const,
          generatedAt: "2026-03-30T10:00:00.000Z",
        },
      ]),
    ],
    listings: [
      ...(seed?.listings ?? [
        {
          id: "listing-ct4-1",
          vehicleId: "2021-cadillac-ct4-premium-luxury",
          title: "2021 Cadillac CT4 Premium Luxury",
          price: 31995,
          mileage: 14820,
          dealer: "North Shore Cadillac",
          distanceMiles: 12,
          location: "Chicago, IL",
          imageUrl: "https://example.com/ct4.jpg",
          listedAt: "2026-03-29T12:00:00.000Z",
        },
      ]),
    ],
    subscriptions: [...(seed?.subscriptions ?? [])],
    usageCounters: [...(seed?.usageCounters ?? [])],
    garageItems: [...(seed?.garageItems ?? [])],
    scans: [...(seed?.scans ?? [])],
    visionDebug: [...(seed?.visionDebug ?? [])],
    specsCache: [],
    valuesCache: [],
    listingsCache: [],
    marketValueCache: [] as MarketValueCacheRecord[],
    marketListingsCache: [] as MarketListingsCacheRecord[],
    providerApiUsageLogs: [],
    canonicalVehicles: [...(seed?.canonicalVehicles ?? [])],
    cachedAnalysis: [] as CachedAnalysisRecord[],
    imageCache: [] as ImageCacheRecord[],
    unlockBalances: [] as UnlockBalanceRecord[],
    vehicleUnlocks: [] as UserVehicleUnlockRecord[],
    vehicleScanPopularity: [],
    vehicleGlobalTrending: [],
  };

  const repositories: RepositoryRegistry = {
    scans: {
      async create(scan) {
        state.scans.push(scan);
        return scan;
      },
    },
    vehicles: {
      async findById(vehicleId) {
        return state.vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null;
      },
      async search(input) {
        return state.vehicles.filter((vehicle) => {
          const matchesYear = input.year ? String(vehicle.year) === input.year : true;
          const matchesMake = input.make ? vehicle.make.toLowerCase().includes(input.make.toLowerCase()) : true;
          const matchesModel = input.model ? vehicle.model.toLowerCase().includes(input.model.toLowerCase()) : true;
          return matchesYear && matchesMake && matchesModel;
        });
      },
      async searchCandidates(input) {
        return state.vehicles.filter((vehicle) => {
          const makeMatch = vehicle.make.toLowerCase() === input.make.toLowerCase();
          const modelMatch = vehicle.model.toLowerCase() === input.model.toLowerCase();
          const yearMatch = vehicle.year === input.year;
          const trimMatch = input.trim ? vehicle.trim.toLowerCase().includes(input.trim.toLowerCase()) : true;
          return makeMatch && modelMatch && yearMatch && trimMatch;
        });
      },
    },
    canonicalVehicles: {
      async findById(id) {
        return state.canonicalVehicles.find((vehicle) => vehicle.id === id) ?? null;
      },
      async findByCanonicalKey(canonicalKey) {
        return state.canonicalVehicles.find((vehicle) => vehicle.canonicalKey === canonicalKey) ?? null;
      },
      async findPromotedMatch(input) {
        return (
          state.canonicalVehicles.find((vehicle) => {
            if (vehicle.promotionStatus !== "promoted" || !vehicle.specsJson) return false;
            if (vehicle.year !== input.year) return false;
            if (vehicle.normalizedMake !== input.normalizedMake) return false;
            if (vehicle.normalizedModel !== input.normalizedModel) return false;
            if (input.normalizedTrim) return vehicle.normalizedTrim === input.normalizedTrim;
            return vehicle.normalizedTrim == null;
          }) ?? null
        );
      },
      async searchPromoted(input) {
        return state.canonicalVehicles.filter((vehicle) => {
          if (vehicle.promotionStatus !== "promoted") return false;
          if (input.year != null && vehicle.year !== input.year) return false;
          if (input.normalizedMake && vehicle.normalizedMake !== input.normalizedMake) return false;
          if (input.normalizedModel && vehicle.normalizedModel !== input.normalizedModel) return false;
          if (input.normalizedTrim != null && vehicle.normalizedTrim !== input.normalizedTrim) return false;
          return true;
        });
      },
      async upsertCandidate(record) {
        const existing = state.canonicalVehicles.find((vehicle) => vehicle.canonicalKey === record.canonicalKey);
        if (existing?.promotionStatus === "promoted" && existing.specsJson) {
          return existing;
        }
        state.canonicalVehicles = [record, ...state.canonicalVehicles.filter((vehicle) => vehicle.canonicalKey !== record.canonicalKey)];
        return record;
      },
      async promote(canonicalKey) {
        state.canonicalVehicles = state.canonicalVehicles.map((vehicle) =>
          vehicle.canonicalKey === canonicalKey
            ? { ...vehicle, promotionStatus: "promoted", lastPromotedAt: new Date().toISOString() }
            : vehicle,
        );
      },
      async incrementPopularity(canonicalKey) {
        state.canonicalVehicles = state.canonicalVehicles.map((vehicle) =>
          vehicle.canonicalKey === canonicalKey
            ? { ...vehicle, popularityScore: vehicle.popularityScore + 1, lastSeenAt: new Date().toISOString() }
            : vehicle,
        );
      },
    },
    cachedAnalysis: {
      async findByAnalysisKey(analysisKey) {
        return state.cachedAnalysis.find((entry) => entry.analysisKey === analysisKey) ?? null;
      },
      async insert(record) {
        state.cachedAnalysis = [record, ...state.cachedAnalysis.filter((entry) => entry.analysisKey !== record.analysisKey)];
        return record;
      },
      async update(analysisKey, updates) {
        const existing = state.cachedAnalysis.find((entry) => entry.analysisKey === analysisKey);
        if (!existing) {
          throw new Error(`Cached analysis ${analysisKey} not found`);
        }
        const updated = { ...existing, ...updates };
        state.cachedAnalysis = [updated, ...state.cachedAnalysis.filter((entry) => entry.analysisKey !== analysisKey)];
        return updated;
      },
      async markAccessed(analysisKey, lastAccessedAt) {
        state.cachedAnalysis = state.cachedAnalysis.map((entry) =>
          entry.analysisKey === analysisKey ? { ...entry, lastAccessedAt, hitCount: entry.hitCount + 1 } : entry,
        );
      },
    },
    imageCache: {
      async findByImageKey(imageKey) {
        return state.imageCache.find((entry) => entry.imageKey === imageKey) ?? null;
      },
      async upsert(record) {
        state.imageCache = [record, ...state.imageCache.filter((entry) => entry.imageKey !== record.imageKey)];
        return record;
      },
      async markAccessed(imageKey, lastAccessedAt) {
        state.imageCache = state.imageCache.map((entry) =>
          entry.imageKey === imageKey ? { ...entry, lastAccessedAt, hitCount: entry.hitCount + 1 } : entry,
        );
      },
      async listRecent(limit) {
        return state.imageCache.slice(0, limit);
      },
    },
    unlockBalances: {
      async getByUser(userId) {
        return state.unlockBalances.find((entry) => entry.userId === userId) ?? null;
      },
      async getOrCreate(userId) {
        const existing = state.unlockBalances.find((entry) => entry.userId === userId);
        if (existing) {
          return existing;
        }
        const created = {
          userId,
          freeUnlocksTotal: 5,
          freeUnlocksUsed: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.unlockBalances.push(created);
        return created;
      },
      async update(record) {
        state.unlockBalances = [record, ...state.unlockBalances.filter((entry) => entry.userId !== record.userId)];
        return record;
      },
    },
    vehicleUnlocks: {
      async findByUserAndKey(userId, unlockKey) {
        return state.vehicleUnlocks.find((entry) => entry.userId === userId && entry.unlockKey === unlockKey) ?? null;
      },
      async listByUser(userId) {
        return state.vehicleUnlocks.filter((entry) => entry.userId === userId);
      },
      async create(record) {
        state.vehicleUnlocks.push(record);
        return record;
      },
      async grantUnlock(input) {
        const existing = state.vehicleUnlocks.find((entry) => entry.userId === input.userId && entry.unlockKey === input.unlockKey);
        const balance = await repositories.unlockBalances.getOrCreate(input.userId);
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
        const updatedBalance = {
          ...balance,
          freeUnlocksUsed: balance.freeUnlocksUsed + 1,
          updatedAt: new Date().toISOString(),
        };
        await repositories.unlockBalances.update(updatedBalance);
        const record = {
          id: `unlock-${state.vehicleUnlocks.length + 1}`,
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
        state.vehicleUnlocks.push(record);
        return {
          allowed: true,
          alreadyUnlocked: false,
          usedUnlock: true,
          freeUnlocksTotal: updatedBalance.freeUnlocksTotal,
          freeUnlocksUsed: updatedBalance.freeUnlocksUsed,
          freeUnlocksRemaining: Math.max(0, updatedBalance.freeUnlocksTotal - updatedBalance.freeUnlocksUsed),
        };
      },
    },
    garageItems: {
      async listByUser(userId) {
        return state.garageItems.filter((item) => item.userId === userId);
      },
      async create(item) {
        state.garageItems.push(item);
        return item;
      },
      async deleteByUserAndId(userId, id) {
        const index = state.garageItems.findIndex((item) => item.userId === userId && item.id === id);
        if (index === -1) return false;
        state.garageItems.splice(index, 1);
        return true;
      },
    },
    valuations: {
      async findLatest(input) {
        return (
          state.valuations.find(
            (item) =>
              item.vehicleId === input.vehicleId &&
              item.zip === input.zip &&
              item.condition === input.condition &&
              item.mileage === input.mileage,
          ) ?? null
        );
      },
    },
    listingResults: {
      async listByVehicle(input) {
        return state.listings.filter((listing) => listing.vehicleId === input.vehicleId);
      },
    },
    subscriptions: {
      async findActiveByUser(userId) {
        return state.subscriptions.find((subscription) => subscription.userId === userId && subscription.status === "active") ?? null;
      },
      async replaceActiveForUser(record) {
        const remaining = state.subscriptions.filter((subscription) => subscription.userId !== record.userId);
        state.subscriptions = [...remaining, record];
        return record;
      },
    },
    usageCounters: {
      async findByUserAndDate(userId, date) {
        return state.usageCounters.find((record) => record.userId === userId && record.date === date) ?? null;
      },
      async findLifetimeByUser(userId) {
        return state.usageCounters.find((record) => record.userId === userId && record.date === "1970-01-01") ?? null;
      },
      async upsert(record) {
        const index = state.usageCounters.findIndex((item) => item.userId === record.userId && item.date === record.date);
        if (index === -1) {
          state.usageCounters.push(record);
        } else {
          state.usageCounters[index] = record;
        }
        return record;
      },
      async upsertLifetime(record) {
        const lifetimeRecord = { ...record, date: "1970-01-01" };
        const index = state.usageCounters.findIndex((item) => item.userId === lifetimeRecord.userId && item.date === "1970-01-01");
        if (index === -1) {
          state.usageCounters.push(lifetimeRecord);
        } else {
          state.usageCounters[index] = lifetimeRecord;
        }
        return lifetimeRecord;
      },
    },
    visionDebug: {
      async create(record) {
        state.visionDebug.push(record);
        return record;
      },
    },
    specsCache: {
      async findByCacheKey(cacheKey) {
        return state.specsCache.find((entry) => entry.cacheKey === cacheKey) ?? null;
      },
      async upsert(entry) {
        state.specsCache = [entry, ...state.specsCache.filter((current) => current.cacheKey !== entry.cacheKey)];
        return entry;
      },
      async markAccessed(cacheKey, lastAccessedAt) {
        state.specsCache = state.specsCache.map((entry) =>
          entry.cacheKey === cacheKey
            ? { ...entry, hitCount: entry.hitCount + 1, lastAccessedAt, updatedAt: lastAccessedAt }
            : entry,
        );
      },
      async deleteOlderThan(cutoffIso) {
        const before = state.specsCache.length;
        state.specsCache = state.specsCache.filter((entry) => entry.fetchedAt >= cutoffIso);
        return before - state.specsCache.length;
      },
    },
    valuesCache: {
      async findByCacheKey(cacheKey) {
        return state.valuesCache.find((entry) => entry.cacheKey === cacheKey) ?? null;
      },
      async upsert(entry) {
        state.valuesCache = [entry, ...state.valuesCache.filter((current) => current.cacheKey !== entry.cacheKey)];
        return entry;
      },
      async markAccessed(cacheKey, lastAccessedAt) {
        state.valuesCache = state.valuesCache.map((entry) =>
          entry.cacheKey === cacheKey
            ? { ...entry, hitCount: entry.hitCount + 1, lastAccessedAt, updatedAt: lastAccessedAt }
            : entry,
        );
      },
      async deleteOlderThan(cutoffIso) {
        const before = state.valuesCache.length;
        state.valuesCache = state.valuesCache.filter((entry) => entry.fetchedAt >= cutoffIso);
        return before - state.valuesCache.length;
      },
    },
    listingsCache: {
      async findByCacheKey(cacheKey) {
        return state.listingsCache.find((entry) => entry.cacheKey === cacheKey) ?? null;
      },
      async upsert(entry) {
        state.listingsCache = [entry, ...state.listingsCache.filter((current) => current.cacheKey !== entry.cacheKey)];
        return entry;
      },
      async markAccessed(cacheKey, lastAccessedAt) {
        state.listingsCache = state.listingsCache.map((entry) =>
          entry.cacheKey === cacheKey
            ? { ...entry, hitCount: entry.hitCount + 1, lastAccessedAt, updatedAt: lastAccessedAt }
            : entry,
        );
      },
      async deleteOlderThan(cutoffIso) {
        const before = state.listingsCache.length;
        state.listingsCache = state.listingsCache.filter((entry) => entry.fetchedAt >= cutoffIso);
        return before - state.listingsCache.length;
      },
    },
    marketValueCache: {
      async findByCacheKey(cacheKey) {
        return state.marketValueCache.find((entry) => entry.cacheKey === cacheKey) ?? null;
      },
      async upsert(entry) {
        state.marketValueCache = [entry, ...state.marketValueCache.filter((current) => current.cacheKey !== entry.cacheKey)];
        return entry;
      },
      async deleteOlderThan(cutoffIso) {
        const before = state.marketValueCache.length;
        state.marketValueCache = state.marketValueCache.filter((entry) => entry.updatedAt >= cutoffIso);
        return before - state.marketValueCache.length;
      },
    },
    marketListingsCache: {
      async findByCacheKey(cacheKey) {
        return state.marketListingsCache.find((entry) => entry.cacheKey === cacheKey) ?? null;
      },
      async upsert(entry) {
        state.marketListingsCache = [entry, ...state.marketListingsCache.filter((current) => current.cacheKey !== entry.cacheKey)];
        return entry;
      },
      async deleteOlderThan(cutoffIso) {
        const before = state.marketListingsCache.length;
        state.marketListingsCache = state.marketListingsCache.filter((entry) => entry.updatedAt >= cutoffIso);
        return before - state.marketListingsCache.length;
      },
    },
    providerApiUsageLogs: {
      async create(record) {
        state.providerApiUsageLogs.push(record);
        return record;
      },
      async deleteOlderThan(cutoffIso) {
        const before = state.providerApiUsageLogs.length;
        state.providerApiUsageLogs = state.providerApiUsageLogs.filter((entry) => entry.createdAt >= cutoffIso);
        return before - state.providerApiUsageLogs.length;
      },
    },
    vehicleScanPopularity: {
      async increment(input) {
        const existing = state.vehicleScanPopularity.find((entry) => entry.normalizedKey === input.normalizedKey);
        if (existing) {
          const updated = {
            ...existing,
            scanCount: existing.scanCount + 1,
            lastSeenAt: input.lastSeenAt,
          };
          state.vehicleScanPopularity = [
            updated,
            ...state.vehicleScanPopularity.filter((entry) => entry.normalizedKey !== input.normalizedKey),
          ];
          return updated;
        }
        const created = {
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
        state.vehicleScanPopularity.unshift(created);
        return created;
      },
      async findByNormalizedKey(normalizedKey) {
        return state.vehicleScanPopularity.find((entry) => entry.normalizedKey === normalizedKey) ?? null;
      },
      async searchLikelyMatches(input) {
        return state.vehicleScanPopularity.filter(
          (entry) =>
            entry.year === input.year &&
            entry.normalizedMake === input.normalizedMake &&
            entry.normalizedModel === input.normalizedModel,
        );
      },
      async findConflicts(input) {
        return state.vehicleScanPopularity.filter(
          (entry) =>
            entry.year === input.year &&
            entry.normalizedMake === input.normalizedMake &&
            entry.normalizedModel === input.normalizedModel &&
            entry.normalizedTrim !== input.normalizedTrim &&
            entry.scanCount >= input.minScanCount,
        );
      },
      async listTop(limit) {
        return [...state.vehicleScanPopularity].sort((left, right) => right.scanCount - left.scanCount).slice(0, limit);
      },
    },
    vehicleGlobalTrending: {
      async upsert(record) {
        state.vehicleGlobalTrending = [
          record,
          ...state.vehicleGlobalTrending.filter((entry) => entry.normalizedKey !== record.normalizedKey),
        ];
        return record;
      },
      async findByNormalizedKey(normalizedKey) {
        return state.vehicleGlobalTrending.find((entry) => entry.normalizedKey === normalizedKey) ?? null;
      },
      async searchLikelyMatches(input) {
        return state.vehicleGlobalTrending.filter(
          (entry) =>
            entry.year === input.year &&
            entry.normalizedMake === input.normalizedMake &&
            entry.normalizedModel === input.normalizedModel,
        );
      },
      async listTop(limit) {
        return [...state.vehicleGlobalTrending].sort((left, right) => right.trendScore - left.trendScore).slice(0, limit);
      },
    },
  };

  return { state, repositories, today: today() };
}

export function createVisionProviderResult(overrides?: Partial<VisionProviderResult>): VisionProviderResult {
  return {
    provider: "test-vision",
    rawResponse: { source: "test" },
    normalized: {
      vehicle_type: "car",
      likely_year: 2021,
      likely_make: "Cadillac",
      likely_model: "CT4",
      likely_trim: "Premium Luxury",
      confidence: 0.91,
      visible_clues: ["Vertical LED signature", "Cadillac crest grille"],
      alternate_candidates: [
        {
          likely_year: 2020,
          likely_make: "Honda",
          likely_model: "Civic",
          likely_trim: "EX",
          confidence: 0.41,
        },
      ],
    },
    ...overrides,
  };
}

export function createTestProviders(result?: VisionProviderResult): ProviderRegistry {
  const visionResult = result ?? createVisionProviderResult();

  return {
    visionProvider: {
      async identifyFromImage() {
        return visionResult;
      },
    },
    fallbackVisionProvider: {
      async identifyFromImage() {
        return visionResult;
      },
    },
    specsProvider: {
      async getVehicleSpecs() {
        throw new Error("Not used in current tests.");
      },
      async searchVehicles() {
        throw new Error("Not used in current tests.");
      },
      async searchCandidates() {
        throw new Error("Not used in current tests.");
      },
    },
    valueProvider: {
      async getValuation(input) {
        return {
          id: `valuation-${input.vehicleId}`,
          vehicleId: input.vehicleId,
          zip: input.zip,
          mileage: input.mileage,
          condition: input.condition as any,
          tradeIn: 26800,
          tradeInLow: 25800,
          tradeInHigh: 27800,
          privateParty: 28900,
          privatePartyLow: 27900,
          privatePartyHigh: 29900,
          dealerRetail: 31200,
          dealerRetailLow: 30200,
          dealerRetailHigh: 32200,
          currency: "USD",
          generatedAt: new Date("2026-04-19T12:00:00.000Z").toISOString(),
          sourceLabel: "Test Market Data",
          confidenceLabel: "high",
          modelType: "provider_range",
          listingCount: 3,
        };
      },
    },
    listingsProvider: {
      async getListings(input) {
        return [
          {
            id: `listing-${input.vehicleId}`,
            vehicleId: input.vehicleId,
            title: "2021 Cadillac CT4 Premium Luxury",
            price: 31995,
            mileage: 11820,
            dealer: "Lakefront Auto",
            distanceMiles: 12,
            location: "Chicago, IL",
            imageUrl: "https://example.com/cadillac-ct4.jpg",
            listedAt: new Date("2026-04-18T12:00:00.000Z").toISOString(),
          },
        ];
      },
    },
    specsProviderName: "mock",
    valueProviderName: "mock",
    listingsProviderName: "mock",
  };
}
