import assert from "node:assert/strict";
import test from "node:test";
import { buildVehicleDescription } from "@/lib/vehicleDescription";

test("vehicle description generates concise grounded copy from confirmed data", () => {
  const result = buildVehicleDescription({
    year: 2021,
    make: "Audi",
    model: "A4",
    trim: "Premium",
    bodyStyle: "Sedan",
    engine: "2.0L turbo I4",
    horsepower: 201,
    drivetrain: "AWD",
    transmission: "7-speed automatic",
  });

  assert.equal(result.reason, "generated");
  assert.match(result.description ?? "", /The 2021 Audi A4 Premium is a sedan/i);
  assert.match(result.description ?? "", /2\.0L turbo I4/i);
  assert.match(result.description ?? "", /201 hp/i);
  assert.doesNotMatch(result.description ?? "", /in this record/i);
});

test("vehicle description safely skips when data is too thin", () => {
  const result = buildVehicleDescription({
    make: "Audi",
    model: "A4",
  });

  assert.equal(result.reason, "data_insufficient");
  assert.equal(result.description, null);
});
