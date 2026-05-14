import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { vehicleValueQuerySchema } from "../src/types/api.js";

describe("vehicle value refresh metadata parsing", () => {
  test("vehicle value query schema preserves explicit refresh metadata", () => {
    const parsed = vehicleValueQuerySchema.parse({
      vehicleId: "519f29ed-979c-44ee-b443-83b2ce480333",
      zip: "60502",
      mileage: "18400",
      condition: "good",
      allowLive: "true",
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: "1",
    });

    assert.equal(parsed.allowLive, true);
    assert.equal(parsed.fetchReason, "user_requested_value_refresh");
    assert.equal(parsed.sourceScreen, "valueScreen");
    assert.equal(parsed.action, "valueRefresh");
    assert.equal(parsed.forceLive, true);
    assert.equal(parsed.mileage, 18400);
  });

  test("vehicle value query schema rejects missing ZIP instead of silently falling back", () => {
    assert.throws(() =>
      vehicleValueQuerySchema.parse({
        vehicleId: "519f29ed-979c-44ee-b443-83b2ce480333",
        mileage: "18400",
        condition: "good",
      }),
    );
  });
});
