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

test("profile does not treat unlock pack entitlement product as Pro", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "free",
      provider: "revenuecat",
      productId: "carscanr.unlockpack.5",
      renewalLabel: "Pro active",
      isActive: true,
    }),
  );

  assert.equal(resolved.mode, "free");
  assert.equal(resolved.planLabel, "Free plan");
  assert.equal(renderedText(resolved).includes("Pro active"), false);
  assert.equal(renderedText(resolved).includes("Pro monthly active"), false);
  assert.equal(resolved.showUpgradeOptions, true);
  assert.equal(resolved.showFreeUnlockUsage, true);
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

test("profile distinguishes configured RevenueCat offerings with no packages from missing config", () => {
  const resolved = resolveProfileAccessState(
    status({
      purchaseAvailabilityState: "offerings_empty",
      purchaseAvailable: false,
      availableProducts: [],
    }),
  );

  assert.equal(resolved.mode, "free");
  assert.equal(resolved.renewalLabel, "RevenueCat is configured, but no purchasable packages were returned.");
  assert.equal(resolved.purchaseAvailabilityState, "offerings_empty");
  assert.equal(resolved.showPaywallCard, true);
});

test("profile subscription card renders upgrade surfaces from access selector only", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");

  assert.match(profileSource, /accessState\.showFreeUnlockUsage\s*\?\s*\(/);
  assert.match(profileSource, /accessState\.showPrimaryUpgradeCta\s*\?\s*\(/);
  assert.match(profileSource, /<Text style={styles\.upgradeButtonText}>Upgrade to Pro<\/Text>/);
  assert.doesNotMatch(profileSource, /accessState\.showUpgradeOptions\s*\?\s*<PaywallCard/);
  assert.doesNotMatch(profileSource, /View Pro Status/);
});

test("profile legal rows use in-app routes and support rows keep mailto actions", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const supportStart = profileSource.indexOf('<SectionLabel label="Support" />');
  const legalStart = profileSource.indexOf('<SectionLabel label="Legal" />');
  const aboutStart = profileSource.indexOf('<SectionLabel label="About" />');
  const supportBlock = profileSource.slice(supportStart, legalStart);
  const legalBlock = profileSource.slice(legalStart, aboutStart);

  assert.notEqual(supportStart, -1, "Support section was not found");
  assert.notEqual(legalStart, -1, "Legal section was not found");
  assert.notEqual(aboutStart, -1, "About section was not found");
  assert.match(supportBlock, /label="Contact Support"/);
  assert.match(supportBlock, /openSupportEmail\(\)/);
  assert.match(supportBlock, /label="Report an Issue"/);
  assert.match(supportBlock, /openSupportEmail\("CarScanr Issue Report"\)/);
  assert.match(supportBlock, /label="Request a Feature"/);
  assert.match(supportBlock, /openSupportEmail\("CarScanr Feature Request"\)/);
  assert.match(legalBlock, /label="Privacy Policy"/);
  assert.match(legalBlock, /router\.push\("\/legal\/privacy-policy" as never\)/);
  assert.match(legalBlock, /label="Terms of Service"/);
  assert.match(legalBlock, /router\.push\("\/legal\/terms-of-service" as never\)/);
  assert.doesNotMatch(legalBlock, /openSupportEmail|mailto:/);
  assert.doesNotMatch(profileSource, /Terms & Privacy|CarScanr Privacy Question|CarScanr Terms and Privacy|support@carscanr\.app/);
});

test("profile about rows keep native and OTA diagnostics visible in the requested order", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const aboutStart = profileSource.indexOf('<SectionLabel label="About" />');
  const diagnosticsStart = profileSource.indexOf('<SectionLabel label="OTA Diagnostics" />', aboutStart);
  const subscriptionManagementStart = profileSource.indexOf('<SectionLabel label="Subscription Management" />', aboutStart);
  const aboutEnd = diagnosticsStart > -1 ? diagnosticsStart : subscriptionManagementStart;
  const aboutBlock = profileSource.slice(aboutStart, aboutEnd);
  const orderedLabels = [
    "Native App Version",
    "Native Build",
    "Runtime",
    "Active OTA Update ID",
    "Active OTA Commit",
    "Is Embedded Launch",
    "Is Emergency Launch",
  ];
  let previousIndex = -1;

  assert.notEqual(aboutStart, -1, "About section was not found");
  assert.notEqual(aboutEnd, -1, "About section end was not found");
  for (const label of orderedLabels) {
    const nextIndex = aboutBlock.indexOf(`label="${label}"`);
    assert.ok(nextIndex > previousIndex, `${label} should appear after the previous About row`);
    previousIndex = nextIndex;
  }
  assert.doesNotMatch(aboutBlock, /label="Embedded Commit"|label="Channel"/);
});

test("profile separates subscription management from sign out at the bottom", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const accountStart = profileSource.indexOf('<SectionLabel label="Account" />');
  const supportStart = profileSource.indexOf('<SectionLabel label="Support" />');
  const legalStart = profileSource.indexOf('<SectionLabel label="Legal" />');
  const aboutStart = profileSource.indexOf('<SectionLabel label="About" />');
  const subscriptionManagementStart = profileSource.indexOf('<SectionLabel label="Subscription Management" />');
  const accountBlock = profileSource.slice(accountStart, supportStart);

  assert.ok(accountStart > -1 && supportStart > accountStart, "Account and Support sections should be ordered");
  assert.ok(legalStart > supportStart, "Legal should follow Support");
  assert.ok(aboutStart > legalStart, "About should follow Legal");
  assert.ok(subscriptionManagementStart > aboutStart, "Subscription Management should follow About and diagnostics");
  assert.match(accountBlock, /Restore Purchases/);
  assert.match(accountBlock, /Sign Out/);
  assert.doesNotMatch(accountBlock, /Manage Subscription|Cancel Pro|Cancelling Pro/);
  assert.match(profileSource, /profile-manage-subscription/);
  assert.match(profileSource, /label=\{isCancelling \? "Opening Subscription Management\.\.\." : "Manage Subscription"\}/);
  assert.match(profileSource, /subscriptionManagementSection/);
  assert.doesNotMatch(profileSource, /Cancel Pro|Cancelling Pro|Cancel Subscription/);
});

test("subscription management opens RevenueCat native management instead of backend cancel", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const purchaseSource = fs.readFileSync(path.join(process.cwd(), "services/purchaseService.ts"), "utf8");
  const serviceSource = fs.readFileSync(path.join(process.cwd(), "services/subscriptionService.ts"), "utf8");
  const cancelStart = serviceSource.indexOf("async cancelSubscription()");
  const cancelEnd = serviceSource.indexOf("async syncSubscriptionToBackend", cancelStart);
  const cancelBlock = serviceSource.slice(cancelStart, cancelEnd);

  assert.match(profileSource, /handleManageSubscription/);
  assert.match(purchaseSource, /Purchases\.showManageSubscriptions\(\)/);
  assert.match(cancelBlock, /purchaseService\.openSubscriptionManagement\(\)/);
  assert.doesNotMatch(cancelBlock, /\/api\/subscription\/cancel|Pro access cancelled|Free plan/);
});
