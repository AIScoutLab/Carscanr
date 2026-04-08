import {
  ListingRecord,
  ValuationRecord,
  VehicleRecord,
  VisionProviderResult,
  VisionResult,
} from "../types/domain.js";

export interface VisionProvider {
  identifyFromImage(input: { imageBuffer: Buffer; mimeType: string; fileName?: string }): Promise<VisionProviderResult>;
}

export interface VehicleSpecsProvider {
  getVehicleSpecs(input: { vehicleId: string; vehicle?: VehicleRecord | null }): Promise<VehicleRecord | null>;
  searchVehicles(input: {
    year?: string;
    make?: string;
    model?: string;
  }): Promise<VehicleRecord[]>;
  searchCandidates(input: {
    year: number;
    make: string;
    model: string;
    trim?: string;
  }): Promise<VehicleRecord[]>;
}

export interface VehicleValueProvider {
  getValuation(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<ValuationRecord | null>;
}

export interface VehicleListingsProvider {
  getListings(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    radiusMiles: number;
  }): Promise<ListingRecord[]>;
}
