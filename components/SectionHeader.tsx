import { StyleSheet, Text, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { premiumPillStyles } from "@/design/patterns";

type Props = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  kicker?: string;
};

export function SectionHeader({ title, subtitle, actionLabel, kicker }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        {kicker ? (
          <View style={styles.kickerBadge}>
            <Text style={styles.kickerText}>{kicker}</Text>
          </View>
        ) : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {actionLabel ? <Text style={styles.action}>{actionLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  copy: { flex: 1, gap: 4 },
  kickerBadge: {
    ...premiumPillStyles.subtleSurface,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  kickerText: {
    ...Typography.caption,
    color: Colors.premium,
    fontWeight: "700",
  },
  title: { ...Typography.heading, color: Colors.textStrong },
  subtitle: { ...Typography.caption, color: Colors.textSoft },
  action: { ...Typography.caption, color: Colors.premium, fontWeight: "700" },
});
