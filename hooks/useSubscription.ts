import { useSubscriptionContext } from "@/features/subscription/SubscriptionProvider";

export function useSubscription() {
  return useSubscriptionContext();
}
