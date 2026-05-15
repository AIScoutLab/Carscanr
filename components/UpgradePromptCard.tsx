import { StyleSheet, Text, View } from "react-native";
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
      {showBadge ? (
        <View style={styles.eyebrowPill}>
          <Text style={styles.eyebrow}>Pro unlock</Text>
        </View>
      ) : null}
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
  eyebrowPill: {
    alignSelf: "flex-start",
    backgroundColor: Colors.premiumSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eyebrow: { ...Typography.caption, color: Colors.premium },
  title: { ...Typography.heading, color: Colors.textStrong },
  description: { ...Typography.body, color: Colors.textSoft },
});
