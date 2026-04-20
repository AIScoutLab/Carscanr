import { logger } from "../lib/logger.js";

type NhtsaDecodeResponse = {
  Results?: Array<Record<string, string | number | null | undefined>>;
};

export type NhtsaVehicleData = {
  make: string | null;
  model: string | null;
  year: number | null;
  trim: string | null;
  bodyStyle: string | null;
  drivetrain: string | null;
  fuelType: string | null;
  engineDisplacementL: number | null;
  cylinders: number | null;
  horsepower: number | null;
  doors: number | null;
};

export function safeNumber(val: unknown) {
  if (!val) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function safeString(val: unknown) {
  if (typeof val !== "string") {
    return null;
  }
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function fetchNhtsaData(vin: string): Promise<NhtsaVehicleData | null> {
  const trimmedVin = String(vin ?? "").trim();
  if (!trimmedVin) {
    return null;
  }

  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(trimmedVin)}?format=json`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`NHTSA request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as NhtsaDecodeResponse;
  const nhtsa = payload.Results?.[0];
  if (!nhtsa) {
    return null;
  }

  const result: NhtsaVehicleData = {
    make: safeString(nhtsa.Make),
    model: safeString(nhtsa.Model),
    year: safeNumber(nhtsa.ModelYear),
    trim: safeString(nhtsa.Trim),
    bodyStyle: safeString(nhtsa.BodyClass),
    drivetrain: safeString(nhtsa.DriveType),
    fuelType: safeString(nhtsa.FuelTypePrimary),
    engineDisplacementL: safeNumber(nhtsa.DisplacementL),
    cylinders: safeNumber(nhtsa.EngineCylinders),
    horsepower: safeNumber(nhtsa.EngineHP),
    doors: safeNumber(nhtsa.Doors),
  };

  if (result.horsepower != null) {
    logger.info(
      {
        label: "NHTSA_ENGINE_HP_FOUND",
        vin: trimmedVin,
        horsepower: result.horsepower,
      },
      "NHTSA returned EngineHP",
    );
  }

  return result;
}
