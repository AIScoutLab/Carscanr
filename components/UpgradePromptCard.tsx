import { StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";

type Props = {
  title: string;
  description: string;
  ctaLabel?: string;
  onPress?: () => void;
};

export function UpgradePromptCard({
  title,
  description,
  ctaLabel = "Unlock Pro",
  onPress,
}: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <PrimaryButton label={ctaLabel} onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.secondary,
    gap: 10,
    borderColor: "rgba(216, 163, 104, 0.34)",
  },
  title: { ...Typography.heading, color: Colors.textStrong },
  description: { ...Typography.body, color: Colors.textSoft },
});
