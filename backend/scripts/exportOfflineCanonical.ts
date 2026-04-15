import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedValuations, seedVehicles } from "../src/data/seedVehicles.js";
import { buildCanonicalKey, normalizeLookupText } from "../src/lib/providerCache.js";
import { supabaseAdmin } from "../src/lib/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, "../../assets/data/offline_canonical.json");
const MAX_VEHICLES = 200;

function buildOfflineVehicle(vehicle: typeof seedVehicles[number]) {
  const valuation = seedValuations.find((entry) => entry.vehicleId === vehicle.id) ?? null;
  return {
    id: vehicle.id,
    canonicalKey: buildCanonicalKey({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      vehicleType: vehicle.vehicleType,
    }),
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    vehicleType: vehicle.vehicleType,
    normalizedMake: normalizeLookupText(vehicle.make),
    normalizedModel: normalizeLookupText(vehicle.model),
    normalizedTrim: normalizeLookupText(vehicle.trim),
    basicSpecs: {
      engine: vehicle.engine,
      horsepower: vehicle.horsepower,
      torque: vehicle.torque,
      transmission: vehicle.transmission,
      drivetrain: vehicle.drivetrain,
      mpgOrRange: vehicle.mpgOrRange,
      exteriorColors: vehicle.colors,
      msrp: vehicle.msrp,
      bodyStyle: vehicle.bodyStyle,
    },
    lightweightValue: valuation
      ? {
          tradeIn: valuation.tradeIn,
          privateParty: valuation.privateParty,
          dealerRetail: valuation.dealerRetail,
          sourceLabel: "Quick result",
          confidenceLabel: "Bundled offline estimate",
        }
      : null,
  };
}

async function loadCanonicalRows() {
  if (!supabaseAdmin) {
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from("canonical_vehicles")
    .select("*")
    .order("popularity_score", { ascending: false })
    .limit(MAX_VEHICLES);
  if (error) {
    throw error;
  }
  return data ?? [];
}

function buildOfflineVehicleFromCanonical(row: any) {
  const specs = row.specs_json ?? {};
  return {
    id: row.id,
    canonicalKey: row.canonical_key,
    year: row.year,
    make: row.make,
    model: row.model,
    trim: row.trim ?? "",
    vehicleType: row.vehicle_type ?? "car",
    normalizedMake: row.normalized_make,
    normalizedModel: row.normalized_model,
    normalizedTrim: row.normalized_trim ?? "base",
    basicSpecs: {
      engine: specs.engine ?? row.engine ?? "Unknown",
      horsepower: specs.horsepower ?? row.horsepower ?? 0,
      torque: specs.torque ?? row.torque ?? "Unknown",
      transmission: specs.transmission ?? row.transmission ?? "Unknown",
      drivetrain: specs.drivetrain ?? row.drivetrain ?? "Unknown",
      mpgOrRange: specs.mpgOrRange ?? "",
      exteriorColors: Array.isArray(specs.colors) ? specs.colors : [],
      msrp: specs.msrp ?? row.msrp ?? 0,
      bodyStyle: specs.bodyStyle ?? row.body_type ?? "Vehicle",
    },
    lightweightValue: null,
  };
}

async function main() {
  const canonicalRows = await loadCanonicalRows();
  const vehicles = canonicalRows && canonicalRows.length > 0
    ? canonicalRows.map(buildOfflineVehicleFromCanonical)
    : seedVehicles.slice(0, MAX_VEHICLES).map(buildOfflineVehicle);
  const payload = {
    offline_canonical_version: new Date().toISOString().slice(0, 10).replace(/-/g, ".") + ".1",
    generated_at: new Date().toISOString(),
    vehicles,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
  console.log("OFFLINE_CANONICAL_EXPORT_COMPLETED", {
    outputPath,
    vehicleCount: vehicles.length,
    byteSize: Buffer.byteLength(JSON.stringify(payload)),
  });
}

main().catch((error) => {
  console.error("OFFLINE_CANONICAL_EXPORT_FAILED", error);
  process.exitCode = 1;
});
