import { PurchaseOptionKind, SubscriptionProduct } from "@/types";
import { getPurchaseOptionKind } from "@/lib/purchaseOptions";

export const PAID_PURCHASE_AUTH_REQUIRED_MESSAGE =
  "Create an account or sign in before buying unlock packs so we can credit them to your account.";

export const PAID_PURCHASE_SIGN_IN_REQUIRED_MESSAGE =
  "Create an account or sign in before continuing so we can keep your purchase tied to your account.";

export const UNLOCK_PACK_ACCOUNT_REQUIRED_COPY = "Account required so credits can be saved.";

export const PAYWALL_SELECTED_OPTION_PARAM = "selectedOption";

const PURCHASE_OPTION_KIND_SET = new Set<PurchaseOptionKind>(["annual", "monthly", "unlock_pack", "other"]);

export function getPaywallSelectedOptionKind(value?: string | string[] | null): PurchaseOptionKind | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !PURCHASE_OPTION_KIND_SET.has(candidate as PurchaseOptionKind)) {
    return null;
  }
  return candidate as PurchaseOptionKind;
}

export function getPaywallReturnTo(optionKind?: PurchaseOptionKind | null) {
  if (!optionKind) {
    return "/paywall";
  }
  return `/paywall?${PAYWALL_SELECTED_OPTION_PARAM}=${encodeURIComponent(optionKind)}`;
}

export function getPaywallAuthHref(optionKind?: PurchaseOptionKind | null) {
  return `/auth?mode=sign-in&returnTo=${encodeURIComponent(getPaywallReturnTo(optionKind))}`;
}

export function getPaidPurchaseAuthRequiredMessage(optionKind?: PurchaseOptionKind | null) {
  return optionKind === "unlock_pack" ? PAID_PURCHASE_AUTH_REQUIRED_MESSAGE : PAID_PURCHASE_SIGN_IN_REQUIRED_MESSAGE;
}

export function requiresSignInBeforePaidPurchase(input: {
  isSignedIn: boolean;
  product?: SubscriptionProduct | null;
  optionKind?: PurchaseOptionKind | null;
}) {
  if (input.isSignedIn) {
    return false;
  }

  const optionKind = input.optionKind ?? (input.product ? getPurchaseOptionKind(input.product) : null);
  return optionKind === "annual" || optionKind === "monthly" || optionKind === "unlock_pack" || optionKind === "other";
}
