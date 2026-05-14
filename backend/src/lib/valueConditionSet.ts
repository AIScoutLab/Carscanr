import { isSpecialtyExoticMake } from "./specialtyVehicles.js";
import { ValuationRecord, VehicleRecord } from "../types/domain.js";

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

type ConditionValues = NonNullable<ValuationRecord["conditionValues"]>;

function cleanNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function adjustValue(
  value: number | null | undefined,
  input: {
    targetCondition: SupportedValueCondition;
    baseCondition: SupportedValueCondition;
    vehicle: VehicleRecord | null;
  },
) {
  const cleaned = cleanNumber(value);
  if (cleaned == null) {
    return null;
  }

  const multipliers = getConditionMultipliers(input.vehicle);
  const baseMultiplier = multipliers[input.baseCondition];
  const targetMultiplier = multipliers[input.targetCondition];
  return Math.round(cleaned * (targetMultiplier / baseMultiplier));
}

function buildConditionSnapshot(
  valuation: ValuationRecord,
  input: {
    targetCondition: SupportedValueCondition;
    baseCondition: SupportedValueCondition;
    vehicle: VehicleRecord | null;
  },
) {
  return {
    tradeIn: adjustValue(valuation.tradeIn, input),
    privateParty: adjustValue(valuation.privateParty, input),
    dealerRetail: adjustValue(valuation.dealerRetail, input),
    low: adjustValue(valuation.low ?? valuation.privatePartyLow ?? valuation.tradeInLow ?? valuation.dealerRetailLow, input),
    median: adjustValue(valuation.median ?? valuation.privateParty, input),
    high: adjustValue(valuation.high ?? valuation.privatePartyHigh ?? valuation.tradeInHigh ?? valuation.dealerRetailHigh, input),
  };
}

export function normalizeSupportedValueCondition(condition: string | null | undefined): SupportedValueCondition {
  const normalized = String(condition ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === "excellent") {
    return "excellent";
  }
  if (normalized === "fair" || normalized === "poor") {
    return "fair";
  }
  return "good";
}

export function getConditionMultipliers(vehicle: VehicleRecord | null) {
  return vehicle && isSpecialtyExoticMake(vehicle.make)
    ? SPECIALTY_CONDITION_MULTIPLIERS
    : STANDARD_CONDITION_MULTIPLIERS;
}

export function isConditionSetValuation(value: ValuationRecord | null | undefined): boolean {
  return Boolean(value?.status === "loaded_condition_set" && value.conditionValues);
}

export function buildConditionSetValuation(input: {
  valuation: ValuationRecord;
  vehicle: VehicleRecord | null;
  selectedCondition?: string | null;
}): ValuationRecord {
  const baseCondition = normalizeSupportedValueCondition(input.selectedCondition ?? input.valuation.condition ?? "good");
  const conditionValues: ConditionValues = {
    fair: buildConditionSnapshot(input.valuation, {
      targetCondition: "fair",
      baseCondition,
      vehicle: input.vehicle,
    }),
    good: buildConditionSnapshot(input.valuation, {
      targetCondition: "good",
      baseCondition,
      vehicle: input.vehicle,
    }),
    excellent: buildConditionSnapshot(input.valuation, {
      targetCondition: "excellent",
      baseCondition,
      vehicle: input.vehicle,
    }),
  };

  const baseSnapshot = conditionValues[baseCondition];
  return {
    ...input.valuation,
    status: "loaded_condition_set",
    condition: baseCondition,
    baseCondition,
    conditionValues,
    tradeIn: baseSnapshot.tradeIn,
    privateParty: baseSnapshot.privateParty,
    dealerRetail: baseSnapshot.dealerRetail,
    low: baseSnapshot.low ?? null,
    median: baseSnapshot.median ?? null,
    high: baseSnapshot.high ?? null,
    sourceBasis:
      input.valuation.status === "loaded_listing_range" || input.valuation.modelType === "listing_derived"
        ? "listing_median_adjusted"
        : "provider_direct",
  };
}

