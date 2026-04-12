import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors, Typography } from "@/constants/theme";
import { VehicleRecord } from "@/types";
import { cardStyles } from "@/design/patterns";

type Props = {
  vehicle: VehicleRecord;
  subtitle?: string;
  onPress?: () => void;
};

export function VehicleCard({ vehicle, subtitle, onPress }: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.86} accessibilityRole="button">
      <Image source={{ uri: vehicle.heroImage }} style={styles.image} />
      <View style={styles.body}>
        <Text style={styles.title}>{vehicle.year} {vehicle.make} {vehicle.model}</Text>
        <Text style={styles.trim}>{vehicle.trim} • {vehicle.bodyStyle}</Text>
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
  image: { width: "100%", height: 180 },
  body: { padding: 16, gap: 6 },
  title: { ...Typography.heading, color: Colors.textStrong },
  trim: { ...Typography.caption, color: Colors.textMuted },
  subtitle: { ...Typography.body, color: Colors.textMuted },
});
