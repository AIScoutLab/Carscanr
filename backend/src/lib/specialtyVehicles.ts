import { ValuationRecord, VehicleRecord } from "../types/domain.js";

const SPECIALTY_EXOTIC_MAKES = new Set([
  "ferrari",
  "lamborghini",
  "mclaren",
  "aston martin",
  "bentley",
  "rolls royce",
  "rolls-royce",
  "porsche",
  "maserati",
  "lotus",
  "maybach",
  "bugatti",
  "pagani",
  "koenigsegg",
]);

function normalizeMake(make: string | null | undefined) {
  return String(make ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isSpecialtyExoticMake(make: string | null | undefined) {
  return SPECIALTY_EXOTIC_MAKES.has(normalizeMake(make));
}

export function buildSpecialtyVehicleOverview(input: {
  make: string;
  model: string;
  bodyStyle?: string | null;
}) {
  const bodyStyle = String(input.bodyStyle ?? "").trim().toLowerCase();
  if (bodyStyle.includes("coupe") || bodyStyle.includes("convertible") || bodyStyle.includes("spider")) {
    return "Exotic sports car with collector-market pricing. Market value can vary widely by mileage, condition, options, service history, and provenance.";
  }
  return "High-performance specialty vehicle. Market value can vary widely by mileage, condition, options, service history, and provenance.";
}

export function isTrustedSpecialtyValuationSource(valuation: ValuationRecord | null | undefined) {
  if (!valuation) {
    return false;
  }

  if (valuation.modelType === "provider_range" || valuation.modelType === "listing_derived") {
    return true;
  }

  const normalizedSource = String(valuation.sourceLabel ?? "")
    .trim()
    .toLowerCase();
  return (
    normalizedSource.includes("market data") ||
    normalizedSource.includes("similar vehicles") ||
    normalizedSource.includes("curated specialty range")
  );
}

export function isGenericFallbackValuation(valuation: ValuationRecord | null | undefined) {
  if (!valuation) {
    return false;
  }

  if (
    valuation.modelType === "estimated_depreciation" ||
    valuation.modelType === "estimated_family_model"
  ) {
    return true;
  }

  const normalizedSource = String(valuation.sourceLabel ?? "")
    .trim()
    .toLowerCase();
  return (
    normalizedSource.includes("estimated from vehicle data") ||
    normalizedSource.includes("estimated from vehicle family data") ||
    normalizedSource.includes("fallback") ||
    normalizedSource.includes("synthetic")
  );
}

export function buildSpecialtyUnavailableValuation(input: {
  vehicleId: string;
  zip: string;
  mileage: number;
  condition: ValuationRecord["condition"];
  vehicle: VehicleRecord;
}): ValuationRecord {
  return {
    id: `specialty-market-unavailable:${input.vehicleId}:${input.zip}:${input.mileage}`,
    vehicleId: input.vehicleId,
    zip: input.zip,
    mileage: input.mileage,
    condition: input.condition,
    tradeIn: 0,
    privateParty: 0,
    dealerRetail: 0,
    currency: "USD",
    generatedAt: new Date().toISOString(),
    sourceLabel: "Specialty market value unavailable",
    confidenceLabel: "Load live market value. Collector-market pricing can vary widely by mileage, condition, options, service history, and provenance.",
    modelType: "specialty_unavailable",
    listingCount: null,
  };
}
