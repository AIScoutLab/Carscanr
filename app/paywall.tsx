import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { PaywallCard } from "@/components/PaywallCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { planBenefits } from "@/features/subscription/planCopy";
import { useSubscription } from "@/hooks/useSubscription";
import { isProPlan } from "@/lib/subscription";
import {
  getMissingPurchaseOptionKinds,
  getMissingPurchaseOptionMessage,
  getPreferredPurchaseProduct,
  getPurchaseOptionDescription,
  getPurchaseOptionKey,
  getPurchaseOptionKind,
  getPurchaseOptionPriceLine,
  getPurchaseOptionTitle,
  sortPurchaseProductsForDisplay,
} from "@/lib/purchaseOptions";
import { Colors, Radius, Typography } from "@/constants/theme";
import { FREE_PRO_UNLOCKS_TOTAL } from "@/constants/product";
import { cardStyles } from "@/design/patterns";

export default function PaywallScreen() {
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
  } = useSubscription();
  const hasPro = isProPlan(status?.plan);
  const proEntitlementActive = hasPro && (status?.provider === "backend" || status?.provider === "revenuecat" || status?.provider === "storekit" || status?.isActive);
  const availableProducts = useMemo(() => sortPurchaseProductsForDisplay(status?.availableProducts ?? []), [status?.availableProducts]);
  const availableProductKeys = availableProducts.map(getPurchaseOptionKey).join("|");
  const [selectedProductKey, setSelectedProductKey] = useState<string | null>(null);
  const purchaseAvailabilityState = status?.purchaseAvailabilityState ?? "not_configured";
  const preferredProduct = getPreferredPurchaseProduct(availableProducts);
  const selectedProduct =
    availableProducts.find((product) => getPurchaseOptionKey(product) === selectedProductKey) ?? preferredProduct;
  const missingOptionKinds = getMissingPurchaseOptionKinds(availableProducts);
  const purchaseAvailable = status?.purchaseAvailabilityState === "ready" && Boolean(status?.purchaseAvailable && selectedProduct);
  const purchaseNotice =
    purchaseAvailabilityState === "preview_only"
      ? "Purchases can be previewed here, but they require a development or production build to complete."
      : purchaseAvailabilityState === "not_configured"
        ? "Purchases are not configured for this build yet. Free unlocks and free scans still work normally."
        : null;
  const primaryLabel = hasPro
    ? proEntitlementActive
      ? "Continue With Pro"
      : isPurchasing
        ? "Activating Pro..."
        : "Activate Pro Access"
    : purchaseAvailable
      ? isPurchasing
        ? "Starting purchase..."
        : selectedProduct
          ? `Continue • ${getPurchaseOptionPriceLine(selectedProduct)}`
          : "Start Pro"
      : "Purchases Unavailable In This Build";

  useEffect(() => {
    if (!availableProducts.length) {
      setSelectedProductKey(null);
      return;
    }
    setSelectedProductKey((current) => {
      if (current && availableProducts.some((product) => getPurchaseOptionKey(product) === current)) {
        return current;
      }
      return preferredProduct ? getPurchaseOptionKey(preferredProduct) : null;
    });
  }, [availableProductKeys, availableProducts, preferredProduct]);

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

  return (
    <AppContainer>
      <BackButton fallbackHref="/(tabs)/scan" label="Back" />
      <LinearGradient colors={["rgba(216,163,104,0.18)", "rgba(216,163,104,0.06)", "rgba(5,5,6,0.22)"]} style={styles.heroBanner}>
        <Text style={styles.heroTitle}>A cleaner performance tier</Text>
        <Text style={styles.heroBody}>Unlimited free scans stay in front. Pro opens deeper specs, richer value context, shopping intelligence, and synced premium access.</Text>
      </LinearGradient>
      <View style={styles.heroSection}>
        {!proEntitlementActive ? <PaywallCard status={status} unlocksRemaining={freeUnlocksRemaining} unlocksLimit={freeUnlocksLimit} /> : null}
        {status && !proEntitlementActive ? (
          <ScanUsageMeter
            status={status}
            mode="unlocks"
            unlocksUsed={freeUnlocksLimit - freeUnlocksRemaining}
            unlocksRemaining={freeUnlocksRemaining}
            unlocksLimit={freeUnlocksLimit}
            supportingText="Unlimited basic scans stay free. Unlock full details when you want."
          />
        ) : null}
      </View>
      {proEntitlementActive ? (
        <View style={styles.detailCard}>
          <Text style={styles.title}>Pro is active</Text>
          <Text style={styles.subtitle}>Unlimited scans and full details are unlocked on this device.</Text>
          <PlanColumn title="Included with Pro" items={planBenefits.pro} highlight />
        </View>
      ) : (
        <View style={styles.detailCard}>
          <Text style={styles.title}>Everything behind Pro</Text>
          <Text style={styles.subtitle}>Unlimited scans stay free. Use your {FREE_PRO_UNLOCKS_TOTAL} free unlocks first, then upgrade only if you want always-on full access.</Text>
          <PlanColumn title="Included" items={planBenefits.pro} highlight />
          {availableProducts.length > 0 ? (
            <View style={styles.optionGroup}>
              {availableProducts.map((product) => {
                const productKey = getPurchaseOptionKey(product);
                const selected = selectedProduct ? getPurchaseOptionKey(selectedProduct) === productKey : false;
                return (
                  <TouchableOpacity
                    key={productKey}
                    accessibilityRole="button"
                    activeOpacity={0.86}
                    style={[styles.productOption, selected && styles.productOptionSelected]}
                    onPress={() => {
                      console.log("PAYWALL_PURCHASE_OPTION_SELECTED", {
                        source: "paywall-option",
                        productId: product.productId,
                        packageIdentifier: product.packageIdentifier ?? null,
                        optionKind: getPurchaseOptionKind(product),
                      });
                      setSelectedProductKey(productKey);
                    }}
                  >
                    <View style={styles.productOptionText}>
                      <Text style={styles.productTitle}>{getPurchaseOptionTitle(product)}</Text>
                      <Text style={styles.productBody}>{getPurchaseOptionDescription(product)}</Text>
                    </View>
                    <View style={styles.productPriceWrap}>
                      <Text style={styles.productPrice}>{getPurchaseOptionPriceLine(product)}</Text>
                      {selected ? <Text style={styles.selectedLabel}>Selected</Text> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          {purchaseAvailabilityState === "ready" && availableProducts.length === 0 ? (
            <Text style={styles.warning}>RevenueCat returned an offering with no packages. Check monthly, yearly, and unlock pack configuration.</Text>
          ) : null}
          {purchaseAvailabilityState === "ready"
            ? missingOptionKinds.map((kind) => (
                <Text key={kind} style={styles.warning}>
                  {getMissingPurchaseOptionMessage(kind)}
                </Text>
              ))
            : null}
          {purchaseNotice ? <Text style={styles.notice}>{purchaseNotice}</Text> : null}
        </View>
      )}
      <PrimaryButton
        label={primaryLabel}
        onPress={async () => {
          console.log("[paywall] PAYWALL_CTA_TAPPED", {
            cta: "primary",
            proEntitlementActive,
            hasPro,
            isLoading,
            isPurchasing,
            purchaseAvailable,
            selectedProductKey: selectedProduct ? getPurchaseOptionKey(selectedProduct) : null,
          });
          if (proEntitlementActive) {
            router.back();
            return;
          }
          if (!purchaseAvailable || !selectedProduct) {
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
            console.log("[paywall] purchase result", { outcome: result.outcome, provider: result.status.provider, plan: result.status.plan });
            if (isProPlan(result.status.plan) || result.status.provider === "backend") {
              router.replace("/pro-activated");
            }
          } catch {
            // The inline error state from the subscription provider handles display.
          }
        }}
        disabled={isLoading || isPurchasing || !purchaseAvailable}
      />
      {!proEntitlementActive ? (
        <PrimaryButton
          label={isRestoring ? "Restoring purchases..." : "Restore Purchases"}
          secondary
          onPress={async () => {
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
          }}
          disabled={isLoading || isRestoring || purchaseAvailabilityState !== "ready"}
        />
      ) : null}
      <PrimaryButton
        label="Keep Free Access"
        secondary
        onPress={() => {
          console.log("[paywall] PAYWALL_CTA_TAPPED", { cta: "secondary-keep-free" });
          router.back();
        }}
      />
      {feedbackMessage ? <Text style={styles.feedback}>{feedbackMessage}</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {!hasPro && purchaseAvailable ? (
        <Text style={styles.footnote}>{selectedProduct && getPurchaseOptionKind(selectedProduct) === "unlock_pack" ? "One-time purchase" : "Cancel anytime"}</Text>
      ) : null}
    </AppContainer>
  );
}

function PlanColumn({ title, items, highlight = false }: { title: string; items: string[]; highlight?: boolean }) {
  return (
    <View style={[styles.plan, highlight && styles.planHighlight]}>
      <Text style={[styles.planTitle, highlight && styles.planTitleHighlight]}>{title}</Text>
      {items.map((item) => (
        <Text key={item} style={[styles.item, highlight && styles.itemHighlight]}>{`\u2022 ${item}`}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heroBanner: {
    borderRadius: Radius.xl,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroTitle: { ...Typography.title, color: Colors.textStrong },
  heroBody: { ...Typography.body, color: Colors.textSoft },
  heroSection: { gap: 14 },
  detailCard: { ...cardStyles.standard, padding: 20, gap: 14 },
  title: { ...Typography.title, color: Colors.textStrong },
  subtitle: { ...Typography.body, color: Colors.textSoft },
  plan: { backgroundColor: Colors.cardAlt, borderRadius: Radius.lg, padding: 16, gap: 8 },
  planHighlight: { backgroundColor: Colors.primary },
  planTitle: { ...Typography.heading, color: Colors.textStrong },
  planTitleHighlight: { color: "#FFFFFF" },
  item: { ...Typography.body, color: Colors.textSoft },
  itemHighlight: { color: "rgba(255,255,255,0.86)" },
  optionGroup: {
    gap: 6,
  },
  productOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: Colors.cardAlt,
    borderRadius: Radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  productOptionSelected: {
    borderColor: Colors.accent,
    backgroundColor: "rgba(29,125,255,0.14)",
  },
  productOptionText: { flex: 1, gap: 4 },
  productTitle: { ...Typography.heading, color: Colors.textStrong },
  productBody: { ...Typography.body, color: Colors.textSoft },
  productPriceWrap: { alignItems: "flex-end", gap: 4 },
  productPrice: { ...Typography.bodyStrong, color: Colors.premium, textAlign: "right" },
  selectedLabel: { ...Typography.caption, color: Colors.accent, fontWeight: "700" },
  warning: { ...Typography.caption, color: Colors.warning ?? Colors.premium },
  notice: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
  feedback: { ...Typography.caption, color: Colors.textSoft, textAlign: "center" },
  error: { ...Typography.caption, color: Colors.danger, textAlign: "center" },
  footnote: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
});
