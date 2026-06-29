import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ProfileAccessState, resolveProfileAccessState } from "@/lib/subscription";
import { SubscriptionStatus } from "@/types";

const profileSourcePath = path.join(process.cwd(), "app/(tabs)/profile.tsx");
const scanSourcePath = path.join(process.cwd(), "app/(tabs)/scan.tsx");

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

test("RevenueCat active monthly with backend inactive is free unless a current subscription sync is pending", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "free",
      provider: "revenuecat",
      productId: "carscanr.pro.monthly",
      renewalLabel: "Pro active",
      isActive: true,
      entitlementSyncState: "none",
    }),
  );

  assert.equal(resolved.mode, "free");
  assert.equal(resolved.hasProEntitlement, false);
  assert.equal(resolved.hasPendingProSync, false);
  assert.equal(resolved.planLabel, "Free plan");
  assert.equal(renderedText(resolved).includes("Pro monthly active"), false);
  assert.equal(renderedText(resolved).includes("Pro access syncing"), false);
  assert.equal(resolved.showUpgradeOptions, true);
  assert.equal(resolved.showPrimaryUpgradeCta, true);
  assert.equal(resolved.showPaywallCard, true);
  assert.equal(resolved.showFreeUnlockUsage, true);
  assert.equal(resolved.showRestorePurchases, true);
});

test("current subscription purchase pending backend confirmation can show Pro syncing", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "free",
      provider: "revenuecat",
      productId: "carscanr.pro.monthly",
      renewalLabel: "Pro active",
      isActive: true,
      entitlementSyncState: "revenuecat_active_backend_pending",
    }),
  );

  assert.equal(resolved.mode, "free");
  assert.equal(resolved.hasProEntitlement, false);
  assert.equal(resolved.hasPendingProSync, true);
  assert.equal(resolved.planLabel, "Pro access syncing");
  assert.equal(resolved.renewalLabel, "Purchase or restore detected. Backend access has not confirmed Pro yet.");
  assert.equal(renderedText(resolved).includes("Pro monthly active"), false);
  assert.equal(renderedText(resolved).includes("Free plan"), false);
  assert.equal(resolved.showUpgradeOptions, false);
  assert.equal(resolved.showPrimaryUpgradeCta, false);
  assert.equal(resolved.showPaywallCard, false);
  assert.equal(resolved.showFreeUnlockUsage, true);
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
  assert.equal(resolved.hasPendingProSync, false);
  assert.equal(renderedText(resolved).includes("Pro active"), false);
  assert.equal(renderedText(resolved).includes("Pro monthly active"), false);
  assert.equal(renderedText(resolved).includes("Pro access syncing"), false);
  assert.equal(resolved.showUpgradeOptions, true);
  assert.equal(resolved.showFreeUnlockUsage, true);
});

test("profile hides upgrade card, primary upgrade CTA, and free unlock usage when entitlement is active", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "pro_monthly",
      provider: "backend",
      productId: "carscanr.pro.monthly",
      renewalLabel: "Pro active",
      isActive: true,
    }),
  );

  assert.equal(resolved.planLabel, "Pro monthly active");
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
  assert.match(profileSource, /accessState\.hasPendingProSync \? "sync-outline" : "checkmark-circle-outline"/);
  assert.match(profileSource, /<Text style={styles\.upgradeButtonText}>Upgrade to Pro<\/Text>/);
  assert.doesNotMatch(profileSource, /accessState\.showUpgradeOptions\s*\?\s*<PaywallCard/);
  assert.doesNotMatch(profileSource, /View Pro Status/);
});

test("profile refreshes backend subscription status on focus and auth changes", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");

  assert.match(profileSource, /refreshStatus,/);
  assert.match(profileSource, /const refreshProfileState = useCallback\(async \(\) => \{/);
  assert.match(profileSource, /Promise\.all\(\[refreshAuthSnapshot\(\), refreshStatus\(\)\]\)/);
  assert.match(profileSource, /useFocusEffect\([\s\S]*refreshProfileState\(\)\.catch/);
  assert.match(profileSource, /supabase\.auth\.onAuthStateChange\(\(event\) => \{/);
  assert.match(profileSource, /event === "SIGNED_IN" \|\| event === "SIGNED_OUT" \|\| event === "TOKEN_REFRESHED" \|\| event === "USER_UPDATED"/);
});

test("profile keeps paid unlock credits visible separately from Pro status", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const providerSource = fs.readFileSync(path.join(process.cwd(), "features/subscription/SubscriptionProvider.tsx"), "utf8");
  const subscriptionSource = fs.readFileSync(path.join(process.cwd(), "services/subscriptionService.ts"), "utf8");
  const backendUnlockSource = fs.readFileSync(path.join(process.cwd(), "backend/src/services/unlockService.ts"), "utf8");
  const usageSource = fs.readFileSync(path.join(process.cwd(), "backend/src/services/usageService.ts"), "utf8");

  assert.match(profileSource, /formatFreeUnlockBalance\(remainingUnlocks, freeUnlocksLimit\)/);
  assert.match(profileSource, /formatPurchasedUnlockBalance\(unlockCredits\)/);
  assert.match(providerSource, /unlockCredits/);
  assert.match(subscriptionSource, /unlockCreditsRemaining/);
  assert.match(subscriptionSource, /scan_cache_fallback/);
  assert.match(backendUnlockSource, /unlockCreditsRemaining: balance\.unlockCredits/);
  assert.match(backendUnlockSource, /totalUnlocksAvailable: remaining \+ balance\.unlockCredits/);
  assert.match(usageSource, /unlockCreditsRemaining: unlockStatus\.unlockCreditsRemaining/);
});

test("scan unlock badge accounts for purchased credits separately from free unlocks", () => {
  const scanSource = fs.readFileSync(scanSourcePath, "utf8");

  assert.match(scanSource, /unlockCredits/);
  assert.match(scanSource, /purchasedUnlockCredits/);
  assert.match(scanSource, /totalUnlocksAvailable/);
  assert.match(scanSource, /formatCompactUnlockBalanceSummary/);
});

test("subscription service keeps backend authoritative over RevenueCat entitlements", () => {
  const serviceSource = fs.readFileSync(path.join(process.cwd(), "services/subscriptionService.ts"), "utf8");
  const subscriptionSource = fs.readFileSync(path.join(process.cwd(), "lib/subscription.ts"), "utf8");

  assert.match(serviceSource, /getRevenueCatSubscriptionSyncOverrides/);
  assert.match(serviceSource, /syncRevenueCatActiveSubscriptionToBackend/);
  assert.match(serviceSource, /allowPendingSync/);
  assert.match(serviceSource, /provider: backendHasPro \? "backend" : showPendingSync \|\| showMismatch \? "revenuecat" : usage\.provider/);
  assert.match(serviceSource, /productId: backendHasPro \|\| showPendingSync \|\| showMismatch \? snapshot\.activeProductId : usage\.productId \?\? null/);
  assert.match(serviceSource, /entitlementSyncState: showMismatch \? "revenuecat_active_backend_mismatch" : showPendingSync \? "revenuecat_active_backend_pending" : "none"/);
  assert.match(serviceSource, /syncFailedReason: getRevenueCatSyncFailureReason\(backendRecord\)/);
  assert.match(subscriptionSource, /return status\?\.entitlementSyncState === "revenuecat_active_backend_pending"/);
  assert.match(subscriptionSource, /return status\?\.entitlementSyncState === "revenuecat_active_backend_mismatch"/);
  assert.doesNotMatch(serviceSource, /plan:\s*"pro",\s*provider:\s*"revenuecat"/);
  assert.doesNotMatch(serviceSource, /plan:\s*restore\.snapshot\.activeEntitlement\?\.isActive \? "pro"/);
  assert.doesNotMatch(serviceSource, /plan:\s*management\.snapshot\.activeEntitlement\?\.isActive \? "pro"/);
});

test("subscription purchases and restore request backend RevenueCat sync before showing active Pro", () => {
  const serviceSource = fs.readFileSync(path.join(process.cwd(), "services/subscriptionService.ts"), "utf8");
  const purchaseSource = fs.readFileSync(path.join(process.cwd(), "services/purchaseService.ts"), "utf8");

  assert.match(serviceSource, /source: "purchase"/);
  assert.match(serviceSource, /source: "restore"/);
  assert.match(serviceSource, /path: "\/api\/subscription\/verify"/);
  assert.match(serviceSource, /revenueCatIdentity: snapshot\.revenueCatIdentity/);
  assert.match(purchaseSource, /Purchases\.getAppUserID\(\)/);
  assert.match(purchaseSource, /originalAppUserId/);
  assert.match(purchaseSource, /activeEntitlementIds/);
  assert.match(purchaseSource, /activeProductIds/);
  assert.match(serviceSource, /getBackendSubscriptionStatusOverrides\(backendRecord, purchase\.snapshot\)/);
  assert.match(serviceSource, /getBackendSubscriptionStatusOverrides\(backendRecord, restore\.snapshot\)/);
  assert.match(serviceSource, /backendRecord && isProPlan\(backendRecord\.plan\) && backendRecord\.status === "active"/);
  assert.match(serviceSource, /getRevenueCatSubscriptionSyncOverrides\(\s*latestUsage,\s*purchase\.snapshot,\s*\{\s*allowPendingSync: false,\s*syncFailedReason: getRevenueCatSyncFailureReason\(backendRecord\) \?\? POST_PURCHASE_BACKEND_CONFIRMATION_TIMEOUT_REASON,\s*\}/);
  assert.match(serviceSource, /backendConfirmationTimedOut: true/);
  assert.match(serviceSource, /message: BACKEND_SUBSCRIPTION_SYNC_DENIED_MESSAGE/);
  assert.match(serviceSource, /getRevenueCatSubscriptionSyncOverrides\(\s*usage,\s*restore\.snapshot,\s*\{\s*allowPendingSync: true,\s*syncFailedReason: getRevenueCatSyncFailureReason\(backendRecord\),\s*\}/);
});

test("backend RevenueCat identity mismatch remains non-Pro and avoids permanent local grant", () => {
  const resolved = resolveProfileAccessState(
    status({
      plan: "free",
      provider: "revenuecat",
      productId: "carscanr.pro.monthly",
      renewalLabel: "Restore detected a RevenueCat subscription, but backend identity verification could not link it to this account.",
      isActive: false,
      entitlementSyncState: "revenuecat_active_backend_mismatch",
      purchaseAvailabilityState: "ready",
      purchaseAvailable: true,
    }),
  );

  assert.equal(resolved.mode, "free");
  assert.equal(resolved.hasProEntitlement, false);
  assert.equal(resolved.planLabel, "Restore needs support");
  assert.equal(resolved.showUpgradeOptions, false);
  assert.equal(resolved.showPaywallCard, false);
  assert.equal(renderedText(resolved).includes("different purchase identity"), true);
});

test("RevenueCat active with backend free triggers one backend sync attempt and does not leave status refresh pending", () => {
  const serviceSource = fs.readFileSync(path.join(process.cwd(), "services/subscriptionService.ts"), "utf8");

  assert.match(serviceSource, /lastRevenueCatBackendSyncAttemptKey/);
  assert.match(serviceSource, /revenueCatBackendSyncInFlight/);
  assert.match(serviceSource, /source: "status_refresh"/);
  assert.match(serviceSource, /lastRevenueCatBackendSyncAttemptKey === attemptKey/);
  assert.match(serviceSource, /!isProPlan\(usage\.plan\) && purchaseSnapshot\.activeEntitlement\?\.isActive && purchaseSnapshot\.activeProductId/);
  assert.match(serviceSource, /getRevenueCatSubscriptionSyncOverrides\(\s*usage,\s*purchaseSnapshot,\s*\{\s*allowPendingSync: false,\s*syncFailedReason: getRevenueCatSyncFailureReason\(backendRecord\) \?\? POST_PURCHASE_BACKEND_CONFIRMATION_TIMEOUT_REASON,\s*\}/);
  assert.doesNotMatch(serviceSource, /getRevenueCatSubscriptionSyncOverrides\(\s*usage,\s*purchaseSnapshot,\s*\{\s*allowPendingSync: true/);
});

test("foregrounding the app refreshes subscription status for entitlement repair", () => {
  const providerSource = fs.readFileSync(path.join(process.cwd(), "features/subscription/SubscriptionProvider.tsx"), "utf8");

  assert.match(providerSource, /AppState\.addEventListener\("change"/);
  assert.match(providerSource, /nextState === "active"/);
  assert.match(providerSource, /refreshStatus\(\)\.catch\(\(\) => undefined\)/);
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

test("profile hides native and OTA diagnostics from the normal About section", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const aboutStart = profileSource.indexOf('<SectionLabel label="About" />');
  const developerDiagnosticsStart = profileSource.indexOf('<SectionLabel label="Developer Diagnostics" />', aboutStart);
  const subscriptionManagementStart = profileSource.indexOf('<SectionLabel label="Subscription Management" />', aboutStart);
  const aboutEnd = developerDiagnosticsStart > -1 ? developerDiagnosticsStart : subscriptionManagementStart;
  const aboutBlock = profileSource.slice(aboutStart, aboutEnd);
  const technicalLabels = [
    "Native App Version",
    "Native Build",
    "Runtime",
    "Active OTA Update ID",
    "Active OTA Commit",
    "Is Embedded Launch",
    "Is Emergency Launch",
  ];

  assert.notEqual(aboutStart, -1, "About section was not found");
  assert.notEqual(developerDiagnosticsStart, -1, "Developer Diagnostics section was not found");
  assert.notEqual(aboutEnd, -1, "About section end was not found");
  assert.match(aboutBlock, /label="App Version"/);
  for (const label of technicalLabels) {
    assert.doesNotMatch(aboutBlock, new RegExp(`label="${label}"`), `${label} should not appear in the public About section`);
  }
});

test("profile keeps technical diagnostics behind the developer diagnostics gate", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const gateStart = profileSource.indexOf("{showDeveloperDiagnostics ? (");
  const developerDiagnosticsStart = profileSource.indexOf('<SectionLabel label="Developer Diagnostics" />', gateStart);
  const otaDiagnosticsStart = profileSource.indexOf('<SectionLabel label="OTA Diagnostics" />', developerDiagnosticsStart);
  const subscriptionManagementStart = profileSource.indexOf('<SectionLabel label="Subscription Management" />', otaDiagnosticsStart);
  const diagnosticsBlock = profileSource.slice(gateStart, subscriptionManagementStart);
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

  assert.notEqual(gateStart, -1, "Developer diagnostics gate was not found");
  assert.notEqual(developerDiagnosticsStart, -1, "Developer Diagnostics section was not found");
  assert.notEqual(otaDiagnosticsStart, -1, "OTA Diagnostics section was not found");
  assert.notEqual(subscriptionManagementStart, -1, "Subscription Management section was not found");
  assert.match(profileSource, /const showQaDebug = mobileEnv\.showQaDebug === "1" \|\| mobileEnv\.showQaDebug\.toLowerCase\(\) === "true"/);
  assert.match(profileSource, /const showDeveloperDiagnostics = __DEV__ \|\| \(mobileEnv\.appEnv !== "production" && showQaDebug\)/);
  for (const label of orderedLabels) {
    const nextIndex = diagnosticsBlock.indexOf(`label="${label}"`);
    assert.ok(nextIndex > previousIndex, `${label} should appear after the previous developer diagnostics row`);
    previousIndex = nextIndex;
  }
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
  assert.match(profileSource, /profile-switch-to-yearly/);
  assert.match(profileSource, /label="Switch to Yearly Pro"/);
  assert.match(profileSource, /label=\{isCancelling \? "Opening Subscription Management\.\.\." : "Manage Subscription"\}/);
  assert.match(profileSource, /subscriptionManagementSection/);
  assert.doesNotMatch(profileSource, /Cancel Pro|Cancelling Pro|Cancel Subscription/);
});

test("profile exposes in-app account deletion with Apple subscription guidance", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const accountServiceSource = fs.readFileSync(path.join(process.cwd(), "services/accountService.ts"), "utf8");

  assert.match(profileSource, /accountService[\s\S]*\.deleteAccount\(\)/);
  assert.match(profileSource, /label=\{isDeletingAccount \? "Deleting Account\.\.\." : "Delete Account"\}/);
  assert.match(profileSource, /This deletes your CarScanr account and removes associated app data where applicable, including Garage and scan history\./);
  assert.match(profileSource, /Active Apple subscriptions must be managed or canceled through Apple\/App Store settings\./);
  assert.match(profileSource, /router\.replace\(\"\/\(tabs\)\/scan"/);
  assert.match(accountServiceSource, /path: "\/api\/account"/);
  assert.doesNotMatch(accountServiceSource, /path: "\/account"/);
});

test("subscription management opens RevenueCat native management instead of backend cancel", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const providerSource = fs.readFileSync(path.join(process.cwd(), "features/subscription/SubscriptionProvider.tsx"), "utf8");
  const purchaseSource = fs.readFileSync(path.join(process.cwd(), "services/purchaseService.ts"), "utf8");
  const serviceSource = fs.readFileSync(path.join(process.cwd(), "services/subscriptionService.ts"), "utf8");
  const manageStart = serviceSource.indexOf("async manageSubscription()");
  const manageEnd = serviceSource.indexOf("async cancelSubscription", manageStart);
  const manageBlock = serviceSource.slice(manageStart, manageEnd);

  assert.match(profileSource, /handleManageSubscription/);
  assert.match(providerSource, /manageSubscription/);
  assert.match(purchaseSource, /Purchases\.showManageSubscriptions\(\)/);
  assert.match(manageBlock, /purchaseService\.openSubscriptionManagement\(\)/);
  assert.match(manageBlock, /outcome: "management_opened"/);
  assert.doesNotMatch(manageBlock, /\/api\/subscription\/cancel|Pro access cancelled|Free plan/);
});

test("monthly Pro users have a yearly switch path through Apple subscription options", () => {
  const profileSource = fs.readFileSync(profileSourcePath, "utf8");
  const paywallSource = fs.readFileSync(path.join(process.cwd(), "app/paywall.tsx"), "utf8");

  assert.match(profileSource, /const isMonthlyPro = accessState\.hasProEntitlement && status\?\.plan === "pro_monthly"/);
  assert.match(profileSource, /router\.push\("\/paywall\?selectedOption=annual" as never\)/);
  assert.match(paywallSource, /monthlyProActive/);
  assert.match(paywallSource, /Switch to yearly in Apple subscription options/);
  assert.match(paywallSource, /Apple manages upgrade timing and billing/);
  assert.match(paywallSource, /manageSubscription\(\)/);
  assert.doesNotMatch(paywallSource, /manually change backend plan|\/api\/subscription\/cancel/);
});
