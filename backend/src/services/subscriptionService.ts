import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/appError.js";
import { isProPlan, normalizePlan } from "../lib/subscription.js";
import { logger } from "../lib/logger.js";
import { repositories } from "../lib/repositoryRegistry.js";
import { RevenueCatEventRecord, SubscriptionRecord, UserPlan } from "../types/domain.js";

const REVENUECAT_PRODUCT_IDS = {
  monthlyPro: "com.carscanr.pro.monthly",
  yearlyPro: "com.carscanr.pro.yearly",
  unlockPack5: "com.carscanr.unlock_pack_5",
} as const;

const REVENUECAT_PRODUCT_ID_ALIASES = {
  monthlyPro: [REVENUECAT_PRODUCT_IDS.monthlyPro, "carscanr.pro.monthly"],
  yearlyPro: [REVENUECAT_PRODUCT_IDS.yearlyPro, "carscanr.pro.yearly"],
  unlockPack5: [REVENUECAT_PRODUCT_IDS.unlockPack5, "carscanr.unlockpack.5"],
} as const;

const UNLOCK_PACK_CREDITS = 5;

type RevenueCatWebhookEvent = {
  id?: unknown;
  type?: unknown;
  app_user_id?: unknown;
  original_app_user_id?: unknown;
  aliases?: unknown;
  product_id?: unknown;
  new_product_id?: unknown;
  transaction_id?: unknown;
  original_transaction_id?: unknown;
  event_timestamp_ms?: unknown;
  expiration_at_ms?: unknown;
  purchased_at_ms?: unknown;
  cancel_reason?: unknown;
  expiration_reason?: unknown;
  environment?: unknown;
  store?: unknown;
};

type RevenueCatProcessResult = {
  eventId: string;
  action:
    | "duplicate"
    | "ignored"
    | "pro_granted"
    | "pro_revoked"
    | "unlock_pack_credited"
    | "unlock_pack_revoked";
  plan?: UserPlan;
};

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateFromMs(value: unknown) {
  const ms = asNumber(value);
  return ms ? new Date(ms).toISOString() : undefined;
}

function timingSafeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildFreeSubscription(userId: string): SubscriptionRecord {
  return {
    id: crypto.randomUUID(),
    userId,
    plan: "free",
    status: "active",
    verifiedAt: new Date().toISOString(),
  };
}

function extractRevenueCatEvent(payload: unknown): RevenueCatWebhookEvent {
  if (!payload || typeof payload !== "object") {
    throw new AppError(400, "REVENUECAT_PAYLOAD_INVALID", "RevenueCat webhook payload must be a JSON object.");
  }
  const event = (payload as { event?: unknown }).event ?? payload;
  if (!event || typeof event !== "object") {
    throw new AppError(400, "REVENUECAT_EVENT_INVALID", "RevenueCat webhook event is missing.");
  }
  return event as RevenueCatWebhookEvent;
}

function getProductPlan(productId: string | null): UserPlan | null {
  if (isRevenueCatProductId(productId, REVENUECAT_PRODUCT_ID_ALIASES.yearlyPro)) return "pro_yearly";
  if (isRevenueCatProductId(productId, REVENUECAT_PRODUCT_ID_ALIASES.monthlyPro)) return "pro_monthly";
  return null;
}

function isRevenueCatProductId(productId: string | null, aliases: readonly string[]) {
  return Boolean(productId && aliases.includes(productId));
}

function isSupabaseUserId(value: string | null) {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function isRevenueCatAnonymousAppUserId(value: string | null) {
  return Boolean(value && value.startsWith("$RCAnonymousID"));
}

function getAppUserId(event: RevenueCatWebhookEvent) {
  const appUserId = asString(event.app_user_id);
  const originalAppUserId = asString(event.original_app_user_id);
  const aliases = getRevenueCatAliases(event);
  const candidates = [appUserId, originalAppUserId, ...aliases].filter((candidate): candidate is string =>
    Boolean(candidate),
  );
  const supabaseAlias = aliases.find(isSupabaseUserId) ?? null;
  const supabaseCandidate = candidates.find(isSupabaseUserId) ?? null;
  if (supabaseAlias || supabaseCandidate) {
    return supabaseAlias ?? supabaseCandidate;
  }
  if (isRevenueCatAnonymousAppUserId(appUserId) || isRevenueCatAnonymousAppUserId(originalAppUserId)) {
    return appUserId ?? originalAppUserId;
  }
  return candidates.find((candidate) => !isGuestRevenueCatAppUserId(candidate)) ?? candidates[0] ?? null;
}

function isGuestRevenueCatAppUserId(value: string | null) {
  return Boolean(value && (value.startsWith("guest_") || value.startsWith("guest:") || isRevenueCatAnonymousAppUserId(value)));
}

function getRevenueCatCreditUserId(appUserId: string | null) {
  if (!appUserId || isGuestRevenueCatAppUserId(appUserId)) {
    return null;
  }
  return appUserId;
}

function getRevenueCatAliases(event: RevenueCatWebhookEvent) {
  if (Array.isArray(event.aliases)) {
    return event.aliases.map(asString).filter((alias): alias is string => Boolean(alias));
  }
  return [];
}

function summarizeEvent(event: RevenueCatWebhookEvent) {
  return {
    type: asString(event.type),
    environment: asString(event.environment),
    store: asString(event.store),
    cancelReason: asString(event.cancel_reason),
    expirationReason: asString(event.expiration_reason),
    eventTimestampMs: asNumber(event.event_timestamp_ms),
    purchasedAtMs: asNumber(event.purchased_at_ms),
    expirationAtMs: asNumber(event.expiration_at_ms),
  };
}

export class SubscriptionService {
  private verifyRevenueCatAuthorization(authorizationHeader?: string | null) {
    const expected = env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
    if (!expected) {
      logger.error({ reason: "token_not_configured" }, "REVENUECAT_WEBHOOK_AUTH_FAILED");
      throw new AppError(500, "REVENUECAT_WEBHOOK_NOT_CONFIGURED", "RevenueCat webhook authorization is not configured.");
    }

    const actual = authorizationHeader?.trim();
    if (!actual) {
      logger.warn({ reason: "missing_authorization_header" }, "REVENUECAT_WEBHOOK_AUTH_FAILED");
      throw new AppError(401, "REVENUECAT_WEBHOOK_UNAUTHORIZED", "RevenueCat webhook authorization is required.");
    }

    const acceptedValues = [`Bearer ${expected}`, expected];
    if (!acceptedValues.some((accepted) => timingSafeEqualText(actual, accepted))) {
      logger.warn({ reason: "invalid_authorization_header" }, "REVENUECAT_WEBHOOK_AUTH_FAILED");
      throw new AppError(401, "REVENUECAT_WEBHOOK_UNAUTHORIZED", "RevenueCat webhook authorization is invalid.");
    }

    logger.info({ authorizationHeaderPresent: true }, "REVENUECAT_WEBHOOK_AUTH_PASSED");
  }

  async getCurrentSubscription(userId: string): Promise<SubscriptionRecord> {
    const active = await repositories.subscriptions.findActiveByUser(userId);
    if (!active) {
      return buildFreeSubscription(userId);
    }

    if (isProPlan(active.plan) && active.expiresAt && new Date(active.expiresAt).getTime() <= Date.now()) {
      return repositories.subscriptions.replaceActiveForUser(buildFreeSubscription(userId));
    }

    return { ...active, plan: normalizePlan(active.plan) };
  }

  async getActivePlan(userId: string): Promise<UserPlan> {
    return (await this.getCurrentSubscription(userId)).plan;
  }

  async verifySubscription(input: {
    userId: string;
    platform: "ios";
    receiptData: string;
    productId: string;
  }): Promise<SubscriptionRecord> {
    void input.platform;
    void input.receiptData;
    void input.productId;
    return this.getCurrentSubscription(input.userId);
  }

  async cancelSubscription(userId: string): Promise<SubscriptionRecord> {
    return this.getCurrentSubscription(userId);
  }

  async processRevenueCatWebhook(input: {
    authorizationHeader?: string | null;
    payload: unknown;
  }): Promise<RevenueCatProcessResult> {
    logger.info(
      {
        authorizationHeaderPresent: Boolean(input.authorizationHeader),
        payloadObject: Boolean(input.payload && typeof input.payload === "object"),
        eventEnvelopePresent: Boolean(input.payload && typeof input.payload === "object" && "event" in input.payload),
      },
      "REVENUECAT_WEBHOOK_RECEIVED",
    );

    this.verifyRevenueCatAuthorization(input.authorizationHeader);

    const event = extractRevenueCatEvent(input.payload);
    const eventId = asString(event.id);
    const eventType = asString(event.type);
    if (!eventId) {
      throw new AppError(400, "REVENUECAT_EVENT_ID_MISSING", "RevenueCat webhook event id is required.");
    }
    if (!eventType) {
      throw new AppError(400, "REVENUECAT_EVENT_TYPE_MISSING", "RevenueCat webhook event type is required.");
    }

    const productId = asString(event.product_id) ?? asString(event.new_product_id);
    const transactionId = asString(event.transaction_id);
    const originalTransactionId = asString(event.original_transaction_id);
    const environment = asString(event.environment);
    const appUserId = getAppUserId(event);
    const userId = getRevenueCatCreditUserId(appUserId);

    logger.info(
      {
        eventId,
        eventType,
        productId,
        appUserIdPresent: Boolean(appUserId),
        revenueCatAliasCount: getRevenueCatAliases(event).length,
        signedInUserIdPresent: Boolean(userId),
        guestAppUserIdIgnored: Boolean(appUserId && !userId),
        transactionIdPresent: Boolean(transactionId),
      },
      "REVENUECAT_WEBHOOK_EVENT_PARSED",
    );

    const existingEvent = await repositories.revenueCatEvents.findById(eventId);
    if (existingEvent?.processed) {
      logger.info({ eventId, eventType, processedAction: existingEvent.processedAction }, "REVENUECAT_WEBHOOK_DUPLICATE");
      return { eventId, action: "duplicate" };
    }
    if (!existingEvent) {
      logger.info({ eventId, eventType }, "REVENUECAT_EVENT_INSERT_ATTEMPT");
      const createdEvent = await repositories.revenueCatEvents.create({
        id: eventId,
        appUserId,
        userId,
        eventType,
        productId,
        transactionId,
        originalTransactionId,
        processed: false,
        processedAction: null,
        payloadSummary: summarizeEvent(event),
        createdAt: new Date().toISOString(),
        processedAt: null,
      });
      logger.info({ eventId: createdEvent.id, eventType: createdEvent.eventType }, "REVENUECAT_EVENT_INSERT_SUCCEEDED");
    }

    let action: RevenueCatProcessResult["action"] = "ignored";
    let plan: UserPlan | undefined;

    if (isRevenueCatProductId(productId, REVENUECAT_PRODUCT_ID_ALIASES.unlockPack5)) {
      action = await this.processUnlockPackEvent({
        userId,
        eventType,
        transactionId,
      });
    } else {
      const mappedPlan = getProductPlan(productId);
      const mappedProductId = productId;
      if (mappedPlan && userId && mappedProductId) {
        action = await this.processSubscriptionEvent({
          userId,
          eventType,
          productId: mappedProductId,
          plan: mappedPlan,
          originalTransactionId,
          environment,
          expiresAt: dateFromMs(event.expiration_at_ms),
          verifiedAt: dateFromMs(event.event_timestamp_ms) ?? new Date().toISOString(),
          cancelReason: asString(event.cancel_reason),
        });
        plan = action === "pro_granted" ? mappedPlan : "free";
      }
    }

    await repositories.revenueCatEvents.markProcessed(eventId, {
      userId,
      productId,
      transactionId,
      originalTransactionId,
      payloadSummary: summarizeEvent(event),
      processedAction: action,
      processedAt: new Date().toISOString(),
    });

    logger.info({ eventId, eventType, action, plan }, "REVENUECAT_WEBHOOK_PROCESSED");

    return { eventId, action, plan };
  }

  private async processUnlockPackEvent(input: {
    userId: string | null;
    eventType: string;
    transactionId: string | null;
  }): Promise<RevenueCatProcessResult["action"]> {
    if (!input.userId) return "ignored";

    if (input.eventType === "NON_RENEWING_PURCHASE") {
      if (input.transactionId) {
        const duplicateTransaction = await repositories.revenueCatEvents.findProcessedByTransactionId(input.transactionId);
        if (duplicateTransaction?.processedAction === "unlock_pack_credited") {
          return "duplicate";
        }
      }
      const balance = await repositories.unlockBalances.getOrCreate(input.userId);
      await repositories.unlockBalances.update({
        ...balance,
        unlockCredits: balance.unlockCredits + UNLOCK_PACK_CREDITS,
        updatedAt: new Date().toISOString(),
      });
      return "unlock_pack_credited";
    }

    if (input.eventType === "CANCELLATION") {
      const balance = await repositories.unlockBalances.getOrCreate(input.userId);
      await repositories.unlockBalances.update({
        ...balance,
        unlockCredits: Math.max(0, balance.unlockCredits - UNLOCK_PACK_CREDITS),
        updatedAt: new Date().toISOString(),
      });
      return "unlock_pack_revoked";
    }

    return "ignored";
  }

  private async processSubscriptionEvent(input: {
    userId: string;
    eventType: string;
    productId: string;
    plan: UserPlan;
    originalTransactionId: string | null;
    environment: string | null;
    expiresAt?: string;
    verifiedAt: string;
    cancelReason: string | null;
  }): Promise<RevenueCatProcessResult["action"]> {
    const shouldRevoke =
      input.eventType === "EXPIRATION" ||
      (input.eventType === "CANCELLATION" &&
        (input.cancelReason === "CUSTOMER_SUPPORT" ||
          input.cancelReason === "DEVELOPER_INITIATED" ||
          (input.expiresAt ? new Date(input.expiresAt).getTime() <= Date.now() : false)));

    if (shouldRevoke) {
      await repositories.subscriptions.replaceActiveForUser(buildFreeSubscription(input.userId));
      return "pro_revoked";
    }

    const activeEvents = new Set([
      "INITIAL_PURCHASE",
      "RENEWAL",
      "UNCANCELLATION",
      "SUBSCRIPTION_EXTENDED",
      "TEMPORARY_ENTITLEMENT_GRANT",
    ]);
    if (!activeEvents.has(input.eventType)) {
      return "ignored";
    }

    if (input.environment === "SANDBOX" && input.eventType === "RENEWAL") {
      if (!input.originalTransactionId) {
        logger.warn(
          { userId: input.userId, productId: input.productId, reason: "missing_original_transaction_id" },
          "REVENUECAT_SANDBOX_RENEWAL_IGNORED",
        );
        return "ignored";
      }
      const priorGrant = await repositories.revenueCatEvents.findProcessedSubscriptionGrantByOriginalTransaction({
        userId: input.userId,
        originalTransactionId: input.originalTransactionId,
      });
      if (!priorGrant) {
        logger.warn(
          {
            userId: input.userId,
            productId: input.productId,
            originalTransactionId: input.originalTransactionId,
            reason: "no_prior_user_subscription_grant",
          },
          "REVENUECAT_SANDBOX_RENEWAL_IGNORED",
        );
        return "ignored";
      }
    }

    const record: SubscriptionRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      plan: normalizePlan(input.plan),
      status: "active",
      productId: input.productId,
      expiresAt: input.expiresAt,
      verifiedAt: input.verifiedAt,
    };
    await repositories.subscriptions.replaceActiveForUser(record);
    return "pro_granted";
  }
}

export const revenueCatProductIds = REVENUECAT_PRODUCT_IDS;
export const revenueCatProductIdAliases = REVENUECAT_PRODUCT_ID_ALIASES;
