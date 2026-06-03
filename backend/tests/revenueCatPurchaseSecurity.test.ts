import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import inject from "light-my-request";
import type { InjectOptions, Response } from "light-my-request";
import { createApp } from "../src/app.js";
import { revenueCatProductIds } from "../src/services/subscriptionService.js";
import { setProviders } from "../src/lib/providerRegistry.js";
import { setRepositories } from "../src/lib/repositoryRegistry.js";
import { createTestProviders, createTestRepositories } from "./helpers/testData.js";

const WEBHOOK_AUTH = `Bearer ${process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN ?? "local-dev-revenuecat-webhook-token"}`;

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

function revenueCatPayload(input: {
  id: string;
  type: string;
  appUserId?: string;
  originalAppUserId?: string;
  aliases?: string[];
  productId: string;
  transactionId?: string;
  expirationAtMs?: number | null;
  cancelReason?: string;
}) {
  return {
    api_version: "1.0",
    event: {
      id: input.id,
      type: input.type,
      app_user_id: input.appUserId ?? "demo-user",
      original_app_user_id: input.originalAppUserId,
      aliases: input.aliases,
      product_id: input.productId,
      transaction_id: input.transactionId ?? `tx-${input.id}`,
      original_transaction_id: input.transactionId ?? `tx-${input.id}`,
      event_timestamp_ms: Date.now(),
      purchased_at_ms: Date.now(),
      expiration_at_ms: input.expirationAtMs ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
      cancel_reason: input.cancelReason,
      environment: "SANDBOX",
      store: "APP_STORE",
    },
  };
}

describe("RevenueCat purchase security", () => {
  beforeEach(() => {
    setProviders(createTestProviders());
  });

  test("forged client productId cannot grant Pro", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: revenueCatProductIds.yearlyPro,
        receiptData: "client-supplied-receipt-should-not-grant",
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.plan, "free");
    assert.equal(state.subscriptions.some((subscription) => subscription.plan === "pro_yearly"), false);
  });

  test("forged client productId cannot grant unlock pack credits", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: revenueCatProductIds.unlockPack5,
        receiptData: "client-supplied-unlock-pack-receipt",
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(state.unlockBalances.find((entry) => entry.userId === "demo-user")?.unlockCredits ?? 0, 0);
  });

  test("RevenueCat webhook without the configured authorization secret cannot grant access", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: "Bearer wrong-token" },
      payload: revenueCatPayload({
        id: "event-unauthorized",
        type: "INITIAL_PURCHASE",
        productId: revenueCatProductIds.yearlyPro,
        transactionId: "tx-unauthorized",
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 401);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "REVENUECAT_WEBHOOK_UNAUTHORIZED");
    assert.equal(state.subscriptions.some((subscription) => subscription.plan === "pro_yearly"), false);
  });

  test("verified monthly and yearly RevenueCat events grant Pro", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    for (const [productId, expectedPlan] of [
      [revenueCatProductIds.monthlyPro, "pro_monthly"],
      [revenueCatProductIds.yearlyPro, "pro_yearly"],
    ] as const) {
      const response = await requestApp({
        method: "POST",
        url: "/api/revenuecat/webhook",
        headers: { authorization: WEBHOOK_AUTH },
        payload: revenueCatPayload({
          id: `event-${expectedPlan}`,
          type: "INITIAL_PURCHASE",
          productId,
          transactionId: `tx-${expectedPlan}`,
        }),
      });
      const body = parseJson<any>(response);

      assert.equal(response.statusCode, 200);
      assert.equal(body.success, true);
      assert.equal(body.data.action, "pro_granted");
      assert.equal(state.subscriptions[0].plan, expectedPlan);
    }
  });

  test("expired or refunded subscription event removes Pro access", async () => {
    const { state, repositories } = createTestRepositories({
      subscriptions: [
        {
          id: "sub-active",
          userId: "demo-user",
          plan: "pro_yearly",
          status: "active",
          productId: revenueCatProductIds.yearlyPro,
          expiresAt: new Date(Date.now() + 1000000).toISOString(),
          verifiedAt: new Date().toISOString(),
        },
      ],
    });
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-expired",
        type: "EXPIRATION",
        productId: revenueCatProductIds.yearlyPro,
        transactionId: "tx-expired",
        expirationAtMs: Date.now() - 1000,
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.action, "pro_revoked");
    assert.equal(state.subscriptions[0].plan, "free");
  });

  test("verified unlock pack credits exactly 5 and duplicate events do not double-credit", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    for (const eventId of ["event-unlock-pack", "event-unlock-pack-duplicate-transaction"]) {
      const response = await requestApp({
        method: "POST",
        url: "/api/revenuecat/webhook",
        headers: { authorization: WEBHOOK_AUTH },
        payload: revenueCatPayload({
          id: eventId,
          type: "NON_RENEWING_PURCHASE",
          productId: revenueCatProductIds.unlockPack5,
          transactionId: "tx-unlock-pack",
          expirationAtMs: null,
        }),
      });
      assert.equal(response.statusCode, 200);
    }

    assert.equal(state.unlockBalances.find((entry) => entry.userId === "demo-user")?.unlockCredits ?? 0, 5);
    assert.equal(
      state.revenueCatEvents.filter((event) => event.transactionId === "tx-unlock-pack" && event.processedAction === "unlock_pack_credited")
        .length,
      1,
    );
  });

  test("guest RevenueCat unlock pack event cannot create orphaned credits", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-guest-unlock-pack",
        type: "NON_RENEWING_PURCHASE",
        appUserId: "guest_test_purchase",
        productId: revenueCatProductIds.unlockPack5,
        transactionId: "tx-guest-unlock-pack",
        expirationAtMs: null,
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "ignored");
    assert.equal(state.unlockBalances.find((entry) => entry.userId === "guest_test_purchase")?.unlockCredits ?? 0, 0);
    assert.equal(state.revenueCatEvents.find((event) => event.id === "event-guest-unlock-pack")?.userId, null);
  });

  test("RevenueCat signed-in alias is credited instead of guest app user id", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-aliased-unlock-pack",
        type: "NON_RENEWING_PURCHASE",
        appUserId: "guest_before_login",
        aliases: ["demo-user"],
        productId: revenueCatProductIds.unlockPack5,
        transactionId: "tx-aliased-unlock-pack",
        expirationAtMs: null,
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "unlock_pack_credited");
    assert.equal(state.unlockBalances.find((entry) => entry.userId === "demo-user")?.unlockCredits ?? 0, 5);
    assert.equal(state.unlockBalances.find((entry) => entry.userId === "guest_before_login")?.unlockCredits ?? 0, 0);
    assert.equal(state.revenueCatEvents.find((event) => event.id === "event-aliased-unlock-pack")?.userId, "demo-user");
  });

  test("unlock pack refund removes remaining paid credits without going negative", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-unlock-purchase",
        type: "NON_RENEWING_PURCHASE",
        productId: revenueCatProductIds.unlockPack5,
        transactionId: "tx-refund-pack",
        expirationAtMs: null,
      }),
    });

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-unlock-refund",
        type: "CANCELLATION",
        productId: revenueCatProductIds.unlockPack5,
        transactionId: "tx-refund-pack",
        expirationAtMs: null,
        cancelReason: "CUSTOMER_SUPPORT",
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "unlock_pack_revoked");
    assert.equal(state.unlockBalances.find((entry) => entry.userId === "demo-user")?.unlockCredits ?? 0, 0);
  });

  test("premium provider access remains blocked without verified entitlement or unlock", async () => {
    const { repositories } = createTestRepositories();
    setRepositories(repositories);
    let valueProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      valueProvider: {
        async getValuation() {
          valueProviderCalled = true;
          throw new Error("Provider should not be called before verified access.");
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

    assert.equal(response.statusCode, 403);
    assert.equal(valueProviderCalled, false);
  });
});
