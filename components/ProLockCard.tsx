import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";

type Props = {
  onPress?: () => void;
};

export function ProLockCard({ onPress }: Props) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.card} activeOpacity={0.86}>
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
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.secondary,
    overflow: "hidden",
  },
  blur: {
    padding: 20,
    gap: 12,
    backgroundColor: "rgba(17, 32, 57, 0.92)",
  },
  eyebrowPill: {
    alignSelf: "flex-start",
    backgroundColor: Colors.premiumSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eyebrow: { ...Typography.caption, color: Colors.premium },
  title: { ...Typography.heading, color: Colors.textStrong },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  item: { ...Typography.caption, color: Colors.textSoft },
  ctaWrap: {
    alignSelf: "flex-start",
    backgroundColor: Colors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  cta: { ...Typography.caption, color: Colors.accent, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.7 },
});
