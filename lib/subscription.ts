import { SubscriptionStatus, UserPlan } from "@/types";

export function isProPlan(plan?: UserPlan | null) {
  return plan === "pro" || plan === "pro_monthly" || plan === "pro_yearly";
}

export function getPlanDisplayName(plan?: UserPlan | null) {
  if (plan === "pro_yearly") {
    return "Pro yearly";
  }
  if (plan === "pro_monthly") {
    return "Pro monthly";
  }
  if (isProPlan(plan)) {
    return "Pro";
  }
  return "Free";
}

function productLooksYearly(productId?: string | null) {
  const normalized = productId?.toLowerCase() ?? "";
  return normalized.includes("year") || normalized.includes("annual");
}

function productLooksMonthly(productId?: string | null) {
  const normalized = productId?.toLowerCase() ?? "";
  return normalized.includes("month");
}

export function getProActiveLabel(status?: SubscriptionStatus | null) {
  if (status?.plan === "pro_yearly" || productLooksYearly(status?.productId)) {
    return "Pro yearly active";
  }
  if (status?.plan === "pro_monthly" || productLooksMonthly(status?.productId)) {
    return "Pro monthly active";
  }
  return "Pro active";
}

export function hasAuthoritativeProEntitlement(status?: SubscriptionStatus | null) {
  if (!status || !isProPlan(status.plan)) {
    return false;
  }
  if (status.provider === "backend" || status.provider === "revenuecat" || status.provider === "storekit") {
    return true;
  }
  return Boolean(status.isActive && status.purchaseAvailabilityState !== "not_configured");
}

export function resolveProfileAccessState(status?: SubscriptionStatus | null, isLoading = false) {
  const hasProEntitlement = hasAuthoritativeProEntitlement(status);
  const purchaseAvailabilityState = status?.purchaseAvailabilityState ?? "not_configured";
  const qaConfigurationMessage =
    purchaseAvailabilityState === "preview_only"
      ? "Purchases and restore require a development or production build."
      : purchaseAvailabilityState === "not_configured"
        ? "RevenueCat purchases are not configured for this build."
        : null;
  const renewalLabel = hasProEntitlement
    ? status?.renewalLabel && !status.renewalLabel.toLowerCase().includes("free plan")
      ? status.renewalLabel
      : getProActiveLabel(status)
    : qaConfigurationMessage ?? "Free unlocks are available on this account.";

  const resolved = {
    hasProEntitlement,
    planLabel: isLoading ? "Checking plan..." : hasProEntitlement ? getProActiveLabel(status) : "Free plan",
    renewalLabel,
    showFreeUnlockUsage: !hasProEntitlement,
    showUpgradeOptions: !hasProEntitlement,
    showRestorePurchases: true,
    purchaseAvailabilityState,
  };

  return resolved;
}
