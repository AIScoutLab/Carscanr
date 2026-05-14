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

