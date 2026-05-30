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

  test("descriptor unlock enables live value and listings for estimated scan results", async () => {
    let listingsProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      listingsProvider: {
        async getListings(input) {
          listingsProviderCalled = true;
          return [
            {
              id: `listing-${input.vehicleId}`,
              vehicleId: input.vehicleId,
              title: "2021 Cadillac CT4 Premium Luxury",
              price: 31995,
              mileage: 11820,
              dealer: "Lakefront Auto",
              distanceMiles: 12,
              location: "Chicago, IL",
              imageUrl: "https://example.com/cadillac-ct4.jpg",
              listedAt: new Date("2026-04-18T12:00:00.000Z").toISOString(),
            },
          ];
        },
      },
    });

    const unlockResponse = await requestApp({
      method: "POST",
      url: "/api/unlocks/use",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        vehicleId: "estimate:2021:cadillac:ct4:family",
        year: 2021,
        make: "Cadillac",
        model: "CT4",
        trim: "Premium Luxury",
        vehicleType: "car",
      }),
    });
    const unlockBody = parseJson<any>(unlockResponse);

    assert.equal(unlockResponse.statusCode, 200);
    assert.equal(unlockBody.success, true);
    assert.equal(unlockBody.data.entitlement.allowed, true);
    assert.equal(unlockBody.data.entitlement.usedUnlock, true);

    const listingsResponse = await requestApp({
      method: "GET",
      url:
        "/api/vehicle/listings?year=2021&make=Cadillac&model=CT4&trim=Premium%20Luxury&vehicleType=car&zip=60502&radiusMiles=50" +
        "&allowLive=true&forceLive=true&fetchReason=user_requested_listings_refresh&sourceScreen=listingsScreen&action=listingsRefresh",
      headers: authHeaders(),
    });
    const listingsBody = parseJson<any>(listingsResponse);

    assert.equal(listingsResponse.statusCode, 200);
    assert.equal(listingsBody.success, true);
    assert.equal(listingsProviderCalled, true);
  });

  test("stable vehicle unlock succeeds and descriptor market access uses the same key", async () => {
    let valueProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      valueProvider: {
        async getValuation(input) {
          valueProviderCalled = true;
          return {
            id: `valuation-${input.vehicleId}`,
            vehicleId: input.vehicleId,
            zip: input.zip,
            mileage: input.mileage,
            condition: input.condition as any,
            tradeIn: 26000,
            privateParty: 28500,
            dealerRetail: 30900,
            currency: "USD",
            generatedAt: new Date().toISOString(),
            sourceLabel: "Based on market data",
            modelType: "provider_range",
          };
        },
      },
    });

    const unlockResponse = await requestApp({
      method: "POST",
      url: "/api/unlocks/use",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        vehicleId: "2021-cadillac-ct4-premium-luxury",
        year: 2021,
        make: "Cadillac",
        model: "CT4",
        trim: "Premium Luxury",
        vehicleType: "car",
      }),
    });
    const unlockBody = parseJson<any>(unlockResponse);

    assert.equal(unlockResponse.statusCode, 200);
    assert.equal(unlockBody.success, true);
    assert.equal(unlockBody.data.entitlement.allowed, true);
    assert.equal(unlockBody.data.entitlement.usedUnlock, true);

    const valueResponse = await requestApp({
      method: "GET",
      url:
        "/api/vehicle/value?year=2021&make=Cadillac&model=CT4&trim=Premium%20Luxury&vehicleType=car&zip=60502&mileage=12000&condition=good" +
        "&allowLive=true&forceLive=true&fetchReason=user_requested_value_refresh&sourceScreen=valueScreen&action=valueRefresh",
      headers: authHeaders(),
    });
    const valueBody = parseJson<any>(valueResponse);

    assert.equal(valueResponse.statusCode, 200);
    assert.equal(valueBody.success, true);
    assert.equal(valueProviderCalled, true);
  });

  test("descriptor-only unlock succeeds without a catalog vehicle id", async () => {
    const unlockResponse = await requestApp({
      method: "POST",
      url: "/api/unlocks/use",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        year: 2016,
        make: "Mercedes-Benz",
        model: "C-Class",
        trim: "C 300",
        vehicleType: "car",
        bodyStyle: "Coupe",
      }),
    });
    const unlockBody = parseJson<any>(unlockResponse);

    assert.equal(unlockResponse.statusCode, 200);
    assert.equal(unlockBody.success, true);
    assert.equal(unlockBody.data.entitlement.allowed, true);
    assert.equal(unlockBody.data.entitlement.usedUnlock, true);

    const listingsResponse = await requestApp({
      method: "GET",
      url:
        "/api/vehicle/listings?year=2016&make=Mercedes-Benz&model=C-Class&trim=C%20300&vehicleType=car&zip=30563&radiusMiles=50" +
        "&allowLive=true&forceLive=true&fetchReason=user_requested_listings_refresh&sourceScreen=listingsScreen&action=listingsRefresh",
      headers: authHeaders(),
    });
    const listingsBody = parseJson<any>(listingsResponse);

    assert.equal(listingsResponse.statusCode, 200);
    assert.equal(listingsBody.success, true);
  });

  test("free user with no unlocks receives a no-credit response instead of a grant failure", async () => {
    for (const model of ["CT4", "CT5", "ATS"]) {
      const response = await requestApp({
        method: "POST",
        url: "/api/unlocks/use",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          year: 2021,
          make: "Cadillac",
          model,
          trim: "Premium Luxury",
          vehicleType: "car",
        }),
      });
      assert.equal(response.statusCode, 200);
    }

    const exhaustedResponse = await requestApp({
      method: "POST",
      url: "/api/unlocks/use",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        year: 2021,
        make: "Cadillac",
        model: "XT4",
        trim: "Sport",
        vehicleType: "car",
      }),
    });
    const exhaustedBody = parseJson<any>(exhaustedResponse);

    assert.equal(exhaustedResponse.statusCode, 200);
    assert.equal(exhaustedBody.success, true);
    assert.equal(exhaustedBody.data.entitlement.allowed, false);
    assert.equal(exhaustedBody.data.entitlement.reason, "no_free_unlocks");
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
