import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import inject from "light-my-request";
import type { InjectOptions, Response } from "light-my-request";
import { createApp } from "../src/app.js";
import { resetProviders, setProviders } from "../src/lib/providerRegistry.js";
import { resetRepositories, setRepositories } from "../src/lib/repositoryRegistry.js";
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
  beforeEach(() => {
    const testRepositories = createTestRepositories();
    setRepositories(testRepositories.repositories);
    setProviders(createTestProviders());
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
    assert.equal(body.data.candidates[0].vehicleId, "2021-cadillac-ct4-premium-luxury");
    assert.equal(body.meta.topCandidateVehicleId, "2021-cadillac-ct4-premium-luxury");
  });

  test("GET /api/usage/today requires an explicit auth token in development", async () => {
    const response = await requestApp({
      method: "GET",
      url: "/api/usage/today",
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 401);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "AUTH_REQUIRED");
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
