import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { VehicleCandidate } from "@/types";
import { confidenceTone, formatConfidence } from "@/lib/utils";
import { cardStyles } from "@/design/patterns";

type Props = {
  candidate: VehicleCandidate;
  onPress?: () => void;
  hideConfidence?: boolean;
  confidenceLabelOverride?: string | null;
  tapHintOverride?: string | null;
  selected?: boolean;
};

export function CandidateMatchCard({
  candidate,
  onPress,
  hideConfidence = false,
  confidenceLabelOverride = null,
  tapHintOverride = null,
  selected = false,
}: Props) {
  const title = candidate.displayTitleLabel ?? [candidate.displayYearLabel ?? null, candidate.make, candidate.model].filter(Boolean).join(" ");
  const isTappable = Boolean(onPress);

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected, !isTappable && styles.cardDisabled]}
      onPress={onPress}
      activeOpacity={isTappable ? 0.86 : 1}
      accessibilityRole={isTappable ? "button" : undefined}
      disabled={!isTappable}
    >
      <View style={styles.body}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.title}>{title || `${candidate.make} ${candidate.model}`}</Text>
            <Text style={styles.subtitle}>{candidate.displayTrimLabel ?? candidate.trim ?? "Likely trim match"}</Text>
          </View>
          {!hideConfidence ? (
            <View style={styles.confidenceBlock}>
              <Text style={styles.confidenceValue}>{formatConfidence(candidate.confidence)}</Text>
              <Text style={styles.confidenceLabel}>{confidenceLabelOverride ?? confidenceTone(candidate.confidence)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.tapHint}>{tapHintOverride ?? (isTappable ? "Tap to highlight this match" : "Detailed specs are not available yet")}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyles.secondary, padding: 16 },
  cardSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.cardAlt,
  },
  cardDisabled: { opacity: 0.78 },
  body: { gap: 10 },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  copy: { flex: 1, gap: 4 },
  title: { ...Typography.bodyStrong, color: Colors.textStrong },
  subtitle: { ...Typography.caption, color: Colors.textSoft },
  confidenceBlock: {
    alignItems: "flex-end",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  confidenceValue: { ...Typography.bodyStrong, color: Colors.textStrong },
  confidenceLabel: { ...Typography.caption, color: Colors.premium },
  tapHint: { ...Typography.caption, color: Colors.textMuted },
});
