import { after, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { env } from "../src/config/env.js";
import { setRepositories } from "../src/lib/repositoryRegistry.js";
import { MarketCheckVehicleDataProvider } from "../src/providers/marketcheck/marketCheckVehicleDataProvider.js";
import { createTestRepositories } from "./helpers/testData.js";

const originalFetch = global.fetch;
const originalEnv = {
  MARKETCHECK_ENABLED: env.MARKETCHECK_ENABLED,
  MARKETCHECK_API_KEY: env.MARKETCHECK_API_KEY,
  MARKETCHECK_DISABLE_EXTERNAL_CALLS: env.MARKETCHECK_DISABLE_EXTERNAL_CALLS,
  MARKETCHECK_MONTHLY_CALL_LIMIT: env.MARKETCHECK_MONTHLY_CALL_LIMIT,
  MARKETCHECK_WARN_AT: env.MARKETCHECK_WARN_AT,
};

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

beforeEach(() => {
  setRepositories(createTestRepositories().repositories);
  env.MARKETCHECK_ENABLED = true;
  env.MARKETCHECK_API_KEY = "test-marketcheck-key";
  env.MARKETCHECK_DISABLE_EXTERNAL_CALLS = false;
  env.MARKETCHECK_MONTHLY_CALL_LIMIT = 500;
  env.MARKETCHECK_WARN_AT = 400;
  global.fetch = originalFetch;
});

describe("MarketCheck provider request guards", () => {
  test("identical value request twice only makes one external call", async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return createJsonResponse({
        stats: {
          price: {
            median: 35200,
            min: 33000,
            max: 36995,
          },
        },
      });
    }) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const input = {
      vehicleId: "live:2023-volvo-xc40-core",
      vehicle: {
        id: "live:2023-volvo-xc40-core",
        vin: null,
        year: 2023,
        make: "Volvo",
        model: "XC40",
        trim: "Core",
        bodyStyle: "SUV",
        vehicleType: "car" as const,
        msrp: 0,
        engine: "",
        horsepower: null,
        torque: "",
        transmission: "",
        drivetrain: "",
        mpgOrRange: "",
        colors: [],
      },
      zip: "60610",
      mileage: 18400,
      condition: "good",
      requestMeta: {
        requestId: "req-value-1",
        cacheKey: "value:2023:volvo:xc40:core:60610:18400:good",
        sourceScreen: "valueScreen",
      },
    };

    await provider.getValuation(input);
    await provider.getValuation({ ...input, requestMeta: { ...input.requestMeta, requestId: "req-value-2" } });

    assert.equal(fetchCalls, 1);
  });

  test("concurrent identical listings requests share one inflight external call", async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return createJsonResponse({
        listings: [
          {
            id: "listing-1",
            vin: "VIN123",
            year: 2023,
            make: "Volvo",
            model: "XC40",
            trim: "Core",
            heading: "2023 Volvo XC40 Core",
            price: 36995,
            miles: 12000,
            dealer_name: "Northside Volvo",
            city: "Chicago",
            state: "IL",
            img_url: "https://example.test/xc40.jpg",
            vdp_url: "https://dealer.example.test/xc40",
          },
        ],
      });
    }) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const input = {
      vehicleId: "live:2023-volvo-xc40-core",
      vehicle: {
        id: "live:2023-volvo-xc40-core",
        vin: null,
        year: 2023,
        make: "Volvo",
        model: "XC40",
        trim: "Core",
        bodyStyle: "SUV",
        vehicleType: "car" as const,
        msrp: 0,
        engine: "",
        horsepower: null,
        torque: "",
        transmission: "",
        drivetrain: "",
        mpgOrRange: "",
        colors: [],
      },
      zip: "60610",
      radiusMiles: 50,
      requestMeta: {
        cacheKey: "listings:2023:volvo:xc40:core:60610:50",
        sourceScreen: "listingsScreen",
      },
    };

    await Promise.all([
      provider.getListings({ ...input, requestMeta: { ...input.requestMeta, requestId: "req-listings-1" } }),
      provider.getListings({ ...input, requestMeta: { ...input.requestMeta, requestId: "req-listings-2" } }),
    ]);

    assert.equal(fetchCalls, 1);
  });

  test("value and listings cache keys do not collide", async () => {
    let fetchCalls = 0;
    global.fetch = (async (url: string | URL | Request) => {
      fetchCalls += 1;
      const text = String(url);
      if (text.includes("stats=price")) {
        return createJsonResponse({
          stats: {
            price: {
              median: 35200,
              min: 33000,
              max: 36995,
            },
          },
        });
      }
      return createJsonResponse({
        listings: [
          {
            id: "listing-1",
            vin: "VIN123",
            year: 2023,
            make: "Volvo",
            model: "XC40",
            trim: "Core",
            heading: "2023 Volvo XC40 Core",
            price: 36995,
            miles: 12000,
            dealer_name: "Northside Volvo",
            city: "Chicago",
            state: "IL",
            img_url: "https://example.test/xc40.jpg",
            vdp_url: "https://dealer.example.test/xc40",
          },
        ],
      });
    }) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const vehicle = {
      id: "live:2023-volvo-xc40-core",
      vin: null,
      year: 2023,
      make: "Volvo",
      model: "XC40",
      trim: "Core",
      bodyStyle: "SUV",
      vehicleType: "car" as const,
      msrp: 0,
      engine: "",
      horsepower: null,
      torque: "",
      transmission: "",
      drivetrain: "",
      mpgOrRange: "",
      colors: [],
    };

    await provider.getValuation({
      vehicleId: vehicle.id,
      vehicle,
      zip: "60610",
      mileage: 18400,
      condition: "good",
      requestMeta: { requestId: "req-value", cacheKey: "value-key", sourceScreen: "valueScreen" },
    });

    await provider.getListings({
      vehicleId: vehicle.id,
      vehicle,
      zip: "60610",
      radiusMiles: 50,
      requestMeta: { requestId: "req-listings", cacheKey: "listings-key", sourceScreen: "listingsScreen" },
    });

    assert.equal(fetchCalls, 2);
  });

  test("external calls can be disabled and fall back gracefully", async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return createJsonResponse({});
    }) as typeof fetch;
    env.MARKETCHECK_DISABLE_EXTERNAL_CALLS = true;

    const provider = new MarketCheckVehicleDataProvider();
    const valuationResult = await provider.getValuation({
      vehicleId: "live:2023-volvo-xc40-core",
      vehicle: {
        id: "live:2023-volvo-xc40-core",
        vin: null,
        year: 2023,
        make: "Volvo",
        model: "XC40",
        trim: "Core",
        bodyStyle: "SUV",
        vehicleType: "car" as const,
        msrp: 0,
        engine: "",
        horsepower: null,
        torque: "",
        transmission: "",
        drivetrain: "",
        mpgOrRange: "",
        colors: [],
      },
      zip: "60610",
      mileage: 18400,
      condition: "good",
      requestMeta: {
        requestId: "req-guard",
        cacheKey: "value-key-guard",
        sourceScreen: "valueScreen",
      },
    });

    const listingsResult = await provider.getListings({
      vehicleId: "live:2023-volvo-xc40-core",
      vehicle: {
        id: "live:2023-volvo-xc40-core",
        vin: null,
        year: 2023,
        make: "Volvo",
        model: "XC40",
        trim: "Core",
        bodyStyle: "SUV",
        vehicleType: "car" as const,
        msrp: 0,
        engine: "",
        horsepower: null,
        torque: "",
        transmission: "",
        drivetrain: "",
        mpgOrRange: "",
        colors: [],
      },
      zip: "60610",
      radiusMiles: 50,
      requestMeta: {
        requestId: "req-guard-listings",
        cacheKey: "listings-key-guard",
        sourceScreen: "listingsScreen",
      },
    });

    const specsResult = await provider.getVehicleSpecs({
      vehicleId: "live:2023-volvo-xc40-core",
      vehicle: {
        id: "live:2023-volvo-xc40-core",
        vin: null,
        year: 2023,
        make: "Volvo",
        model: "XC40",
        trim: "Core",
        bodyStyle: "SUV",
        vehicleType: "car" as const,
        msrp: 0,
        engine: "",
        horsepower: null,
        torque: "",
        transmission: "",
        drivetrain: "",
        mpgOrRange: "",
        colors: [],
      },
      requestMeta: {
        requestId: "req-guard-specs",
        cacheKey: "specs-key-guard",
        sourceScreen: "specsScreen",
      },
    });

    assert.equal(fetchCalls, 0);
    assert.equal(valuationResult, null);
    assert.deepEqual(listingsResult, []);
    assert.equal(specsResult, null);
  });

  test("scan-tagged requests never make outbound MarketCheck calls", async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return createJsonResponse({});
    }) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    await provider.searchCandidates({
      year: 2023,
      make: "Cadillac",
      model: "Lyriq",
      trim: "600",
      requestMeta: {
        requestId: "req-scan-1",
        sourceScreen: "scan",
        reason: "scan_identify_provider_enrichment",
        stackTag: "scan-identify",
        cacheKey: "scan-blocked-key",
      },
    });

    assert.equal(fetchCalls, 0);
  });

  test("unknown source requests never make outbound MarketCheck calls", async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return createJsonResponse({});
    }) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const result = await provider.getVehicleSpecs({
      vehicleId: "live:2023-cadillac-lyriq-600",
      vehicle: {
        id: "live:2023-cadillac-lyriq-600",
        vin: null,
        year: 2023,
        make: "Cadillac",
        model: "Lyriq",
        trim: "600",
        bodyStyle: "SUV",
        vehicleType: "car" as const,
        msrp: 0,
        engine: "",
        horsepower: null,
        torque: "",
        transmission: "",
        drivetrain: "",
        mpgOrRange: "",
        colors: [],
      },
      requestMeta: {
        requestId: "req-unknown-1",
        sourceScreen: "unknown",
        cacheKey: "unknown-blocked-key",
      },
    });

    assert.equal(fetchCalls, 0);
    assert.equal(result, null);
  });
});

after(() => {
  global.fetch = originalFetch;
  env.MARKETCHECK_ENABLED = originalEnv.MARKETCHECK_ENABLED;
  env.MARKETCHECK_API_KEY = originalEnv.MARKETCHECK_API_KEY;
  env.MARKETCHECK_DISABLE_EXTERNAL_CALLS = originalEnv.MARKETCHECK_DISABLE_EXTERNAL_CALLS;
  env.MARKETCHECK_MONTHLY_CALL_LIMIT = originalEnv.MARKETCHECK_MONTHLY_CALL_LIMIT;
  env.MARKETCHECK_WARN_AT = originalEnv.MARKETCHECK_WARN_AT;
});
