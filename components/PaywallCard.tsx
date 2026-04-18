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
  const limit = typeof unlocksLimit === "number" ? unlocksLimit : 5;
  const remaining = typeof unlocksRemaining === "number" ? unlocksRemaining : limit;
  const used = Math.max(0, limit - remaining);
  const usageLabel =
    status?.plan === "free"
      ? `${used} of ${limit} free Pro unlocks used • ${Math.max(0, remaining)} remaining`
      : "Unlimited Pro details";

  return (
    <LinearGradient colors={["#07101D", "#0D1C31", "#133155"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      <Text style={styles.eyebrow}>Performance tier</Text>
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
  card: {
    borderRadius: Radius.xl,
    padding: 24,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(94, 231, 255, 0.28)",
    ...shadow.cardStrong,
  },
  eyebrow: { ...Typography.caption, color: "rgba(230,238,249,0.72)", textTransform: "uppercase", letterSpacing: 1.1 },
  title: { ...Typography.title, color: "#FFFFFF" },
  price: { ...Typography.heading, color: "#5EE7FF" },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(94, 231, 255, 0.12)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "rgba(94, 231, 255, 0.22)",
  },
  badgeText: { ...Typography.caption, color: "#FFFFFF" },
  footer: { ...Typography.caption, color: "rgba(230,238,249,0.76)" },
});
