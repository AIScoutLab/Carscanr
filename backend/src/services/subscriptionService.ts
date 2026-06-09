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
const REVENUECAT_SUBSCRIBER_REQUEST_TIMEOUT_MS = 10000;
const REVENUECAT_RECENT_INITIAL_PURCHASE_SYNC_WINDOW_MS = 30 * 60 * 1000;

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

type RevenueCatSubscriberEntitlement = {
  expires_date?: unknown;
  product_identifier?: unknown;
  purchase_date?: unknown;
  store?: unknown;
  environment?: unknown;
  is_sandbox?: unknown;
};

type RevenueCatSubscriberSubscription = {
  expires_date?: unknown;
  product_identifier?: unknown;
  purchase_date?: unknown;
  store?: unknown;
  environment?: unknown;
  is_sandbox?: unknown;
  original_transaction_id?: unknown;
};

type RevenueCatSubscriberResponse = {
  subscriber?: {
    original_app_user_id?: unknown;
    aliases?: unknown;
    subscriber_aliases?: unknown;
    all_app_user_ids?: unknown;
    entitlements?: Record<string, RevenueCatSubscriberEntitlement>;
    subscriptions?: Record<string, RevenueCatSubscriberSubscription>;
  };
};

type RevenueCatSubscriptionSyncDeniedReason =
  | "configuration_missing"
  | "subscriber_missing"
  | "subscriber_mismatch"
  | "no_active_pro_entitlement"
  | "active_product_not_allowed"
  | "revenuecat_id_mismatch"
  | "revenuecat_orphaned_subscription"
  | "sandbox_manual_reset_protection";

type RevenueCatSubscriptionSyncIdentityInput = {
  currentAppUserId?: unknown;
  originalAppUserId?: unknown;
  aliases?: unknown;
  activeEntitlementIds?: unknown;
  activeProductIds?: unknown;
  activeSubscriptionIds?: unknown;
};

type RevenueCatSubscriberLookupResult = {
  lookupId: string;
  payload: RevenueCatSubscriberResponse;
  subscriber: RevenueCatSubscriberResponse["subscriber"] | null;
  activePro: ReturnType<typeof resolveActiveProEntitlement> | null;
  aliasIds: string[];
};

type RevenueCatSubscriptionSyncResult =
  | {
      action: "granted";
      record: SubscriptionRecord;
      productId: string;
      plan: UserPlan;
      expiresAt?: string;
    }
  | {
      action: "denied";
      reason: RevenueCatSubscriptionSyncDeniedReason;
      record: SubscriptionRecord;
    };

type SubscriptionVerifyRecord = SubscriptionRecord & {
  revenueCatSync?: {
    status: "granted" | "denied";
    reason?: RevenueCatSubscriptionSyncDeniedReason;
  };
};

type RevenueCatSubscriberFetcher = (input: {
  appUserId: string;
  signal: AbortSignal;
}) => Promise<RevenueCatSubscriberResponse>;

let revenueCatSubscriberFetcherOverride: RevenueCatSubscriberFetcher | null = null;
let revenueCatRestApiKeyOverride: string | null = null;

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(asString).filter((candidate): candidate is string => Boolean(candidate));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = asString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function dateFromMs(value: unknown) {
  const ms = asNumber(value);
  return ms ? new Date(ms).toISOString() : undefined;
}

function dateFromRevenueCatDate(value: unknown) {
  const raw = asString(value);
  if (!raw) return undefined;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function isFutureOrOpenEndedDate(value?: string) {
  return !value || new Date(value).getTime() > Date.now();
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

function getRevenueCatProductIdsForPlan(plan: UserPlan): string[] {
  if (plan === "pro_yearly") return [...REVENUECAT_PRODUCT_ID_ALIASES.yearlyPro];
  if (plan === "pro_monthly" || plan === "pro") return [...REVENUECAT_PRODUCT_ID_ALIASES.monthlyPro];
  return [];
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

function isAllowedRevenueCatOriginalAppUserId(originalAppUserId: string | null, userId: string) {
  if (!originalAppUserId || originalAppUserId === userId) {
    return true;
  }
  return isRevenueCatAnonymousAppUserId(originalAppUserId);
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

function getRevenueCatIdentityCandidates(input?: RevenueCatSubscriptionSyncIdentityInput | null) {
  if (!input || typeof input !== "object") {
    return [];
  }
  return uniqueStrings([
    asString(input.currentAppUserId),
    asString(input.originalAppUserId),
    ...asStringList(input.aliases),
  ]);
}

function collectRevenueCatSubscriberAliases(subscriber: RevenueCatSubscriberResponse["subscriber"] | null) {
  if (!subscriber) {
    return [];
  }
  return uniqueStrings([
    asString(subscriber.original_app_user_id),
    ...asStringList(subscriber.aliases),
    ...asStringList(subscriber.subscriber_aliases),
    ...asStringList(subscriber.all_app_user_ids),
  ]);
}

function subscriberHasAliasForUser(subscriber: RevenueCatSubscriberResponse["subscriber"] | null, userId: string) {
  return collectRevenueCatSubscriberAliases(subscriber).includes(userId);
}

function lookupsResolveToSameRevenueCatCustomer(left: RevenueCatSubscriberLookupResult, right: RevenueCatSubscriberLookupResult) {
  const leftIds = new Set([left.lookupId, ...left.aliasIds]);
  const rightIds = new Set([right.lookupId, ...right.aliasIds]);
  for (const id of leftIds) {
    if (rightIds.has(id)) {
      return true;
    }
  }
  return false;
}

function normalizeRevenueCatEnvironment(value: unknown) {
  const normalized = asString(value)?.trim().toUpperCase() ?? null;
  if (!normalized) return null;
  if (normalized === "SANDBOX") return "SANDBOX";
  if (normalized === "PRODUCTION") return "PRODUCTION";
  return normalized;
}

function getRevenueCatEventEnvironment(event: RevenueCatEventRecord | null) {
  if (!event?.payloadSummary || typeof event.payloadSummary !== "object") {
    return null;
  }
  return normalizeRevenueCatEnvironment((event.payloadSummary as Record<string, unknown>).environment);
}

function isSandboxSubscriptionEvidence(input: {
  entitlement?: RevenueCatSubscriberEntitlement | null;
  subscription?: RevenueCatSubscriberSubscription | null;
  latestEvent?: RevenueCatEventRecord | null;
}) {
  if (asBoolean(input.entitlement?.is_sandbox) === true || asBoolean(input.subscription?.is_sandbox) === true) {
    return true;
  }
  if (
    normalizeRevenueCatEnvironment(input.entitlement?.environment) === "SANDBOX" ||
    normalizeRevenueCatEnvironment(input.subscription?.environment) === "SANDBOX"
  ) {
    return true;
  }
  return getRevenueCatEventEnvironment(input.latestEvent ?? null) === "SANDBOX";
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
    aliases: getRevenueCatAliases(event),
  };
}

function getRevenueCatRestApiKey() {
  return revenueCatRestApiKeyOverride ?? env.REVENUECAT_REST_API_KEY;
}

async function defaultRevenueCatSubscriberFetcher(input: {
  appUserId: string;
  signal: AbortSignal;
}): Promise<RevenueCatSubscriberResponse> {
  const url = new URL(`/v1/subscribers/${encodeURIComponent(input.appUserId)}`, env.REVENUECAT_BASE_URL);
  const response = await fetch(url, {
    method: "GET",
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${getRevenueCatRestApiKey()}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 404) {
    return {};
  }

  if (!response.ok) {
    throw new AppError(502, "REVENUECAT_SUBSCRIBER_FETCH_FAILED", `RevenueCat subscriber lookup failed with status ${response.status}.`);
  }

  return (await response.json()) as RevenueCatSubscriberResponse;
}

function getRevenueCatSubscriberFetcher() {
  return revenueCatSubscriberFetcherOverride ?? defaultRevenueCatSubscriberFetcher;
}

async function lookupRevenueCatSubscriber(input: {
  appUserId: string;
  signal: AbortSignal;
}): Promise<RevenueCatSubscriberLookupResult> {
  const payload = await getRevenueCatSubscriberFetcher()({
    appUserId: input.appUserId,
    signal: input.signal,
  });
  const subscriber = payload.subscriber ?? null;
  return {
    lookupId: input.appUserId,
    payload,
    subscriber,
    activePro: resolveActiveProEntitlement(subscriber),
    aliasIds: collectRevenueCatSubscriberAliases(subscriber),
  };
}

function resolveActiveProEntitlement(subscriber: RevenueCatSubscriberResponse["subscriber"] | null) {
  const entitlementId = env.REVENUECAT_PRO_ENTITLEMENT_ID;
  const entitlement = subscriber?.entitlements?.[entitlementId] ?? null;
  if (!entitlement) {
    return null;
  }

  const productId = asString(entitlement.product_identifier);
  const plan = getProductPlan(productId);
  const expiresAt = dateFromRevenueCatDate(entitlement.expires_date);
  if (!productId || !plan || !isFutureOrOpenEndedDate(expiresAt)) {
    return null;
  }
  const subscription = subscriber?.subscriptions?.[productId] ?? null;

  return {
    productId,
    plan,
    expiresAt,
    entitlementId,
    purchaseDate: dateFromRevenueCatDate(entitlement.purchase_date ?? subscription?.purchase_date),
    originalTransactionId: asString(subscription?.original_transaction_id),
    environment:
      normalizeRevenueCatEnvironment(entitlement.environment) ??
      normalizeRevenueCatEnvironment(subscription?.environment) ??
      (asBoolean(entitlement.is_sandbox) === true || asBoolean(subscription?.is_sandbox) === true ? "SANDBOX" : null),
  };
}

function hasAllowedActiveSubscriptionForEntitlementProduct(
  subscriber: RevenueCatSubscriberResponse["subscriber"] | null,
  productId: string,
) {
  const subscription = subscriber?.subscriptions?.[productId];
  if (!subscription) {
    return true;
  }

  const expiresAt = dateFromRevenueCatDate(subscription.expires_date);
  return isFutureOrOpenEndedDate(expiresAt);
}

function getActiveProSubscriptionForProduct(
  subscriber: RevenueCatSubscriberResponse["subscriber"] | null,
  productId: string,
) {
  return subscriber?.subscriptions?.[productId] ?? null;
}

function hasCurrentActiveBackendPro(subscription: SubscriptionRecord | null) {
  return Boolean(
    subscription &&
      subscription.status === "active" &&
      isProPlan(subscription.plan) &&
      (!subscription.expiresAt || new Date(subscription.expiresAt).getTime() > Date.now()),
  );
}

export function setRevenueCatSubscriberFetcherForTests(fetcher: RevenueCatSubscriberFetcher | null) {
  revenueCatSubscriberFetcherOverride = fetcher;
}

export function setRevenueCatRestApiKeyForTests(apiKey: string | null) {
  revenueCatRestApiKeyOverride = apiKey;
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
    revenueCatIdentity?: RevenueCatSubscriptionSyncIdentityInput | null;
  }): Promise<SubscriptionVerifyRecord> {
    const result = await this.syncRevenueCatSubscription(input.userId, {
      requestedProductId: input.productId,
      platform: input.platform,
      revenueCatIdentity: input.revenueCatIdentity ?? null,
    });
    return {
      ...result.record,
      revenueCatSync:
        result.action === "granted"
          ? { status: "granted" }
          : { status: "denied", reason: result.reason },
    };
  }

  async cancelSubscription(userId: string): Promise<SubscriptionRecord> {
    return this.getCurrentSubscription(userId);
  }

  private async getDeniedSubscriptionSyncRecord(userId: string, reason: RevenueCatSubscriptionSyncDeniedReason) {
    void reason;
    return this.getCurrentSubscription(userId);
  }

  private async isBlockedBySandboxManualResetProtection(input: {
    userId: string;
    lookup: RevenueCatSubscriberLookupResult;
    currentActiveSubscription: SubscriptionRecord | null;
  }) {
    const activePro = input.lookup.activePro;
    if (!activePro || hasCurrentActiveBackendPro(input.currentActiveSubscription)) {
      return false;
    }

    const productIds = getRevenueCatProductIdsForPlan(activePro.plan);
    if (!productIds.includes(activePro.productId)) {
      productIds.push(activePro.productId);
    }
    const latestEvent = await repositories.revenueCatEvents.findLatestSubscriptionEventByProduct({
      userId: input.userId,
      productIds,
    });
    const entitlement = input.lookup.subscriber?.entitlements?.[activePro.entitlementId] ?? null;
    const subscription = getActiveProSubscriptionForProduct(input.lookup.subscriber, activePro.productId);
    const sandboxEvidence =
      activePro.environment === "SANDBOX" ||
      isSandboxSubscriptionEvidence({
        entitlement,
        subscription,
        latestEvent,
      });

    if (!sandboxEvidence) {
      return false;
    }

    const recentInitialPurchase = await repositories.revenueCatEvents.findRecentProcessedInitialPurchaseGrant({
      userId: input.userId,
      productIds,
      since: new Date(Date.now() - REVENUECAT_RECENT_INITIAL_PURCHASE_SYNC_WINDOW_MS).toISOString(),
      appUserId: input.lookup.lookupId,
      originalTransactionId: activePro.originalTransactionId,
    });
    if (recentInitialPurchase) {
      return false;
    }

    logger.warn(
      {
        authUserId: input.userId,
        userId: input.userId,
        reason: "sandbox_manual_reset_protection",
        productId: activePro.productId,
        originalTransactionId: activePro.originalTransactionId ?? latestEvent?.originalTransactionId ?? null,
        revenueCatLookupId: input.lookup.lookupId,
        latestEventId: latestEvent?.id ?? null,
        latestEventType: latestEvent?.eventType ?? null,
        latestProcessedAction: latestEvent?.processedAction ?? null,
        currentPlan: input.currentActiveSubscription?.plan ?? null,
        currentStatus: input.currentActiveSubscription?.status ?? null,
        currentExpiresAt: input.currentActiveSubscription?.expiresAt ?? null,
      },
      "REVENUECAT_SUBSCRIPTION_SYNC_DENIED",
    );
    return true;
  }

  private async syncRevenueCatSubscription(
    userId: string,
    context: {
      requestedProductId?: string | null;
      platform?: string | null;
      revenueCatIdentity?: RevenueCatSubscriptionSyncIdentityInput | null;
    } = {},
  ): Promise<RevenueCatSubscriptionSyncResult> {
    const candidateAppUserIds = getRevenueCatIdentityCandidates(context.revenueCatIdentity).filter((candidate) => candidate !== userId);
    logger.info(
      {
        userId,
        requestedProductId: context.requestedProductId ?? null,
        platform: context.platform ?? null,
        entitlementId: env.REVENUECAT_PRO_ENTITLEMENT_ID,
        revenueCatRestApiConfigured: Boolean(getRevenueCatRestApiKey()),
        candidateAppUserIds,
        activeEntitlementIds: asStringList(context.revenueCatIdentity?.activeEntitlementIds),
        activeProductIds: asStringList(context.revenueCatIdentity?.activeProductIds ?? context.revenueCatIdentity?.activeSubscriptionIds),
      },
      "REVENUECAT_SUBSCRIPTION_SYNC_STARTED",
    );

    if (!getRevenueCatRestApiKey()) {
      const record = await this.getDeniedSubscriptionSyncRecord(userId, "configuration_missing");
      logger.warn(
        {
          userId,
          reason: "configuration_missing",
          requestedProductId: context.requestedProductId ?? null,
        },
        "REVENUECAT_SUBSCRIPTION_SYNC_DENIED",
      );
      return { action: "denied", reason: "configuration_missing", record };
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), REVENUECAT_SUBSCRIBER_REQUEST_TIMEOUT_MS);
    let authLookup: RevenueCatSubscriberLookupResult;
    try {
      authLookup = await lookupRevenueCatSubscriber({
        appUserId: userId,
        signal: abortController.signal,
      });
    } catch (error) {
      logger.error(
        {
          userId,
          requestedProductId: context.requestedProductId ?? null,
          message: error instanceof Error ? error.message : String(error),
        },
        "REVENUECAT_SUBSCRIPTION_SYNC_ERROR",
      );
      throw error instanceof AppError
        ? error
        : new AppError(502, "REVENUECAT_SUBSCRIPTION_SYNC_FAILED", "Unable to verify RevenueCat subscription.");
    } finally {
      clearTimeout(timeout);
    }

    const currentActiveSubscription = await repositories.subscriptions.findActiveByUser(userId);
    if (authLookup.activePro && hasAllowedActiveSubscriptionForEntitlementProduct(authLookup.subscriber, authLookup.activePro.productId)) {
      if (
        await this.isBlockedBySandboxManualResetProtection({
          userId,
          lookup: authLookup,
          currentActiveSubscription,
        })
      ) {
        const record = await this.getDeniedSubscriptionSyncRecord(userId, "sandbox_manual_reset_protection");
        return { action: "denied", reason: "sandbox_manual_reset_protection", record };
      }
      return this.grantRevenueCatSyncedPro(userId, authLookup.activePro, {
        lookupId: authLookup.lookupId,
        proof: "auth_user_id_lookup",
      });
    }

    const activeCandidateLookups: RevenueCatSubscriberLookupResult[] = [];
    for (const candidateAppUserId of candidateAppUserIds) {
      let candidateLookup: RevenueCatSubscriberLookupResult;
      try {
        candidateLookup = await lookupRevenueCatSubscriber({
          appUserId: candidateAppUserId,
          signal: abortController.signal,
        });
      } catch (error) {
        logger.warn(
          {
            userId,
            candidateAppUserId,
            message: error instanceof Error ? error.message : String(error),
          },
          "REVENUECAT_SUBSCRIPTION_SYNC_CANDIDATE_LOOKUP_FAILED",
        );
        continue;
      }

      if (!candidateLookup.activePro) {
        continue;
      }

      activeCandidateLookups.push(candidateLookup);
      if (!hasAllowedActiveSubscriptionForEntitlementProduct(candidateLookup.subscriber, candidateLookup.activePro.productId)) {
        continue;
      }

      if (
        await this.isBlockedBySandboxManualResetProtection({
          userId,
          lookup: candidateLookup,
          currentActiveSubscription,
        })
      ) {
        const record = await this.getDeniedSubscriptionSyncRecord(userId, "sandbox_manual_reset_protection");
        return { action: "denied", reason: "sandbox_manual_reset_protection", record };
      }

      const trustedHistory = await repositories.revenueCatEvents.findProcessedSubscriptionGrantByAppUserId({
        userId,
        appUserId: candidateAppUserId,
      });
      const proof = subscriberHasAliasForUser(candidateLookup.subscriber, userId)
        ? "candidate_alias_contains_auth_user"
        : lookupsResolveToSameRevenueCatCustomer(authLookup, candidateLookup)
          ? "auth_and_candidate_same_revenuecat_customer"
          : trustedHistory
            ? "trusted_webhook_history"
            : null;

      if (proof) {
        return this.grantRevenueCatSyncedPro(userId, candidateLookup.activePro, {
          lookupId: candidateLookup.lookupId,
          proof,
        });
      }
    }

    if (activeCandidateLookups.length > 0) {
      const record = await this.getDeniedSubscriptionSyncRecord(userId, "revenuecat_orphaned_subscription");
      logger.warn(
        {
          userId,
          reason: "revenuecat_orphaned_subscription",
          candidateAppUserIds: activeCandidateLookups.map((lookup) => lookup.lookupId),
          activeProductIds: activeCandidateLookups.map((lookup) => lookup.activePro?.productId).filter(Boolean),
        },
        "REVENUECAT_SUBSCRIPTION_SYNC_DENIED",
      );
      return { action: "denied", reason: "revenuecat_orphaned_subscription", record };
    }

    const reason = authLookup.subscriber ? "no_active_pro_entitlement" : "subscriber_missing";
    const record = await this.getDeniedSubscriptionSyncRecord(userId, reason);
    logger.warn(
      {
        userId,
        entitlementId: env.REVENUECAT_PRO_ENTITLEMENT_ID,
        activeEntitlementIds: Object.keys(authLookup.subscriber?.entitlements ?? {}),
        reason,
        candidateAppUserIds,
      },
      "REVENUECAT_SUBSCRIPTION_SYNC_DENIED",
    );
    return { action: "denied", reason, record };
  }

  private async grantRevenueCatSyncedPro(
    userId: string,
    activePro: NonNullable<ReturnType<typeof resolveActiveProEntitlement>>,
    source: { lookupId: string; proof: string },
  ): Promise<RevenueCatSubscriptionSyncResult> {
    const record: SubscriptionRecord = {
      id: crypto.randomUUID(),
      userId,
      plan: normalizePlan(activePro.plan),
      status: "active",
      productId: activePro.productId,
      expiresAt: activePro.expiresAt,
      verifiedAt: new Date().toISOString(),
    };
    const saved = await repositories.subscriptions.replaceActiveForUser(record);
    logger.info(
      {
        userId,
        plan: saved.plan,
        productId: saved.productId ?? null,
        expiresAt: saved.expiresAt ?? null,
        source: "revenuecat/server_sync",
        revenueCatLookupId: source.lookupId,
        proof: source.proof,
      },
      "REVENUECAT_SUBSCRIPTION_SYNC_RESULT",
    );
    return {
      action: "granted",
      record: saved,
      productId: activePro.productId,
      plan: activePro.plan,
      expiresAt: activePro.expiresAt,
    };
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
      const activeSubscription = await repositories.subscriptions.findActiveByUser(input.userId);
      if (
        !activeSubscription ||
        !isProPlan(activeSubscription.plan) ||
        (activeSubscription.expiresAt ? new Date(activeSubscription.expiresAt).getTime() <= Date.now() : false)
      ) {
        logger.warn(
          {
            userId: input.userId,
            productId: input.productId,
            originalTransactionId: input.originalTransactionId,
            priorGrantEventId: priorGrant.id,
            currentPlan: activeSubscription?.plan ?? null,
            currentStatus: activeSubscription?.status ?? null,
            currentExpiresAt: activeSubscription?.expiresAt ?? null,
            reason: "no_current_active_pro_subscription",
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
