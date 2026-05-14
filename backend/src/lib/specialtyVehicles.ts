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

function normalizeCompactModel(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function isSpecialtyExoticMake(make: string | null | undefined) {
  return SPECIALTY_EXOTIC_MAKES.has(normalizeMake(make));
}

export function getSpecialtyModelAliases(make: string | null | undefined, model: string | null | undefined) {
  const aliases = new Set<string>();
  const compactModel = normalizeCompactModel(model);
  if (compactModel) {
    aliases.add(compactModel);
  }
  const leadingDigits = compactModel.match(/^\d+/)?.[0] ?? "";
  if (leadingDigits) {
    aliases.add(leadingDigits);
  }
  if (!isSpecialtyExoticMake(make)) {
    return [...aliases];
  }

  const parts = String(model ?? "")
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
  const firstPart = normalizeCompactModel(parts[0] ?? "");
  if (firstPart) {
    aliases.add(firstPart);
  }
  const firstTwo = normalizeCompactModel(parts.slice(0, 2).join(" "));
  if (firstTwo) {
    aliases.add(firstTwo);
  }
  return [...aliases];
}

export function isSpecialtyModelFamilyMatch(make: string | null | undefined, requestedModel: string | null | undefined, candidateModel: string | null | undefined) {
  const requestedAliases = getSpecialtyModelAliases(make, requestedModel);
  const candidateAliases = getSpecialtyModelAliases(make, candidateModel);
  if (requestedAliases.length === 0 || candidateAliases.length === 0) {
    return false;
  }

  return requestedAliases.some((alias) => {
    if (!candidateAliases.includes(alias)) {
      return false;
    }
    return isSpecialtyExoticMake(make) || /\d/.test(alias);
  });
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
  status?: ValuationRecord["status"];
  sourceLabel?: string | null;
  confidenceLabel?: string | null;
  message?: string | null;
  reason?: string | null;
}): ValuationRecord {
  return {
    id: `specialty-market-unavailable:${input.vehicleId}:${input.zip}:${input.mileage}`,
    vehicleId: input.vehicleId,
    zip: input.zip,
    mileage: input.mileage,
    condition: input.condition,
    status: input.status ?? "specialty_unavailable",
    tradeIn: null,
    privateParty: null,
    dealerRetail: null,
    low: null,
    high: null,
    median: null,
    currency: "USD",
    generatedAt: new Date().toISOString(),
    sourceLabel: input.sourceLabel ?? "Specialty market value unavailable",
    confidenceLabel:
      input.confidenceLabel ??
      "Load live market value. Collector-market pricing can vary widely by mileage, condition, options, service history, and provenance.",
    message: input.message ?? null,
    reason: input.reason ?? null,
    modelType: "specialty_unavailable",
    listingCount: null,
  };
}
