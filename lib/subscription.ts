import { BillingProvider, PurchaseAvailabilityState, SubscriptionStatus, UserPlan } from "@/types";

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

function isTrustedEntitlementProvider(provider?: BillingProvider | null) {
  return provider === "backend" || provider === "revenuecat" || provider === "storekit";
}

export function hasAuthoritativeProEntitlement(status?: SubscriptionStatus | null) {
  if (!status || !isTrustedEntitlementProvider(status.provider)) {
    return false;
  }
  if (status.isActive === true) {
    return true;
  }
  if (status.isActive === false) {
    return false;
  }
  return isProPlan(status.plan);
}

function isUpgradeOrFreeCopy(label: string) {
  const normalized = label.toLowerCase();
  return (
    normalized.includes("free plan") ||
    normalized.includes("free unlock") ||
    normalized.includes("upgrade") ||
    normalized.includes("keep free access")
  );
}

function getProDetailLabel(status: SubscriptionStatus | null | undefined, primaryLabel: string) {
  const label = status?.renewalLabel?.trim();
  if (!label || isUpgradeOrFreeCopy(label)) {
    return null;
  }
  const normalizedLabel = label.toLowerCase();
  const normalizedPrimary = primaryLabel.toLowerCase();
  if (normalizedLabel === normalizedPrimary || (normalizedLabel.startsWith("pro") && normalizedLabel.includes("active"))) {
    return null;
  }
  return label;
}

export type ProfileAccessState = {
  mode: "loading" | "pro" | "free";
  hasProEntitlement: boolean;
  planLabel: string;
  renewalLabel: string | null;
  showFreeUnlockUsage: boolean;
  showUpgradeOptions: boolean;
  showPaywallCard: boolean;
  showPrimaryUpgradeCta: boolean;
  showRestorePurchases: boolean;
  purchaseAvailabilityState: PurchaseAvailabilityState;
};

export function resolveProfileAccessState(status?: SubscriptionStatus | null, isLoading = false): ProfileAccessState {
  const hasProEntitlement = hasAuthoritativeProEntitlement(status);
  const purchaseAvailabilityState = status?.purchaseAvailabilityState ?? "not_configured";
  const mode: ProfileAccessState["mode"] = isLoading ? "loading" : hasProEntitlement ? "pro" : "free";
  const qaConfigurationMessage =
    purchaseAvailabilityState === "preview_only"
      ? "Purchases and restore require a development or production build."
      : purchaseAvailabilityState === "offerings_empty"
        ? "RevenueCat is configured, but no purchasable packages were returned."
      : purchaseAvailabilityState === "not_configured"
        ? "RevenueCat purchases are not configured for this build."
        : null;
  const primaryProLabel = getProActiveLabel(status);
  const planLabel = mode === "loading" ? "Checking plan..." : mode === "pro" ? primaryProLabel : "Free plan";
  const renewalLabel =
    mode === "loading"
      ? null
      : mode === "pro"
        ? getProDetailLabel(status, primaryProLabel)
        : qaConfigurationMessage ?? "Free unlocks are available on this account.";

  const resolved = {
    mode,
    hasProEntitlement,
    planLabel,
    renewalLabel,
    showFreeUnlockUsage: mode === "free",
    showUpgradeOptions: mode === "free",
    showPaywallCard: mode === "free",
    showPrimaryUpgradeCta: mode === "free",
    showRestorePurchases: true,
    purchaseAvailabilityState,
  } satisfies ProfileAccessState;

  return resolved;
}
