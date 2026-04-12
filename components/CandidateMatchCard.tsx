import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { VehicleCandidate } from "@/types";
import { confidenceTone, formatConfidence } from "@/lib/utils";
import { cardStyles } from "@/design/patterns";

type Props = {
  candidate: VehicleCandidate;
  onPress?: () => void;
};

export function CandidateMatchCard({ candidate, onPress }: Props) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.86}
      accessibilityRole="button"
    >
      <View style={styles.body}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.title}>{candidate.year} {candidate.make} {candidate.model}</Text>
            <Text style={styles.subtitle}>{candidate.trim ?? "Likely trim match"}</Text>
          </View>
          <View style={styles.confidenceBlock}>
            <Text style={styles.confidenceValue}>{formatConfidence(candidate.confidence)}</Text>
            <Text style={styles.confidenceLabel}>{confidenceTone(candidate.confidence)}</Text>
          </View>
        </View>
        <Text style={styles.tapHint}>Tap to use this match</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyles.secondary, padding: 14 },
  body: { gap: 10 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  copy: { flex: 1, gap: 4 },
  title: { ...Typography.bodyStrong, color: Colors.textStrong },
  subtitle: { ...Typography.caption, color: Colors.textMuted },
  confidenceBlock: { alignItems: "flex-end", gap: 2 },
  confidenceValue: { ...Typography.bodyStrong, color: Colors.textStrong },
  confidenceLabel: { ...Typography.caption, color: Colors.accent },
  tapHint: { ...Typography.caption, color: Colors.textMuted },
});
