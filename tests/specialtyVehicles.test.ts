import assert from "node:assert/strict";
import test from "node:test";
import { applyCuratedSpecialtySpecs } from "../lib/curatedSpecialtySpecs";
import { buildSpecialtyVehicleOverview, isSpecialtyExoticMake } from "../lib/specialtyVehicles";
import type { VehicleSpecs } from "../types";

function sparseSpecs(overrides: Partial<VehicleSpecs> = {}): VehicleSpecs {
  return {
    engine: "Unknown",
    horsepower: null,
    torque: "Unknown",
    transmission: "Unknown",
    drivetrain: "Unknown",
    mpgOrRange: "Unknown",
    exteriorColors: [],
    msrp: 0,
    ...overrides,
  };
}

test("Ferrari overview copy uses specialty language instead of generic practicality copy", () => {
  const overview = buildSpecialtyVehicleOverview({
    make: "Ferrari",
    model: "F430",
    bodyStyle: "Coupe",
  });

  assert.equal(isSpecialtyExoticMake("Ferrari"), true);
  assert.match(overview, /Exotic sports car|High-performance specialty vehicle/i);
  assert.doesNotMatch(overview, /practical|everyday usability/i);
});

test("curated specialty specs fill sparse exotic canonical specs", () => {
  const chiron = applyCuratedSpecialtySpecs({
    year: 2020,
    make: "Bugatti",
    model: "Chiron",
    specs: sparseSpecs(),
  });
  const mclaren = applyCuratedSpecialtySpecs({
    year: 2019,
    make: "McLaren",
    model: "720S",
    specs: sparseSpecs(),
  });
  const gt3rs = applyCuratedSpecialtySpecs({
    year: 2023,
    make: "Porsche",
    model: "911 GT3 RS",
    specs: sparseSpecs(),
  });

  assert.equal(chiron.horsepower, 1500);
  assert.match(chiron.engine, /W16/);
  assert.equal(chiron.drivetrain, "AWD");
  assert.equal(mclaren.horsepower, 710);
  assert.match(mclaren.engine, /twin-turbo V8/);
  assert.equal(gt3rs.horsepower, 518);
  assert.match(gt3rs.transmission, /PDK/);
});

test("curated specialty specs preserve meaningful provider data", () => {
  const specs = applyCuratedSpecialtySpecs({
    year: 2007,
    make: "Ferrari",
    model: "F430",
    specs: sparseSpecs({
      engine: "Provider V8",
      horsepower: 483,
      transmission: "6-speed manual",
    }),
  });

  assert.equal(specs.engine, "Provider V8");
  assert.equal(specs.horsepower, 483);
  assert.equal(specs.transmission, "6-speed manual");
  assert.equal(specs.drivetrain, "RWD");
});
