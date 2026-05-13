import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { env } from "../src/config/env.js";
import {
  buildFamilyCacheDescriptor,
  createValuesCacheRow,
  createListingsCacheRow,
  getFamilyValuesCacheKey,
  getFamilyListingsCacheKey,
} from "../src/lib/providerCache.js";
import { setProviders } from "../src/lib/providerRegistry.js";
import { setRepositories } from "../src/lib/repositoryRegistry.js";
import { SubscriptionService } from "../src/services/subscriptionService.js";
import { trendingVehicleService } from "../src/services/trendingVehicleService.js";
import { UsageService } from "../src/services/usageService.js";
import { ScanService } from "../src/services/scanService.js";
import { VehicleService } from "../src/services/vehicleService.js";
import { createTestProviders, createTestRepositories, createVisionProviderResult } from "./helpers/testData.js";

const TEST_IMAGE_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2uoAAAAASUVORK5CYII=",
  "base64",
);

beforeEach(() => {
  const testRepositories = createTestRepositories();
  setRepositories(testRepositories.repositories);
  setProviders(createTestProviders());
  env.MARKETCHECK_ENABLED = true;
  env.MARKETCHECK_DISABLE_EXTERNAL_CALLS = false;
  env.MARKETCHECK_ENABLE_SCAN_ENRICHMENT = false;
  env.MARKETCHECK_ENABLE_AUTO_SPECS = false;
  env.MARKETCHECK_ENABLE_AUTO_LISTINGS = false;
  env.MARKETCHECK_ENABLE_BACKGROUND_REFRESH = false;
});

describe("bootstrap cost control", () => {
  test("guest usage starts with 3 free Pro unlocks", async () => {
    const usageService = new UsageService(new SubscriptionService());
    const summary = await usageService.getUsageSummary("guest:test-user");

    assert.equal(summary.freeUnlocksTotal, 3);
    assert.equal(summary.freeUnlocksRemaining, 3);
  });

  test("estimated value returns without calling live provider when allowLive is false", async () => {
    let providerCalls = 0;
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          providerCalls += 1;
          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60610",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "initial_load",
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.data.sourceLabel, "Estimated from vehicle data");
    assert.ok(result.data.privateParty > 0);
  });

  test("Ferrari F430 without trusted market data suppresses generic fallback valuation", async () => {
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2007-ferrari-f430",
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
          colors: ["Rosso Corsa"],
        },
      ],
      valuations: [],
      listings: [],
    });
    setRepositories(testRepositories.repositories);

    let providerCalls = 0;
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          providerCalls += 1;
          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2007-ferrari-f430",
      zip: "60610",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "initial_load",
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.data.modelType, "specialty_unavailable");
    assert.equal(result.data.sourceLabel, "Specialty market value unavailable");
    assert.equal(result.data.privateParty, 0);
  });

  test("Ferrari F430 passive value open rejects generic family cached valuation and makes zero calls", async () => {
    const ferrariDescriptor = {
      year: 2006,
      make: "Ferrari",
      model: "F430",
      trim: "Base",
      vehicleType: "car" as const,
      normalizedMake: "ferrari",
      normalizedModel: "f430",
      normalizedTrim: "base",
    };
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2006-ferrari-f430",
          year: 2006,
          make: "Ferrari",
          model: "F430",
          trim: "Base",
          bodyStyle: "Coupe",
          vehicleType: "car",
          msrp: 186925,
          engine: "4.3L V8",
          horsepower: 483,
          torque: "343 lb-ft",
          transmission: "6-speed automated manual",
          drivetrain: "RWD",
          mpgOrRange: "11 city / 16 highway",
          colors: ["Rosso Corsa"],
        },
      ],
      valuations: [],
      listings: [],
    });
    testRepositories.state.valuesCache.push(
      createValuesCacheRow({
        descriptor: buildFamilyCacheDescriptor(ferrariDescriptor),
        cacheKey: getFamilyValuesCacheKey(ferrariDescriptor, {
          zip: "60610",
          mileage: 18400,
          condition: "good",
        }),
        provider: "marketcheck",
        zip: "60610",
        mileage: 18400,
        condition: "good",
        payload: {
          id: "cached-ferrari-family",
          vehicleId: "2006-ferrari-f430",
          zip: "60610",
          mileage: 18400,
          condition: "good",
          tradeIn: 27822,
          privateParty: 30215,
          dealerRetail: 32104,
          currency: "USD",
          generatedAt: "2026-05-13T00:00:00.000Z",
          sourceLabel: "Estimated from vehicle data",
          confidenceLabel: "Built from vehicle year, class, and original pricing data.",
          modelType: "estimated_depreciation",
        },
      }),
    );
    setRepositories(testRepositories.repositories);

    let providerCalls = 0;
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          providerCalls += 1;
          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2006-ferrari-f430",
      zip: "60610",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "initial_load",
      sourceScreen: "valueScreen",
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.data.modelType, "specialty_unavailable");
    assert.equal(result.data.sourceLabel, "Specialty market value unavailable");
  });

  test("Ferrari F430 explicit value refresh bypasses generic cached valuation and makes one live call", async () => {
    const ferrariDescriptor = {
      year: 2006,
      make: "Ferrari",
      model: "F430",
      trim: "Base",
      vehicleType: "car" as const,
      normalizedMake: "ferrari",
      normalizedModel: "f430",
      normalizedTrim: "base",
    };
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2006-ferrari-f430",
          year: 2006,
          make: "Ferrari",
          model: "F430",
          trim: "Base",
          bodyStyle: "Coupe",
          vehicleType: "car",
          msrp: 186925,
          engine: "4.3L V8",
          horsepower: 483,
          torque: "343 lb-ft",
          transmission: "6-speed automated manual",
          drivetrain: "RWD",
          mpgOrRange: "11 city / 16 highway",
          colors: ["Rosso Corsa"],
        },
      ],
      valuations: [],
      listings: [],
    });
    testRepositories.state.valuesCache.push(
      createValuesCacheRow({
        descriptor: buildFamilyCacheDescriptor(ferrariDescriptor),
        cacheKey: getFamilyValuesCacheKey(ferrariDescriptor, {
          zip: "60610",
          mileage: 18400,
          condition: "good",
        }),
        provider: "marketcheck",
        zip: "60610",
        mileage: 18400,
        condition: "good",
        payload: {
          id: "cached-ferrari-family",
          vehicleId: "2006-ferrari-f430",
          zip: "60610",
          mileage: 18400,
          condition: "good",
          tradeIn: 27822,
          privateParty: 30215,
          dealerRetail: 32104,
          currency: "USD",
          generatedAt: "2026-05-13T00:00:00.000Z",
          sourceLabel: "Estimated from vehicle data",
          confidenceLabel: "Built from vehicle year, class, and original pricing data.",
          modelType: "estimated_depreciation",
        },
      }),
    );
    setRepositories(testRepositories.repositories);

    let providerCalls = 0;
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          providerCalls += 1;
          return {
            id: "live-f430-value",
            vehicleId: "2006-ferrari-f430",
            zip: "60610",
            mileage: 18400,
            condition: "good",
            tradeIn: 142000,
            privateParty: 156000,
            dealerRetail: 169000,
            currency: "USD",
            generatedAt: "2026-05-13T00:00:00.000Z",
            sourceLabel: "Based on market data",
            confidenceLabel: "High confidence",
            modelType: "provider_range",
            tradeInLow: 136000,
            tradeInHigh: 148000,
            privatePartyLow: 150000,
            privatePartyHigh: 162000,
            dealerRetailLow: 163000,
            dealerRetailHigh: 175000,
          };
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2006-ferrari-f430",
      zip: "60610",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.data.modelType, "provider_range");
    assert.ok((result.data.privateParty ?? 0) >= 150000);
  });

  test("Ferrari F430 explicit value refresh returns specialty unavailable when live provider has no result", async () => {
    const ferrariDescriptor = {
      year: 2006,
      make: "Ferrari",
      model: "F430",
      trim: "Base",
      vehicleType: "car" as const,
      normalizedMake: "ferrari",
      normalizedModel: "f430",
      normalizedTrim: "base",
    };
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2006-ferrari-f430",
          year: 2006,
          make: "Ferrari",
          model: "F430",
          trim: "Base",
          bodyStyle: "Coupe",
          vehicleType: "car",
          msrp: 186925,
          engine: "4.3L V8",
          horsepower: 483,
          torque: "343 lb-ft",
          transmission: "6-speed automated manual",
          drivetrain: "RWD",
          mpgOrRange: "11 city / 16 highway",
          colors: ["Rosso Corsa"],
        },
      ],
      valuations: [],
      listings: [],
    });
    testRepositories.state.valuesCache.push(
      createValuesCacheRow({
        descriptor: buildFamilyCacheDescriptor(ferrariDescriptor),
        cacheKey: getFamilyValuesCacheKey(ferrariDescriptor, {
          zip: "60610",
          mileage: 18400,
          condition: "good",
        }),
        provider: "marketcheck",
        zip: "60610",
        mileage: 18400,
        condition: "good",
        payload: {
          id: "cached-ferrari-family",
          vehicleId: "2006-ferrari-f430",
          zip: "60610",
          mileage: 18400,
          condition: "good",
          tradeIn: 27822,
          privateParty: 30215,
          dealerRetail: 32104,
          currency: "USD",
          generatedAt: "2026-05-13T00:00:00.000Z",
          sourceLabel: "Estimated from vehicle data",
          confidenceLabel: "Built from vehicle year, class, and original pricing data.",
          modelType: "estimated_depreciation",
        },
      }),
    );
    setRepositories(testRepositories.repositories);

    let providerCalls = 0;
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          providerCalls += 1;
          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2006-ferrari-f430",
      zip: "60610",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.data.modelType, "specialty_unavailable");
    assert.equal(result.data.sourceLabel, "Specialty market value unavailable");
  });

  test("normal family cached estimated valuation still works for common vehicles", async () => {
    const civicDescriptor = {
      year: 2020,
      make: "Honda",
      model: "Civic",
      trim: "EX",
      vehicleType: "car" as const,
      normalizedMake: "honda",
      normalizedModel: "civic",
      normalizedTrim: "ex",
    };
    const testRepositories = createTestRepositories();
    testRepositories.state.valuesCache.push(
      createValuesCacheRow({
        descriptor: buildFamilyCacheDescriptor(civicDescriptor),
        cacheKey: getFamilyValuesCacheKey(civicDescriptor, {
          zip: "60610",
          mileage: 18400,
          condition: "good",
        }),
        provider: "marketcheck",
        zip: "60610",
        mileage: 18400,
        condition: "good",
        payload: {
          id: "cached-civic-family",
          vehicleId: "2020-honda-civic-ex",
          zip: "60610",
          mileage: 18400,
          condition: "good",
          tradeIn: 19200,
          privateParty: 20800,
          dealerRetail: 22100,
          currency: "USD",
          generatedAt: "2026-05-13T00:00:00.000Z",
          sourceLabel: "Estimated from vehicle family data",
          confidenceLabel: "Built from vehicle year, class, and family pricing data.",
          modelType: "estimated_family_model",
        },
      }),
    );
    setRepositories(testRepositories.repositories);

    let providerCalls = 0;
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          providerCalls += 1;
          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2020-honda-civic-ex",
      zip: "60610",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "initial_load",
      sourceScreen: "valueScreen",
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.data.modelType, "estimated_family_model");
    assert.equal(result.data.sourceLabel, "Estimated from vehicle family data");
  });

  test("initial listings load does not call live provider", async () => {
    let providerCalls = 0;
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings() {
          providerCalls += 1;
          return [];
        },
      },
    });

    const service = new VehicleService();
    await service.getListings({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60610",
      radiusMiles: 50,
      allowLive: false,
      fetchReason: "initial_load",
    });

    assert.equal(providerCalls, 0);
  });

  test("opening specs uses internal data and does not call MarketCheck by default", async () => {
    let providerCalls = 0;
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      specsProviderName: "marketcheck",
      specsProvider: {
        async getVehicleSpecs() {
          providerCalls += 1;
          return null;
        },
        async searchVehicles() {
          providerCalls += 1;
          return [];
        },
        async searchCandidates() {
          providerCalls += 1;
          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getSpecs({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      allowLive: false,
      fetchReason: "initial_load",
      sourceScreen: "specsScreen",
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.data?.id, "2021-cadillac-ct4-premium-luxury");
  });

  test("user requested value refresh calls MarketCheck valuation at most once", async () => {
    let valueProviderCalls = 0;
    let listingsProviderCalls = 0;
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          valueProviderCalls += 1;
          return null;
        },
      },
      listingsProvider: {
        async getListings() {
          listingsProviderCalls += 1;
          return [];
        },
      },
    });

    const service = new VehicleService();
    await service.getValue({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60610",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(valueProviderCalls, 1);
    assert.equal(listingsProviderCalls, 0);
  });

  test("user requested listings refresh calls MarketCheck listings at most once", async () => {
    env.ENABLE_LIVE_PROVIDER_CALLS = true;
    let listingsProviderCalls = 0;
    let valueProviderCalls = 0;
    let specsProviderCalls = 0;
    const providerTrims: Array<string | null> = [];
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      valueProviderName: "marketcheck",
      specsProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          valueProviderCalls += 1;
          return null;
        },
      },
      specsProvider: {
        async getVehicleSpecs() {
          specsProviderCalls += 1;
          return null;
        },
        async searchVehicles() {
          specsProviderCalls += 1;
          return [];
        },
        async searchCandidates() {
          specsProviderCalls += 1;
          return [];
        },
      },
      listingsProvider: {
        async getListings(input) {
          listingsProviderCalls += 1;
          providerTrims.push(input.vehicle?.trim ?? null);
          return [];
        },
      },
    });

    const service = new VehicleService();
    await service.getListings({
      vehicleId: "client-only-crv-base-id",
      descriptor: {
        year: 2015,
        make: "Honda",
        model: "CR-V",
        trim: "Base",
        vehicleType: "car",
        bodyStyle: "SUV",
        normalizedModel: "crv",
      },
      zip: "60610",
      radiusMiles: 50,
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
    });

    assert.equal(listingsProviderCalls, 1);
    assert.equal(valueProviderCalls, 0);
    assert.equal(specsProviderCalls, 0);
    assert.deepEqual(providerTrims, [""]);
  });

  test("scanning 3 cars makes 0 MarketCheck calls by default", async () => {
    let providerCalls = 0;
    const testRepositories = createTestRepositories({ vehicles: [] });
    setRepositories(testRepositories.repositories);
    env.ENABLE_LIVE_PROVIDER_CALLS = true;
    env.MARKETCHECK_ENABLE_SCAN_ENRICHMENT = true;
    setProviders({
      ...createTestProviders(
        createVisionProviderResult({
          normalized: {
            vehicle_type: "car",
            likely_year: 2022,
            likely_make: "Kia",
            likely_model: "Telluride",
            likely_trim: "",
            confidence: 0.96,
            visible_make_text: "Kia",
            visible_model_text: "Telluride",
            visible_clues: ["large Kia SUV"],
            alternate_candidates: [],
          },
        }),
      ),
      specsProviderName: "marketcheck",
      specsProvider: {
        async getVehicleSpecs() {
          providerCalls += 1;
          return null;
        },
        async searchVehicles() {
          providerCalls += 1;
          return [];
        },
        async searchCandidates() {
          providerCalls += 1;
          return [];
        },
      },
    });

    const service = new ScanService(new UsageService(new SubscriptionService()));
    for (let index = 0; index < 3; index += 1) {
      await service.identifyVehicle({
        auth: { userId: "demo-user", email: "demo@example.com", plan: "free" },
        imageBuffer: TEST_IMAGE_BUFFER,
        mimeType: "image/png",
        imageUrl: `memory://vehicle-${index}.png`,
      });
    }

    assert.equal(providerCalls, 0);
  });

  test("background scheduler makes 0 MarketCheck calls when disabled", async () => {
    let providerCalls = 0;
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      specsProviderName: "marketcheck",
      specsProvider: {
        async getVehicleSpecs() {
          providerCalls += 1;
          return null;
        },
        async searchVehicles() {
          providerCalls += 1;
          return [];
        },
        async searchCandidates() {
          providerCalls += 1;
          return [];
        },
      },
    });

    await trendingVehicleService.preloadTrendingCanonicalBatch();

    assert.equal(providerCalls, 0);
  });

  test("family listings cache hit avoids live provider calls", async () => {
    const descriptor = {
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      vehicleType: "car" as const,
      normalizedMake: "honda",
      normalizedModel: "cr-v",
      normalizedTrim: "ex-l",
    };
    const testRepositories = createTestRepositories();
    testRepositories.state.listingsCache.push(
      createListingsCacheRow({
        descriptor: buildFamilyCacheDescriptor(descriptor),
        cacheKey: getFamilyListingsCacheKey(descriptor, {
          zip: "60610",
          radiusMiles: 50,
        }),
        provider: "marketcheck",
        zip: "60610",
        radiusMiles: 50,
        payload: [
          {
            id: "cached-crv-listing",
            vehicleId: "cached-crv",
            year: 2023,
            make: "Honda",
            model: "CR-V",
            trim: "Sport",
            title: "2023 Honda CR-V Sport",
            price: 31995,
            mileage: 12000,
            dealer: "Northside Honda",
            distanceMiles: 14,
            location: "Chicago, IL",
            imageUrl: "https://dealer.example.test/crv.jpg",
            listingUrl: "https://dealer.example.test/listings/crv-sport",
            listedAt: "2026-04-20T00:00:00.000Z",
          },
        ],
      }),
    );
    setRepositories(testRepositories.repositories);

    let providerCalls = 0;
    const testProviders = createTestProviders();
    setProviders({
      ...testProviders,
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings() {
          providerCalls += 1;
          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getListings({
      vehicleId: "client-only-crv-id",
      descriptor: {
        year: 2023,
        make: "Honda",
        model: "CR-V",
        trim: "EX-L",
        vehicleType: "car",
        bodyStyle: "SUV",
        normalizedModel: "crv",
      },
      zip: "60610",
      radiusMiles: 50,
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.source, "cache");
    assert.equal(result.data.length, 1);
  });
});
