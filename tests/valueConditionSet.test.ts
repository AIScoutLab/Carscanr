import assert from "node:assert/strict";
import test from "node:test";
import { buildListingDerivedConditionSetFromListings, resolveConditionValues } from "@/lib/valueConditionSet";
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

test("audi a4 listings create a condition set", () => {
  const result = buildListingDerivedConditionSetFromListings({
    listings: [{ price: "$24,995" }, { price: "$26,995" }, { price: "$28,495" }],
    selectedCondition: "good",
    make: "Audi",
  });

  assert.ok(result);
  assert.equal(result?.status, "loaded_condition_set");
  assert.equal(result?.listingCount, 3);
  assert.equal(result?.valuationSource, "listing_comps");
  assert.equal(result?.compCount, 3);
  assert.equal(result?.confidence, "moderate");
  assert.equal(result?.median, "$26,995");
});

test("jeep liberty single listing creates low median and high from one comp", () => {
  const result = buildListingDerivedConditionSetFromListings({
    listings: [{ price: "$9,995" }],
    selectedCondition: "good",
    make: "Jeep",
  });

  assert.ok(result);
  assert.equal(result?.status, "loaded_condition_set");
  assert.equal(result?.low, "$9,995");
  assert.equal(result?.median, "$9,995");
  assert.equal(result?.high, "$9,995");
  assert.equal(result?.confidence, "limited");
  assert.equal(result?.midpoint, "$9,995");
});

test("ferrari listings create a condition set with specialty copy", () => {
  const result = buildListingDerivedConditionSetFromListings({
    listings: [{ price: "$209,995" }, { price: "$219,995" }],
    selectedCondition: "good",
    make: "Ferrari",
  });

  assert.ok(result);
  assert.equal(result?.status, "loaded_condition_set");
  assert.match(result?.confidenceLabel ?? "", /Actual pricing may vary/);
  assert.equal(result?.valuationSource, "listing_comps");
  assert.equal(JSON.stringify(result).includes("\"$0\""), false);
});

test("one nearby listing still produces a limited-comp listing-derived estimate instead of unavailable", () => {
  const result = buildListingDerivedConditionSetFromListings({
    listings: [{ price: "$209,995" }],
    selectedCondition: "good",
    make: "Ferrari",
    sourceLabel: "Estimated from nearby comparable listings",
  });

  assert.ok(result);
  assert.equal(result?.status, "loaded_condition_set");
  assert.equal(result?.low, "$209,995");
  assert.equal(result?.median, "$209,995");
  assert.equal(result?.high, "$209,995");
  assert.equal(result?.compCount, 1);
  assert.equal(result?.confidence, "limited");
  assert.match(result?.confidenceLabel ?? "", /Limited/i);
});
