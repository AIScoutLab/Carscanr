import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ProfileAccessState, resolveProfileAccessState } from "@/lib/subscription";
import { SubscriptionStatus } from "@/types";

const profileSourcePath = path.join(process.cwd(), "app/(tabs)/profile.tsx");

function status(input: Partial<SubscriptionStatus>): SubscriptionStatus {
  return {
    plan: "free",
    renewalLabel: "Upgrade for unlimited Pro details",
    scansUsed: 0,
    scansRemaining: null,
    limitType: "lifetime",
    limit: null,
    scansUsedToday: 0,
    dailyScanLimit: null,
    purchaseAvailabilityState: "ready",
    purchaseAvailable: true,
    availableProducts: [],
    ...input,
  };
}

function renderedText(state: ProfileAccessState) {
  return [
    state.planLabel,
    state.renewalLabel,
    state.showFreeUnlockUsage ? "free unlock usage" : null,
    state.showPrimaryUpgradeCta ? "Upgrade to Pro" : null,
    state.showPaywallCard ? "paywall card" : null,
    state.showRestorePurchases ? "Restore Purchases" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

test("profile access state never renders free plan and active pro together", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "free",
      provider: "placeholder",
      renewalLabel: "Pro active",
      isActive: false,
    }),
  );

  assert.equal(resolved.planLabel, "Free plan");
  assert.equal(renderedText(resolved).includes("Pro active"), false);
  assert.equal(resolved.showUpgradeOptions, true);
  assert.equal(resolved.showFreeUnlockUsage, true);
});

test("profile treats trusted active entitlement as pro even when free usage state is stale", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "free",
      provider: "revenuecat",
      productId: "com.carscanr.pro.yearly",
      renewalLabel: "Pro active",
      isActive: true,
    }),
  );

  assert.equal(resolved.mode, "pro");
  assert.equal(resolved.planLabel, "Pro yearly active");
  assert.equal(renderedText(resolved).includes("Free plan"), false);
  assert.equal(resolved.showUpgradeOptions, false);
  assert.equal(resolved.showPrimaryUpgradeCta, false);
  assert.equal(resolved.showPaywallCard, false);
  assert.equal(resolved.showFreeUnlockUsage, false);
  assert.equal(resolved.showRestorePurchases, true);
});

test("profile hides upgrade card, primary upgrade CTA, and free unlock usage when entitlement is active", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "pro_yearly",
      provider: "revenuecat",
      productId: "com.carscanr.pro.yearly",
      renewalLabel: "Pro active",
      isActive: true,
    }),
  );

  assert.equal(resolved.planLabel, "Pro yearly active");
  assert.equal(resolved.showUpgradeOptions, false);
  assert.equal(resolved.showPrimaryUpgradeCta, false);
  assert.equal(resolved.showPaywallCard, false);
  assert.equal(resolved.showFreeUnlockUsage, false);
  assert.equal(resolved.showRestorePurchases, true);
});

test("profile loading state does not render free access or upgrade as the temporary plan", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "free",
      provider: "placeholder",
      isActive: false,
    }),
    true,
  );

  assert.equal(resolved.mode, "loading");
  assert.equal(resolved.planLabel, "Checking plan...");
  assert.equal(renderedText(resolved).includes("Free plan"), false);
  assert.equal(renderedText(resolved).includes("Pro active"), false);
  assert.equal(resolved.showUpgradeOptions, false);
  assert.equal(resolved.showPrimaryUpgradeCta, false);
  assert.equal(resolved.showPaywallCard, false);
  assert.equal(resolved.showFreeUnlockUsage, false);
});

test("profile does not treat placeholder pro-looking state as an active purchase", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "pro",
      provider: "placeholder",
      productId: null,
      renewalLabel: "Pro active on this device",
      isActive: true,
      purchaseAvailabilityState: "not_configured",
      purchaseAvailable: false,
    }),
  );

  assert.equal(resolved.mode, "free");
  assert.equal(resolved.planLabel, "Free plan");
  assert.equal(renderedText(resolved).includes("Pro active"), false);
  assert.equal(resolved.showUpgradeOptions, true);
  assert.equal(resolved.showPrimaryUpgradeCta, true);
  assert.equal(resolved.showPaywallCard, true);
  assert.equal(resolved.showFreeUnlockUsage, true);
});

test("profile does not treat an inactive trusted pro record as active entitlement", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "pro_yearly",
      provider: "backend",
      productId: "com.carscanr.pro.yearly",
      renewalLabel: "Pro active",
      isActive: false,
    }),
  );

  assert.equal(resolved.mode, "free");
  assert.equal(resolved.planLabel, "Free plan");
  assert.equal(renderedText(resolved).includes("Pro active"), false);
  assert.equal(resolved.showUpgradeOptions, true);
  assert.equal(resolved.showPrimaryUpgradeCta, true);
  assert.equal(resolved.showPaywallCard, true);
  assert.equal(resolved.showFreeUnlockUsage, true);
});

test("profile subscription card renders upgrade and paywall surfaces from access selector only", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");

  assert.match(profileSource, /accessState\.showFreeUnlockUsage\s*\?\s*\(/);
  assert.match(profileSource, /accessState\.showPaywallCard\s*\?\s*<PaywallCard/);
  assert.match(profileSource, /accessState\.showPrimaryUpgradeCta\s*\?\s*<PrimaryButton label="Upgrade to Pro"/);
  assert.doesNotMatch(profileSource, /accessState\.showUpgradeOptions\s*\?\s*<PaywallCard/);
  assert.doesNotMatch(profileSource, /View Pro Status/);
});
