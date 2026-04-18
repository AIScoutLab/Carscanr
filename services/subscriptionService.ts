import AsyncStorage from "@react-native-async-storage/async-storage";
import { defaultSubscriptionStatus } from "@/constants/seedData";
import { applyPlanOverride } from "@/features/subscription/planOverride";
import { apiRequest } from "@/services/apiClient";
import { authService } from "@/services/authService";
import { scanService } from "@/services/scanService";
import { wait } from "@/lib/utils";
import { SubscriptionActionResult, SubscriptionProduct, SubscriptionStatus, SubscriptionVerifyPayload } from "@/types";

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
  reason:
    | "already_unlocked"
    | "consumed"
    | "no_free_unlocks"
    | "vehicle_not_found"
    | "auth_required"
    | "network_error"
    | "unknown";
  message: string;
};

const FREE_UNLOCKS_LIMIT = 5;
const FREE_UNLOCK_STORAGE_KEY = "carscanr.freeUnlocks.v1";

type FreeUnlockState = {
  used: number;
  unlockedVehicleIds: string[];
};

const PRO_MONTHLY_PRODUCT: SubscriptionProduct = {
  productId: "com.caridentifier.pro.monthly",
  platform: "ios",
  plan: "pro",
  priceLabel: "$6.99",
  billingPeriodLabel: "month",
};

const SUBSCRIPTION_PLACEHOLDER_MESSAGE =
  "Purchases are not wired yet. Connect StoreKit 2 or RevenueCat, then send the App Store receipt to your backend.";
const PURCHASE_NOT_AVAILABLE_MESSAGE =
  "In-app purchase is not live in this build yet. Scanning still works, and you can keep using your remaining free Pro unlocks.";

function normalizeUnlockState(input: unknown): FreeUnlockState {
  if (!input || typeof input !== "object") {
    return { used: 0, unlockedVehicleIds: [] };
  }
  const raw = input as Partial<FreeUnlockState>;
  const used = typeof raw.used === "number" && Number.isFinite(raw.used) ? Math.max(0, raw.used) : 0;
  const unlockedVehicleIds = Array.isArray(raw.unlockedVehicleIds)
    ? raw.unlockedVehicleIds.filter((id) => typeof id === "string" && id.length > 0)
    : [];
  return { used, unlockedVehicleIds };
}

async function loadFreeUnlockState(userId: string): Promise<FreeUnlockState> {
  const key = `${FREE_UNLOCK_STORAGE_KEY}:${userId}`;
  const stored = await AsyncStorage.getItem(key);
  if (!stored) {
    return { used: 0, unlockedVehicleIds: [] };
  }
  try {
    return normalizeUnlockState(JSON.parse(stored));
  } catch {
    await AsyncStorage.removeItem(key);
    return { used: 0, unlockedVehicleIds: [] };
  }
}

async function saveFreeUnlockState(userId: string, state: FreeUnlockState) {
  const key = `${FREE_UNLOCK_STORAGE_KEY}:${userId}`;
  await AsyncStorage.setItem(key, JSON.stringify(state));
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
    renewalLabel: formatRenewalLabel(usage.plan),
    ...overrides,
  });
}

export const subscriptionService = {
  async getStatus(): Promise<SubscriptionStatus> {
    try {
      const usage = await scanService.getUsage();
      status = mergeUsageStatus(usage, {
        renewalLabel: usage.renewalLabel,
        lastVerifiedAt: status.lastVerifiedAt ?? null,
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
    if (!token) {
      if (__DEV__) {
        console.log("[subscription] unlock status skipped (no auth token)");
      }
      const unlockState = await loadFreeUnlockState(user?.id ?? "guest");
      const remaining = Math.max(0, FREE_UNLOCKS_LIMIT - unlockState.used);
      return {
        used: unlockState.used,
        remaining,
        unlockedVehicleIds: unlockState.unlockedVehicleIds,
        limit: FREE_UNLOCKS_LIMIT,
      };
    }
    const cached = scanService.getCachedUnlockStatus?.();
    if (cached && typeof cached.freeUnlocksTotal === "number") {
      const unlockState = {
        used: cached.freeUnlocksUsed,
        unlockedVehicleIds: cached.unlockedVehicleIds ?? [],
      };
      if (user?.id) {
        await saveFreeUnlockState(user.id, unlockState);
      }
      return {
        used: cached.freeUnlocksUsed,
        remaining: cached.freeUnlocksRemaining,
        unlockedVehicleIds: unlockState.unlockedVehicleIds,
        limit: cached.freeUnlocksTotal,
      };
    }
    try {
      if (!user?.id) {
        throw new Error("No user session available.");
      }
      const status = await apiRequest<BackendUnlockStatus>({
        path: "/api/unlocks/status",
      });
      const remaining = Math.max(0, status.freeUnlocksRemaining ?? status.freeUnlocksTotal - status.freeUnlocksUsed);
      const unlockState = {
        used: status.freeUnlocksUsed,
        unlockedVehicleIds: status.unlockedVehicleIds ?? [],
      };
      await saveFreeUnlockState(user.id, unlockState);
      return {
        used: status.freeUnlocksUsed,
        remaining,
        unlockedVehicleIds: status.unlockedVehicleIds ?? [],
        limit: status.freeUnlocksTotal ?? FREE_UNLOCKS_LIMIT,
      };
    } catch {
      const unlockState = await loadFreeUnlockState(user?.id ?? "guest");
      const remaining = Math.max(0, FREE_UNLOCKS_LIMIT - unlockState.used);
      return {
        used: unlockState.used,
        remaining,
        unlockedVehicleIds: unlockState.unlockedVehicleIds,
        limit: FREE_UNLOCKS_LIMIT,
      };
    }
  },

  async useFreeUnlockForVehicle(vehicleId: string): Promise<FreeUnlockActionResult> {
    const user = await authService.getCurrentUser();
    const token = await authService.getAccessToken();
    if (!token) {
      const unlockState = await loadFreeUnlockState(user?.id ?? "guest");
      const alreadyUnlocked = unlockState.unlockedVehicleIds.includes(vehicleId);
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

      if (unlockState.used >= FREE_UNLOCKS_LIMIT) {
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
        used: unlockState.used + 1,
        unlockedVehicleIds: [...unlockState.unlockedVehicleIds, vehicleId],
      };
      await saveFreeUnlockState(user?.id ?? "guest", nextState);
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
      const unlockState = {
        used: status.freeUnlocksUsed,
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
            : "no_free_unlocks",
        message: response.entitlement.alreadyUnlocked
          ? "This vehicle is already unlocked."
          : response.entitlement.allowed
            ? "Free unlock applied. This vehicle is now fully unlocked."
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
    await wait(400);
    console.log("[subscription] PURCHASE_PRODUCTS_LOAD_SUCCESS", { configured: false });
    console.log("[subscription] PURCHASE_PRODUCTS_LOAD_FAILURE", {
      stage: "not_configured",
      message: PURCHASE_NOT_AVAILABLE_MESSAGE,
    });
    console.log("[subscription] PURCHASE_ATTEMPT_START", { configured: false });
    if (status.plan === "pro" && status.provider === "backend") {
      console.log("[subscription] PURCHASE_ATTEMPT_SUCCESS", { outcome: "already_active" });
      return {
        outcome: "verified",
        status,
        message: "Your Pro access is already active.",
      };
    }

    console.log("[subscription] PURCHASE_ATTEMPT_FAILURE", {
      stage: "not_configured",
      message: PURCHASE_NOT_AVAILABLE_MESSAGE,
    });
    console.log("[subscription] PURCHASE_FLOW_FAILURE", {
      stage: "not_configured",
      message: PURCHASE_NOT_AVAILABLE_MESSAGE,
    });
    return {
      outcome: "not_configured",
      status,
      message: PURCHASE_NOT_AVAILABLE_MESSAGE,
    };
  },

  async restorePurchases(): Promise<SubscriptionActionResult> {
    console.log("[subscription] RESTORE_PURCHASES_START");
    await wait(500);
    if (status.plan === "pro" && status.provider === "backend") {
      console.log("[subscription] RESTORE_PURCHASES_SUCCESS", { outcome: "restored", alreadyActive: true });
      return {
        outcome: "restored",
        status,
        message: "Your Pro access is already restored on this device.",
      };
    }

    console.log("[subscription] RESTORE_PURCHASES_FAILURE", {
      stage: "not_configured",
      message: SUBSCRIPTION_PLACEHOLDER_MESSAGE,
    });
    return {
      outcome: "not_configured",
      status,
      message: SUBSCRIPTION_PLACEHOLDER_MESSAGE,
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
