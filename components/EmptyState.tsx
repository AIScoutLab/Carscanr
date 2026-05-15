import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PremiumCard } from "@/components/PremiumCard";
import { PillBadge } from "@/components/PillBadge";
import { Colors, Radius, Shadows, Typography } from "@/constants/theme";

type Props = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: Props) {
  return (
    <PremiumCard variant="glass" contentStyle={styles.card}>
      <PillBadge tone="accent" label="CarScanr">
        <Ionicons name="sparkles-outline" size={18} color={Colors.premium} />
      </PillBadge>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 18,
    gap: 10,
  },
  title: { ...Typography.heading, color: Colors.textStrong },
  description: { ...Typography.body, color: Colors.textSoft },
});
