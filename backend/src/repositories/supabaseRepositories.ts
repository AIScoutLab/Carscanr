import { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../errors/appError.js";
import { logger } from "../lib/logger.js";
import {
  ProviderApiUsageLogRecord,
  VehicleListingsCacheRow,
  VehicleSpecsCacheRow,
  VehicleValuesCacheRow,
} from "../lib/providerCache.js";
import {
  CanonicalVehicleRecord,
  CachedAnalysisRecord,
  GarageItemRecord,
  UnlockBalanceRecord,
  UserVehicleUnlockRecord,
  ImageCacheRecord,
  ListingRecord,
  ScanRecord,
  SubscriptionRecord,
  UsageCounterRecord,
  ValuationRecord,
  VehicleRecord,
  VisionDebugRecord,
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
  VehicleUnlockRepository,
  SpecsCacheRepository,
  SubscriptionsRepository,
  UsageCountersRepository,
  ValuationsRepository,
  ValuesCacheRepository,
  VehiclesRepository,
  VisionDebugRepository,
} from "./interfaces.js";

type DbClient = SupabaseClient<any, "public", any>;
const USAGE_COUNTERS_TABLE = "usage_counters";
const LIFETIME_USAGE_DATE = "1970-01-01";

function requireData<T>(value: T | null, message: string): T {
  if (value == null) {
    throw new AppError(500, "SUPABASE_EMPTY_RESPONSE", message);
  }
  return value;
}

function mapVehicleRow(row: any): VehicleRecord {
  return {
    id: row.id,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim,
    bodyStyle: row.body_style,
    vehicleType: row.vehicle_type,
    msrp: row.msrp,
    engine: row.engine,
    horsepower: row.horsepower,
    torque: row.torque,
    transmission: row.transmission,
    drivetrain: row.drivetrain,
    mpgOrRange: row.mpg_or_range,
    colors: Array.isArray(row.colors) ? row.colors : [],
  };
}

function mapCanonicalVehicleRow(row: any): CanonicalVehicleRecord {
  return {
    id: row.id,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim ?? null,
    bodyType: row.body_type ?? null,
    vehicleType: row.vehicle_type ?? null,
    engine: row.engine ?? null,
    drivetrain: row.drivetrain ?? null,
    transmission: row.transmission ?? null,
    fuelType: row.fuel_type ?? null,
    horsepower: row.horsepower ?? null,
    torque: row.torque ?? null,
    msrp: row.msrp ?? null,
    normalizedMake: row.normalized_make,
    normalizedModel: row.normalized_model,
    normalizedTrim: row.normalized_trim ?? null,
    normalizedVehicleType: row.normalized_vehicle_type ?? null,
    canonicalKey: row.canonical_key,
    specsJson: row.specs_json ?? null,
    overviewJson: row.overview_json ?? null,
    defaultImageUrl: row.default_image_url ?? null,
    sourceProvider: row.source_provider ?? null,
    sourceVehicleId: row.source_vehicle_id ?? null,
    popularityScore: row.popularity_score,
    promotionStatus: row.promotion_status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastPromotedAt: row.last_promoted_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canonicalVehicleToRow(record: CanonicalVehicleRecord) {
  return {
    id: record.id,
    year: record.year,
    make: record.make,
    model: record.model,
    trim: record.trim ?? null,
    body_type: record.bodyType ?? null,
    vehicle_type: record.vehicleType ?? null,
    engine: record.engine ?? null,
    drivetrain: record.drivetrain ?? null,
    transmission: record.transmission ?? null,
    fuel_type: record.fuelType ?? null,
    horsepower: record.horsepower ?? null,
    torque: record.torque ?? null,
    msrp: record.msrp ?? null,
    normalized_make: record.normalizedMake,
    normalized_model: record.normalizedModel,
    normalized_trim: record.normalizedTrim ?? null,
    normalized_vehicle_type: record.normalizedVehicleType ?? null,
    canonical_key: record.canonicalKey,
    specs_json: record.specsJson ?? null,
    overview_json: record.overviewJson ?? null,
    default_image_url: record.defaultImageUrl ?? null,
    source_provider: record.sourceProvider ?? null,
    source_vehicle_id: record.sourceVehicleId ?? null,
    popularity_score: record.popularityScore,
    promotion_status: record.promotionStatus,
    first_seen_at: record.firstSeenAt,
    last_seen_at: record.lastSeenAt,
    last_promoted_at: record.lastPromotedAt ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function vehicleToRow(vehicle: VehicleRecord) {
  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    body_style: vehicle.bodyStyle,
    vehicle_type: vehicle.vehicleType,
    msrp: vehicle.msrp,
    engine: vehicle.engine,
    horsepower: vehicle.horsepower,
    torque: vehicle.torque,
    transmission: vehicle.transmission,
    drivetrain: vehicle.drivetrain,
    mpg_or_range: vehicle.mpgOrRange,
    colors: vehicle.colors,
  };
}

function mapGarageItemRow(row: any): GarageItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    vehicleId: row.vehicle_id,
    imageUrl: row.image_url,
    notes: row.notes,
    favorite: row.favorite,
    createdAt: row.created_at,
  };
}

function garageItemToRow(item: GarageItemRecord) {
  return {
    id: item.id,
    user_id: item.userId,
    vehicle_id: item.vehicleId,
    image_url: item.imageUrl,
    notes: item.notes,
    favorite: item.favorite,
    created_at: item.createdAt,
  };
}

function mapScanRow(row: any): ScanRecord {
  return {
    id: row.id,
    userId: row.user_id,
    imageUrl: row.image_url,
    detectedVehicleType: row.detected_vehicle_type,
    confidence: row.confidence,
    createdAt: row.created_at,
    normalizedResult: row.normalized_result,
    candidates: row.candidates,
  };
}

function mapCachedAnalysisRow(row: any): CachedAnalysisRecord {
  return {
    id: row.id,
    analysisKey: row.analysis_key,
    analysisType: row.analysis_type,
    identityType: row.identity_type ?? null,
    identityValue: row.identity_value ?? null,
    vin: row.vin ?? null,
    vinKey: row.vin_key ?? null,
    vehicleKey: row.vehicle_key ?? null,
    listingKey: row.listing_key ?? null,
    imageKey: row.image_key ?? null,
    visualHash: row.visual_hash ?? null,
    promptVersion: row.prompt_version,
    modelName: row.model_name,
    status: row.status,
    resultJson: row.result_json ?? null,
    errorText: row.error_text ?? null,
    costEstimate: row.cost_estimate ?? null,
    expiresAt: row.expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at ?? null,
    hitCount: row.hit_count ?? 0,
  };
}

function cachedAnalysisToRow(record: CachedAnalysisRecord) {
  return {
    id: record.id,
    analysis_key: record.analysisKey,
    analysis_type: record.analysisType,
    identity_type: record.identityType ?? null,
    identity_value: record.identityValue ?? null,
    vin: record.vin ?? null,
    vin_key: record.vinKey ?? null,
    vehicle_key: record.vehicleKey ?? null,
    listing_key: record.listingKey ?? null,
    image_key: record.imageKey ?? null,
    visual_hash: record.visualHash ?? null,
    prompt_version: record.promptVersion,
    model_name: record.modelName,
    status: record.status,
    result_json: record.resultJson ?? null,
    error_text: record.errorText ?? null,
    cost_estimate: record.costEstimate ?? null,
    expires_at: record.expiresAt ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    last_accessed_at: record.lastAccessedAt ?? null,
    hit_count: record.hitCount ?? 0,
  };
}

function cachedAnalysisUpdateToRow(
  updates: Partial<Omit<CachedAnalysisRecord, "id" | "analysisKey" | "createdAt">>,
) {
  return {
    analysis_type: updates.analysisType ?? undefined,
    identity_type: updates.identityType ?? undefined,
    identity_value: updates.identityValue ?? undefined,
    vin: updates.vin ?? undefined,
    vin_key: updates.vinKey ?? undefined,
    vehicle_key: updates.vehicleKey ?? undefined,
    listing_key: updates.listingKey ?? undefined,
    image_key: updates.imageKey ?? undefined,
    visual_hash: updates.visualHash ?? undefined,
    prompt_version: updates.promptVersion ?? undefined,
    model_name: updates.modelName ?? undefined,
    status: updates.status ?? undefined,
    result_json: updates.resultJson ?? undefined,
    error_text: updates.errorText ?? undefined,
    cost_estimate: updates.costEstimate ?? undefined,
    expires_at: updates.expiresAt ?? undefined,
    updated_at: updates.updatedAt ?? undefined,
    last_accessed_at: updates.lastAccessedAt ?? undefined,
    hit_count: updates.hitCount ?? undefined,
  };
}

function mapImageCacheRow(row: any): ImageCacheRecord {
  return {
    id: row.id,
    imageKey: row.image_key,
    visualHash: row.visual_hash ?? null,
    fileWidth: row.file_width ?? null,
    fileHeight: row.file_height ?? null,
    normalizedVehicleJson: row.normalized_vehicle_json ?? null,
    ocrJson: row.ocr_json ?? null,
    extractionJson: row.extraction_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at ?? null,
    hitCount: row.hit_count ?? 0,
  };
}

function imageCacheToRow(record: ImageCacheRecord) {
  return {
    id: record.id,
    image_key: record.imageKey,
    visual_hash: record.visualHash ?? null,
    file_width: record.fileWidth ?? null,
    file_height: record.fileHeight ?? null,
    normalized_vehicle_json: record.normalizedVehicleJson ?? null,
    ocr_json: record.ocrJson ?? null,
    extraction_json: record.extractionJson ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    last_accessed_at: record.lastAccessedAt ?? null,
    hit_count: record.hitCount ?? 0,
  };
}

function scanToRow(scan: ScanRecord) {
  return {
    id: scan.id,
    user_id: scan.userId,
    image_url: scan.imageUrl,
    detected_vehicle_type: scan.detectedVehicleType,
    confidence: scan.confidence,
    created_at: scan.createdAt,
    normalized_result: scan.normalizedResult,
    candidates: scan.candidates,
  };
}

function mapValuationRow(row: any): ValuationRecord {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    zip: row.zip,
    mileage: row.mileage,
    condition: row.condition,
    tradeIn: row.trade_in,
    privateParty: row.private_party,
    dealerRetail: row.dealer_retail,
    currency: row.currency,
    generatedAt: row.generated_at,
  };
}

function mapListingRow(row: any): ListingRecord {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    title: row.title,
    price: row.price,
    mileage: row.mileage,
    dealer: row.dealer,
    distanceMiles: row.distance_miles,
    location: row.location,
    imageUrl: row.image_url,
    listedAt: row.listed_at,
  };
}

function mapSubscriptionRow(row: any): SubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    plan: row.plan,
    status: row.status,
    productId: row.product_id ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    verifiedAt: row.verified_at,
  };
}

function mapUnlockBalanceRow(row: any): UnlockBalanceRecord {
  return {
    userId: row.user_id,
    freeUnlocksTotal: row.free_unlocks_total,
    freeUnlocksUsed: row.free_unlocks_used,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function unlockBalanceToRow(record: UnlockBalanceRecord) {
  return {
    user_id: record.userId,
    free_unlocks_total: record.freeUnlocksTotal,
    free_unlocks_used: record.freeUnlocksUsed,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function mapVehicleUnlockRow(row: any): UserVehicleUnlockRecord {
  return {
    id: row.id,
    userId: row.user_id,
    unlockKey: row.unlock_key,
    unlockType: row.unlock_type,
    vin: row.vin ?? null,
    vinKey: row.vin_key ?? null,
    vehicleKey: row.vehicle_key ?? null,
    listingKey: row.listing_key ?? null,
    sourceVehicleId: row.source_vehicle_id ?? null,
    scanId: row.scan_id ?? null,
    createdAt: row.created_at,
  };
}

function vehicleUnlockToRow(record: UserVehicleUnlockRecord) {
  return {
    id: record.id,
    user_id: record.userId,
    unlock_key: record.unlockKey,
    unlock_type: record.unlockType,
    vin: record.vin ?? null,
    vin_key: record.vinKey ?? null,
    vehicle_key: record.vehicleKey ?? null,
    listing_key: record.listingKey ?? null,
    source_vehicle_id: record.sourceVehicleId ?? null,
    scan_id: record.scanId ?? null,
    created_at: record.createdAt,
  };
}

function subscriptionToRow(record: SubscriptionRecord) {
  return {
    id: record.id,
    user_id: record.userId,
    plan: record.plan,
    status: record.status,
    product_id: record.productId ?? null,
    expires_at: record.expiresAt ?? null,
    verified_at: record.verifiedAt,
  };
}

function mapUsageRow(row: any): UsageCounterRecord {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    scanCount: row.scan_count,
    totalScans: row.total_scans ?? row.scan_count ?? 0,
    lastScanAt: row.last_scan_at ?? undefined,
    recentAttemptTimestamps: Array.isArray(row.recent_attempt_timestamps) ? row.recent_attempt_timestamps : [],
  };
}

function usageToRow(record: UsageCounterRecord) {
  return {
    id: record.id,
    user_id: record.userId,
    date: record.date,
    scan_count: record.scanCount,
    total_scans: record.totalScans,
    last_scan_at: record.lastScanAt ?? null,
    recent_attempt_timestamps: record.recentAttemptTimestamps,
  };
}

type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function serializeSupabaseError(error: SupabaseErrorLike | null | undefined) {
  if (!error) return undefined;
  return {
    message: error.message ?? null,
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  };
}

function isMissingColumnError(error: SupabaseErrorLike | null | undefined, columnName: string) {
  if (!error?.message) return false;
  return error.message.toLowerCase().includes(`column "${columnName.toLowerCase()}"`);
}

function usageToLegacyRow(record: UsageCounterRecord) {
  return {
    id: record.id,
    user_id: record.userId,
    date: record.date,
    // Legacy schemas only had scan_count, so keep lifetime records usable there.
    scan_count: record.date === LIFETIME_USAGE_DATE ? record.totalScans : record.scanCount,
    last_scan_at: record.lastScanAt ?? null,
    recent_attempt_timestamps: record.recentAttemptTimestamps,
  };
}

function buildUsageCounterErrorDetails(input: {
  operation: string;
  filters?: Record<string, unknown>;
  error: SupabaseErrorLike | null | undefined;
  compatibilityMode?: "modern" | "legacy";
}) {
  return {
    table: USAGE_COUNTERS_TABLE,
    operation: input.operation,
    compatibilityMode: input.compatibilityMode ?? "modern",
    filters: input.filters ?? {},
    supabase: serializeSupabaseError(input.error),
  };
}

function logUsageCounterError(input: {
  operation: string;
  filters?: Record<string, unknown>;
  error: SupabaseErrorLike | null | undefined;
  compatibilityMode?: "modern" | "legacy";
}) {
  logger.error(
    buildUsageCounterErrorDetails(input),
    "Usage counter Supabase operation failed",
  );
}

function visionDebugToRow(record: VisionDebugRecord) {
  return {
    id: record.id,
    scan_id: record.scanId,
    user_id: record.userId,
    provider: record.provider,
    raw_response: record.rawResponse,
    normalized_result: record.normalizedResult ?? null,
    error: record.error ?? null,
    created_at: record.createdAt,
  };
}

function mapSpecsCacheRow(row: any): VehicleSpecsCacheRow {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    provider: row.provider,
    year: row.year,
    vehicleType: row.vehicle_type,
    normalizedMake: row.normalized_make,
    normalizedModel: row.normalized_model,
    normalizedTrim: row.normalized_trim,
    responseJson: row.response_json,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    hitCount: row.hit_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function specsCacheToRow(entry: VehicleSpecsCacheRow) {
  return {
    id: entry.id,
    cache_key: entry.cacheKey,
    provider: entry.provider,
    year: entry.year,
    vehicle_type: entry.vehicleType,
    normalized_make: entry.normalizedMake,
    normalized_model: entry.normalizedModel,
    normalized_trim: entry.normalizedTrim,
    response_json: entry.responseJson,
    fetched_at: entry.fetchedAt,
    expires_at: entry.expiresAt,
    hit_count: entry.hitCount,
    last_accessed_at: entry.lastAccessedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function mapValuesCacheRow(row: any): VehicleValuesCacheRow {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    provider: row.provider,
    year: row.year,
    normalizedMake: row.normalized_make,
    normalizedModel: row.normalized_model,
    normalizedTrim: row.normalized_trim,
    zipPrefix: row.zip_prefix,
    mileageBucket: row.mileage_bucket,
    condition: row.condition,
    responseJson: row.response_json,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    hitCount: row.hit_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function valuesCacheToRow(entry: VehicleValuesCacheRow) {
  return {
    id: entry.id,
    cache_key: entry.cacheKey,
    provider: entry.provider,
    year: entry.year,
    normalized_make: entry.normalizedMake,
    normalized_model: entry.normalizedModel,
    normalized_trim: entry.normalizedTrim,
    zip_prefix: entry.zipPrefix,
    mileage_bucket: entry.mileageBucket,
    condition: entry.condition,
    response_json: entry.responseJson,
    fetched_at: entry.fetchedAt,
    expires_at: entry.expiresAt,
    hit_count: entry.hitCount,
    last_accessed_at: entry.lastAccessedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function mapListingsCacheRow(row: any): VehicleListingsCacheRow {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    provider: row.provider,
    year: row.year,
    normalizedMake: row.normalized_make,
    normalizedModel: row.normalized_model,
    normalizedTrim: row.normalized_trim,
    zipCode: row.zip_code,
    radiusMiles: row.radius_miles,
    responseJson: row.response_json,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    hitCount: row.hit_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listingsCacheToRow(entry: VehicleListingsCacheRow) {
  return {
    id: entry.id,
    cache_key: entry.cacheKey,
    provider: entry.provider,
    year: entry.year,
    normalized_make: entry.normalizedMake,
    normalized_model: entry.normalizedModel,
    normalized_trim: entry.normalizedTrim,
    zip_code: entry.zipCode,
    radius_miles: entry.radiusMiles,
    response_json: entry.responseJson,
    fetched_at: entry.fetchedAt,
    expires_at: entry.expiresAt,
    hit_count: entry.hitCount,
    last_accessed_at: entry.lastAccessedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

function providerApiUsageLogToRow(entry: ProviderApiUsageLogRecord) {
  return {
    id: entry.id,
    provider: entry.provider,
    endpoint_type: entry.endpointType,
    event_type: entry.eventType,
    cache_key: entry.cacheKey,
    request_summary: entry.requestSummary,
    response_summary: entry.responseSummary,
    created_at: entry.createdAt,
  };
}

export class SupabaseScansRepository implements ScansRepository {
  constructor(private readonly client: DbClient) {}

  async create(scan: ScanRecord): Promise<ScanRecord> {
    const { data, error } = await this.client.from("scans").insert(scanToRow(scan)).select().single();
    if (error) throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to persist scan.", error);
    return mapScanRow(requireData(data, "Scan insert returned no row."));
  }
}

export class SupabaseVehiclesRepository implements VehiclesRepository {
  constructor(private readonly client: DbClient) {}

  async findById(vehicleId: string): Promise<VehicleRecord | null> {
    const { data, error } = await this.client.from("vehicles").select("*").eq("id", vehicleId).maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load vehicle.", error);
    return data ? mapVehicleRow(data) : null;
  }

  async search(input: { year?: string; make?: string; model?: string }): Promise<VehicleRecord[]> {
    let query = this.client.from("vehicles").select("*").order("year", { ascending: false });
    if (input.year) {
      const parsedYear = Number(input.year);
      query = Number.isNaN(parsedYear) ? query : query.eq("year", parsedYear);
    }
    if (input.make) query = query.ilike("make", `%${input.make}%`);
    if (input.model) query = query.ilike("model", `%${input.model}%`);
    const { data, error } = await query.limit(100);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to search vehicles.", error);
    return (data ?? []).map(mapVehicleRow);
  }

  async searchCandidates(input: { year: number; make: string; model: string; trim?: string }): Promise<VehicleRecord[]> {
    let query = this.client
      .from("vehicles")
      .select("*")
      .eq("year", input.year)
      .ilike("make", `%${input.make}%`)
      .ilike("model", `%${input.model}%`);
    if (input.trim) query = query.ilike("trim", `%${input.trim}%`);
    const { data, error } = await query.limit(25);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to search candidate vehicles.", error);
    return (data ?? []).map(mapVehicleRow);
  }
}

export class SupabaseCanonicalVehiclesRepository implements CanonicalVehiclesRepository {
  constructor(private readonly client: DbClient) {}

  async findById(id: string): Promise<CanonicalVehicleRecord | null> {
    const { data, error } = await this.client.from("canonical_vehicles").select("*").eq("id", id).maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical vehicle by id.", error);
    return data ? mapCanonicalVehicleRow(data) : null;
  }

  async findByCanonicalKey(canonicalKey: string): Promise<CanonicalVehicleRecord | null> {
    const { data, error } = await this.client.from("canonical_vehicles").select("*").eq("canonical_key", canonicalKey).maybeSingle();
    if (error) {
      logger.error(
        {
          label: "CANONICAL_LOOKUP_FAILURE",
          table: "canonical_vehicles",
          operation: "select",
          canonicalKey,
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
        "CANONICAL_LOOKUP_FAILURE",
      );
      throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical vehicle.", error);
    }
    return data ? mapCanonicalVehicleRow(data) : null;
  }

  async findPromotedMatch(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim?: string | null;
  }): Promise<CanonicalVehicleRecord | null> {
    let query = this.client
      .from("canonical_vehicles")
      .select("*")
      .eq("promotion_status", "promoted")
      .not("specs_json", "is", null)
      .eq("year", input.year)
      .eq("normalized_make", input.normalizedMake)
      .eq("normalized_model", input.normalizedModel);

    if (input.normalizedTrim) {
      query = query.eq("normalized_trim", input.normalizedTrim);
    } else {
      query = query.is("normalized_trim", null);
    }

    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load promoted canonical vehicle.", error);
    return data ? mapCanonicalVehicleRow(data) : null;
  }

  async searchPromoted(input: {
    year?: number;
    normalizedMake?: string;
    normalizedModel?: string;
    normalizedTrim?: string | null;
  }): Promise<CanonicalVehicleRecord[]> {
    let query = this.client
      .from("canonical_vehicles")
      .select("*")
      .eq("promotion_status", "promoted")
      .not("specs_json", "is", null)
      .order("popularity_score", { ascending: false })
      .order("year", { ascending: false });

    if (input.year) {
      query = query.gte("year", input.year - 3).lte("year", input.year + 3);
    }
    if (input.normalizedMake) {
      query = query.eq("normalized_make", input.normalizedMake);
    }
    if (input.normalizedModel) {
      query = query.ilike("normalized_model", `%${input.normalizedModel}%`);
    }
    if (input.normalizedTrim) {
      query = query.ilike("normalized_trim", `%${input.normalizedTrim}%`);
    }

    const { data, error } = await query.limit(100);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to search promoted canonical vehicles.", error);
    return (data ?? []).map(mapCanonicalVehicleRow);
  }

  async upsertCandidate(record: CanonicalVehicleRecord): Promise<CanonicalVehicleRecord> {
    const existing = await this.findByCanonicalKey(record.canonicalKey);
    if (existing?.promotionStatus === "promoted" && existing.specsJson) {
      return existing;
    }

    const merged: CanonicalVehicleRecord = existing
      ? {
          ...existing,
          year: record.year,
          make: record.make,
          model: record.model,
          trim: record.trim ?? existing.trim ?? null,
          vehicleType: record.vehicleType ?? existing.vehicleType ?? null,
          normalizedMake: record.normalizedMake,
          normalizedModel: record.normalizedModel,
          normalizedTrim: record.normalizedTrim ?? existing.normalizedTrim ?? null,
          normalizedVehicleType: record.normalizedVehicleType ?? existing.normalizedVehicleType ?? null,
          specsJson: record.specsJson ?? existing.specsJson ?? null,
          overviewJson: record.overviewJson ?? existing.overviewJson ?? null,
          defaultImageUrl: record.defaultImageUrl ?? existing.defaultImageUrl ?? null,
          sourceProvider: record.sourceProvider ?? existing.sourceProvider ?? null,
          sourceVehicleId: record.sourceVehicleId ?? existing.sourceVehicleId ?? null,
          popularityScore: Math.max(existing.popularityScore, record.popularityScore),
          promotionStatus: existing.promotionStatus,
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          lastPromotedAt: existing.lastPromotedAt ?? null,
          createdAt: existing.createdAt,
          updatedAt: record.updatedAt,
        }
      : record;

    const { data, error } = await this.client
      .from("canonical_vehicles")
      .upsert(canonicalVehicleToRow(merged), { onConflict: "canonical_key" })
      .select("*")
      .single();
    if (error) {
      logger.error(
        {
          label: "CANONICAL_REPOSITORY_UPSERT_FAILURE",
          table: "canonical_vehicles",
          operation: "upsert",
          canonicalKey: record.canonicalKey,
          canonicalId: record.id,
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
        "CANONICAL_REPOSITORY_UPSERT_FAILURE",
      );
      throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to persist canonical vehicle candidate.", error);
    }
    return mapCanonicalVehicleRow(requireData(data, "Canonical vehicle upsert returned no row."));
  }

  async promote(canonicalKey: string): Promise<void> {
    const { error } = await this.client.rpc("promote_canonical_vehicle", {
      target_canonical_key: canonicalKey,
    });
    if (error) throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to promote canonical vehicle.", error);
  }

  async incrementPopularity(canonicalKey: string): Promise<void> {
    const { error } = await this.client.rpc("increment_canonical_vehicle_popularity", {
      target_canonical_key: canonicalKey,
    });
    if (error) throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to increment canonical vehicle popularity.", error);
  }
}

export class SupabaseGarageItemsRepository implements GarageItemsRepository {
  constructor(private readonly client: DbClient) {}

  async listByUser(userId: string): Promise<GarageItemRecord[]> {
    const { data, error } = await this.client
      .from("garage_items")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load garage items.", error);
    return (data ?? []).map(mapGarageItemRow);
  }

  async create(item: GarageItemRecord): Promise<GarageItemRecord> {
    const { data, error } = await this.client.from("garage_items").insert(garageItemToRow(item)).select().single();
    if (error) throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to save garage item.", error);
    return mapGarageItemRow(requireData(data, "Garage insert returned no row."));
  }

  async deleteByUserAndId(userId: string, id: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("garage_items")
      .delete()
      .eq("user_id", userId)
      .eq("id", id)
      .select("id");
    if (error) throw new AppError(500, "SUPABASE_DELETE_FAILED", "Failed to delete garage item.", error);
    return (data?.length ?? 0) > 0;
  }
}

export class SupabaseValuationsRepository implements ValuationsRepository {
  constructor(private readonly client: DbClient) {}

  async findLatest(input: {
    vehicleId: string;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<ValuationRecord | null> {
    const { data, error } = await this.client
      .from("valuations")
      .select("*")
      .eq("vehicle_id", input.vehicleId)
      .eq("zip", input.zip)
      .eq("condition", input.condition)
      .lte("mileage", input.mileage)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load valuation.", error);
    return data ? mapValuationRow(data) : null;
  }
}

export class SupabaseListingResultsRepository implements ListingResultsRepository {
  constructor(private readonly client: DbClient) {}

  async listByVehicle(input: { vehicleId: string; zip: string; radiusMiles: number }): Promise<ListingRecord[]> {
    const { data, error } = await this.client
      .from("listing_results")
      .select("*")
      .eq("vehicle_id", input.vehicleId)
      .lte("distance_miles", input.radiusMiles)
      .order("distance_miles", { ascending: true });
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load listing results.", error);
    return (data ?? []).map(mapListingRow);
  }
}

export class SupabaseSubscriptionsRepository implements SubscriptionsRepository {
  constructor(private readonly client: DbClient) {}

  async findActiveByUser(userId: string): Promise<SubscriptionRecord | null> {
    const { data, error } = await this.client
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("verified_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load subscription.", error);
    return data ? mapSubscriptionRow(data) : null;
  }

  async replaceActiveForUser(record: SubscriptionRecord): Promise<SubscriptionRecord> {
    const deactivate = await this.client
      .from("subscriptions")
      .update({ status: "inactive" })
      .eq("user_id", record.userId)
      .eq("status", "active");
    if (deactivate.error) {
      throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to deactivate existing subscriptions.", deactivate.error);
    }

    const { data, error } = await this.client
      .from("subscriptions")
      .insert(subscriptionToRow(record))
      .select("*")
      .single();
    if (error) throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to persist subscription.", error);
    return mapSubscriptionRow(requireData(data, "Subscription insert returned no row."));
  }
}

export class SupabaseSpecsCacheRepository implements SpecsCacheRepository {
  constructor(private readonly client: DbClient) {}

  async findByCacheKey(cacheKey: string): Promise<VehicleSpecsCacheRow | null> {
    const { data, error } = await this.client
      .from("provider_vehicle_specs_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load specs cache entry.", error);
    return data ? mapSpecsCacheRow(data) : null;
  }

  async upsert(entry: VehicleSpecsCacheRow): Promise<VehicleSpecsCacheRow> {
    const { data, error } = await this.client
      .from("provider_vehicle_specs_cache")
      .upsert(specsCacheToRow(entry), { onConflict: "cache_key" })
      .select()
      .single();
    if (error) throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to persist specs cache entry.", error);
    return mapSpecsCacheRow(requireData(data, "Specs cache upsert returned no row."));
  }

  async markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void> {
    const { error } = await this.client.rpc("increment_provider_vehicle_specs_cache_hit", {
      target_cache_key: cacheKey,
      target_last_accessed_at: lastAccessedAt,
    });
    if (error) throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update specs cache access stats.", error);
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const { data, error } = await this.client
      .from("provider_vehicle_specs_cache")
      .delete()
      .lt("fetched_at", cutoffIso)
      .select("id");
    if (error) throw new AppError(500, "SUPABASE_DELETE_FAILED", "Failed to clean specs cache.", error);
    return data?.length ?? 0;
  }
}

export class SupabaseValuesCacheRepository implements ValuesCacheRepository {
  constructor(private readonly client: DbClient) {}

  async findByCacheKey(cacheKey: string): Promise<VehicleValuesCacheRow | null> {
    const { data, error } = await this.client
      .from("provider_vehicle_values_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load values cache entry.", error);
    return data ? mapValuesCacheRow(data) : null;
  }

  async upsert(entry: VehicleValuesCacheRow): Promise<VehicleValuesCacheRow> {
    const { data, error } = await this.client
      .from("provider_vehicle_values_cache")
      .upsert(valuesCacheToRow(entry), { onConflict: "cache_key" })
      .select()
      .single();
    if (error) throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to persist values cache entry.", error);
    return mapValuesCacheRow(requireData(data, "Values cache upsert returned no row."));
  }

  async markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void> {
    const { error } = await this.client.rpc("increment_provider_vehicle_values_cache_hit", {
      target_cache_key: cacheKey,
      target_last_accessed_at: lastAccessedAt,
    });
    if (error) throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update values cache access stats.", error);
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const { data, error } = await this.client
      .from("provider_vehicle_values_cache")
      .delete()
      .lt("fetched_at", cutoffIso)
      .select("id");
    if (error) throw new AppError(500, "SUPABASE_DELETE_FAILED", "Failed to clean values cache.", error);
    return data?.length ?? 0;
  }
}

export class SupabaseListingsCacheRepository implements ListingsCacheRepository {
  constructor(private readonly client: DbClient) {}

  async findByCacheKey(cacheKey: string): Promise<VehicleListingsCacheRow | null> {
    const { data, error } = await this.client
      .from("provider_vehicle_listings_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load listings cache entry.", error);
    return data ? mapListingsCacheRow(data) : null;
  }

  async upsert(entry: VehicleListingsCacheRow): Promise<VehicleListingsCacheRow> {
    const { data, error } = await this.client
      .from("provider_vehicle_listings_cache")
      .upsert(listingsCacheToRow(entry), { onConflict: "cache_key" })
      .select()
      .single();
    if (error) throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to persist listings cache entry.", error);
    return mapListingsCacheRow(requireData(data, "Listings cache upsert returned no row."));
  }

  async markAccessed(cacheKey: string, lastAccessedAt: string): Promise<void> {
    const { error } = await this.client.rpc("increment_provider_vehicle_listings_cache_hit", {
      target_cache_key: cacheKey,
      target_last_accessed_at: lastAccessedAt,
    });
    if (error) throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update listings cache access stats.", error);
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const { data, error } = await this.client
      .from("provider_vehicle_listings_cache")
      .delete()
      .lt("fetched_at", cutoffIso)
      .select("id");
    if (error) throw new AppError(500, "SUPABASE_DELETE_FAILED", "Failed to clean listings cache.", error);
    return data?.length ?? 0;
  }
}

export class SupabaseProviderApiUsageLogsRepository implements ProviderApiUsageLogsRepository {
  constructor(private readonly client: DbClient) {}

  async create(record: ProviderApiUsageLogRecord): Promise<ProviderApiUsageLogRecord> {
    const { error } = await this.client.from("provider_api_usage_logs").insert(providerApiUsageLogToRow(record));
    if (error) throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to persist provider API usage log.", error);
    return record;
  }

  async deleteOlderThan(cutoffIso: string): Promise<number> {
    const { data, error } = await this.client
      .from("provider_api_usage_logs")
      .delete()
      .lt("created_at", cutoffIso)
      .select("id");
    if (error) throw new AppError(500, "SUPABASE_DELETE_FAILED", "Failed to clean provider API usage logs.", error);
    return data?.length ?? 0;
  }
}

export class SupabaseUnlockBalanceRepository implements UnlockBalanceRepository {
  constructor(private readonly client: DbClient) {}

  async getByUser(userId: string): Promise<UnlockBalanceRecord | null> {
    const { data, error } = await this.client
      .from("user_unlock_balances")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load unlock balance.", error);
    return data ? mapUnlockBalanceRow(data) : null;
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
    const { data, error } = await this.client
      .from("user_unlock_balances")
      .upsert(unlockBalanceToRow(record), { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to upsert unlock balance.", error);
    return mapUnlockBalanceRow(requireData(data, "Unlock balance upsert returned no row."));
  }

  async update(record: UnlockBalanceRecord): Promise<UnlockBalanceRecord> {
    const { data, error } = await this.client
      .from("user_unlock_balances")
      .upsert(unlockBalanceToRow(record), { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to update unlock balance.", error);
    return mapUnlockBalanceRow(requireData(data, "Unlock balance update returned no row."));
  }
}

export class SupabaseVehicleUnlockRepository implements VehicleUnlockRepository {
  constructor(private readonly client: DbClient) {}

  async findByUserAndKey(userId: string, unlockKey: string): Promise<UserVehicleUnlockRecord | null> {
    const { data, error } = await this.client
      .from("user_vehicle_unlocks")
      .select("*")
      .eq("user_id", userId)
      .eq("unlock_key", unlockKey)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load vehicle unlock.", error);
    return data ? mapVehicleUnlockRow(data) : null;
  }

  async listByUser(userId: string): Promise<UserVehicleUnlockRecord[]> {
    const { data, error } = await this.client
      .from("user_vehicle_unlocks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to list vehicle unlocks.", error);
    return (data ?? []).map(mapVehicleUnlockRow);
  }

  async create(record: UserVehicleUnlockRecord): Promise<UserVehicleUnlockRecord> {
    const { data, error } = await this.client
      .from("user_vehicle_unlocks")
      .insert(vehicleUnlockToRow(record))
      .select("*")
      .single();
    if (error) throw error;
    return mapVehicleUnlockRow(requireData(data, "Vehicle unlock insert returned no row."));
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
  }) {
    const { data, error } = await this.client.rpc("grant_user_vehicle_unlock", {
      p_user_id: input.userId,
      p_unlock_key: input.unlockKey,
      p_unlock_type: input.unlockType,
      p_vin: input.vin ?? null,
      p_vin_key: input.vinKey ?? null,
      p_vehicle_key: input.vehicleKey ?? null,
      p_listing_key: input.listingKey ?? null,
      p_source_vehicle_id: input.sourceVehicleId ?? null,
      p_scan_id: input.scanId ?? null,
    });
    if (error) throw new AppError(500, "SUPABASE_RPC_FAILED", "Failed to grant vehicle unlock.", error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new AppError(500, "SUPABASE_RPC_FAILED", "Unlock grant returned empty result.");
    }
    return {
      allowed: Boolean(row.allowed),
      alreadyUnlocked: Boolean(row.already_unlocked),
      usedUnlock: Boolean(row.used_unlock),
      freeUnlocksTotal: Number(row.free_unlocks_total ?? 0),
      freeUnlocksUsed: Number(row.free_unlocks_used ?? 0),
      freeUnlocksRemaining: Number(row.free_unlocks_remaining ?? 0),
    };
  }
}

export class SupabaseCachedAnalysisRepository implements CachedAnalysisRepository {
  constructor(private readonly client: DbClient) {}

  async findByAnalysisKey(analysisKey: string): Promise<CachedAnalysisRecord | null> {
    const { data, error } = await this.client
      .from("cached_analysis")
      .select("*")
      .eq("analysis_key", analysisKey)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load cached analysis entry.", error);
    return data ? mapCachedAnalysisRow(data) : null;
  }

  async insert(record: CachedAnalysisRecord): Promise<CachedAnalysisRecord> {
    const { data, error } = await this.client
      .from("cached_analysis")
      .insert(cachedAnalysisToRow(record))
      .select("*")
      .single();
    if (error) throw error;
    return mapCachedAnalysisRow(requireData(data, "Cached analysis insert returned no row."));
  }

  async update(
    analysisKey: string,
    updates: Partial<Omit<CachedAnalysisRecord, "id" | "analysisKey" | "createdAt">>,
  ): Promise<CachedAnalysisRecord> {
    const { data, error } = await this.client
      .from("cached_analysis")
      .update(cachedAnalysisUpdateToRow(updates))
      .eq("analysis_key", analysisKey)
      .select("*")
      .single();
    if (error) throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update cached analysis entry.", error);
    return mapCachedAnalysisRow(requireData(data, "Cached analysis update returned no row."));
  }

  async markAccessed(analysisKey: string, lastAccessedAt: string): Promise<void> {
    const { error } = await this.client.rpc("increment_cached_analysis_hit", {
      target_analysis_key: analysisKey,
      target_last_accessed_at: lastAccessedAt,
    });
    if (error) throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update cached analysis access stats.", error);
  }
}

export class SupabaseImageCacheRepository implements ImageCacheRepository {
  constructor(private readonly client: DbClient) {}

  async findByImageKey(imageKey: string): Promise<ImageCacheRecord | null> {
    const { data, error } = await this.client
      .from("image_cache")
      .select("*")
      .eq("image_key", imageKey)
      .maybeSingle();
    if (error) {
      logger.error(
        {
          label: "IMAGE_CACHE_QUERY_THROW",
          table: "image_cache",
          operation: "select",
          filters: { image_key: imageKey },
          supabase: serializeSupabaseError(error),
        },
        "IMAGE_CACHE_QUERY_THROW",
      );
      logger.error(
        {
          table: "image_cache",
          operation: "select",
          filters: { image_key: imageKey },
          supabase: serializeSupabaseError(error),
        },
        "Image cache Supabase query failed",
      );
      throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load image cache entry.", {
        table: "image_cache",
        operation: "select",
        filters: { image_key: imageKey },
        supabase: serializeSupabaseError(error),
      });
    }
    return data ? mapImageCacheRow(data) : null;
  }

  async upsert(record: ImageCacheRecord): Promise<ImageCacheRecord> {
    const { data, error } = await this.client
      .from("image_cache")
      .upsert(imageCacheToRow(record), { onConflict: "image_key" })
      .select("*")
      .single();
    if (error) {
      logger.error(
        {
          table: "image_cache",
          operation: "upsert",
          filters: { image_key: record.imageKey },
          supabase: serializeSupabaseError(error),
        },
        "Image cache Supabase upsert failed",
      );
      throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to persist image cache entry.", {
        table: "image_cache",
        operation: "upsert",
        filters: { image_key: record.imageKey },
        supabase: serializeSupabaseError(error),
      });
    }
    return mapImageCacheRow(requireData(data, "Image cache upsert returned no row."));
  }

  async markAccessed(imageKey: string, lastAccessedAt: string): Promise<void> {
    const { error } = await this.client.rpc("increment_image_cache_hit", {
      target_image_key: imageKey,
      target_last_accessed_at: lastAccessedAt,
    });
    if (error) {
      logger.error(
        {
          table: "image_cache",
          operation: "rpc:increment_image_cache_hit",
          filters: { image_key: imageKey },
          supabase: serializeSupabaseError(error),
        },
        "Image cache hit update failed",
      );
      throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update image cache access stats.", {
        table: "image_cache",
        operation: "rpc:increment_image_cache_hit",
        filters: { image_key: imageKey },
        supabase: serializeSupabaseError(error),
      });
    }
  }

  async listRecent(limit: number): Promise<ImageCacheRecord[]> {
    const { data, error } = await this.client
      .from("image_cache")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) {
      logger.error(
        {
          table: "image_cache",
          operation: "select-recent",
          filters: { limit },
          supabase: serializeSupabaseError(error),
        },
        "Image cache recent query failed",
      );
      throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load recent image cache entries.", {
        table: "image_cache",
        operation: "select-recent",
        filters: { limit },
        supabase: serializeSupabaseError(error),
      });
    }
    return (data ?? []).map(mapImageCacheRow);
  }
}

export class SupabaseUsageCountersRepository implements UsageCountersRepository {
  constructor(private readonly client: DbClient) {}

  async findByUserAndDate(userId: string, date: string): Promise<UsageCounterRecord | null> {
    const { data, error } = await this.client
      .from(USAGE_COUNTERS_TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();
    if (error) {
      logUsageCounterError({
        operation: "select",
        filters: { user_id: userId, date },
        error,
      });
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to load usage counter.",
        buildUsageCounterErrorDetails({
          operation: "select",
          filters: { user_id: userId, date },
          error,
        }),
      );
    }
    return data ? mapUsageRow(data) : null;
  }

  async findLifetimeByUser(userId: string): Promise<UsageCounterRecord | null> {
    const { data, error } = await this.client
      .from(USAGE_COUNTERS_TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("date", LIFETIME_USAGE_DATE)
      .maybeSingle();
    if (error) {
      logUsageCounterError({
        operation: "select",
        filters: { user_id: userId, date: LIFETIME_USAGE_DATE },
        error,
      });
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to load lifetime usage counter.",
        buildUsageCounterErrorDetails({
          operation: "select",
          filters: { user_id: userId, date: LIFETIME_USAGE_DATE },
          error,
        }),
      );
    }
    return data ? mapUsageRow(data) : null;
  }

  async upsert(record: UsageCounterRecord): Promise<UsageCounterRecord> {
    const modernOperation = await this.client
      .from(USAGE_COUNTERS_TABLE)
      .upsert(usageToRow(record), { onConflict: "user_id,date" })
      .select("*")
      .single();
    if (!modernOperation.error) {
      return mapUsageRow(requireData(modernOperation.data, "Usage upsert returned no row."));
    }

    logUsageCounterError({
      operation: "upsert",
      filters: { user_id: record.userId, date: record.date },
      error: modernOperation.error,
      compatibilityMode: "modern",
    });

    if (isMissingColumnError(modernOperation.error, "total_scans")) {
      logger.warn(
        {
          table: USAGE_COUNTERS_TABLE,
          operation: "upsert",
          filters: { user_id: record.userId, date: record.date },
          missingColumn: "total_scans",
        },
        "Retrying usage counter upsert against legacy schema without total_scans",
      );

      const legacyOperation = await this.client
        .from(USAGE_COUNTERS_TABLE)
        .upsert(usageToLegacyRow(record), { onConflict: "user_id,date" })
        .select("*")
        .single();

      if (!legacyOperation.error) {
        return mapUsageRow(requireData(legacyOperation.data, "Legacy usage upsert returned no row."));
      }

      logUsageCounterError({
        operation: "upsert",
        filters: { user_id: record.userId, date: record.date },
        error: legacyOperation.error,
        compatibilityMode: "legacy",
      });

      throw new AppError(
        500,
        "SUPABASE_UPSERT_FAILED",
        "Failed to persist usage counter.",
        buildUsageCounterErrorDetails({
          operation: "upsert",
          filters: { user_id: record.userId, date: record.date },
          error: legacyOperation.error,
          compatibilityMode: "legacy",
        }),
      );
    }

    throw new AppError(
      500,
      "SUPABASE_UPSERT_FAILED",
      "Failed to persist usage counter.",
      buildUsageCounterErrorDetails({
        operation: "upsert",
        filters: { user_id: record.userId, date: record.date },
        error: modernOperation.error,
        compatibilityMode: "modern",
      }),
    );
  }

  async upsertLifetime(record: UsageCounterRecord): Promise<UsageCounterRecord> {
    return this.upsert({ ...record, date: LIFETIME_USAGE_DATE });
  }
}

export class SupabaseVisionDebugRepository implements VisionDebugRepository {
  constructor(private readonly client: DbClient) {}

  async create(record: VisionDebugRecord): Promise<VisionDebugRecord> {
    const { error } = await this.client.from("vision_debug_logs").insert(visionDebugToRow(record));
    if (error) throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to persist vision debug log.", error);
    return record;
  }
}
