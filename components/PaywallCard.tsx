import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { PillBadge } from "@/components/PillBadge";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FREE_PRO_UNLOCKS_TOTAL } from "@/constants/product";
import { Colors, PremiumCard, PremiumGradients, Radius, Typography } from "@/constants/theme";
import { deriveFreeUnlockCounter } from "@/lib/freeUnlockDisplay";
import {
  getPurchaseOptionDescription,
  getPurchaseOptionKind,
  getPurchaseOptionPriceLine,
  getPurchaseOptionTitle,
  sortPurchaseProductsForDisplay,
} from "@/lib/purchaseOptions";
import { shadow } from "@/design/tokens";
import { SubscriptionStatus } from "@/types";

export function PaywallCard({
  status,
  unlocksUsed,
  unlocksRemaining,
  unlocksLimit,
  unlockCredits = 0,
  title = "Unlock Value & Listings",
  description = "Unlock market values, live listings, pricing insights, and garage tools for every vehicle you scan.",
  ctaLabel,
  onCtaPress,
  secondaryCtaLabel,
  onSecondaryCtaPress,
  secondaryCtaDisabled = false,
  showCreditBadge = true,
  usageLabelOverride,
}: {
  status?: SubscriptionStatus | null;
  unlocksUsed?: number;
  unlocksRemaining?: number;
  unlocksLimit?: number;
  unlockCredits?: number;
  title?: string;
  description?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
  secondaryCtaLabel?: string;
  onSecondaryCtaPress?: () => void;
  secondaryCtaDisabled?: boolean;
  showCreditBadge?: boolean;
  usageLabelOverride?: string;
}) {
  const availableProducts = sortPurchaseProductsForDisplay(status?.availableProducts ?? []);
  const unlockCounter = deriveFreeUnlockCounter({
    used: unlocksUsed,
    remaining: unlocksRemaining,
    limit: typeof unlocksLimit === "number" ? unlocksLimit : FREE_PRO_UNLOCKS_TOTAL,
  });
  const limit = unlockCounter.total;
  const remaining = unlockCounter.remaining;
  const used = unlockCounter.used;
  const usageLabel =
    usageLabelOverride ??
    (status?.plan === "free"
      ? `${used} of ${limit} free Pro unlocks used • ${Math.max(0, remaining)} remaining`
      : "Unlimited Pro details");

  console.log("FREE_UNLOCK_COUNTER_RENDERED", {
    used,
    remaining,
    total: limit,
    mode: "paywall-card",
    plan: status?.plan ?? "free",
  });
  availableProducts.forEach((product) => {
    console.log("PAYWALL_PACKAGE_RENDERED", {
      surface: "paywall-card",
      productId: product.productId,
      packageIdentifier: product.packageIdentifier ?? null,
      optionKind: getPurchaseOptionKind(product),
      priceLabel: product.priceLabel,
    });
  });

  return (
    <LinearGradient colors={PremiumGradients.primaryCard} start={{ x: 0.4, y: 0 }} end={{ x: 0.6, y: 1 }} style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.price}>{availableProducts.length > 0 ? "Choose your access" : "Pro access"}</Text>
      <Text style={styles.subprice}>
        {availableProducts.length > 0
          ? "Live App Store options returned by RevenueCat."
          : status?.purchaseAvailabilityState === "ready"
            ? "No RevenueCat packages were returned for this build."
            : "Purchases are unavailable until RevenueCat is configured for this build."}
      </Text>
      {availableProducts.length > 0 ? (
        <View style={styles.optionList}>
          {availableProducts.map((product) => (
            <View key={product.packageIdentifier ?? product.productId} style={styles.optionRow}>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionTitle}>{getPurchaseOptionTitle(product)}</Text>
                <Text style={styles.optionDescription}>{getPurchaseOptionDescription(product)}</Text>
              </View>
              <Text style={styles.optionPrice}>{getPurchaseOptionPriceLine(product)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <PillBadge tone="neutral" label={usageLabel} />
      {showCreditBadge && unlockCredits > 0 ? (
        <PillBadge tone="success" label={`${unlockCredits} unlock credits ready`} />
      ) : null}
      <Text style={styles.footer}>{description}</Text>
      {ctaLabel && onCtaPress ? <PrimaryButton label={ctaLabel} onPress={onCtaPress} /> : null}
      {secondaryCtaLabel && onSecondaryCtaPress ? (
        <PrimaryButton label={secondaryCtaLabel} secondary onPress={onSecondaryCtaPress} disabled={secondaryCtaDisabled} />
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: PremiumCard.accentBorder,
    ...shadow.card,
  },
  title: { ...Typography.title, color: Colors.textStrong },
  price: { ...Typography.heading, color: Colors.premium },
  subprice: { ...Typography.body, color: Colors.textSoft },
  optionList: { gap: 8 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: "rgba(12, 21, 36, 0.72)",
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  optionTextWrap: { flex: 1, gap: 3 },
  optionTitle: { ...Typography.bodyStrong, color: Colors.textStrong },
  optionDescription: { ...Typography.caption, color: Colors.textSoft },
  optionPrice: { ...Typography.caption, color: Colors.premium, fontWeight: "700", textAlign: "right" },
  footer: { ...Typography.caption, color: Colors.textSoft },
});
