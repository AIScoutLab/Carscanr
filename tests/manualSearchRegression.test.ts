import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const searchScreenPath = path.join(process.cwd(), "app/(tabs)/search.tsx");
const offlineCanonicalServicePath = path.join(process.cwd(), "services/offlineCanonicalService.ts");
const manualSearchOptionsPath = path.join(process.cwd(), "assets/data/manual_search_options.json");

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

test("manual search year options come from a full canonical option index", () => {
  const options = JSON.parse(fs.readFileSync(manualSearchOptionsPath, "utf8")) as {
    modelRowCount: number;
    trimRowCount: number;
    years: string[];
  };
  const serviceSource = fs.readFileSync(offlineCanonicalServicePath, "utf8");
  const numericYears = options.years.map((year) => Number(year));

  assert.ok(options.modelRowCount > 1000, "manual search options should be generated from the canonical model feed");
  assert.ok(options.trimRowCount > 1000, "manual search options should include trim data when available");
  assert.ok(options.years.length > 40, "manual search years should not collapse to a tiny sparse detail-record list");
  assert.deepEqual(options.years.slice(0, 8), ["2027", "2026", "2025", "2024", "2023", "2022", "2021", "2020"]);
  assert.ok(options.years.includes("2019"));
  assert.ok(options.years.includes("1998"));
  assert.deepEqual(
    numericYears,
    [...numericYears].sort((left, right) => right - left),
    "manual search years should be sorted descending",
  );
  assert.match(serviceSource, /manual_search_options\.json/);
  assert.match(serviceSource, /MANUAL_SEARCH_YEAR_INDEX_SIZE/);
  assert.match(serviceSource, /MANUAL_SEARCH_YEAR_OPTIONS_GENERATED/);
  assert.match(serviceSource, /MANUAL_SEARCH_CANONICAL_ROWS_LOADED/);
});
