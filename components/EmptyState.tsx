import { StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Shadows, Typography } from "@/constants/theme";

type Props = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: 24,
    gap: 8,
    ...Shadows.card,
  },
  title: { ...Typography.heading, color: Colors.text },
  description: { ...Typography.body, color: Colors.textMuted },
});
