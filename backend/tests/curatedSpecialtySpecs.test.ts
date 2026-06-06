import assert from "node:assert/strict";
import test from "node:test";
import { applyCuratedSpecialtySpecs } from "../src/lib/curatedSpecialtySpecs.js";
import type { VehicleRecord } from "../src/types/domain.js";

function vehicle(overrides: Partial<VehicleRecord>): VehicleRecord {
  return {
    id: "test-vehicle",
    year: 2020,
    make: "Unknown",
    model: "Vehicle",
    trim: "",
    bodyStyle: "",
    vehicleType: "car",
    msrp: 0,
    engine: "Unknown",
    horsepower: null,
    torque: "Unknown",
    transmission: "Unknown",
    drivetrain: "Unknown",
    mpgOrRange: "Unknown",
    colors: [],
    ...overrides,
  };
}

test("curated specialty specs fill backend exotic vehicle records", () => {
  const chiron = applyCuratedSpecialtySpecs(
    vehicle({
      year: 2020,
      make: "Bugatti",
      model: "Chiron",
    }),
  );
  const ferrari = applyCuratedSpecialtySpecs(
    vehicle({
      year: 2007,
      make: "Ferrari",
      model: "F430",
    }),
  );
  const huracan = applyCuratedSpecialtySpecs(
    vehicle({
      year: 2018,
      make: "Lamborghini",
      model: "Huracan",
    }),
  );
  const mclaren = applyCuratedSpecialtySpecs(
    vehicle({
      year: 2019,
      make: "McLaren",
      model: "720S",
    }),
  );
  const gt3 = applyCuratedSpecialtySpecs(
    vehicle({
      year: 2023,
      make: "Porsche",
      model: "911 GT3",
    }),
  );
  const gt3rs = applyCuratedSpecialtySpecs(
    vehicle({
      year: 2023,
      make: "Porsche",
      model: "911",
      trim: "GT3 RS",
    }),
  );

  assert.equal(chiron.horsepower, 1500);
  assert.match(chiron.engine, /W16/);
  assert.equal(chiron.drivetrain, "AWD");
  assert.equal(ferrari.bodyStyle, "Coupe");
  assert.equal(ferrari.horsepower, 490);
  assert.match(ferrari.engine, /V8/);
  assert.equal(ferrari.drivetrain, "RWD");
  assert.equal(ferrari.engineDisplacementL, 4.3);
  assert.equal(huracan.horsepower, 610);
  assert.match(huracan.engine, /V10/);
  assert.equal(mclaren.horsepower, 710);
  assert.match(mclaren.engine, /twin-turbo V8/);
  assert.equal(gt3.horsepower, 502);
  assert.match(gt3.transmission, /manual or 7-speed PDK/);
  assert.equal(gt3rs.horsepower, 518);
  assert.match(gt3rs.transmission, /PDK/);
});

test("curated specialty specs do not alter normal backend vehicles", () => {
  const toyota = applyCuratedSpecialtySpecs(
    vehicle({
      year: 2021,
      make: "Toyota",
      model: "4Runner",
      engine: "4.0L V6",
      horsepower: 270,
      drivetrain: "4WD",
      transmission: "5-speed automatic",
    }),
  );

  assert.equal(toyota.engine, "4.0L V6");
  assert.equal(toyota.horsepower, 270);
  assert.equal(toyota.drivetrain, "4WD");
  assert.equal(toyota.transmission, "5-speed automatic");
});

test("curated specialty specs preserve meaningful backend provider data", () => {
  const enriched = applyCuratedSpecialtySpecs(
    vehicle({
      year: 2019,
      make: "McLaren",
      model: "720S",
      engine: "Provider engine",
      horsepower: 999,
      bodyStyle: "Convertible",
      drivetrain: "Provider drivetrain",
    }),
  );

  assert.equal(enriched.engine, "Provider engine");
  assert.equal(enriched.horsepower, 999);
  assert.equal(enriched.bodyStyle, "Convertible");
  assert.equal(enriched.drivetrain, "Provider drivetrain");
  assert.equal(enriched.torque, "568 lb-ft");
});
