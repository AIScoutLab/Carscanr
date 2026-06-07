import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { env } from "../src/config/env.js";
import { getListingsCacheKey } from "../src/lib/providerCache.js";
import { setProviders } from "../src/lib/providerRegistry.js";
import { setRepositories } from "../src/lib/repositoryRegistry.js";
import { VehicleService } from "../src/services/vehicleService.js";
import { ListingRecord, ValuationRecord, VehicleRecord } from "../src/types/domain.js";
import { createTestProviders, createTestRepositories } from "./helpers/testData.js";

const ct4: VehicleRecord = {
  id: "2021-cadillac-ct4-premium-luxury",
  vin: null,
  year: 2021,
  make: "Cadillac",
  model: "CT4",
  trim: "Premium Luxury",
  bodyStyle: "Sedan",
  vehicleType: "car",
  msrp: 38200,
  engine: "2.0L I4",
  horsepower: 237,
  torque: "258 lb-ft",
  transmission: "8-speed automatic",
  drivetrain: "RWD",
  mpgOrRange: "23 city / 34 highway",
  colors: ["Black"],
};

const ferrariF430: VehicleRecord = {
  id: "2007-ferrari-f430",
  vin: null,
  year: 2007,
  make: "Ferrari",
  model: "F430",
  trim: "Base",
  bodyStyle: "Coupe",
  vehicleType: "car",
  msrp: 0,
  engine: "4.3L V8",
  horsepower: 483,
  torque: "343 lb-ft",
  transmission: "6-speed automated manual",
  drivetrain: "RWD",
  mpgOrRange: "11 city / 16 highway",
  colors: ["Red"],
};

function createListings(vehicle: VehicleRecord, count = 6): ListingRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `shared-listing-${index + 1}`,
    vehicleId: vehicle.id,
    title: `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim} #${index + 1}`,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    price: 30000 + index * 750,
    mileage: 10000 + index * 1000,
    dealer: "Shared Market Dealer",
    distanceMiles: 8 + index,
    location: "Aurora, IL",
    listingUrl: `https://dealer.example.test/${vehicle.id}/${index + 1}`,
    imageUrl: "https://example.test/ct4.jpg",
    listedAt: "2026-06-01T12:00:00.000Z",
  }));
}

function createValue(vehicle: VehicleRecord, supportingListings: ListingRecord[]): ValuationRecord {
  return {
    id: `live-value-${vehicle.id}`,
    vehicleId: vehicle.id,
    zip: "60502",
    mileage: 18400,
    condition: "good",
    status: "loaded_value",
    tradeIn: 28000,
    privateParty: 30500,
    dealerRetail: 32900,
    low: 29200,
    median: 30500,
    high: 33800,
    currency: "USD",
    generatedAt: "2026-06-01T12:00:00.000Z",
    sourceLabel: "Based on live MarketCheck listings",
    confidenceLabel: "High confidence",
    modelType: "provider_range",
    listingCount: supportingListings.length,
    supportingListings,
  };
}

beforeEach(() => {
  const testRepositories = createTestRepositories({ vehicles: [ct4, ferrariF430] });
  setRepositories(testRepositories.repositories);
  env.MARKETCHECK_ENABLED = true;
  env.MARKETCHECK_DISABLE_EXTERNAL_CALLS = false;
  env.MARKETCHECK_VALUE_RADIUS_MILES = 100;
});

describe("MarketCheck shared value/listings dedupe", () => {
  test("concurrent value-first value and listings requests reuse one live MarketCheck inventory result", async () => {
    const listings = createListings(ct4);
    let valueCalls = 0;
    let listingsCalls = 0;
    let valueProviderStarted!: () => void;
    const valueProviderStartedPromise = new Promise<void>((resolve) => {
      valueProviderStarted = resolve;
    });
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          valueCalls += 1;
          valueProviderStarted();
          await new Promise((resolve) => setTimeout(resolve, 25));
          return createValue(ct4, listings);
        },
      },
      listingsProvider: {
        async getListings() {
          listingsCalls += 1;
          return [];
        },
      },
    });

    const service = new VehicleService();
    const valuePromise = service.getValue({
      vehicleId: ct4.id,
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
    });
    await valueProviderStartedPromise;
    const listingsPromise = service.getListings({
      vehicleId: ct4.id,
      zip: "60502",
      radiusMiles: 100,
      mileage: 18400,
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
      forceLive: true,
    });

    const [valueResult, listingsResult] = await Promise.all([valuePromise, listingsPromise]);

    assert.equal(valueCalls, 1);
    assert.equal(listingsCalls, 0);
    assert.equal(valueResult.data.status, "loaded_condition_set");
    assert.equal(listingsResult.data.length, listings.length);
    assert.equal(listingsResult.meta?.fallbackReason, "shared-inflight-cache-hit");
  });

  test("concurrent listings-first value request derives value from the in-flight listings result", async () => {
    const listings = createListings(ct4);
    let valueCalls = 0;
    let listingsCalls = 0;
    let listingsProviderStarted!: () => void;
    const listingsProviderStartedPromise = new Promise<void>((resolve) => {
      listingsProviderStarted = resolve;
    });
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          valueCalls += 1;
          return createValue(ct4, listings);
        },
      },
      listingsProvider: {
        async getListings() {
          listingsCalls += 1;
          listingsProviderStarted();
          await new Promise((resolve) => setTimeout(resolve, 25));
          return listings;
        },
      },
    });

    const service = new VehicleService();
    const listingsPromise = service.getListings({
      vehicleId: ct4.id,
      zip: "60502",
      radiusMiles: 100,
      mileage: 18400,
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
      forceLive: true,
    });
    await listingsProviderStartedPromise;
    const valuePromise = service.getValue({
      vehicleId: ct4.id,
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
    });

    const [listingsResult, valueResult] = await Promise.all([listingsPromise, valuePromise]);

    assert.equal(listingsCalls, 1);
    assert.equal(valueCalls, 0);
    assert.equal(listingsResult.data.length, listings.length);
    assert.equal(valueResult.data.valuationSource, "listing_comps");
    assert.equal(valueResult.data.listingCount, listings.length);
  });

  test("listings cache key includes ZIP year make model trim and radius", () => {
    const descriptor = {
      year: ct4.year,
      make: ct4.make,
      model: ct4.model,
      trim: ct4.trim,
      normalizedMake: "cadillac",
      normalizedModel: "ct4",
      normalizedTrim: "premium-luxury",
    };

    assert.equal(
      getListingsCacheKey(descriptor, { zip: "60502", radiusMiles: 100 }),
      "listings:2021:cadillac:ct4:premium-luxury:60502:100",
    );
    assert.notEqual(
      getListingsCacheKey(descriptor, { zip: "60502", radiusMiles: 50 }),
      getListingsCacheKey(descriptor, { zip: "60502", radiusMiles: 100 }),
    );
    assert.notEqual(
      getListingsCacheKey(descriptor, { zip: "60601", radiusMiles: 100 }),
      getListingsCacheKey(descriptor, { zip: "60502", radiusMiles: 100 }),
    );
  });

  test("specialty value refresh does not reuse generic listings in-flight", async () => {
    let valueCalls = 0;
    let listingsCalls = 0;
    let listingsProviderStarted!: () => void;
    const listingsProviderStartedPromise = new Promise<void>((resolve) => {
      listingsProviderStarted = resolve;
    });
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          valueCalls += 1;
          return null;
        },
      },
      listingsProvider: {
        async getListings() {
          listingsCalls += 1;
          listingsProviderStarted();
          await new Promise((resolve) => setTimeout(resolve, 25));
          return createListings(ferrariF430, 3);
        },
      },
    });

    const service = new VehicleService();
    const listingsPromise = service.getListings({
      vehicleId: ferrariF430.id,
      zip: "60502",
      radiusMiles: 100,
      mileage: 18400,
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
      forceLive: true,
    });
    await listingsProviderStartedPromise;
    const valueResult = await service.getValue({
      vehicleId: ferrariF430.id,
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
    });
    await listingsPromise;

    assert.equal(listingsCalls, 1);
    assert.equal(valueCalls, 1);
    assert.equal(valueResult.data.status, "no_comps_found");
  });
});
