import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { defaultSubscriptionStatus } from "@/constants/seedData";
import { FREE_PRO_UNLOCKS_TOTAL } from "@/constants/product";
import { subscriptionService } from "@/services/subscriptionService";
import { FreeUnlockReason, SubscriptionActionResult, SubscriptionStatus } from "@/types";

type FreeUnlockVehicleLookup = Parameters<typeof subscriptionService.useFreeUnlockForVehicle>[2];

type SubscriptionContextValue = {
  status: SubscriptionStatus | null;
  isLoading: boolean;
  isPurchasing: boolean;
  isRestoring: boolean;
  isCancelling: boolean;
  isUnlocking: boolean;
  freeUnlocksUsed: number;
  freeUnlocksRemaining: number;
  freeUnlocksLimit: number;
  unlockCredits: number;
  unlockedVehicleIds: string[];
  feedbackMessage: string | null;
  errorMessage: string | null;
  refreshStatus: () => Promise<SubscriptionStatus | null>;
  purchasePro: (selectedProductKey?: string | null) => Promise<SubscriptionActionResult>;
  restorePurchases: () => Promise<SubscriptionActionResult>;
  cancelPro: () => Promise<SubscriptionActionResult>;
  useFreeUnlockForVehicle: (
    vehicleId: string,
    linkedVehicleIds?: string[],
    lookup?: FreeUnlockVehicleLookup | null,
  ) => Promise<{ ok: boolean; message: string; reason: FreeUnlockReason; alreadyUnlocked: boolean }>;
  isVehicleUnlocked: (vehicleId: string) => boolean;
  clearFeedback: () => void;
};

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [freeUnlocksUsed, setFreeUnlocksUsed] = useState(0);
  const [freeUnlocksRemaining, setFreeUnlocksRemaining] = useState(FREE_PRO_UNLOCKS_TOTAL);
  const [freeUnlocksLimit, setFreeUnlocksLimit] = useState(FREE_PRO_UNLOCKS_TOTAL);
  const [unlockCredits, setUnlockCredits] = useState(0);
  const [unlockedVehicleIds, setUnlockedVehicleIds] = useState<string[]>([]);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setErrorMessage(null);
      const nextStatus = await subscriptionService.getStatus();
      const unlockState = await subscriptionService.getFreeUnlockState();
      setStatus(nextStatus);
      setFreeUnlocksUsed(unlockState.used);
      setFreeUnlocksRemaining(unlockState.remaining);
      setFreeUnlocksLimit(unlockState.limit);
      setUnlockCredits(unlockState.unlockCredits ?? 0);
      setUnlockedVehicleIds(unlockState.unlockedVehicleIds);
      return nextStatus;
    } catch (error) {
      setStatus(defaultSubscriptionStatus);
      setFreeUnlocksUsed(0);
      setFreeUnlocksRemaining(FREE_PRO_UNLOCKS_TOTAL);
      setFreeUnlocksLimit(FREE_PRO_UNLOCKS_TOTAL);
      setUnlockCredits(0);
      setUnlockedVehicleIds([]);
      setErrorMessage(error instanceof Error ? error.message : "Unable to refresh your plan right now.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const purchasePro = useCallback(async (selectedProductKey?: string | null) => {
    try {
      setIsPurchasing(true);
      setErrorMessage(null);
      const result = await subscriptionService.purchaseSubscription(selectedProductKey);
      const unlockState = await subscriptionService.getFreeUnlockState();
      setStatus(result.status);
      setFreeUnlocksUsed(unlockState.used);
      setFreeUnlocksRemaining(unlockState.remaining);
      setFreeUnlocksLimit(unlockState.limit);
      setUnlockCredits(unlockState.unlockCredits ?? 0);
      setUnlockedVehicleIds(unlockState.unlockedVehicleIds);
      setFeedbackMessage(result.message);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start purchases right now.";
      setErrorMessage(message);
      throw error;
    } finally {
      setIsPurchasing(false);
    }
  }, []);

  const restorePurchases = useCallback(async () => {
    try {
      setIsRestoring(true);
      setErrorMessage(null);
      console.log("FREE_UNLOCK_COUNTER_STATE_BEFORE_RESTORE", {
        used: freeUnlocksUsed,
        remaining: freeUnlocksRemaining,
        limit: freeUnlocksLimit,
      });
      const result = await subscriptionService.restorePurchases();
      setStatus(result.status);
      setFeedbackMessage(result.message);
      console.log("FREE_UNLOCK_COUNTER_STATE_AFTER_RESTORE", {
        used: freeUnlocksUsed,
        remaining: freeUnlocksRemaining,
        limit: freeUnlocksLimit,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to restore purchases right now.";
      setErrorMessage(message);
      throw error;
    } finally {
      setIsRestoring(false);
    }
  }, [freeUnlocksLimit, freeUnlocksRemaining, freeUnlocksUsed]);

  const cancelPro = useCallback(async () => {
    try {
      setIsCancelling(true);
      setErrorMessage(null);
      const result = await subscriptionService.cancelSubscription();
      setStatus(result.status);
      setFeedbackMessage(result.message);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open subscription management right now.";
      setErrorMessage(message);
      throw error;
    } finally {
      setIsCancelling(false);
    }
  }, []);

  const useFreeUnlockForVehicle = useCallback<SubscriptionContextValue["useFreeUnlockForVehicle"]>(async (vehicleId, linkedVehicleIds = [], lookup = null) => {
    if (isUnlocking) {
      return {
        ok: false,
        message: "Unlock already in progress.",
        reason: "unknown",
        alreadyUnlocked: false,
      };
    }
    if (!vehicleId) {
      return {
        ok: false,
        message: "This vehicle cannot be unlocked yet.",
        reason: "vehicle_not_found",
        alreadyUnlocked: false,
      };
    }
    try {
      setIsUnlocking(true);
      setErrorMessage(null);
      const result = await subscriptionService.useFreeUnlockForVehicle(vehicleId, linkedVehicleIds, lookup);
      setFreeUnlocksUsed(result.state.used);
      setFreeUnlocksRemaining(result.remaining);
      setFreeUnlocksLimit(result.limit);
      setUnlockCredits(result.unlockCredits ?? 0);
      setUnlockedVehicleIds(result.state.unlockedVehicleIds);
      if (!result.ok) {
        if (result.reason === "no_free_unlocks") {
          setFeedbackMessage(result.message);
        } else {
          setErrorMessage(result.message);
        }
        return {
          ok: false,
          message: result.message,
          reason: result.reason,
          alreadyUnlocked: result.alreadyUnlocked,
        };
      }
      if (result.alreadyUnlocked) {
        setFeedbackMessage(result.message);
      } else {
        setFeedbackMessage(result.message);
      }
      return {
        ok: true,
        message: result.message,
        reason: result.reason,
        alreadyUnlocked: result.alreadyUnlocked,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to use a free unlock right now.";
      setErrorMessage(message);
      return {
        ok: false,
        message,
        reason: "unknown",
        alreadyUnlocked: false,
      };
    } finally {
      setIsUnlocking(false);
    }
  }, [isUnlocking]);

  const isVehicleUnlocked = useCallback((vehicleId: string) => unlockedVehicleIds.includes(vehicleId), [unlockedVehicleIds]);

  const clearFeedback = useCallback(() => {
    setFeedbackMessage(null);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        setErrorMessage(null);
        const nextStatus = await subscriptionService.getStatus();
        const unlockState = await subscriptionService.getFreeUnlockState();
        if (!active) return;
        setStatus(nextStatus);
        setFreeUnlocksUsed(unlockState.used);
        setFreeUnlocksRemaining(unlockState.remaining);
        setFreeUnlocksLimit(unlockState.limit);
        setUnlockCredits(unlockState.unlockCredits ?? 0);
        setUnlockedVehicleIds(unlockState.unlockedVehicleIds);
      } catch (error) {
        if (!active) return;
        setStatus(defaultSubscriptionStatus);
        setFreeUnlocksUsed(0);
        setFreeUnlocksRemaining(FREE_PRO_UNLOCKS_TOTAL);
        setFreeUnlocksLimit(FREE_PRO_UNLOCKS_TOTAL);
        setUnlockCredits(0);
        setUnlockedVehicleIds([]);
        setErrorMessage(error instanceof Error ? error.message : "Unable to refresh your plan right now.");
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    hydrate().catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(
    () => ({
      status,
      isLoading,
      isPurchasing,
      isRestoring,
      isCancelling,
      isUnlocking,
      freeUnlocksUsed,
      freeUnlocksRemaining,
      freeUnlocksLimit,
      unlockedVehicleIds,
      unlockCredits,
      feedbackMessage,
      errorMessage,
      refreshStatus,
      purchasePro,
      restorePurchases,
      cancelPro,
      useFreeUnlockForVehicle,
      isVehicleUnlocked,
      clearFeedback,
    }),
    [
      errorMessage,
      feedbackMessage,
      freeUnlocksLimit,
      freeUnlocksRemaining,
      freeUnlocksUsed,
      unlockCredits,
      isCancelling,
      isLoading,
      isPurchasing,
      isRestoring,
      isUnlocking,
      status,
      unlockedVehicleIds,
      refreshStatus,
      purchasePro,
      restorePurchases,
      cancelPro,
      useFreeUnlockForVehicle,
      isVehicleUnlocked,
      clearFeedback,
    ],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscriptionContext() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error("useSubscriptionContext must be used inside SubscriptionProvider.");
  }
  return context;
}
