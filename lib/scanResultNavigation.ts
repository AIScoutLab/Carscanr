import { buildVehicleUnlockId } from "@/services/subscriptionService";
import { ScanResult, VehicleCandidate } from "@/types";

type VehicleDetailRoute = {
  pathname: "/vehicle/[id]";
  params: Record<string, string> & { id: string };
};

function safeString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function safeNumber(value: unknown, fallback: number | null = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function canRenderEstimatedDetail(vehicle: VehicleCandidate) {
  const make = safeString(vehicle.make, "Unknown");
  const model = safeString(vehicle.model, "Vehicle");
  const makeKnown = make.trim().toLowerCase() !== "unknown";
  const modelKnown = model.trim().toLowerCase() !== "vehicle";
  const confidence = safeNumber(vehicle.confidence, 0) ?? 0;
  const groundedSupport = Boolean(vehicle.groundedYearRange);
  return makeKnown && modelKnown && (confidence >= 0.8 || (groundedSupport && confidence >= 0.72));
}

function buildEstimateDetailId(scanId: string | null | undefined, vehicle: VehicleCandidate) {
  const suffix = [scanId ?? null, vehicle.make, vehicle.model, vehicle.displayYearLabel ?? (vehicle.year ? `${vehicle.year}` : null)]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(":")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `estimate:${suffix || "vehicle"}`;
}

function buildDisplayTitle(vehicle: VehicleCandidate) {
  const displayYear = safeString(vehicle.displayYearLabel, vehicle.year ? `${vehicle.year}` : "");
  const make = safeString(vehicle.make, "Unknown");
  const model = safeString(vehicle.model, "Vehicle");
  return safeString(vehicle.displayTitleLabel, [displayYear, make, model].filter(Boolean).join(" "));
}

function buildDisplayParams(scan: ScanResult, vehicle: VehicleCandidate, resultSource: string) {
  const source = scan.isSampleVehicle || scan.source === "sample_vehicle" ? "sample_vehicle" : safeString(vehicle.source, safeString(scan.source));
  return {
    imageUri: safeString(scan.imageUri),
    scanId: safeString(scan.id),
    titleLabel: buildDisplayTitle(vehicle),
    yearLabel: safeString(vehicle.displayYearLabel, vehicle.year ? `${vehicle.year}` : ""),
    make: safeString(vehicle.make, "Unknown"),
    model: safeString(vehicle.model, "Vehicle"),
    trimLabel: safeString(vehicle.displayTrimLabel, safeString(vehicle.trim)),
    vehicleType: safeString(scan.detectedVehicleType),
    confidence: `${safeNumber(vehicle.confidence, scan.confidenceScore) ?? scan.confidenceScore ?? ""}`,
    trustedCase: (safeNumber(vehicle.confidence, scan.confidenceScore) ?? 0) >= 0.9 ? "1" : "0",
    resultSource: resultSource || source,
    isSampleVehicle: scan.isSampleVehicle || scan.source === "sample_vehicle" ? "1" : "0",
    source,
  };
}

export function buildVehicleDetailRouteFromScanResult(scan: ScanResult, resultSource = "fresh_api"): VehicleDetailRoute {
  const vehicle = scan.identifiedVehicle ?? scan.candidates?.[0];
  if (!vehicle) {
    return {
      pathname: "/vehicle/[id]",
      params: {
        id: `estimate:${safeString(scan.id, "vehicle")}`,
        estimate: "1",
        imageUri: safeString(scan.imageUri),
        scanId: safeString(scan.id),
        resultSource,
      },
    };
  }

  const isSample = scan.isSampleVehicle || scan.source === "sample_vehicle";
  const baseParams = buildDisplayParams(scan, vehicle, resultSource);
  const vehicleId = safeString(vehicle.id);
  if (vehicleId) {
    return {
      pathname: "/vehicle/[id]",
      params: {
        id: vehicleId,
        unlockId: isSample ? "" : buildVehicleUnlockId({ vehicleId }) ?? "",
        ...baseParams,
      },
    };
  }

  const estimateId = buildEstimateDetailId(scan.id, vehicle);
  return {
    pathname: "/vehicle/[id]",
    params: {
      id: estimateId,
      estimate: "1",
      unlockId:
        buildVehicleUnlockId({
          scanId: scan.id,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          trim: vehicle.trim ?? null,
          vehicleType: scan.detectedVehicleType ?? null,
        }) ?? "",
      reopenedSource: canRenderEstimatedDetail(vehicle) ? "1" : "0",
      ...baseParams,
    },
  };
}
