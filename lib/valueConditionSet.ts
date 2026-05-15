import { isSpecialtyExoticMake } from "@/lib/specialtyVehicles";
import { ValuationResult } from "@/types";

export type SupportedValueCondition = "fair" | "good" | "excellent";

export const STANDARD_CONDITION_MULTIPLIERS: Record<SupportedValueCondition, number> = {
  fair: 0.92,
  good: 1,
  excellent: 1.06,
};

export const SPECIALTY_CONDITION_MULTIPLIERS: Record<SupportedValueCondition, number> = {
  fair: 0.96,
  good: 1,
  excellent: 1.03,
};

type ListingLike = {
  price: string;
};

function parseCurrencyString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    return null;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatCurrencyValue(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getConditionMultiplierMap(make?: string | null) {
  return make && isSpecialtyExoticMake(make) ? SPECIALTY_CONDITION_MULTIPLIERS : STANDARD_CONDITION_MULTIPLIERS;
}

function buildConditionRangeSnapshot(input: {
  low: number;
  median: number;
  high: number;
  targetCondition: SupportedValueCondition;
  make?: string | null;
}) {
  const multipliers = getConditionMultiplierMap(input.make);
  const multiplier = multipliers[input.targetCondition];
  const adjustedLow = Math.round(input.low * multiplier);
  const adjustedMedian = Math.round(input.median * multiplier);
  const adjustedHigh = Math.round(input.high * multiplier);

  return {
    tradeIn: "Unavailable",
    privateParty: "Unavailable",
    dealerRetail: formatCurrencyValue(adjustedMedian) ?? "Unavailable",
    low: formatCurrencyValue(adjustedLow),
    median: formatCurrencyValue(adjustedMedian),
    high: formatCurrencyValue(adjustedHigh),
  };
}

export function buildListingDerivedConditionSetFromListings(input: {
  listings: ListingLike[];
  selectedCondition?: string | null;
  make?: string | null;
  sourceLabel?: string | null;
}) {
  const prices = input.listings
    .map((listing) => parseCurrencyString(listing.price))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (prices.length === 0) {
    return null;
  }

  const low = prices[0];
  const high = prices[prices.length - 1];
  const midpoint = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0 ? Math.round((prices[midpoint - 1] + prices[midpoint]) / 2) : prices[midpoint];
  const selectedCondition = normalizeSupportedValueCondition(input.selectedCondition ?? "good");
  const sourceLabel = input.sourceLabel ?? "Based on live MarketCheck listings";
  const limitedCompsCopy =
    prices.length <= 2
      ? `Limited comps. Based on ${prices.length} live MarketCheck listing${prices.length === 1 ? "" : "s"}. Condition-adjusted estimate.`
      : `Based on ${prices.length} live MarketCheck listings. Condition-adjusted estimate.`;
  const specialtyNote =
    input.make && isSpecialtyExoticMake(input.make)
      ? " Actual pricing may vary by options, service history, color, and provenance."
      : "";

  return resolveConditionValues(
    {
      status: "loaded_condition_set",
      selectedCondition: "good",
      baseCondition: "good",
      conditionValues: {
        fair: buildConditionRangeSnapshot({
          low,
          median,
          high,
          targetCondition: "fair",
          make: input.make,
        }),
        good: buildConditionRangeSnapshot({
          low,
          median,
          high,
          targetCondition: "good",
          make: input.make,
        }),
        excellent: buildConditionRangeSnapshot({
          low,
          median,
          high,
          targetCondition: "excellent",
          make: input.make,
        }),
      },
      tradeIn: "Unavailable",
      tradeInRange: "Unavailable",
      privateParty: "Unavailable",
      privatePartyRange: "Unavailable",
      dealerRetail: formatCurrencyValue(median) ?? "Unavailable",
      dealerRetailRange: "Condition-adjusted estimate",
      low: formatCurrencyValue(low),
      median: formatCurrencyValue(median),
      high: formatCurrencyValue(high),
      confidenceLabel: `${limitedCompsCopy}${specialtyNote}`.trim(),
      sourceLabel,
      valuationSource: "listing_comps",
      compCount: prices.length,
      confidence: prices.length <= 2 ? "limited" : "moderate",
      rangeLow: formatCurrencyValue(low),
      rangeHigh: formatCurrencyValue(high),
      midpoint: formatCurrencyValue(median),
      unavailableReason: null,
      message: null,
      reason: null,
      listingCount: prices.length,
      sourceBasis: "listing_median_adjusted",
      modelType: "listing_derived",
    },
    selectedCondition,
  );
}

function normalizeConditionToken(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function normalizeSupportedValueCondition(condition: string | null | undefined): SupportedValueCondition {
  const normalized = normalizeConditionToken(condition);
  if (normalized === "excellent") {
    return "excellent";
  }
  if (normalized === "fair" || normalized === "poor") {
    return "fair";
  }
  return "good";
}

export function resolveConditionValues(result: ValuationResult, condition: string): ValuationResult {
  if (result.status !== "loaded_condition_set" || !result.conditionValues) {
    return result;
  }

  const selectedCondition = normalizeSupportedValueCondition(condition);
  const selected = result.conditionValues[selectedCondition];
  const hasComparableRange = Boolean(selected.low || selected.median || selected.high);
  const hasRetailTriplet = [selected.tradeIn, selected.privateParty, selected.dealerRetail].some((value) => value !== "Unavailable");

  return {
    ...result,
    selectedCondition,
    tradeIn: selected.tradeIn,
    tradeInRange: selected.tradeIn !== "Unavailable" ? "Condition-adjusted estimate" : "Unavailable",
    privateParty: selected.privateParty,
    privatePartyRange: selected.privateParty !== "Unavailable" ? "Condition-adjusted estimate" : "Unavailable",
    dealerRetail: selected.dealerRetail,
    dealerRetailRange: selected.dealerRetail !== "Unavailable" ? "Condition-adjusted estimate" : "Unavailable",
    low: selected.low ?? null,
    median: selected.median ?? null,
    high: selected.high ?? null,
    status: hasComparableRange && !hasRetailTriplet ? "loaded_listing_range" : "loaded_condition_set",
  };
}

export function getConditionSourceLabel(input: {
  result: ValuationResult;
  make?: string | null;
  model?: string | null;
}) {
  if (input.result.status !== "loaded_condition_set") {
    return input.result.sourceLabel;
  }

  const specialty = input.make ? isSpecialtyExoticMake(input.make) : false;
  return specialty
    ? "Based on live MarketCheck listings. Condition-adjusted estimate. Actual pricing may vary by options, service history, color, and provenance."
    : "Based on live MarketCheck listings. Condition-adjusted estimate.";
}
