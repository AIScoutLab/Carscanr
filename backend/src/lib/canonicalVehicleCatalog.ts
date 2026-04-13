import crypto from "node:crypto";
import { logger } from "./logger.js";
import { buildCacheDescriptor, buildCanonicalKey } from "./providerCache.js";
import { repositories } from "./repositoryRegistry.js";
import { CanonicalVehicleRecord, VehicleRecord } from "../types/domain.js";

function nowIso() {
  return new Date().toISOString();
}

export function mapCanonicalVehicleToRecord(record: CanonicalVehicleRecord): VehicleRecord | null {
  if (record.specsJson) {
    return {
      ...record.specsJson,
      id: record.id,
    };
  }

  if (
    record.bodyType == null ||
    record.vehicleType == null ||
    record.engine == null ||
    record.drivetrain == null ||
    record.transmission == null ||
    record.horsepower == null ||
    record.torque == null ||
    record.msrp == null
  ) {
    return null;
  }

  return {
    id: record.id,
    year: record.year,
    make: record.make,
    model: record.model,
    trim: record.trim ?? "",
    bodyStyle: record.bodyType,
    vehicleType: record.vehicleType,
    msrp: record.msrp,
    engine: record.engine,
    horsepower: record.horsepower,
    torque: record.torque,
    transmission: record.transmission,
    drivetrain: record.drivetrain,
    mpgOrRange: (record.overviewJson?.mpgOrRange as string | undefined) ?? "",
    colors: Array.isArray(record.overviewJson?.colors) ? (record.overviewJson?.colors as string[]) : [],
  };
}

export function buildCanonicalVehicleCandidate(input: {
  vehicle: VehicleRecord;
  sourceProvider: string;
  sourceVehicleId: string;
  promotionStatus?: "candidate" | "promoted";
}): CanonicalVehicleRecord {
  const currentIso = nowIso();
  const descriptor = buildCacheDescriptor({ vehicle: input.vehicle });
  if (!descriptor) {
    throw new Error("Unable to build canonical vehicle candidate descriptor.");
  }

  return {
    id: crypto.randomUUID(),
    year: input.vehicle.year,
    make: input.vehicle.make,
    model: input.vehicle.model,
    trim: input.vehicle.trim,
    bodyType: input.vehicle.bodyStyle,
    vehicleType: input.vehicle.vehicleType,
    engine: input.vehicle.engine,
    drivetrain: input.vehicle.drivetrain,
    transmission: input.vehicle.transmission,
    fuelType: null,
    horsepower: input.vehicle.horsepower,
    torque: input.vehicle.torque,
    msrp: input.vehicle.msrp,
    normalizedMake: descriptor.normalizedMake,
    normalizedModel: descriptor.normalizedModel,
    normalizedTrim: descriptor.normalizedTrim || null,
    normalizedVehicleType: input.vehicle.vehicleType,
    canonicalKey: buildCanonicalKey({
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
      trim: input.vehicle.trim,
      vehicleType: input.vehicle.vehicleType,
    }),
    specsJson: input.vehicle,
    overviewJson: {
      bodyStyle: input.vehicle.bodyStyle,
      mpgOrRange: input.vehicle.mpgOrRange,
      colors: input.vehicle.colors,
    },
    defaultImageUrl: null,
    sourceProvider: input.sourceProvider,
    sourceVehicleId: input.sourceVehicleId,
    popularityScore: 1,
    promotionStatus: input.promotionStatus ?? "promoted",
    firstSeenAt: currentIso,
    lastSeenAt: currentIso,
    lastPromotedAt: input.promotionStatus === "candidate" ? null : currentIso,
    createdAt: currentIso,
    updatedAt: currentIso,
  };
}

export async function upsertCanonicalVehicleFromProvider(input: {
  vehicle: VehicleRecord;
  sourceProvider: string;
  sourceVehicleId: string;
  promotionStatus?: "candidate" | "promoted";
}): Promise<CanonicalVehicleRecord> {
  const candidate = buildCanonicalVehicleCandidate(input);
  logger.error(
    {
      label: "CANONICAL_UPSERT_START",
      canonicalKey: candidate.canonicalKey,
      canonicalId: candidate.id,
      sourceProvider: input.sourceProvider,
      sourceVehicleId: input.sourceVehicleId,
      year: candidate.year,
      make: candidate.make,
      model: candidate.model,
      trim: candidate.trim ?? null,
    },
    "CANONICAL_UPSERT_START",
  );
  try {
    const persisted = await repositories.canonicalVehicles.upsertCandidate(candidate);
    if ((input.promotionStatus ?? "promoted") === "promoted") {
      await repositories.canonicalVehicles.promote(candidate.canonicalKey);
    }
    await repositories.canonicalVehicles.incrementPopularity(candidate.canonicalKey);
    const selected = (await repositories.canonicalVehicles.findByCanonicalKey(candidate.canonicalKey)) ?? persisted;
    logger.error(
      {
        label: "CANONICAL_UPSERT_SUCCESS",
        canonicalKey: candidate.canonicalKey,
        canonicalId: selected.id,
        sourceProvider: input.sourceProvider,
        sourceVehicleId: input.sourceVehicleId,
      },
      "CANONICAL_UPSERT_SUCCESS",
    );
    return selected;
  } catch (error) {
    logger.error(
      {
        label: "CANONICAL_UPSERT_FAILURE",
        canonicalKey: candidate.canonicalKey,
        canonicalId: candidate.id,
        sourceProvider: input.sourceProvider,
        sourceVehicleId: input.sourceVehicleId,
        message: error instanceof Error ? error.message : "Unknown canonical upsert error",
        stack: error instanceof Error ? error.stack : undefined,
        code: typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined,
        details: typeof error === "object" && error && "details" in error ? (error as { details?: unknown }).details : undefined,
        hint: typeof error === "object" && error && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
      },
      "CANONICAL_UPSERT_FAILURE",
    );
    throw error;
  }
}

export async function resolveStoredVehicleRecordById(vehicleId: string): Promise<VehicleRecord | null> {
  const canonicalVehicle = await repositories.canonicalVehicles.findById(vehicleId);
  if (canonicalVehicle) {
    return mapCanonicalVehicleToRecord(canonicalVehicle);
  }

  return repositories.vehicles.findById(vehicleId);
}
