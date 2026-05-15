import { StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Typography } from "@/constants/theme";
import { cardStyles, premiumPillStyles } from "@/design/patterns";

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
      <View style={styles.eyebrowPill}>
        <Text style={styles.eyebrow}>Pro unlock</Text>
      </View>
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
    borderColor: Colors.premium,
  },
  eyebrowPill: {
    ...premiumPillStyles.subtleSurface,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eyebrow: { ...Typography.caption, color: "#F4F8FF" },
  title: { ...Typography.heading, color: Colors.textStrong },
  description: { ...Typography.body, color: Colors.textSoft },
});
