import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { FREE_PRO_UNLOCKS_TOTAL, normalizeFreeUnlockCounter } from "@/constants/product";
import { FREE_PRO_UNLOCKS_TOTAL as BACKEND_FREE_PRO_UNLOCKS_TOTAL } from "../backend/src/config/product";

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("free unlock total stays aligned at three across app and backend config", () => {
  assert.equal(FREE_PRO_UNLOCKS_TOTAL, 3);
  assert.equal(BACKEND_FREE_PRO_UNLOCKS_TOTAL, 3);
});

test("high-risk unlock files do not carry the old five-unlock default", () => {
  const guardedFiles = [
    "services/subscriptionService.ts",
    "services/scanService.ts",
    "components/ScanUsageMeter.tsx",
    "app/paywall.tsx",
    "backend/src/services/usageService.ts",
  ];

  for (const filePath of guardedFiles) {
    const source = read(filePath);
    assert.equal(source.includes("FREE_UNLOCKS_LIMIT = 5"), false, `${filePath} still hardcodes the old five-unlock limit`);
    assert.equal(source.includes("freeUnlocksTotal: 5"), false, `${filePath} still hardcodes a five-unlock fallback`);
    assert.equal(source.includes("freeUnlocksRemaining: 5"), false, `${filePath} still hardcodes a five-unlock remainder`);
    assert.equal(source.includes("Use your 5 free unlocks"), false, `${filePath} still references the old five-unlock copy`);
  }
});

test("free unlock counters clamp impossible persisted states back into the canonical three-unlock range", () => {
  assert.deepEqual(normalizeFreeUnlockCounter({ total: 5, used: 4, remaining: 1 }), {
    limit: 3,
    used: 3,
    remaining: 0,
  });
});

test("restore purchases does not reset or rewrite free unlock counters", () => {
  const providerSource = read("features/subscription/SubscriptionProvider.tsx");
  const serviceSource = read("services/subscriptionService.ts");
  const restoreProviderStart = providerSource.indexOf("const restorePurchases = useCallback");
  const restoreProviderEnd = providerSource.indexOf("const cancelPro = useCallback", restoreProviderStart);
  const restoreProviderBlock = providerSource.slice(restoreProviderStart, restoreProviderEnd);
  const restoreServiceStart = serviceSource.indexOf("async restorePurchases()");
  const restoreServiceEnd = serviceSource.indexOf("async cancelSubscription()", restoreServiceStart);
  const restoreServiceBlock = serviceSource.slice(restoreServiceStart, restoreServiceEnd);

  assert.notEqual(restoreProviderStart, -1, "restorePurchases provider callback was not found");
  assert.notEqual(restoreServiceStart, -1, "restorePurchases service method was not found");
  assert.equal(restoreProviderBlock.includes("setFreeUnlocksUsed"), false, "restore provider must not mutate used free unlocks");
  assert.equal(restoreProviderBlock.includes("setFreeUnlocksRemaining"), false, "restore provider must not mutate remaining free unlocks");
  assert.equal(restoreProviderBlock.includes("setFreeUnlocksLimit"), false, "restore provider must not mutate free unlock limit");
  assert.equal(restoreServiceBlock.includes("saveFreeUnlockState"), false, "restore service must not persist free unlock state");
  assert.equal(restoreServiceBlock.includes("scanService.getUsage()"), false, "restore service must not refresh usage counters");
  assert.equal(providerSource.includes("FREE_UNLOCK_COUNTER_STATE_BEFORE_RESTORE"), true);
  assert.equal(providerSource.includes("FREE_UNLOCK_COUNTER_STATE_AFTER_RESTORE"), true);
});

test("value and listings free unlocks require explicit spend confirmation", () => {
  const detailSource = read("app/vehicle/[id].tsx");
  const resultSource = read("app/scan/result.tsx");

  for (const [label, source] of [
    ["vehicle detail", detailSource],
    ["scan result", resultSource],
  ] as const) {
    assert.match(source, /Use 1 unlock\?/, `${label} must warn before spending a vehicle unlock`);
    assert.match(
      source,
      /This will unlock live market value and nearby listings for this vehicle\./,
      `${label} must explain what the unlock enables`,
    );
    assert.match(source, /Use Unlock/, `${label} must expose an explicit confirmation action`);
    assert.match(source, /Cancel/, `${label} must allow cancellation`);
    assert.match(source, /Value & Listings unlocked/, `${label} must clearly confirm a successful unlock`);
    assert.match(source, /formatPurchasedUnlockPackRemaining/, `${label} should show purchased unlock count copy when credits are used`);
  }

  const detailConfirmIndex = detailSource.indexOf("confirmVehicleMarketUnlockSpend");
  const detailSpendIndex = detailSource.indexOf("useFreeUnlockForVehicle(marketUnlockPrimaryId");
  assert.ok(detailConfirmIndex > -1 && detailSpendIndex > -1 && detailConfirmIndex < detailSpendIndex);
  assert.match(detailSource, /hasFullAccess \|\| isPro\) \{\s*loadVehicleMarketSections\(\);/s);
  assert.match(detailSource, /totalUnlocksAvailable <= 0\) \{\s*router\.push\("\/paywall"\);/s);
  assert.doesNotMatch(detailSource, /freeUnlocksRemaining <= 0\) \{\s*router\.push\("\/paywall"\);/s);
  assert.match(detailSource, /marketUnlockSpendInFlightRef\.current/);

  const resultConfirmIndex = resultSource.indexOf("confirmVehicleMarketUnlockSpend");
  const resultSpendIndex = resultSource.indexOf("useFreeUnlockForVehicle(bestMatch.id, [], bestMatchUnlockLookup)");
  assert.ok(resultConfirmIndex > -1 && resultSpendIndex > -1 && resultConfirmIndex < resultSpendIndex);
  assert.match(resultSource, /unlockSpendInFlightRef\.current/);
});
