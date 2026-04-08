import { getDevPlanOverride } from "@/lib/env";
import { SubscriptionStatus, UserPlan } from "@/types";

function getPlanOverride(): UserPlan | null {
  return getDevPlanOverride();
}

export function applyPlanOverride(status: SubscriptionStatus): SubscriptionStatus {
  const override = getPlanOverride();

  if (!override) {
    return status;
  }

  const backendBacked = status.provider === "backend";

  return {
    ...status,
    plan: override,
    renewalLabel:
      override === "pro"
        ? backendBacked
          ? status.renewalLabel
          : "Pro active on this device"
        : "Free plan on this device",
    scansRemaining: override === "pro" ? null : Math.max((status.limit ?? 5) - status.scansUsed, 0),
    limitType: "lifetime",
    limit: override === "pro" ? null : status.limit ?? 5,
    dailyScanLimit: override === "pro" ? null : status.dailyScanLimit ?? 5,
    isActive: override === "pro",
    provider: override === "pro" ? status.provider ?? "placeholder" : status.provider,
    willAutoRenew: override === "pro" ? true : status.willAutoRenew,
  };
}
