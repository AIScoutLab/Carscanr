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
    <View style={styles.shell}>
      <View style={styles.badge}>
        <Ionicons name="sparkles-outline" size={18} color={Colors.premium} />
        <Text style={styles.badgeText}>CarScanr</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: "rgba(105, 164, 255, 0.16)",
    backgroundColor: "rgba(15, 31, 48, 0.82)",
    padding: 18,
    gap: 10,
    overflow: "hidden",
    ...Shadows.card,
  },
  badge: {
    ...premiumPillStyles.surface,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  badgeText: {
    ...Typography.caption,
    color: Colors.textStrong,
    fontWeight: "700",
  },
  title: { ...Typography.heading, color: Colors.textStrong },
  description: { ...Typography.body, color: Colors.textSoft },
});
