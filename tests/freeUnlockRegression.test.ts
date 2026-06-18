import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { FREE_PRO_UNLOCKS_TOTAL, normalizeFreeUnlockCounter } from "@/constants/product";
import { resolveFreeUnlockDisplayCounter } from "@/lib/freeUnlockBalance";
import { formatCompactUnlockBalanceSummary } from "@/lib/unlockCreditDisplay";
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

test("guest free unlock display transitions one spend at a time", () => {
  const remainingBySpend = [0, 1, 2, 3].map((localUsed) =>
    resolveFreeUnlockDisplayCounter({ localUsed }).remaining,
  );

  assert.deepEqual(remainingBySpend, [3, 2, 1, 0]);
});

test("scan display uses backend unlock balance instead of adding vehicle ids to local usage", () => {
  assert.deepEqual(
    resolveFreeUnlockDisplayCounter({
      backendFreeUnlocksUsed: 1,
      localUsed: 1,
    }),
    {
      limit: 3,
      used: 1,
      remaining: 2,
    },
  );

  const serviceSource = read("services/subscriptionService.ts");
  assert.match(serviceSource, /resolveFreeUnlockDisplayCounter\(\{/);
  assert.match(serviceSource, /backendFreeUnlocksRemaining/);
  assert.match(serviceSource, /status\.freeUnlocksUsed/);
  assert.match(serviceSource, /status\.freeUnlocksRemaining/);
  assert.match(serviceSource, /cached\.freeUnlocksUsed/);
  assert.doesNotMatch(serviceSource, /uniqueBackendIds\.length \+ localUsed/);
});

test("signed-in scan status prefers backend remaining over exhausted local fallback", () => {
  assert.deepEqual(
    resolveFreeUnlockDisplayCounter({
      total: 3,
      backendFreeUnlocksRemaining: 1,
      localUsed: 3,
    }),
    {
      limit: 3,
      used: 2,
      remaining: 1,
    },
  );
});

test("fresh signed-in backend unlock response with one spend displays two remaining", () => {
  assert.deepEqual(
    resolveFreeUnlockDisplayCounter({
      total: 3,
      backendFreeUnlocksUsed: 1,
      backendFreeUnlocksRemaining: 2,
      localUsed: 2,
    }),
    {
      limit: 3,
      used: 1,
      remaining: 2,
    },
  );
});

test("signed-in scan display uses backend remaining instead of depleted guest fallback", () => {
  const counter = resolveFreeUnlockDisplayCounter({
    total: 3,
    backendFreeUnlocksUsed: 1,
    backendFreeUnlocksRemaining: 2,
    localUsed: 2,
  });

  assert.deepEqual(counter, {
    limit: 3,
    used: 1,
    remaining: 2,
  });
  assert.equal(
    formatCompactUnlockBalanceSummary({
      freeUnlocksRemaining: counter.remaining,
      freeUnlocksTotal: counter.limit,
      unlockCreditsRemaining: 0,
    }),
    "Free: 2 of 3 remaining • Purchased: 0 of 5 remaining",
  );
});

test("free unlock action is synchronously guarded against duplicate backend use calls", () => {
  const providerSource = read("features/subscription/SubscriptionProvider.tsx");
  const callbackStart = providerSource.indexOf("const useFreeUnlockForVehicle = useCallback");
  const callbackEnd = providerSource.indexOf("const isVehicleUnlocked", callbackStart);
  const callbackBlock = providerSource.slice(callbackStart, callbackEnd);

  assert.notEqual(callbackStart, -1, "useFreeUnlockForVehicle callback was not found");
  assert.match(providerSource, /const unlockRequestInFlightRef = useRef\(false\)/);
  assert.match(callbackBlock, /unlockRequestInFlightRef\.current \|\| isUnlocking/);
  assert.ok(
    callbackBlock.indexOf("unlockRequestInFlightRef.current = true") <
      callbackBlock.indexOf("subscriptionService.useFreeUnlockForVehicle"),
    "provider must set the synchronous in-flight guard before calling the backend unlock service",
  );
  assert.match(callbackBlock, /finally \{\s*unlockRequestInFlightRef\.current = false;\s*setIsUnlocking\(false\);/s);
});

test("signed-in unlock refresh persists the backend free unlock count as the local fallback", () => {
  const serviceSource = read("services/subscriptionService.ts");
  const backendStatusStart = serviceSource.indexOf('logFreeUnlockCounterState("backend_status"');
  const backendStatusBlock = serviceSource.slice(Math.max(0, backendStatusStart - 420), backendStatusStart);
  const backendUnlockStart = serviceSource.indexOf('logFreeUnlockCounterState("backend_unlock_status"');
  const backendUnlockBlock = serviceSource.slice(Math.max(0, backendUnlockStart - 420), backendUnlockStart);

  assert.notEqual(backendStatusStart, -1, "backend status refresh block was not found");
  assert.notEqual(backendUnlockStart, -1, "backend unlock status block was not found");
  assert.match(backendStatusBlock, /await saveFreeUnlockState\(user\.id, \{\s*used: merged\.used,\s*localUsed: merged\.used,/s);
  assert.match(backendUnlockBlock, /used: backendCounter\.used,\s*localUsed: backendCounter\.used,/s);
  assert.match(serviceSource, /freeUnlocksRemaining: status\.freeUnlocksRemaining/);
  assert.doesNotMatch(backendUnlockBlock, /localUsed: existingLocalState\.localUsed/);
});

test("signed-in backend refresh does not merge guest free unlock depletion into the account counter", () => {
  const serviceSource = read("services/subscriptionService.ts");
  const loaderStart = serviceSource.indexOf("async function loadFreeUnlockStateForUser");
  const loaderEnd = serviceSource.indexOf("async function loadSignedInFreeUnlockFallback", loaderStart);
  const loaderBlock = serviceSource.slice(loaderStart, loaderEnd);
  const statusStart = serviceSource.indexOf("async getFreeUnlockState()");
  const statusEnd = serviceSource.indexOf("async useFreeUnlockForVehicle", statusStart);
  const statusBlock = serviceSource.slice(statusStart, statusEnd);
  const backendFailureStart = serviceSource.indexOf('console.log("[subscription] BACKEND_UNLOCK_REQUEST_FAILED"');
  const backendFailureEnd = serviceSource.indexOf("resetStatus()", backendFailureStart);
  const backendFailureBlock = serviceSource.slice(backendFailureStart, backendFailureEnd);

  assert.notEqual(loaderStart, -1, "loadFreeUnlockStateForUser block was not found");
  assert.notEqual(statusStart, -1, "getFreeUnlockState block was not found");
  assert.notEqual(backendFailureStart, -1, "backend unlock failure block was not found");
  assert.match(loaderBlock, /if \(!userId \|\| userId === "guest"\) \{\s*return loadFreeUnlockState\("guest"\);\s*\}/s);
  assert.match(loaderBlock, /return loadFreeUnlockState\(userId\);/);
  assert.doesNotMatch(loaderBlock, /Promise\.all\(\[loadFreeUnlockState\(userId\), loadFreeUnlockState\("guest"\)\]\)/);
  assert.doesNotMatch(loaderBlock, /Math\.max\(userState/);
  assert.doesNotMatch(loaderBlock, /GUEST_UNLOCK_STATE_MIGRATED/);
  assert.match(statusBlock, /token && user\?\.id\s*\?\s*await loadSignedInFreeUnlockFallback\(user\.id\)/s);
  assert.match(backendFailureBlock, /await loadSignedInFreeUnlockFallback\(user\.id\)/);
  assert.doesNotMatch(backendFailureBlock, /loadFreeUnlockStateForUser\(user\.id\)/);
});

test("restore purchases does not reset or rewrite free unlock counters", () => {
  const providerSource = read("features/subscription/SubscriptionProvider.tsx");
  const serviceSource = read("services/subscriptionService.ts");
  const restoreProviderStart = providerSource.indexOf("const restorePurchases = useCallback");
  const restoreProviderEnd = providerSource.indexOf("const manageSubscription = useCallback", restoreProviderStart);
  const restoreProviderBlock = providerSource.slice(restoreProviderStart, restoreProviderEnd);
  const restoreServiceStart = serviceSource.indexOf("async restorePurchases()");
  const restoreServiceEnd = serviceSource.indexOf("async manageSubscription()", restoreServiceStart);
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
    assert.match(source, /unlockSuccessTitle\(result\.resultType\)|Value & Listings unlocked/, `${label} must clearly confirm a successful unlock`);
    assert.match(source, /formatUnlockBalanceSummary|formatUnlockResultBody/, `${label} should show explicit free and purchased unlock balances`);
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
