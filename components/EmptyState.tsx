import { StyleSheet, Text } from "react-native";
import { PremiumCard } from "@/components/PremiumCard";
import { Colors, Typography } from "@/constants/theme";

type Props = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: Props) {
  return (
    <PremiumCard variant="glass" contentStyle={styles.card}>
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
