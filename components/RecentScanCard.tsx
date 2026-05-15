import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { PremiumCard } from "@/components/PremiumCard";
import { PillBadge } from "@/components/PillBadge";
import { Colors, Radius, Typography } from "@/constants/theme";
import { ScanResult } from "@/types";

function formatTimestamp(scannedAt?: string | null) {
  if (!scannedAt) return "Scanned recently";
  const date = new Date(scannedAt);
  if (Number.isNaN(date.getTime())) return "Scanned recently";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RecentScanCard({
  scan,
  onPress,
}: {
  scan: ScanResult;
  onPress?: () => void;
}) {
  const title = [scan.identifiedVehicle.year || null, scan.identifiedVehicle.make, scan.identifiedVehicle.model]
    .filter(Boolean)
    .join(" ");
  const scanReference = typeof scan.id === "string" && scan.id.length > 0 ? `Scan ${scan.id.slice(0, 8).toUpperCase()}` : null;

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} accessibilityRole="button">
      <PremiumCard variant="glass" contentStyle={styles.card}>
        <View style={styles.mediaWrap}>
          {scan.imageUri ? <Image source={{ uri: scan.imageUri }} style={styles.image} resizeMode="cover" /> : null}
          <View style={styles.mediaOverlay}>
            <PillBadge tone="brand" label={formatTimestamp(scan.scannedAt)}>
              <Ionicons name="time-outline" size={14} color={Colors.premium} />
            </PillBadge>
          </View>
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>{title || "Vehicle identified"}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {scanReference ?? "Saved from your recent scan history"}
          </Text>
          <Text style={styles.description} numberOfLines={2}>
            {scan.limitedPreview ? "Free preview saved. Tap to reopen the result." : "Tap to reopen the full saved scan result."}
          </Text>
        </View>
      </PremiumCard>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    alignItems: "center",
  },
  mediaWrap: {
    width: 84,
    height: 84,
    borderRadius: Radius.lg,
    overflow: "hidden",
    backgroundColor: Colors.cardAlt,
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  mediaOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    padding: 8,
    backgroundColor: "rgba(4,10,18,0.10)",
  },
  copy: {
    flex: 1,
    gap: 6,
  },
  title: {
    ...Typography.heading,
    color: Colors.textStrong,
  },
  meta: {
    ...Typography.caption,
    color: Colors.premium,
  },
  description: {
    ...Typography.body,
    color: Colors.textSoft,
  },
});
