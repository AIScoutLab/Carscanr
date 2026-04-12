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
    return "Upgrade for unlimited scans";
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

  async useFreeUnlockForVehicle(vehicleId: string) {
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
        };
      }

      if (unlockState.used >= FREE_UNLOCKS_LIMIT) {
        return {
          ok: false,
          state: unlockState,
          remaining: 0,
          limit: FREE_UNLOCKS_LIMIT,
          alreadyUnlocked: false,
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
      };
    } catch {
      const unlockState = await loadFreeUnlockState(user.id);
      return {
        ok: false,
        state: unlockState,
        remaining: Math.max(0, FREE_UNLOCKS_LIMIT - unlockState.used),
        limit: FREE_UNLOCKS_LIMIT,
        alreadyUnlocked: unlockState.unlockedVehicleIds.includes(vehicleId),
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
    if (!(await authService.getAccessToken())) {
      throw new Error("Sign in to manage subscriptions and restore purchases across devices.");
    }
    await wait(400);
    if (status.plan === "pro" && status.provider === "backend") {
      return {
        outcome: "verified",
        status,
        message: "Your Pro access is already active.",
      };
    }

    return {
      outcome: "not_configured",
      status,
      message: SUBSCRIPTION_PLACEHOLDER_MESSAGE,
    };
  },

  async restorePurchases(): Promise<SubscriptionActionResult> {
    if (!(await authService.getAccessToken())) {
      throw new Error("Sign in to restore purchases across devices.");
    }
    await wait(500);
    if (status.plan === "pro" && status.provider === "backend") {
      return {
        outcome: "restored",
        status,
        message: "Your Pro access is already restored on this device.",
      };
    }

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
