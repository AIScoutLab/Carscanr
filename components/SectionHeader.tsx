import { StyleSheet, Text, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";

type Props = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
};

export function SectionHeader({ title, subtitle, actionLabel }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <View style={styles.kickerRow}>
          <View style={styles.kickerLine} />
          <Text style={styles.kicker}>Performance view</Text>
        </View>
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
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  kickerLine: { width: 18, height: 2, borderRadius: 999, backgroundColor: Colors.accent },
  kicker: { ...Typography.caption, color: Colors.textFaint, textTransform: "uppercase", letterSpacing: 1 },
  title: { ...Typography.heading, color: Colors.textStrong },
  subtitle: { ...Typography.caption, color: Colors.textSoft },
  action: { ...Typography.caption, color: Colors.premium, fontWeight: "700" },
});
