import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(path, "utf8");
}

test("vehicle detail exposes reversible Garage add/remove actions", () => {
  const source = read("app/vehicle/[id].tsx");

  assert.match(source, /\+ Add to Garage/);
  assert.match(source, /✓ In Garage/);
  assert.match(source, /Remove from Garage/);
  assert.match(source, /Added to Garage/);
  assert.match(source, /Removed from Garage/);
  assert.match(source, /garageService\.saveEstimate/);
  assert.match(source, /garageService\s*\.\s*deleteItem/);
});

test("scan result Garage toggle uses requested copy and remains reversible", () => {
  const source = read("app/scan/result.tsx");

  assert.match(source, /\+ Add to Garage/);
  assert.match(source, /✓ In Garage/);
  assert.match(source, /Added to Garage/);
  assert.match(source, /Removed from Garage/);
  assert.match(source, /garageService\.saveEstimate/);
  assert.match(source, /garageService\s*\.\s*deleteItem/);
});

test("Garage tab has per-item remove control and immediate list update", () => {
  const source = read("app/(tabs)/garage.tsx");

  assert.match(source, /Remove from Garage/);
  assert.match(source, /setItems\(\(current\) => current\.filter/);
  assert.match(source, /garageService\s*\.\s*deleteItem/);
});

test("Garage action changes do not add unlock consumption or MarketCheck fetch calls", () => {
  const changedSources = [
    read("app/vehicle/[id].tsx"),
    read("app/scan/result.tsx"),
    read("app/(tabs)/garage.tsx"),
  ].join("\n");

  const garageActionSnippets = changedSources
    .split("\n")
    .filter((line) => /Garage|garageService|garageAction|saveGarage|removeGarage/.test(line))
    .join("\n");

  assert.doesNotMatch(garageActionSnippets, /vehicleService\.getListings/);
  assert.doesNotMatch(garageActionSnippets, /vehicleService\.getValue/);
  assert.doesNotMatch(garageActionSnippets, /useFreeUnlockForVehicle\(/);
  assert.doesNotMatch(garageActionSnippets, /MarketCheck/);
});
