import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { PillBadge } from "@/components/PillBadge";
import { PrimaryButton } from "@/components/PrimaryButton";
import { PRICING } from "@/lib/pricing";
import { FREE_PRO_UNLOCKS_TOTAL } from "@/constants/product";
import { Colors, PremiumCard, PremiumGradients, Radius, Typography } from "@/constants/theme";
import { deriveFreeUnlockCounter } from "@/lib/freeUnlockDisplay";
import { shadow } from "@/design/tokens";
import { SubscriptionStatus } from "@/types";

export function PaywallCard({
  status,
  unlocksUsed,
  unlocksRemaining,
  unlocksLimit,
  unlockCredits = 0,
  title = "Unlock Value & Listings",
  description = "Scans stay free. Pro opens full specs, value, listings, and pricing insight when you want more depth.",
  ctaLabel,
  onCtaPress,
  secondaryCtaLabel,
  onSecondaryCtaPress,
  secondaryCtaDisabled = false,
  showEyebrow = true,
  showCreditBadge = true,
  usageLabelOverride,
  optionPills,
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
  showEyebrow?: boolean;
  showCreditBadge?: boolean;
  usageLabelOverride?: string;
  optionPills?: string[];
}) {
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

  return (
    <LinearGradient colors={PremiumGradients.primaryCard} start={{ x: 0.4, y: 0 }} end={{ x: 0.6, y: 1 }} style={styles.card}>
      {showEyebrow ? <PillBadge tone="subtle" label="CarScanr Pro" /> : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.price}>{`${PRICING.yearlyDisplay}/year`}</Text>
      <Text style={styles.subprice}>{`or ${PRICING.monthlyDisplay}/month`}</Text>
      <PillBadge tone="neutral" label={usageLabel} />
      {showCreditBadge && unlockCredits > 0 ? (
        <PillBadge tone="success" label={`${unlockCredits} unlock credits ready`} />
      ) : null}
      {optionPills?.length ? (
        <View style={styles.optionPillRow}>
          {optionPills.map((pill) => (
            <View key={pill} style={styles.optionPill}>
              <Text style={styles.optionPillText}>{pill}</Text>
            </View>
          ))}
        </View>
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
  optionPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(12, 21, 36, 0.78)",
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  optionPillText: { ...Typography.caption, color: Colors.textSoft },
  footer: { ...Typography.caption, color: Colors.textSoft },
});
