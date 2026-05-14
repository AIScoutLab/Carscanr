import assert from "node:assert/strict";
import test from "node:test";
import { getValuesCacheKey } from "../src/lib/providerCache.js";
import { buildConditionSetValuation } from "../src/lib/valueConditionSet.js";
import { ValuationRecord, VehicleRecord } from "../src/types/domain.js";

const vehicle: VehicleRecord = {
  id: "2021-ferrari-812-superfast",
  year: 2021,
  make: "Ferrari",
  model: "812 Superfast",
  trim: "Base",
  bodyStyle: "Coupe",
  vehicleType: "car",
  msrp: 349000,
  engine: "6.5L V12",
  horsepower: 789,
  torque: "530 lb-ft",
  transmission: "7-speed dual-clutch automatic",
  drivetrain: "RWD",
  mpgOrRange: "12 city / 16 highway",
  colors: ["Rosso Corsa"],
};

const descriptor = {
  year: 2021,
  make: "Ferrari",
  model: "812 Superfast",
  trim: "Base",
  vehicleType: "car" as const,
  normalizedMake: "ferrari",
  normalizedModel: "812 superfast",
  normalizedTrim: "base",
};

test("condition-set cache key ignores condition but changes for zip and mileage", () => {
  const fairKey = getValuesCacheKey(descriptor, {
    zip: "60563",
    mileage: 18400,
  });
  const goodKey = getValuesCacheKey(descriptor, {
    zip: "60563",
    mileage: 18400,
  });
  const changedZipKey = getValuesCacheKey(descriptor, {
    zip: "60610",
    mileage: 18400,
  });
  const changedMileageKey = getValuesCacheKey(descriptor, {
    zip: "60563",
    mileage: 22000,
  });

  assert.equal(fairKey, goodKey);
  assert.notEqual(fairKey, changedZipKey);
  assert.notEqual(fairKey, changedMileageKey);
});

test("condition-set builder derives fair good and excellent from one listing-based result", () => {
  const valuation: ValuationRecord = {
    id: "listing-derived",
    vehicleId: vehicle.id,
    zip: "60563",
    mileage: 18400,
    condition: "good",
    status: "loaded_listing_range",
    tradeIn: null,
    privateParty: null,
    dealerRetail: 300000,
    low: 275000,
    median: 300000,
    high: 330000,
    currency: "USD",
    generatedAt: "2026-05-14T00:00:00.000Z",
    sourceLabel: "Based on live MarketCheck listings",
    confidenceLabel: "Condition-adjusted estimate",
    modelType: "listing_derived",
    listingCount: 8,
  };

  const conditionSet = buildConditionSetValuation({
    valuation,
    vehicle,
    selectedCondition: "good",
  });

  assert.equal(conditionSet.status, "loaded_condition_set");
  assert.equal(conditionSet.baseCondition, "good");
  assert.equal(conditionSet.conditionValues?.good.median, 300000);
  assert.equal(conditionSet.conditionValues?.fair.median, 288000);
  assert.equal(conditionSet.conditionValues?.excellent.median, 309000);
  assert.equal(conditionSet.sourceBasis, "listing_median_adjusted");
});

