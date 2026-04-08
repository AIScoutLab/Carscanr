type VehicleDescriptor = {
  year: number;
  make: string;
  model: string;
  trim?: string;
};

const LIVE_PREFIX = "live:";

export function buildLiveVehicleId(descriptor: VehicleDescriptor) {
  const parts = [
    String(descriptor.year),
    descriptor.make,
    descriptor.model,
    descriptor.trim ?? "",
  ].map((value) => encodeURIComponent(value.trim()));

  return `${LIVE_PREFIX}${parts.join("|")}`;
}

export function parseLiveVehicleId(vehicleId: string): VehicleDescriptor | null {
  if (!vehicleId.startsWith(LIVE_PREFIX)) {
    return null;
  }

  const raw = vehicleId.slice(LIVE_PREFIX.length).split("|");
  if (raw.length < 3) {
    return null;
  }

  const year = Number(decodeURIComponent(raw[0] ?? ""));
  const make = decodeURIComponent(raw[1] ?? "");
  const model = decodeURIComponent(raw[2] ?? "");
  const trim = decodeURIComponent(raw[3] ?? "");

  if (!year || !make || !model) {
    return null;
  }

  return {
    year,
    make,
    model,
    trim: trim || undefined,
  };
}
