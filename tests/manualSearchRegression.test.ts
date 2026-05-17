import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getVehicleImage,
  isGeneratedVehicleFallbackImageUri,
  legacyGenericSportsCarImage,
  normalizeVehicleIdentityForRendering,
  resolveVehicleImageSource,
} from "../constants/vehicleImages";

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
  assert.match(screenSource, /const canSearch = year\.trim\(\)\.length > 0 && make\.trim\(\)\.length > 0 && model\.trim\(\)\.length > 0/);
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

test("manual search submit navigates from a valid guided selection without requiring trim", () => {
  const screenSource = fs.readFileSync(searchScreenPath, "utf8");

  assert.match(screenSource, /MANUAL_SEARCH_SUBMIT_STARTED/);
  assert.match(screenSource, /MANUAL_SEARCH_SELECTION_STATE/);
  assert.match(screenSource, /MANUAL_SEARCH_LOCAL_MATCH_RESULT/);
  assert.match(screenSource, /MANUAL_SEARCH_BACKEND_REQUEST_STARTED/);
  assert.match(screenSource, /MANUAL_SEARCH_BACKEND_REQUEST_RESULT/);
  assert.match(screenSource, /MANUAL_SEARCH_NAVIGATION_TARGET/);
  assert.match(screenSource, /MANUAL_SEARCH_SUBMIT_ERROR/);
  assert.match(screenSource, /offlineCanonicalService\.matchCandidate/);
  assert.match(screenSource, /buildManualSearchEstimateId/);
  assert.match(screenSource, /router\.push\(navigationTarget\)/);
  assert.match(screenSource, /trim: selectedTrimValue \|\| null/);
  assert.doesNotMatch(screenSource, /vehicleService\.searchVehicles/);
});

test("manual search submit failure renders an error instead of silently doing nothing", () => {
  const screenSource = fs.readFileSync(searchScreenPath, "utf8");

  assert.match(screenSource, /catch \(err\)/);
  assert.match(screenSource, /setResults\(\[\]\)/);
  assert.match(screenSource, /setError\(message\)/);
  assert.match(screenSource, /setSearched\(true\)/);
  assert.match(screenSource, /Search unavailable/);
});

test("manual search production UI does not expose fallback wording", () => {
  const screenSource = fs.readFileSync(searchScreenPath, "utf8");

  assert.match(screenSource, /Can't find your vehicle\?/);
  assert.match(screenSource, /Hide manual entry/);
  assert.doesNotMatch(screenSource, /Use text fallback|Hide text fallback/);
  assert.doesNotMatch(screenSource, /manualFallbackButtonText\}>\{[^}]*fallback/i);
});

test("manual search result images avoid unsafe vehicle fallbacks", () => {
  const rangerIdentity = normalizeVehicleIdentityForRendering({
    vehicleId: "1998-ford-ranger-xlt",
    make: "Ford",
    model: "Ranger",
    vehicleType: "car",
    bodyStyle: "car",
  });
  const truckImage = resolveVehicleImageSource({
    vehicleId: "unknown-ford-ranger",
    vehicleType: "car",
    bodyStyle: "Pickup Truck",
  });
  const inferredTruckImage = resolveVehicleImageSource({
    vehicleId: "2021-ford-ranger-xl",
    vehicleType: "car",
    bodyStyle: null,
  });
  const rangerWithWrongSuvStyle = resolveVehicleImageSource({
    vehicleId: "1998-ford-ranger-xlt",
    vehicleType: "car",
    bodyStyle: "SUV",
  });
  const neutralImage = resolveVehicleImageSource({
    vehicleId: "unknown-vehicle",
    vehicleType: "car",
    bodyStyle: null,
  });
  const seededImage = resolveVehicleImageSource({
    vehicleId: "2021-cadillac-ct4-premium-luxury",
    vehicleType: "car",
    bodyStyle: "Sedan",
  });
  const screenSource = fs.readFileSync(searchScreenPath, "utf8");

  assert.equal(rangerIdentity.vehicleType, "truck");
  assert.match(rangerIdentity.bodyStyle ?? "", /pickup|truck/i);
  assert.equal(truckImage.fallbackType, "neutral-placeholder");
  assert.equal(inferredTruckImage.fallbackType, "neutral-placeholder");
  assert.equal(rangerWithWrongSuvStyle.fallbackType, "neutral-placeholder");
  assert.notEqual(truckImage.uri, legacyGenericSportsCarImage);
  assert.notEqual(inferredTruckImage.uri, legacyGenericSportsCarImage);
  assert.notEqual(rangerWithWrongSuvStyle.uri, legacyGenericSportsCarImage);
  assert.doesNotMatch(inferredTruckImage.uri, /text=Vehicle|e5e7eb/i);
  assert.doesNotMatch(rangerWithWrongSuvStyle.uri, /explorer|suv|camaro|sports/i);
  assert.equal(getVehicleImage("unknown-ford-ranger", "car", "Pickup Truck"), truckImage.uri);
  assert.equal(neutralImage.fallbackType, "neutral-placeholder");
  assert.notEqual(neutralImage.uri, legacyGenericSportsCarImage);
  assert.doesNotMatch(neutralImage.uri, /text=Vehicle|e5e7eb/i);
  assert.match(neutralImage.uri, /111827|CarScanr/i);
  assert.equal(isGeneratedVehicleFallbackImageUri(rangerWithWrongSuvStyle.uri), true);
  assert.equal(seededImage.fallbackType, "seeded");
  assert.match(screenSource, /SEARCH_RESULT_IMAGE_SOURCE/);
  assert.match(screenSource, /SEARCH_RESULT_IMAGE_FALLBACK_TYPE/);
  assert.match(screenSource, /isGeneratedVehicleFallbackImageUri/);
});

test("Ford Ranger identity cannot revert to car before render", () => {
  const offlineCanonicalSource = fs.readFileSync(offlineCanonicalServicePath, "utf8");
  const vehicleServiceSource = fs.readFileSync(path.join(process.cwd(), "services/vehicleService.ts"), "utf8");
  const detailSource = fs.readFileSync(path.join(process.cwd(), "app/vehicle/[id].tsx"), "utf8");

  assert.match(offlineCanonicalSource, /normalizeVehicleIdentityForRendering/);
  assert.match(offlineCanonicalSource, /RANGER_NORMALIZATION_APPLIED/);
  assert.match(vehicleServiceSource, /normalizeVehicleIdentityForRendering/);
  assert.match(vehicleServiceSource, /RANGER_NORMALIZATION_LOST/);
  assert.match(detailSource, /resolvedDisplayVehicleType/);
  assert.match(detailSource, /FRONTEND_BODY_STYLE_RENDERED/);
  assert.match(detailSource, /vehicleType: normalizedIdentity\.vehicleType/);
});
