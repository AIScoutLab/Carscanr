import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import inject from "light-my-request";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InjectOptions, Response } from "light-my-request";
import { createApp } from "../src/app.js";
import {
  revenueCatProductIdAliases,
  revenueCatProductIds,
  setRevenueCatRestApiKeyForTests,
  setRevenueCatSubscriberFetcherForTests,
} from "../src/services/subscriptionService.js";
import { setProviders } from "../src/lib/providerRegistry.js";
import { setRepositories } from "../src/lib/repositoryRegistry.js";
import { createTestProviders, createTestRepositories } from "./helpers/testData.js";

const WEBHOOK_AUTH = `Bearer ${process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN ?? "local-dev-revenuecat-webhook-token"}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const SIGNED_IN_USER_ID = "11111111-1111-4111-8111-111111111111";
const LIVE_PRODUCT_IDS = {
  monthlyPro: "carscanr.pro.monthly",
  unlockPack5: "carscanr.unlockpack.5",
} as const;

function parseJson<T>(response: Response): T {
  return JSON.parse(response.payload) as T;
}

async function requestApp(options: InjectOptions): Promise<Response> {
  const app = createApp();
  return inject(app as any, options);
}

function authHeaders(userId = SIGNED_IN_USER_ID, email = "demo@example.com") {
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
  originalTransactionId?: string;
  environment?: string;
  expirationAtMs?: number | null;
  cancelReason?: string;
}) {
  return {
    api_version: "1.0",
    event: {
      id: input.id,
      type: input.type,
      app_user_id: input.appUserId ?? SIGNED_IN_USER_ID,
      original_app_user_id: input.originalAppUserId,
      aliases: input.aliases,
      product_id: input.productId,
      transaction_id: input.transactionId ?? `tx-${input.id}`,
      original_transaction_id: input.originalTransactionId ?? input.transactionId ?? `tx-${input.id}`,
      event_timestamp_ms: Date.now(),
      purchased_at_ms: Date.now(),
      expiration_at_ms: input.expirationAtMs ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
      cancel_reason: input.cancelReason,
      environment: input.environment ?? "SANDBOX",
      store: "APP_STORE",
    },
  };
}

function revenueCatSubscriberPayload(input: {
  userId?: string;
  productId?: string | null;
  expiresAt?: string | null;
  entitlementId?: string;
  aliases?: string[];
}) {
  const productId = Object.prototype.hasOwnProperty.call(input, "productId") ? input.productId : LIVE_PRODUCT_IDS.monthlyPro;
  return {
    subscriber: {
      original_app_user_id: input.userId ?? SIGNED_IN_USER_ID,
      aliases: input.aliases ?? [],
      entitlements: productId
        ? {
            [input.entitlementId ?? "Carscanr Pro"]: {
              product_identifier: productId,
              expires_date: input.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              purchase_date: new Date().toISOString(),
            },
          }
        : {},
      subscriptions: productId
        ? {
            [productId]: {
              product_identifier: productId,
              expires_date: input.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              purchase_date: new Date().toISOString(),
            },
          }
        : {},
    },
  };
}

describe("RevenueCat purchase security", () => {
  beforeEach(() => {
    setProviders(createTestProviders());
    setRevenueCatRestApiKeyForTests(null);
    setRevenueCatSubscriberFetcherForTests(null);
  });

  test("subscription plan migration accepts monthly and yearly Pro variants", () => {
    const migration = fs.readFileSync(
      path.join(backendRoot, "supabase/migrations/019_allow_subscription_plan_variants.sql"),
      "utf8",
    );

    assert.match(migration, /plan in \('free', 'pro', 'pro_monthly', 'pro_yearly'\)/);
    assert.match(migration, /drop constraint/i);
    assert.match(migration, /validate constraint subscriptions_plan_check/i);
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
    assert.equal(state.unlockBalances.find((entry) => entry.userId === SIGNED_IN_USER_ID)?.unlockCredits ?? 0, 0);
  });

  test("server RevenueCat sync grants active monthly Pro entitlement", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async ({ appUserId }) => {
      assert.equal(appUserId, SIGNED_IN_USER_ID);
      return revenueCatSubscriberPayload({ productId: LIVE_PRODUCT_IDS.monthlyPro });
    });

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: "client-cannot-pick-plan",
        receiptData: "client-data-is-not-proof",
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.plan, "pro_monthly");
    assert.equal(body.data.status, "active");
    assert.equal(body.data.productId, LIVE_PRODUCT_IDS.monthlyPro);
    assert.equal(state.subscriptions[0].plan, "pro_monthly");
    assert.equal(state.subscriptions[0].userId, SIGNED_IN_USER_ID);
  });

  test("server RevenueCat sync grants active yearly Pro entitlement", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async () =>
      revenueCatSubscriberPayload({ productId: "carscanr.pro.yearly" }),
    );

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        receiptData: "client-data-is-not-proof",
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.plan, "pro_yearly");
    assert.equal(body.data.productId, "carscanr.pro.yearly");
    assert.equal(state.subscriptions[0].plan, "pro_yearly");
  });

  test("server RevenueCat sync does not grant without active Pro entitlement", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async () => revenueCatSubscriberPayload({ productId: null }));

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        receiptData: "client-data-is-not-proof",
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.plan, "free");
    assert.equal(state.subscriptions.some((subscription) => subscription.plan !== "free"), false);
  });

  test("server RevenueCat sync grants active Pro under candidate ID when RevenueCat aliases include auth user", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async ({ appUserId }) => {
      if (appUserId === SIGNED_IN_USER_ID) {
        return revenueCatSubscriberPayload({ productId: null, aliases: ["guest_purchase_profile"] });
      }
      assert.equal(appUserId, "guest_purchase_profile");
      return revenueCatSubscriberPayload({
        userId: "guest_purchase_profile",
        aliases: [SIGNED_IN_USER_ID],
        productId: LIVE_PRODUCT_IDS.monthlyPro,
      });
    });

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        receiptData: "client-data-is-not-proof",
        revenueCatIdentity: {
          currentAppUserId: SIGNED_IN_USER_ID,
          originalAppUserId: "guest_purchase_profile",
          aliases: ["guest_purchase_profile"],
          activeProductIds: [LIVE_PRODUCT_IDS.monthlyPro],
        },
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.plan, "pro_monthly");
    assert.equal(body.data.revenueCatSync.status, "granted");
    assert.equal(state.subscriptions[0].userId, SIGNED_IN_USER_ID);
  });

  test("server RevenueCat sync grants active Pro under anonymous candidate tied by trusted webhook history", async () => {
    const anonymousAppUserId = "$RCAnonymousID:active-sandbox-profile";
    const { state, repositories } = createTestRepositories({
      revenueCatEvents: [
        {
          id: "event-anonymous-aliased-monthly",
          appUserId: anonymousAppUserId,
          userId: SIGNED_IN_USER_ID,
          eventType: "INITIAL_PURCHASE",
          productId: LIVE_PRODUCT_IDS.monthlyPro,
          transactionId: "tx-anonymous-aliased-monthly",
          originalTransactionId: "original-anonymous-aliased-monthly",
          processed: true,
          processedAction: "pro_granted",
          payloadSummary: { aliases: [SIGNED_IN_USER_ID] },
          createdAt: new Date().toISOString(),
          processedAt: new Date().toISOString(),
        },
      ],
    });
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async ({ appUserId }) => {
      if (appUserId === SIGNED_IN_USER_ID) {
        return revenueCatSubscriberPayload({ productId: null });
      }
      assert.equal(appUserId, anonymousAppUserId);
      return revenueCatSubscriberPayload({
        userId: anonymousAppUserId,
        productId: LIVE_PRODUCT_IDS.monthlyPro,
      });
    });

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        receiptData: "client-data-is-not-proof",
        revenueCatIdentity: {
          currentAppUserId: SIGNED_IN_USER_ID,
          originalAppUserId: anonymousAppUserId,
        },
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.plan, "pro_monthly");
    assert.equal(body.data.revenueCatSync.status, "granted");
    assert.equal(state.subscriptions[0].userId, SIGNED_IN_USER_ID);
  });

  test("server RevenueCat sync does not grant active Pro under unrelated candidate app user id", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async ({ appUserId }) => {
      if (appUserId === SIGNED_IN_USER_ID) {
        return revenueCatSubscriberPayload({ productId: null });
      }
      assert.equal(appUserId, "22222222-2222-4222-8222-222222222222");
      return revenueCatSubscriberPayload({
        userId: "22222222-2222-4222-8222-222222222222",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
      });
    });

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        receiptData: "client-data-is-not-proof",
        revenueCatIdentity: {
          currentAppUserId: SIGNED_IN_USER_ID,
          originalAppUserId: "22222222-2222-4222-8222-222222222222",
        },
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.plan, "free");
    assert.equal(body.data.revenueCatSync.status, "denied");
    assert.equal(body.data.revenueCatSync.reason, "revenuecat_orphaned_subscription");
    assert.equal(state.subscriptions.some((subscription) => subscription.userId === SIGNED_IN_USER_ID), false);
  });

  test("server RevenueCat sync does not grant expired entitlement", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async () =>
      revenueCatSubscriberPayload({
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
      }),
    );

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        receiptData: "client-data-is-not-proof",
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.plan, "free");
    assert.equal(state.subscriptions.some((subscription) => subscription.plan !== "free"), false);
  });

  test("server RevenueCat sync does not revoke existing active backend Pro on identity mismatch", async () => {
    const existingExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { state, repositories } = createTestRepositories({
      subscriptions: [
        {
          id: "sub-existing-pro",
          userId: SIGNED_IN_USER_ID,
          plan: "pro_monthly",
          status: "active",
          productId: LIVE_PRODUCT_IDS.monthlyPro,
          expiresAt: existingExpiration,
          verifiedAt: new Date().toISOString(),
        },
      ],
    });
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async ({ appUserId }) => {
      if (appUserId === SIGNED_IN_USER_ID) {
        return revenueCatSubscriberPayload({ productId: null });
      }
      return revenueCatSubscriberPayload({
        userId: "unrelated-revenuecat-user",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
      });
    });

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(),
      payload: {
        platform: "ios",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        receiptData: "client-data-is-not-proof",
        revenueCatIdentity: {
          originalAppUserId: "unrelated-revenuecat-user",
        },
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.plan, "pro_monthly");
    assert.equal(body.data.status, "active");
    assert.equal(body.data.revenueCatSync.status, "denied");
    assert.equal(state.subscriptions.find((subscription) => subscription.id === "sub-existing-pro")?.status, "active");
  });

  test("server RevenueCat sync refreshes existing active subscription row", async () => {
    const refreshUserId = "33333333-3333-4333-8333-333333333333";
    const refreshedExpiration = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const { state, repositories } = createTestRepositories({
      subscriptions: [
        {
          id: "sub-existing",
          userId: refreshUserId,
          plan: "pro_monthly",
          status: "active",
          productId: LIVE_PRODUCT_IDS.monthlyPro,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          verifiedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });
    setRepositories(repositories);
    setRevenueCatRestApiKeyForTests("test-revenuecat-rest-key");
    setRevenueCatSubscriberFetcherForTests(async () =>
      revenueCatSubscriberPayload({
        userId: refreshUserId,
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        expiresAt: refreshedExpiration,
      }),
    );

    const response = await requestApp({
      method: "POST",
      url: "/api/subscription/verify",
      headers: authHeaders(refreshUserId, "refresh@example.com"),
      payload: {
        platform: "ios",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        receiptData: "client-data-is-not-proof",
      },
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.plan, "pro_monthly");
    assert.equal(body.data.expiresAt, refreshedExpiration);
    assert.equal(state.subscriptions[0].status, "active");
    assert.equal(state.subscriptions[0].expiresAt, refreshedExpiration);
    assert.equal(state.subscriptions.length, 1);
    assert.notEqual(state.subscriptions[0].id, "sub-existing");
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
      assert.equal(state.subscriptions[0].userId, SIGNED_IN_USER_ID);
    }
  });

  test("live App Store RevenueCat product ids grant the expected paid access", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const monthlyResponse = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-live-monthly-pro",
        type: "INITIAL_PURCHASE",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        transactionId: "tx-live-monthly-pro",
      }),
    });
    const monthlyBody = parseJson<any>(monthlyResponse);

    assert.equal(monthlyResponse.statusCode, 200);
    assert.equal(monthlyBody.data.action, "pro_granted");
    assert.equal(state.subscriptions[0].plan, "pro_monthly");
    assert.equal(state.subscriptions[0].productId, LIVE_PRODUCT_IDS.monthlyPro);

    const yearlyResponse = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-compatible-yearly-pro",
        type: "INITIAL_PURCHASE",
        productId: revenueCatProductIds.yearlyPro,
        transactionId: "tx-compatible-yearly-pro",
      }),
    });
    const yearlyBody = parseJson<any>(yearlyResponse);

    assert.equal(yearlyResponse.statusCode, 200);
    assert.equal(yearlyBody.data.action, "pro_granted");
    assert.equal(state.subscriptions[0].plan, "pro_yearly");
    assert.equal(state.subscriptions[0].productId, revenueCatProductIds.yearlyPro);

    const unlockResponse = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-live-unlock-pack",
        type: "NON_RENEWING_PURCHASE",
        productId: LIVE_PRODUCT_IDS.unlockPack5,
        transactionId: "tx-live-unlock-pack",
        expirationAtMs: null,
      }),
    });
    const unlockBody = parseJson<any>(unlockResponse);

    assert.equal(unlockResponse.statusCode, 200);
    assert.equal(unlockBody.data.action, "unlock_pack_credited");
    assert.equal(state.unlockBalances.find((entry) => entry.userId === SIGNED_IN_USER_ID)?.unlockCredits ?? 0, 5);
  });

  test("sandbox renewal without prior same-user subscription grant is ignored", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-stray-sandbox-renewal",
        type: "RENEWAL",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        transactionId: "tx-stray-sandbox-renewal",
        originalTransactionId: "original-shared-sandbox-subscription",
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "ignored");
    assert.equal(state.subscriptions.some((subscription) => subscription.plan !== "free"), false);
    assert.equal(state.revenueCatEvents.find((event) => event.id === "event-stray-sandbox-renewal")?.processedAction, "ignored");
  });

  test("sandbox initial purchase grants Pro and later same-user renewal extends it", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const originalTransactionId = "original-owned-sandbox-subscription";
    const initialResponse = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-owned-sandbox-initial",
        type: "INITIAL_PURCHASE",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        transactionId: "tx-owned-sandbox-initial",
        originalTransactionId,
        expirationAtMs: Date.now() + 5 * 60 * 1000,
      }),
    });
    const initialBody = parseJson<any>(initialResponse);

    assert.equal(initialResponse.statusCode, 200);
    assert.equal(initialBody.data.action, "pro_granted");
    assert.equal(state.subscriptions[0].plan, "pro_monthly");

    const renewalExpirationMs = Date.now() + 60 * 60 * 1000;
    const renewalResponse = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-owned-sandbox-renewal",
        type: "RENEWAL",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        transactionId: "tx-owned-sandbox-renewal",
        originalTransactionId,
        expirationAtMs: renewalExpirationMs,
      }),
    });
    const renewalBody = parseJson<any>(renewalResponse);

    assert.equal(renewalResponse.statusCode, 200);
    assert.equal(renewalBody.data.action, "pro_granted");
    assert.equal(state.subscriptions[0].plan, "pro_monthly");
    assert.equal(state.subscriptions[0].expiresAt, new Date(renewalExpirationMs).toISOString());
  });

  test("sandbox renewal after a manual reset to free does not reactivate Pro", async () => {
    const originalTransactionId = "original-reset-sandbox-subscription";
    const { state, repositories } = createTestRepositories({
      subscriptions: [
        {
          id: "sub-reset-free",
          userId: SIGNED_IN_USER_ID,
          plan: "free",
          status: "active",
          productId: null,
          verifiedAt: new Date().toISOString(),
        },
      ],
      unlockBalances: [
        {
          userId: SIGNED_IN_USER_ID,
          freeUnlocksTotal: 3,
          freeUnlocksUsed: 3,
          unlockCredits: 5,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      revenueCatEvents: [
        {
          id: "event-reset-prior-grant",
          appUserId: SIGNED_IN_USER_ID,
          userId: SIGNED_IN_USER_ID,
          eventType: "RENEWAL",
          productId: LIVE_PRODUCT_IDS.monthlyPro,
          transactionId: "tx-reset-prior-grant",
          originalTransactionId,
          processed: true,
          processedAction: "pro_granted",
          payloadSummary: { environment: "SANDBOX" },
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          processedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-reset-sandbox-renewal",
        type: "RENEWAL",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        transactionId: "tx-reset-sandbox-renewal",
        originalTransactionId,
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "ignored");
    assert.equal(state.subscriptions.find((subscription) => subscription.status === "active")?.plan, "free");
    assert.equal(state.unlockBalances.find((entry) => entry.userId === SIGNED_IN_USER_ID)?.unlockCredits, 5);
    assert.equal(state.revenueCatEvents.find((event) => event.id === "event-reset-sandbox-renewal")?.processedAction, "ignored");
  });

  test("sandbox renewal for unrelated original transaction does not grant a fresh user Pro", async () => {
    const unrelatedUserId = "22222222-2222-4222-8222-222222222222";
    const { state, repositories } = createTestRepositories({
      revenueCatEvents: [
        {
          id: "event-original-owner-initial",
          appUserId: unrelatedUserId,
          userId: unrelatedUserId,
          eventType: "INITIAL_PURCHASE",
          productId: LIVE_PRODUCT_IDS.monthlyPro,
          transactionId: "tx-original-owner-initial",
          originalTransactionId: "original-transferred-sandbox-subscription",
          processed: true,
          processedAction: "pro_granted",
          payloadSummary: { environment: "SANDBOX" },
          createdAt: new Date().toISOString(),
          processedAt: new Date().toISOString(),
        },
      ],
    });
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-fresh-user-transferred-renewal",
        type: "RENEWAL",
        productId: LIVE_PRODUCT_IDS.monthlyPro,
        transactionId: "tx-fresh-user-transferred-renewal",
        originalTransactionId: "original-transferred-sandbox-subscription",
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "ignored");
    assert.equal(state.subscriptions.some((subscription) => subscription.userId === SIGNED_IN_USER_ID), false);
  });

  test("production renewal remains allowed for store-originated renewal webhooks", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-production-renewal",
        type: "RENEWAL",
        productId: revenueCatProductIds.yearlyPro,
        transactionId: "tx-production-renewal",
        originalTransactionId: "original-production-subscription",
        environment: "PRODUCTION",
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "pro_granted");
    assert.equal(state.subscriptions[0].plan, "pro_yearly");
  });

  test("live unlock pack product credits exactly 5 without creating a subscription", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-live-unlock-pack-only",
        type: "NON_RENEWING_PURCHASE",
        productId: LIVE_PRODUCT_IDS.unlockPack5,
        transactionId: "tx-live-unlock-pack-only",
        expirationAtMs: null,
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "unlock_pack_credited");
    assert.equal(state.subscriptions.length, 0);
    assert.equal(state.unlockBalances.find((entry) => entry.userId === SIGNED_IN_USER_ID)?.unlockCredits ?? 0, 5);
  });

  test("unknown RevenueCat products are still ignored", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-unknown-product",
        type: "INITIAL_PURCHASE",
        productId: "carscanr.experimental.unknown",
        transactionId: "tx-unknown-product",
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "ignored");
    assert.equal(state.subscriptions.some((subscription) => subscription.plan !== "free"), false);
    assert.equal(state.unlockBalances.find((entry) => entry.userId === SIGNED_IN_USER_ID)?.unlockCredits ?? 0, 0);
  });

  test("RevenueCat reprocess coverage includes live and compatible product id aliases", () => {
    assert.deepEqual(revenueCatProductIdAliases.monthlyPro, [revenueCatProductIds.monthlyPro, LIVE_PRODUCT_IDS.monthlyPro]);
    assert.deepEqual(revenueCatProductIdAliases.yearlyPro, [revenueCatProductIds.yearlyPro, "carscanr.pro.yearly"]);
    assert.deepEqual(revenueCatProductIdAliases.unlockPack5, [revenueCatProductIds.unlockPack5, LIVE_PRODUCT_IDS.unlockPack5]);
  });

  test("verified monthly RevenueCat event grants live value access", async () => {
    const { repositories } = createTestRepositories();
    setRepositories(repositories);
    let valueProviderCalled = false;
    setProviders({
      ...createTestProviders(),
      valueProvider: {
        async getValuation(input) {
          valueProviderCalled = true;
          return {
            id: "valuation-monthly-pro-live",
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

    const webhookResponse = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-monthly-live-access",
        type: "INITIAL_PURCHASE",
        productId: revenueCatProductIds.monthlyPro,
        transactionId: "tx-monthly-live-access",
      }),
    });
    assert.equal(webhookResponse.statusCode, 200);

    const valueResponse = await requestApp({
      method: "GET",
      url:
        "/api/vehicle/value?vehicleId=2021-cadillac-ct4-premium-luxury&zip=60502&mileage=12000&condition=good" +
        "&allowLive=true&forceLive=true&fetchReason=user_requested_value_refresh&sourceScreen=valueScreen&action=valueRefresh",
      headers: authHeaders(),
    });
    const valueBody = parseJson<any>(valueResponse);

    assert.equal(valueResponse.statusCode, 200);
    assert.equal(valueBody.success, true);
    assert.equal(valueProviderCalled, true);
  });

  test("expired or refunded subscription event removes Pro access", async () => {
    const { state, repositories } = createTestRepositories({
      subscriptions: [
        {
          id: "sub-active",
          userId: SIGNED_IN_USER_ID,
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

    assert.equal(state.unlockBalances.find((entry) => entry.userId === SIGNED_IN_USER_ID)?.unlockCredits ?? 0, 5);
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
        aliases: [SIGNED_IN_USER_ID],
        productId: revenueCatProductIds.unlockPack5,
        transactionId: "tx-aliased-unlock-pack",
        expirationAtMs: null,
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "unlock_pack_credited");
    assert.equal(state.unlockBalances.find((entry) => entry.userId === SIGNED_IN_USER_ID)?.unlockCredits ?? 0, 5);
    assert.equal(state.unlockBalances.find((entry) => entry.userId === "guest_before_login")?.unlockCredits ?? 0, 0);
    assert.equal(state.revenueCatEvents.find((event) => event.id === "event-aliased-unlock-pack")?.userId, SIGNED_IN_USER_ID);
  });

  test("RevenueCat anonymous app user id cannot create subscriptions or paid credits", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const subscriptionResponse = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-anonymous-monthly",
        type: "INITIAL_PURCHASE",
        appUserId: "$RCAnonymousID:anonymous-monthly",
        productId: revenueCatProductIds.monthlyPro,
        transactionId: "tx-anonymous-monthly",
      }),
    });
    const subscriptionBody = parseJson<any>(subscriptionResponse);

    assert.equal(subscriptionResponse.statusCode, 200);
    assert.equal(subscriptionBody.data.action, "ignored");
    assert.equal(state.subscriptions.some((subscription) => subscription.userId === "$RCAnonymousID:anonymous-monthly"), false);
    assert.equal(state.revenueCatEvents.find((event) => event.id === "event-anonymous-monthly")?.userId, null);

    const unlockResponse = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-anonymous-unlock-pack",
        type: "NON_RENEWING_PURCHASE",
        appUserId: "$RCAnonymousID:anonymous-unlock-pack",
        productId: revenueCatProductIds.unlockPack5,
        transactionId: "tx-anonymous-unlock-pack",
        expirationAtMs: null,
      }),
    });
    const unlockBody = parseJson<any>(unlockResponse);

    assert.equal(unlockResponse.statusCode, 200);
    assert.equal(unlockBody.data.action, "ignored");
    assert.equal(state.unlockBalances.find((entry) => entry.userId === "$RCAnonymousID:anonymous-unlock-pack")?.unlockCredits ?? 0, 0);
    assert.equal(state.revenueCatEvents.find((event) => event.id === "event-anonymous-unlock-pack")?.userId, null);
  });

  test("RevenueCat Supabase alias is preferred over anonymous app user id", async () => {
    const { state, repositories } = createTestRepositories();
    setRepositories(repositories);

    const response = await requestApp({
      method: "POST",
      url: "/api/revenuecat/webhook",
      headers: { authorization: WEBHOOK_AUTH },
      payload: revenueCatPayload({
        id: "event-anonymous-aliased-monthly",
        type: "INITIAL_PURCHASE",
        appUserId: "$RCAnonymousID:anonymous-before-login",
        aliases: [SIGNED_IN_USER_ID],
        productId: revenueCatProductIds.monthlyPro,
        transactionId: "tx-anonymous-aliased-monthly",
      }),
    });
    const body = parseJson<any>(response);

    assert.equal(response.statusCode, 200);
    assert.equal(body.data.action, "pro_granted");
    assert.equal(state.subscriptions[0].userId, SIGNED_IN_USER_ID);
    assert.equal(state.subscriptions[0].plan, "pro_monthly");
    assert.equal(state.revenueCatEvents.find((event) => event.id === "event-anonymous-aliased-monthly")?.userId, SIGNED_IN_USER_ID);
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
    assert.equal(state.unlockBalances.find((entry) => entry.userId === SIGNED_IN_USER_ID)?.unlockCredits ?? 0, 0);
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
