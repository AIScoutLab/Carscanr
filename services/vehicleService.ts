import { formatCurrency } from "@/lib/utils";
import { resolveHorsepower } from "@/lib/vehicleData";
import { getVehicleImage } from "@/constants/vehicleImages";
import { apiRequest, apiRequestEnvelope } from "@/services/apiClient";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
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
  tradeIn: number;
  tradeInLow?: number;
  tradeInHigh?: number;
  privateParty: number;
  privatePartyLow?: number;
  privatePartyHigh?: number;
  dealerRetail: number;
  dealerRetailLow?: number;
  dealerRetailHigh?: number;
  currency: "USD";
  generatedAt: string;
  sourceLabel?: string;
  confidenceLabel?: string;
  modelType?: "provider_range" | "listing_derived" | "modeled";
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

function defaultOverview(vehicle: BackendVehicle) {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim} with original powertrain, pricing, and specification data.`;
}

function mapValuation(valuation: BackendValuation): ValuationResult {
  const tradeInLow = valuation.tradeInLow ?? valuation.tradeIn;
  const tradeInHigh = valuation.tradeInHigh ?? valuation.tradeIn;
  const privateLow = valuation.privatePartyLow ?? valuation.privateParty;
  const privateHigh = valuation.privatePartyHigh ?? valuation.privateParty;
  const retailLow = valuation.dealerRetailLow ?? valuation.dealerRetail;
  const retailHigh = valuation.dealerRetailHigh ?? valuation.dealerRetail;
  return {
    tradeIn: formatCurrency(valuation.tradeIn),
    tradeInRange: `${formatCurrency(tradeInLow)} - ${formatCurrency(tradeInHigh)}`,
    privateParty: formatCurrency(valuation.privateParty),
    privatePartyRange: `${formatCurrency(privateLow)} - ${formatCurrency(privateHigh)}`,
    dealerRetail: formatCurrency(valuation.dealerRetail),
    dealerRetailRange: `${formatCurrency(retailLow)} - ${formatCurrency(retailHigh)}`,
    confidenceLabel:
      valuation.confidenceLabel ??
      `Based on ${valuation.condition.replace("_", " ")} condition at ${valuation.mileage.toLocaleString("en-US")} miles`,
    sourceLabel: valuation.sourceLabel ?? "Modeled estimate",
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
    tradeIn: "Unavailable",
    tradeInRange: "Unavailable",
    privateParty: "Unavailable",
    privatePartyRange: "Unavailable",
    dealerRetail: "Unavailable",
    dealerRetailRange: "Unavailable",
    confidenceLabel: "Live valuation unavailable",
    sourceLabel: "No live value source",
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
      const [valuation, listings] = await Promise.all([
        apiRequest<BackendValuation>({
          path: `/api/vehicle/value?vehicleId=${encodeURIComponent(id)}&zip=60610&mileage=25000&condition=good`,
          authRequired: false,
        }).catch(() => null),
        apiRequest<BackendListing[]>({
          path: `/api/vehicle/listings?vehicleId=${encodeURIComponent(id)}&zip=60610&radiusMiles=50`,
          authRequired: false,
        }).catch(() => []),
      ]);

      return mapVehicle(vehicle, valuation, listings, exactFallbackRecord ?? null);
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

  async getValue(vehicleLookup: VehicleLookupInput, zip: string, mileage: string, condition: string): Promise<ValuationResult> {
    const params = buildVehicleLookupParams(vehicleLookup);
    params.set("zip", zip);
    params.set("mileage", mileage);
    params.set("condition", condition);
    const path = `/api/vehicle/value?${params.toString()}`;
    console.log("[vehicle-service] VALUE_REQUEST_PARAMS", {
      vehicleLookup,
      zip,
      mileage,
      condition,
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

  async getListings(vehicleLookup: VehicleLookupInput, zip: string): Promise<ListingsResultEnvelope> {
    const params = buildVehicleLookupParams(vehicleLookup);
    params.set("zip", zip);
    params.set("radiusMiles", "50");
    const path = `/api/vehicle/listings?${params.toString()}`;
    console.log("[vehicle-service] LISTINGS_REQUEST_PARAMS", {
      vehicleLookup,
      zip,
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
