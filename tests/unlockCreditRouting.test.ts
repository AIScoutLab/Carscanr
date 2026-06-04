import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { formatPurchasedUnlockPackRemaining } from "@/lib/unlockCreditDisplay";

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("purchased unlock copy shows first and second spend remaining counts", () => {
  assert.equal(formatPurchasedUnlockPackRemaining(4), "4 of 5 purchased unlocks remaining");
  assert.equal(formatPurchasedUnlockPackRemaining(3), "3 of 5 purchased unlocks remaining");
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

test("popup, profile, and scan badge use purchased unlock pack remaining copy", () => {
  const detailSource = read("app/vehicle/[id].tsx");
  const resultSource = read("app/scan/result.tsx");
  const profileSource = read("app/(tabs)/profile.tsx");
  const scanSource = read("app/(tabs)/scan.tsx");

  assert.match(detailSource, /formatPurchasedUnlockPackRemaining\(nextPurchasedCredits\)/);
  assert.match(resultSource, /formatPurchasedUnlockPackRemaining\(nextPurchasedCredits\)/);
  assert.match(profileSource, /formatPurchasedUnlockPackRemaining\(unlockCredits\)/);
  assert.match(scanSource, /formatPurchasedUnlockPackRemaining\(purchasedUnlockCredits\)/);
});

test("unlocked manual-search listings regression exercises provider after access grant", () => {
  const backendMarketAccessSource = read("backend/tests/marketAccessSecurity.test.ts");

  assert.match(backendMarketAccessSource, /manual-search estimate unlock consumes purchased credit and unlocks matching market key/);
  assert.match(backendMarketAccessSource, /assert\.equal\(listingsProviderCalled, true\)/);
});
