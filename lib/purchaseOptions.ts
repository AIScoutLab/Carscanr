import { PRICING } from "@/lib/pricing";
import { PurchaseOptionKind, SubscriptionProduct } from "@/types";

export const REQUIRED_PURCHASE_OPTION_KINDS: PurchaseOptionKind[] = ["annual", "monthly", "unlock_pack"];

const PURCHASE_OPTION_ORDER: Record<PurchaseOptionKind, number> = {
  annual: 0,
  monthly: 1,
  unlock_pack: 2,
  other: 3,
};

export function getPurchaseOptionKey(product: SubscriptionProduct) {
  return product.packageIdentifier ?? product.productId;
}

export function getPurchaseOptionKindFromProductMetadata(input: {
  productId?: string | null;
  packageIdentifier?: string | null;
  packageType?: string | null;
  title?: string | null;
  description?: string | null;
  billingPeriodLabel?: string | null;
}): PurchaseOptionKind {
  const normalized = [
    input.packageIdentifier,
    input.packageType,
    input.productId,
    input.title,
    input.description,
    input.billingPeriodLabel,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();

  if (normalized.includes("annual") || normalized.includes("yearly") || normalized.includes("year")) {
    return "annual";
  }
  if (normalized.includes("monthly") || normalized.includes("month")) {
    return "monthly";
  }
  if (normalized.includes("unlock") || normalized.includes("credit") || normalized.includes("pack")) {
    return "unlock_pack";
  }
  return "other";
}

export function isSubscriptionPurchaseOptionKind(kind?: PurchaseOptionKind | null) {
  return kind === "annual" || kind === "monthly";
}

export function isUnlockPackProductId(productId?: string | null) {
  return getPurchaseOptionKindFromProductMetadata({ productId }) === "unlock_pack";
}

export function getPurchaseOptionKind(product: SubscriptionProduct): PurchaseOptionKind {
  if (product.optionKind) {
    return product.optionKind;
  }

  return getPurchaseOptionKindFromProductMetadata(product);
}

export function sortPurchaseProductsForDisplay(products: SubscriptionProduct[]) {
  return [...products].sort((left, right) => {
    const kindDelta = PURCHASE_OPTION_ORDER[getPurchaseOptionKind(left)] - PURCHASE_OPTION_ORDER[getPurchaseOptionKind(right)];
    if (kindDelta !== 0) {
      return kindDelta;
    }
    return getPurchaseOptionKey(left).localeCompare(getPurchaseOptionKey(right));
  });
}

export function getPreferredPurchaseProduct(products: SubscriptionProduct[]) {
  const sorted = sortPurchaseProductsForDisplay(products);
  return sorted.find((product) => getPurchaseOptionKind(product) === "annual") ?? sorted[0] ?? null;
}

export function getMissingPurchaseOptionKinds(products: SubscriptionProduct[]) {
  const availableKinds = new Set(products.map(getPurchaseOptionKind));
  return REQUIRED_PURCHASE_OPTION_KINDS.filter((kind) => !availableKinds.has(kind));
}

export function getPurchaseOptionTitle(product: SubscriptionProduct) {
  switch (getPurchaseOptionKind(product)) {
    case "annual":
      return "Yearly Pro";
    case "monthly":
      return "Monthly Pro";
    case "unlock_pack":
      return `${PRICING.unlockPackCount} unlock pack`;
    default:
      return product.title?.trim() || "Purchase option";
  }
}

export function getPurchaseOptionPriceLine(product: SubscriptionProduct) {
  if (getPurchaseOptionKind(product) === "unlock_pack") {
    return `${product.priceLabel} one time`;
  }
  return `${product.priceLabel}/${product.billingPeriodLabel}`;
}

export function getPurchaseOptionDescription(product: SubscriptionProduct) {
  switch (getPurchaseOptionKind(product)) {
    case "annual":
      return "Renews yearly for unlimited Pro access.";
    case "monthly":
      return "Renews monthly for unlimited Pro access.";
    case "unlock_pack":
      return `${PRICING.unlockPackCount} one-time premium unlocks.`;
    default:
      return product.description?.trim() || "RevenueCat package returned for this build.";
  }
}

export function getMissingPurchaseOptionMessage(kind: PurchaseOptionKind) {
  switch (kind) {
    case "annual":
      return "RevenueCat offering is missing the yearly Pro package.";
    case "monthly":
      return "RevenueCat offering is missing the monthly Pro package.";
    case "unlock_pack":
      return `RevenueCat offering is missing the ${PRICING.unlockPackCount} unlock pack.`;
    default:
      return "RevenueCat offering returned an unrecognized package configuration.";
  }
}
