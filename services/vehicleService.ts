import { formatCurrency } from "@/lib/utils";
import { getVehicleImage } from "@/constants/vehicleImages";
import { apiRequest, apiRequestEnvelope } from "@/services/apiClient";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { ListingResult, ValuationResult, VehicleRecord, VehicleSearchQuery } from "@/types";

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
  horsepower: number;
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

function mapVehicle(vehicle: BackendVehicle, valuation?: BackendValuation | null, listings?: BackendListing[]): VehicleRecord {
  const mappedListings = listings ? mapListings(listings) : [];
  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    bodyStyle: vehicle.bodyStyle,
    heroImage: mappedListings[0]?.imageUrl ?? getVehicleImage(vehicle.id, vehicle.vehicleType),
    overview: defaultOverview(vehicle),
    specs: {
      engine: vehicle.engine,
      horsepower: vehicle.horsepower,
      torque: vehicle.torque,
      transmission: vehicle.transmission,
      drivetrain: vehicle.drivetrain,
      mpgOrRange: vehicle.mpgOrRange,
      exteriorColors: vehicle.colors,
      msrp: vehicle.msrp,
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
    const [vehicle, valuation, listings] = await Promise.all([
      apiRequest<BackendVehicle>({
        path: `/api/vehicle/specs?vehicleId=${encodeURIComponent(id)}`,
        authRequired: false,
      }),
      apiRequest<BackendValuation>({
        path: `/api/vehicle/value?vehicleId=${encodeURIComponent(id)}&zip=60610&mileage=25000&condition=good`,
        authRequired: false,
      }).catch(() => null),
      apiRequest<BackendListing[]>({
        path: `/api/vehicle/listings?vehicleId=${encodeURIComponent(id)}&zip=60610&radiusMiles=50`,
        authRequired: false,
      }).catch(() => []),
    ]);

    return mapVehicle(vehicle, valuation, listings);
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

    return vehicles.map((vehicle) => mapVehicle(vehicle));
  },

  async getValue(vehicleId: string, zip: string, mileage: string, condition: string): Promise<ValuationResult> {
    const path = `/api/vehicle/value?vehicleId=${encodeURIComponent(vehicleId)}&zip=${encodeURIComponent(zip)}&mileage=${encodeURIComponent(mileage)}&condition=${encodeURIComponent(condition)}`;
    console.log("[vehicle-service] VALUE_REQUEST_PARAMS", {
      vehicleId,
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
      vehicleId,
      condition,
      source: response.meta?.source,
      requestId: response.requestId,
      value: response.data,
    });
    return mapValuation(response.data);
  },

  async getListings(vehicleId: string, zip: string): Promise<ListingResult[]> {
    const listings = await apiRequest<BackendListing[]>({
      path: `/api/vehicle/listings?vehicleId=${encodeURIComponent(vehicleId)}&zip=${encodeURIComponent(zip)}&radiusMiles=50`,
      authRequired: false,
    });
    return mapListings(listings);
  },
};
