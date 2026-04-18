import { StyleSheet, Text, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { ValuationResult } from "@/types";
import { cardStyles } from "@/design/patterns";

export function ValueEstimateCard({ result }: { result: ValuationResult }) {
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>Performance market</Text>
      <Text style={styles.heading}>Estimated market value</Text>
      <View style={styles.row}>
        <Metric label="Trade-in" value={result.tradeIn} range={result.tradeInRange} />
        <Metric label="Private" value={result.privateParty} range={result.privatePartyRange} />
        <Metric label="Retail" value={result.dealerRetail} range={result.dealerRetailRange} />
      </View>
      <Text style={styles.source}>{result.sourceLabel}</Text>
      <Text style={styles.caption}>{result.confidenceLabel}</Text>
    </View>
  );
}

function Metric({ label, value, range }: { label: string; value: string; range: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricRange}>{range}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyles.standard, padding: 18, gap: 14 },
  kicker: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 1 },
  heading: { ...Typography.heading, color: Colors.textStrong },
  row: { flexDirection: "row", gap: 10 },
  metric: {
    flex: 1,
    backgroundColor: Colors.cardAlt,
    borderRadius: 14,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  metricLabel: { ...Typography.caption, color: Colors.textSoft },
  metricValue: { ...Typography.bodyStrong, color: Colors.textStrong },
  metricRange: { ...Typography.caption, color: Colors.textMuted },
  source: { ...Typography.caption, color: Colors.textStrong },
  caption: { ...Typography.caption, color: Colors.success },
});
