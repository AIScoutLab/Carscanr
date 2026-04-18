import { StyleSheet, Text, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";

type Props = {
  avgPrice?: string | null;
  priceRange?: string | null;
  dealRating?: string | null;
};

export function MarketSnapshotCard({ avgPrice, priceRange, dealRating }: Props) {
  const items = [
    { label: "Average Price", value: avgPrice ?? "Unavailable" },
    { label: "Price Range", value: priceRange ?? "Unavailable" },
    { label: "Deal Rating", value: dealRating ?? "Not enough data" },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>Market telemetry</Text>
      <Text style={styles.title}>Market Snapshot</Text>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={[styles.row, index < items.length - 1 && styles.rowDivider]}
        >
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.value}>{item.value}</Text>
        </View>
      ))}
      <Text style={styles.note}>Based on recent listings and market trends.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.standard,
    padding: 18,
    gap: 10,
  },
  kicker: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 1 },
  title: { ...Typography.heading, color: Colors.textStrong },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: Colors.borderSoft },
  label: { ...Typography.caption, color: Colors.textSoft },
  value: { ...Typography.bodyStrong, color: Colors.textStrong },
  note: { ...Typography.caption, color: Colors.textMuted },
});
