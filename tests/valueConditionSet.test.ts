import assert from "node:assert/strict";
import test from "node:test";
import { resolveConditionValues } from "@/lib/valueConditionSet";
import { ValuationResult } from "@/types";

const loadedConditionSet: ValuationResult = {
  status: "loaded_condition_set",
  selectedCondition: "good",
  baseCondition: "good",
  conditionValues: {
    fair: {
      tradeIn: "Unavailable",
      privateParty: "Unavailable",
      dealerRetail: "$285,000",
      low: "$260,000",
      median: "$285,000",
      high: "$315,000",
    },
    good: {
      tradeIn: "Unavailable",
      privateParty: "Unavailable",
      dealerRetail: "$300,000",
      low: "$275,000",
      median: "$300,000",
      high: "$330,000",
    },
    excellent: {
      tradeIn: "Unavailable",
      privateParty: "Unavailable",
      dealerRetail: "$318,000",
      low: "$292,000",
      median: "$318,000",
      high: "$350,000",
    },
  },
  tradeIn: "Unavailable",
  tradeInRange: "Unavailable",
  privateParty: "Unavailable",
  privatePartyRange: "Unavailable",
  dealerRetail: "$300,000",
  dealerRetailRange: "Condition-adjusted estimate",
  low: "$275,000",
  high: "$330,000",
  median: "$300,000",
  confidenceLabel: "Based on live MarketCheck listings. Condition-adjusted estimate.",
  sourceLabel: "MarketCheck live market value",
  message: null,
  reason: null,
  listingCount: 8,
  sourceBasis: "listing_median_adjusted",
  modelType: "listing_derived",
};

test("changing displayed condition resolves locally without producing unavailable $0 placeholders", () => {
  const fair = resolveConditionValues(loadedConditionSet, "fair");
  const excellent = resolveConditionValues(loadedConditionSet, "excellent");

  assert.equal(fair.selectedCondition, "fair");
  assert.equal(fair.dealerRetail, "$285,000");
  assert.equal(fair.low, "$260,000");
  assert.equal(fair.status, "loaded_condition_set");

  assert.equal(excellent.selectedCondition, "excellent");
  assert.equal(excellent.dealerRetail, "$318,000");
  assert.equal(excellent.high, "$350,000");
  assert.notEqual(excellent.dealerRetail, "$0");
});
