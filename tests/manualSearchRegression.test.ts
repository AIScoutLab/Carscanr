import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const searchScreenPath = path.join(process.cwd(), "app/(tabs)/search.tsx");
const offlineCanonicalServicePath = path.join(process.cwd(), "services/offlineCanonicalService.ts");

test("manual search uses guided canonical pickers as the primary path", () => {
  const screenSource = fs.readFileSync(searchScreenPath, "utf8");
  const offlineCanonicalSource = fs.readFileSync(offlineCanonicalServicePath, "utf8");

  assert.match(offlineCanonicalSource, /getManualSearchOptions/);
  assert.match(screenSource, /offlineCanonicalService[\s\S]{0,80}\.getManualSearchOptions/);
  assert.match(screenSource, /testID="manual-search-year-picker"/);
  assert.match(screenSource, /testID="manual-search-make-picker"/);
  assert.match(screenSource, /testID="manual-search-model-picker"/);
  assert.match(screenSource, /testID="manual-search-trim-picker"/);
  assert.match(screenSource, /disabled=\{!year\}/);
  assert.match(screenSource, /disabled=\{!year \|\| !make\}/);
  assert.match(screenSource, /manualFallbackVisible/);
  assert.doesNotMatch(screenSource, /<TextInput[\s\S]{0,180}placeholder="Year"[\s\S]{0,180}keyboardType="number-pad"/);
});
