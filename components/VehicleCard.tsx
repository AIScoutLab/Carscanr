import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Typography } from "@/constants/theme";
import { formatHorsepowerLabel } from "@/lib/vehicleData";
import { VehicleRecord } from "@/types";
import { cardStyles } from "@/design/patterns";

type Props = {
  vehicle: VehicleRecord;
  subtitle?: string;
  onPress?: () => void;
};

export function VehicleCard({ vehicle, subtitle, onPress }: Props) {
  const title = [vehicle.year > 0 ? String(vehicle.year) : null, vehicle.make, vehicle.model].filter(Boolean).join(" ");
  const statChips = [
    vehicle.bodyStyle || null,
    vehicle.specs.engine || null,
    formatHorsepowerLabel(vehicle.specs.horsepower),
  ].filter(Boolean);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.86} accessibilityRole="button">
      <View style={styles.imageWrap}>
        <Image source={{ uri: vehicle.heroImage }} style={styles.image} />
        <LinearGradient colors={["rgba(4,8,18,0)", "rgba(4,8,18,0.88)"]} style={styles.imageOverlay} />
        <View style={styles.titleOverlay}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.trim}>{vehicle.trim} • {vehicle.bodyStyle}</Text>
        </View>
      </View>
      <View style={styles.body}>
        <View style={styles.statsRow}>
          {statChips.map((chip, index) => (
            <View key={`${chip}-${index}`} style={styles.statChip}>
              <Text style={styles.statChipLabel}>{chip}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.subtitle}>{subtitle ?? vehicle.overview}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.standard,
    padding: 0,
    overflow: "hidden",
  },
  imageWrap: { position: "relative", backgroundColor: Colors.cardAlt },
  image: { width: "100%", height: 196 },
  imageOverlay: { ...StyleSheet.absoluteFillObject },
  titleOverlay: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 14,
    gap: 4,
  },
  body: { padding: 16, gap: 10 },
  title: { ...Typography.heading, color: "#F8FCFF" },
  trim: { ...Typography.caption, color: "rgba(230,238,249,0.78)" },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statChip: {
    backgroundColor: Colors.cardTint,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  statChipLabel: { ...Typography.caption, color: Colors.textSoft },
  subtitle: { ...Typography.body, color: Colors.textSoft },
});
