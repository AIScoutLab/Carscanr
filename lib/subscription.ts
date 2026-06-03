import { BillingProvider, PurchaseAvailabilityState, SubscriptionStatus, UserPlan } from "@/types";
import { getPurchaseOptionKindFromProductMetadata, isSubscriptionPurchaseOptionKind } from "@/lib/purchaseOptions";

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
  return provider === "backend";
}

function hasSubscriptionProduct(status?: SubscriptionStatus | null) {
  if (isProPlan(status?.plan)) {
    return true;
  }
  return isSubscriptionPurchaseOptionKind(getPurchaseOptionKindFromProductMetadata({ productId: status?.productId }));
}

export function hasAuthoritativeProEntitlement(status?: SubscriptionStatus | null) {
  if (!status || !isTrustedEntitlementProvider(status.provider)) {
    return false;
  }
  if (status.isActive === true) {
    return hasSubscriptionProduct(status);
  }
  if (status.isActive === false) {
    return false;
  }
  return isProPlan(status.plan);
}

function hasPendingRevenueCatProSync(status?: SubscriptionStatus | null) {
  return status?.entitlementSyncState === "revenuecat_active_backend_pending";
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

export function getPurchaseAvailabilityMessage(state: PurchaseAvailabilityState) {
  switch (state) {
    case "preview_only":
      return "Purchases and restore require a development or production build.";
    case "not_configured":
      return "RevenueCat configuration is missing from this build.";
    case "configure_failed":
      return "RevenueCat configuration failed at runtime.";
    case "offerings_unavailable":
      return "RevenueCat is configured, but offerings could not be loaded.";
    case "offerings_empty":
      return "RevenueCat is configured, but no purchasable packages were returned.";
    case "customer_info_unavailable":
      return "RevenueCat is configured, but customer info could not be loaded.";
    case "ready":
      return null;
    default:
      return null;
  }
}

export type ProfileAccessState = {
  mode: "loading" | "pro" | "free";
  hasProEntitlement: boolean;
  hasPendingProSync: boolean;
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
  const hasPendingProSync = !hasProEntitlement && hasPendingRevenueCatProSync(status);
  const purchaseAvailabilityState = status?.purchaseAvailabilityState ?? "not_configured";
  const mode: ProfileAccessState["mode"] = isLoading ? "loading" : hasProEntitlement ? "pro" : "free";
  const qaConfigurationMessage = getPurchaseAvailabilityMessage(purchaseAvailabilityState);
  const primaryProLabel = getProActiveLabel(status);
  const planLabel = mode === "loading" ? "Checking plan..." : mode === "pro" ? primaryProLabel : hasPendingProSync ? "Pro access syncing" : "Free plan";
  const renewalLabel =
    mode === "loading"
      ? null
      : mode === "pro"
        ? getProDetailLabel(status, primaryProLabel)
        : hasPendingProSync
          ? "Purchase detected. Backend access has not confirmed Pro yet."
        : qaConfigurationMessage ?? "Free unlocks are available on this account.";

  const resolved = {
    mode,
    hasProEntitlement,
    hasPendingProSync,
    planLabel,
    renewalLabel,
    showFreeUnlockUsage: mode === "free",
    showUpgradeOptions: mode === "free" && !hasPendingProSync,
    showPaywallCard: mode === "free" && !hasPendingProSync,
    showPrimaryUpgradeCta: mode === "free" && !hasPendingProSync,
    showRestorePurchases: true,
    purchaseAvailabilityState,
  } satisfies ProfileAccessState;

  return resolved;
}
