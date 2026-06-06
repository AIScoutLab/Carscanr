import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  formatCompactUnlockBalanceSummary,
  formatPurchasedUnlockPackRemaining,
  formatUnlockBalanceSummary,
  formatUnlockResultBody,
} from "@/lib/unlockCreditDisplay";

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("purchased unlock copy shows first and second spend remaining counts", () => {
  assert.equal(formatPurchasedUnlockPackRemaining(4), "4 of 5 purchased unlocks remaining");
  assert.equal(formatPurchasedUnlockPackRemaining(3), "3 of 5 purchased unlocks remaining");
  assert.equal(
    formatUnlockBalanceSummary({ freeUnlocksRemaining: 0, freeUnlocksTotal: 3, unlockCreditsRemaining: 4 }),
    "Free unlocks: 0 of 3 remaining\nPurchased unlocks: 4 of 5 remaining",
  );
  assert.equal(
    formatCompactUnlockBalanceSummary({ freeUnlocksRemaining: 1, freeUnlocksTotal: 3, unlockCreditsRemaining: 5 }),
    "Free: 1 of 3 remaining • Purchased: 5 of 5 remaining",
  );
  assert.equal(
    formatUnlockResultBody({
      resultType: "purchased_unlock_consumed",
      freeUnlocksRemaining: 0,
      freeUnlocksTotal: 3,
      unlockCreditsRemaining: 4,
    }),
    "This vehicle is now unlocked.\n\nFree unlocks: 0 of 3 remaining\nPurchased unlocks: 4 of 5 remaining",
  );
  assert.equal(
    formatUnlockResultBody({
      resultType: "already_unlocked",
      freeUnlocksRemaining: 1,
      freeUnlocksTotal: 3,
      unlockCreditsRemaining: 5,
    }),
    "This vehicle was already unlocked.\n\nFree unlocks: 1 of 3 remaining\nPurchased unlocks: 5 of 5 remaining",
  );
  assert.equal(
    formatUnlockResultBody({
      resultType: "pro_access",
      freeUnlocksRemaining: 1,
      freeUnlocksTotal: 3,
      unlockCreditsRemaining: 5,
    }),
    "This vehicle is unlocked through your subscription.",
  );
});

test("manual and scan unlock routes consider purchased credits before paywall", () => {
  const detailSource = read("app/vehicle/[id].tsx");
  const resultSource = read("app/scan/result.tsx");

  assert.match(detailSource, /const totalUnlocksAvailable = Math\.max\(0, freeUnlocksRemaining\) \+ purchasedUnlockCredits/);
  assert.match(detailSource, /if \(totalUnlocksAvailable <= 0\) \{\s*router\.push\("\/paywall"\);/s);
  assert.doesNotMatch(detailSource, /if \(freeUnlocksRemaining <= 0\) \{\s*router\.push\("\/paywall"\);/s);

  assert.match(resultSource, /const totalUnlocksAvailable = Math\.max\(0, freeUnlocksRemaining\) \+ purchasedUnlockCredits/);
  assert.match(resultSource, /if \(totalUnlocksAvailable > 0 && approximateUnlockId\)/);
  assert.doesNotMatch(resultSource, /if \(freeUnlocksRemaining > 0 && approximateUnlockId\)/);
});

test("manual Value and Listings unlock entry points require ZIP before auth, paywall, or backend unlock", () => {
  const detailSource = read("app/vehicle/[id].tsx");
  const resultSource = read("app/scan/result.tsx");
  const expectedMessage = "Enter a ZIP code before unlocking market value and listings.";

  assert.match(detailSource, new RegExp(expectedMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(resultSource, new RegExp(expectedMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(detailSource, /Alert\.alert\("ZIP required", MARKET_UNLOCK_ZIP_REQUIRED_MESSAGE\)/);
  assert.match(resultSource, /Alert\.alert\("ZIP required", MARKET_UNLOCK_ZIP_REQUIRED_MESSAGE\)/);
  assert.match(resultSource, /marketAreaZipService\.getInitialMarketAreaZip\(\)/);
  assert.match(detailSource, /const handleMarketPaywallAction = useCallback/);
  assert.match(detailSource, /onUpgrade=\{handleMarketPaywallAction\}/);
  assert.doesNotMatch(detailSource, /Enter a valid market area ZIP before loading nearby listings\./);

  for (const [label, handlerName, guardCall, nextHandlerName] of [
    ["bundle", "handleVehicleMarketBundleAction", "requireMarketZipForUnlock(\"bundle\")", "handleMarketValueAction"],
    ["value", "handleMarketValueAction", "requireMarketZipForUnlock(\"value\")", "handleMarketListingsAction"],
    ["listings", "handleMarketListingsAction", "requireMarketZipForUnlock(\"listings\")", "useEffect(() => {"],
  ] as const) {
    const handlerStart = detailSource.indexOf(`const ${handlerName} = useCallback`);
    const handlerEnd = detailSource.indexOf(nextHandlerName, handlerStart + 1);
    assert.ok(handlerStart > -1, `${label} handler missing`);
    assert.ok(handlerEnd > handlerStart, `${label} handler end missing`);

    const handlerSource = detailSource.slice(handlerStart, handlerEnd);
    const guardIndex = handlerSource.indexOf(guardCall);
    const authIndex = handlerSource.indexOf("ensureAuthenticatedForLiveMarket()");
    const paywallIndex = handlerSource.indexOf('router.push("/paywall")');
    const unlockIndex = handlerSource.indexOf("useFreeUnlockForVehicle(marketUnlockPrimaryId");

    assert.ok(guardIndex > -1, `${label} must guard missing ZIP`);
    assert.ok(authIndex === -1 || guardIndex < authIndex, `${label} must check ZIP before auth`);
    assert.ok(paywallIndex === -1 || guardIndex < paywallIndex, `${label} must check ZIP before paywall`);
    assert.ok(unlockIndex === -1 || guardIndex < unlockIndex, `${label} must check ZIP before backend unlock`);
  }

  for (const [label, handlerName, guardCall, nextHandlerName] of [
    [
      "scan override",
      "handleHighConfidenceVisualOverrideAction",
      "ensureMarketZipAvailableForScanUnlock(source)",
      "const handleOpenBestMatch",
    ],
    [
      "scan primary",
      "handlePrimaryResultAction",
      "ensureMarketZipAvailableForScanUnlock(\"primary-result-cta\")",
      "fallbackConfidenceLabel",
    ],
  ] as const) {
    const handlerStart = resultSource.indexOf(`const ${handlerName} = async`);
    const handlerEnd = resultSource.indexOf(nextHandlerName, handlerStart + 1);
    assert.ok(handlerStart > -1, `${label} handler missing`);
    assert.ok(handlerEnd > handlerStart, `${label} handler end missing`);

    const handlerSource = resultSource.slice(handlerStart, handlerEnd);
    const guardIndex = handlerSource.indexOf(guardCall);
    const paywallIndex = handlerSource.indexOf('router.push("/paywall")');
    const unlockIndex = handlerSource.indexOf("useFreeUnlockForVehicle");

    assert.ok(guardIndex > -1, `${label} must guard missing ZIP`);
    assert.ok(paywallIndex === -1 || guardIndex < paywallIndex, `${label} must check ZIP before paywall`);
    assert.ok(unlockIndex === -1 || guardIndex < unlockIndex, `${label} must check ZIP before backend unlock`);
  }
});

test("successful unlock refreshes cached and backend unlock balance", () => {
  const serviceSource = read("services/subscriptionService.ts");
  const scanServiceSource = read("services/scanService.ts");

  const backendStatusIndex = serviceSource.indexOf('path: "/api/unlocks/status"');
  const cacheFallbackIndex = serviceSource.indexOf("scan_cache_fallback");
  assert.ok(backendStatusIndex > -1, "subscription service must request backend unlock status");
  assert.ok(cacheFallbackIndex > -1, "scan cache should remain available only as fallback");
  assert.ok(backendStatusIndex < cacheFallbackIndex, "backend unlock status should be attempted before cached scan status");
  assert.match(serviceSource, /scanService\.updateCachedUnlockStatus\?\.\(\{\s*\.\.\.status,\s*unlockedVehicleIds: unlockState\.unlockedVehicleIds,\s*\}\)/s);
  assert.match(scanServiceSource, /updateCachedUnlockStatus\(status:/);
  assert.match(scanServiceSource, /source: "scan_cache_updated_after_unlock"/);
});

test("popup, profile, and scan badge show explicit free and purchased balances", () => {
  const detailSource = read("app/vehicle/[id].tsx");
  const resultSource = read("app/scan/result.tsx");
  const profileSource = read("app/(tabs)/profile.tsx");
  const scanSource = read("app/(tabs)/scan.tsx");

  assert.match(detailSource, /formatUnlockResultBody/);
  assert.match(resultSource, /formatUnlockResultBody/);
  assert.match(profileSource, /formatFreeUnlockBalance\(remainingUnlocks, freeUnlocksLimit\)/);
  assert.match(profileSource, /formatPurchasedUnlockBalance\(unlockCredits\)/);
  assert.match(scanSource, /formatCompactUnlockBalanceSummary/);
  assert.match(detailSource, /formatUnlockBalanceSummary\(\{/);
  assert.match(resultSource, /formatUnlockBalanceSummary\(\{/);
});

test("unlock success copy uses backend result type instead of generic free unlock copy", () => {
  const serviceSource = read("services/subscriptionService.ts");
  const providerSource = read("features/subscription/SubscriptionProvider.tsx");
  const detailSource = read("app/vehicle/[id].tsx");
  const resultSource = read("app/scan/result.tsx");

  assert.match(serviceSource, /usedUnlockCredit\?: boolean/);
  assert.match(serviceSource, /resultType\?: UnlockResultType/);
  assert.match(serviceSource, /purchased_unlock_consumed/);
  assert.match(serviceSource, /Purchased unlock applied\. This vehicle is now unlocked\./);
  assert.match(serviceSource, /BACKEND_UNLOCK_RESULT/);
  assert.match(serviceSource, /path: "\/api\/unlocks\/status"/);
  assert.match(providerSource, /resultType\?: "pro_access" \| "already_unlocked" \| "free_unlock_consumed" \| "purchased_unlock_consumed" \| "not_allowed"/);

  for (const [label, source] of [
    ["vehicle detail", detailSource],
    ["scan result", resultSource],
  ] as const) {
    assert.match(source, /const unlockSuccessTitle = \(resultType\?: string\)/, `${label} must use result-type title helper`);
    assert.match(source, /Purchased unlock applied/, `${label} must expose purchased unlock success title`);
    assert.match(source, /Already unlocked/, `${label} must expose already-unlocked success title`);
    assert.doesNotMatch(source, /Alert\.alert\("Free unlock applied"/, `${label} must not hard-code every success as free`);
    assert.match(source, /unlockSuccessTitle\(result\.resultType\)/, `${label} must render backend result type`);
  }
});

test("unlocked manual-search listings regression exercises provider after access grant", () => {
  const backendMarketAccessSource = read("backend/tests/marketAccessSecurity.test.ts");

  assert.match(backendMarketAccessSource, /manual-search estimate unlock consumes purchased credit and unlocks matching market key/);
  assert.match(backendMarketAccessSource, /assert\.equal\(listingsProviderCalled, true\)/);
});
