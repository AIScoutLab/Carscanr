import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Motion, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";

type Props = {
  onPress?: () => void;
};

export function ProLockCard({ onPress }: Props) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.blur}>
        <View style={styles.eyebrowPill}>
          <Text style={styles.eyebrow}>Pro insights</Text>
        </View>
        <Text style={styles.title}>Unlock deeper market context</Text>
        <View style={styles.row}>
          <Text style={styles.item}>Live listings near you</Text>
          <Text style={styles.item}>Price history trends</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.item}>Dealer vs private comparisons</Text>
          <Text style={styles.item}>Advanced insights</Text>
        </View>
        <View style={styles.ctaWrap}>
          <Text style={styles.cta}>Unlock Pro</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.secondary,
    overflow: "hidden",
  },
  pressed: { transform: [{ scale: Motion.pressInScale }] },
  blur: {
    padding: 20,
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  eyebrowPill: {
    alignSelf: "flex-start",
    backgroundColor: Colors.premiumSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eyebrow: { ...Typography.caption, color: Colors.premium },
  title: { ...Typography.heading, color: Colors.text },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  item: { ...Typography.caption, color: Colors.textMuted },
  ctaWrap: {
    alignSelf: "flex-start",
    backgroundColor: Colors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  cta: { ...Typography.caption, color: Colors.accent, fontWeight: "700" },
});
