export type VehicleType = "car" | "motorcycle";
export type UserPlan = "free" | "pro";
export type VehicleCondition = "excellent" | "very_good" | "good" | "fair" | "poor";
export type CanonicalVehiclePromotionStatus = "candidate" | "promoted";

export type VehicleRecord = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  vehicleType: VehicleType;
  msrp: number;
  engine: string;
  horsepower: number;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange: string;
  colors: string[];
};

export type VisionCandidate = {
  likely_year: number;
  likely_make: string;
  likely_model: string;
  likely_trim?: string;
  confidence: number;
};

export type VisionResult = {
  vehicle_type: VehicleType;
  likely_year: number;
  likely_make: string;
  likely_model: string;
  likely_trim?: string;
  confidence: number;
  alternate_candidates: VisionCandidate[];
  visible_clues: string[];
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
  tradeIn: number;
  privateParty: number;
  dealerRetail: number;
  currency: "USD";
  generatedAt: string;
};

export type ListingRecord = {
  id: string;
  vehicleId: string;
  title: string;
  price: number;
  mileage: number;
  dealer: string;
  distanceMiles: number;
  location: string;
  imageUrl: string;
  listedAt: string;
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
