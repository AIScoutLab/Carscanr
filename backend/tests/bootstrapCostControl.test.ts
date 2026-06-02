import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { env } from "../src/config/env.js";
import {
  buildFamilyCacheDescriptor,
  createValuesCacheRow,
  createListingsCacheRow,
  getFamilyValuesCacheKey,
  getFamilyListingsCacheKey,
  getListingsCacheKey,
} from "../src/lib/providerCache.js";
import { setProviders } from "../src/lib/providerRegistry.js";
import { setRepositories } from "../src/lib/repositoryRegistry.js";
import { SubscriptionService } from "../src/services/subscriptionService.js";
import { trendingVehicleService } from "../src/services/trendingVehicleService.js";
import { UsageService } from "../src/services/usageService.js";
import { ScanService } from "../src/services/scanService.js";
import { VehicleService } from "../src/services/vehicleService.js";
import { MarketCheckVehicleDataProvider } from "../src/providers/marketcheck/marketCheckVehicleDataProvider.js";
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
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "initial_load",
    });

    assert.equal(providerCalls, 0);
    assert.match(
      result.data.sourceLabel ?? "",
      /Estimated from similar vehicles|Estimated from vehicle data|Estimated from nearby comparable listings/,
    );
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
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "initial_load",
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.data.status, "specialty_unavailable");
    assert.equal(result.data.modelType, "specialty_unavailable");
    assert.equal(result.data.sourceLabel, "Specialty market value unavailable");
    assert.equal(result.data.privateParty, null);
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
          zip: "60502",
          mileage: 18400,
        }),
        provider: "marketcheck",
        zip: "60502",
        mileage: 18400,
        condition: "good",
        payload: {
          id: "cached-ferrari-family",
          vehicleId: "2006-ferrari-f430",
          zip: "60502",
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
      zip: "60502",
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
          zip: "60502",
          mileage: 18400,
        }),
        provider: "marketcheck",
        zip: "60502",
        mileage: 18400,
        condition: "good",
        payload: {
          id: "cached-ferrari-family",
          vehicleId: "2006-ferrari-f430",
          zip: "60502",
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
            zip: "60502",
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
      zip: "60502",
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
          zip: "60502",
          mileage: 18400,
        }),
        provider: "marketcheck",
        zip: "60502",
        mileage: 18400,
        condition: "good",
        payload: {
          id: "cached-ferrari-family",
          vehicleId: "2006-ferrari-f430",
          zip: "60502",
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
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(providerCalls >= 1, true);
    assert.equal(result.data.status, "no_comps_found");
    assert.equal(result.data.modelType, "specialty_unavailable");
    assert.equal(result.data.sourceLabel, "No live market comps found");
    assert.equal(result.data.privateParty, null);
  });

  test("Ferrari explicit refresh still attempts live fallback calls when action is missing but fetch metadata is explicit", async () => {
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
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
    });

    assert.equal(providerCalls >= 1, true);
    assert.equal(result.data.status, "no_comps_found");
    assert.equal(result.data.modelType, "specialty_unavailable");
    assert.equal(result.data.sourceLabel, "No live market comps found");
  });

  test("Ferrari explicit refresh is blocked when external MarketCheck calls are disabled", async () => {
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
    setRepositories(testRepositories.repositories);
    env.MARKETCHECK_DISABLE_EXTERNAL_CALLS = true;

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
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.data.status, "specialty_unavailable");
    assert.equal(result.data.modelType, "specialty_unavailable");
    assert.equal(result.data.sourceLabel, "Live market data could not be loaded");
  });

  test("Ferrari 812 Superfast explicit refresh attempts one live MarketCheck valuation with resolved request params", async () => {
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "519f29ed-979c-44ee-b443-83b2ce480333",
          year: 2021,
          make: "Ferrari",
          model: "812 Superfast",
          trim: "Base",
          bodyStyle: "Coupe",
          vehicleType: "car",
          msrp: 349000,
          engine: "6.5L V12",
          horsepower: 789,
          torque: "530 lb-ft",
          transmission: "7-speed dual-clutch automatic",
          drivetrain: "RWD",
          mpgOrRange: "12 city / 16 highway",
          colors: ["Rosso Corsa"],
        },
      ],
      valuations: [],
      listings: [],
    });
    setRepositories(testRepositories.repositories);

    let providerCalls = 0;
    const providerRequests: Array<{
      vehicleId: string;
      year: number;
      make: string;
      model: string;
      trim: string | null;
      zip: string;
      mileage: number;
      condition: string;
      allowLive: boolean | undefined;
      reason: string | undefined;
      sourceScreen: string | undefined;
      action: string | null | undefined;
      forceLive: boolean | null | undefined;
    }> = [];

    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation(input) {
          providerCalls += 1;
          providerRequests.push({
            vehicleId: input.vehicleId,
            year: input.vehicle.year,
            make: input.vehicle.make,
            model: input.vehicle.model,
            trim: input.vehicle.trim ?? null,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            allowLive: input.requestMeta?.allowLive,
            reason: input.requestMeta?.reason,
            sourceScreen: input.requestMeta?.sourceScreen,
            action: input.requestMeta?.action,
            forceLive: input.requestMeta?.forceLive,
          });
          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "519f29ed-979c-44ee-b443-83b2ce480333",
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      forceLive: true,
    });

    assert.equal(providerCalls >= 1, true);
    assert.equal(result.data.status, "no_comps_found");
    assert.equal(
      providerRequests.some((request) =>
        request.vehicleId === "519f29ed-979c-44ee-b443-83b2ce480333" &&
        request.year === 2021 &&
        request.make === "Ferrari" &&
        request.model === "812 Superfast" &&
        request.trim === "Base" &&
        request.zip === "60502" &&
        request.mileage === 18400 &&
        request.condition === "good" &&
        request.allowLive === true &&
        request.reason === "user_requested_value_refresh" &&
        request.sourceScreen === "valueScreen" &&
        request.action === "valueRefresh" &&
        request.forceLive === false,
      ),
      true,
    );
    assert.equal(result.data.modelType, "specialty_unavailable");
    assert.equal(result.data.sourceLabel, "No live market comps found");
  });

  test("Ferrari explicit refresh provider failure returns provider_error instead of fake zero values", async () => {
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2021-ferrari-812-superfast",
          year: 2021,
          make: "Ferrari",
          model: "812 Superfast",
          trim: "Base",
          bodyStyle: "Coupe",
          vehicleType: "car",
          msrp: 349000,
          engine: "6.5L V12",
          horsepower: 789,
          torque: "530 lb-ft",
          transmission: "7-speed dual-clutch automatic",
          drivetrain: "RWD",
          mpgOrRange: "12 city / 16 highway",
          colors: ["Rosso Corsa"],
        },
      ],
      valuations: [],
      listings: [],
    });
    setRepositories(testRepositories.repositories);

    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          throw new Error("provider_timeout");
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2021-ferrari-812-superfast",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
    });

    assert.equal(result.data.status, "provider_error");
    assert.equal(result.data.sourceLabel, "Live market data could not be loaded");
    assert.equal(result.data.privateParty, null);
  });

  test("normal value refresh does not fan out into live family-model fallback calls", async () => {
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2021-ferrari-812-superfast",
          year: 2021,
          make: "Ferrari",
          model: "812 Superfast",
          trim: "Base",
          bodyStyle: "Coupe",
          vehicleType: "car",
          msrp: 349000,
          engine: "6.5L V12",
          horsepower: 789,
          torque: "530 lb-ft",
          transmission: "7-speed dual-clutch automatic",
          drivetrain: "RWD",
          mpgOrRange: "12 city / 16 highway",
          colors: ["Rosso Corsa"],
        },
      ],
      valuations: [],
      listings: [],
    });
    setRepositories(testRepositories.repositories);

    const attemptedModels: Array<{ model: string; trim: string | null; year: number }> = [];
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation(input) {
          attemptedModels.push({
            model: input.vehicle?.model ?? "",
            trim: input.vehicle?.trim ?? null,
            year: input.vehicle?.year ?? 0,
          });
          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2021-ferrari-812-superfast",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
    });

    assert.equal(result.data.status, "no_comps_found");
    assert.deepEqual(attemptedModels, [{ model: "812 Superfast", trim: "Base", year: 2021 }]);
  });

  test("explicit value refresh bypasses cached no-comps state and retries provider", async () => {
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2021-ferrari-812-superfast",
          year: 2021,
          make: "Ferrari",
          model: "812 Superfast",
          trim: "Base",
          bodyStyle: "Coupe",
          vehicleType: "car",
          msrp: 349000,
          engine: "6.5L V12",
          horsepower: 789,
          torque: "530 lb-ft",
          transmission: "7-speed dual-clutch automatic",
          drivetrain: "RWD",
          mpgOrRange: "12 city / 16 highway",
          colors: ["Rosso Corsa"],
        },
      ],
    });
    testRepositories.state.valuesCache.push(
      createValuesCacheRow({
        descriptor: {
          year: 2021,
          make: "Ferrari",
          model: "812 Superfast",
          trim: "Base",
          vehicleType: "car",
          normalizedMake: "ferrari",
          normalizedModel: "812 superfast",
          normalizedTrim: "base",
        },
        cacheKey: "values:condition-set:2021:ferrari:812-superfast:base:60563:18400",
        provider: "marketcheck",
        zip: "60563",
        mileage: 18400,
        payload: {
          id: "cached-no-comps",
          vehicleId: "2021-ferrari-812-superfast",
          zip: "60563",
          mileage: 18400,
          condition: "good",
          status: "no_comps_found",
          tradeIn: null,
          privateParty: null,
          dealerRetail: null,
          currency: "USD",
          generatedAt: "2026-05-14T00:00:00.000Z",
          sourceLabel: "No live market comps found",
          confidenceLabel: "No live market comps found for this ZIP, mileage, and condition.",
          reason: "no_comps_found",
          modelType: "specialty_unavailable",
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
    await service.getValue({
      vehicleId: "2021-ferrari-812-superfast",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
    });

    assert.equal(providerCalls > 0, true);
  });

  test("value lookup supporting listings populate the For Sale cache", async () => {
    setRepositories(
      createTestRepositories({
        vehicles: [
          {
            id: "2021-ferrari-812-superfast",
            year: 2021,
            make: "Ferrari",
            model: "812 Superfast",
            trim: "Base",
            bodyStyle: "Coupe",
            vehicleType: "car",
            msrp: 349000,
            engine: "6.5L V12",
            horsepower: 789,
            torque: "530 lb-ft",
            transmission: "7-speed dual-clutch automatic",
            drivetrain: "RWD",
            mpgOrRange: "12 city / 16 highway",
            colors: ["Rosso Corsa"],
          },
        ],
      }).repositories,
    );
    let listingsProviderCalls = 0;
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation(input) {
          return {
            id: "ferrari-812-live",
            vehicleId: input.vehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: "good",
            status: "loaded_listing_range",
            tradeIn: 312000,
            privateParty: 339995,
            dealerRetail: 356000,
            low: 325000,
            median: 339995,
            high: 355000,
            currency: "USD",
            generatedAt: "2026-05-14T00:00:00.000Z",
            sourceLabel: "Based on live MarketCheck listings",
            confidenceLabel: "Limited comps",
            modelType: "listing_derived",
            listingCount: 1,
            supportingListings: [
              {
                id: "listing-812",
                vehicleId: input.vehicleId,
                year: 2021,
                make: "Ferrari",
                model: "812",
                trim: "Base",
                title: "2021 Ferrari 812",
                price: 339995,
                mileage: 7800,
                dealer: "Exotic Motors",
                distanceMiles: 42,
                location: "Chicago, IL",
                imageUrl: "https://dealer.example.test/ferrari-812.jpg",
                listingUrl: "https://dealer.example.test/ferrari-812",
                listedAt: "2026-05-14T00:00:00.000Z",
              },
            ],
          };
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
      vehicleId: "2021-ferrari-812-superfast",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      forceLive: true,
    });

    const listings = await service.getListings({
      vehicleId: "2021-ferrari-812-superfast",
      zip: "60563",
      radiusMiles: 100,
      allowLive: false,
      fetchReason: "initial_load",
    });

    assert.equal(listingsProviderCalls, 0);
    assert.equal(listings.data.length, 1);
  });

  test("listings lookup can populate the value cache when mileage is supplied", async () => {
    setRepositories(
      createTestRepositories({
        vehicles: [
          {
            id: "2021-ferrari-812-superfast",
            year: 2021,
            make: "Ferrari",
            model: "812 Superfast",
            trim: "Base",
            bodyStyle: "Coupe",
            vehicleType: "car",
            msrp: 349000,
            engine: "6.5L V12",
            horsepower: 789,
            torque: "530 lb-ft",
            transmission: "7-speed dual-clutch automatic",
            drivetrain: "RWD",
            mpgOrRange: "12 city / 16 highway",
            colors: ["Rosso Corsa"],
          },
        ],
      }).repositories,
    );
    let valueProviderCalls = 0;
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          valueProviderCalls += 1;
          return null;
        },
      },
      listingsProvider: {
        async getListings(input) {
          return [
            {
              id: "listing-812",
              vehicleId: input.vehicleId,
              year: 2021,
              make: "Ferrari",
              model: "812",
              trim: "Base",
              title: "2021 Ferrari 812",
              price: 339995,
              mileage: 7800,
              dealer: "Exotic Motors",
              distanceMiles: 42,
              location: "Chicago, IL",
              imageUrl: "https://dealer.example.test/ferrari-812.jpg",
              listingUrl: "https://dealer.example.test/ferrari-812",
              listedAt: "2026-05-14T00:00:00.000Z",
            },
          ];
        },
      },
    });

    const service = new VehicleService();
    await service.getListings({
      vehicleId: "2021-ferrari-812-superfast",
      zip: "60563",
      radiusMiles: 100,
      mileage: 18400,
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
    });

    const value = await service.getValue({
      vehicleId: "2021-ferrari-812-superfast",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "initial_load",
    });

    assert.equal(valueProviderCalls, 0);
    assert.equal(value.data.status, "loaded_condition_set");
  });

  test("Portofino cached listing at 100 miles produces a listing-derived value instead of unavailable", async () => {
    setRepositories(
      createTestRepositories({
        vehicles: [
          {
            id: "2020-ferrari-portofino",
            year: 2020,
            make: "Ferrari",
            model: "Portofino",
            trim: "Base",
            bodyStyle: "Coupe",
            vehicleType: "car",
            msrp: 215000,
            engine: "3.9L twin-turbo V8",
            horsepower: 591,
            torque: "561 lb-ft",
            transmission: "7-speed dual-clutch automatic",
            drivetrain: "RWD",
            mpgOrRange: "16 city / 22 highway",
            colors: ["Blu Tour De France"],
          },
        ],
        listings: [
          {
            id: "listing-portofino",
            vehicleId: "2020-ferrari-portofino",
            year: 2020,
            make: "Ferrari",
            model: "Portofino",
            trim: "Base",
            title: "2020 Ferrari Portofino",
            price: 209995,
            mileage: 8800,
            dealer: "Motor Cars Of Chicago",
            distanceMiles: 35,
            location: "Chicago, IL",
            imageUrl: "https://dealer.example.test/portofino.jpg",
            listingUrl: "https://dealer.example.test/portofino",
            listedAt: "2026-05-14T00:00:00.000Z",
          },
        ],
      }).repositories,
    );

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2020-ferrari-portofino",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "cached_listings_value_sync",
      sourceScreen: "valueScreen",
    });

    assert.equal(result.data.status, "loaded_condition_set");
    assert.equal(result.data.listingCount, 1);
    assert.equal(result.data.sourceBasis, "listing_median_adjusted");
    assert.equal(result.data.low, 209995);
    assert.equal(result.data.median, 209995);
    assert.equal(result.data.high, 209995);
    assert.notEqual(result.data.status, "specialty_unavailable");
  });

  test("explicit listings refresh cache can populate Portofino value without a second provider call", async () => {
    setRepositories(
      createTestRepositories({
        vehicles: [
          {
            id: "2020-ferrari-portofino",
            year: 2020,
            make: "Ferrari",
            model: "Portofino",
            trim: "Base",
            bodyStyle: "Coupe",
            vehicleType: "car",
            msrp: 215000,
            engine: "3.9L twin-turbo V8",
            horsepower: 591,
            torque: "561 lb-ft",
            transmission: "7-speed dual-clutch automatic",
            drivetrain: "RWD",
            mpgOrRange: "16 city / 22 highway",
            colors: ["Blu Tour De France"],
          },
        ],
      }).repositories,
    );
    let listingsProviderCalls = 0;
    let valueProviderCalls = 0;
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      valueProviderName: "marketcheck",
      listingsProvider: {
        async getListings(input) {
          listingsProviderCalls += 1;
          return [
            {
              id: "listing-portofino",
              vehicleId: input.vehicleId,
              year: 2020,
              make: "Ferrari",
              model: "Portofino",
              trim: "Base",
              title: "2020 Ferrari Portofino",
              price: 209995,
              mileage: 8800,
              dealer: "Motor Cars Of Chicago",
              distanceMiles: 35,
              location: "Chicago, IL",
              imageUrl: "https://dealer.example.test/portofino.jpg",
              listingUrl: "https://dealer.example.test/portofino",
              listedAt: "2026-05-14T00:00:00.000Z",
            },
          ];
        },
      },
      valueProvider: {
        async getValuation() {
          valueProviderCalls += 1;
          return null;
        },
      },
    });

    const service = new VehicleService();
    const listings = await service.getListings({
      vehicleId: "2020-ferrari-portofino",
      zip: "60563",
      radiusMiles: 100,
      mileage: 18400,
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
    });
    const value = await service.getValue({
      vehicleId: "2020-ferrari-portofino",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: false,
      fetchReason: "cached_listings_value_sync",
      sourceScreen: "valueScreen",
    });

    assert.equal(listingsProviderCalls, 1);
    assert.equal(valueProviderCalls, 0);
    assert.equal(listings.data.length, 1);
    assert.equal(value.data.status, "loaded_condition_set");
    assert.equal(value.data.median, 209995);
  });

  test("Kia Soul cached listings produce at least a limited comp-based value", async () => {
    setRepositories(
      createTestRepositories({
        vehicles: [
          {
            id: "2020-kia-soul-s",
            year: 2020,
            make: "Kia",
            model: "Soul",
            trim: "S",
            bodyStyle: "Hatchback",
            vehicleType: "car",
            msrp: 22300,
            engine: "2.0L I4",
            horsepower: 147,
            torque: "132 lb-ft",
            transmission: "CVT",
            drivetrain: "FWD",
            mpgOrRange: "29 city / 35 highway",
            colors: ["Neptune Blue"],
          },
        ],
        listings: [
          {
            id: "listing-kia-soul-1",
            vehicleId: "2020-kia-soul-s",
            year: 2020,
            make: "Kia",
            model: "Soul",
            trim: "S",
            title: "2020 Kia Soul S",
            price: 16995,
            mileage: 44000,
            dealer: "Westmont Kia",
            distanceMiles: 21,
            location: "Westmont, IL",
            imageUrl: "https://dealer.example.test/soul-1.jpg",
            listingUrl: "https://dealer.example.test/soul-1",
            listedAt: "2026-05-15T00:00:00.000Z",
          },
          {
            id: "listing-kia-soul-2",
            vehicleId: "2020-kia-soul-s",
            year: 2020,
            make: "Kia",
            model: "Soul",
            trim: "EX",
            title: "2020 Kia Soul EX",
            price: 17995,
            mileage: 39000,
            dealer: "Downers Grove Kia",
            distanceMiles: 27,
            location: "Downers Grove, IL",
            imageUrl: "https://dealer.example.test/soul-2.jpg",
            listingUrl: "https://dealer.example.test/soul-2",
            listedAt: "2026-05-15T00:00:00.000Z",
          },
        ],
      }).repositories,
    );

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2020-kia-soul-s",
      zip: "60563",
      mileage: 41000,
      condition: "good",
      allowLive: false,
      fetchReason: "cached_listings_value_sync",
      sourceScreen: "valueScreen",
    });

    assert.equal(result.data.status, "loaded_condition_set");
    assert.equal(result.data.valuationSource, "listing_comps");
    assert.equal(result.data.compCount, 2);
    assert.equal(result.data.confidence, "limited");
    assert.match(result.data.confidenceLabel ?? "", /Limited market confidence/i);
    assert.notEqual(result.data.sourceLabel, "Market value unavailable");
  });

  test("Ferrari 458 Italia listings broaden to Ferrari 458 family and adjacent year before giving up", async () => {
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2013-ferrari-458-italia",
          year: 2013,
          make: "Ferrari",
          model: "458 Italia",
          trim: "Base",
          bodyStyle: "Coupe",
          vehicleType: "car",
          msrp: 239340,
          engine: "4.5L V8",
          horsepower: 562,
          torque: "398 lb-ft",
          transmission: "7-speed dual-clutch automatic",
          drivetrain: "RWD",
          mpgOrRange: "13 city / 17 highway",
          colors: ["Rosso Corsa"],
        },
      ],
      listings: [],
    });
    setRepositories(testRepositories.repositories);

    const attempts: Array<{ model: string; year: number; trim: string | null; radiusMiles: number | null }> = [];
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings(input) {
          attempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            trim: input.vehicle?.trim ?? null,
            radiusMiles: input.radiusMiles ?? null,
          });

          if (input.vehicle?.model === "458" && input.vehicle?.year === 2013) {
            return [
              {
                id: "listing-458-family-2013",
                vehicleId: input.vehicleId,
                year: 2013,
                make: "Ferrari",
                model: "458",
                trim: "Spider",
                title: "2013 Ferrari 458 Spider",
                price: 249995,
                mileage: 17600,
                dealer: "Exotic Motors",
                distanceMiles: 140,
                location: "Cleveland, OH",
                imageUrl: "https://dealer.example.test/458.jpg",
                listingUrl: "https://dealer.example.test/458",
                listedAt: "2026-05-15T00:00:00.000Z",
              },
            ];
          }

          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getListings({
      vehicleId: "2013-ferrari-458-italia",
      zip: "60563",
      radiusMiles: 50,
      mileage: 18400,
      allowLive: true,
      forceLive: true,
      fetchReason: "debug_force_listings_refresh",
      sourceScreen: "debugListings",
      action: "forceListingsRefresh",
    });

    assert.equal(result.data.length, 1);
    assert.equal(attempts.length, 2);
    assert.equal(attempts.some((attempt) => attempt.model === "458 Italia" && attempt.year === 2013), true);
    assert.equal(attempts.some((attempt) => attempt.model === "458" && attempt.year === 2013 && attempt.trim === ""), true);
    assert.equal(attempts.some((attempt) => attempt.model === "458" && attempt.year === 2014), false);
  });

  test("Cadillac CT4 listing fallback attempts exact, mixed trim, adjacent year, and wider radius before empty", async () => {
    const attempts: Array<{ model: string; year: number; trim: string | null; radiusMiles: number | null }> = [];
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings(input) {
          attempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            trim: input.vehicle?.trim ?? null,
            radiusMiles: input.radiusMiles ?? null,
          });

          if (input.vehicle?.model === "CT4" && input.vehicle?.year === 2021 && input.vehicle?.trim === "" && input.radiusMiles === 50) {
            return [
              {
                id: "listing-ct4-same-year-any-trim",
                vehicleId: input.vehicleId,
                year: 2021,
                make: "Cadillac",
                model: "CT4",
                trim: "Luxury",
                title: "2021 Cadillac CT4 Luxury",
                price: 32995,
                mileage: 21400,
                dealer: "Naperville Cadillac",
                distanceMiles: 88,
                location: "Naperville, IL",
                imageUrl: "https://dealer.example.test/ct4-2022.jpg",
                listingUrl: "https://dealer.example.test/ct4-2022",
                listedAt: "2026-05-15T00:00:00.000Z",
              },
            ];
          }

          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getListings({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60563",
      radiusMiles: 50,
      mileage: 18400,
      allowLive: true,
      forceLive: true,
      fetchReason: "debug_force_listings_refresh",
      sourceScreen: "debugListings",
      action: "forceListingsRefresh",
    });

    assert.equal(result.data.length, 1);
    assert.equal(attempts.length, 2);
    assert.equal(attempts.some((attempt) => attempt.model === "CT4" && attempt.year === 2021 && attempt.trim === "Premium Luxury"), true);
    assert.equal(attempts.some((attempt) => attempt.model === "CT4" && attempt.year === 2021 && attempt.trim === ""), true);
    assert.equal(attempts.some((attempt) => attempt.model === "CT4" && attempt.year === 2020 && attempt.trim === ""), false);
    assert.equal(attempts.some((attempt) => attempt.model === "CT4" && attempt.year === 2022 && attempt.trim === ""), false);
    assert.equal(attempts.some((attempt) => attempt.model === "CT4" && attempt.year === 2021 && attempt.trim === "" && attempt.radiusMiles === 250), false);
  });

  test("Cadillac CT4 provider-normalized listing without URL remains usable", async () => {
    setRepositories(createTestRepositories({ listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings(input) {
          if (input.vehicle?.model === "CT4" && input.vehicle?.year === 2021 && input.vehicle?.trim === "") {
            return [
              {
                id: "listing-ct4-provider-no-url",
                vehicleId: input.vehicleId,
                year: 2021,
                make: "Cadillac",
                model: "CT4",
                trim: "Luxury",
                title: "2021 Cadillac CT4 Luxury",
                price: 32995,
                mileage: 21400,
                dealer: "Provider Normalized Cadillac",
                distanceMiles: 42,
                location: "Naperville, IL",
                imageUrl: "https://dealer.example.test/ct4.jpg",
                listingUrl: null,
                listedAt: "2026-05-15T00:00:00.000Z",
              },
            ];
          }

          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getListings({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60563",
      radiusMiles: 50,
      mileage: 18400,
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
    });

    assert.equal(result.data.length, 1);
    assert.equal(result.data[0]?.id, "listing-ct4-provider-no-url");
  });

  test("listings provider skip keeps provider calls at zero when live fetch is not allowed", async () => {
    let providerCalls = 0;
    setRepositories(createTestRepositories({ listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
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
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60563",
      radiusMiles: 50,
      mileage: 18400,
      allowLive: false,
      fetchReason: "initial_load",
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.meta?.fallbackReason, "live-fetch-deferred");
    assert.equal(result.meta?.liveFetchDeferred, true);
  });

  test("Cadillac CT4 value refresh uses one exact live valuation attempt", async () => {
    const attempts: Array<{ model: string; year: number; trim: string | null }> = [];
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation(input) {
          attempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            trim: input.vehicle?.trim ?? null,
          });

          if (input.vehicle?.model === "CT4" && input.vehicle?.year === 2021 && input.vehicle?.trim === "Premium Luxury") {
            return {
              id: "ct4-broadened-live-value",
              vehicleId: input.vehicleId,
              zip: input.zip,
              mileage: input.mileage,
              condition: "good",
              status: "loaded_listing_range",
              tradeIn: 28500,
              tradeInLow: 27140,
              tradeInHigh: 29900,
              privateParty: 31000,
              privatePartyLow: 29500,
              privatePartyHigh: 32500,
              dealerRetail: 33480,
              dealerRetailLow: 31860,
              dealerRetailHigh: 35100,
              low: 29500,
              median: 31000,
              high: 32500,
              currency: "USD",
              generatedAt: "2026-05-15T00:00:00.000Z",
              sourceLabel: "Estimated from nearby comparable listings",
              confidenceLabel: "Based on 3 nearby comparable listings. Limited market confidence.",
              valuationSource: "listing_comps",
              compCount: 3,
              confidence: "limited",
              rangeLow: 29500,
              rangeHigh: 32500,
              midpoint: 31000,
              modelType: "listing_derived",
              listingCount: 3,
              sourceBasis: "listing_median_adjusted",
            };
          }

          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(attempts.some((attempt) => attempt.model === "CT4" && attempt.year === 2021 && attempt.trim === "Premium Luxury"), true);
    assert.equal(attempts.some((attempt) => attempt.model === "CT4" && attempt.year === 2021 && attempt.trim === ""), false);
    assert.equal(attempts.length, 1);
    assert.equal(result.data.status, "loaded_condition_set");
    assert.equal(result.data.valuationSource, "listing_comps");
    assert.equal(result.data.sourceBasis, "listing_median_adjusted");
    assert.equal(result.data.confidence, "limited");
    assert.notEqual(result.data.sourceLabel, "No live market comps found");
    assert.notEqual(result.data.valuationSource, "unavailable");
  });

  test("Load Value first fetches listings comps without visiting Listings first", async () => {
    let valueProviderCalls = 0;
    let listingsProviderCalls = 0;
    setRepositories(createTestRepositories({ valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          valueProviderCalls += 1;
          return null;
        },
      },
      listingsProvider: {
        async getListings(input) {
          listingsProviderCalls += 1;
          if (input.vehicle?.make === "Cadillac" && input.vehicle?.model === "CT4") {
            return [
              {
                id: "ct4-value-first-comp-1",
                vehicleId: input.vehicleId,
                year: input.vehicle.year,
                make: input.vehicle.make,
                model: input.vehicle.model,
                trim: input.vehicle.trim || "Luxury",
                title: `${input.vehicle.year} Cadillac CT4 Luxury`,
                price: 30995,
                mileage: 22100,
                dealer: "Naperville Cadillac",
                distanceMiles: 24,
                location: "Naperville, IL",
                imageUrl: "https://images.example.test/ct4.jpg",
                listedAt: "2026-05-15T00:00:00.000Z",
              },
            ];
          }
          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60563",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(valueProviderCalls > 0, true);
    assert.equal(listingsProviderCalls > 0, true);
    assert.equal(result.data.status, "loaded_condition_set");
    assert.equal(result.data.valuationSource, "listing_comps");
    assert.equal(result.data.compCount, 1);
    assert.equal(result.data.confidence, "limited");
    assert.match(result.data.confidenceLabel ?? "", /Very limited market confidence/i);
    assert.notEqual(result.data.reason, "no_comps_found");
  });

  test("Load Value first can still return low-confidence fallback when local listings are unavailable", async () => {
    let valueProviderCalls = 0;
    let listingsProviderCalls = 0;
    setRepositories(createTestRepositories({ valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
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
    const result = await service.getValue({
      vehicleId: "2020-honda-civic-ex",
      zip: "60563",
      mileage: 42000,
      condition: "good",
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(valueProviderCalls > 0, true);
    assert.equal(listingsProviderCalls > 0, true);
    assert.equal(result.data.status, "loaded_condition_set");
    assert.equal(result.data.valuationSource, "modeled_fallback");
    assert.equal(result.data.confidence, "limited");
    assert.equal(result.data.compCount, 0);
    assert.match(result.data.sourceLabel ?? "", /estimate/i);
    assert.match(result.data.confidenceLabel ?? "", /Low market confidence/i);
    assert.doesNotMatch(result.data.sourceLabel ?? "", /nearby comparable listings|live market|dealer listings/i);
    assert.doesNotMatch(result.data.confidenceLabel ?? "", /Based on \d+ nearby comparable listings|dealer listings were found/i);
    assert.notEqual(result.data.reason, "no_comps_found");
    assert.notEqual(result.data.sourceLabel, "No live market comps found");
  });

  test("Ford Ranger can use modeled_fallback when live comps are unavailable and body style is missing", async () => {
    let valueProviderCalls = 0;
    let listingsProviderCalls = 0;
    const rangerVehicle = {
      id: "2021-ford-ranger-xl",
      year: 2021,
      make: "Ford",
      model: "Ranger",
      trim: "XL",
      bodyStyle: "",
      vehicleType: "car" as const,
      msrp: 0,
      engine: "2.3L turbo I4",
      horsepower: 270,
      torque: "310 lb-ft",
      transmission: "10-speed automatic",
      drivetrain: "4WD",
      mpgOrRange: "Unknown",
      colors: [],
    };
    setRepositories(createTestRepositories({ vehicles: [rangerVehicle], valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
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
    const result = await service.getValue({
      vehicleId: rangerVehicle.id,
      zip: "60563",
      mileage: 42000,
      condition: "good",
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(valueProviderCalls > 0, true);
    assert.equal(listingsProviderCalls > 0, true);
    assert.equal(result.data.status, "loaded_condition_set");
    assert.equal(result.data.valuationSource, "modeled_fallback");
    assert.equal(result.data.confidence, "limited");
    assert.equal(result.data.compCount, 0);
    assert.match(result.data.sourceLabel ?? "", /estimate/i);
    assert.match(result.data.confidenceLabel ?? "", /Low market confidence/i);
    assert.notEqual(result.data.sourceLabel, "No live market comps found");
  });

  test("Ford Ranger descriptor lookup can use modeled_fallback even when the client id is not stored", async () => {
    let valueProviderCalls = 0;
    let listingsProviderCalls = 0;
    const testRepositories = createTestRepositories({ vehicles: [], valuations: [], listings: [] });
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
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
    const result = await service.getValue({
      vehicleId: "1998-ford-ranger-xlt",
      descriptor: {
        year: 1998,
        make: "Ford",
        model: "Ranger",
        trim: "XLT",
        vehicleType: "truck",
        bodyStyle: "car",
        normalizedModel: "ranger",
      },
      zip: "60563",
      mileage: 42000,
      condition: "good",
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(valueProviderCalls > 0, true);
    assert.equal(listingsProviderCalls > 0, true);
    assert.equal(result.data.status, "loaded_condition_set");
    assert.equal(result.data.valuationSource, "modeled_fallback");
    assert.equal(result.data.confidence, "limited");
    assert.equal(result.data.reason, "modeled_baseline_after_no_local_comps");
    assert.notEqual(result.data.sourceLabel, "No live market comps found");
    assert.equal(testRepositories.state.valuesCache.length > 0, true);
    assert.equal(
      testRepositories.state.valuesCache.every((entry) => entry.condition === "good"),
      true,
      "modeled fallback cache writes must include condition so Supabase does not reject them",
    );
  });

  test("Load Value first stays unavailable when no provider comps and no safe modeled baseline exist", async () => {
    let valueProviderCalls = 0;
    let listingsProviderCalls = 0;
    const unknownVehicle = {
      id: "2017-example-nomad-base",
      year: 2017,
      make: "Example",
      model: "Nomad",
      trim: "Base",
      bodyStyle: "Sedan",
      vehicleType: "car" as const,
      msrp: 0,
      engine: "Unknown",
      horsepower: null,
      torque: "Unknown",
      transmission: "Unknown",
      drivetrain: "Unknown",
      mpgOrRange: "Unknown",
      colors: [],
    };
    setRepositories(createTestRepositories({ vehicles: [unknownVehicle], valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
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
    const result = await service.getValue({
      vehicleId: unknownVehicle.id,
      zip: "60563",
      mileage: 42000,
      condition: "good",
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(valueProviderCalls > 0, true);
    assert.equal(listingsProviderCalls > 0, true);
    assert.equal(result.data.status, "no_comps_found");
    assert.equal(result.data.valuationSource, "unavailable");
    assert.equal(result.data.confidence, "unavailable");
    assert.equal(result.data.sourceLabel, "No safe baseline data available");
    assert.equal(result.data.reason, "no_safe_baseline_data");
    assert.equal(result.data.unavailableReason, "no_safe_baseline_data");
    assert.notEqual(result.data.valuationSource, "modeled_fallback");
  });

  test("Toyota 4Runner listing fallback attempts keep atomic model name", async () => {
    const attempts: Array<{ model: string; year: number; radiusMiles: number | null; trim: string | null }> = [];
    setRepositories(createTestRepositories({ vehicles: [], valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings(input) {
          attempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            radiusMiles: input.radiusMiles ?? input.requestMeta?.radiusMiles ?? null,
            trim: input.vehicle?.trim ?? null,
          });
          return [];
        },
      },
    });

    const service = new VehicleService();
    await service.getListings({
      vehicleId: "2011-toyota-4runner-sr5",
      descriptor: {
        year: 2011,
        make: "Toyota",
        model: "4Runner",
        trim: "SR5",
        vehicleType: "car",
        bodyStyle: "SUV",
        normalizedModel: "4runner",
      },
      zip: "60563",
      radiusMiles: 100,
      mileage: 98000,
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
    });

    assert.equal(attempts.length, 1);
    assert.equal(attempts.every((attempt) => attempt.model === "4Runner"), true);
    assert.equal(attempts.some((attempt) => attempt.model === "4"), false);
    assert.equal(attempts.some((attempt) => attempt.year === 2011 && attempt.radiusMiles === 100), true);
    assert.equal(attempts.some((attempt) => attempt.radiusMiles === 250), false);
  });

  test("force-live listings refresh drops generic Base trim and uses bounded fallback attempts", async () => {
    const attempts: Array<{ model: string; year: number; radiusMiles: number | null; trim: string | null }> = [];
    setRepositories(createTestRepositories({ vehicles: [], valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings(input) {
          attempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            radiusMiles: input.radiusMiles ?? input.requestMeta?.radiusMiles ?? null,
            trim: input.vehicle?.trim ?? null,
          });
          return [];
        },
      },
    });

    const service = new VehicleService();
    await service.getListings({
      vehicleId: "2011-toyota-4runner-base",
      descriptor: {
        year: 2011,
        make: "Toyota",
        model: "4Runner",
        trim: "Base",
        vehicleType: "car",
        bodyStyle: "SUV",
        normalizedModel: "4runner",
      },
      zip: "60563",
      radiusMiles: 100,
      mileage: 98000,
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
    });

    assert.deepEqual(attempts, [
      {
        model: "4Runner",
        year: 2011,
        radiusMiles: 100,
        trim: "",
      },
    ]);
  });

  test("developer force-live listings refresh can broaden but remains capped", async () => {
    const attempts: Array<{
      model: string;
      year: number;
      radiusMiles: number | null;
      trim: string | null;
      attemptNumber: number | null;
      maxAttempts: number | null;
      fallbackStrategy: string | null;
      fallbackReason: string | null;
    }> = [];
    setRepositories(createTestRepositories({ vehicles: [], valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings(input) {
          attempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            radiusMiles: input.radiusMiles ?? input.requestMeta?.radiusMiles ?? null,
            trim: input.vehicle?.trim ?? null,
            attemptNumber: input.requestMeta?.attemptNumber ?? null,
            maxAttempts: input.requestMeta?.maxAttempts ?? null,
            fallbackStrategy: input.requestMeta?.fallbackStrategy ?? null,
            fallbackReason: input.requestMeta?.fallbackReason ?? null,
          });
          return [];
        },
      },
    });

    const service = new VehicleService();
    await service.getListings({
      vehicleId: "2011-toyota-4runner-base",
      descriptor: {
        year: 2011,
        make: "Toyota",
        model: "4Runner",
        trim: "Base",
        vehicleType: "car",
        bodyStyle: "SUV",
        normalizedModel: "4runner",
      },
      zip: "60563",
      radiusMiles: 100,
      mileage: 98000,
      allowLive: true,
      forceLive: true,
      fetchReason: "debug_force_listings_refresh",
      sourceScreen: "debugListingsScreen",
      action: "debugForceListingsRefresh",
    });

    assert.equal(attempts.length, 2);
    assert.deepEqual(
      attempts.map((attempt) => attempt.attemptNumber),
      [1, 2],
    );
    assert.equal(attempts.every((attempt) => attempt.maxAttempts === 2), true);
    assert.equal(attempts.every((attempt) => attempt.fallbackReason === "unknown"), true);
    assert.equal(attempts.every((attempt) => typeof attempt.fallbackStrategy === "string"), true);
  });

  test("force-live listings refresh bypasses cached zero-result listing response", async () => {
    const descriptor = {
      year: 2011,
      make: "Toyota",
      model: "4Runner",
      trim: "",
      vehicleType: "car" as const,
      normalizedMake: "toyota",
      normalizedModel: "4runner",
      normalizedTrim: "",
    };
    const testRepositories = createTestRepositories({ vehicles: [], valuations: [], listings: [] });
    testRepositories.state.listingsCache.push(
      createListingsCacheRow({
        descriptor,
        cacheKey: getListingsCacheKey(descriptor, {
          zip: "60563",
          radiusMiles: 100,
        }),
        provider: "marketcheck",
        zip: "60563",
        radiusMiles: 100,
        payload: [],
      }),
    );
    setRepositories(testRepositories.repositories);

    let providerCalls = 0;
    setProviders({
      ...createTestProviders(),
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
      vehicleId: "2011-toyota-4runner-base",
      descriptor: {
        year: 2011,
        make: "Toyota",
        model: "4Runner",
        trim: "Base",
        vehicleType: "car",
        bodyStyle: "SUV",
        normalizedModel: "4runner",
      },
      zip: "60563",
      radiusMiles: 100,
      mileage: 98000,
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.data.length, 0);
  });

  test("Toyota 4Runner value prefers real listing comps over modeled_fallback", async () => {
    const attempts: Array<{ model: string; year: number; radiusMiles: number | null }> = [];
    setRepositories(createTestRepositories({ vehicles: [], valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          return null;
        },
      },
      listingsProvider: {
        async getListings(input) {
          attempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            radiusMiles: input.radiusMiles ?? input.requestMeta?.radiusMiles ?? null,
          });
          if (input.vehicle?.make === "Toyota" && input.vehicle?.model === "4Runner" && input.vehicle?.year === 2011) {
            return [
              {
                id: "4runner-comp-1",
                vehicleId: input.vehicleId,
                year: 2011,
                make: "Toyota",
                model: "4Runner",
                trim: "SR5",
                title: "2011 Toyota 4Runner SR5",
                price: 21995,
                mileage: 105000,
                dealer: "Naperville Toyota",
                distanceMiles: 18,
                location: "Naperville, IL",
                imageUrl: "https://dealer.example.test/4runner-1.jpg",
                listingUrl: "https://dealer.example.test/4runner-1",
                listedAt: "2026-05-14T00:00:00.000Z",
              },
              {
                id: "4runner-comp-2",
                vehicleId: input.vehicleId,
                year: 2011,
                make: "Toyota",
                model: "4Runner",
                trim: "Limited",
                title: "2011 Toyota 4Runner Limited",
                price: 23995,
                mileage: 92000,
                dealer: "Aurora Toyota",
                distanceMiles: 29,
                location: "Aurora, IL",
                imageUrl: "https://dealer.example.test/4runner-2.jpg",
                listingUrl: "https://dealer.example.test/4runner-2",
                listedAt: "2026-05-13T00:00:00.000Z",
              },
            ];
          }
          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "2011-toyota-4runner-sr5",
      descriptor: {
        year: 2011,
        make: "Toyota",
        model: "4Runner",
        trim: "SR5",
        vehicleType: "car",
        bodyStyle: "SUV",
        normalizedModel: "4runner",
      },
      zip: "60563",
      mileage: 98000,
      condition: "good",
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(attempts.length > 0, true);
    assert.equal(attempts.every((attempt) => attempt.model === "4Runner"), true);
    assert.equal(result.data.status, "loaded_condition_set");
    assert.equal(result.data.valuationSource, "listing_comps");
    assert.notEqual(result.data.valuationSource, "modeled_fallback");
    assert.notEqual(result.data.sourceLabel, "No live market comps found");
  });

  test("Toyota 4Runner skips uncalibrated modeled_fallback when comps are unavailable", async () => {
    let valueProviderCalls = 0;
    let listingsProviderCalls = 0;
    const valueAttempts: Array<{ model: string; year: number; trim: string | null; forceLive: boolean | null | undefined }> = [];
    setRepositories(createTestRepositories({ vehicles: [], valuations: [], listings: [] }).repositories);
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      listingsProviderName: "marketcheck",
      valueProvider: {
        async getValuation(input) {
          valueProviderCalls += 1;
          valueAttempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            trim: input.vehicle?.trim ?? null,
            forceLive: input.requestMeta?.forceLive,
          });
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
    const result = await service.getValue({
      vehicleId: "2011-toyota-4runner-sr5",
      descriptor: {
        year: 2011,
        make: "Toyota",
        model: "4Runner",
        trim: "SR5",
        vehicleType: "car",
        bodyStyle: "SUV",
        normalizedModel: "4runner",
      },
      zip: "60563",
      mileage: 98000,
      condition: "good",
      allowLive: true,
      forceLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(valueProviderCalls, 1);
    assert.deepEqual(valueAttempts, [{ model: "4Runner", year: 2011, trim: "SR5", forceLive: false }]);
    assert.equal(listingsProviderCalls > 0, true);
    assert.equal(result.data.valuationSource, "unavailable");
    assert.equal(result.data.reason, "no_safe_baseline_data");
    assert.equal(result.data.unavailableReason, "no_safe_baseline_data");
    assert.notEqual(result.data.valuationSource, "modeled_fallback");
    assert.notEqual(result.data.privateParty, 7000);
  });

  test("MarketCheck normal listings refresh respects zero cache responses", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = env.MARKETCHECK_API_KEY;
    const originalBaseUrl = env.MARKETCHECK_BASE_URL;
    env.MARKETCHECK_API_KEY = "test-marketcheck-key";
    env.MARKETCHECK_BASE_URL = "https://marketcheck.example.test";
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ listings: [], stats: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const provider = new MarketCheckVehicleDataProvider();
      const vehicle = {
        id: "2011-toyota-4runner-sr5",
        year: 2011,
        make: "Toyota",
        model: "4Runner",
        trim: "SR5",
        bodyStyle: "SUV",
        vehicleType: "car" as const,
        msrp: 0,
        engine: "4.0L V6",
        horsepower: 270,
        torque: "278 lb-ft",
        transmission: "5-speed automatic",
        drivetrain: "4WD",
        mpgOrRange: "Unknown",
        colors: [],
      };
      const requestMeta = {
        requestId: "zero-cache-bypass-test",
        allowLive: true,
        forceLive: true,
        action: "listingsRefresh",
        reason: "user_requested_listings_refresh",
        sourceScreen: "listingsScreen",
        vehicleId: vehicle.id,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
        zip: "60563",
        radiusMiles: 100,
      };

      await provider.getListings({ vehicleId: vehicle.id, vehicle, zip: "60563", radiusMiles: 100, requestMeta });
      await provider.getListings({ vehicleId: vehicle.id, vehicle, zip: "60563", radiusMiles: 100, requestMeta });

      assert.equal(fetchCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
      env.MARKETCHECK_API_KEY = originalApiKey;
      env.MARKETCHECK_BASE_URL = originalBaseUrl;
    }
  });

  test("developer listings refresh can broaden from trim/body variant to family model and adjacent year", async () => {
    const testRepositories = createTestRepositories({
      vehicles: [
        {
          id: "2018-audi-a4-allroad-premium-plus",
          year: 2018,
          make: "Audi",
          model: "A4 allroad",
          trim: "Premium Plus",
          bodyStyle: "Wagon",
          vehicleType: "car",
          msrp: 44900,
          engine: "2.0L turbo I4",
          horsepower: 252,
          torque: "273 lb-ft",
          transmission: "7-speed dual-clutch automatic",
          drivetrain: "AWD",
          mpgOrRange: "23 city / 28 highway",
          colors: ["Glacier White"],
        },
      ],
      listings: [],
    });
    setRepositories(testRepositories.repositories);

    const attempts: Array<{ model: string; year: number; trim: string | null }> = [];
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings(input) {
          attempts.push({
            model: input.vehicle?.model ?? "",
            year: input.vehicle?.year ?? 0,
            trim: input.vehicle?.trim ?? null,
          });

          if (input.vehicle?.model === "A4 allroad" && input.vehicle?.year === 2018 && input.vehicle?.trim === "") {
            return [
              {
                id: "listing-a4-allroad-any-trim",
                vehicleId: input.vehicleId,
                year: 2018,
                make: "Audi",
                model: "A4 allroad",
                trim: "Premium",
                title: "2018 Audi A4 allroad Premium",
                price: 24995,
                mileage: 38200,
                dealer: "North Shore Audi",
                distanceMiles: 41,
                location: "Milwaukee, WI",
                imageUrl: "https://dealer.example.test/a4.jpg",
                listingUrl: "https://dealer.example.test/a4",
                listedAt: "2026-05-15T00:00:00.000Z",
              },
            ];
          }

          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getListings({
      vehicleId: "2018-audi-a4-allroad-premium-plus",
      zip: "60563",
      radiusMiles: 50,
      mileage: 32000,
      allowLive: true,
      forceLive: true,
      fetchReason: "debug_force_listings_refresh",
      sourceScreen: "debugListings",
      action: "forceListingsRefresh",
    });

    assert.equal(result.data.length, 1);
    assert.equal(attempts.length, 2);
    assert.equal(attempts.some((attempt) => attempt.model === "A4 allroad" && attempt.year === 2018 && attempt.trim === "Premium Plus"), true);
    assert.equal(attempts.some((attempt) => attempt.model === "A4 allroad" && attempt.year === 2018 && attempt.trim === ""), true);
    assert.equal(attempts.some((attempt) => attempt.model === "A4" && attempt.year === 2018), false);
    assert.equal(attempts.some((attempt) => attempt.model === "A4" && attempt.year === 2019), false);
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
          zip: "60502",
          mileage: 18400,
        }),
        provider: "marketcheck",
        zip: "60502",
        mileage: 18400,
        condition: "good",
        payload: {
          id: "cached-civic-family",
          vehicleId: "2020-honda-civic-ex",
          zip: "60502",
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
      zip: "60502",
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
      zip: "60502",
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

  test("Toyota 4Runner specs complete known 4.0L V6 horsepower", async () => {
    const toyota4Runner = {
      id: "2011-toyota-4runner-sr5",
      year: 2011,
      make: "Toyota",
      model: "4Runner",
      trim: "SR5",
      bodyStyle: "SUV",
      vehicleType: "car" as const,
      msrp: 0,
      engine: "4.0L V6",
      horsepower: null,
      torque: "",
      transmission: "",
      drivetrain: "4WD",
      mpgOrRange: "",
      colors: [],
    };
    setRepositories(createTestRepositories({ vehicles: [toyota4Runner], valuations: [], listings: [] }).repositories);

    const service = new VehicleService();
    const result = await service.getSpecs({
      vehicleId: toyota4Runner.id,
      allowLive: false,
      fetchReason: "initial_load",
      sourceScreen: "specsScreen",
    });

    assert.equal(result.data?.make, "Toyota");
    assert.equal(result.data?.model, "4Runner");
    assert.equal(result.data?.horsepower, 270);
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
        async getValuation(input) {
          valueProviderCalls += 1;
          return {
            id: "live-ct4",
            vehicleId: input.vehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition,
            status: "loaded_value",
            tradeIn: 27000,
            privateParty: 28900,
            dealerRetail: 30900,
            currency: "USD",
            generatedAt: "2026-05-14T00:00:00.000Z",
            sourceLabel: "MarketCheck live value",
            confidenceLabel: "Provider direct",
            modelType: "provider_range",
            listingCount: 6,
          };
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
    const first = await service.getValue({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60502",
      mileage: 18400,
      condition: "good",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });
    const second = await service.getValue({
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      zip: "60502",
      mileage: 18400,
      condition: "excellent",
      allowLive: true,
      fetchReason: "user_requested_value_refresh",
      sourceScreen: "valueScreen",
      action: "valueRefresh",
    });

    assert.equal(valueProviderCalls, 1);
    assert.equal(listingsProviderCalls, 0);
    assert.equal(first.data.status, "loaded_condition_set");
    assert.equal(first.data.conditionValues?.good.privateParty != null, true);
    assert.equal(second.data.status, "loaded_condition_set");
    assert.equal(second.data.conditionValues?.excellent.privateParty != null, true);
  });

  test("user requested listings refresh keeps provider traffic in listings only and caps live fallback attempts", async () => {
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
      zip: "60502",
      radiusMiles: 50,
      allowLive: true,
      fetchReason: "user_requested_listings_refresh",
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
    });

    assert.equal(listingsProviderCalls, 1);
    assert.equal(valueProviderCalls, 0);
    assert.equal(specsProviderCalls, 0);
    assert.equal(providerTrims[0], "");
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
          zip: "60502",
          radiusMiles: 50,
        }),
        provider: "marketcheck",
        zip: "60502",
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
      zip: "60502",
      radiusMiles: 50,
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.source, "cache");
    assert.equal(result.data.length, 1);
  });
});
