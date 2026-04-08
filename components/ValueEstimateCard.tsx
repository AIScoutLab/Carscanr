import { StyleSheet, Text, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { ValuationResult } from "@/types";
import { cardStyles } from "@/design/patterns";

export function ValueEstimateCard({ result }: { result: ValuationResult }) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Estimated market value</Text>
      <View style={styles.row}>
        <Metric label="Trade-in" value={result.tradeIn} />
        <Metric label="Private" value={result.privateParty} />
        <Metric label="Retail" value={result.dealerRetail} />
      </View>
      <Text style={styles.caption}>{result.confidenceLabel}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyles.standard, padding: 18, gap: 14 },
  heading: { ...Typography.heading, color: Colors.textStrong },
  row: { flexDirection: "row", gap: 10 },
  metric: { flex: 1, backgroundColor: Colors.cardAlt, borderRadius: 14, padding: 12, gap: 4 },
  metricLabel: { ...Typography.caption, color: Colors.textMuted },
  metricValue: { ...Typography.bodyStrong, color: Colors.textStrong },
  caption: { ...Typography.caption, color: Colors.success },
});
