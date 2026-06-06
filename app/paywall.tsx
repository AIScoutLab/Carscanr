import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { FREE_PRO_UNLOCKS_TOTAL } from "@/constants/product";
import { cardStyles } from "@/design/patterns";
import { shadow } from "@/design/tokens";
import { useSubscription } from "@/hooks/useSubscription";
import { getPurchaseAvailabilityMessage, isProPlan } from "@/lib/subscription";
import {
  getPaywallAuthHref,
  getPaywallSelectedOptionKind,
  getPaidPurchaseAuthRequiredMessage,
  requiresSignInBeforePaidPurchase,
  UNLOCK_PACK_ACCOUNT_REQUIRED_COPY,
} from "@/lib/paywallPurchaseAuth";
import {
  getMissingPurchaseOptionKinds,
  getMissingPurchaseOptionMessage,
  getPreferredPurchaseProduct,
  getPurchaseOptionKey,
  getPurchaseOptionKind,
  getPurchaseOptionPriceLine,
  getPurchaseOptionTitle,
  sortPurchaseProductsForDisplay,
} from "@/lib/purchaseOptions";
import { authService } from "@/services/authService";
import { SubscriptionProduct, SubscriptionStatus } from "@/types";

const PRO_FEATURES = ["Market Values", "Live Listings", "Pricing Insights", "Garage Sync"] as const;

function getPaywallProductTitle(product: SubscriptionProduct) {
  if (getPurchaseOptionKind(product) === "unlock_pack") {
    return "5 Unlock Pack";
  }
  return getPurchaseOptionTitle(product);
}

function getPaywallPriceLine(product: SubscriptionProduct) {
  switch (getPurchaseOptionKind(product)) {
    case "annual":
      return "$39.99/year";
    case "monthly":
      return "$4.99/month";
    case "unlock_pack":
      return "$2.99 one-time";
    default:
      return getPurchaseOptionPriceLine(product);
  }
}

function getFreeUnlockSummary(remaining: number, limit: number) {
  const safeLimit = Math.max(0, limit || FREE_PRO_UNLOCKS_TOTAL);
  const safeRemaining = Math.max(0, Math.min(remaining, safeLimit));
  const used = Math.max(0, safeLimit - safeRemaining);
  if (safeRemaining > 0) {
    return `${safeRemaining} free premium ${safeRemaining === 1 ? "unlock" : "unlocks"} remaining.`;
  }
  return `${used} of ${safeLimit} free premium unlocks used.`;
}

export default function PaywallScreen() {
  const params = useLocalSearchParams<{ selectedOption?: string }>();
  const {
    status,
    isLoading,
    isPurchasing,
    isRestoring,
    freeUnlocksRemaining,
    freeUnlocksLimit,
    feedbackMessage,
    errorMessage,
    purchasePro,
    restorePurchases,
    manageSubscription,
  } = useSubscription();
  const hasPro = isProPlan(status?.plan);
  const proEntitlementActive = hasPro && (status?.provider === "backend" || status?.provider === "revenuecat" || status?.provider === "storekit" || status?.isActive);
  const monthlyProActive = proEntitlementActive && status?.plan === "pro_monthly";
  const availableProducts = useMemo(() => sortPurchaseProductsForDisplay(status?.availableProducts ?? []), [status?.availableProducts]);
  const availableProductKeys = availableProducts.map(getPurchaseOptionKey).join("|");
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const [authGateMessage, setAuthGateMessage] = useState<string | null>(null);
  const purchaseAvailabilityState = status?.purchaseAvailabilityState ?? "not_configured";
  const requestedOptionKind = getPaywallSelectedOptionKind(params.selectedOption);
  const preferredProduct = getPreferredPurchaseProduct(availableProducts);
  const selectedProduct =
    availableProducts.find((product) => getPurchaseOptionKey(product) === selectedProductKey) ?? preferredProduct;
  const yearlyProduct = availableProducts.find((product) => getPurchaseOptionKind(product) === "annual") ?? null;
  const missingOptionKinds = getMissingPurchaseOptionKinds(availableProducts);
  const purchaseAvailable = status?.purchaseAvailabilityState === "ready" && Boolean(status?.purchaseAvailable && selectedProduct);
  const purchaseAvailabilityMessage = getPurchaseAvailabilityMessage(purchaseAvailabilityState);
  const purchaseNotice = purchaseAvailabilityMessage ? `${purchaseAvailabilityMessage} Free unlocks and free scans still work normally.` : null;
  const primaryLabel = hasPro
    ? proEntitlementActive
      ? monthlyProActive
        ? "Switch to yearly in Apple subscription options"
        : "Manage Subscription"
      : isPurchasing
        ? "Activating Pro..."
        : "Activate Pro Access"
    : purchaseAvailable
      ? isPurchasing
        ? "Starting purchase..."
        : selectedProduct
          ? `Continue • ${getPaywallPriceLine(selectedProduct)}`
          : "Start Pro"
      : "Purchases Unavailable";
  const primaryDisabled = proEntitlementActive ? isLoading || isPurchasing : isLoading || isPurchasing || !purchaseAvailable;
  const restoreDisabled = isLoading || isRestoring || purchaseAvailabilityState !== "ready";
  const freeUnlockSummary = getFreeUnlockSummary(freeUnlocksRemaining, freeUnlocksLimit);

  useEffect(() => {
    if (!availableProducts.length) {
      setSelectedProductKey(null);
      return;
    }
    setSelectedProductKey((current) => {
      if (current && availableProducts.some((product) => getPurchaseOptionKey(product) === current)) {
        return current;
      }
      const requestedProduct = requestedOptionKind
        ? availableProducts.find((product) => getPurchaseOptionKind(product) === requestedOptionKind)
        : null;
      if (requestedProduct) {
        return getPurchaseOptionKey(requestedProduct);
      }
      return preferredProduct ? getPurchaseOptionKey(preferredProduct) : null;
    });
  }, [availableProductKeys, availableProducts, preferredProduct, requestedOptionKind]);

  useEffect(() => {
    availableProducts.forEach((product) => {
      console.log("PAYWALL_PACKAGE_RENDERED", {
        surface: "paywall-screen",
        productId: product.productId,
        packageIdentifier: product.packageIdentifier ?? null,
        optionKind: getPurchaseOptionKind(product),
        priceLabel: product.priceLabel,
      });
    });
    missingOptionKinds.forEach((kind) => {
      console.log("PAYWALL_PACKAGE_MISSING", {
        surface: "paywall-screen",
        optionKind: kind,
        purchaseAvailabilityState,
        availableKinds: availableProducts.map(getPurchaseOptionKind),
      });
    });
  }, [availableProductKeys, availableProducts, missingOptionKinds, purchaseAvailabilityState]);

  const handlePrimaryPress = async () => {
    const selectedOptionKind = selectedProduct ? getPurchaseOptionKind(selectedProduct) : null;
    console.log("[paywall] PAYWALL_CTA_TAPPED", {
      cta: "primary",
      proEntitlementActive,
      hasPro,
      isLoading,
      isPurchasing,
      purchaseAvailable,
      selectedProductKey: selectedProduct ? getPurchaseOptionKey(selectedProduct) : null,
      selectedOptionKind,
    });
    if (proEntitlementActive) {
      if (monthlyProActive || hasManageablePro(status)) {
        try {
          await manageSubscription();
        } catch {
          // Provider surfaces the inline error state.
        }
        return;
      }
      router.back();
      return;
    }
    if (!purchaseAvailable || !selectedProduct) {
      return;
    }
    const currentUser = await authService.getCurrentUser();
    if (
      requiresSignInBeforePaidPurchase({
        isSignedIn: Boolean(currentUser?.id),
        product: selectedProduct,
        optionKind: selectedOptionKind,
      })
    ) {
      const authHref = getPaywallAuthHref(selectedOptionKind);
      const authMessage = getPaidPurchaseAuthRequiredMessage(selectedOptionKind);
      setAuthGateMessage(authMessage);
      Alert.alert("Sign in required", authMessage, [
        { text: "Not Now", style: "cancel" },
        {
          text: "Sign In",
          onPress: () => router.replace(authHref as never),
        },
      ]);
      return;
    }
    try {
      console.log("PAYWALL_PURCHASE_OPTION_SELECTED", {
        source: "paywall-primary",
        productId: selectedProduct.productId,
        packageIdentifier: selectedProduct.packageIdentifier ?? null,
        optionKind: getPurchaseOptionKind(selectedProduct),
      });
      const result = await purchasePro(getPurchaseOptionKey(selectedProduct));
      console.log("[paywall] purchase result", { outcome: result.outcome, purchaseKind: result.purchaseKind ?? null, provider: result.status.provider, plan: result.status.plan });
      if (result.purchaseKind === "unlock_pack") {
        router.replace("/unlocks-added");
        return;
      }
      if (result.status.provider === "backend" && result.status.isActive === true && isProPlan(result.status.plan)) {
        router.replace("/pro-activated");
        return;
      }
      if (result.purchaseKind === "annual" || result.purchaseKind === "monthly") {
        router.replace("/(tabs)/profile");
      }
    } catch {
      // The inline error state from the subscription provider handles display.
    }
  };

  const handleRestorePress = async () => {
    if (restoreDisabled) {
      return;
    }
    try {
      const result = await restorePurchases();
      console.log("[paywall] restore result", {
        outcome: result.outcome,
        provider: result.status.provider,
        plan: result.status.plan,
      });
      if (result.outcome === "restored" && isProPlan(result.status.plan)) {
        router.replace("/pro-activated");
      }
    } catch {
      // Provider surfaces the inline error state.
    }
  };

  return (
    <AppContainer contentContainerStyle={styles.screenContent}>
      <BackButton fallbackHref="/(tabs)/scan" label="Back" />
      <LinearGradient colors={["rgba(216,163,104,0.18)", "rgba(20,18,16,0.98)", "rgba(12,12,13,0.98)"]} style={styles.proCard}>
        <View style={styles.headerBlock}>
          <Text style={styles.eyebrow}>PRO ACCESS</Text>
          <Text style={styles.unlockLabel}>Unlock:</Text>
          <View style={styles.featureList}>
            {PRO_FEATURES.map((feature) => (
              <View key={feature} style={styles.featureRow}>
                <Text style={styles.checkmark}>{"\u2713"}</Text>
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.supportingCopy}>Premium tools for every vehicle you scan.</Text>
        </View>

        {proEntitlementActive ? (
          <>
            <View style={styles.activePanel}>
              <Text style={styles.activeTitle}>{monthlyProActive ? "Monthly Pro is active" : "Pro is active"}</Text>
              <Text style={styles.activeBody}>
                {monthlyProActive
                  ? "Switch or manage renewal timing in Apple subscription options."
                  : "Your premium tools are unlocked on this device."}
              </Text>
            </View>
            {monthlyProActive ? (
              <View style={styles.switchPanel}>
                <View style={styles.productTitleRow}>
                  <Text style={styles.productTitle}>Yearly Pro</Text>
                  <Text style={styles.bestValueBadge}>Best Value</Text>
                </View>
                <Text style={styles.productPrice}>{yearlyProduct ? getPaywallPriceLine(yearlyProduct) : "$39.99/year"}</Text>
                <Text style={styles.switchCopy}>Switch to yearly in Apple subscription options. Apple manages upgrade timing and billing.</Text>
              </View>
            ) : null}
            <PrimaryButton label={primaryLabel} onPress={handlePrimaryPress} disabled={primaryDisabled} />
          </>
        ) : (
          <>
            {availableProducts.length > 0 ? (
              <View style={styles.optionGroup}>
                {availableProducts.map((product) => {
                  const productKey = getPurchaseOptionKey(product);
                  const selected = selectedProduct ? getPurchaseOptionKey(selectedProduct) === productKey : false;
                  const optionKind = getPurchaseOptionKind(product);
                  return (
                    <TouchableOpacity
                      key={productKey}
                      accessibilityRole="button"
                      activeOpacity={0.86}
                      style={[styles.productOption, selected && styles.productOptionSelected]}
                      onPress={() => {
                        setAuthGateMessage(null);
                        console.log("PAYWALL_PURCHASE_OPTION_SELECTED", {
                          source: "paywall-option",
                          productId: product.productId,
                          packageIdentifier: product.packageIdentifier ?? null,
                          optionKind,
                        });
                        setSelectedProductKey(productKey);
                      }}
                    >
                      <View style={styles.productOptionText}>
                        <View style={styles.productTitleRow}>
                          <Text style={styles.productTitle}>{getPaywallProductTitle(product)}</Text>
                          {optionKind === "annual" ? <Text style={styles.bestValueBadge}>Best Value</Text> : null}
                        </View>
                        {selected ? <Text style={styles.selectedLabel}>Selected</Text> : null}
                        {optionKind === "unlock_pack" ? <Text style={styles.productSupportText}>{UNLOCK_PACK_ACCOUNT_REQUIRED_COPY}</Text> : null}
                      </View>
                      <View style={styles.productPriceWrap}>
                        <Text style={styles.productPrice}>{getPaywallPriceLine(product)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}

            <PrimaryButton label={primaryLabel} onPress={handlePrimaryPress} disabled={primaryDisabled} />

            <TouchableOpacity accessibilityRole="button" activeOpacity={0.72} style={styles.restoreLink} onPress={handleRestorePress} disabled={restoreDisabled}>
              <Text style={[styles.restoreText, restoreDisabled && styles.restoreTextDisabled]}>
                {isRestoring ? "Restoring purchases..." : "Restore Purchases"}
              </Text>
            </TouchableOpacity>

            {purchaseAvailabilityState === "ready"
              ? missingOptionKinds.map((kind) => (
                  <Text key={kind} style={styles.warning}>
                    {getMissingPurchaseOptionMessage(kind)}
                  </Text>
                ))
              : null}
            {authGateMessage ? <Text style={styles.authGateNotice}>{authGateMessage}</Text> : null}
            {purchaseNotice ? <Text style={styles.notice}>{purchaseNotice}</Text> : null}
          </>
        )}
      </LinearGradient>
      {feedbackMessage ? <Text style={styles.feedback}>{feedbackMessage}</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {!proEntitlementActive ? <Text style={styles.freeUnlockFootnote}>{freeUnlockSummary}</Text> : null}
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    gap: 14,
  },
  proCard: {
    ...cardStyles.standard,
    padding: 20,
    gap: 18,
    borderColor: "rgba(216, 163, 104, 0.28)",
    ...shadow.card,
  },
  headerBlock: { gap: 8 },
  eyebrow: { ...Typography.caption, color: Colors.premium, fontWeight: "800", letterSpacing: 0 },
  unlockLabel: { ...Typography.title, color: Colors.textStrong },
  supportingCopy: { ...Typography.body, color: Colors.textSoft },
  featureList: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.borderSoft,
    paddingVertical: 12,
    gap: 10,
  },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  checkmark: { ...Typography.bodyStrong, color: Colors.premium, width: 18, textAlign: "center" },
  featureText: { ...Typography.bodyStrong, color: Colors.textStrong },
  activePanel: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    padding: 14,
    gap: 4,
  },
  activeTitle: { ...Typography.heading, color: Colors.textStrong },
  activeBody: { ...Typography.body, color: Colors.textSoft },
  switchPanel: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: "rgba(216,163,104,0.28)",
    paddingVertical: 13,
    paddingHorizontal: 14,
    gap: 6,
  },
  switchCopy: { ...Typography.caption, color: Colors.textMuted },
  optionGroup: {
    gap: 8,
  },
  productOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 72,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: Radius.md,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  productOptionSelected: {
    borderColor: Colors.premium,
    backgroundColor: "rgba(216,163,104,0.09)",
    shadowColor: Colors.premium,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  productOptionText: { flex: 1, gap: 4 },
  productTitleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  productTitle: { ...Typography.heading, color: Colors.textStrong },
  bestValueBadge: {
    ...Typography.caption,
    color: "#15100A",
    backgroundColor: Colors.premium,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontWeight: "800",
  },
  productPriceWrap: { alignItems: "flex-end", gap: 4 },
  productPrice: { ...Typography.bodyStrong, color: Colors.premium, textAlign: "right" },
  selectedLabel: { ...Typography.caption, color: Colors.premium, fontWeight: "800" },
  productSupportText: { ...Typography.caption, color: Colors.textMuted },
  restoreLink: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 2 },
  restoreText: { ...Typography.caption, color: Colors.textSoft, fontWeight: "700" },
  restoreTextDisabled: { color: Colors.textFaint },
  warning: { ...Typography.caption, color: Colors.warning, textAlign: "center" },
  authGateNotice: { ...Typography.caption, color: Colors.warning, textAlign: "center" },
  notice: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
  feedback: { ...Typography.caption, color: Colors.textSoft, textAlign: "center" },
  error: { ...Typography.caption, color: Colors.danger, textAlign: "center" },
  freeUnlockFootnote: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
});

function hasManageablePro(status: SubscriptionStatus | null | undefined) {
  return Boolean(status && isProPlan(status.plan));
}
