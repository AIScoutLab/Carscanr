export type VehicleCandidate = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  confidence: number;
  thumbnailUrl: string;
};

export type VehicleSpecs = {
  engine: string;
  horsepower: number;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange: string;
  exteriorColors: string[];
  msrp: number;
};

export type ValuationResult = {
  tradeIn: string;
  privateParty: string;
  dealerRetail: string;
  confidenceLabel: string;
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
  confidenceScore: number;
  limitedPreview?: boolean;
  scannedAt: string;
};

export type GarageItem = {
  id: string;
  vehicleId: string;
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
