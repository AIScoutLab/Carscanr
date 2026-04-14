import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { defaultSubscriptionStatus } from "@/constants/seedData";
import { subscriptionService } from "@/services/subscriptionService";
import { SubscriptionActionResult, SubscriptionStatus } from "@/types";

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
  unlockedVehicleIds: string[];
  feedbackMessage: string | null;
  errorMessage: string | null;
  refreshStatus: () => Promise<SubscriptionStatus | null>;
  purchasePro: () => Promise<SubscriptionActionResult>;
  restorePurchases: () => Promise<SubscriptionActionResult>;
  cancelPro: () => Promise<SubscriptionActionResult>;
  useFreeUnlockForVehicle: (vehicleId: string) => Promise<boolean>;
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
  const [freeUnlocksRemaining, setFreeUnlocksRemaining] = useState(5);
  const [freeUnlocksLimit, setFreeUnlocksLimit] = useState(5);
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
      setUnlockedVehicleIds(unlockState.unlockedVehicleIds);
      return nextStatus;
    } catch (error) {
      setStatus(defaultSubscriptionStatus);
      setFreeUnlocksUsed(0);
      setFreeUnlocksRemaining(5);
      setFreeUnlocksLimit(5);
      setUnlockedVehicleIds([]);
      setErrorMessage(error instanceof Error ? error.message : "Unable to refresh your plan right now.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const purchasePro = useCallback(async () => {
    try {
      setIsPurchasing(true);
      setErrorMessage(null);
      const result = await subscriptionService.purchaseSubscription();
      setStatus(result.status);
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
      const result = await subscriptionService.restorePurchases();
      setStatus(result.status);
      setFeedbackMessage(result.message);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to restore purchases right now.";
      setErrorMessage(message);
      throw error;
    } finally {
      setIsRestoring(false);
    }
  }, []);

  const cancelPro = useCallback(async () => {
    try {
      setIsCancelling(true);
      setErrorMessage(null);
      const result = await subscriptionService.cancelSubscription();
      setStatus(result.status);
      setFeedbackMessage(result.message);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to cancel Pro right now.";
      setErrorMessage(message);
      throw error;
    } finally {
      setIsCancelling(false);
    }
  }, []);

  const useFreeUnlockForVehicle = useCallback(async (vehicleId: string) => {
    if (isUnlocking) return false;
    if (!vehicleId) return false;
    try {
      setIsUnlocking(true);
      setErrorMessage(null);
      const result = await subscriptionService.useFreeUnlockForVehicle(vehicleId);
      setFreeUnlocksUsed(result.state.used);
      setFreeUnlocksRemaining(result.remaining);
      setFreeUnlocksLimit(result.limit);
      setUnlockedVehicleIds(result.state.unlockedVehicleIds);
      if (!result.ok) {
        setFeedbackMessage("No free unlocks remaining. Upgrade to Pro for full access.");
        return false;
      }
      if (!result.alreadyUnlocked) {
        setFeedbackMessage("Free unlock applied. This vehicle is now fully unlocked.");
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to use a free unlock right now.";
      setErrorMessage(message);
      return false;
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
        setUnlockedVehicleIds(unlockState.unlockedVehicleIds);
      } catch (error) {
        if (!active) return;
        setStatus(defaultSubscriptionStatus);
        setFreeUnlocksUsed(0);
        setFreeUnlocksRemaining(5);
        setFreeUnlocksLimit(5);
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
