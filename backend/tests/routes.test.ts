import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import inject from "light-my-request";
import type { InjectOptions, Response } from "light-my-request";
import { createApp } from "../src/app.js";
import { resetProviders, setProviders } from "../src/lib/providerRegistry.js";
import { resetRepositories, setRepositories } from "../src/lib/repositoryRegistry.js";
import { googleVisionOcrService } from "../src/services/googleVisionOcrService.js";
import { createTestProviders, createTestRepositories } from "./helpers/testData.js";

const TEST_IMAGE_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2uoAAAAASUVORK5CYII=",
  "base64",
);

function createMultipartImageBody(filename = "vehicle.png", contentType = "image/png", content = TEST_IMAGE_BUFFER) {
  const boundary = "----car-identifier-test-boundary";
  const header = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="image"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      "",
      "",
    ].join("\r\n"),
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, content, footer]);

  return {
    payload: body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": Buffer.byteLength(body).toString(),
    },
  };
}

function parseJson<T>(response: Response): T {
  return JSON.parse(response.payload) as T;
}

async function requestApp(options: InjectOptions): Promise<Response> {
  const app = createApp();
  return inject(app as any, options);
}

function authHeaders(userId = "demo-user", email = "demo@example.com") {
  return {
    authorization: `Bearer dev-session:${userId}:${encodeURIComponent(email)}`,
  };
}

describe("API routes", () => {
  let originalExtractVehicleText: typeof googleVisionOcrService.extractVehicleText;

  beforeEach(() => {
    originalExtractVehicleText = googleVisionOcrService.extractVehicleText;
    googleVisionOcrService.extractVehicleText = async () => null;
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders());
  });

  afterEach(() => {
    googleVisionOcrService.extractVehicleText = originalExtractVehicleText;
  });

  test("POST /api/scan/identify returns a normalized scan response", async () => {
    const multipart = createMultipartImageBody();

    const response = await requestApp({
      method: "POST",
      url: "/api/scan/identify",
      headers: {
        ...multipart.headers,
        ...authHeaders(),
      },
      payload: multipart.payload,
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.detectedVehicleType, "car");
    assert.equal(body.data.candidates[0].vehicleId, "");
    assert.equal(body.meta.topCandidateVehicleId, "");
  });

  test("POST /api/scan/identify keeps OCR override as the final visible winner", async () => {
    googleVisionOcrService.extractVehicleText = async () => ({
      rawText: "2026 Honda CR-V",
      textLines: ["2026 Honda CR-V"],
      detectedYear: 2026,
      detectedMake: "Honda",
      detectedModel: "CR-V",
      detectedTrim: null,
      decisionReason: "structured_vehicle_confirmed",
      structuredVehicle: {
        year: 2026,
        make: "Honda",
        model: "CR-V",
        trim: null,
      },
      confidence: 0.99,
      credentialSource: "env",
    });

    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders({
      ...createTestProviders({
        provider: "test-vision",
        rawResponse: { source: "test" },
        normalized: {
          vehicle_type: "car",
          likely_year: 2024,
          likely_make: "Honda",
          likely_model: "CR-V",
          likely_trim: undefined,
          source: "visual_candidate",
          confidence: 0.84,
          visible_clues: [],
          alternate_candidates: [],
        },
      }),
      specsProvider: {
        async searchCandidates() {
          return [
            {
              id: "provider-2024-honda-crv-ex",
              year: 2024,
              make: "Honda",
              model: "CR-V",
              trim: "EX",
              bodyStyle: "SUV",
              vehicleType: "car",
              msrp: 34500,
              engine: "1.5L turbo I4",
              horsepower: 190,
              torque: "179 lb-ft",
              transmission: "CVT",
              drivetrain: "AWD",
              mpgOrRange: "27 city / 32 highway",
              colors: ["Urban Gray Pearl"],
            },
          ];
        },
        async getVehicleSpecs() {
          throw new Error("Not used in this OCR route test.");
        },
        async searchVehicles() {
          throw new Error("Not used in this OCR route test.");
        },
      },
    });

    const multipart = createMultipartImageBody("ocr-test.jpg", "image/jpeg");
    const response = await requestApp({
      method: "POST",
      url: "/api/scan/identify",
      headers: {
        ...multipart.headers,
        ...authHeaders(),
      },
      payload: multipart.payload,
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.normalizedResult.source, "ocr_override");
    assert.equal(body.data.normalizedResult.likely_year, 2026);
    assert.equal(body.data.normalizedResult.likely_make, "Honda");
    assert.equal(body.data.normalizedResult.likely_model, "CR-V");
    assert.equal(body.data.candidates[0].year, 2026);
    assert.equal(body.data.candidates[0].make, "Honda");
    assert.equal(body.data.candidates[0].model, "CR-V");
    assert.equal(body.meta.scanRuntimeVersion, "ocr-visual-fallback-enforce-v3");
  });

  test("GET /api/usage/today falls back to guest usage in development", async () => {
    const response = await requestApp({
      method: "GET",
      url: "/api/usage/today",
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.plan, "free");
    assert.equal(body.data.limitType, "lifetime");
  });

  test("GET /api/vehicle/specs returns vehicle details", async () => {
    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/specs?vehicleId=2021-cadillac-ct4-premium-luxury",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.make, "Cadillac");
    assert.equal(body.data.model, "CT4");
  });

  test("GET /api/vehicle/value returns valuation data", async () => {
    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/value?vehicleId=2021-cadillac-ct4-premium-luxury&zip=60610&mileage=12000&condition=good",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.vehicleId, "2021-cadillac-ct4-premium-luxury");
    assert.equal(body.data.condition, "good");
    assert.ok(body.data.tradeIn > 0);
    assert.ok(body.data.privateParty >= body.data.tradeIn);
  });

  test("GET /api/vehicle/listings returns nearby listings", async () => {
    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/listings?vehicleId=2021-cadillac-ct4-premium-luxury&zip=60610&radiusMiles=50",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.meta.count, 1);
  });

  test("GET /api/heartbeat returns a lightweight heartbeat result", async () => {
    const response = await requestApp({
      method: "GET",
      url: "/api/heartbeat",
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(typeof body.data.success, "boolean");
    assert.equal(typeof body.data.message, "string");
  });

  test("GET /api/vehicle/specs resolves descriptor-backed estimates even with a client-only id", async () => {
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

    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/specs?vehicleId=95c64a97-ccee-4756-940d-9d68448f79f7&year=2020&make=Honda&model=CR-V&trim=LX&vehicleType=car&bodyStyle=SUV&normalizedModel=cr-v",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.make, "Honda");
    assert.equal(body.data.model, "CR-V");
    assert.equal(body.data.horsepower, 190);
  });

  test("GET /api/vehicle/specs accepts the live CR-V descriptor request shape without returning 400", async () => {
    let specsProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      specsProvider: {
        async getVehicleSpecs(input) {
          specsProviderCalled = true;
          assert.equal(input.vehicle?.year, 2026);
          assert.equal(input.vehicle?.make, "Honda");
          assert.equal(input.vehicle?.model, "Cr-v");
          return {
            ...input.vehicle!,
            id: input.vehicleId,
            bodyStyle: input.vehicle?.bodyStyle || "SUV",
            engine: "1.5L turbo I4",
            horsepower: 190,
            transmission: "CVT",
            drivetrain: "AWD",
            mpgOrRange: "28 city / 34 highway",
            msrp: 35850,
            colors: ["Meteorite Gray"],
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

    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/specs?year=2026&make=Honda&model=Cr-v&trim=LX&vehicleType=car&bodyStyle=SUV&normalizedModel=cr+v",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.make, "Honda");
    assert.equal(body.data.model, "Cr-v");
    assert.equal(specsProviderCalled, true);
  });

  test("GET /api/vehicle/value resolves descriptor-backed estimates even with a client-only id", async () => {
    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/value?vehicleId=95c64a97-ccee-4756-940d-9d68448f79f7&year=2020&make=Honda&model=CR-V&trim=LX&vehicleType=car&bodyStyle=SUV&normalizedModel=cr-v&zip=60610&mileage=12000&condition=good",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.ok(body.data.privateParty > 0);
    assert.equal(body.data.condition, "good");
  });

  test("GET /api/vehicle/value accepts the live CR-V descriptor request shape without returning 400", async () => {
    let valueProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      valueProvider: {
        async getValuation(input) {
          valueProviderCalled = true;
          assert.equal(input.vehicle?.year, 2026);
          assert.equal(input.vehicle?.make, "Honda");
          assert.equal(input.vehicle?.model, "Cr-v");
          assert.equal(input.zip, "60563");
          assert.equal(input.mileage, 18400);
          assert.equal(input.condition, "fair");
          return {
            id: "valuation-live-crv-shape",
            vehicleId: input.vehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition as any,
            tradeIn: 28600,
            tradeInLow: 27400,
            tradeInHigh: 29800,
            privateParty: 30100,
            privatePartyLow: 28900,
            privatePartyHigh: 31300,
            dealerRetail: 32400,
            dealerRetailLow: 31200,
            dealerRetailHigh: 33600,
            currency: "USD",
            generatedAt: new Date().toISOString(),
            sourceLabel: "Based on market data",
            modelType: "provider_range",
          };
        },
      },
    });

    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/value?year=2026&make=Honda&model=Cr-v&trim=LX&vehicleType=car&bodyStyle=SUV&normalizedModel=cr+v&zip=60563&mileage=18400&condition=fair",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.condition, "fair");
    assert.ok(body.data.privateParty > 0);
    assert.equal(valueProviderCalled, true);
  });

  test("GET /api/vehicle/listings resolves descriptor-backed estimates even with a client-only id", async () => {
    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/listings?vehicleId=95c64a97-ccee-4756-940d-9d68448f79f7&year=2020&make=Honda&model=CR-V&trim=LX&vehicleType=car&bodyStyle=SUV&normalizedModel=cr-v&zip=60610&radiusMiles=50",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.ok(body.data.length >= 1);
    assert.equal(body.meta.count, body.data.length);
  });

  test("GET /api/vehicle/listings accepts the live CR-V descriptor request shape without returning 400", async () => {
    let listingsProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      listingsProvider: {
        async getListings(input) {
          listingsProviderCalled = true;
          assert.equal(input.vehicle?.year, 2026);
          assert.equal(input.vehicle?.make, "Honda");
          assert.equal(input.vehicle?.model, "Cr-v");
          assert.equal(input.zip, "60610");
          assert.equal(input.radiusMiles, 50);
          return [
            {
              id: "live-crv-listing",
              vehicleId: input.vehicleId,
              price: 32995,
              mileage: 4200,
              title: "2026 Honda CR-V LX",
              dealer: "Northside Honda",
              location: "Chicago, IL",
              imageUrl: "https://example.com/crv.jpg",
              distanceMiles: 14,
            },
          ];
        },
      },
    });

    const response = await requestApp({
      method: "GET",
      url: "/api/vehicle/listings?year=2026&make=Honda&model=Cr-v&trim=LX&vehicleType=car&bodyStyle=SUV&normalizedModel=cr+v&zip=60610&radiusMiles=50",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.ok(body.data.length >= 1);
    assert.equal(listingsProviderCalled, true);
  });

  test("garage save, list, and delete preserve persistence", async () => {
    const saveResponse = await requestApp({
      method: "POST",
      url: "/api/garage/save",
      headers: {
        "content-type": "application/json",
        ...authHeaders(),
      },
      payload: {
        vehicleId: "2021-cadillac-ct4-premium-luxury",
        imageUrl: "https://example.com/scan.jpg",
        notes: "My first scan",
        favorite: true,
      },
    });
    const saveBody = parseJson<any>(saveResponse);

    assert.equal(saveResponse.statusCode, 200);
    assert.equal(saveBody.success, true);
    const garageId = saveBody.data.id as string;

    const listResponse = await requestApp({ method: "GET", url: "/api/garage/list", headers: authHeaders() });
    const listBody = parseJson<any>(listResponse);
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listBody.data.length, 1);
    assert.equal(listBody.data[0].vehicle.id, "2021-cadillac-ct4-premium-luxury");

    const deleteResponse = await requestApp({ method: "DELETE", url: `/api/garage/${garageId}`, headers: authHeaders() });
    const deleteBody = parseJson<any>(deleteResponse);
    assert.equal(deleteResponse.statusCode, 200);
    assert.equal(deleteBody.data.deleted, true);

    const afterDeleteResponse = await requestApp({ method: "GET", url: "/api/garage/list", headers: authHeaders() });
    const afterDeleteBody = parseJson<any>(afterDeleteResponse);
    assert.equal(afterDeleteResponse.statusCode, 200);
    assert.equal(afterDeleteBody.data.length, 0);
  });

  test("GET /api/usage/today reflects lifetime scan usage semantics", async () => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders());
    const multipart = createMultipartImageBody();

    await requestApp({
      method: "POST",
      url: "/api/scan/identify",
      headers: {
        ...multipart.headers,
        ...authHeaders(),
      },
      payload: multipart.payload,
    });
    const usageResponse = await requestApp({ method: "GET", url: "/api/usage/today", headers: authHeaders() });
    const usageBody = parseJson<any>(usageResponse);

    assert.equal(usageResponse.statusCode, 200);
    assert.equal(usageBody.success, true);
    assert.equal(usageBody.data.plan, "free");
    assert.equal(usageBody.data.scansUsed, 1);
    assert.equal(usageBody.data.scansRemaining, null);
    assert.equal(usageBody.data.limitType, "lifetime");
    assert.equal(usageBody.data.limit, null);
    assert.equal(usageBody.data.scansUsedToday, 1);
    assert.equal(usageBody.data.dailyScanLimit, null);
  });

  test("POST /api/scan/identify still allows basic scans after five lifetime scans", async () => {
    const testRepositories = createTestRepositories({
      usageCounters: [
        {
          id: "usage-limit",
          userId: "demo-user",
          date: "1970-01-01",
          scanCount: 5,
          totalScans: 5,
          recentAttemptTimestamps: [],
        },
      ],
    });
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders());
    const multipart = createMultipartImageBody();

    const response = await requestApp({
      method: "POST",
      url: "/api/scan/identify",
      headers: {
        ...multipart.headers,
        ...authHeaders(),
      },
      payload: multipart.payload,
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
  });

  test("POST /api/subscription/cancel returns the user to the free plan", async () => {
    const testRepositories = createTestRepositories({
      subscriptions: [
        {
          id: "sub-pro",
          userId: "demo-user",
          plan: "pro",
          status: "active",
          productId: "com.caridentifier.pro.monthly",
          expiresAt: "2026-05-01T00:00:00.000Z",
          verifiedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });
    setRepositories(testRepositories.repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/cancel",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.plan, "free");
    assert.equal(body.data.status, "active");
  });

  test("dev auth tokens isolate subscription state by signed-in email", async () => {
    const verifyResponse = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer dev-user:pro-user@example.com",
      },
      payload: {
        platform: "ios",
        productId: "com.caridentifier.pro.monthly",
        receiptData: "dev-pro-receipt",
      },
    });
    const verifyBody = parseJson<any>(verifyResponse);
    assert.equal(verifyResponse.statusCode, 200);
    assert.equal(verifyBody.data.plan, "pro");

    const proUsageResponse = await requestApp({
      method: "GET",
      url: "/api/usage/today",
      headers: {
        authorization: "Bearer dev-user:pro-user@example.com",
      },
    });
    const proUsageBody = parseJson<any>(proUsageResponse);
    assert.equal(proUsageBody.data.plan, "pro");

    const freeUsageResponse = await requestApp({
      method: "GET",
      url: "/api/usage/today",
      headers: {
        authorization: "Bearer dev-user:new-user@example.com",
      },
    });
    const freeUsageBody = parseJson<any>(freeUsageResponse);
    assert.equal(freeUsageResponse.statusCode, 200);
    assert.equal(freeUsageBody.data.plan, "free");
    assert.equal(freeUsageBody.data.scansUsed, 0);
  });
});

process.on("exit", () => {
  resetRepositories();
  resetProviders();
});
