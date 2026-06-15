import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("recent scans persist through scanService instead of only module memory", () => {
  const scanServiceSource = read("services/scanService.ts");

  assert.match(scanServiceSource, /const RECENT_SCAN_STORAGE_PREFIX = "carscanr\.recentScans\.v1"/);
  assert.match(scanServiceSource, /async function resolveRecentScanStorageContext\(\)/);
  assert.match(scanServiceSource, /authService\.getCurrentUser\(\)/);
  assert.match(scanServiceSource, /guestSessionService\.getGuestId\(\)/);
  assert.match(scanServiceSource, /async function loadPersistedRecentScans\(\)/);
  assert.match(scanServiceSource, /AsyncStorage\.getItem\(context\.currentStorageKey\)/);
  assert.match(scanServiceSource, /async function persistRecentScans\(scans: ScanResult\[\]\)/);
  assert.match(scanServiceSource, /AsyncStorage\.setItem\(context\.currentStorageKey, serialized\)/);
  assert.match(scanServiceSource, /async function saveRecentScan\(scan: ScanResult\)/);
  assert.match(scanServiceSource, /await loadPersistedRecentScans\(\)/);
});

test("all successful scan paths write recent scans through the persisted helper", () => {
  const scanServiceSource = read("services/scanService.ts");
  const saveCalls = scanServiceSource.match(/await saveRecentScan\(/g) ?? [];

  assert.equal(saveCalls.length, 4);
  assert.match(scanServiceSource, /async createSampleResult[\s\S]*await saveRecentScan\(result\)/);
  assert.match(scanServiceSource, /const quickCached = \{[\s\S]*await saveRecentScan\(quickCached\)/);
  assert.match(scanServiceSource, /const finalResult = offlineMatch[\s\S]*await saveRecentScan\(finalResult\)/);
  assert.match(scanServiceSource, /async identifyPremium[\s\S]*await saveRecentScan\(result\)/);
});

test("Scan tab reloads Recent Scans from the same service on mount and focus", () => {
  const scanTabSource = read("app/(tabs)/scan.tsx");

  assert.match(scanTabSource, /scanService\.getRecentScans\(\{ forceRefresh: true \}\)\.then\(syncRecentScansState\)/);
  assert.match(scanTabSource, /scanService\.subscribeRecentScans\(syncRecentScansState\)/);
  assert.match(scanTabSource, /recentScans\.slice\(0, 3\)\.map/);
});
