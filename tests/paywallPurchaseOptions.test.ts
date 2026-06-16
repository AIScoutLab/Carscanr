import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getPurchaseOptionKindFromProductMetadata,
  getMissingPurchaseOptionKinds,
  getPreferredPurchaseProduct,
  getPurchaseOptionKind,
  getPurchaseOptionTitle,
  isUnlockPackProductId,
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

test("live product ids classify subscriptions and unlock pack distinctly", () => {
  assert.equal(getPurchaseOptionKindFromProductMetadata({ productId: "carscanr.pro.monthly" }), "monthly");
  assert.equal(getPurchaseOptionKindFromProductMetadata({ productId: "com.carscanr.pro.yearly" }), "annual");
  assert.equal(getPurchaseOptionKindFromProductMetadata({ productId: "carscanr.unlockpack.5" }), "unlock_pack");
  assert.equal(isUnlockPackProductId("carscanr.unlockpack.5"), true);
  assert.equal(isUnlockPackProductId("carscanr.pro.monthly"), false);
});

test("unlock pack purchase routes to unlock success instead of Pro activated", () => {
  const paywallSource = fs.readFileSync(path.join(process.cwd(), "app/paywall.tsx"), "utf8");
  const unlockSuccessSource = fs.readFileSync(path.join(process.cwd(), "app/unlocks-added.tsx"), "utf8");

  assert.match(paywallSource, /result\.purchaseKind === "unlock_pack"[\s\S]*router\.replace\("\/unlocks-added"(?: as never)?\)/);
  assert.match(paywallSource, /result\.status\.provider === "backend"[\s\S]*router\.replace\("\/pro-activated"\)/);
  assert.match(paywallSource, /result\.purchaseKind === "annual" \|\| result\.purchaseKind === "monthly"[\s\S]*router\.replace\("\/\(tabs\)\/profile"\)/);
  assert.match(unlockSuccessSource, /5 unlocks added/);
  assert.match(unlockSuccessSource, /Your account now has/);
  assert.doesNotMatch(unlockSuccessSource, /Pro activated|Unlimited scans/);
});

test("subscription purchase waits for backend confirmation before leaving pending sync", () => {
  const purchaseSource = fs.readFileSync(path.join(process.cwd(), "services/purchaseService.ts"), "utf8");
  const subscriptionSource = fs.readFileSync(path.join(process.cwd(), "services/subscriptionService.ts"), "utf8");

  assert.match(purchaseSource, /Purchases\.invalidateCustomerInfoCache\(\)/);
  assert.match(subscriptionSource, /POST_PURCHASE_BACKEND_SYNC_DELAYS_MS = \[0, 1000, 2000, 3500, 5000\]/);
  assert.match(subscriptionSource, /syncRevenueCatActiveSubscriptionToBackend/);
  assert.match(subscriptionSource, /pollBackendSubscriptionStatusAfterPurchase/);
  assert.match(subscriptionSource, /path: "\/api\/subscription\/verify"/);
  assert.match(subscriptionSource, /revenueCatIdentity/);
  assert.match(subscriptionSource, /backendSynced: true/);
  assert.match(subscriptionSource, /Purchase completed\. Pro access is still syncing\. Try refreshing or restarting the app\./);
});

test("backend sync denial stops indefinite Pro syncing with a clear support message", () => {
  const subscriptionSource = fs.readFileSync(path.join(process.cwd(), "services/subscriptionService.ts"), "utf8");
  const message =
    "Purchase found, but Pro access could not be safely verified. If this is sandbox testing, use a fresh sandbox tester. Otherwise contact support.";

  assert.match(subscriptionSource, /BACKEND_SUBSCRIPTION_SYNC_DENIED_MESSAGE/);
  assert.match(subscriptionSource, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(subscriptionSource, /revenueCatSync\?: \{ status: "granted" \} \| \{ status: "denied"; reason\?: string \| null \}/);
  assert.match(subscriptionSource, /isBackendSubscriptionSyncDenied/);
  assert.match(subscriptionSource, /backendRecord && !isBackendSubscriptionRecordActivePro\(backendRecord\)/);
  assert.match(subscriptionSource, /backendSyncDenied: isBackendSubscriptionSyncDenied\(backendRecord\)/);
  assert.match(subscriptionSource, /message: BACKEND_SUBSCRIPTION_SYNC_DENIED_MESSAGE/);
  assert.match(subscriptionSource, /syncRevenueCatActiveSubscriptionToBackend\(restore\.snapshot/);
  assert.match(subscriptionSource, /source: "restore"/);
  assert.doesNotMatch(subscriptionSource, /plan:\s*restore\.snapshot\.activeEntitlement\?\.isActive \? "pro"/);
});
