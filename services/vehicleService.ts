import { formatCurrency } from "@/lib/utils";
import { getVehicleImage } from "@/constants/vehicleImages";
import { apiRequest } from "@/services/apiClient";
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
  privateParty: number;
  dealerRetail: number;
  currency: "USD";
  generatedAt: string;
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
  return {
    tradeIn: formatCurrency(valuation.tradeIn),
    privateParty: formatCurrency(valuation.privateParty),
    dealerRetail: formatCurrency(valuation.dealerRetail),
    confidenceLabel: `Based on ${valuation.condition.replace("_", " ")} condition at ${valuation.mileage.toLocaleString("en-US")} miles`,
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
    privateParty: "Unavailable",
    dealerRetail: "Unavailable",
    confidenceLabel: "Live valuation unavailable",
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
    const valuation = await apiRequest<BackendValuation>({
      path: `/api/vehicle/value?vehicleId=${encodeURIComponent(vehicleId)}&zip=${encodeURIComponent(zip)}&mileage=${encodeURIComponent(mileage)}&condition=${encodeURIComponent(condition)}`,
      authRequired: false,
    });
    return mapValuation(valuation);
  },

  async getListings(vehicleId: string, zip: string): Promise<ListingResult[]> {
    const listings = await apiRequest<BackendListing[]>({
      path: `/api/vehicle/listings?vehicleId=${encodeURIComponent(vehicleId)}&zip=${encodeURIComponent(zip)}&radiusMiles=50`,
      authRequired: false,
    });
    return mapListings(listings);
  },
};
