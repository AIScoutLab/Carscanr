import crypto from "node:crypto";
import { normalizeLookupText, normalizeVehicleType } from "./providerCache.js";
import { VehicleRecord } from "../types/domain.js";

function normalizeKeyPart(value: string | number | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeAlias(value: string | undefined | null) {
  const normalized = normalizeLookupText(value ?? "");
  return normalized
    .replace(/\ball wheel drive\b/g, "awd")
    .replace(/\bfront wheel drive\b/g, "fwd")
    .replace(/\brear wheel drive\b/g, "rwd")
    .replace(/\b4 wheel drive\b/g, "4wd");
}

function createKey(parts: Array<string | number | undefined | null>) {
  return parts.map((part) => normalizeKeyPart(part)).filter(Boolean).join(":");
}

export function buildVinKey(vin: string | undefined | null) {
  const safeVin = String(vin ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!safeVin) return null;
  return createKey(["vin", safeVin]);
}

export function buildVehicleKey(input: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  vehicleType?: string | null;
}) {
  if (!input.year || !input.make || !input.model) {
    return null;
  }
  return createKey([
    "vehicle",
    input.year,
    normalizeAlias(input.make),
    normalizeAlias(input.model),
    normalizeAlias(input.trim ?? "base"),
    normalizeVehicleType(input.vehicleType) ?? "unknown",
  ]);
}

export function buildVehicleKeyFromRecord(vehicle: VehicleRecord | null | undefined) {
  if (!vehicle) return null;
  return buildVehicleKey({
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    vehicleType: vehicle.vehicleType,
  });
}

export function buildListingKey(source: string | undefined | null, listingId: string | undefined | null) {
  if (!source || !listingId) return null;
  return createKey(["listing", source, listingId]);
}

export function buildUnlockKey(input: {
  vinKey?: string | null;
  listingKey?: string | null;
  vehicleKey?: string | null;
}) {
  if (input.vinKey) return { key: input.vinKey, type: "vin" };
  if (input.listingKey) return { key: input.listingKey, type: "listing" };
  if (input.vehicleKey) return { key: input.vehicleKey, type: "vehicle" };
  return { key: null, type: "unknown" };
}

export function buildImageKey(imageBytes: Buffer) {
  return crypto.createHash("sha256").update(imageBytes).digest("hex");
}

export function buildAnalysisKey(input: {
  analysisType: string;
  identityType?: string | null;
  identityValue?: string | null;
  promptVersion: string;
  modelName: string;
}) {
  return createKey([
    "analysis",
    input.analysisType,
    input.identityType ?? "none",
    input.identityValue ?? "none",
    input.promptVersion,
    input.modelName,
  ]);
}
