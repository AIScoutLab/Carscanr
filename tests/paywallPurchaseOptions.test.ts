import assert from "node:assert/strict";
import test from "node:test";
import {
  getMissingPurchaseOptionKinds,
  getPreferredPurchaseProduct,
  getPurchaseOptionKind,
  getPurchaseOptionTitle,
  sortPurchaseProductsForDisplay,
} from "@/lib/purchaseOptions";
import { SubscriptionProduct } from "@/types";

function product(input: Partial<SubscriptionProduct> & Pick<SubscriptionProduct, "productId" | "priceLabel" | "billingPeriodLabel">): SubscriptionProduct {
  return {
    platform: "ios",
    plan: "pro",
    ...input,
  };
}

test("paywall renders distinct RevenueCat package options when packages are available", () => {
  const products = [
    product({
      productId: "com.carscanr.unlock_pack_5",
      packageIdentifier: "unlock_pack_5",
      optionKind: "unlock_pack",
      priceLabel: "$2.99",
      billingPeriodLabel: "unlock pack",
    }),
    product({
      productId: "com.carscanr.pro.monthly",
      packageIdentifier: "$rc_monthly",
      optionKind: "monthly",
      priceLabel: "$4.99",
      billingPeriodLabel: "month",
    }),
    product({
      productId: "com.carscanr.pro.yearly",
      packageIdentifier: "$rc_annual",
      optionKind: "annual",
      priceLabel: "$39.99",
      billingPeriodLabel: "year",
    }),
  ];

  const sorted = sortPurchaseProductsForDisplay(products);
  assert.deepEqual(sorted.map(getPurchaseOptionKind), ["annual", "monthly", "unlock_pack"]);
  assert.equal(getPreferredPurchaseProduct(products)?.productId, "com.carscanr.pro.yearly");
  assert.deepEqual(getMissingPurchaseOptionKinds(products), []);
  assert.deepEqual(sorted.map(getPurchaseOptionTitle), ["Yearly Pro", "Monthly Pro", "5 unlock pack"]);
});

test("paywall reports missing monthly and unlock pack packages instead of hiding them silently", () => {
  const products = [
    product({
      productId: "com.carscanr.pro.yearly",
      packageIdentifier: "$rc_annual",
      optionKind: "annual",
      priceLabel: "$39.99",
      billingPeriodLabel: "year",
    }),
  ];

  assert.deepEqual(getMissingPurchaseOptionKinds(products), ["monthly", "unlock_pack"]);
});
