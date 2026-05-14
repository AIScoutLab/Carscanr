import {
  ListingRecord,
  ValuationRecord,
  VehicleRecord,
  VisionProviderResult,
  VisionResult,
} from "../types/domain.js";

export interface VisionProvider {
  identifyFromImage(input: {
    imageBuffer: Buffer;
    mimeType: string;
    fileName?: string;
    focusCropBuffer?: Buffer | null;
    focusCropMimeType?: string | null;
  }): Promise<VisionProviderResult>;
}

export interface VehicleIdentificationProvider extends VisionProvider {
  readonly providerName: string;
}

export type MarketCheckRequestMeta = {
  requestId?: string | null;
  userId?: string | null;
  action?: string | null;
  route?: string | null;
  reason?: string;
  allowLive?: boolean;
  scanId?: string | null;
  vehicleId?: string | null;
  vin?: string | null;
  year?: number | string | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  yearRangeStart?: number | null;
  yearRangeEnd?: number | null;
  zip?: string | null;
  zipSource?: string | null;
  radiusMiles?: number | null;
  mileage?: number | null;
  condition?: string | null;
  sourceScreen?: string | null;
  forceLive?: boolean | null;
  cacheKey?: string | null;
  retryAttempt?: number | null;
  caller?: string | null;
  stackTag?: string | null;
};

export interface VehicleSpecsProvider {
  getVehicleSpecs(input: { vehicleId: string; vehicle?: VehicleRecord | null; requestMeta?: MarketCheckRequestMeta }): Promise<VehicleRecord | null>;
  searchVehicles(input: {
    year?: string;
    make?: string;
    model?: string;
    requestMeta?: MarketCheckRequestMeta;
  }): Promise<VehicleRecord[]>;
  searchCandidates(input: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    requestMeta?: MarketCheckRequestMeta;
  }): Promise<VehicleRecord[]>;
}

export interface VehicleValueProvider {
  getValuation(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    mileage: number;
    condition: string;
    requestMeta?: MarketCheckRequestMeta;
  }): Promise<ValuationRecord | null>;
}

export interface VehicleListingsProvider {
  getListings(input: {
    vehicleId: string;
    vehicle?: VehicleRecord | null;
    zip: string;
    radiusMiles: number;
    requestMeta?: MarketCheckRequestMeta;
  }): Promise<ListingRecord[]>;
}
