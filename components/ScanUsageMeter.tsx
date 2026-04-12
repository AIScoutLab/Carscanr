import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";
import { SubscriptionStatus } from "@/types";

type Props = {
  status: SubscriptionStatus;
  mode?: "scans" | "unlocks";
  unlocksUsed?: number;
  unlocksRemaining?: number;
  unlocksLimit?: number;
  supportingText?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
};

export function ScanUsageMeter({
  status,
  mode = "scans",
  unlocksUsed,
  unlocksRemaining,
  unlocksLimit,
  supportingText,
  ctaLabel,
  onCtaPress,
}: Props) {
  const hasUnlockProps =
    typeof unlocksLimit === "number" || typeof unlocksRemaining === "number" || typeof unlocksUsed === "number";
  const isUnlockMode = mode === "unlocks" || hasUnlockProps;
  const limit = isUnlockMode ? unlocksLimit ?? 5 : status.limit ?? status.dailyScanLimit ?? 1;
  const used = isUnlockMode ? unlocksUsed ?? 0 : status.scansUsed ?? status.scansUsedToday ?? 0;
  const remaining = isUnlockMode ? unlocksRemaining ?? Math.max(0, limit - used) : status.scansRemaining ?? 0;
  const progress = status.plan === "pro" ? 1 : Math.min(used / limit, 1);
  const title =
    status.plan === "pro"
      ? isUnlockMode
        ? "Full access active"
        : "Unlimited scans"
      : isUnlockMode
        ? `${used} of ${limit} free unlocks used`
        : `${used} of ${limit} free scans used`;
  const note =
    status.plan === "pro"
      ? "Unlimited scans with instant full vehicle access."
      : isUnlockMode
        ? `${remaining} free unlocks remaining for premium access.`
        : `${remaining} free scans remaining before you need Pro.`;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.caption}>{status.plan === "pro" ? "Pro" : isUnlockMode ? "Unlocks" : "Free"}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <Text style={styles.note}>{note}</Text>
      {supportingText ? <Text style={styles.supporting}>{supportingText}</Text> : null}
      {status.plan === "free" && ctaLabel && onCtaPress ? (
        <TouchableOpacity onPress={onCtaPress} accessibilityRole="button" activeOpacity={0.86}>
          <Text style={styles.cta}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.utility,
    gap: 12,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { ...Typography.bodyStrong, color: Colors.text, flex: 1, marginRight: 12 },
  caption: { ...Typography.caption, color: Colors.premium },
  track: { height: 8, backgroundColor: Colors.cardAlt, borderRadius: Radius.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: Radius.pill, backgroundColor: Colors.accent },
  note: { ...Typography.caption, color: Colors.textMuted },
  supporting: { ...Typography.caption, color: Colors.textSoft },
  cta: { ...Typography.caption, color: Colors.accent, fontWeight: "700" },
});
