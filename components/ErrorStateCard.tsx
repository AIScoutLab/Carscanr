import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { PremiumCard } from "@/components/PremiumCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { PillBadge } from "@/components/PillBadge";
import { Colors, Spacing, Typography } from "@/constants/theme";

export function ErrorStateCard({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <PremiumCard variant="tint" contentStyle={styles.content}>
      <PillBadge tone="neutral" label="Needs attention">
        <Ionicons name="alert-circle-outline" size={16} color={Colors.textSoft} />
      </PillBadge>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      {actionLabel && onAction ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 18,
    gap: Spacing.sm,
  },
  copy: {
    gap: 8,
  },
  title: {
    ...Typography.heading,
    color: Colors.textStrong,
  },
  description: {
    ...Typography.body,
    color: Colors.textSoft,
  },
});
