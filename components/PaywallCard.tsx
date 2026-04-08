import { LinearGradient } from "expo-linear-gradient";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Motion, Radius, Typography } from "@/constants/theme";
import { shadow } from "@/design/tokens";
import { SubscriptionStatus } from "@/types";

export function PaywallCard({
  status,
  onPress,
}: {
  status?: SubscriptionStatus | null;
  onPress?: () => void;
}) {
  const usageLabel =
    status?.plan === "free" && status.limit
      ? `${status.scansRemaining ?? 0} of ${status.limit} free scans left`
      : "Unlimited vehicle scans";

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <LinearGradient colors={["#0F172A", "#1E293B"]} style={styles.card}>
        <Text style={styles.eyebrow}>CarScanr Pro</Text>
        <Text style={styles.title}>Unlock CarScanr Pro</Text>
        <Text style={styles.price}>$6.99/month</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{usageLabel}</Text>
        </View>
        <Text style={styles.footer}>Cancel anytime</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.xl, padding: 24, gap: 10, ...shadow.cardStrong },
  pressed: { transform: [{ scale: Motion.pressInScale }] },
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
