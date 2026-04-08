import { StyleSheet, Text, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";

type Props = {
  mpg?: string | null;
  reliability?: string | null;
  maintenance?: string | null;
};

export function OwnershipInsightsCard({ mpg, reliability, maintenance }: Props) {
  const rows = [
    mpg ? { label: "Efficiency", value: mpg } : null,
    reliability ? { label: "Reliability", value: reliability } : null,
    maintenance ? { label: "Maintenance", value: maintenance } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  if (rows.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Ownership Insights</Text>
        <Text style={styles.empty}>We’ll surface ownership metrics once more data is available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Ownership Insights</Text>
      {rows.map((row, index) => (
        <View
          key={row.label}
          style={[styles.row, index < rows.length - 1 && styles.rowDivider]}
        >
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.standard,
    padding: 18,
    gap: 10,
  },
  title: { ...Typography.heading, color: Colors.textStrong },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.borderSoft },
  label: { ...Typography.caption, color: Colors.textMuted },
  value: { ...Typography.bodyStrong, color: Colors.textStrong },
  empty: { ...Typography.body, color: Colors.textMuted },
});
