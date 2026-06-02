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
        <Text style={styles.title}>Unlock Pro Access</Text>
        <View style={styles.row}>
          <Text style={styles.item}>Market Value Intelligence</Text>
          <Text style={styles.item}>Live Listings</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.item}>Pricing Insights</Text>
          <Text style={styles.item}>Garage Sync</Text>
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
