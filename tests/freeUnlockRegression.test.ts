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
