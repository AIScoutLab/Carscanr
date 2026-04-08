import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../src/errors/appError.js";
import { buildCanonicalKey, createSpecsCacheRow } from "../src/lib/providerCache.js";
import { resetProviders, setProviders } from "../src/lib/providerRegistry.js";
import { resetRepositories, setRepositories } from "../src/lib/repositoryRegistry.js";
import { GarageService } from "../src/services/garageService.js";
import { normalizeVisionResult, ScanService } from "../src/services/scanService.js";
import { UsageService } from "../src/services/usageService.js";
import { SubscriptionService } from "../src/services/subscriptionService.js";
import { VehicleService } from "../src/services/vehicleService.js";
import { buildLiveVehicleId } from "../src/providers/marketcheck/vehicleId.js";
import { createTestProviders, createTestRepositories, createVehicleFixtures, createVisionProviderResult } from "./helpers/testData.js";

const TEST_IMAGE_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2uoAAAAASUVORK5CYII=",
  "base64",
);

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

    await assert.rejects(
      () =>
        service.assertScanAllowed({
          userId: "demo-user",
          email: "demo@example.com",
          plan: "free",
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "SCAN_LIMIT_REACHED" &&
        error.statusCode === 403,
    );
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
    assert.equal(usage.scansRemaining, 4);
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
});

process.on("exit", () => {
  resetRepositories();
  resetProviders();
});
