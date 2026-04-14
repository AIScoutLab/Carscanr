import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";
import { shadow } from "@/design/tokens";
import { SubscriptionStatus } from "@/types";

export function PaywallCard({
  status,
  unlocksRemaining,
  unlocksLimit,
}: {
  status?: SubscriptionStatus | null;
  unlocksRemaining?: number;
  unlocksLimit?: number;
}) {
  const usageLabel =
    status?.plan === "free"
      ? `${typeof unlocksRemaining === "number" ? unlocksRemaining : 5} of ${typeof unlocksLimit === "number" ? unlocksLimit : 5} free Pro unlocks left`
      : "Unlimited Pro details";

  return (
    <LinearGradient colors={["#0F172A", "#1E293B"]} style={styles.card}>
      <Text style={styles.eyebrow}>CarScanr Pro</Text>
      <Text style={styles.title}>Unlock Full Vehicle Details</Text>
      <Text style={styles.price}>$6.99/month</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{usageLabel}</Text>
      </View>
      <Text style={styles.footer}>Scans stay free. Pro unlocks full specs, value, listings, and richer history tools.</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.xl, padding: 24, gap: 10, ...shadow.cardStrong },
  eyebrow: { ...Typography.caption, color: "rgba(255,255,255,0.75)" },
  title: { ...Typography.title, color: "#FFFFFF" },
  price: { ...Typography.heading, color: "#F8F0D0" },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
  },
  badgeText: { ...Typography.caption, color: "#FFFFFF" },
  footer: { ...Typography.caption, color: "rgba(255,255,255,0.75)" },
});
