import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getPaywallAuthHref,
  getPaywallReturnTo,
  getPaywallSelectedOptionKind,
  getPaidPurchaseAuthRequiredMessage,
  PAID_PURCHASE_AUTH_REQUIRED_MESSAGE,
  PAID_PURCHASE_SIGN_IN_REQUIRED_MESSAGE,
  requiresSignInBeforePaidPurchase,
  UNLOCK_PACK_ACCOUNT_REQUIRED_COPY,
} from "@/lib/paywallPurchaseAuth";
import { SubscriptionProduct } from "@/types";

const repoRoot = path.resolve(__dirname, "..");

function product(optionKind: SubscriptionProduct["optionKind"]): SubscriptionProduct {
  return {
    platform: "ios",
    plan: "pro",
    optionKind,
    productId: `com.carscanr.${optionKind}`,
    priceLabel: "$1.00",
    billingPeriodLabel: optionKind === "unlock_pack" ? "unlock pack" : "month",
  };
}

test("signed-out user selecting 5 Unlock Pack cannot start purchase", () => {
  assert.equal(requiresSignInBeforePaidPurchase({ isSignedIn: false, product: product("unlock_pack") }), true);
  assert.equal(PAID_PURCHASE_AUTH_REQUIRED_MESSAGE, "Create an account or sign in before buying unlock packs so we can credit them to your account.");
});

test("signed-out user is routed to auth and returns to the selected unlock pack", () => {
  assert.equal(getPaywallReturnTo("unlock_pack"), "/paywall?selectedOption=unlock_pack");
  assert.equal(getPaywallAuthHref("unlock_pack"), "/auth?mode=sign-in&returnTo=%2Fpaywall%3FselectedOption%3Dunlock_pack");
  assert.equal(getPaywallSelectedOptionKind("unlock_pack"), "unlock_pack");
});

test("signed-in user can purchase 5 Unlock Pack", () => {
  assert.equal(requiresSignInBeforePaidPurchase({ isSignedIn: true, product: product("unlock_pack") }), false);
});

test("subscriptions require sign-in under the launch-safe purchase policy", () => {
  assert.equal(requiresSignInBeforePaidPurchase({ isSignedIn: false, product: product("annual") }), true);
  assert.equal(requiresSignInBeforePaidPurchase({ isSignedIn: false, product: product("monthly") }), true);
  assert.equal(requiresSignInBeforePaidPurchase({ isSignedIn: true, product: product("annual") }), false);
  assert.equal(requiresSignInBeforePaidPurchase({ isSignedIn: true, product: product("monthly") }), false);
  assert.equal(getPaidPurchaseAuthRequiredMessage("annual"), PAID_PURCHASE_SIGN_IN_REQUIRED_MESSAGE);
  assert.equal(getPaidPurchaseAuthRequiredMessage("unlock_pack"), PAID_PURCHASE_AUTH_REQUIRED_MESSAGE);
});

test("paywall gates purchase before RevenueCat purchase and keeps restore available", () => {
  const paywallSource = fs.readFileSync(path.join(repoRoot, "app/paywall.tsx"), "utf8");
  const authGateIndex = paywallSource.indexOf("requiresSignInBeforePaidPurchase");
  const purchaseIndex = paywallSource.indexOf("purchasePro(getPurchaseOptionKey(selectedProduct))");
  const restoreIndex = paywallSource.indexOf("restorePurchases()");

  assert.ok(authGateIndex > -1, "paywall must check auth before paid purchase");
  assert.ok(purchaseIndex > -1, "paywall must still call purchasePro for eligible users");
  assert.ok(authGateIndex < purchaseIndex, "auth gate must run before purchasePro");
  assert.ok(restoreIndex > -1, "restore purchases should remain available");
  assert.match(paywallSource, /router\.replace\(authHref as never\)/);
  assert.doesNotMatch(paywallSource, /router\.push\(authHref as never\)/);
  assert.equal(paywallSource.includes("UNLOCK_PACK_ACCOUNT_REQUIRED_COPY"), true);
  assert.equal(UNLOCK_PACK_ACCOUNT_REQUIRED_COPY, "Account required so credits can be saved.");
});

test("auth return target is consumed and keyboard-safe while preserving paywall selection", () => {
  const authSource = fs.readFileSync(path.join(repoRoot, "app/auth.tsx"), "utf8");

  assert.match(authSource, /consumePendingAuthReturnTarget\(explicitReturnTo \?\? returnTo\)/);
  assert.match(authSource, /router\.replace\(target as Href\)/);
  assert.match(authSource, /Keyboard\.addListener\(keyboardShowEvent/);
  assert.match(authSource, /isKeyboardVisible && styles\.contentKeyboardVisible/);
  assert.match(authSource, /styles\.cardKeyboardVisible/);
  assert.match(authSource, /onFocus=\{\(\) => setFocusedField\("email"\)\}/);
  assert.match(authSource, /onFocus=\{\(\) => setFocusedField\("password"\)\}/);
  assert.match(authSource, /!isKeyboardVisible \? <View style=\{styles\.guestNoteCard\}>/);
  assert.doesNotMatch(authSource, /scrollToEnd/);
  assert.doesNotMatch(authSource, /scrollTo\(\{ y:/);
  assert.doesNotMatch(authSource, /automaticallyAdjustKeyboardInsets/);
  assert.doesNotMatch(authSource, /keyboardHeight \+ 72/);
  assert.equal(getPaywallAuthHref("monthly"), "/auth?mode=sign-in&returnTo=%2Fpaywall%3FselectedOption%3Dmonthly");
});

test("create account mode uses the same compact keyboard-safe form without auto-scroll", () => {
  const authSource = fs.readFileSync(path.join(repoRoot, "app/auth.tsx"), "utf8");

  assert.match(authSource, /mode === "sign-in" \? "Welcome back\." : "Create your account\."/);
  assert.match(authSource, /mode === "sign-in" \? "Sign In" : "Create Account"/);
  assert.match(authSource, /mode === "sign-in" \? "Already have an account" : "Create with email"/);
  assert.match(authSource, /contentInnerKeyboardVisible/);
  assert.match(authSource, /titleKeyboardVisible/);
  assert.match(authSource, /cardKeyboardVisible/);
  assert.doesNotMatch(authSource, /scrollFormIntoView/);
  assert.doesNotMatch(authSource, /formTop/);
});
