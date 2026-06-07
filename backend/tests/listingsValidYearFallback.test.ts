import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { env } from "../src/config/env.js";
import { setProviders } from "../src/lib/providerRegistry.js";
import { setRepositories } from "../src/lib/repositoryRegistry.js";
import { VehicleService } from "../src/services/vehicleService.js";
import { ListingRecord, VehicleRecord } from "../src/types/domain.js";
import { createTestProviders, createTestRepositories } from "./helpers/testData.js";

const invalidContinental: VehicleRecord = {
  id: "2014-lincoln-continental-base",
  vin: null,
  year: 2014,
  make: "Lincoln",
  model: "Continental",
  trim: "Base",
  bodyStyle: "Sedan",
  vehicleType: "car",
  msrp: 0,
  engine: null,
  horsepower: null,
  torque: null,
  transmission: null,
  drivetrain: null,
  mpgOrRange: null,
  colors: [],
};

const invalidFerrari: VehicleRecord = {
  id: "2014-ferrari-f430-base",
  vin: null,
  year: 2014,
  make: "Ferrari",
  model: "F430",
  trim: "Base",
  bodyStyle: "Coupe",
  vehicleType: "car",
  msrp: 0,
  engine: null,
  horsepower: null,
  torque: null,
  transmission: null,
  drivetrain: null,
  mpgOrRange: null,
  colors: [],
};

type ListingsCall = {
  year: number | null;
  radiusMiles: number;
  fallbackStrategy: string | null;
};

function createContinentalListings(year: number, count = 6): ListingRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `continental-${year}-${index + 1}`,
    vehicleId: `lincoln-continental-${year}`,
    title: `${year} Lincoln Continental Select #${index + 1}`,
    year,
    make: "Lincoln",
    model: "Continental",
    trim: "Select",
    price: 22000 + index * 500,
    mileage: 42000 + index * 1000,
    dealer: "Aurora Lincoln",
    distanceMiles: 6 + index,
    location: "Aurora, IL",
    listingUrl: `https://dealer.example.test/continental/${year}/${index + 1}`,
    imageUrl: "https://example.test/continental.jpg",
    listedAt: "2026-06-01T12:00:00.000Z",
  }));
}

function setMarketCheckListingsProvider(input: {
  calls: ListingsCall[];
  listingsForYear?: number;
}) {
  setProviders({
    ...createTestProviders(),
    listingsProviderName: "marketcheck",
    listingsProvider: {
      async getListings(request) {
        input.calls.push({
          year: request.vehicle?.year ?? null,
          radiusMiles: request.radiusMiles,
          fallbackStrategy: request.requestMeta?.fallbackStrategy ?? null,
        });
        return input.listingsForYear && request.vehicle?.year === input.listingsForYear
          ? createContinentalListings(input.listingsForYear)
          : [];
      },
    },
  });
}

async function fetchContinentalListings(radiusMiles = 100) {
  const service = new VehicleService();
  return service.getListings({
    vehicleId: invalidContinental.id,
    zip: "60502",
    radiusMiles,
    mileage: 60000,
    allowLive: true,
    fetchReason: "user_requested_listings_refresh",
    sourceScreen: "listingsScreen",
    action: "listingsRefresh",
    forceLive: true,
  });
}

beforeEach(() => {
  const testRepositories = createTestRepositories({ vehicles: [invalidContinental, invalidFerrari] });
  setRepositories(testRepositories.repositories);
  env.MARKETCHECK_ENABLED = true;
  env.MARKETCHECK_DISABLE_EXTERNAL_CALLS = false;
});

describe("listings catalog-valid-year fallback", () => {
  test("2014 Lincoln Continental falls back to nearest valid Continental listings with limited confidence copy", async () => {
    const calls: ListingsCall[] = [];
    setMarketCheckListingsProvider({ calls, listingsForYear: 2017 });

    const result = await fetchContinentalListings();

    assert.equal(result.data.length, 6);
    assert.equal(result.data[0]?.year, 2017);
    assert.deepEqual(calls.map((call) => call.year), [2014, 2017]);
    assert.equal(calls[1]?.fallbackStrategy, "valid-year-same-model");
    assert.equal(result.meta?.fallbackReason, "valid-year-same-model");
    assert.equal(result.meta?.sourceLabel, "Limited comps from the nearest valid model year");
    assert.equal(result.meta?.mode, "adjacent_year_mixed_trims");
  });

  test("invalid Lincoln Continental year attempts nearest valid catalog years within the normal call cap", async () => {
    const calls: ListingsCall[] = [];
    setMarketCheckListingsProvider({ calls });

    const result = await fetchContinentalListings();

    assert.equal(result.data.length, 0);
    assert.deepEqual(calls.map((call) => call.year), [2014, 2017, 2018]);
    assert.ok(calls.length <= 3);
    assert.equal(calls[1]?.fallbackStrategy, "valid-year-same-model");
    assert.equal(calls[2]?.fallbackStrategy, "valid-year-same-model");
  });

  test("valid-year fallback keeps MarketCheck listing radius capped at 100 miles", async () => {
    const calls: ListingsCall[] = [];
    setMarketCheckListingsProvider({ calls, listingsForYear: 2017 });

    await fetchContinentalListings(250);

    assert.ok(calls.length > 0);
    assert.deepEqual(calls.map((call) => call.radiusMiles), calls.map(() => 100));
  });

  test("specialty and exotic vehicles do not jump to catalog-valid generation years", async () => {
    const calls: ListingsCall[] = [];
    setMarketCheckListingsProvider({ calls });

    const service = new VehicleService();
    const result = await service.getListings({
      vehicleId: invalidFerrari.id,
      zip: "60502",
      radiusMiles: 100,
      mileage: 12000,
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
      forceLive: true,
    });

    assert.equal(result.data.length, 0);
    assert.ok(calls.length <= 2);
    assert.equal(calls.some((call) => call.fallbackStrategy === "valid-year-same-model"), false);
  });
});
