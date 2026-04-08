import { seedListings, seedVehicles } from "../../data/seedVehicles.js";
import { getVehicleImage } from "../../lib/vehicleImages.js";
import { ListingRecord } from "../../types/domain.js";
import { VehicleListingsProvider } from "../interfaces.js";

function getFallbackImageUrl(vehicle: {
  id: string;
  make: string;
  model: string;
  vehicleType?: "car" | "motorcycle";
}) {
  if (vehicle.id === "2021-yamaha-yzf-r3-standard") {
    return getVehicleImage(vehicle.id, "motorcycle");
  }

  if (vehicle.vehicleType === "motorcycle") {
    return getVehicleImage(vehicle.id, "motorcycle");
  }

  return getVehicleImage(vehicle.id, "car");
}

export class MockVehicleListingsProvider implements VehicleListingsProvider {
  async getListings(input: {
    vehicleId: string;
    vehicle?: { id: string; year: number; make: string; model: string; trim: string; msrp: number; vehicleType?: "car" | "motorcycle" } | null;
    zip: string;
    radiusMiles: number;
  }): Promise<ListingRecord[]> {
    const matched = seedListings.filter(
      (listing) => listing.vehicleId === input.vehicleId && listing.distanceMiles <= input.radiusMiles,
    );

    if (matched.length > 0) return matched;

    const vehicle = input.vehicle ?? seedVehicles.find((entry) => entry.id === input.vehicleId);
    if (!vehicle) return [];

    return [
      {
        id: `listing-${vehicle.id}-fallback`,
        vehicleId: vehicle.id,
        title: `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}`,
        price: Math.round(vehicle.msrp * 0.83),
        mileage: 18240,
        dealer: "Metro Auto Exchange",
        distanceMiles: Math.min(input.radiusMiles, 24),
        location: `${input.zip} market`,
        imageUrl: getFallbackImageUrl(vehicle),
        listedAt: new Date().toISOString(),
      },
    ];
  }
}
