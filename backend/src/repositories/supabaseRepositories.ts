import crypto from "node:crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { FREE_PRO_UNLOCKS_TOTAL } from "../config/product.js";
import { AppError } from "../errors/appError.js";
import { logger } from "../lib/logger.js";
import { resolveHorsepower } from "../lib/vehicleData.js";
import {
  ProviderEndpointType,
  ProviderApiUsageLogRecord,
  VehicleListingsCacheRow,
  VehicleSpecsCacheRow,
  VehicleValuesCacheRow,
} from "../lib/providerCache.js";
import {
  CanonicalVehicleRecord,
  CanonicalGapQueueRecord,
  CanonicalVehicleImageRecord,
  CachedAnalysisRecord,
  GarageItemRecord,
  UnlockBalanceRecord,
  UserVehicleUnlockRecord,
  ImageCacheRecord,
  ListingClickRecord,
  ListingRecord,
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
} from "../types/domain.js";
import {
  CanonicalVehiclesRepository,
  CanonicalGapQueueRepository,
  CachedAnalysisRepository,
  CanonicalVehicleImagesRepository,
  UnlockBalanceRepository,
  ListingsCacheRepository,
  ListingClicksRepository,
  RevenueCatEventsRepository,
  VehiclePhotoClustersRepository,
  GarageItemsRepository,
  ImageCacheRepository,
  ListingResultsRepository,
  ProviderApiUsageLogsRepository,
  GrantUnlockResult,
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
} from "./interfaces.js";

type DbClient = SupabaseClient<any, "public", any>;
const USAGE_COUNTERS_TABLE = "usage_counters";
const LIFETIME_USAGE_DATE = "1970-01-01";

function supabaseErrorDetails(table: string, operation: string, error: any) {
  return {
    table,
    operation,
    code: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
  };
}

function requireData<T>(value: T | null, message: string): T {
  if (value == null) {
    throw new AppError(500, "SUPABASE_EMPTY_RESPONSE", message);
  }
  return value;
}

function isMissingUnlockBalanceColumnError(error: any, table: string, column: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  return (
    code === "PGRST204" &&
    message.includes(`'${column}'`) &&
    message.includes(`'${table}'`)
  );
}

function mapVehicleRow(row: any): VehicleRecord {
  const parsedHorsepower = resolveHorsepower(row.horsepower, row.hp, row.engine_hp);
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
    horsepower: parsedHorsepower,
    torque: row.torque,
    transmission: row.transmission,
    drivetrain: row.drivetrain,
    mpgOrRange: row.mpg_or_range,
    colors: Array.isArray(row.colors) ? row.colors : [],
  };
}

function mapCanonicalVehicleRow(row: any): CanonicalVehicleRecord {
  const parsedHorsepower = resolveHorsepower(row.horsepower);
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
    horsepower: parsedHorsepower,
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

function mapCanonicalGapQueueRow(row: any): CanonicalGapQueueRecord {
  return {
    id: row.id,
    gapKey: row.gap_key,
    canonicalKey: row.canonical_key,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim ?? null,
    normalizedMake: row.normalized_make,
    normalizedModel: row.normalized_model,
    normalizedTrim: row.normalized_trim,
    bodyType: row.body_type ?? null,
    vehicleType: row.vehicle_type ?? null,
    finalResultType: row.final_result_type,
    payloadStrength: row.payload_strength,
    exampleConfidence: row.example_confidence ?? null,
    exampleScanId: row.example_scan_id ?? null,
    visibleBadgeText: row.visible_badge_text ?? null,
    visibleMakeText: row.visible_make_text ?? null,
    visibleModelText: row.visible_model_text ?? null,
    visibleTrimText: row.visible_trim_text ?? null,
    notes: row.notes ?? null,
    hitCount: row.hit_count ?? 0,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canonicalGapQueueToRow(record: CanonicalGapQueueRecord) {
  return {
    id: record.id,
    gap_key: record.gapKey,
    canonical_key: record.canonicalKey,
    year: record.year,
    make: record.make,
    model: record.model,
    trim: record.trim ?? null,
    normalized_make: record.normalizedMake,
    normalized_model: record.normalizedModel,
    normalized_trim: record.normalizedTrim,
    body_type: record.bodyType ?? null,
    vehicle_type: record.vehicleType ?? null,
    final_result_type: record.finalResultType,
    payload_strength: record.payloadStrength,
    example_confidence: record.exampleConfidence ?? null,
    example_scan_id: record.exampleScanId ?? null,
    visible_badge_text: record.visibleBadgeText ?? null,
    visible_make_text: record.visibleMakeText ?? null,
    visible_model_text: record.visibleModelText ?? null,
    visible_trim_text: record.visibleTrimText ?? null,
    notes: record.notes ?? null,
    hit_count: record.hitCount,
    first_seen_at: record.firstSeenAt,
    last_seen_at: record.lastSeenAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function mapCanonicalVehicleImageRow(row: any): CanonicalVehicleImageRecord {
  return {
    id: row.id,
    canonicalKey: row.canonical_key,
    canonicalVehicleId: row.canonical_vehicle_id ?? null,
    year: row.year ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    trim: row.trim ?? null,
    normalizedMake: row.normalized_make ?? null,
    normalizedModel: row.normalized_model ?? null,
    normalizedTrim: row.normalized_trim ?? null,
    imageUrl: row.image_url,
    imageKey: row.image_key ?? null,
    source: row.source,
    status: row.status,
    safetyStatus: row.safety_status,
    qualityScore: Number(row.quality_score ?? 0),
    isPrimary: Boolean(row.is_primary),
    scanCount: row.scan_count ?? 0,
    uniqueUserCount: row.unique_user_count ?? 0,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canonicalVehicleImageToRow(record: CanonicalVehicleImageRecord) {
  return {
    id: record.id,
    canonical_key: record.canonicalKey,
    canonical_vehicle_id: record.canonicalVehicleId ?? null,
    year: record.year ?? null,
    make: record.make ?? null,
    model: record.model ?? null,
    trim: record.trim ?? null,
    normalized_make: record.normalizedMake ?? null,
    normalized_model: record.normalizedModel ?? null,
    normalized_trim: record.normalizedTrim ?? null,
    image_url: record.imageUrl,
    image_key: record.imageKey ?? null,
    source: record.source,
    status: record.status,
    safety_status: record.safetyStatus,
    quality_score: record.qualityScore,
    is_primary: record.isPrimary,
    scan_count: record.scanCount,
    unique_user_count: record.uniqueUserCount,
    first_seen_at: record.firstSeenAt,
    last_seen_at: record.lastSeenAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function mapVehiclePhotoClusterRow(row: any): VehiclePhotoClusterRecord {
  return {
    id: row.id,
    clusterKey: row.cluster_key,
    representativeVisualHash: row.representative_visual_hash,
    canonicalScanId: row.canonical_scan_id ?? null,
    canonicalPhotoHash: row.canonical_photo_hash ?? null,
    canonicalVehicleId: row.canonical_vehicle_id ?? null,
    canonicalKey: row.canonical_key ?? null,
    canonicalMake: row.canonical_make ?? null,
    canonicalModel: row.canonical_model ?? null,
    canonicalBadge: row.canonical_badge ?? null,
    canonicalYear: row.canonical_year ?? null,
    canonicalMatchStrength: row.canonical_match_strength ?? null,
    canonicalHammingDistance: row.canonical_hamming_distance ?? null,
    year: row.year ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    trim: row.trim ?? null,
    normalizedMake: row.normalized_make ?? null,
    normalizedModel: row.normalized_model ?? null,
    normalizedTrim: row.normalized_trim ?? null,
    memberCount: row.member_count ?? 0,
    scanCount: row.scan_count ?? 1,
    uniqueUserCount: row.unique_user_count ?? 1,
    confidence: Number(row.confidence ?? 0),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function vehiclePhotoClusterToRow(record: VehiclePhotoClusterRecord) {
  return {
    id: record.id,
    cluster_key: record.clusterKey,
    representative_visual_hash: record.representativeVisualHash,
    canonical_scan_id: record.canonicalScanId ?? null,
    canonical_photo_hash: record.canonicalPhotoHash ?? record.representativeVisualHash,
    canonical_vehicle_id: record.canonicalVehicleId ?? null,
    canonical_key: record.canonicalKey ?? null,
    canonical_make: record.canonicalMake ?? null,
    canonical_model: record.canonicalModel ?? null,
    canonical_badge: record.canonicalBadge ?? null,
    canonical_year: record.canonicalYear ?? null,
    canonical_match_strength: record.canonicalMatchStrength ?? null,
    canonical_hamming_distance: record.canonicalHammingDistance ?? null,
    year: record.year ?? null,
    make: record.make ?? null,
    model: record.model ?? null,
    trim: record.trim ?? null,
    normalized_make: record.normalizedMake ?? null,
    normalized_model: record.normalizedModel ?? null,
    normalized_trim: record.normalizedTrim ?? null,
    member_count: record.memberCount,
    scan_count: record.scanCount,
    unique_user_count: record.uniqueUserCount,
    confidence: record.confidence,
    last_seen_at: record.lastSeenAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function mapVehiclePhotoClusterMemberRow(row: any): VehiclePhotoClusterMemberRecord {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    scanId: row.scan_id,
    userId: row.user_id ?? null,
    visualHash: row.visual_hash,
    imageKey: row.image_key ?? null,
    imageWidth: row.image_width ?? null,
    imageHeight: row.image_height ?? null,
    year: row.year ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    badge: row.badge ?? null,
    trim: row.trim ?? null,
    hammingDistance: row.hamming_distance == null ? null : Number(row.hamming_distance),
    matchStrength: row.match_strength,
    confidence: row.confidence == null ? null : Number(row.confidence),
    createdAt: row.created_at,
  };
}

function vehiclePhotoClusterMemberToRow(record: VehiclePhotoClusterMemberRecord) {
  return {
    id: record.id,
    cluster_id: record.clusterId,
    scan_id: record.scanId ?? null,
    user_id: record.userId ?? null,
    visual_hash: record.visualHash,
    image_key: record.imageKey ?? null,
    image_width: record.imageWidth ?? null,
    image_height: record.imageHeight ?? null,
    year: record.year ?? null,
    make: record.make ?? null,
    model: record.model ?? null,
    badge: record.badge ?? null,
    trim: record.trim ?? null,
    hamming_distance: record.hammingDistance ?? null,
    match_strength: record.matchStrength,
    confidence: record.confidence ?? null,
    created_at: record.createdAt,
  };
}

function canonicalGapQueueToRpcArgs(record: CanonicalGapQueueRecord) {
  return {
    p_id: record.id,
    p_gap_key: record.gapKey,
    p_canonical_key: record.canonicalKey,
    p_year: record.year,
    p_make: record.make,
    p_model: record.model,
    p_trim: record.trim ?? null,
    p_normalized_make: record.normalizedMake,
    p_normalized_model: record.normalizedModel,
    p_normalized_trim: record.normalizedTrim,
    p_body_type: record.bodyType ?? null,
    p_vehicle_type: record.vehicleType ?? null,
    p_final_result_type: record.finalResultType,
    p_payload_strength: record.payloadStrength,
    p_example_confidence: record.exampleConfidence ?? null,
    p_example_scan_id: record.exampleScanId ?? null,
    p_visible_badge_text: record.visibleBadgeText ?? null,
    p_visible_make_text: record.visibleMakeText ?? null,
    p_visible_model_text: record.visibleModelText ?? null,
    p_visible_trim_text: record.visibleTrimText ?? null,
    p_notes: record.notes ?? null,
    p_hit_count: record.hitCount,
    p_first_seen_at: record.firstSeenAt,
    p_last_seen_at: record.lastSeenAt,
    p_created_at: record.createdAt,
    p_updated_at: record.updatedAt,
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

function mapVehicleScanPopularityRow(row: any): VehicleScanPopularityRecord {
  return {
    id: row.id,
    normalizedKey: row.normalized_key,
    year: row.year,
    normalizedMake: row.normalized_make,
    normalizedModel: row.normalized_model,
    normalizedTrim: row.normalized_trim,
    scanCount: row.scan_count ?? 0,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function vehicleScanPopularityToRow(record: VehicleScanPopularityRecord) {
  return {
    id: record.id,
    normalized_key: record.normalizedKey,
    year: record.year,
    normalized_make: record.normalizedMake,
    normalized_model: record.normalizedModel,
    normalized_trim: record.normalizedTrim,
    scan_count: record.scanCount,
    last_seen_at: record.lastSeenAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function mapVehicleGlobalTrendingRow(row: any): VehicleGlobalTrendingRecord {
  return {
    id: row.id,
    normalizedKey: row.normalized_key,
    year: row.year,
    normalizedMake: row.normalized_make,
    normalizedModel: row.normalized_model,
    normalizedTrim: row.normalized_trim,
    globalScanCount: row.global_scan_count ?? 0,
    recentScanCount: row.recent_scan_count ?? 0,
    trendScore: Number(row.trend_score ?? 0),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function vehicleGlobalTrendingToRow(record: VehicleGlobalTrendingRecord) {
  return {
    id: record.id,
    normalized_key: record.normalizedKey,
    year: record.year,
    normalized_make: record.normalizedMake,
    normalized_model: record.normalizedModel,
    normalized_trim: record.normalizedTrim,
    global_scan_count: record.globalScanCount,
    recent_scan_count: record.recentScanCount,
    trend_score: record.trendScore,
    last_seen_at: record.lastSeenAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
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
    year: row.year ?? null,
    make: row.make ?? null,
    model: row.model ?? null,
    trim: row.trim ?? null,
    title: row.title,
    price: row.price,
    mileage: row.mileage,
    dealer: row.dealer,
    distanceMiles: row.distance_miles,
    location: row.location,
    imageUrl: row.image_url,
    listingUrl: row.listing_url ?? row.url ?? row.vdp_url ?? null,
    listedAt: row.listed_at,
  };
}

function mapListingClickRow(row: any): ListingClickRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    listingId: row.listing_id ?? null,
    vehicle: row.vehicle ?? null,
    url: row.url,
    userId: row.user_id ?? null,
    sessionId: row.session_id ?? null,
  };
}

function listingClickToRow(record: ListingClickRecord) {
  return {
    id: record.id,
    created_at: record.createdAt,
    listing_id: record.listingId ?? null,
    vehicle: record.vehicle ?? null,
    url: record.url,
    user_id: record.userId ?? null,
    session_id: record.sessionId ?? null,
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
    unlockCredits: Number(row.unlock_credits ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function unlockBalanceToRow(record: UnlockBalanceRecord) {
  return {
    user_id: record.userId,
    free_unlocks_total: record.freeUnlocksTotal,
    free_unlocks_used: record.freeUnlocksUsed,
    unlock_credits: record.unlockCredits,
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

function mapRevenueCatEventRow(row: any): RevenueCatEventRecord {
  return {
    id: row.id,
    appUserId: row.app_user_id ?? null,
    userId: row.user_id ?? null,
    eventType: row.event_type,
    productId: row.product_id ?? null,
    transactionId: row.transaction_id ?? null,
    originalTransactionId: row.original_transaction_id ?? null,
    processed: Boolean(row.processed),
    processedAction: row.processed_action ?? null,
    payloadSummary: row.payload_summary ?? null,
    createdAt: row.created_at,
    processedAt: row.processed_at ?? null,
  };
}

function revenueCatEventToRow(record: RevenueCatEventRecord) {
  return {
    id: record.id,
    app_user_id: record.appUserId ?? null,
    user_id: record.userId ?? null,
    event_type: record.eventType,
    product_id: record.productId ?? null,
    transaction_id: record.transactionId ?? null,
    original_transaction_id: record.originalTransactionId ?? null,
    processed: record.processed,
    processed_action: record.processedAction ?? null,
    payload_summary: record.payloadSummary ?? {},
    created_at: record.createdAt,
    processed_at: record.processedAt ?? null,
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
    event_type: mapProviderApiUsageLogEventToSupabaseRow(entry.eventType),
    cache_key: entry.cacheKey,
    request_summary: entry.requestSummary,
    response_summary: entry.responseSummary,
    created_at: entry.createdAt,
  };
}

function mapProviderApiUsageLogEventToSupabaseRow(eventType: ProviderApiUsageLogRecord["eventType"]) {
  switch (eventType) {
    case "provider_request":
      return "stale_refresh";
    case "inflight_dedupe":
      return "cache_hit";
    case "skipped_rate_guard":
      return "empty_hit";
    default:
      return eventType;
  }
}

function mapProviderApiUsageLogRow(row: any): ProviderApiUsageLogRecord {
  return {
    id: row.id,
    provider: row.provider,
    endpointType: row.endpoint_type,
    eventType: row.event_type,
    cacheKey: row.cache_key,
    requestSummary: row.request_summary ?? {},
    responseSummary: row.response_summary ?? {},
    createdAt: row.created_at,
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

  async listSearchYears(): Promise<number[]> {
    const baseQuery = this.client
      .from("canonical_vehicles")
      .select("year")
      .eq("promotion_status", "promoted")
      .not("specs_json", "is", null);

    const [{ data: newestRows, error: newestError }, { data: oldestRows, error: oldestError }] = await Promise.all([
      baseQuery.order("year", { ascending: false }).limit(1),
      this.client
        .from("canonical_vehicles")
        .select("year")
        .eq("promotion_status", "promoted")
        .not("specs_json", "is", null)
        .order("year", { ascending: true })
        .limit(1),
    ]);

    if (newestError) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical search years.", newestError);
    if (oldestError) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical search years.", oldestError);

    const newestYear = Number(newestRows?.[0]?.year);
    const oldestYear = Number(oldestRows?.[0]?.year);
    if (!Number.isInteger(newestYear) || !Number.isInteger(oldestYear)) {
      return [];
    }

    const years: number[] = [];
    for (let year = newestYear; year >= oldestYear; year -= 1) {
      years.push(year);
    }
    return years;
  }

  async listSearchMakes(year: number): Promise<string[]> {
    const { data, error } = await this.client
      .from("canonical_vehicles")
      .select("make")
      .eq("promotion_status", "promoted")
      .not("specs_json", "is", null)
      .eq("year", year)
      .order("make", { ascending: true })
      .limit(5000);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical search makes.", error);
    return Array.from(
      new Set(
        (data ?? [])
          .map((row) => (typeof row.make === "string" ? row.make.trim() : ""))
          .filter((make): make is string => make.length > 0),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  async listSearchModels(input: { year: number; make: string }): Promise<string[]> {
    const { data, error } = await this.client
      .from("canonical_vehicles")
      .select("model")
      .eq("promotion_status", "promoted")
      .not("specs_json", "is", null)
      .eq("year", input.year)
      .eq("normalized_make", input.make)
      .order("model", { ascending: true })
      .limit(5000);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical search models.", error);
    return Array.from(
      new Set(
        (data ?? [])
          .map((row) => (typeof row.model === "string" ? row.model.trim() : ""))
          .filter((model): model is string => model.length > 0),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  async listSearchTrims(input: { year: number; make: string; model: string }): Promise<CanonicalVehicleRecord[]> {
    const { data, error } = await this.client
      .from("canonical_vehicles")
      .select("*")
      .eq("promotion_status", "promoted")
      .not("specs_json", "is", null)
      .eq("year", input.year)
      .eq("normalized_make", input.make)
      .eq("normalized_model", input.model)
      .order("trim", { ascending: true })
      .limit(5000);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical search trims.", error);
    return (data ?? []).map(mapCanonicalVehicleRow);
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

export class SupabaseCanonicalGapQueueRepository implements CanonicalGapQueueRepository {
  constructor(private readonly client: DbClient) {}

  async findByGapKey(gapKey: string): Promise<CanonicalGapQueueRecord | null> {
    const { data, error } = await this.client.from("canonical_gap_queue").select("*").eq("gap_key", gapKey).maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical gap queue entry.", error);
    return data ? mapCanonicalGapQueueRow(data) : null;
  }

  async recordGap(record: CanonicalGapQueueRecord): Promise<{ record: CanonicalGapQueueRecord; action: "insert" | "increment" }> {
    const existing = await this.findByGapKey(record.gapKey);
    const { data, error } = await this.client.rpc("upsert_canonical_gap_queue", canonicalGapQueueToRpcArgs(record));
    if (error) {
      throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to persist canonical gap queue entry.", error);
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      record: mapCanonicalGapQueueRow(requireData(row, "Canonical gap queue upsert returned no row.")),
      action: existing ? "increment" : "insert",
    };
  }

  async listTop(limit: number): Promise<CanonicalGapQueueRecord[]> {
    const { data, error } = await this.client
      .from("canonical_gap_queue")
      .select("*")
      .order("hit_count", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(limit);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to list canonical gap queue entries.", error);
    return (data ?? []).map(mapCanonicalGapQueueRow);
  }
}

export class SupabaseVehicleScanPopularityRepository implements VehicleScanPopularityRepository {
  constructor(private readonly client: DbClient) {}

  async increment(input: {
    normalizedKey: string;
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim: string;
    lastSeenAt: string;
  }): Promise<VehicleScanPopularityRecord> {
    const existing = await this.findByNormalizedKey(input.normalizedKey);
    const record: VehicleScanPopularityRecord = existing
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

    const { data, error } = await this.client
      .from("vehicle_scan_popularity")
      .upsert(vehicleScanPopularityToRow(record), { onConflict: "normalized_key" })
      .select("*")
      .single();
    if (error) {
      logger.error(
        {
          label: "VEHICLE_POPULARITY_UPSERT_FAILURE",
          table: "vehicle_scan_popularity",
          operation: "upsert",
          normalizedKey: input.normalizedKey,
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
        "VEHICLE_POPULARITY_UPSERT_FAILURE",
      );
      throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to persist vehicle popularity.", error);
    }
    return mapVehicleScanPopularityRow(requireData(data, "Vehicle popularity upsert returned no row."));
  }

  async findByNormalizedKey(normalizedKey: string): Promise<VehicleScanPopularityRecord | null> {
    const { data, error } = await this.client
      .from("vehicle_scan_popularity")
      .select("*")
      .eq("normalized_key", normalizedKey)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load vehicle popularity row.", error);
    return data ? mapVehicleScanPopularityRow(data) : null;
  }

  async searchLikelyMatches(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
  }): Promise<VehicleScanPopularityRecord[]> {
    const { data, error } = await this.client
      .from("vehicle_scan_popularity")
      .select("*")
      .eq("year", input.year)
      .eq("normalized_make", input.normalizedMake)
      .ilike("normalized_model", `%${input.normalizedModel}%`)
      .order("scan_count", { ascending: false })
      .limit(25);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to search vehicle popularity rows.", error);
    return (data ?? []).map(mapVehicleScanPopularityRow);
  }

  async findConflicts(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
    normalizedTrim: string;
    minScanCount: number;
  }): Promise<VehicleScanPopularityRecord[]> {
    const { data, error } = await this.client
      .from("vehicle_scan_popularity")
      .select("*")
      .eq("year", input.year)
      .eq("normalized_make", input.normalizedMake)
      .gte("scan_count", input.minScanCount)
      .neq("normalized_model", input.normalizedModel)
      .order("scan_count", { ascending: false })
      .limit(10);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to search vehicle popularity conflicts.", error);
    return (data ?? []).map(mapVehicleScanPopularityRow);
  }

  async listTop(limit: number): Promise<VehicleScanPopularityRecord[]> {
    const { data, error } = await this.client
      .from("vehicle_scan_popularity")
      .select("*")
      .order("scan_count", { ascending: false })
      .limit(limit);
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to list top vehicle popularity rows.", error);
    return (data ?? []).map(mapVehicleScanPopularityRow);
  }
}

export class SupabaseVehicleGlobalTrendingRepository implements VehicleGlobalTrendingRepository {
  constructor(private readonly client: DbClient) {}

  async upsert(record: VehicleGlobalTrendingRecord): Promise<VehicleGlobalTrendingRecord> {
    const { data, error } = await this.client
      .from("vehicle_global_trending")
      .upsert(vehicleGlobalTrendingToRow(record), { onConflict: "normalized_key" })
      .select("*")
      .single();
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_UPSERT_FAILED",
        "Failed to persist global trending vehicle.",
        supabaseErrorDetails("vehicle_global_trending", "upsert", error),
      );
    }
    return mapVehicleGlobalTrendingRow(requireData(data, "Vehicle global trending upsert returned no row."));
  }

  async findByNormalizedKey(normalizedKey: string): Promise<VehicleGlobalTrendingRecord | null> {
    const { data, error } = await this.client
      .from("vehicle_global_trending")
      .select("*")
      .eq("normalized_key", normalizedKey)
      .maybeSingle();
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to load global trending row.",
        supabaseErrorDetails("vehicle_global_trending", "findByNormalizedKey", error),
      );
    }
    return data ? mapVehicleGlobalTrendingRow(data) : null;
  }

  async searchLikelyMatches(input: {
    year: number;
    normalizedMake: string;
    normalizedModel: string;
  }): Promise<VehicleGlobalTrendingRecord[]> {
    const { data, error } = await this.client
      .from("vehicle_global_trending")
      .select("*")
      .eq("year", input.year)
      .eq("normalized_make", input.normalizedMake)
      .ilike("normalized_model", `%${input.normalizedModel}%`)
      .order("trend_score", { ascending: false })
      .limit(25);
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to search global trending rows.",
        supabaseErrorDetails("vehicle_global_trending", "searchLikelyMatches", error),
      );
    }
    return (data ?? []).map(mapVehicleGlobalTrendingRow);
  }

  async listTop(limit: number): Promise<VehicleGlobalTrendingRecord[]> {
    const { data, error } = await this.client
      .from("vehicle_global_trending")
      .select("*")
      .order("trend_score", { ascending: false })
      .limit(limit);
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to list top trending vehicles.",
        supabaseErrorDetails("vehicle_global_trending", "listTop", error),
      );
    }
    return (data ?? []).map(mapVehicleGlobalTrendingRow);
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

export class SupabaseListingClicksRepository implements ListingClicksRepository {
  constructor(private readonly client: DbClient) {}

  async create(record: ListingClickRecord): Promise<ListingClickRecord> {
    const { data, error } = await this.client.from("listing_clicks").insert(listingClickToRow(record)).select().single();
    if (error) throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to persist listing click.", error);
    return mapListingClickRow(requireData(data, "Listing click insert returned no row."));
  }
}

export class SupabaseCanonicalVehicleImagesRepository implements CanonicalVehicleImagesRepository {
  constructor(private readonly client: DbClient) {}

  async findApprovedPrimaryByCanonicalKey(canonicalKey: string): Promise<CanonicalVehicleImageRecord | null> {
    const { data, error } = await this.client
      .from("canonical_vehicle_images")
      .select("*")
      .eq("canonical_key", canonicalKey)
      .eq("is_primary", true)
      .eq("status", "approved")
      .eq("safety_status", "passed")
      .maybeSingle();
    if (error) {
      throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical vehicle image.", supabaseErrorDetails("canonical_vehicle_images", "select", error));
    }
    return data ? mapCanonicalVehicleImageRow(data) : null;
  }

  async findApprovedByCanonicalKey(canonicalKey: string, limit: number): Promise<CanonicalVehicleImageRecord[]> {
    const { data, error } = await this.client
      .from("canonical_vehicle_images")
      .select("*")
      .eq("canonical_key", canonicalKey)
      .eq("status", "approved")
      .eq("safety_status", "passed")
      .order("is_primary", { ascending: false })
      .order("quality_score", { ascending: false })
      .limit(limit);
    if (error) {
      throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical vehicle images.", supabaseErrorDetails("canonical_vehicle_images", "select", error));
    }
    return (data ?? []).map(mapCanonicalVehicleImageRow);
  }

  async upsertCandidateImage(record: CanonicalVehicleImageRecord): Promise<CanonicalVehicleImageRecord> {
    if (record.imageKey) {
      const { data: existing, error: existingError } = await this.client
        .from("canonical_vehicle_images")
        .select("*")
        .eq("canonical_key", record.canonicalKey)
        .eq("image_key", record.imageKey)
        .maybeSingle();
      if (existingError) {
        throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to check canonical vehicle image candidate.", supabaseErrorDetails("canonical_vehicle_images", "select", existingError));
      }
      if (existing) {
        const merged = {
          ...mapCanonicalVehicleImageRow(existing),
          ...record,
          id: existing.id,
          createdAt: existing.created_at,
        };
        const { data, error } = await this.client
          .from("canonical_vehicle_images")
          .update(canonicalVehicleImageToRow(merged))
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) {
          throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update canonical vehicle image candidate.", supabaseErrorDetails("canonical_vehicle_images", "update", error));
        }
        return mapCanonicalVehicleImageRow(requireData(data, "Canonical vehicle image update returned no row."));
      }
    }

    const { data, error } = await this.client
      .from("canonical_vehicle_images")
      .insert(canonicalVehicleImageToRow(record))
      .select("*")
      .single();
    if (error) {
      throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to persist canonical vehicle image candidate.", supabaseErrorDetails("canonical_vehicle_images", "insert", error));
    }
    return mapCanonicalVehicleImageRow(requireData(data, "Canonical vehicle image insert returned no row."));
  }

  async markApprovedPrimary(input: { canonicalKey: string; imageId: string }): Promise<CanonicalVehicleImageRecord | null> {
    const unset = await this.client.from("canonical_vehicle_images").update({ is_primary: false }).eq("canonical_key", input.canonicalKey);
    if (unset.error) {
      throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to clear existing canonical primary image.", supabaseErrorDetails("canonical_vehicle_images", "update", unset.error));
    }
    const { data, error } = await this.client
      .from("canonical_vehicle_images")
      .update({ is_primary: true, status: "approved", safety_status: "passed" })
      .eq("id", input.imageId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to promote canonical vehicle image.", supabaseErrorDetails("canonical_vehicle_images", "update", error));
    }
    return data ? mapCanonicalVehicleImageRow(data) : null;
  }

  async incrementImageStats(input: {
    imageId: string;
    scanCountDelta: number;
    uniqueUserCountDelta: number;
    lastSeenAt: string;
  }): Promise<CanonicalVehicleImageRecord | null> {
    const { data: existing, error: existingError } = await this.client
      .from("canonical_vehicle_images")
      .select("*")
      .eq("id", input.imageId)
      .maybeSingle();
    if (existingError) {
      throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load canonical vehicle image for stat update.", supabaseErrorDetails("canonical_vehicle_images", "select", existingError));
    }
    if (!existing) return null;
    const mapped = mapCanonicalVehicleImageRow(existing);
    const { data, error } = await this.client
      .from("canonical_vehicle_images")
      .update({
        scan_count: mapped.scanCount + input.scanCountDelta,
        unique_user_count: mapped.uniqueUserCount + input.uniqueUserCountDelta,
        last_seen_at: input.lastSeenAt,
      })
      .eq("id", input.imageId)
      .select("*")
      .single();
    if (error) {
      throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update canonical vehicle image stats.", supabaseErrorDetails("canonical_vehicle_images", "update", error));
    }
    return mapCanonicalVehicleImageRow(requireData(data, "Canonical vehicle image stats update returned no row."));
  }

  async rejectOrQuarantine(input: {
    imageId: string;
    status: "rejected" | "quarantined";
    safetyStatus: "failed" | "manual_review";
  }): Promise<CanonicalVehicleImageRecord | null> {
    const { data, error } = await this.client
      .from("canonical_vehicle_images")
      .update({ status: input.status, safety_status: input.safetyStatus, is_primary: false })
      .eq("id", input.imageId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to reject/quarantine canonical vehicle image.", supabaseErrorDetails("canonical_vehicle_images", "update", error));
    }
    return data ? mapCanonicalVehicleImageRow(data) : null;
  }
}

export class SupabaseVehiclePhotoClustersRepository implements VehiclePhotoClustersRepository {
  constructor(private readonly client: DbClient) {}

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
    let query = this.client
      .from("vehicle_photo_clusters")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(input.limit ?? 25);

    if (input.canonicalKey) {
      query = query.eq("canonical_key", input.canonicalKey);
    } else {
      if (input.normalizedMake) query = query.eq("normalized_make", input.normalizedMake);
      if (input.normalizedModel) query = query.eq("normalized_model", input.normalizedModel);
    }

    const { data, error } = await query;
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to load vehicle photo cluster candidates.",
        supabaseErrorDetails("vehicle_photo_clusters", "select", error),
      );
    }
    return (data ?? []).map(mapVehiclePhotoClusterRow);
  }

  async findMemberByClusterAndScan(input: {
    clusterId: string;
    scanId: string;
  }): Promise<VehiclePhotoClusterMemberRecord | null> {
    const { data, error } = await this.client
      .from("vehicle_photo_cluster_members")
      .select("*")
      .eq("cluster_id", input.clusterId)
      .eq("scan_id", input.scanId)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to query vehicle photo cluster membership.",
        supabaseErrorDetails("vehicle_photo_cluster_members", "select", error),
      );
    }
    return data ? mapVehiclePhotoClusterMemberRow(data) : null;
  }

  async createCluster(record: VehiclePhotoClusterRecord): Promise<VehiclePhotoClusterRecord> {
    const { data, error } = await this.client
      .from("vehicle_photo_clusters")
      .upsert(vehiclePhotoClusterToRow(record), { onConflict: "representative_visual_hash" })
      .select("*")
      .single();
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_INSERT_FAILED",
        "Failed to create vehicle photo cluster.",
        supabaseErrorDetails("vehicle_photo_clusters", "insert", error),
      );
    }
    return mapVehiclePhotoClusterRow(requireData(data, "Vehicle photo cluster insert returned no row."));
  }

  async addMember(record: VehiclePhotoClusterMemberRecord): Promise<VehiclePhotoClusterMemberRecord> {
    const { data, error } = await this.client
      .from("vehicle_photo_cluster_members")
      .upsert(vehiclePhotoClusterMemberToRow(record), { onConflict: "cluster_id,scan_id", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_INSERT_FAILED",
        "Failed to add vehicle photo cluster member.",
        supabaseErrorDetails("vehicle_photo_cluster_members", "insert", error),
      );
    }
    if (data) return mapVehiclePhotoClusterMemberRow(data);
    const existing = await this.findMemberByClusterAndScan({
      clusterId: record.clusterId,
      scanId: record.scanId,
    });
    if (existing) return existing;
    throw new AppError(500, "SUPABASE_INSERT_FAILED", "Vehicle photo cluster member insert returned no row.");
  }

  async findUserContribution(input: { clusterId: string; userId: string }): Promise<VehiclePhotoClusterMemberRecord | null> {
    const { data, error } = await this.client
      .from("vehicle_photo_cluster_members")
      .select("*")
      .eq("cluster_id", input.clusterId)
      .eq("user_id", input.userId)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to query vehicle photo cluster member.",
        supabaseErrorDetails("vehicle_photo_cluster_members", "select", error),
      );
    }
    return data ? mapVehiclePhotoClusterMemberRow(data) : null;
  }

  async incrementClusterStats(input: {
    clusterId: string;
    memberCountDelta?: number;
    scanCountDelta: number;
    uniqueUserCountDelta: number;
    lastSeenAt: string;
  }): Promise<VehiclePhotoClusterRecord | null> {
    const { data: existing, error: existingError } = await this.client
      .from("vehicle_photo_clusters")
      .select("*")
      .eq("id", input.clusterId)
      .maybeSingle();
    if (existingError) {
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to load vehicle photo cluster for stat update.",
        supabaseErrorDetails("vehicle_photo_clusters", "select", existingError),
      );
    }
    if (!existing) return null;
    const mapped = mapVehiclePhotoClusterRow(existing);
    const { data, error } = await this.client
      .from("vehicle_photo_clusters")
      .update({
        member_count: Math.max(0, mapped.memberCount + (input.memberCountDelta ?? 0)),
        scan_count: mapped.scanCount + input.scanCountDelta,
        unique_user_count: mapped.uniqueUserCount + input.uniqueUserCountDelta,
        last_seen_at: input.lastSeenAt,
      })
      .eq("id", input.clusterId)
      .select("*")
      .single();
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_UPDATE_FAILED",
        "Failed to update vehicle photo cluster stats.",
        supabaseErrorDetails("vehicle_photo_clusters", "update", error),
      );
    }
    return mapVehiclePhotoClusterRow(requireData(data, "Vehicle photo cluster update returned no row."));
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
    const { data: existing, error: existingError } = await this.client
      .from("vehicle_photo_clusters")
      .select("*")
      .eq("id", input.clusterId)
      .maybeSingle();
    if (existingError) {
      throw new AppError(
        500,
        "SUPABASE_QUERY_FAILED",
        "Failed to load vehicle photo cluster identity.",
        supabaseErrorDetails("vehicle_photo_clusters", "select", existingError),
      );
    }
    if (!existing) return null;
    const current = mapVehiclePhotoClusterRow(existing);
    const shouldUpgrade = this.shouldUpgradeCanonicalIdentity(current, input);

    const { data, error } = await this.client
      .from("vehicle_photo_clusters")
      .update({
        canonical_scan_id: shouldUpgrade ? input.canonicalScanId ?? current.canonicalScanId ?? null : current.canonicalScanId ?? null,
        canonical_photo_hash: shouldUpgrade
          ? input.canonicalPhotoHash ?? input.representativeVisualHash ?? current.canonicalPhotoHash ?? current.representativeVisualHash
          : current.canonicalPhotoHash ?? current.representativeVisualHash,
        canonical_vehicle_id: shouldUpgrade ? input.canonicalVehicleId ?? current.canonicalVehicleId ?? null : current.canonicalVehicleId ?? null,
        canonical_key: shouldUpgrade ? input.canonicalKey ?? current.canonicalKey ?? null : current.canonicalKey ?? null,
        canonical_make: shouldUpgrade ? input.canonicalMake ?? input.make ?? current.canonicalMake ?? current.make ?? null : current.canonicalMake ?? current.make ?? null,
        canonical_model: shouldUpgrade ? input.canonicalModel ?? input.model ?? current.canonicalModel ?? current.model ?? null : current.canonicalModel ?? current.model ?? null,
        canonical_badge: shouldUpgrade ? input.canonicalBadge ?? input.trim ?? current.canonicalBadge ?? current.trim ?? null : current.canonicalBadge ?? current.trim ?? null,
        canonical_year: shouldUpgrade ? input.canonicalYear ?? input.year ?? current.canonicalYear ?? current.year ?? null : current.canonicalYear ?? current.year ?? null,
        canonical_match_strength: shouldUpgrade ? input.matchStrength ?? current.canonicalMatchStrength ?? null : current.canonicalMatchStrength ?? null,
        canonical_hamming_distance: shouldUpgrade ? input.hammingDistance ?? current.canonicalHammingDistance ?? null : current.canonicalHammingDistance ?? null,
        year: shouldUpgrade ? input.year ?? current.year ?? null : current.year ?? null,
        make: shouldUpgrade ? input.make ?? current.make ?? null : current.make ?? null,
        model: shouldUpgrade ? input.model ?? current.model ?? null : current.model ?? null,
        trim: shouldUpgrade ? input.trim ?? current.trim ?? null : current.trim ?? null,
        normalized_make: shouldUpgrade ? input.normalizedMake ?? current.normalizedMake ?? null : current.normalizedMake ?? null,
        normalized_model: shouldUpgrade ? input.normalizedModel ?? current.normalizedModel ?? null : current.normalizedModel ?? null,
        normalized_trim: shouldUpgrade ? input.normalizedTrim ?? current.normalizedTrim ?? null : current.normalizedTrim ?? null,
        confidence: shouldUpgrade ? Math.max(current.confidence, input.confidence ?? 0) : current.confidence,
        representative_visual_hash: input.representativeVisualHash ?? undefined,
        last_seen_at: input.lastSeenAt ?? undefined,
      })
      .eq("id", input.clusterId)
      .select("*")
      .maybeSingle();
    if (error) {
      throw new AppError(
        500,
        "SUPABASE_UPDATE_FAILED",
        "Failed to update vehicle photo cluster identity.",
        supabaseErrorDetails("vehicle_photo_clusters", "update", error),
      );
    }
    return data ? mapVehiclePhotoClusterRow(data) : null;
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

export class SupabaseRevenueCatEventsRepository implements RevenueCatEventsRepository {
  constructor(private readonly client: DbClient) {}

  async findById(id: string): Promise<RevenueCatEventRecord | null> {
    const { data, error } = await this.client
      .from("revenuecat_events")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load RevenueCat event.", error);
    return data ? mapRevenueCatEventRow(data) : null;
  }

  async findProcessedByTransactionId(transactionId: string): Promise<RevenueCatEventRecord | null> {
    const { data, error } = await this.client
      .from("revenuecat_events")
      .select("*")
      .eq("transaction_id", transactionId)
      .eq("processed", true)
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load RevenueCat transaction.", error);
    return data ? mapRevenueCatEventRow(data) : null;
  }

  async findProcessedSubscriptionGrantByOriginalTransaction(input: {
    userId: string;
    originalTransactionId: string;
  }): Promise<RevenueCatEventRecord | null> {
    const { data, error } = await this.client
      .from("revenuecat_events")
      .select("*")
      .eq("user_id", input.userId)
      .eq("original_transaction_id", input.originalTransactionId)
      .eq("processed", true)
      .eq("processed_action", "pro_granted")
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load RevenueCat subscription transaction.", error);
    return data ? mapRevenueCatEventRow(data) : null;
  }

  async findProcessedSubscriptionGrantByAppUserId(input: {
    userId: string;
    appUserId: string;
  }): Promise<RevenueCatEventRecord | null> {
    const { data, error } = await this.client
      .from("revenuecat_events")
      .select("*")
      .eq("user_id", input.userId)
      .eq("app_user_id", input.appUserId)
      .eq("processed", true)
      .eq("processed_action", "pro_granted")
      .limit(1)
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load RevenueCat subscription app user.", error);
    return data ? mapRevenueCatEventRow(data) : null;
  }

  async create(record: RevenueCatEventRecord): Promise<RevenueCatEventRecord> {
    const { data, error } = await this.client
      .from("revenuecat_events")
      .insert(revenueCatEventToRow(record))
      .select("*")
      .single();
    if (error) {
      logger.error(
        {
          eventId: record.id,
          eventType: record.eventType,
          supabaseCode: error.code,
          supabaseMessage: error.message,
          supabaseDetails: error.details,
        },
        "REVENUECAT_EVENT_INSERT_FAILED",
      );
      throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to persist RevenueCat event.", error);
    }
    return mapRevenueCatEventRow(requireData(data, "RevenueCat event insert returned no row."));
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
    const { data, error } = await this.client
      .from("revenuecat_events")
      .update({
        user_id: updates.userId ?? null,
        product_id: updates.productId ?? null,
        transaction_id: updates.transactionId ?? null,
        original_transaction_id: updates.originalTransactionId ?? null,
        payload_summary: updates.payloadSummary ?? {},
        processed: true,
        processed_action: updates.processedAction,
        processed_at: updates.processedAt,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      logger.error(
        {
          eventId: id,
          processedAction: updates.processedAction,
          supabaseCode: error.code,
          supabaseMessage: error.message,
          supabaseDetails: error.details,
        },
        "REVENUECAT_EVENT_UPDATE_FAILED",
      );
      throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to mark RevenueCat event processed.", error);
    }
    return mapRevenueCatEventRow(requireData(data, "RevenueCat event update returned no row."));
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
    if (error) {
      logger.error(
        {
          label: "VALUE_CACHE_QUERY_FAILURE",
          table: "provider_vehicle_values_cache",
          operation: "select",
          cacheKey,
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
        "VALUE_CACHE_QUERY_FAILURE",
      );
      throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load values cache entry.", error);
    }
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
    if (error) {
      logger.error(
        {
          label: "LISTINGS_CACHE_QUERY_FAILURE",
          table: "provider_vehicle_listings_cache",
          operation: "select",
          cacheKey,
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
        "LISTINGS_CACHE_QUERY_FAILURE",
      );
      throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to load listings cache entry.", error);
    }
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

  async summarizeSince(input: {
    sinceIso: string;
    provider?: string;
  }): Promise<{
    total: number;
    byEndpoint: Record<ProviderEndpointType, number>;
    byEvent: Record<string, number>;
  }> {
    let query = this.client
      .from("provider_api_usage_logs")
      .select("endpoint_type,event_type")
      .gte("created_at", input.sinceIso);

    if (input.provider) {
      query = query.eq("provider", input.provider);
    }

    const { data, error } = await query;
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to summarize provider API usage logs.", error);

    const byEndpoint: Record<ProviderEndpointType, number> = {
      specs: 0,
      values: 0,
      listings: 0,
    };
    const byEvent: Record<string, number> = {};

    for (const row of data ?? []) {
      const eventType = String(row.event_type ?? "unknown");
      byEvent[eventType] = (byEvent[eventType] ?? 0) + 1;
      const endpointType = row.endpoint_type as ProviderEndpointType | undefined;
      if ((eventType === "provider_request" || eventType === "stale_refresh") && (endpointType === "specs" || endpointType === "values" || endpointType === "listings")) {
        byEndpoint[endpointType] += 1;
      }
    }

    return {
      total: (byEvent.provider_request ?? 0) + (byEvent.stale_refresh ?? 0),
      byEndpoint,
      byEvent,
    };
  }

  async listSince(input: {
    sinceIso: string;
    provider?: string;
    limit?: number;
  }): Promise<ProviderApiUsageLogRecord[]> {
    let query = this.client
      .from("provider_api_usage_logs")
      .select("*")
      .gte("created_at", input.sinceIso)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 200);

    if (input.provider) {
      query = query.eq("provider", input.provider);
    }

    const { data, error } = await query;
    if (error) throw new AppError(500, "SUPABASE_QUERY_FAILED", "Failed to list provider API usage logs.", error);

    return (data ?? []).map((row) => mapProviderApiUsageLogRow(row));
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
      freeUnlocksTotal: FREE_PRO_UNLOCKS_TOTAL,
      freeUnlocksUsed: 0,
      unlockCredits: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let { data, error } = await this.client
      .from("user_unlock_balances")
      .upsert(unlockBalanceToRow(record), { onConflict: "user_id" })
      .select("*")
      .single();
    if (isMissingUnlockBalanceColumnError(error, "user_unlock_balances", "unlock_credits")) {
      logger.warn(
        {
          label: "UNLOCK_BALANCE_LEGACY_SCHEMA_FALLBACK",
          operation: "getOrCreate",
          userId,
        },
        "UNLOCK_BALANCE_LEGACY_SCHEMA_FALLBACK",
      );
      ({ data, error } = await this.client
        .from("user_unlock_balances")
        .upsert(
          {
            user_id: record.userId,
            free_unlocks_total: record.freeUnlocksTotal,
            free_unlocks_used: record.freeUnlocksUsed,
            created_at: record.createdAt,
            updated_at: record.updatedAt,
          },
          { onConflict: "user_id" },
        )
        .select("*")
        .single());
    }
    if (error) throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to upsert unlock balance.", error);
    return mapUnlockBalanceRow(requireData(data, "Unlock balance upsert returned no row."));
  }

  async update(record: UnlockBalanceRecord): Promise<UnlockBalanceRecord> {
    let { data, error } = await this.client
      .from("user_unlock_balances")
      .upsert(unlockBalanceToRow(record), { onConflict: "user_id" })
      .select("*")
      .single();
    if (isMissingUnlockBalanceColumnError(error, "user_unlock_balances", "unlock_credits")) {
      logger.warn(
        {
          label: "UNLOCK_BALANCE_LEGACY_SCHEMA_FALLBACK",
          operation: "update",
          userId: record.userId,
        },
        "UNLOCK_BALANCE_LEGACY_SCHEMA_FALLBACK",
      );
      ({ data, error } = await this.client
        .from("user_unlock_balances")
        .upsert(
          {
            user_id: record.userId,
            free_unlocks_total: record.freeUnlocksTotal,
            free_unlocks_used: record.freeUnlocksUsed,
            created_at: record.createdAt,
            updated_at: record.updatedAt,
          },
          { onConflict: "user_id" },
        )
        .select("*")
        .single());
    }
    if (error) throw new AppError(500, "SUPABASE_UPSERT_FAILED", "Failed to update unlock balance.", error);
    return mapUnlockBalanceRow(requireData(data, "Unlock balance update returned no row."));
  }
}

export class SupabaseVehicleUnlockRepository implements VehicleUnlockRepository {
  constructor(private readonly client: DbClient) {}

  private buildGrantResult(input: {
    allowed: boolean;
    alreadyUnlocked: boolean;
    usedUnlock: boolean;
    usedUnlockCredit: boolean;
    balance: UnlockBalanceRecord;
  }): GrantUnlockResult {
    return {
      allowed: input.allowed,
      alreadyUnlocked: input.alreadyUnlocked,
      usedUnlock: input.usedUnlock,
      usedUnlockCredit: input.usedUnlockCredit,
      freeUnlocksTotal: input.balance.freeUnlocksTotal,
      freeUnlocksUsed: input.balance.freeUnlocksUsed,
      freeUnlocksRemaining: Math.max(0, input.balance.freeUnlocksTotal - input.balance.freeUnlocksUsed),
      unlockCreditsRemaining: Math.max(0, input.balance.unlockCredits),
    };
  }

  private async deleteUnlockAfterFailedBalanceUpdate(input: { userId: string; unlockKey: string }) {
    const { error } = await this.client
      .from("user_vehicle_unlocks")
      .delete()
      .eq("user_id", input.userId)
      .eq("unlock_key", input.unlockKey);
    if (error) {
      logger.error(
        {
          label: "UNLOCK_GRANT_FALLBACK_ROLLBACK_FAILED",
          userId: input.userId,
          code: error.code ?? null,
          message: error.message,
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
        "UNLOCK_GRANT_FALLBACK_ROLLBACK_FAILED",
      );
    }
  }

  private async grantUnlockWithoutRpc(
    input: {
      userId: string;
      unlockKey: string;
      unlockType: string;
      vin?: string | null;
      vinKey?: string | null;
      vehicleKey?: string | null;
      listingKey?: string | null;
      sourceVehicleId?: string | null;
      scanId?: string | null;
    },
    rpcError: any,
  ): Promise<GrantUnlockResult> {
    logger.warn(
      {
        label: "UNLOCK_GRANT_RPC_FALLBACK_STARTED",
        userId: input.userId,
        unlockType: input.unlockType,
        hasVehicleKey: Boolean(input.vehicleKey),
        hasSourceVehicleId: Boolean(input.sourceVehicleId),
        scanId: input.scanId ?? null,
        rpcCode: rpcError?.code ?? null,
        rpcMessage: rpcError?.message ?? null,
      },
      "UNLOCK_GRANT_RPC_FALLBACK_STARTED",
    );

    const balanceRepository = new SupabaseUnlockBalanceRepository(this.client);
    const existing = await this.findByUserAndKey(input.userId, input.unlockKey);
    const balance = await balanceRepository.getOrCreate(input.userId);
    if (existing) {
      logger.info(
        {
          label: "UNLOCK_GRANT_FALLBACK_RESULT",
          userId: input.userId,
          reason: "already_unlocked",
          usedUnlock: false,
          usedUnlockCredit: false,
          freeUnlocksRemaining: Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed),
          unlockCreditsRemaining: Math.max(0, balance.unlockCredits),
        },
        "UNLOCK_GRANT_FALLBACK_RESULT",
      );
      return this.buildGrantResult({
        allowed: true,
        alreadyUnlocked: true,
        usedUnlock: false,
        usedUnlockCredit: false,
        balance,
      });
    }

    const freeUnlocksRemaining = Math.max(0, balance.freeUnlocksTotal - balance.freeUnlocksUsed);
    const unlockCreditsRemaining = Math.max(0, balance.unlockCredits);
    if (freeUnlocksRemaining <= 0 && unlockCreditsRemaining <= 0) {
      logger.warn(
        {
          label: "UNLOCK_GRANT_FALLBACK_DENIED",
          userId: input.userId,
          reason: "insufficient_unlocks",
          freeUnlocksRemaining,
          unlockCreditsRemaining,
        },
        "UNLOCK_GRANT_FALLBACK_DENIED",
      );
      return this.buildGrantResult({
        allowed: false,
        alreadyUnlocked: false,
        usedUnlock: false,
        usedUnlockCredit: false,
        balance,
      });
    }

    try {
      await this.create({
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
      });
    } catch (error: any) {
      if (error?.code === "23505") {
        logger.info(
          {
            label: "UNLOCK_GRANT_FALLBACK_RESULT",
            userId: input.userId,
            reason: "already_unlocked_unique_violation",
            usedUnlock: false,
            usedUnlockCredit: false,
            freeUnlocksRemaining,
            unlockCreditsRemaining,
          },
          "UNLOCK_GRANT_FALLBACK_RESULT",
        );
        return this.buildGrantResult({
          allowed: true,
          alreadyUnlocked: true,
          usedUnlock: false,
          usedUnlockCredit: false,
          balance,
        });
      }
      throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to create vehicle unlock.", error);
    }

    const consumePurchasedCredit = freeUnlocksRemaining <= 0 && unlockCreditsRemaining > 0;
    const updatedBalance: UnlockBalanceRecord = {
      ...balance,
      freeUnlocksUsed: consumePurchasedCredit ? balance.freeUnlocksUsed : balance.freeUnlocksUsed + 1,
      unlockCredits: consumePurchasedCredit ? Math.max(0, balance.unlockCredits - 1) : balance.unlockCredits,
      updatedAt: new Date().toISOString(),
    };

    try {
      const savedBalance = await balanceRepository.update(updatedBalance);
      logger.info(
        {
          label: "UNLOCK_GRANT_FALLBACK_RESULT",
          userId: input.userId,
          reason: consumePurchasedCredit ? "purchased_credit_consumed" : "free_unlock_consumed",
          usedUnlock: true,
          usedUnlockCredit: consumePurchasedCredit,
          freeUnlocksRemaining: Math.max(0, savedBalance.freeUnlocksTotal - savedBalance.freeUnlocksUsed),
          unlockCreditsRemaining: Math.max(0, savedBalance.unlockCredits),
        },
        "UNLOCK_GRANT_FALLBACK_RESULT",
      );
      return this.buildGrantResult({
        allowed: true,
        alreadyUnlocked: false,
        usedUnlock: true,
        usedUnlockCredit: consumePurchasedCredit,
        balance: savedBalance,
      });
    } catch (error) {
      await this.deleteUnlockAfterFailedBalanceUpdate({
        userId: input.userId,
        unlockKey: input.unlockKey,
      });
      throw error;
    }
  }

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
    if (error) {
      logger.error(
        {
          label: "UNLOCK_GRANT_RPC_FAILED",
          userId: input.userId,
          unlockType: input.unlockType,
          hasVehicleKey: Boolean(input.vehicleKey),
          hasSourceVehicleId: Boolean(input.sourceVehicleId),
          scanId: input.scanId ?? null,
          code: error.code ?? null,
          message: error.message,
          details: error.details ?? null,
          hint: error.hint ?? null,
        },
        "UNLOCK_GRANT_RPC_FAILED",
      );
      try {
        return await this.grantUnlockWithoutRpc(input, error);
      } catch (fallbackError) {
        logger.error(
          {
            label: "UNLOCK_GRANT_RPC_FALLBACK_FAILED",
            userId: input.userId,
            unlockType: input.unlockType,
            hasVehicleKey: Boolean(input.vehicleKey),
            hasSourceVehicleId: Boolean(input.sourceVehicleId),
            rpcCode: error.code ?? null,
            rpcMessage: error.message,
            fallbackMessage: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            fallbackCode:
              typeof fallbackError === "object" && fallbackError !== null && "code" in fallbackError
                ? (fallbackError as { code?: unknown }).code
                : null,
          },
          "UNLOCK_GRANT_RPC_FALLBACK_FAILED",
        );
        throw new AppError(500, "SUPABASE_RPC_FAILED", "Failed to grant vehicle unlock.", error);
      }
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      throw new AppError(500, "SUPABASE_RPC_FAILED", "Unlock grant returned empty result.");
    }
    return {
      allowed: Boolean(row.allowed),
      alreadyUnlocked: Boolean(row.already_unlocked),
      usedUnlock: Boolean(row.used_unlock),
      usedUnlockCredit: Boolean(row.used_unlock_credit),
      freeUnlocksTotal: Number(row.free_unlocks_total ?? 0),
      freeUnlocksUsed: Number(row.free_unlocks_used ?? 0),
      freeUnlocksRemaining: Number(row.free_unlocks_remaining ?? 0),
      unlockCreditsRemaining: Number(row.unlock_credits_remaining ?? 0),
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
    if (error) {
      throw new AppError(500, "SUPABASE_INSERT_FAILED", "Failed to create cached analysis entry.", {
        table: "cached_analysis",
        operation: "insert",
        filters: { analysis_key: record.analysisKey },
        supabase: serializeSupabaseError(error),
      });
    }
    return mapCachedAnalysisRow(requireData(data, "Cached analysis insert returned no row."));
  }

  async update(
    analysisKey: string,
    updates: Partial<Omit<CachedAnalysisRecord, "id" | "analysisKey" | "createdAt">>,
  ): Promise<CachedAnalysisRecord | null> {
    const { data, error } = await this.client
      .from("cached_analysis")
      .update(cachedAnalysisUpdateToRow(updates))
      .eq("analysis_key", analysisKey)
      .select("*")
      .maybeSingle();
    if (error) throw new AppError(500, "SUPABASE_UPDATE_FAILED", "Failed to update cached analysis entry.", error);
    return data ? mapCachedAnalysisRow(data) : null;
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
