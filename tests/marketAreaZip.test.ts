import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { normalizeMarketAreaZip, resolveMarketAreaZip } from "@/lib/marketAreaZip";
import { buildVehicleListingsRequestPath, buildVehicleValueRequestPath } from "@/lib/vehicleMarketRequest";

test("blank users do not silently get a fake ZIP", () => {
  const resolved = resolveMarketAreaZip({});

  assert.equal(resolved.zip, "");
  assert.equal(resolved.zipSource, "blank");
});

test("ZIP priority prefers current user input over persisted values", () => {
  const resolved = resolveMarketAreaZip({
    currentUserInputZip: "60502",
    persistedRecentZip: "60610",
  });

  assert.equal(resolved.zip, "60502");
  assert.equal(resolved.zipSource, "user_input");
});

test("persisted recent ZIP is used when no current input exists", () => {
  const resolved = resolveMarketAreaZip({
    persistedRecentZip: "60502",
  });

  assert.equal(resolved.zip, "60502");
  assert.equal(resolved.zipSource, "persisted_recent");
});

test("fresh sessions stay blank and do not inject legacy Chicago ZIP defaults", () => {
  const resolved = resolveMarketAreaZip({
    currentUserInputZip: "",
    persistedRecentZip: "",
    profileZip: "",
    deviceLocationZip: "",
  });

  assert.equal(resolved.zip, "");
  assert.equal(resolved.zipSource, "blank");
});

test("ZIP normalization strips non-digits instead of using a hardcoded fallback", () => {
  assert.equal(normalizeMarketAreaZip("60502-1234"), "60502");
  assert.equal(normalizeMarketAreaZip("(605) 02"), "60502");
  assert.equal(normalizeMarketAreaZip(""), "");
});

test("vehicle value request path uses the same ZIP and zipSource shown in the UI", () => {
  const path = buildVehicleValueRequestPath(
    "519f29ed-979c-44ee-b443-83b2ce480333",
    "60502",
    "18400",
    "good",
    {
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
      zipSource: "user_input",
    },
  );

  assert.match(path, /zip=60502/);
  assert.match(path, /zipSource=user_input/);
  assert.doesNotMatch(path, /zip=60610/);
});

test("changing ZIP changes the value request cache identity inputs", () => {
  const firstPath = buildVehicleValueRequestPath(
    "519f29ed-979c-44ee-b443-83b2ce480333",
    "60502",
    "18400",
    "good",
    {
      sourceScreen: "valueScreen",
      zipSource: "user_input",
    },
  );
  const secondPath = buildVehicleValueRequestPath(
    "519f29ed-979c-44ee-b443-83b2ce480333",
    "60610",
    "18400",
    "good",
    {
      sourceScreen: "valueScreen",
      zipSource: "user_input",
    },
  );

  assert.notEqual(firstPath, secondPath);
});

test("vehicle listings request path uses the same ZIP and mileage shown in the UI", () => {
  const path = buildVehicleListingsRequestPath(
    "519f29ed-979c-44ee-b443-83b2ce480333",
    "60563",
    {
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
      radiusMiles: 100,
      mileage: "18400",
      zipSource: "user_input",
    },
  );

  assert.match(path, /zip=60563/);
  assert.match(path, /mileage=18400/);
  assert.doesNotMatch(path, /zip=60610/);
});

test("value screen no longer hardcodes 60610 or passive initial-load value refreshes", () => {
  const screenSource = fs.readFileSync("/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx", "utf8");
  const valueServiceSource = fs.readFileSync("/Users/mattbrillman/Car_Identifier/services/vehicleService.ts", "utf8");

  assert.doesNotMatch(screenSource, /const defaultZip = "60610"/);
  assert.doesNotMatch(screenSource, /fetchReason:\s*"initial_load"/);
  assert.doesNotMatch(valueServiceSource, /zip=60610/);
});

test("condition chips remain local UI state and do not trigger live requests directly", () => {
  const screenSource = fs.readFileSync("/Users/mattbrillman/Car_Identifier/app/vehicle/[id].tsx", "utf8");

  assert.match(screenSource, /onPress=\{\(\) => setCondition\(option\)\}/);
  assert.doesNotMatch(screenSource, /onPress=\{\(\) => requestExplicitLiveValue/);
});
