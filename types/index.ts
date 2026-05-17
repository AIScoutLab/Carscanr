export type VehicleCandidate = {
  id: string;
  year: number;
  displayYearLabel?: string;
  groundedYearRange?: {
    start: number;
    end: number;
  } | null;
  displayTitleLabel?: string;
  make: string;
  model: string;
  trim?: string;
  displayTrimLabel?: string;
  source?: "visual_candidate" | "ocr_override" | "visual_override";
  confidence: number;
  thumbnailUrl: string;
};

export type VehicleSpecs = {
  engine: string;
  horsepower: number | null;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange: string;
  exteriorColors: string[];
  msrp: number;
};

export type ValuationResult = {
  status:
    | "ready_to_load"
    | "loaded_condition_set"
    | "loaded_value"
    | "loaded_listing_range"
    | "no_comps_found"
    | "provider_error"
    | "specialty_unavailable"
    | "stale_after_input_change";
  selectedCondition?: "fair" | "good" | "excellent" | null;
  baseCondition?: "fair" | "good" | "excellent" | null;
  conditionValues?: {
    fair: {
      tradeIn: string;
      privateParty: string;
      dealerRetail: string;
      low?: string | null;
      median?: string | null;
      high?: string | null;
    };
    good: {
      tradeIn: string;
      privateParty: string;
      dealerRetail: string;
      low?: string | null;
      median?: string | null;
      high?: string | null;
    };
    excellent: {
      tradeIn: string;
      privateParty: string;
      dealerRetail: string;
      low?: string | null;
      median?: string | null;
      high?: string | null;
    };
  } | null;
  tradeIn: string;
  tradeInRange: string;
  privateParty: string;
  privatePartyRange: string;
  dealerRetail: string;
  dealerRetailRange: string;
  low?: string | null;
  high?: string | null;
  median?: string | null;
  confidenceLabel: string;
  sourceLabel: string;
  valuationSource?: "provider" | "cache" | "listing_comps" | "unavailable" | null;
  compCount?: number | null;
  confidence?: "high" | "moderate" | "limited" | "unavailable" | null;
  rangeLow?: string | null;
  rangeHigh?: string | null;
  midpoint?: string | null;
  unavailableReason?: string | null;
  message?: string | null;
  reason?: string | null;
  listingCount?: number | null;
  sourceBasis?: "provider_direct" | "listing_median_adjusted" | "modeled_condition_adjusted" | null;
  modelType: "provider_range" | "listing_derived" | "modeled" | "specialty_unavailable";
};

export type ListingResult = {
  id: string;
  title: string;
  price: string;
  mileage: string;
  dealer: string;
  distance: string;
  location: string;
  imageUrl: string;
};

export type VehicleRecord = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  heroImage: string;
  overview: string;
  specs: VehicleSpecs;
  valuation: ValuationResult;
  listings: ListingResult[];
};

export type OfflineCanonicalVehicle = {
  id: string;
  canonicalKey: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  vehicleType: "car" | "motorcycle";
  normalizedMake: string;
  normalizedModel: string;
  normalizedTrim: string;
  basicSpecs: {
    engine: string;
    horsepower: number | null;
    torque: string;
    transmission: string;
    drivetrain: string;
    mpgOrRange: string;
    exteriorColors: string[];
    msrp: number;
    bodyStyle: string;
  };
  lightweightValue?: {
    tradeIn: number;
    privateParty: number;
    dealerRetail: number;
    sourceLabel: string;
    confidenceLabel: string;
  } | null;
};

export type VehicleSearchQuery = {
  year?: string;
  make?: string;
  model?: string;
};

export type ScanResult = {
  id: string;
  imageUri: string;
  identifiedVehicle: VehicleCandidate;
  candidates: VehicleCandidate[];
  source?: "visual_candidate" | "ocr_override" | "visual_override";
  confidenceScore: number;
  detectedVehicleType?: "car" | "motorcycle";
  limitedPreview?: boolean;
  scannedAt: string;
  quickResult?: boolean;
  quickResultSource?: "offline_canonical" | "local_scan_cache";
  offlineDatasetVersion?: string | null;
  identificationConfidence?: number | null;
  dataConfidence?: number | null;
  payloadStrength?: "strong" | "usable" | "thin" | "empty" | null;
  enrichmentMode?: "exact" | "adjacent_year" | "generation_fallback" | "fallback_only" | null;
  unlockEligible?: boolean | null;
  unlockRecommendationReason?: string | null;
};

export type GarageItem = {
  id: string;
  vehicleId: string;
  unlockId?: string;
  sourceType?: "catalog" | "estimate" | "visual_override";
  confidence?: number | null;
  estimateMeta?: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    vehicleType?: "car" | "motorcycle" | "";
    titleLabel?: string;
    trustedCase?: boolean;
    resultSource?: string;
  } | null;
  favorite: boolean;
  notes: string;
  savedAt: string;
  imageUri: string;
  vehicle: VehicleRecord;
};

export type UserPlan = "free" | "pro" | "pro_monthly" | "pro_yearly";

export type BillingProvider = "storekit" | "revenuecat" | "backend" | "placeholder";

export type PurchaseOptionKind = "annual" | "monthly" | "unlock_pack" | "other";

export type SubscriptionProduct = {
  productId: string;
  packageIdentifier?: string;
  packageType?: string;
  optionKind?: PurchaseOptionKind;
  platform: "ios";
  plan: UserPlan;
  priceLabel: string;
  billingPeriodLabel: string;
  title?: string;
  description?: string | null;
};

export type PurchaseAvailabilityState = "ready" | "preview_only" | "not_configured";

export type FreeUnlockReason =
  | "already_unlocked"
  | "consumed"
  | "no_free_unlocks"
  | "vehicle_not_found"
  | "payload_too_thin"
  | "auth_required"
  | "network_error"
  | "unknown";

export type SubscriptionStatus = {
  plan: UserPlan;
  renewalLabel: string;
  scansUsed: number;
  scansRemaining: number | null;
  limitType: "lifetime";
  limit: number | null;
  scansUsedToday: number;
  dailyScanLimit: number | null;
  isActive?: boolean;
  provider?: BillingProvider;
  productId?: string | null;
  willAutoRenew?: boolean;
  lastVerifiedAt?: string | null;
  purchaseAvailable?: boolean;
  purchaseAvailabilityState?: PurchaseAvailabilityState;
  availableProducts?: SubscriptionProduct[];
};

export type SubscriptionVerifyPayload = {
  platform: "ios";
  productId: string;
  receiptData: string;
  accessToken?: string;
};

export type SubscriptionActionResult = {
  outcome: "verified" | "restored" | "cancelled" | "not_configured";
  status: SubscriptionStatus;
  message: string;
};

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
};

export type AuthSignUpResult =
  | {
      outcome: "signed_in";
      user: AuthUser;
    }
  | {
      outcome: "confirmation_required";
      user: AuthUser | null;
      message: string;
    };
