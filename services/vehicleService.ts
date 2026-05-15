import { formatCurrency } from "@/lib/utils";
import { buildSpecialtyVehicleOverview, isSpecialtyExoticMake } from "@/lib/specialtyVehicles";
import { resolveConditionValues } from "@/lib/valueConditionSet";
import { resolveHorsepower } from "@/lib/vehicleData";
import { getVehicleImage } from "@/constants/vehicleImages";
import { apiRequest, apiRequestEnvelope } from "@/services/apiClient";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { MarketAreaZipSource } from "@/lib/marketAreaZip";
import { ListingResult, ValuationResult, VehicleRecord, VehicleSearchQuery } from "@/types";

export type VehicleLookupDescriptor = {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  vehicleType?: "car" | "motorcycle" | null;
  bodyStyle?: string | null;
  normalizedModel?: string | null;
};

type VehicleLookupInput =
  | string
  | {
      vehicleId?: string | null;
      descriptor?: VehicleLookupDescriptor | null;
    };

type BackendVehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  vehicleType: "car" | "motorcycle";
  msrp: number;
  engine: string;
  horsepower?: number | string | null;
  hp?: number | string | null;
  engine_hp?: number | string | null;
  imageUrl?: string | null;
  heroImage?: string | null;
  defaultImageUrl?: string | null;
  providerImageUrl?: string | null;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange: string;
  colors: string[];
};

type BackendResolvedVehicle = {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  vehicleType: "car" | "motorcycle";
  msrp: number;
  engine: string;
  horsepower?: number | string | null;
  torque: string;
  transmission: string;
  drivetrain: string;
  mpgOrRange: string;
  colors: string[];
};

type BackendValuation = {
  id: string;
  vehicleId: string;
  zip: string;
  mileage: number;
  condition: string;
  status?:
    | "loaded_condition_set"
    | "loaded_value"
    | "loaded_listing_range"
    | "no_comps_found"
    | "provider_error"
    | "ready_to_load"
    | "specialty_unavailable";
  baseCondition?: "fair" | "good" | "excellent" | null;
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
  valuationSource?: "provider" | "cache" | "listing_comps" | "unavailable" | null;
  compCount?: number | null;
  confidence?: "high" | "moderate" | "limited" | "unavailable" | null;
  rangeLow?: number | null;
  rangeHigh?: number | null;
  midpoint?: number | null;
  unavailableReason?: string | null;
  message?: string | null;
  reason?: string | null;
  sourceBasis?: "provider_direct" | "listing_median_adjusted" | "modeled_condition_adjusted" | null;
  modelType?: "provider_range" | "listing_derived" | "modeled" | "specialty_unavailable";
  listingCount?: number | null;
};

type BackendListing = {
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

export type ListingsDebugMeta = {
  sourceLabel?: string | null;
  rawCount?: number;
  believableCount?: number;
  mode?: "exact_trim" | "same_model_mixed_trims" | "adjacent_year_mixed_trims" | "generation_fallback" | "similar_vehicle_fallback" | "none";
  fallbackReason?: string | null;
};

export type ListingsResultEnvelope = {
  listings: ListingResult[];
  meta: ListingsDebugMeta | null;
};

type ValueRequestOptions = {
  allowLive?: boolean;
  fetchReason?: string;
  sourceScreen?: string;
  action?: string;
  forceLive?: boolean;
  zipSource?: MarketAreaZipSource;
};

type ListingsRequestOptions = {
  allowLive?: boolean;
  fetchReason?: string;
  sourceScreen?: string;
  action?: string;
  radiusMiles?: number;
  mileage?: string | number;
  zipSource?: MarketAreaZipSource;
};

function defaultOverview(vehicle: BackendVehicle) {
  if (isSpecialtyExoticMake(vehicle.make)) {
    return buildSpecialtyVehicleOverview({
      make: vehicle.make,
      model: vehicle.model,
      bodyStyle: vehicle.bodyStyle,
    });
  }
  return `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim} with original powertrain, pricing, and specification data.`;
}

function isPositiveMarketNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatOptionalCurrency(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? formatCurrency(value) : "Unavailable";
}

function formatOptionalComparableRange(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? formatCurrency(value) : null;
}

function mapConditionValues(conditionValues: BackendValuation["conditionValues"]) {
  if (!conditionValues) {
    return null;
  }

  return {
    fair: {
      tradeIn: formatOptionalCurrency(conditionValues.fair.tradeIn),
      privateParty: formatOptionalCurrency(conditionValues.fair.privateParty),
      dealerRetail: formatOptionalCurrency(conditionValues.fair.dealerRetail),
      low: formatOptionalComparableRange(conditionValues.fair.low),
      median: formatOptionalComparableRange(conditionValues.fair.median),
      high: formatOptionalComparableRange(conditionValues.fair.high),
    },
    good: {
      tradeIn: formatOptionalCurrency(conditionValues.good.tradeIn),
      privateParty: formatOptionalCurrency(conditionValues.good.privateParty),
      dealerRetail: formatOptionalCurrency(conditionValues.good.dealerRetail),
      low: formatOptionalComparableRange(conditionValues.good.low),
      median: formatOptionalComparableRange(conditionValues.good.median),
      high: formatOptionalComparableRange(conditionValues.good.high),
    },
    excellent: {
      tradeIn: formatOptionalCurrency(conditionValues.excellent.tradeIn),
      privateParty: formatOptionalCurrency(conditionValues.excellent.privateParty),
      dealerRetail: formatOptionalCurrency(conditionValues.excellent.dealerRetail),
      low: formatOptionalComparableRange(conditionValues.excellent.low),
      median: formatOptionalComparableRange(conditionValues.excellent.median),
      high: formatOptionalComparableRange(conditionValues.excellent.high),
    },
  };
}

function mapValuation(valuation: BackendValuation): ValuationResult {
  const hasListingConditionSet =
    valuation.conditionValues != null &&
    Object.values(valuation.conditionValues).some((entry) =>
      [entry.tradeIn, entry.privateParty, entry.dealerRetail, entry.low, entry.median, entry.high].some(isPositiveMarketNumber),
    );
  const hasListingRange =
    isPositiveMarketNumber(valuation.low) ||
    isPositiveMarketNumber(valuation.median) ||
    isPositiveMarketNumber(valuation.high) ||
    isPositiveMarketNumber(valuation.privatePartyLow) ||
    isPositiveMarketNumber(valuation.privatePartyHigh) ||
    isPositiveMarketNumber(valuation.tradeInLow) ||
    isPositiveMarketNumber(valuation.tradeInHigh) ||
    isPositiveMarketNumber(valuation.dealerRetailLow) ||
    isPositiveMarketNumber(valuation.dealerRetailHigh);
  const status =
    (valuation.status === "no_comps_found" || valuation.status === "provider_error" || valuation.status === "ready_to_load") &&
    hasListingConditionSet
      ? "loaded_condition_set"
      : (valuation.status === "no_comps_found" || valuation.status === "provider_error" || valuation.status === "ready_to_load") &&
          hasListingRange
        ? "loaded_listing_range"
        : valuation.status ??
          (hasListingConditionSet
            ? "loaded_condition_set"
            : valuation.modelType === "listing_derived" || hasListingRange
      ? "loaded_listing_range"
      : valuation.modelType === "specialty_unavailable"
        ? "specialty_unavailable"
        : typeof valuation.tradeIn === "number" || typeof valuation.privateParty === "number" || typeof valuation.dealerRetail === "number"
          ? "loaded_value"
          : "ready_to_load");

  if (status === "loaded_condition_set") {
    const result: ValuationResult = {
      status,
      selectedCondition: valuation.baseCondition ?? "good",
      baseCondition: valuation.baseCondition ?? "good",
      conditionValues: mapConditionValues(valuation.conditionValues),
      tradeIn: formatOptionalCurrency(valuation.tradeIn),
      tradeInRange: "Condition-adjusted estimate",
      privateParty: formatOptionalCurrency(valuation.privateParty),
      privatePartyRange: "Condition-adjusted estimate",
      dealerRetail: formatOptionalCurrency(valuation.dealerRetail),
      dealerRetailRange: "Condition-adjusted estimate",
      low: formatOptionalComparableRange(valuation.low),
      high: formatOptionalComparableRange(valuation.high),
      median: formatOptionalComparableRange(valuation.median),
      confidenceLabel:
        valuation.confidenceLabel ??
        "Based on live MarketCheck listings. Condition-adjusted estimate.",
      sourceLabel: valuation.sourceLabel ?? "MarketCheck live market value",
      valuationSource: valuation.valuationSource ?? "listing_comps",
      compCount: valuation.compCount ?? valuation.listingCount ?? null,
      confidence: valuation.confidence ?? (valuation.listingCount != null && valuation.listingCount <= 2 ? "limited" : "moderate"),
      rangeLow: formatOptionalComparableRange(valuation.rangeLow ?? valuation.low),
      rangeHigh: formatOptionalComparableRange(valuation.rangeHigh ?? valuation.high),
      midpoint: formatOptionalComparableRange(valuation.midpoint ?? valuation.median),
      unavailableReason: valuation.unavailableReason ?? null,
      message: valuation.message ?? null,
      reason: valuation.reason ?? null,
      listingCount: valuation.listingCount ?? null,
      sourceBasis: valuation.sourceBasis ?? null,
      modelType: valuation.modelType ?? "modeled",
    };
    return resolveConditionValues(result, valuation.baseCondition ?? "good");
  }

  if (status === "loaded_listing_range") {
    const low = valuation.low ?? valuation.privatePartyLow ?? valuation.tradeInLow ?? valuation.dealerRetailLow ?? null;
    const high = valuation.high ?? valuation.privatePartyHigh ?? valuation.tradeInHigh ?? valuation.dealerRetailHigh ?? null;
    const median = valuation.median ?? valuation.privateParty ?? null;
    return {
      status,
      tradeIn: "Unavailable",
      tradeInRange: "Unavailable",
      privateParty: "Unavailable",
      privatePartyRange: "Unavailable",
      dealerRetail: "Unavailable",
      dealerRetailRange: "Unavailable",
      low: typeof low === "number" ? formatCurrency(low) : null,
      high: typeof high === "number" ? formatCurrency(high) : null,
      median: typeof median === "number" ? formatCurrency(median) : null,
      confidenceLabel: valuation.confidenceLabel ?? "Comparable market listings found",
      sourceLabel: valuation.sourceLabel ?? "Listing-derived market range",
      valuationSource: valuation.valuationSource ?? "listing_comps",
      compCount: valuation.compCount ?? valuation.listingCount ?? null,
      confidence: valuation.confidence ?? (valuation.listingCount != null && valuation.listingCount <= 2 ? "limited" : "moderate"),
      rangeLow: typeof (valuation.rangeLow ?? low) === "number" ? formatCurrency((valuation.rangeLow ?? low) as number) : null,
      rangeHigh: typeof (valuation.rangeHigh ?? high) === "number" ? formatCurrency((valuation.rangeHigh ?? high) as number) : null,
      midpoint: typeof (valuation.midpoint ?? median) === "number" ? formatCurrency((valuation.midpoint ?? median) as number) : null,
      unavailableReason: valuation.unavailableReason ?? null,
      message: valuation.message ?? null,
      reason: valuation.reason ?? null,
      listingCount: valuation.listingCount ?? null,
      conditionValues: null,
      selectedCondition: null,
      baseCondition: null,
      sourceBasis: valuation.sourceBasis ?? null,
      modelType: "listing_derived",
    };
  }

  if (status !== "loaded_value") {
    return {
      status,
      tradeIn: "Unavailable",
      tradeInRange: "Unavailable",
      privateParty: "Unavailable",
      privatePartyRange: "Unavailable",
      dealerRetail: "Unavailable",
      dealerRetailRange: "Unavailable",
      low: null,
      high: null,
      median: null,
      confidenceLabel:
        valuation.confidenceLabel ??
        (status === "provider_error"
          ? "Live market data could not be loaded."
          : status === "no_comps_found"
            ? "No live market comps found for this ZIP, mileage, and condition."
            : status === "specialty_unavailable"
              ? "Load live market value. Collector-market pricing can vary widely by mileage, condition, options, service history, and provenance."
              : "Load live market value when you want current local pricing."),
      sourceLabel:
        valuation.sourceLabel ??
        (status === "provider_error"
          ? "Live market data could not be loaded"
          : status === "no_comps_found"
            ? "No live market comps found"
            : status === "specialty_unavailable"
              ? "Specialty market value unavailable"
              : "Live market value available on demand"),
      valuationSource: valuation.valuationSource ?? "unavailable",
      compCount: valuation.compCount ?? valuation.listingCount ?? null,
      confidence: valuation.confidence ?? "unavailable",
      rangeLow: null,
      rangeHigh: null,
      midpoint: null,
      unavailableReason: valuation.unavailableReason ?? valuation.reason ?? null,
      message: valuation.message ?? null,
      reason: valuation.reason ?? null,
      listingCount: valuation.listingCount ?? null,
      conditionValues: null,
      selectedCondition: null,
      baseCondition: null,
      sourceBasis: valuation.sourceBasis ?? null,
      modelType: status === "specialty_unavailable" ? "specialty_unavailable" : "modeled",
    };
  }

  const tradeInLow = valuation.tradeInLow ?? valuation.tradeIn;
  const tradeInHigh = valuation.tradeInHigh ?? valuation.tradeIn;
  const privateLow = valuation.privatePartyLow ?? valuation.privateParty;
  const privateHigh = valuation.privatePartyHigh ?? valuation.privateParty;
  const retailLow = valuation.dealerRetailLow ?? valuation.dealerRetail;
  const retailHigh = valuation.dealerRetailHigh ?? valuation.dealerRetail;
  const hasPositiveLoadedValue =
    isPositiveMarketNumber(valuation.tradeIn) ||
    isPositiveMarketNumber(valuation.privateParty) ||
    isPositiveMarketNumber(valuation.dealerRetail);

  if (!hasPositiveLoadedValue) {
    return {
      status: valuation.reason === "provider_timeout" || valuation.reason === "provider_error" ? "provider_error" : "no_comps_found",
      tradeIn: "Unavailable",
      tradeInRange: "Unavailable",
      privateParty: "Unavailable",
      privatePartyRange: "Unavailable",
      dealerRetail: "Unavailable",
      dealerRetailRange: "Unavailable",
      low: null,
      high: null,
      median: null,
      confidenceLabel:
        valuation.confidenceLabel ??
        (valuation.reason === "provider_timeout" || valuation.reason === "provider_error"
          ? "Live market data could not be loaded."
          : "No live market comps found for this ZIP, mileage, and condition."),
      sourceLabel:
        valuation.sourceLabel ??
        (valuation.reason === "provider_timeout" || valuation.reason === "provider_error"
          ? "Live market data could not be loaded"
          : "No live market comps found"),
      valuationSource: valuation.valuationSource ?? "unavailable",
      compCount: valuation.compCount ?? valuation.listingCount ?? null,
      confidence: valuation.confidence ?? "unavailable",
      rangeLow: null,
      rangeHigh: null,
      midpoint: null,
      unavailableReason: valuation.unavailableReason ?? valuation.reason ?? null,
      message:
        valuation.message ??
        (valuation.reason === "provider_timeout" || valuation.reason === "provider_error"
          ? "Live market data could not be loaded."
          : "No live market comps found for this ZIP, mileage, and condition."),
      reason: valuation.reason ?? null,
      listingCount: valuation.listingCount ?? null,
      conditionValues: null,
      selectedCondition: null,
      baseCondition: null,
      sourceBasis: valuation.sourceBasis ?? null,
      modelType: "modeled",
    };
  }

  return {
    status,
    tradeIn: formatCurrency(valuation.tradeIn as number),
    tradeInRange: `${formatCurrency(tradeInLow as number)} - ${formatCurrency(tradeInHigh as number)}`,
    privateParty: formatCurrency(valuation.privateParty as number),
    privatePartyRange: `${formatCurrency(privateLow as number)} - ${formatCurrency(privateHigh as number)}`,
    dealerRetail: formatCurrency(valuation.dealerRetail as number),
    dealerRetailRange: `${formatCurrency(retailLow as number)} - ${formatCurrency(retailHigh as number)}`,
    low: null,
    high: null,
    median: null,
    confidenceLabel:
      valuation.confidenceLabel ??
      `Based on ${valuation.condition.replace("_", " ")} condition at ${valuation.mileage.toLocaleString("en-US")} miles`,
    sourceLabel: valuation.sourceLabel ?? "Modeled estimate",
    valuationSource: valuation.valuationSource ?? "provider",
    compCount: valuation.compCount ?? valuation.listingCount ?? null,
    confidence: valuation.confidence ?? "moderate",
    rangeLow: null,
    rangeHigh: null,
    midpoint: null,
    unavailableReason: valuation.unavailableReason ?? null,
    message: valuation.message ?? null,
    reason: valuation.reason ?? null,
    listingCount: valuation.listingCount ?? null,
    conditionValues: null,
    selectedCondition: null,
    baseCondition: null,
    sourceBasis: valuation.sourceBasis ?? null,
    modelType: valuation.modelType ?? "modeled",
  };
}

function mapListings(listings: BackendListing[]): ListingResult[] {
  return listings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    price: formatCurrency(listing.price),
    mileage: `${listing.mileage.toLocaleString("en-US")} mi`,
    dealer: listing.dealer,
    distance: `${listing.distanceMiles} mi`,
    location: listing.location,
    imageUrl: listing.imageUrl,
  }));
}

function createEmptyValuation(): ValuationResult {
  return {
    status: "ready_to_load",
    selectedCondition: null,
    baseCondition: null,
    conditionValues: null,
    tradeIn: "Unavailable",
    tradeInRange: "Unavailable",
    privateParty: "Unavailable",
    privatePartyRange: "Unavailable",
    dealerRetail: "Unavailable",
    dealerRetailRange: "Unavailable",
    low: null,
    high: null,
    median: null,
    confidenceLabel: "Enter ZIP, mileage, and condition, then load live market value.",
    sourceLabel: "Live market value available on demand",
    valuationSource: "unavailable",
    compCount: null,
    confidence: "unavailable",
    rangeLow: null,
    rangeHigh: null,
    midpoint: null,
    unavailableReason: null,
    message: null,
    reason: null,
    listingCount: null,
    sourceBasis: null,
    modelType: "modeled",
  };
}

function mapResolvedSpecsVehicle(vehicle: BackendResolvedVehicle): VehicleRecord {
  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    bodyStyle: vehicle.bodyStyle,
    heroImage: getVehicleImage(vehicle.id, vehicle.vehicleType),
    overview: defaultOverview({
      ...vehicle,
      imageUrl: null,
      heroImage: null,
      defaultImageUrl: null,
      providerImageUrl: null,
      hp: null,
      engine_hp: null,
    } as BackendVehicle),
    specs: {
      engine: vehicle.engine || "Unknown",
      horsepower: resolveHorsepower(vehicle.horsepower, null, null, vehicle.engine, null),
      torque: vehicle.torque || "Unknown",
      transmission: vehicle.transmission || "Unknown",
      drivetrain: vehicle.drivetrain || "Unknown",
      mpgOrRange: vehicle.mpgOrRange || "Unknown",
      exteriorColors: vehicle.colors ?? [],
      msrp: vehicle.msrp || 0,
    },
    valuation: createEmptyValuation(),
    listings: [],
  };
}

function buildVehicleLookupParams(input: VehicleLookupInput) {
  const params = new URLSearchParams();
  if (typeof input === "string") {
    params.set("vehicleId", input);
    return params;
  }

  if (typeof input.vehicleId === "string" && input.vehicleId.trim().length > 0) {
    params.set("vehicleId", input.vehicleId.trim());
  }

  if (input.descriptor) {
    params.set("year", String(input.descriptor.year));
    params.set("make", input.descriptor.make);
    params.set("model", input.descriptor.model);
    if (input.descriptor.trim) params.set("trim", input.descriptor.trim);
    if (input.descriptor.vehicleType) params.set("vehicleType", input.descriptor.vehicleType);
    if (input.descriptor.bodyStyle) params.set("bodyStyle", input.descriptor.bodyStyle);
    if (input.descriptor.normalizedModel) params.set("normalizedModel", input.descriptor.normalizedModel);
  }

  return params;
}

function pickFirstNonEmptyString(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function resolveVehicleHeroImage(
  vehicle: BackendVehicle,
  fallbackRecord?: VehicleRecord | null,
  listings?: BackendListing[],
) {
  const liveExactImage = pickFirstNonEmptyString(vehicle.imageUrl, vehicle.heroImage);
  const canonicalExactImage = pickFirstNonEmptyString(fallbackRecord?.heroImage);
  const providerMatchedImage = pickFirstNonEmptyString(vehicle.providerImageUrl, vehicle.defaultImageUrl, listings?.[0]?.imageUrl);
  const genericImage = getVehicleImage(vehicle.id, vehicle.vehicleType);

  const heroImage = liveExactImage ?? canonicalExactImage ?? providerMatchedImage ?? genericImage;
  console.log("[vehicle-service] EXACT_HIT_IMAGE_SELECTION", {
    vehicleId: vehicle.id,
    liveExactImage: liveExactImage ?? null,
    canonicalExactImage: canonicalExactImage ?? null,
    providerMatchedImage: providerMatchedImage ?? null,
    selectedSource:
      heroImage === liveExactImage
        ? "exact-live"
        : heroImage === canonicalExactImage
          ? "exact-canonical"
          : heroImage === providerMatchedImage
            ? "exact-provider"
            : "generic-fallback",
  });
  return heroImage;
}

function resolveVehicleHorsepower(vehicle: BackendVehicle, fallbackRecord?: VehicleRecord | null) {
  const parsedHorsepower = resolveHorsepower(
    vehicle.horsepower,
    vehicle.hp,
    vehicle.engine_hp,
    vehicle.engine,
    fallbackRecord?.specs.horsepower,
  );
  console.log("[vehicle-service] HORSEPOWER_MAPPING", {
    vehicleId: vehicle.id,
    rawHorsepowerFields: {
      horsepower: vehicle.horsepower ?? null,
      hp: vehicle.hp ?? null,
      engine_hp: vehicle.engine_hp ?? null,
      engine: vehicle.engine ?? null,
      fallbackHorsepower: fallbackRecord?.specs.horsepower ?? null,
    },
    parsedHorsepower,
  });
  return parsedHorsepower;
}

async function resolveExactFallbackRecord(vehicle: BackendVehicle, offlineVehicleById?: VehicleRecord | null) {
  if (offlineVehicleById) {
    return offlineVehicleById;
  }

  const grounding = await offlineCanonicalService.resolveVehiclePresentation({
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    vehicleType: vehicle.vehicleType,
  });

  if (!grounding?.vehicle) {
    return null;
  }

  return offlineCanonicalService.mapToVehicleRecord(grounding.vehicle);
}

function mapVehicle(
  vehicle: BackendVehicle,
  valuation?: BackendValuation | null,
  listings?: BackendListing[],
  fallbackRecord?: VehicleRecord | null,
): VehicleRecord {
  const mappedListings = listings ? mapListings(listings) : [];
  const parsedHorsepower = resolveVehicleHorsepower(vehicle, fallbackRecord);
  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    bodyStyle: vehicle.bodyStyle,
    heroImage: resolveVehicleHeroImage(vehicle, fallbackRecord, listings),
    overview: defaultOverview(vehicle),
    specs: {
      engine: vehicle.engine || fallbackRecord?.specs.engine || "Unknown",
      horsepower: parsedHorsepower,
      torque: vehicle.torque || fallbackRecord?.specs.torque || "Unknown",
      transmission: vehicle.transmission || fallbackRecord?.specs.transmission || "Unknown",
      drivetrain: vehicle.drivetrain || fallbackRecord?.specs.drivetrain || "Unknown",
      mpgOrRange: vehicle.mpgOrRange || fallbackRecord?.specs.mpgOrRange || "Unknown",
      exteriorColors: vehicle.colors?.length ? vehicle.colors : fallbackRecord?.specs.exteriorColors ?? [],
      msrp: vehicle.msrp || fallbackRecord?.specs.msrp || 0,
    },
    valuation: valuation ? mapValuation(valuation) : createEmptyValuation(),
    listings: mappedListings,
  };
}

export const vehicleService = {
  async getOfflineVehicleById(id: string): Promise<VehicleRecord | undefined> {
    const offline = await offlineCanonicalService.findById(id);
    return offline ? offlineCanonicalService.mapToVehicleRecord(offline) : undefined;
  },

  async getVehicleById(id: string): Promise<VehicleRecord | undefined> {
    const offlineVehicleById = await this.getOfflineVehicleById(id);
    try {
      const vehicle = await apiRequest<BackendVehicle>({
        path: `/api/vehicle/specs?vehicleId=${encodeURIComponent(id)}`,
        authRequired: false,
      });
      const exactFallbackRecord = await resolveExactFallbackRecord(vehicle, offlineVehicleById ?? null);
      return mapVehicle(vehicle, null, [], exactFallbackRecord ?? null);
    } catch (error) {
      if (offlineVehicleById) {
        console.warn("[vehicle-service] exact-hit detail falling back to offline canonical record", {
          vehicleId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return offlineVehicleById;
      }

      throw error;
    }
  },

  async searchVehicles(query: VehicleSearchQuery): Promise<VehicleRecord[]> {
    const params = new URLSearchParams();
    if (query.year) params.set("year", query.year);
    if (query.make) params.set("make", query.make);
    if (query.model) params.set("model", query.model);

    const vehicles = await apiRequest<BackendVehicle[]>({
      path: `/api/vehicle/search?${params.toString()}`,
      authRequired: false,
    });

    return Promise.all(
      vehicles.map(async (vehicle) => {
        const grounding = await offlineCanonicalService.resolveVehiclePresentation({
          id: vehicle.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim,
          vehicleType: vehicle.vehicleType,
        });
        const fallbackRecord = grounding?.vehicle ? offlineCanonicalService.mapToVehicleRecord(grounding.vehicle) : null;
        return mapVehicle(vehicle, null, undefined, fallbackRecord);
      }),
    );
  },

  async getValue(
    vehicleLookup: VehicleLookupInput,
    zip: string,
    mileage: string,
    condition: string,
    options?: ValueRequestOptions,
  ): Promise<ValuationResult> {
    const path = buildVehicleValueRequestPath(vehicleLookup, zip, mileage, condition, options);
    console.log("[vehicle-service] VALUE_REQUEST_PARAMS", {
      vehicleLookup,
      zip,
      mileage,
      condition,
      options: options ?? null,
      path,
    });
    console.log("[vehicle-service] VALUE_LIVE_REFRESH_REQUEST_SENT", {
      vehicleLookup,
      allowLive: options?.allowLive ?? null,
      fetchReason: options?.fetchReason ?? null,
      sourceScreen: options?.sourceScreen ?? null,
      action: options?.action ?? null,
      forceLive: options?.forceLive ?? null,
      zipSource: options?.zipSource ?? null,
      path,
    });
    const response = await apiRequestEnvelope<BackendValuation>({
      path,
      authRequired: false,
    });
    console.log("[vehicle-service] VALUE_RESPONSE_RECEIVED", {
      vehicleLookup,
      condition,
      source: response.meta?.source,
      requestId: response.requestId,
      value: response.data,
    });
    return mapValuation(response.data);
  },

  async getSpecsByLookup(vehicleLookup: VehicleLookupInput): Promise<VehicleRecord | null> {
    const params = buildVehicleLookupParams(vehicleLookup);
    const path = `/api/vehicle/specs?${params.toString()}`;
    console.log("[vehicle-service] SPECS_REQUEST_PARAMS", {
      vehicleLookup,
      path,
    });
    const response = await apiRequestEnvelope<BackendResolvedVehicle>({
      path,
      authRequired: false,
    });
    console.log("[vehicle-service] SPECS_RESPONSE_RECEIVED", {
      vehicleLookup,
      requestId: response.requestId,
      source: response.meta?.source,
      vehicleId: response.data?.id ?? null,
    });
    return response.data ? mapResolvedSpecsVehicle(response.data) : null;
  },

  async getListings(
    vehicleLookup: VehicleLookupInput,
    zip: string,
    options?: ListingsRequestOptions,
  ): Promise<ListingsResultEnvelope> {
    const path = buildVehicleListingsRequestPath(vehicleLookup, zip, options);
    console.log("[vehicle-service] LISTINGS_REQUEST_PARAMS", {
      vehicleLookup,
      zip,
      options: options ?? null,
      path,
    });
    const response = await apiRequestEnvelope<BackendListing[], ListingsDebugMeta>({
      path,
      authRequired: false,
    });
    const listings = response.data;
    console.log("[vehicle-service] LISTINGS_RESPONSE_RECEIVED", {
      vehicleLookup,
      zip,
      count: listings.length,
      sample: listings[0] ?? null,
      meta: response.meta ?? null,
    });
    return {
      listings: mapListings(listings),
      meta: response.meta ?? null,
    };
  },
};

export function buildVehicleValueRequestPath(
  vehicleLookup: VehicleLookupInput,
  zip: string,
  mileage: string,
  condition: string,
  options?: ValueRequestOptions,
) {
  const params = buildVehicleLookupParams(vehicleLookup);
  params.set("zip", zip);
  params.set("mileage", mileage);
  params.set("condition", condition);
  if (typeof options?.allowLive === "boolean") {
    params.set("allowLive", options.allowLive ? "true" : "false");
  }
  if (typeof options?.fetchReason === "string" && options.fetchReason.trim().length > 0) {
    params.set("fetchReason", options.fetchReason.trim());
  }
  if (typeof options?.sourceScreen === "string" && options.sourceScreen.trim().length > 0) {
    params.set("sourceScreen", options.sourceScreen.trim());
  }
  if (typeof options?.action === "string" && options.action.trim().length > 0) {
    params.set("action", options.action.trim());
  }
  if (typeof options?.forceLive === "boolean") {
    params.set("forceLive", options.forceLive ? "true" : "false");
  }
  if (typeof options?.zipSource === "string" && options.zipSource.length > 0) {
    params.set("zipSource", options.zipSource);
  }
  return `/api/vehicle/value?${params.toString()}`;
}

export function buildVehicleListingsRequestPath(
  vehicleLookup: VehicleLookupInput,
  zip: string,
  options?: ListingsRequestOptions,
) {
  const params = buildVehicleLookupParams(vehicleLookup);
  params.set("zip", zip);
  params.set("radiusMiles", String(options?.radiusMiles ?? 50));
  if (typeof options?.allowLive === "boolean") {
    params.set("allowLive", options.allowLive ? "true" : "false");
  }
  if (typeof options?.fetchReason === "string" && options.fetchReason.trim().length > 0) {
    params.set("fetchReason", options.fetchReason.trim());
  }
  if (typeof options?.sourceScreen === "string" && options.sourceScreen.trim().length > 0) {
    params.set("sourceScreen", options.sourceScreen.trim());
  }
  if (typeof options?.action === "string" && options.action.trim().length > 0) {
    params.set("action", options.action.trim());
  }
  if (typeof options?.zipSource === "string" && options.zipSource.length > 0) {
    params.set("zipSource", options.zipSource);
  }
  if (options?.mileage != null && String(options.mileage).trim().length > 0) {
    params.set("mileage", String(options.mileage).trim());
  }
  return `/api/vehicle/listings?${params.toString()}`;
}
