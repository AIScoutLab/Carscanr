import AsyncStorage from "@react-native-async-storage/async-storage";
import { defaultSubscriptionStatus } from "@/constants/seedData";
import { applyPlanOverride } from "@/features/subscription/planOverride";
import { apiRequest } from "@/services/apiClient";
import { authService } from "@/services/authService";
import { purchaseService } from "@/services/purchaseService";
import { scanService } from "@/services/scanService";
import { wait } from "@/lib/utils";
import { FreeUnlockReason, SubscriptionActionResult, SubscriptionProduct, SubscriptionStatus, SubscriptionVerifyPayload } from "@/types";

type BackendSubscriptionRecord = {
  id: string;
  userId: string;
  plan: "free" | "pro";
  status: "active" | "inactive" | "expired";
  productId: string;
  expiresAt?: string;
  verifiedAt: string;
};

type BackendUnlockStatus = {
  freeUnlocksTotal: number;
  freeUnlocksUsed: number;
  freeUnlocksRemaining: number;
  unlockedVehicleIds: string[];
};

type BackendUnlockUseResponse = {
  entitlement: {
    isPro: boolean;
    alreadyUnlocked: boolean;
    usedUnlock: boolean;
    remainingUnlocks: number;
    allowed: boolean;
    reason: string;
  };
  status: BackendUnlockStatus;
};

type FreeUnlockActionResult = {
  ok: boolean;
  state: FreeUnlockState;
  remaining: number;
  limit: number;
  alreadyUnlocked: boolean;
  reason: FreeUnlockReason;
  message: string;
};

const FREE_UNLOCKS_LIMIT = 5;
const FREE_UNLOCK_STORAGE_KEY = "carscanr.freeUnlocks.v1";
const ESTIMATED_UNLOCK_PREFIX = "estimate:";
const ESTIMATED_SOFT_UNLOCK_PREFIX = "estimate-soft:";
const ESTIMATED_UNLOCK_YEAR_SNAP_MAX_DRIFT = 1;

function normalizeUnlockPart(value: string | number | null | undefined, fallback: string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length > 0) {
      return trimmed.replace(/\s+/g, "-");
    }
  }
  return fallback;
}

function parseUnlockYear(year: string | number | null | undefined) {
  const parsedYear = typeof year === "number" ? year : typeof year === "string" ? Number.parseInt(year, 10) : null;
  return typeof parsedYear === "number" && Number.isFinite(parsedYear) ? parsedYear : null;
}

function normalizeFamilyBucket(make: string | null | undefined, model: string | null | undefined) {
  const normalized = `${normalizeUnlockPart(make, "unknown")}:${normalizeUnlockPart(model, "vehicle")}`;
  return normalized
    .replace(/\b(series|class|edition|sport|touring|limited|premium|platinum|lariat|xl|xlt|se|sel|le|xle|lx|ex|gt)\b/g, "")
    .replace(/:+/g, ":")
    .trim();
}

function isGenerationSensitiveEstimateFamily(input: {
  make?: string | null;
  model?: string | null;
  vehicleType?: string | null;
}) {
  const make = normalizeUnlockPart(input.make, "unknown");
  const model = normalizeUnlockPart(input.model, "vehicle");
  const combined = `${make}:${model}`;
  const vehicleType = normalizeUnlockPart(input.vehicleType, "");

  if (vehicleType === "motorcycle" || vehicleType === "truck") {
    return true;
  }

  return /jeep:wrangler|ford:f-150|ford:mustang|chevrolet:camaro|chevrolet:silverado|dodge:charger|dodge:challenger|ram:1500|gmc:sierra|porsche:911/.test(
    combined,
  );
}

function isExtremeRiskUnlockFamily(input: {
  make?: string | null;
  model?: string | null;
  vehicleType?: string | null;
  year?: string | number | null;
}) {
  const make = normalizeUnlockPart(input.make, "unknown");
  const model = normalizeUnlockPart(input.model, "vehicle");
  const combined = `${make}:${model}`;
  const parsedYear = parseUnlockYear(input.year);
  const vehicleType = normalizeUnlockPart(input.vehicleType, "");

  return (
    vehicleType === "motorcycle" ||
    (typeof parsedYear === "number" && parsedYear < 1996) ||
    /ferrari|lamborghini|mclaren|aston-martin|lotus|koenigsegg|pagani|rimac|bugatti|rolls-royce|bentley/.test(make) ||
    /porsche:911/.test(combined)
  );
}

function hasGenerationSensitiveTrimSignal(trim?: string | null) {
  const normalizedTrim = normalizeUnlockPart(trim, "");
  return /rubicon|shelby|raptor|z06|trx|hellcat|392|scat-pack|mach-1|gt500|zl1|ss|denali|platinum|king-ranch/.test(
    normalizedTrim,
  );
}

function resolveStableEstimateUnlockYear(input: {
  year?: string | number | null;
  groundedYear?: string | number | null;
  make?: string | null;
  model?: string | null;
  vehicleType?: string | null;
  trim?: string | null;
  groundedMatchType?: string | null;
}) {
  const originalYear = parseUnlockYear(input.year);
  const candidateGroundedYear = parseUnlockYear(input.groundedYear);
  const make = normalizeUnlockPart(input.make, "unknown");
  const model = normalizeUnlockPart(input.model, "vehicle");
  const familyBucket = normalizeFamilyBucket(input.make, input.model);
  const generationSensitiveFamily = isGenerationSensitiveEstimateFamily(input);
  const generationSensitiveTrim = hasGenerationSensitiveTrimSignal(input.trim);
  const groundedMatchType = normalizeUnlockPart(input.groundedMatchType, "");
  const snapDrift =
    typeof originalYear === "number" && typeof candidateGroundedYear === "number"
      ? Math.abs(originalYear - candidateGroundedYear)
      : null;

  let resolvedYear = originalYear;
  let allowed = false;
  let reason = "keep_original_year";

  if (typeof originalYear !== "number" || !Number.isFinite(originalYear)) {
    resolvedYear = candidateGroundedYear;
    reason = typeof candidateGroundedYear === "number" ? "original_year_missing" : "no_valid_year";
  } else if (typeof candidateGroundedYear !== "number" || !Number.isFinite(candidateGroundedYear)) {
    reason = "no_grounded_year";
  } else if (!make || !model || familyBucket === "unknown:vehicle") {
    reason = "missing_family_identity";
  } else if (groundedMatchType !== "id" && groundedMatchType !== "exact") {
    reason = "grounding_not_strong_enough";
  } else if (snapDrift == null || snapDrift > ESTIMATED_UNLOCK_YEAR_SNAP_MAX_DRIFT) {
    reason = "year_drift_too_large";
  } else if (generationSensitiveFamily) {
    reason = "generation_sensitive_family";
  } else if (generationSensitiveTrim) {
    reason = "generation_sensitive_trim_signal";
  } else {
    resolvedYear = candidateGroundedYear;
    allowed = true;
    reason = "safe_nearby_grounded_year";
  }

  if (__DEV__) {
    console.log("[subscription] ESTIMATE_UNLOCK_YEAR_SNAP_DECISION", {
      originalYear,
      candidateGroundedYear,
      resolvedYear,
      make,
      model,
      familyBucket,
      groundedMatchType: groundedMatchType || null,
      generationSensitiveFamily,
      generationSensitiveTrim,
      allowed,
      reason,
    });
  }

  return resolvedYear;
}

export function buildVehicleUnlockId(input: {
  vehicleId?: string | null;
  scanId?: string | null;
  year?: string | number | null;
  groundedYear?: string | number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  vehicleType?: string | null;
  groundedMatchType?: string | null;
  includeTrim?: boolean;
}) {
  if (typeof input.vehicleId === "string" && input.vehicleId.trim().length > 0 && !input.vehicleId.startsWith(ESTIMATED_UNLOCK_PREFIX)) {
    return input.vehicleId;
  }

  const make = normalizeUnlockPart(input.make, "unknown");
  const model = normalizeUnlockPart(input.model, "vehicle");
  if (make === "unknown" && model === "vehicle") {
    return null;
  }

  return `${ESTIMATED_UNLOCK_PREFIX}${[
    normalizeUnlockPart(
      resolveStableEstimateUnlockYear({
        year: input.year,
        groundedYear: input.groundedYear,
        make: input.make,
        model: input.model,
        vehicleType: input.vehicleType,
        trim: input.trim,
        groundedMatchType: input.groundedMatchType,
      }),
      "na",
    ),
    make,
    model,
    input.includeTrim ? normalizeUnlockPart(input.trim, "family") : "family",
  ].join(":")}`;
}

export function buildVehicleSoftUnlockId(input: {
  make?: string | null;
  model?: string | null;
  vehicleType?: string | null;
  year?: string | number | null;
  trusted?: boolean;
}) {
  if (!input.trusted) {
    return null;
  }
  if (isExtremeRiskUnlockFamily(input) || isGenerationSensitiveEstimateFamily(input)) {
    return null;
  }

  const make = normalizeUnlockPart(input.make, "unknown");
  const model = normalizeUnlockPart(input.model, "vehicle");
  if (make === "unknown" && model === "vehicle") {
    return null;
  }

  return `${ESTIMATED_SOFT_UNLOCK_PREFIX}${[make, model, "family"].join(":")}`;
}

function normalizeEstimatedUnlockId(vehicleId: string) {
  if (!isEstimatedUnlockId(vehicleId) && !isEstimatedSoftUnlockId(vehicleId)) {
    return vehicleId;
  }

  if (isEstimatedSoftUnlockId(vehicleId)) {
    const raw = vehicleId.slice(ESTIMATED_SOFT_UNLOCK_PREFIX.length);
    const parts = raw.split(":").filter((part) => part.length > 0);
    const [make, model] = parts;
    return `${ESTIMATED_SOFT_UNLOCK_PREFIX}${[
      normalizeUnlockPart(make, "unknown"),
      normalizeUnlockPart(model, "vehicle"),
      "family",
    ].join(":")}`;
  }

  const raw = vehicleId.slice(ESTIMATED_UNLOCK_PREFIX.length);
  const parts = raw.split(":").filter((part) => part.length > 0);
  if (parts.length >= 5) {
    const [, year, make, model] = parts;
    return `${ESTIMATED_UNLOCK_PREFIX}${[
      normalizeUnlockPart(year, "na"),
      normalizeUnlockPart(make, "unknown"),
      normalizeUnlockPart(model, "vehicle"),
      "family",
    ].join(":")}`;
  }

  if (parts.length === 4) {
    const [year, make, model] = parts;
    return `${ESTIMATED_UNLOCK_PREFIX}${[
      normalizeUnlockPart(year, "na"),
      normalizeUnlockPart(make, "unknown"),
      normalizeUnlockPart(model, "vehicle"),
      "family",
    ].join(":")}`;
  }

  return vehicleId;
}

type FreeUnlockState = {
  used: number;
  localUsed?: number;
  unlockedVehicleIds: string[];
};

const PRO_MONTHLY_PRODUCT: SubscriptionProduct = {
  productId: "com.caridentifier.pro.monthly",
  platform: "ios",
  plan: "pro",
  priceLabel: "$6.99",
  billingPeriodLabel: "month",
};

function normalizeUnlockState(input: unknown): FreeUnlockState {
  if (!input || typeof input !== "object") {
    return { used: 0, localUsed: 0, unlockedVehicleIds: [] };
  }
  const raw = input as Partial<FreeUnlockState>;
  const localUsed =
    typeof raw.localUsed === "number" && Number.isFinite(raw.localUsed)
      ? Math.max(0, raw.localUsed)
      : typeof raw.used === "number" && Number.isFinite(raw.used)
        ? Math.max(0, raw.used)
        : 0;
  const unlockedVehicleIds = Array.isArray(raw.unlockedVehicleIds)
    ? Array.from(
        new Set(
          raw.unlockedVehicleIds
            .filter((id) => typeof id === "string" && id.length > 0)
            .map((id) => normalizeEstimatedUnlockId(id)),
        ),
      )
    : [];
  return {
    used: localUsed,
    localUsed,
    unlockedVehicleIds,
  };
}

async function loadFreeUnlockState(userId: string): Promise<FreeUnlockState> {
  const key = `${FREE_UNLOCK_STORAGE_KEY}:${userId}`;
  const stored = await AsyncStorage.getItem(key);
  if (!stored) {
    return { used: 0, localUsed: 0, unlockedVehicleIds: [] };
  }
  try {
    return normalizeUnlockState(JSON.parse(stored));
  } catch {
    await AsyncStorage.removeItem(key);
    return { used: 0, localUsed: 0, unlockedVehicleIds: [] };
  }
}

async function saveFreeUnlockState(userId: string, state: FreeUnlockState) {
  const key = `${FREE_UNLOCK_STORAGE_KEY}:${userId}`;
  const normalizedState = normalizeUnlockState(state);
  await AsyncStorage.setItem(
    key,
    JSON.stringify({
      used: normalizedState.localUsed ?? normalizedState.used,
      localUsed: normalizedState.localUsed ?? normalizedState.used,
      unlockedVehicleIds: normalizedState.unlockedVehicleIds,
    }),
  );
}

function isEstimatedUnlockId(vehicleId: string) {
  return vehicleId.startsWith(ESTIMATED_UNLOCK_PREFIX);
}

function isEstimatedSoftUnlockId(vehicleId: string) {
  return vehicleId.startsWith(ESTIMATED_SOFT_UNLOCK_PREFIX);
}

function dedupeUnlockIds(ids: string[]) {
  return Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0).map((id) => normalizeEstimatedUnlockId(id))));
}

function mergeUnlockStates(limit: number, backendIds: string[], localState: FreeUnlockState) {
  const estimatedIds = localState.unlockedVehicleIds.filter((id) => isEstimatedUnlockId(id) || isEstimatedSoftUnlockId(id));
  const unlockedVehicleIds = dedupeUnlockIds([...backendIds, ...estimatedIds]);
  const uniqueBackendIds = Array.from(new Set(backendIds.filter((id) => typeof id === "string" && id.length > 0)));
  const localUsed = typeof localState.localUsed === "number" ? Math.max(0, localState.localUsed) : Math.max(0, localState.used);
  const used = Math.min(limit, uniqueBackendIds.length + localUsed);
  return {
    used,
    remaining: Math.max(0, limit - used),
    unlockedVehicleIds,
    limit,
  };
}

let status: SubscriptionStatus = applyPlanOverride({
  ...defaultSubscriptionStatus,
  isActive: false,
  provider: "placeholder",
  productId: null,
  willAutoRenew: false,
  lastVerifiedAt: null,
  purchaseAvailable: false,
});

function formatRenewalLabel(plan: "free" | "pro", expiresAt?: string) {
  if (plan === "free") {
    return "Upgrade for unlimited Pro details";
  }

  if (!expiresAt) {
    return "Pro active";
  }

  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return "Pro active";
  }

  return `Renews ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

function mergeUsageStatus(usage: SubscriptionStatus, overrides?: Partial<SubscriptionStatus>): SubscriptionStatus {
  return applyPlanOverride({
    ...usage,
    isActive: usage.plan === "pro",
    provider: "placeholder",
    productId: PRO_MONTHLY_PRODUCT.productId,
    willAutoRenew: usage.plan === "pro",
    lastVerifiedAt: overrides?.lastVerifiedAt ?? null,
    purchaseAvailable: false,
    purchaseAvailabilityState: "not_configured",
    availableProducts: [],
    renewalLabel: formatRenewalLabel(usage.plan),
    ...overrides,
  });
}

export const subscriptionService = {
  async getStatus(): Promise<SubscriptionStatus> {
    try {
      const [usage, purchaseSnapshot] = await Promise.all([
        scanService.getUsage(),
        purchaseService.getPurchaseSnapshot().catch(() => ({
          purchaseAvailable: false,
          purchaseAvailabilityState: "not_configured" as const,
          availableProducts: [] as SubscriptionProduct[],
          activeEntitlement: null,
          activeProductId: null,
          managementUrl: null,
        })),
      ]);
      status = mergeUsageStatus(usage, {
        plan: purchaseSnapshot.activeEntitlement?.isActive ? "pro" : usage.plan,
        provider: purchaseSnapshot.activeEntitlement?.isActive ? "revenuecat" : usage.plan === "pro" ? "backend" : "placeholder",
        productId: purchaseSnapshot.activeProductId ?? status.productId ?? null,
        willAutoRenew: purchaseSnapshot.activeEntitlement?.willRenew ?? usage.plan === "pro",
        renewalLabel: purchaseSnapshot.activeEntitlement?.isActive
          ? formatRenewalLabel("pro", purchaseSnapshot.activeEntitlement.expirationDate ?? undefined)
          : usage.renewalLabel,
        lastVerifiedAt: status.lastVerifiedAt ?? null,
        purchaseAvailable: purchaseSnapshot.purchaseAvailable,
        purchaseAvailabilityState: purchaseSnapshot.purchaseAvailabilityState,
        availableProducts: purchaseSnapshot.availableProducts,
      });
      return status;
    } catch {
      await wait(180);
    }
    return status;
  },

  async getFreeUnlockState() {
    const user = await authService.getCurrentUser();
    const token = await authService.getAccessToken();
    const localState = await loadFreeUnlockState(user?.id ?? "guest");
    if (!token) {
      if (__DEV__) {
        console.log("[subscription] unlock status skipped (no auth token)");
      }
      const remaining = Math.max(0, FREE_UNLOCKS_LIMIT - localState.used);
      return {
        used: localState.localUsed ?? localState.used,
        remaining,
        unlockedVehicleIds: localState.unlockedVehicleIds,
        limit: FREE_UNLOCKS_LIMIT,
      };
    }
    const cached = scanService.getCachedUnlockStatus?.();
    if (cached && typeof cached.freeUnlocksTotal === "number") {
      const merged = mergeUnlockStates(cached.freeUnlocksTotal ?? FREE_UNLOCKS_LIMIT, cached.unlockedVehicleIds ?? [], localState);
      return {
        used: merged.used,
        remaining: merged.remaining,
        unlockedVehicleIds: merged.unlockedVehicleIds,
        limit: merged.limit,
      };
    }
    try {
      if (!user?.id) {
        throw new Error("No user session available.");
      }
      const status = await apiRequest<BackendUnlockStatus>({
        path: "/api/unlocks/status",
      });
      const merged = mergeUnlockStates(status.freeUnlocksTotal ?? FREE_UNLOCKS_LIMIT, status.unlockedVehicleIds ?? [], localState);
      return {
        used: merged.used,
        remaining: merged.remaining,
        unlockedVehicleIds: merged.unlockedVehicleIds,
        limit: merged.limit,
      };
    } catch {
      const remaining = Math.max(0, FREE_UNLOCKS_LIMIT - localState.used);
      return {
        used: localState.localUsed ?? localState.used,
        remaining,
        unlockedVehicleIds: localState.unlockedVehicleIds,
        limit: FREE_UNLOCKS_LIMIT,
      };
    }
  },

  async useFreeUnlockForVehicle(vehicleId: string, linkedVehicleIds: string[] = []): Promise<FreeUnlockActionResult> {
    const user = await authService.getCurrentUser();
    const token = await authService.getAccessToken();
    const localUserId = user?.id ?? "guest";
    if (!token || isEstimatedUnlockId(vehicleId)) {
      const unlockState = await loadFreeUnlockState(localUserId);
      const candidateIds = dedupeUnlockIds([vehicleId, ...linkedVehicleIds]);
      const alreadyUnlocked = candidateIds.some((id) => unlockState.unlockedVehicleIds.includes(id));
      if (alreadyUnlocked) {
        return {
          ok: true,
          state: unlockState,
          remaining: Math.max(0, FREE_UNLOCKS_LIMIT - unlockState.used),
          limit: FREE_UNLOCKS_LIMIT,
          alreadyUnlocked: true,
          reason: "already_unlocked",
          message: "This vehicle is already unlocked.",
        };
      }

      const localUsed = unlockState.localUsed ?? unlockState.used;
      if (localUsed >= FREE_UNLOCKS_LIMIT) {
        return {
          ok: false,
          state: unlockState,
          remaining: 0,
          limit: FREE_UNLOCKS_LIMIT,
          alreadyUnlocked: false,
          reason: "no_free_unlocks",
          message: "No free unlocks remaining. Upgrade to Pro for full access.",
        };
      }

      const nextState = {
        used: localUsed + 1,
        localUsed: localUsed + 1,
        unlockedVehicleIds: dedupeUnlockIds([...unlockState.unlockedVehicleIds, ...candidateIds]),
      };
      await saveFreeUnlockState(localUserId, nextState);
      return {
        ok: true,
        state: nextState,
        remaining: Math.max(0, FREE_UNLOCKS_LIMIT - nextState.used),
        limit: FREE_UNLOCKS_LIMIT,
        alreadyUnlocked: false,
        reason: "consumed",
        message: "Free unlock applied. This vehicle is now fully unlocked.",
      };
    }
    if (!user?.id) {
      const unlockState = await loadFreeUnlockState("guest");
      return {
        ok: false,
        state: unlockState,
        remaining: Math.max(0, FREE_UNLOCKS_LIMIT - unlockState.used),
        limit: FREE_UNLOCKS_LIMIT,
        alreadyUnlocked: unlockState.unlockedVehicleIds.includes(vehicleId),
        reason: "auth_required",
        message: "Sign in to keep unlocks synced across devices.",
      };
    }
    try {
      const response = await apiRequest<BackendUnlockUseResponse>({
        path: "/api/unlocks/use",
        method: "POST",
        body: { vehicleId },
      });
      const status = response.status;
      const existingLocalState = await loadFreeUnlockState(user.id);
      const unlockState = {
        used: status.freeUnlocksUsed,
        localUsed: existingLocalState.localUsed ?? existingLocalState.used,
        unlockedVehicleIds: status.unlockedVehicleIds ?? [],
      };
      await saveFreeUnlockState(user.id, unlockState);
      return {
        ok: response.entitlement.allowed,
        state: unlockState,
        remaining: status.freeUnlocksRemaining ?? Math.max(0, status.freeUnlocksTotal - status.freeUnlocksUsed),
        limit: status.freeUnlocksTotal ?? FREE_UNLOCKS_LIMIT,
        alreadyUnlocked: response.entitlement.alreadyUnlocked,
        reason: response.entitlement.alreadyUnlocked
          ? "already_unlocked"
          : response.entitlement.allowed
            ? "consumed"
            : response.entitlement.reason === "payload_too_thin"
              ? "payload_too_thin"
            : "no_free_unlocks",
        message: response.entitlement.alreadyUnlocked
          ? "This vehicle is already unlocked."
          : response.entitlement.allowed
            ? "Free unlock applied. This vehicle is now fully unlocked."
            : response.entitlement.reason === "payload_too_thin"
              ? "We found the vehicle, but there is not enough useful detail yet to make an unlock worth it."
            : "No free unlocks remaining. Upgrade to Pro for full access.",
      };
    } catch (error) {
      const unlockState = await loadFreeUnlockState(user.id);
      const code =
        typeof error === "object" && error && "code" in error && typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : null;
      const reason =
        code === "VEHICLE_NOT_FOUND"
          ? "vehicle_not_found"
          : code === "AUTH_REQUIRED"
            ? "auth_required"
            : code === "BACKEND_UNREACHABLE" || code === "REQUEST_TIMEOUT"
              ? "network_error"
              : "unknown";
      const message =
        code === "VEHICLE_NOT_FOUND"
          ? "This vehicle can be viewed, but it is not unlockable yet. Try another catalog-linked result."
          : code === "AUTH_REQUIRED"
            ? "Sign in to use your free unlocks on this device."
            : error instanceof Error
              ? error.message
              : "We couldn’t apply your free unlock right now.";
      return {
        ok: false,
        state: unlockState,
        remaining: Math.max(0, FREE_UNLOCKS_LIMIT - unlockState.used),
        limit: FREE_UNLOCKS_LIMIT,
        alreadyUnlocked: unlockState.unlockedVehicleIds.includes(vehicleId),
        reason,
        message,
      };
    }
  },

  resetStatus() {
    status = applyPlanOverride({
      ...defaultSubscriptionStatus,
      isActive: false,
      provider: "placeholder",
      productId: null,
      willAutoRenew: false,
      lastVerifiedAt: null,
      purchaseAvailable: false,
    });
  },

  async fetchActiveSubscriptionState(): Promise<SubscriptionStatus> {
    return this.getStatus();
  },

  async purchaseSubscription(): Promise<SubscriptionActionResult> {
    console.log("[subscription] PURCHASE_FLOW_START");
    console.log("[subscription] PURCHASE_PRODUCTS_LOAD_START");
    const purchase = await purchaseService.purchasePro();
    console.log("[subscription] PURCHASE_PRODUCTS_LOAD_SUCCESS", {
      configured: purchase.snapshot.purchaseAvailable,
      products: purchase.snapshot.availableProducts.map((product) => product.productId),
    });
    console.log("[subscription] PURCHASE_ATTEMPT_START", { configured: purchase.snapshot.purchaseAvailable });
    if (purchase.outcome === "verified" && purchase.snapshot.activeEntitlement?.isActive) {
      status = mergeUsageStatus(await scanService.getUsage().catch(() => status), {
        plan: "pro",
        provider: "revenuecat",
        productId: purchase.snapshot.activeProductId,
        willAutoRenew: purchase.snapshot.activeEntitlement.willRenew,
        lastVerifiedAt: purchase.snapshot.activeEntitlement.latestPurchaseDate,
        purchaseAvailable: purchase.snapshot.purchaseAvailable,
        purchaseAvailabilityState: purchase.snapshot.purchaseAvailabilityState,
        availableProducts: purchase.snapshot.availableProducts,
        renewalLabel: formatRenewalLabel("pro", purchase.snapshot.activeEntitlement.expirationDate ?? undefined),
      });
      console.log("[subscription] PURCHASE_ATTEMPT_SUCCESS", {
        outcome: "verified",
        productId: purchase.snapshot.activeProductId,
      });
      return {
        outcome: "verified",
        status,
        message: purchase.message,
      };
    }
    console.log("[subscription] PURCHASE_ATTEMPT_FAILURE", { stage: purchase.outcome, message: purchase.message });
    console.log("[subscription] PURCHASE_FLOW_FAILURE", { stage: purchase.outcome, message: purchase.message });
    status = mergeUsageStatus(await scanService.getUsage().catch(() => status), {
      purchaseAvailable: purchase.snapshot.purchaseAvailable,
      purchaseAvailabilityState: purchase.snapshot.purchaseAvailabilityState,
      availableProducts: purchase.snapshot.availableProducts,
    });
    return {
      outcome: "not_configured",
      status,
      message: purchase.message,
    };
  },

  async restorePurchases(): Promise<SubscriptionActionResult> {
    console.log("[subscription] RESTORE_PURCHASES_START");
    const restore = await purchaseService.restorePurchases();
    if (restore.outcome === "restored" && restore.snapshot.activeEntitlement?.isActive) {
      status = mergeUsageStatus(await scanService.getUsage().catch(() => status), {
        plan: "pro",
        provider: "revenuecat",
        productId: restore.snapshot.activeProductId,
        willAutoRenew: restore.snapshot.activeEntitlement.willRenew,
        lastVerifiedAt: restore.snapshot.activeEntitlement.latestPurchaseDate,
        purchaseAvailable: restore.snapshot.purchaseAvailable,
        purchaseAvailabilityState: restore.snapshot.purchaseAvailabilityState,
        availableProducts: restore.snapshot.availableProducts,
        renewalLabel: formatRenewalLabel("pro", restore.snapshot.activeEntitlement.expirationDate ?? undefined),
      });
      console.log("[subscription] RESTORE_PURCHASES_SUCCESS", { outcome: "restored", active: true });
      return {
        outcome: "restored",
        status,
        message: restore.message,
      };
    }
    console.log("[subscription] RESTORE_PURCHASES_FAILURE", { stage: restore.outcome, message: restore.message });
    status = mergeUsageStatus(await scanService.getUsage().catch(() => status), {
      purchaseAvailable: restore.snapshot.purchaseAvailable,
      purchaseAvailabilityState: restore.snapshot.purchaseAvailabilityState,
      availableProducts: restore.snapshot.availableProducts,
    });
    return {
      outcome: "not_configured",
      status,
      message: restore.message,
    };
  },

  async cancelSubscription(): Promise<SubscriptionActionResult> {
    if (!(await authService.getAccessToken())) {
      throw new Error("Sign in to manage your subscription.");
    }
    const record = await apiRequest<BackendSubscriptionRecord>({
      path: "/api/subscription/cancel",
      method: "POST",
    });

    const usage = await scanService.getUsage().catch(() => status);

    status = mergeUsageStatus(usage, {
      plan: record.plan,
      isActive: false,
      provider: "backend",
      productId: null,
      willAutoRenew: false,
      lastVerifiedAt: record.verifiedAt,
      purchaseAvailable: false,
      renewalLabel: "Free plan",
    });

    return {
      outcome: "cancelled",
      status,
      message: "Pro access cancelled. You’re back on the free plan.",
    };
  },

  async syncSubscriptionToBackend(payload: SubscriptionVerifyPayload): Promise<SubscriptionActionResult> {
    const record = await apiRequest<BackendSubscriptionRecord>({
      path: "/api/subscription/verify",
      method: "POST",
      body: {
        platform: payload.platform,
        productId: payload.productId,
        receiptData: payload.receiptData,
      },
      headers: payload.accessToken ? { Authorization: `Bearer ${payload.accessToken}` } : undefined,
    });

    const usage = await scanService.getUsage().catch(() => status);

    status = mergeUsageStatus(usage, {
      plan: record.plan,
      isActive: record.plan === "pro" && record.status === "active",
      provider: "backend",
      productId: record.productId,
      willAutoRenew: record.plan === "pro" && record.status === "active",
      lastVerifiedAt: record.verifiedAt,
      purchaseAvailable: false,
      renewalLabel: formatRenewalLabel(record.plan, record.expiresAt),
    });

    return {
      outcome: "verified",
      status,
      message: record.plan === "pro" ? "Your Pro access is now synced." : "Subscription sync completed.",
    };
  },
};
