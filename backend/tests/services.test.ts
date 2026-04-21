import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../src/errors/appError.js";
import { buildCanonicalKey, createSpecsCacheRow, getValuesCacheKey } from "../src/lib/providerCache.js";
import { resetProviders, setProviders } from "../src/lib/providerRegistry.js";
import { resetRepositories, setRepositories } from "../src/lib/repositoryRegistry.js";
import { GarageService } from "../src/services/garageService.js";
import { env } from "../src/config/env.js";
import { normalizeVisionResult, ScanService } from "../src/services/scanService.js";
import { UsageService } from "../src/services/usageService.js";
import { SubscriptionService } from "../src/services/subscriptionService.js";
import { providerBudgetService } from "../src/services/providerBudgetService.js";
import { trendingVehicleService } from "../src/services/trendingVehicleService.js";
import { VehicleService, evaluateVehiclePayloadStrength } from "../src/services/vehicleService.js";
import { buildLiveVehicleId } from "../src/providers/marketcheck/vehicleId.js";
import { createTestProviders, createTestRepositories, createVehicleFixtures, createVisionProviderResult } from "./helpers/testData.js";
import { buildMarketValueCacheKeys, createMarketListingsCacheRecord, createMarketValueCacheRecord } from "../src/lib/marketMemory.js";

const TEST_IMAGE_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2uoAAAAASUVORK5CYII=",
  "base64",
);

beforeEach(() => {
  providerBudgetService.resetForTests();
});

describe("UsageService", () => {
  beforeEach(() => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders());
  });

  test("allows free users while lifetime scans remain and blocks on the sixth scan", async () => {
    const service = new UsageService(new SubscriptionService());

    for (let scans = 0; scans < 5; scans += 1) {
      const testRepositories = createTestRepositories({
        usageCounters: [
          {
            id: `usage-${scans}`,
            userId: "demo-user",
            date: "1970-01-01",
            scanCount: scans,
            totalScans: scans,
            recentAttemptTimestamps: [],
          },
        ],
      });
      setRepositories(testRepositories.repositories);

      const allowed = await service.canScan("demo-user");
      assert.equal(allowed, true);
    }

    const testRepositories = createTestRepositories({
      usageCounters: [
        {
          id: "usage-1",
          userId: "demo-user",
          date: "1970-01-01",
          scanCount: 5,
          totalScans: 5,
          recentAttemptTimestamps: [],
        },
      ],
    });
    setRepositories(testRepositories.repositories);

    const summary = await service.assertScanAllowed({
      userId: "demo-user",
      email: "demo@example.com",
      plan: "free",
    });
    assert.equal(summary.plan, "free");
    assert.equal(summary.scansUsed, 5);
  });

  test("blocks rapid repeat scan attempts with the abuse guard", async () => {
    const recentAttempt = new Date().toISOString();
    const testRepositories = createTestRepositories({
      usageCounters: [
        {
          id: "usage-rapid",
          userId: "demo-user",
          date: "1970-01-01",
          scanCount: 1,
          totalScans: 1,
          recentAttemptTimestamps: Array.from({ length: 10 }, () => recentAttempt),
        },
      ],
    });
    setRepositories(testRepositories.repositories);

    const service = new UsageService(new SubscriptionService());

    await assert.rejects(
      () =>
        service.assertScanAllowed({
          userId: "demo-user",
          email: "demo@example.com",
          plan: "free",
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "ABUSE_GUARD_TRIGGERED" &&
        error.statusCode === 429,
    );
  });
});

describe("scan normalization", () => {
  test("trims fields, clamps confidence, and filters weak alternates", () => {
    const normalized = normalizeVisionResult({
      vehicle_type: "car",
      likely_year: 2021,
      likely_make: "  Cadillac ",
      likely_model: " CT4 ",
      likely_trim: " Premium Luxury ",
      confidence: 1.4,
      visible_clues: ["  Crest grille ", "  ", "Vertical LEDs  "],
      alternate_candidates: [
        {
          likely_year: 2020,
          likely_make: " Honda ",
          likely_model: " Civic ",
          likely_trim: " EX ",
          confidence: -0.3,
        },
        {
          likely_year: 2019,
          likely_make: " Ford ",
          likely_model: " Mustang ",
          likely_trim: " GT ",
          confidence: 0.33,
        },
        {
          likely_year: 0,
          likely_make: "Unknown",
          likely_model: "Unknown",
          confidence: 0.5,
        },
      ],
    });

    assert.equal(normalized.likely_make, "Cadillac");
    assert.equal(normalized.likely_model, "CT4");
    assert.equal(normalized.likely_trim, "Premium Luxury");
    assert.equal(normalized.confidence, 1);
    assert.deepEqual(normalized.visible_clues, ["Crest grille", "Vertical LEDs"]);
    assert.equal(normalized.alternate_candidates.length, 1);
    assert.equal(normalized.alternate_candidates[0].likely_make, "Ford");
    assert.equal(normalized.alternate_candidates[0].confidence, 0.33);
  });
});

describe("GarageService", () => {
  beforeEach(() => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders());
  });

  test("saves, lists, and deletes garage items against repository persistence", async () => {
    const service = new GarageService();

    const saved = await service.save({
      userId: "demo-user",
      vehicleId: "2021-cadillac-ct4-premium-luxury",
      imageUrl: "https://example.com/scan.jpg",
      notes: "Save this one",
      favorite: true,
    });

    assert.equal(saved.vehicle.make, "Cadillac");

    const listed = await service.list("demo-user");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, saved.id);

    await service.delete("demo-user", saved.id);

    const afterDelete = await service.list("demo-user");
    assert.equal(afterDelete.length, 0);
  });
});

describe("ScanService", () => {
  beforeEach(() => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders(createVisionProviderResult()));
  });

  test("persists normalized scans and increments lifetime usage for free users", async () => {
    const usageService = new UsageService(new SubscriptionService());
    const service = new ScanService(usageService);

    const startedAt = Date.now();
    const result = await service.identifyVehicle({
      auth: { userId: "demo-user", email: "demo@example.com", plan: "free" },
      imageBuffer: TEST_IMAGE_BUFFER,
      mimeType: "image/png",
      imageUrl: "memory://vehicle.png",
    });
    const elapsed = Date.now() - startedAt;

    assert.equal(result.scan.candidates[0].vehicleId, "2021-cadillac-ct4-premium-luxury");
    assert.ok(elapsed >= 1900);

    const usage = await usageService.getTodayUsage({
      userId: "demo-user",
      email: "demo@example.com",
      plan: "free",
    });
    assert.equal(usage.scansUsed, 1);
    assert.equal(usage.scansRemaining, null);
    assert.equal(usage.limitType, "lifetime");
  });

  test("does not delay or consume usage for pro users", async () => {
    const testRepositories = createTestRepositories({
      subscriptions: [
        {
          id: "sub-pro",
          userId: "demo-user",
          plan: "pro",
          status: "active",
          productId: "com.caridentifier.pro.monthly",
          verifiedAt: "2026-04-02T00:00:00.000Z",
        },
      ],
    });
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders(createVisionProviderResult()));

    const usageService = new UsageService(new SubscriptionService());
    const service = new ScanService(usageService);

    const startedAt = Date.now();
    await service.identifyVehicle({
      auth: { userId: "demo-user", email: "demo@example.com", plan: "pro" },
      imageBuffer: TEST_IMAGE_BUFFER,
      mimeType: "image/png",
      imageUrl: "memory://vehicle.png",
    });
    const elapsed = Date.now() - startedAt;

    assert.ok(elapsed < 1500);

    const usage = await usageService.getTodayUsage({
      userId: "demo-user",
      email: "demo@example.com",
      plan: "pro",
    });
    assert.equal(usage.isPro, true);
    assert.equal(usage.scansUsed, 0);
    assert.equal(usage.scansRemaining, null);
  });

  test("does not increment usage when scan processing fails", async () => {
    const testRepositories = createTestRepositories();
    setRepositories({
      ...testRepositories.repositories,
      visionDebug: {
        async create() {
          throw new Error("vision debug write failed");
        },
      },
    });
    setProviders(createTestProviders(createVisionProviderResult()));

    const usageService = new UsageService(new SubscriptionService());
    const service = new ScanService(usageService);

    await assert.rejects(() =>
      service.identifyVehicle({
        auth: { userId: "demo-user", email: "demo@example.com", plan: "free" },
        imageBuffer: TEST_IMAGE_BUFFER,
        mimeType: "image/png",
        imageUrl: "memory://vehicle.png",
      }),
    );

    const usage = await usageService.getTodayUsage({
      userId: "demo-user",
      email: "demo@example.com",
      plan: "free",
    });
    assert.equal(usage.scansUsed, 0);
  });
});

describe("VehicleService specs canonical layer", () => {
  beforeEach(() => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders());
  });

  test("returns promoted canonical vehicle before provider cache/provider for live vehicles", async () => {
    const liveVehicle = {
      ...createVehicleFixtures()[0],
      id: buildLiveVehicleId({
        year: 2021,
        make: "Cadillac",
        model: "CT4",
        trim: "Premium Luxury",
      }),
    };
    const canonicalKey = buildCanonicalKey({
      year: liveVehicle.year,
      make: liveVehicle.make,
      model: liveVehicle.model,
      trim: liveVehicle.trim,
      vehicleType: liveVehicle.vehicleType,
    });
    const testRepositories = createTestRepositories({
      canonicalVehicles: [
        {
          id: "canonical-1",
          year: liveVehicle.year,
          make: liveVehicle.make,
          model: liveVehicle.model,
          trim: liveVehicle.trim,
          vehicleType: liveVehicle.vehicleType,
          normalizedMake: "cadillac",
          normalizedModel: "ct4",
          normalizedTrim: "premium luxury",
          normalizedVehicleType: "car",
          canonicalKey,
          specsJson: liveVehicle,
          overviewJson: null,
          defaultImageUrl: null,
          sourceProvider: "marketcheck",
          sourceVehicleId: liveVehicle.id,
          popularityScore: 10,
          promotionStatus: "promoted",
          firstSeenAt: "2026-04-01T00:00:00.000Z",
          lastSeenAt: "2026-04-01T00:00:00.000Z",
          lastPromotedAt: "2026-04-01T00:00:00.000Z",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });
    setRepositories(testRepositories.repositories);

    const service = new VehicleService();
    const result = await service.getSpecs(liveVehicle.id);

    assert.equal(result.data.make, "Cadillac");
    assert.equal(result.source, "cache");
    assert.equal(testRepositories.state.providerApiUsageLogs.length, 0);
  });

  test("falls back to existing live provider flow when no canonical row exists", async () => {
    const liveVehicle = {
      ...createVehicleFixtures()[1],
      id: buildLiveVehicleId({
        year: 2020,
        make: "Honda",
        model: "Civic",
        trim: "EX",
      }),
    };
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      specsProviderName: "marketcheck",
      specsProvider: {
        async getVehicleSpecs() {
          return liveVehicle;
        },
        async searchVehicles() {
          return [];
        },
        async searchCandidates() {
          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getSpecs(liveVehicle.id);

    assert.equal(result.data.model, "Civic");
    assert.equal(result.source, "provider");
    assert.equal(testRepositories.state.canonicalVehicles.length, 1);
    assert.equal(testRepositories.state.canonicalVehicles[0].promotionStatus, "candidate");
  });

  test("seeded vehicles still return repository records without canonical dependency", async () => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);

    const service = new VehicleService();
    const result = await service.getSpecs("2021-cadillac-ct4-premium-luxury");

    assert.equal(result.data.make, "Cadillac");
    assert.equal(result.source, "cache");
    assert.equal(testRepositories.state.canonicalVehicles.length, 0);
  });

  test("live provider cache flow still works when canonical row is absent", async () => {
    const liveVehicle = {
      ...createVehicleFixtures()[2],
      id: buildLiveVehicleId({
        year: 2019,
        make: "Ford",
        model: "Mustang",
        trim: "GT",
      }),
    };
    const descriptor = {
      year: liveVehicle.year,
      make: liveVehicle.make,
      model: liveVehicle.model,
      trim: liveVehicle.trim,
      vehicleType: liveVehicle.vehicleType,
      normalizedMake: "ford",
      normalizedModel: "mustang",
      normalizedTrim: "gt",
    } as const;
    const cacheRow = createSpecsCacheRow({
      descriptor,
      cacheKey: "specs:2019:ford:mustang:gt:car",
      provider: "marketcheck",
      payload: liveVehicle,
    });
    const testRepositories = createTestRepositories();
    testRepositories.state.specsCache.push(cacheRow);
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      specsProviderName: "marketcheck",
    });

    const service = new VehicleService();
    const result = await service.getSpecs(liveVehicle.id);

    assert.equal(result.data.model, "Mustang");
    assert.equal(result.source, "cache");
    assert.equal(testRepositories.state.providerApiUsageLogs.length, 1);
    assert.equal(testRepositories.state.providerApiUsageLogs[0].eventType, "cache_hit");
  });

  test("evaluates adjacent-year Ranger payload as unlock-eligible when useful fallback exists", async () => {
    const ranger = {
      id: "2023-ford-ranger-xlt",
      year: 2023,
      make: "Ford",
      model: "Ranger",
      trim: "XLT",
      bodyStyle: "Truck",
      vehicleType: "car" as const,
      msrp: 34160,
      engine: "2.3L turbo I4",
      horsepower: 270,
      drivetrain: "4WD",
      transmission: "10-speed automatic",
      mpgOrRange: "20 city / 24 highway",
      torque: "310 lb-ft",
      colors: [],
    };

    const payload = evaluateVehiclePayloadStrength({
      vehicle: ranger,
      valuation: {
        id: "ranger-value",
        vehicleId: ranger.id,
        zip: "60610",
        mileage: 25000,
        condition: "good",
        tradeIn: 28750,
        privateParty: 30500,
        dealerRetail: 32900,
        currency: "USD",
        generatedAt: new Date().toISOString(),
      },
      listings: [],
    });

    assert.equal(payload.unlockEligible, true);
    assert.equal(payload.payloadStrength === "strong" || payload.payloadStrength === "usable", true);
  });

  test("falls back to previous-year valuation when exact year lookup misses", async () => {
    const ranger = {
      id: "2023-ford-ranger-xlt",
      year: 2023,
      make: "Ford",
      model: "Ranger",
      trim: "XLT",
      bodyStyle: "Truck",
      vehicleType: "car" as const,
      msrp: 34160,
      engine: "2.3L turbo I4",
      horsepower: 270,
      torque: "310 lb-ft",
      transmission: "10-speed automatic",
      drivetrain: "4WD",
      mpgOrRange: "20 city / 24 highway",
      colors: [],
    };
    const testRepositories = createTestRepositories({
      vehicles: [ranger],
    });
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation(input) {
          if (input.vehicle?.year === 2022 && input.vehicle.make === "Ford" && input.vehicle.model === "Ranger") {
            return {
              id: "val-ranger",
              vehicleId: ranger.id,
              zip: input.zip,
              mileage: input.mileage,
              condition: input.condition as any,
              tradeIn: 27000,
              privateParty: 28900,
              dealerRetail: 31200,
              currency: "USD" as const,
              generatedAt: "2026-04-19T00:00:00.000Z",
            };
          }
          return null;
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: ranger.id,
      zip: "60610",
      mileage: 25000,
      condition: "good",
    });

    assert.equal(result.data.tradeIn, 27000);
    assert.equal(result.source, "provider");
  });

  test("value cache key changes when zip or mileage changes", () => {
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

    const firstKey = getValuesCacheKey(descriptor, {
      zip: "60610",
      mileage: 18400,
      condition: "good",
    });
    const zipChangedKey = getValuesCacheKey(descriptor, {
      zip: "60611",
      mileage: 18400,
      condition: "good",
    });
    const mileageChangedKey = getValuesCacheKey(descriptor, {
      zip: "60610",
      mileage: 19600,
      condition: "good",
    });

    assert.notEqual(firstKey, zipChangedKey);
    assert.notEqual(firstKey, mileageChangedKey);
  });

  test("descriptor-only CR-V lookups resolve specs, value, and listings without a backend vehicle id", async () => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      specsProvider: {
        async getVehicleSpecs(input) {
          if (!input.vehicle) {
            return null;
          }
          return {
            ...input.vehicle,
            id: input.vehicleId,
            bodyStyle: input.vehicle.bodyStyle || "SUV",
            engine: "1.5L turbo I4",
            horsepower: 190,
            transmission: "CVT",
            drivetrain: "AWD",
            mpgOrRange: "27 city / 32 highway",
            msrp: 34500,
            colors: ["Urban Gray Pearl"],
          };
        },
        async searchVehicles() {
          return [];
        },
        async searchCandidates() {
          return [];
        },
      },
    });

    const descriptor = {
      year: 2020,
      make: "Honda",
      model: "CR-V",
      trim: "LX",
      vehicleType: "car" as const,
      bodyStyle: "SUV",
      normalizedModel: "cr-v",
    };

    const service = new VehicleService();
    const specs = await service.getSpecs({
      vehicleId: "95c64a97-ccee-4756-940d-9d68448f79f7",
      descriptor,
    });
    const value = await service.getValue({
      vehicleId: "95c64a97-ccee-4756-940d-9d68448f79f7",
      descriptor,
      zip: "60610",
      mileage: 12000,
      condition: "good",
    });
    const listings = await service.getListings({
      vehicleId: "95c64a97-ccee-4756-940d-9d68448f79f7",
      descriptor,
      zip: "60610",
      radiusMiles: 50,
    });

    assert.equal(specs.data.horsepower, 190);
    assert.ok(value.data.privateParty > 0);
    assert.ok(listings.data.length >= 1);
  });

  test("descriptor-backed CR-V value falls back to same-year model pricing when trim-specific lookup misses", async () => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      valueProvider: {
        async getValuation(input) {
          if (input.vehicle?.make === "Honda" && input.vehicle.model === "CR-V" && !input.vehicle.trim) {
            return {
              id: "crv-same-year-family-value",
              vehicleId: input.vehicleId,
              zip: input.zip,
              mileage: input.mileage,
              condition: input.condition as any,
              tradeIn: 24600,
              privateParty: 26200,
              dealerRetail: 28100,
              currency: "USD" as const,
              generatedAt: "2026-04-19T00:00:00.000Z",
              sourceLabel: "Based on market data",
              modelType: "provider_range" as const,
            };
          }
          return null;
        },
      },
    });

    const descriptor = {
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      vehicleType: "car" as const,
      bodyStyle: "SUV",
      normalizedModel: "cr-v",
    };

    const service = new VehicleService();
    const value = await service.getValue({
      vehicleId: "client-only-crv-id",
      descriptor,
      zip: "60610",
      mileage: 18000,
      condition: "good",
    });

    assert.equal(value.data.privateParty, 26200);
    assert.equal(value.data.sourceLabel, "Based on market data");
  });

  test("descriptor-backed CR-V listings fall back to same-model mixed trims when exact trim misses", async () => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      listingsProvider: {
        async getListings(input) {
          if (input.vehicle?.make === "Honda" && input.vehicle.model === "CR-V" && !input.vehicle.trim) {
            return [
              {
                id: "crv-sport-listing",
                vehicleId: input.vehicleId,
                title: "2023 Honda CR-V Sport",
                price: 31850,
                mileage: 14200,
                dealer: "Northside Honda",
                distanceMiles: 24,
                location: "Chicago, IL",
                imageUrl: "https://example.com/crv-sport.jpg",
                listedAt: "2026-04-19T00:00:00.000Z",
              },
            ];
          }
          return [];
        },
      },
    });

    const descriptor = {
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      vehicleType: "car" as const,
      bodyStyle: "SUV",
      normalizedModel: "cr-v",
    };

    const service = new VehicleService();
    const listings = await service.getListings({
      vehicleId: "client-only-crv-id",
      descriptor,
      zip: "60610",
      radiusMiles: 50,
    });

    assert.equal(listings.data.length, 1);
    assert.equal(listings.data[0]?.dealer, "Northside Honda");
  });

  test("descriptor-backed Corolla detail resolves partial specs when provider specs are unavailable", async () => {
    const corollaCanonical = {
      id: "canonical-corolla-se-2022",
      year: 2022,
      make: "Toyota",
      model: "Corolla",
      trim: "SE",
      bodyType: "Sedan",
      vehicleType: "car" as const,
      normalizedMake: "toyota",
      normalizedModel: "corolla",
      normalizedTrim: "se",
      normalizedVehicleType: "car",
      canonicalKey: "canonical:2022:toyota:corolla:se:car",
      specsJson: {
        id: "canonical-corolla-se-2022",
        year: 2022,
        make: "Toyota",
        model: "Corolla",
        trim: "SE",
        bodyStyle: "Sedan",
        vehicleType: "car" as const,
        msrp: 23800,
        engine: "2.0L I4",
        horsepower: 169,
        torque: "151 lb-ft",
        transmission: "CVT",
        drivetrain: "FWD",
        mpgOrRange: "31 city / 40 highway",
        colors: [],
      },
      overviewJson: null,
      defaultImageUrl: null,
      sourceProvider: "marketcheck",
      sourceVehicleId: "canonical-corolla-se-2022",
      popularityScore: 10,
      promotionStatus: "promoted" as const,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      lastSeenAt: "2026-04-01T00:00:00.000Z",
      lastPromotedAt: "2026-04-01T00:00:00.000Z",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };

    const testRepositories = createTestRepositories({
      canonicalVehicles: [corollaCanonical],
    });
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      specsProvider: {
        async getVehicleSpecs() {
          return null;
        },
        async searchVehicles() {
          return [];
        },
        async searchCandidates() {
          return [];
        },
      },
    });

    const descriptor = {
      year: 2023,
      make: "Toyota",
      model: "Corolla",
      trim: "LE",
      vehicleType: "car" as const,
      bodyStyle: "Sedan",
      normalizedModel: "corolla",
    };

    const service = new VehicleService();
    const specs = await service.getSpecs({
      vehicleId: "client-only-corolla-id",
      descriptor,
    });

    assert.equal(specs.data.make, "Toyota");
    assert.equal(specs.data.model, "Corolla");
    assert.equal(specs.data.horsepower, 169);
    assert.equal(specs.data.drivetrain, "FWD");
  });

  test("offline canonical seed data never uses horsepower 0 placeholders and keeps lightweight values for CR-V/RAV4", () => {
    const file = path.resolve(process.cwd(), "..", "assets/data/offline_canonical.json");
    const payload = JSON.parse(fs.readFileSync(file, "utf8")) as {
      vehicles: Array<{
        make: string;
        model: string;
        basicSpecs?: { horsepower?: number | null };
        lightweightValue?: unknown;
      }>;
    };

    payload.vehicles.forEach((vehicle) => {
      assert.notEqual(vehicle.basicSpecs?.horsepower ?? null, 0);
    });

    const targets = payload.vehicles.filter((vehicle) => {
      const make = vehicle.make.toLowerCase();
      const model = vehicle.model.toLowerCase();
      return (make === "honda" && model === "cr-v") || (make === "toyota" && model === "rav4");
    });

    assert.ok(targets.length >= 1);
    targets.forEach((vehicle) => {
      assert.ok(vehicle.lightweightValue);
    });
  });
});

describe("VehicleService cache-first provider gating", () => {
  test("provider budget gate blocks unnecessary live calls", () => {
    const decision = providerBudgetService.evaluate({
      provider: "marketcheck",
      operation: "value",
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      entitlement: "free",
      identificationConfidence: 0.82,
      freshCacheExists: false,
      fallbackStrength: "usable",
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.fallbackPreferred, true);
  });

  test("exact market value cache hit prevents provider call", async () => {
    const descriptor = {
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      vehicleType: "car" as const,
      bodyStyle: "SUV",
      normalizedModel: "crv",
    };
    const cacheKeys = buildMarketValueCacheKeys({
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      bodyStyle: "SUV",
      zip: "60610",
      mileage: 18400,
      condition: "good",
    });
    const testRepositories = createTestRepositories();
    testRepositories.state.marketValueCache.push(
      createMarketValueCacheRecord({
        cacheKey: cacheKeys.exact,
        year: 2023,
        make: "Honda",
        model: "CR-V",
        trim: "EX-L",
        bodyStyle: "SUV",
        zip: "60610",
        mileage: 18400,
        condition: "good",
        valuation: {
          id: "cached-crv-value",
          vehicleId: "cached-crv",
          zip: "60610",
          mileage: 18400,
          condition: "good",
          tradeIn: 24600,
          tradeInLow: 23800,
          tradeInHigh: 25200,
          privateParty: 26200,
          privatePartyLow: 25400,
          privatePartyHigh: 27000,
          dealerRetail: 28100,
          dealerRetailLow: 27400,
          dealerRetailHigh: 28900,
          currency: "USD",
          generatedAt: "2026-04-20T00:00:00.000Z",
          sourceLabel: "Based on market data",
          confidenceLabel: "High confidence",
          modelType: "provider_range",
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
      vehicleId: "client-only-crv-id",
      descriptor,
      zip: "60610",
      mileage: 18400,
      condition: "good",
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.source, "cache");
    assert.equal(result.data.privateParty, 26200);
    assert.equal(result.data.isCached, true);
  });

  test("family listings cache hit prevents provider call", async () => {
    const descriptor = {
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      vehicleType: "car" as const,
      bodyStyle: "SUV",
      normalizedModel: "crv",
    };
    const testRepositories = createTestRepositories();
    testRepositories.state.marketListingsCache.push(
      createMarketListingsCacheRecord({
        cacheKey: "market-listings:2023:honda:crv:any:606:family",
        year: 2023,
        make: "Honda",
        model: "CR-V",
        trim: "",
        bodyStyle: "SUV",
        zip: "60610",
        listings: [
          {
            id: "cached-crv-listing",
            vehicleId: "cached-crv",
            title: "2023 Honda CR-V Sport",
            price: 31995,
            mileage: 12000,
            dealer: "Northside Honda",
            distanceMiles: 14,
            location: "Chicago, IL",
            imageUrl: "https://example.com/crv.jpg",
            listedAt: "2026-04-20T00:00:00.000Z",
          },
        ],
        listingMode: "same_model_mixed_trims",
        sourceLabel: "Nearby listings for this model",
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
      vehicleId: "client-only-crv-id",
      descriptor,
      zip: "60610",
      radiusMiles: 50,
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.source, "cache");
    assert.equal(result.data.length, 1);
    assert.equal(result.meta?.mode, "same_model_mixed_trims");
  });

  test("value falls back after provider 429", async () => {
    const descriptor = {
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      vehicleType: "car" as const,
      bodyStyle: "SUV",
      normalizedModel: "crv",
    };
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      valueProviderName: "marketcheck",
      valueProvider: {
        async getValuation() {
          throw new AppError(429, "MARKETCHECK_RATE_LIMITED", "quota");
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getValue({
      vehicleId: "client-only-crv-id",
      descriptor,
      zip: "60610",
      mileage: 18400,
      condition: "good",
    });

    assert.ok(result.data.privateParty > 0);
    assert.equal(result.data.providerSkippedReason, "quota");
  });

  test("listings fall back after provider 429", async () => {
    const descriptor = {
      year: 2023,
      make: "Honda",
      model: "CR-V",
      trim: "EX-L",
      vehicleType: "car" as const,
      bodyStyle: "SUV",
      normalizedModel: "crv",
    };
    const testRepositories = createTestRepositories({
      listings: [
        {
          id: "stored-crv-listing",
          vehicleId: "client-only-crv-id",
          title: "2023 Honda CR-V Sport Touring",
          price: 33200,
          mileage: 9800,
          dealer: "Lake Honda",
          distanceMiles: 19,
          location: "Chicago, IL",
          imageUrl: "https://example.com/stored-crv.jpg",
          listedAt: "2026-04-20T00:00:00.000Z",
        },
      ],
    });
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders(),
      listingsProviderName: "marketcheck",
      listingsProvider: {
        async getListings() {
          throw new AppError(429, "MARKETCHECK_RATE_LIMITED", "quota");
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getListings({
      vehicleId: "client-only-crv-id",
      descriptor,
      zip: "60610",
      radiusMiles: 50,
    });

    assert.equal(result.data.length, 1);
    assert.equal(result.meta?.believableCount, 1);
  });

  test("common vehicles return canonical specs without provider", async () => {
    const corollaCanonical = {
      id: "canonical-corolla-le-2023",
      year: 2023,
      make: "Toyota",
      model: "Corolla",
      trim: "LE",
      bodyType: "Sedan",
      vehicleType: "car" as const,
      normalizedMake: "toyota",
      normalizedModel: "corolla",
      normalizedTrim: "le",
      normalizedVehicleType: "car",
      canonicalKey: "canonical:2023:toyota:corolla:le:car",
      specsJson: {
        id: "canonical-corolla-le-2023",
        year: 2023,
        make: "Toyota",
        model: "Corolla",
        trim: "LE",
        bodyStyle: "Sedan",
        vehicleType: "car" as const,
        msrp: 22500,
        engine: "2.0L I4",
        horsepower: 169,
        torque: "151 lb-ft",
        transmission: "CVT",
        drivetrain: "FWD",
        mpgOrRange: "32 city / 41 highway",
        colors: [],
      },
      overviewJson: null,
      defaultImageUrl: null,
      sourceProvider: "seed",
      sourceVehicleId: "seed-corolla",
      popularityScore: 20,
      promotionStatus: "promoted" as const,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      lastSeenAt: "2026-04-01T00:00:00.000Z",
      lastPromotedAt: "2026-04-01T00:00:00.000Z",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    };
    const testRepositories = createTestRepositories({
      canonicalVehicles: [corollaCanonical],
    });
    setRepositories(testRepositories.repositories);
    let providerCalls = 0;
    setProviders({
      ...createTestProviders(),
      specsProviderName: "marketcheck",
      specsProvider: {
        async getVehicleSpecs() {
          providerCalls += 1;
          return null;
        },
        async searchVehicles() {
          return [];
        },
        async searchCandidates() {
          return [];
        },
      },
    });

    const service = new VehicleService();
    const result = await service.getSpecs({
      vehicleId: "client-only-corolla-id",
      descriptor: {
        year: 2023,
        make: "Toyota",
        model: "Corolla",
        trim: "LE",
        vehicleType: "car",
        bodyStyle: "Sedan",
        normalizedModel: "corolla",
      },
    });

    assert.equal(providerCalls, 0);
    assert.equal(result.data.horsepower, 169);
    assert.equal(result.meta?.isCanonical, true);
  });

  test("production startup does not trigger provider preload", async () => {
    const previousAppEnv = env.APP_ENV;
    const previousAllowPreload = env.ALLOW_PRELOAD;
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    let providerCalls = 0;
    setProviders({
      ...createTestProviders(),
      specsProvider: {
        async getVehicleSpecs() {
          return null;
        },
        async searchVehicles() {
          return [];
        },
        async searchCandidates() {
          providerCalls += 1;
          return [];
        },
      },
    });

    env.APP_ENV = "production";
    env.ALLOW_PRELOAD = false;
    const interval = trendingVehicleService.startScheduler();
    if (interval) {
      clearInterval(interval);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    env.APP_ENV = previousAppEnv;
    env.ALLOW_PRELOAD = previousAllowPreload;

    assert.equal(providerCalls, 0);
  });
});

process.on("exit", () => {
  resetRepositories();
  resetProviders();
});
