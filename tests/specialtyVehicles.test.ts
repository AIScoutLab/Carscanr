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
  const ferrari = applyCuratedSpecialtySpecs({
    year: 2007,
    make: "Ferrari",
    model: "F430",
    specs: sparseSpecs(),
  });
  const huracan = applyCuratedSpecialtySpecs({
    year: 2018,
    make: "Lamborghini",
    model: "Huracan",
    specs: sparseSpecs(),
  });
  const gt3 = applyCuratedSpecialtySpecs({
    year: 2023,
    make: "Porsche",
    model: "911 GT3",
    specs: sparseSpecs(),
  });

  assert.equal(chiron.horsepower, 1500);
  assert.match(chiron.engine, /W16/);
  assert.equal(chiron.drivetrain, "AWD");
  assert.equal(ferrari.horsepower, 490);
  assert.match(ferrari.engine, /V8/);
  assert.equal(huracan.horsepower, 610);
  assert.match(huracan.engine, /V10/);
  assert.equal(mclaren.horsepower, 710);
  assert.match(mclaren.engine, /twin-turbo V8/);
  assert.equal(gt3.horsepower, 502);
  assert.equal(gt3rs.horsepower, 518);
  assert.match(gt3rs.transmission, /PDK/);
});

test("curated specialty specs do not overwrite normal vehicle specs", () => {
  const normal = applyCuratedSpecialtySpecs({
    year: 2021,
    make: "Toyota",
    model: "4Runner",
    specs: sparseSpecs({
      engine: "4.0L V6",
      horsepower: 270,
      drivetrain: "4WD",
      transmission: "5-speed automatic",
    }),
  });

  assert.equal(normal.engine, "4.0L V6");
  assert.equal(normal.horsepower, 270);
  assert.equal(normal.drivetrain, "4WD");
  assert.equal(normal.transmission, "5-speed automatic");
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
