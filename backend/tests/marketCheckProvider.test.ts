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
      zip: "60502",
      mileage: 18400,
      condition: "good",
      requestMeta: {
        requestId: "req-value-1",
        cacheKey: "value:2023:volvo:xc40:core:60502:18400:good",
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
      zip: "60502",
      radiusMiles: 50,
      requestMeta: {
        cacheKey: "listings:2023:volvo:xc40:core:60502:50",
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
      zip: "60502",
      mileage: 18400,
      condition: "good",
      requestMeta: { requestId: "req-value", cacheKey: "value-key", sourceScreen: "valueScreen" },
    });

    await provider.getListings({
      vehicleId: vehicle.id,
      vehicle,
      zip: "60502",
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
      zip: "60502",
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
      zip: "60502",
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

  test("explicit value refresh is allowed when action is missing but allowLive/fetchReason/sourceScreen are present", async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return createJsonResponse({
        stats: {
          price: {
            median: 156000,
            min: 150000,
            max: 162000,
          },
        },
      });
    }) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const result = await provider.getValuation({
      vehicleId: "2006-ferrari-f430",
      vehicle: {
        id: "2006-ferrari-f430",
        vin: null,
        year: 2006,
        make: "Ferrari",
        model: "F430",
        trim: "Base",
        bodyStyle: "Coupe",
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
      zip: "60502",
      mileage: 18400,
      condition: "good",
      requestMeta: {
        requestId: "req-explicit-metadata",
        cacheKey: "value:ferrari:f430:explicit",
        allowLive: true,
        reason: "user_requested_value_refresh",
        sourceScreen: "valueScreen",
      },
    });

    assert.equal(fetchCalls, 1);
    assert.ok((result?.privateParty ?? 0) > 0);
  });

  test("normal value refresh respects zero-result cache even when forceLive is sent", async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return createJsonResponse({
        listings: [],
        stats: {},
      });
    }) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const input = {
      vehicleId: "2014-toyota-4runner-base",
      vehicle: {
        id: "2014-toyota-4runner-base",
        vin: null,
        year: 2014,
        make: "Toyota",
        model: "4Runner",
        trim: "Base",
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
      zip: "60563",
      mileage: 98000,
      condition: "good" as const,
      requestMeta: {
        requestId: "req-zero-value-cache",
        cacheKey: "value:2014:toyota:4runner:base:60563:98000:good",
        allowLive: true,
        forceLive: true,
        reason: "user_requested_value_refresh",
        sourceScreen: "valueScreen",
        action: "valueRefresh",
      },
    };

    const first = await provider.getValuation(input);
    const second = await provider.getValuation(input);

    assert.equal(first, null);
    assert.equal(second, null);
    assert.equal(fetchCalls, 1);
  });

  test("normal listings refresh respects zero-result cache even when forceLive is sent", async () => {
    let fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return createJsonResponse({
        listings: [],
        stats: {},
      });
    }) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const input = {
      vehicleId: "2014-toyota-4runner-base",
      vehicle: {
        id: "2014-toyota-4runner-base",
        vin: null,
        year: 2014,
        make: "Toyota",
        model: "4Runner",
        trim: "",
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
      zip: "60563",
      radiusMiles: 100,
      requestMeta: {
        requestId: "req-zero-listings-cache",
        cacheKey: "listings:2014:toyota:4runner:any:60563:100",
        allowLive: true,
        forceLive: true,
        reason: "user_requested_listings_refresh",
        sourceScreen: "listingsScreen",
        action: "listingsRefresh",
      },
    };

    const first = await provider.getListings(input);
    const second = await provider.getListings(input);

    assert.equal(first.length, 0);
    assert.equal(second.length, 0);
    assert.equal(fetchCalls, 1);
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

  test("Ferrari 812 listings accept family-model matches like 812 when requested model is 812 Superfast", async () => {
    global.fetch = (async () =>
      createJsonResponse({
        listings: [
          {
            id: "listing-812",
            vin: "ZFF83CLA0M0260001",
            year: 2021,
            make: "Ferrari",
            model: "812",
            trim: "",
            heading: "2021 Ferrari 812 Coupe",
            price: 339995,
            miles: 7800,
            dealer_name: "Exotic Motors",
            city: "Chicago",
            state: "IL",
            img_url: "https://dealer.example.test/ferrari-812.jpg",
            vdp_url: "https://dealer.example.test/ferrari-812",
          },
        ],
      })) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const listings = await provider.getListings({
      vehicleId: "2021-ferrari-812-superfast",
      vehicle: {
        id: "2021-ferrari-812-superfast",
        vin: null,
        year: 2021,
        make: "Ferrari",
        model: "812 Superfast",
        trim: "Base",
        bodyStyle: "Coupe",
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
      zip: "60563",
      radiusMiles: 100,
      requestMeta: {
        cacheKey: "listings:condition-set:2021:ferrari:812-superfast:base:60563:100",
        sourceScreen: "listingsScreen",
      },
    });

    assert.equal(listings.length, 1);
    assert.equal(listings[0]?.price, 339995);
  });

  test("Ferrari 812 valuation can be derived from live listings when stats are empty", async () => {
    global.fetch = (async () =>
      createJsonResponse({
        listings: [
          {
            id: "listing-812",
            vin: "ZFF83CLA0M0260001",
            year: 2021,
            make: "Ferrari",
            model: "812",
            trim: "",
            heading: "2021 Ferrari 812 Coupe",
            price: 339995,
            miles: 7800,
            dealer_name: "Exotic Motors",
            city: "Chicago",
            state: "IL",
            img_url: "https://dealer.example.test/ferrari-812.jpg",
            vdp_url: "https://dealer.example.test/ferrari-812",
          },
        ],
      })) as typeof fetch;

    const provider = new MarketCheckVehicleDataProvider();
    const valuation = await provider.getValuation({
      vehicleId: "2021-ferrari-812-superfast",
      vehicle: {
        id: "2021-ferrari-812-superfast",
        vin: null,
        year: 2021,
        make: "Ferrari",
        model: "812 Superfast",
        trim: "Base",
        bodyStyle: "Coupe",
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
      zip: "60563",
      mileage: 18400,
      condition: "good",
      requestMeta: {
        cacheKey: "values:condition-set:2021:ferrari:812-superfast:base:60563:18400",
        sourceScreen: "valueScreen",
      },
    });

    assert.ok(valuation);
    assert.equal(valuation?.modelType, "listing_derived");
    assert.equal(valuation?.listingCount, 1);
    assert.equal(valuation?.supportingListings?.length, 1);
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
