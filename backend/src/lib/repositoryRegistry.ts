import { env } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import { logger } from "./logger.js";
import { supabaseAdmin } from "./supabase.js";
import {
  CanonicalVehiclesRepository,
  CanonicalGapQueueRepository,
  CachedAnalysisRepository,
  CanonicalVehicleImagesRepository,
  UnlockBalanceRepository,
  GarageItemsRepository,
  ImageCacheRepository,
  ListingsCacheRepository,
  ListingClicksRepository,
  VehiclePhotoClustersRepository,
  ListingResultsRepository,
  ProviderApiUsageLogsRepository,
  ScansRepository,
  VehicleGlobalTrendingRepository,
  VehicleScanPopularityRepository,
  VehicleUnlockRepository,
  SpecsCacheRepository,
  SubscriptionsRepository,
  UsageCountersRepository,
  ValuationsRepository,
  ValuesCacheRepository,
  VehiclesRepository,
  VisionDebugRepository,
} from "../repositories/interfaces.js";
import {
  SupabaseCanonicalVehiclesRepository,
  SupabaseCanonicalGapQueueRepository,
  SupabaseCachedAnalysisRepository,
  SupabaseCanonicalVehicleImagesRepository,
  SupabaseUnlockBalanceRepository,
  SupabaseGarageItemsRepository,
  SupabaseImageCacheRepository,
  SupabaseListingsCacheRepository,
  SupabaseListingClicksRepository,
  SupabaseVehiclePhotoClustersRepository,
  SupabaseListingResultsRepository,
  SupabaseProviderApiUsageLogsRepository,
  SupabaseScansRepository,
  SupabaseVehicleGlobalTrendingRepository,
  SupabaseVehicleScanPopularityRepository,
  SupabaseVehicleUnlockRepository,
  SupabaseSpecsCacheRepository,
  SupabaseSubscriptionsRepository,
  SupabaseUsageCountersRepository,
  SupabaseValuationsRepository,
  SupabaseValuesCacheRepository,
  SupabaseVehiclesRepository,
  SupabaseVisionDebugRepository,
} from "../repositories/supabaseRepositories.js";
import {
  MockCanonicalVehiclesRepository,
  MockCanonicalGapQueueRepository,
  MockCachedAnalysisRepository,
  MockCanonicalVehicleImagesRepository,
  MockUnlockBalanceRepository,
  MockGarageItemsRepository,
  MockImageCacheRepository,
  MockListingsCacheRepository,
  MockListingClicksRepository,
  MockVehiclePhotoClustersRepository,
  MockListingResultsRepository,
  MockProviderApiUsageLogsRepository,
  MockScansRepository,
  MockVehicleGlobalTrendingRepository,
  MockVehicleScanPopularityRepository,
  MockVehicleUnlockRepository,
  MockSpecsCacheRepository,
  MockSubscriptionsRepository,
  MockUsageCountersRepository,
  MockValuationsRepository,
  MockValuesCacheRepository,
  MockVehiclesRepository,
  MockVisionDebugRepository,
} from "../repositories/mockRepositories.js";

export type RepositoryRegistry = {
  scans: ScansRepository;
  vehicles: VehiclesRepository;
  canonicalVehicles: CanonicalVehiclesRepository;
  canonicalGapQueue: CanonicalGapQueueRepository;
  cachedAnalysis: CachedAnalysisRepository;
  canonicalVehicleImages: CanonicalVehicleImagesRepository;
  imageCache: ImageCacheRepository;
  unlockBalances: UnlockBalanceRepository;
  vehicleUnlocks: VehicleUnlockRepository;
  garageItems: GarageItemsRepository;
  valuations: ValuationsRepository;
  listingResults: ListingResultsRepository;
  listingClicks: ListingClicksRepository;
  vehiclePhotoClusters: VehiclePhotoClustersRepository;
  subscriptions: SubscriptionsRepository;
  usageCounters: UsageCountersRepository;
  visionDebug: VisionDebugRepository;
  specsCache: SpecsCacheRepository;
  valuesCache: ValuesCacheRepository;
  listingsCache: ListingsCacheRepository;
  providerApiUsageLogs: ProviderApiUsageLogsRepository;
  vehicleScanPopularity: VehicleScanPopularityRepository;
  vehicleGlobalTrending: VehicleGlobalTrendingRepository;
};

function notConfigured(): never {
  throw new AppError(
    500,
    "SUPABASE_NOT_CONFIGURED",
    "Supabase is required for backend persistence. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

function createMissingRepositories(): RepositoryRegistry {
  if (env.ALLOW_MOCK_FALLBACKS) {
    return {
      scans: new MockScansRepository(),
      vehicles: new MockVehiclesRepository(),
      canonicalVehicles: new MockCanonicalVehiclesRepository(),
      canonicalGapQueue: new MockCanonicalGapQueueRepository(),
      cachedAnalysis: new MockCachedAnalysisRepository(),
      canonicalVehicleImages: new MockCanonicalVehicleImagesRepository(),
      imageCache: new MockImageCacheRepository(),
      unlockBalances: new MockUnlockBalanceRepository(),
      vehicleUnlocks: new MockVehicleUnlockRepository(),
      garageItems: new MockGarageItemsRepository(),
      valuations: new MockValuationsRepository(),
      listingResults: new MockListingResultsRepository(),
      listingClicks: new MockListingClicksRepository(),
      vehiclePhotoClusters: new MockVehiclePhotoClustersRepository(),
      subscriptions: new MockSubscriptionsRepository(),
      usageCounters: new MockUsageCountersRepository(),
      visionDebug: new MockVisionDebugRepository(),
      specsCache: new MockSpecsCacheRepository(),
      valuesCache: new MockValuesCacheRepository(),
      listingsCache: new MockListingsCacheRepository(),
      providerApiUsageLogs: new MockProviderApiUsageLogsRepository(),
      vehicleScanPopularity: new MockVehicleScanPopularityRepository(),
      vehicleGlobalTrending: new MockVehicleGlobalTrendingRepository(),
    };
  }

  return {
    scans: { create: async () => notConfigured() },
    vehicles: {
      findById: async () => notConfigured(),
      search: async () => notConfigured(),
      searchCandidates: async () => notConfigured(),
    },
    canonicalVehicles: {
      findById: async () => notConfigured(),
      findByCanonicalKey: async () => notConfigured(),
      listSearchYears: async () => notConfigured(),
      listSearchMakes: async () => notConfigured(),
      listSearchModels: async () => notConfigured(),
      listSearchTrims: async () => notConfigured(),
      findPromotedMatch: async () => notConfigured(),
      searchPromoted: async () => notConfigured(),
      upsertCandidate: async () => notConfigured(),
      promote: async () => notConfigured(),
      incrementPopularity: async () => notConfigured(),
    },
    canonicalGapQueue: {
      findByGapKey: async () => notConfigured(),
      recordGap: async () => notConfigured(),
      listTop: async () => notConfigured(),
    },
    cachedAnalysis: {
      findByAnalysisKey: async () => notConfigured(),
      insert: async () => notConfigured(),
      update: async () => notConfigured(),
      markAccessed: async () => notConfigured(),
    },
    canonicalVehicleImages: {
      findApprovedPrimaryByCanonicalKey: async () => notConfigured(),
      findApprovedByCanonicalKey: async () => notConfigured(),
      upsertCandidateImage: async () => notConfigured(),
      markApprovedPrimary: async () => notConfigured(),
      incrementImageStats: async () => notConfigured(),
      rejectOrQuarantine: async () => notConfigured(),
    },
    imageCache: {
      findByImageKey: async () => notConfigured(),
      upsert: async () => notConfigured(),
      markAccessed: async () => notConfigured(),
      listRecent: async () => notConfigured(),
    },
    unlockBalances: {
      getByUser: async () => notConfigured(),
      getOrCreate: async () => notConfigured(),
      update: async () => notConfigured(),
    },
    vehicleUnlocks: {
      findByUserAndKey: async () => notConfigured(),
      listByUser: async () => notConfigured(),
      create: async () => notConfigured(),
      grantUnlock: async () => notConfigured(),
    },
    garageItems: {
      listByUser: async () => notConfigured(),
      create: async () => notConfigured(),
      deleteByUserAndId: async () => notConfigured(),
    },
    valuations: { findLatest: async () => notConfigured() },
    listingResults: { listByVehicle: async () => notConfigured() },
    listingClicks: { create: async () => notConfigured() },
    vehiclePhotoClusters: {
      findRecentCandidates: async () => notConfigured(),
      findMemberByClusterAndScan: async () => notConfigured(),
      createCluster: async () => notConfigured(),
      addMember: async () => notConfigured(),
      findUserContribution: async () => notConfigured(),
      incrementClusterStats: async () => notConfigured(),
      updateCanonicalIdentity: async () => notConfigured(),
    },
    subscriptions: {
      findActiveByUser: async () => notConfigured(),
      replaceActiveForUser: async () => notConfigured(),
    },
    usageCounters: {
      findByUserAndDate: async () => notConfigured(),
      findLifetimeByUser: async () => notConfigured(),
      upsert: async () => notConfigured(),
      upsertLifetime: async () => notConfigured(),
    },
    visionDebug: { create: async () => notConfigured() },
    specsCache: {
      findByCacheKey: async () => notConfigured(),
      upsert: async () => notConfigured(),
      markAccessed: async () => notConfigured(),
      deleteOlderThan: async () => notConfigured(),
    },
    valuesCache: {
      findByCacheKey: async () => notConfigured(),
      upsert: async () => notConfigured(),
      markAccessed: async () => notConfigured(),
      deleteOlderThan: async () => notConfigured(),
    },
    listingsCache: {
      findByCacheKey: async () => notConfigured(),
      upsert: async () => notConfigured(),
      markAccessed: async () => notConfigured(),
      deleteOlderThan: async () => notConfigured(),
    },
    providerApiUsageLogs: {
      create: async () => notConfigured(),
      summarizeSince: async () => notConfigured(),
      listSince: async () => notConfigured(),
      deleteOlderThan: async () => notConfigured(),
    },
    vehicleScanPopularity: {
      increment: async () => notConfigured(),
      findByNormalizedKey: async () => notConfigured(),
      searchLikelyMatches: async () => notConfigured(),
      findConflicts: async () => notConfigured(),
      listTop: async () => notConfigured(),
    },
    vehicleGlobalTrending: {
      upsert: async () => notConfigured(),
      findByNormalizedKey: async () => notConfigured(),
      searchLikelyMatches: async () => notConfigured(),
      listTop: async () => notConfigured(),
    },
  };
}

function createDefaultRepositories(): RepositoryRegistry {
  if (!supabaseAdmin) {
    logger.warn(
      {
        supabaseUrlConfigured: Boolean(process.env.SUPABASE_URL),
        supabaseServiceConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        allowMockFallbacks: env.ALLOW_MOCK_FALLBACKS,
      },
      env.ALLOW_MOCK_FALLBACKS
        ? "Supabase not configured. Falling back to mock repositories."
        : "Supabase not configured. Using strict repository stubs.",
    );
    return createMissingRepositories();
  }

  return {
    scans: new SupabaseScansRepository(supabaseAdmin),
    vehicles: new SupabaseVehiclesRepository(supabaseAdmin),
    canonicalVehicles: new SupabaseCanonicalVehiclesRepository(supabaseAdmin),
    canonicalGapQueue: new SupabaseCanonicalGapQueueRepository(supabaseAdmin),
    cachedAnalysis: new SupabaseCachedAnalysisRepository(supabaseAdmin),
    canonicalVehicleImages: new SupabaseCanonicalVehicleImagesRepository(supabaseAdmin),
    imageCache: new SupabaseImageCacheRepository(supabaseAdmin),
    unlockBalances: new SupabaseUnlockBalanceRepository(supabaseAdmin),
    vehicleUnlocks: new SupabaseVehicleUnlockRepository(supabaseAdmin),
    garageItems: new SupabaseGarageItemsRepository(supabaseAdmin),
    valuations: new SupabaseValuationsRepository(supabaseAdmin),
    listingResults: new SupabaseListingResultsRepository(supabaseAdmin),
    listingClicks: new SupabaseListingClicksRepository(supabaseAdmin),
    vehiclePhotoClusters: new SupabaseVehiclePhotoClustersRepository(supabaseAdmin),
    subscriptions: new SupabaseSubscriptionsRepository(supabaseAdmin),
    usageCounters: new SupabaseUsageCountersRepository(supabaseAdmin),
    visionDebug: new SupabaseVisionDebugRepository(supabaseAdmin),
    specsCache: new SupabaseSpecsCacheRepository(supabaseAdmin),
    valuesCache: new SupabaseValuesCacheRepository(supabaseAdmin),
    listingsCache: new SupabaseListingsCacheRepository(supabaseAdmin),
    providerApiUsageLogs: new SupabaseProviderApiUsageLogsRepository(supabaseAdmin),
    vehicleScanPopularity: new SupabaseVehicleScanPopularityRepository(supabaseAdmin),
    vehicleGlobalTrending: new SupabaseVehicleGlobalTrendingRepository(supabaseAdmin),
  };
}

let usingMock = false;

export let repositories: RepositoryRegistry = createDefaultRepositories();

export function isUsingMockRepositories() {
  return usingMock;
}

export function isSupabaseNetworkError(error: unknown) {
  if (!error) return false;
  const collectMessages = (value: unknown): string[] => {
    if (!value) return [];
    if (typeof value === "string") return [value];
    if (value instanceof Error) return [value.message, ...collectMessages((value as any).details)];
    if (typeof value === "object") {
      const maybeMessage = (value as { message?: string }).message;
      const maybeDetails = (value as { details?: unknown }).details;
      return [maybeMessage ?? "", ...collectMessages(maybeDetails)].filter(Boolean);
    }
    return [String(value)];
  };
  const messages = collectMessages(error).join(" | ");
  return (
    messages.includes("ENOTFOUND") ||
    messages.includes("fetch failed") ||
    messages.includes("ECONNREFUSED") ||
    messages.includes("EAI_AGAIN")
  );
}

export function enableMockRepositories(reason?: string, error?: unknown) {
  if (!env.ALLOW_MOCK_FALLBACKS || usingMock) return;
  usingMock = true;
  logger.warn({ reason, error }, "Supabase unavailable; falling back to mock repositories.");
  repositories = createMissingRepositories();
}

export function setRepositories(nextRepositories: RepositoryRegistry) {
  repositories = nextRepositories;
}

export function resetRepositories() {
  repositories = createDefaultRepositories();
  usingMock = false;
}
