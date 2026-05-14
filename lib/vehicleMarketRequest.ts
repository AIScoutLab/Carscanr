import { MarketAreaZipSource } from "@/lib/marketAreaZip";

export type VehicleLookupDescriptor = {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  vehicleType?: "car" | "motorcycle" | null;
  bodyStyle?: string | null;
  normalizedModel?: string | null;
};

export type VehicleLookupInput =
  | string
  | {
      vehicleId?: string | null;
      descriptor?: VehicleLookupDescriptor | null;
    };

export type ValueRequestOptions = {
  allowLive?: boolean;
  fetchReason?: string;
  sourceScreen?: string;
  action?: string;
  forceLive?: boolean;
  zipSource?: MarketAreaZipSource;
};

export type ListingsRequestOptions = {
  allowLive?: boolean;
  fetchReason?: string;
  sourceScreen?: string;
  action?: string;
  radiusMiles?: number;
  mileage?: string | number;
  zipSource?: MarketAreaZipSource;
};

export function buildVehicleLookupParams(input: VehicleLookupInput) {
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
