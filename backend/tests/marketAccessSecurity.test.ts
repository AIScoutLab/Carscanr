import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import inject from "light-my-request";
import type { InjectOptions, Response } from "light-my-request";
import { createApp } from "../src/app.js";
import { setProviders } from "../src/lib/providerRegistry.js";
import { setRepositories } from "../src/lib/repositoryRegistry.js";
import { createTestProviders, createTestRepositories } from "./helpers/testData.js";

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

describe("premium market access security", () => {
  beforeEach(() => {
    setRepositories(createTestRepositories().repositories);
    setProviders(createTestProviders());
  });

  test("live value refresh requires auth before provider access", async () => {
    let valueProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      valueProvider: {
        async getValuation() {
          valueProviderCalled = true;
          throw new Error("Live value provider should not be called without entitlement.");
        },
      },
    });

    const response = await requestApp({
      method: "GET",
      url:
        "/api/vehicle/value?vehicleId=2021-cadillac-ct4-premium-luxury&zip=60502&mileage=12000&condition=good" +
        "&allowLive=true&forceLive=true&fetchReason=user_requested_value_refresh&sourceScreen=valueScreen&action=valueRefresh",
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 401);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "AUTH_REQUIRED");
    assert.equal(valueProviderCalled, false);
  });

  test("live listings refresh requires a vehicle unlock for authenticated free users", async () => {
    let listingsProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      listingsProvider: {
        async getListings() {
          listingsProviderCalled = true;
          throw new Error("Live listings provider should not be called before unlock.");
        },
      },
    });

    const response = await requestApp({
      method: "GET",
      url:
        "/api/vehicle/listings?vehicleId=2021-cadillac-ct4-premium-luxury&zip=60502&radiusMiles=50" +
        "&allowLive=true&forceLive=true&fetchReason=user_requested_listings_refresh&sourceScreen=listingsScreen&action=listingsRefresh",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 403);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "PREMIUM_ACCESS_REQUIRED");
    assert.equal(listingsProviderCalled, false);
  });

  test("Pro yearly users can request live value without a free unlock", async () => {
    setRepositories(
      createTestRepositories({
        subscriptions: [
          {
            id: "sub-pro-yearly",
            userId: "demo-user",
            plan: "pro_yearly",
            status: "active",
            productId: "com.caridentifier.pro.yearly",
            expiresAt: "2027-05-01T00:00:00.000Z",
            verifiedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      }).repositories,
    );
    let valueProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      valueProvider: {
        async getValuation(input) {
          valueProviderCalled = true;
          return {
            id: "valuation-pro-live",
            vehicleId: input.vehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition as any,
            tradeIn: 27000,
            privateParty: 28900,
            dealerRetail: 30900,
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
      url:
        "/api/vehicle/value?vehicleId=2021-cadillac-ct4-premium-luxury&zip=60502&mileage=12000&condition=good" +
        "&allowLive=true&forceLive=true&fetchReason=user_requested_value_refresh&sourceScreen=valueScreen&action=valueRefresh",
      headers: authHeaders(),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(valueProviderCalled, true);
  });
});
