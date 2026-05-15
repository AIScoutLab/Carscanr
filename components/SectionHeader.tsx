import { StyleSheet, Text, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { PillBadge } from "@/components/PillBadge";

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
          <PillBadge tone="subtle" label={kicker} />
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
  title: { ...Typography.heading, color: Colors.textStrong },
  subtitle: { ...Typography.caption, color: Colors.textSoft },
  action: { ...Typography.caption, color: Colors.premium, fontWeight: "700" },
});
