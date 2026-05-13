import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecialtyVehicleOverview, isSpecialtyExoticMake } from "../lib/specialtyVehicles";

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
