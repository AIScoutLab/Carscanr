import { normalizeCondition } from "../../lib/providerCache.js";
import { seedValuations, seedVehicles } from "../../data/seedVehicles.js";
import { ValuationRecord } from "../../types/domain.js";
import { VehicleValueProvider } from "../interfaces.js";

const conditionMultipliers: Record<string, number> = {
  poor: 0.82,
  fair: 0.9,
  good: 0.97,
  very_good: 1.02,
  excellent: 1.06,
};

function getConditionMultiplier(condition: string) {
  return conditionMultipliers[condition] ?? 1;
}

function adjustFromBaseline(baseValue: number, mileageDelta: number, condition: string) {
  const mileageAdjustment = Math.round((mileageDelta / 1000) * -85);
  const conditioned = Math.round((baseValue + mileageAdjustment) * getConditionMultiplier(condition));
  return Math.max(conditioned, Math.round(baseValue * 0.45));
}

export class MockVehicleValueProvider implements VehicleValueProvider {
  async getValuation(input: {
    vehicleId: string;
    vehicle?: { id: string; msrp: number } | null;
    zip: string;
    mileage: number;
    condition: string;
  }): Promise<ValuationRecord | null> {
    const normalizedCondition = normalizeCondition(input.condition);
    const base = seedValuations.find((valuation) => valuation.vehicleId === input.vehicleId);
    if (base) {
      const mileageDelta = input.mileage - base.mileage;
      const tradeIn = adjustFromBaseline(base.tradeIn, mileageDelta, normalizedCondition);
      const privateParty = adjustFromBaseline(base.privateParty, mileageDelta, normalizedCondition);
      const dealerRetail = adjustFromBaseline(base.dealerRetail, mileageDelta, normalizedCondition);

      return {
        ...base,
        id: `${base.id}-${input.zip}-${input.mileage}`,
        zip: input.zip,
        mileage: input.mileage,
        condition: normalizedCondition,
        tradeIn,
        privateParty,
        dealerRetail,
        generatedAt: new Date().toISOString(),
      };
    }

    const vehicle = input.vehicle ?? seedVehicles.find((entry) => entry.id === input.vehicleId);
    if (!vehicle) return null;

    const depreciation = Math.max(0.35, 1 - input.mileage / 200000);
    const tradeIn = Math.round(vehicle.msrp * depreciation * 0.62);
    return {
      id: `val-${vehicle.id}`,
      vehicleId: vehicle.id,
      zip: input.zip,
      mileage: input.mileage,
      condition: normalizedCondition,
      tradeIn,
      privateParty: Math.round(tradeIn * 1.08),
      dealerRetail: Math.round(tradeIn * 1.18),
      currency: "USD",
      generatedAt: new Date().toISOString(),
    };
  }
}
