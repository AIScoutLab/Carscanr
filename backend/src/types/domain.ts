export type VehicleType = "car" | "motorcycle";
export type UserPlan = "free" | "pro" | "pro_monthly" | "pro_yearly";
export type VehicleCondition = "excellent" | "very_good" | "good" | "fair" | "poor";
export type CanonicalVehiclePromotionStatus = "candidate" | "promoted";
export type CanonicalGapFinalResultType = "canonical" | "ai_only";

export type VehicleRecord = {
  id: string;
  vin?: string | null;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  vehicleType: VehicleType;
  msrp: number;
  engine: string;
  horsepower: number | null;
  engineDisplacementL?: number | null;
  cylinders?: number | null;
  fuelType?: string | null;
  doors?: number | null;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange: string;
  colors: string[];
};

export type VehicleLookupDescriptor = {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  yearRange?: {
    start: number;
    end: number;
  } | null;
  vehicleType?: VehicleType | null;
  bodyStyle?: string | null;
  normalizedModel?: string | null;
};

export type PayloadStrength = "strong" | "usable" | "thin" | "empty";
export type EnrichmentMode = "exact" | "adjacent_year" | "generation_fallback" | "fallback_only";

export type PayloadEvaluation = {
  payloadStrength: PayloadStrength;
  dataConfidence: number;
  unlockEligible: boolean;
  unlockRecommendationReason: string;
  meaningfulSpecFieldCount: number;
  believableListingCount: number;
  hasMarketValue: boolean;
  reasons: string[];
};

export type VisionCandidate = {
  likely_year: number;
  likely_make: string;
  likely_model: string;
  likely_trim?: string;
  confidence: number;
};

export type VisibleTextEvidence = {
  raw_text: string[];
  make_text: string | null;
  model_text: string | null;
  trim_text: string | null;
  badge_text: string[];
  text_confidence: number;
  evidence_regions?: string[];
};

export type MatchEvidence = {
  source: "badge_text" | "visual_shape" | "canonical" | "cluster" | "provider";
  readableText?: string[];
};

export type VisionResult = {
  vehicle_type: VehicleType;
  likely_year: number;
  bestYear?: number | null;
  yearConfidence?: "exact" | "estimated" | "range";
  yearEvidence?: string | null;
  exactYearConfirmed?: boolean | null;
  displayYearLabel?: string | null;
  yearRange?: {
    start: number;
    end: number;
  } | null;
  yearReasoning?: string[] | null;
  likely_make: string;
  likely_model: string;
  likely_trim?: string;
  source?: "visual_candidate" | "ocr_override" | "visual_override";
  confidence: number;
  visible_text_evidence?: VisibleTextEvidence | null;
  alternate_candidates: VisionCandidate[];
  visible_clues: string[];
  visible_badge_text?: string;
  visible_make_text?: string;
  visible_model_text?: string;
  visible_trim_text?: string;
  emblem_logo_clues?: string[];
  textDominanceApplied?: boolean;
  focusCropUsed?: boolean;
  matchEvidence?: MatchEvidence | null;
};

export type VisionProviderResult = {
  normalized: VisionResult;
  rawResponse: unknown;
  provider: string;
};

export type MatchedVehicleCandidate = {
  vehicleId: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  confidence: number;
  matchReason: string;
};

export type ScanRecord = {
  id: string;
  userId: string;
  imageUrl: string;
  detectedVehicleType: VehicleType;
  confidence: number;
  createdAt: string;
  normalizedResult: VisionResult;
  candidates: MatchedVehicleCandidate[];
};

export type ValuationRecord = {
  id: string;
  vehicleId: string;
  zip: string;
  mileage: number;
  condition: VehicleCondition;
  baseCondition?: "fair" | "good" | "excellent" | null;
  status?:
    | "loaded_condition_set"
    | "loaded_value"
    | "loaded_listing_range"
    | "no_comps_found"
    | "provider_error"
    | "ready_to_load"
    | "specialty_unavailable";
  conditionValues?: {
    fair: {
      tradeIn: number | null;
      privateParty: number | null;
      dealerRetail: number | null;
      low?: number | null;
      median?: number | null;
      high?: number | null;
    };
    good: {
      tradeIn: number | null;
      privateParty: number | null;
      dealerRetail: number | null;
      low?: number | null;
      median?: number | null;
      high?: number | null;
    };
    excellent: {
      tradeIn: number | null;
      privateParty: number | null;
      dealerRetail: number | null;
      low?: number | null;
      median?: number | null;
      high?: number | null;
    };
  } | null;
  tradeIn: number | null;
  tradeInLow?: number;
  tradeInHigh?: number;
  privateParty: number | null;
  privatePartyLow?: number;
  privatePartyHigh?: number;
  dealerRetail: number | null;
  dealerRetailLow?: number;
  dealerRetailHigh?: number;
  low?: number | null;
  high?: number | null;
  median?: number | null;
  currency: "USD";
  generatedAt: string;
  sourceLabel?: string;
  confidenceLabel?: string;
  message?: string | null;
  reason?: string | null;
  sourceBasis?: "provider_direct" | "listing_median_adjusted" | "modeled_condition_adjusted" | null;
  modelType?: "provider_range" | "listing_derived" | "modeled" | "estimated_depreciation" | "estimated_family_model" | "specialty_unavailable";
  listingCount?: number | null;
  supportingListings?: ListingRecord[] | null;
};

export type ListingRecord = {
  id: string;
  vehicleId: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  title: string;
  price: number;
  mileage: number;
  dealer: string;
  distanceMiles: number;
  location: string;
  imageUrl: string;
  listingUrl?: string | null;
  listedAt: string;
};

export type ListingClickRecord = {
  id: string;
  createdAt: string;
  listingId?: string | null;
  vehicle?: string | null;
  url: string;
  userId?: string | null;
  sessionId?: string | null;
};

export type GarageItemRecord = {
  id: string;
  userId: string;
  vehicleId: string;
  imageUrl: string;
  notes: string;
  favorite: boolean;
  createdAt: string;
};

export type SubscriptionRecord = {
  id: string;
  userId: string;
  plan: UserPlan;
  status: "active" | "inactive";
  productId?: string;
  expiresAt?: string;
  verifiedAt: string;
};

export type UsageCounterRecord = {
  id: string;
  userId: string;
  date: string;
  scanCount: number;
  totalScans: number;
  lastScanAt?: string;
  recentAttemptTimestamps: string[];
};

export type UnlockBalanceRecord = {
  userId: string;
  freeUnlocksTotal: number;
  freeUnlocksUsed: number;
  unlockCredits: number;
  createdAt: string;
  updatedAt: string;
};

export type UserVehicleUnlockRecord = {
  id: string;
  userId: string;
  unlockKey: string;
  unlockType: string;
  vin?: string | null;
  vinKey?: string | null;
  vehicleKey?: string | null;
  listingKey?: string | null;
  sourceVehicleId?: string | null;
  scanId?: string | null;
  createdAt: string;
};

export type VisionDebugRecord = {
  id: string;
  scanId: string;
  userId: string;
  provider: string;
  rawResponse: unknown;
  normalizedResult?: VisionResult;
  error?: string;
  createdAt: string;
};

export type CachedAnalysisStatus = "processing" | "completed" | "failed";

export type CachedAnalysisRecord = {
  id: string;
  analysisKey: string;
  analysisType: string;
  identityType?: string | null;
  identityValue?: string | null;
  vin?: string | null;
  vinKey?: string | null;
  vehicleKey?: string | null;
  listingKey?: string | null;
  imageKey?: string | null;
  visualHash?: string | null;
  promptVersion: string;
  modelName: string;
  status: CachedAnalysisStatus;
  resultJson?: unknown | null;
  errorText?: string | null;
  costEstimate?: number | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | null;
  hitCount: number;
};

export type ImageCacheRecord = {
  id: string;
  imageKey: string;
  visualHash?: string | null;
  fileWidth?: number | null;
  fileHeight?: number | null;
  normalizedVehicleJson?: unknown | null;
  ocrJson?: unknown | null;
  extractionJson?: unknown | null;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | null;
  hitCount: number;
};

export type AuthContext = {
  userId: string;
  email?: string;
  plan: UserPlan;
  isGuest?: boolean;
};

export type CanonicalVehicleRecord = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  bodyType?: string | null;
  vehicleType?: VehicleType | null;
  engine?: string | null;
  drivetrain?: string | null;
  transmission?: string | null;
  fuelType?: string | null;
  horsepower?: number | null;
  torque?: string | null;
  msrp?: number | null;
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim?: string | null;
  normalizedVehicleType?: string | null;
  canonicalKey: string;
  specsJson?: VehicleRecord | null;
  overviewJson?: Record<string, unknown> | null;
  defaultImageUrl?: string | null;
  sourceProvider?: string | null;
  sourceVehicleId?: string | null;
  popularityScore: number;
  promotionStatus: CanonicalVehiclePromotionStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  lastPromotedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CanonicalGapQueueRecord = {
  id: string;
  gapKey: string;
  canonicalKey: string;
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim: string;
  bodyType?: string | null;
  vehicleType?: VehicleType | null;
  finalResultType: CanonicalGapFinalResultType;
  payloadStrength: PayloadStrength;
  exampleConfidence?: number | null;
  exampleScanId?: string | null;
  visibleBadgeText?: string | null;
  visibleMakeText?: string | null;
  visibleModelText?: string | null;
  visibleTrimText?: string | null;
  notes?: string | null;
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type VehicleScanPopularityRecord = {
  id: string;
  normalizedKey: string;
  year: number;
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim: string;
  scanCount: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type VehicleGlobalTrendingRecord = {
  id: string;
  normalizedKey: string;
  year: number;
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim: string;
  globalScanCount: number;
  recentScanCount: number;
  trendScore: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type VehiclePhotoClusterRecord = {
  id: string;
  clusterKey: string;
  representativeVisualHash: string;
  canonicalScanId?: string | null;
  canonicalPhotoHash?: string | null;
  canonicalVehicleId?: string | null;
  canonicalKey?: string | null;
  canonicalMake?: string | null;
  canonicalModel?: string | null;
  canonicalBadge?: string | null;
  canonicalYear?: number | null;
  canonicalMatchStrength?: "exact" | "strong" | "possible" | null;
  canonicalHammingDistance?: number | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  normalizedMake?: string | null;
  normalizedModel?: string | null;
  normalizedTrim?: string | null;
  memberCount: number;
  scanCount: number;
  uniqueUserCount: number;
  confidence: number;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

export type VehiclePhotoClusterMemberRecord = {
  id: string;
  clusterId: string;
  scanId: string;
  userId?: string | null;
  visualHash: string;
  imageKey?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  badge?: string | null;
  trim?: string | null;
  hammingDistance?: number | null;
  matchStrength: "exact" | "strong" | "possible";
  confidence?: number | null;
  createdAt: string;
};

export type CanonicalVehicleImageSource = "user_scan" | "curated" | "admin" | "generated_placeholder";
export type CanonicalVehicleImageStatus = "pending" | "approved" | "rejected" | "quarantined";
export type CanonicalVehicleImageSafetyStatus = "unreviewed" | "passed" | "failed" | "manual_review";

export type CanonicalVehicleImageRecord = {
  id: string;
  canonicalKey: string;
  canonicalVehicleId?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  normalizedMake?: string | null;
  normalizedModel?: string | null;
  normalizedTrim?: string | null;
  imageUrl: string;
  imageKey?: string | null;
  source: CanonicalVehicleImageSource;
  status: CanonicalVehicleImageStatus;
  safetyStatus: CanonicalVehicleImageSafetyStatus;
  qualityScore: number;
  isPrimary: boolean;
  scanCount: number;
  uniqueUserCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};
