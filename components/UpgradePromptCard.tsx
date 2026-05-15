import { StyleSheet, Text, View } from "react-native";
import { PillBadge } from "@/components/PillBadge";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";

type Props = {
  title: string;
  description: string;
  ctaLabel?: string;
  onPress?: () => void;
  showBadge?: boolean;
};

export function UpgradePromptCard({
  title,
  description,
  ctaLabel = "Unlock Pro",
  onPress,
  showBadge = true,
}: Props) {
  return (
    <View style={styles.card}>
      {showBadge ? <PillBadge tone="brand" label="Pro unlock" /> : null}
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
    borderColor: "rgba(59,130,246,0.35)",
  },
  title: { ...Typography.heading, color: Colors.textStrong },
  description: { ...Typography.body, color: Colors.textSoft },
});
