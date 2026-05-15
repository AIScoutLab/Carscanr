import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Radius, Shadows, Typography } from "@/constants/theme";
import { premiumPillStyles } from "@/design/patterns";

type Props = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.badge}>
        <Ionicons name="sparkles-outline" size={18} color={Colors.premium} />
        <Text style={styles.badgeLabel}>CarScanr</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardSoft,
    borderRadius: Radius.lg,
    padding: 24,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.cardStrong,
  },
  badge: {
    ...premiumPillStyles.surface,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  badgeLabel: {
    ...Typography.caption,
    color: "#F4F8FF",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  title: { ...Typography.heading, color: Colors.textStrong },
  description: { ...Typography.body, color: Colors.textSoft },
});
