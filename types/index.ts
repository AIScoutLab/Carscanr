export type VehicleCandidate = {
  id: string;
  year: number;
  displayYearLabel?: string;
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
  tradeIn: string;
  tradeInRange: string;
  privateParty: string;
  privatePartyRange: string;
  dealerRetail: string;
  dealerRetailRange: string;
  confidenceLabel: string;
  sourceLabel: string;
  modelType: "provider_range" | "listing_derived" | "modeled";
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

export type UserPlan = "free" | "pro";

export type BillingProvider = "storekit" | "revenuecat" | "backend" | "placeholder";

export type SubscriptionProduct = {
  productId: string;
  platform: "ios";
  plan: UserPlan;
  priceLabel: string;
  billingPeriodLabel: string;
};

export type PurchaseAvailabilityState = "ready" | "preview_only" | "not_configured";

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
