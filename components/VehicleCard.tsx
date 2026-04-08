import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Motion, Typography } from "@/constants/theme";
import { VehicleRecord } from "@/types";
import { cardStyles } from "@/design/patterns";

type Props = {
  vehicle: VehicleRecord;
  subtitle?: string;
  onPress?: () => void;
};

export function VehicleCard({ vehicle, subtitle, onPress }: Props) {
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}>
      <Image source={{ uri: vehicle.heroImage }} style={styles.image} />
      <View style={styles.body}>
        <Text style={styles.title}>{vehicle.year} {vehicle.make} {vehicle.model}</Text>
        <Text style={styles.trim}>{vehicle.trim} • {vehicle.bodyStyle}</Text>
        <Text style={styles.subtitle}>{subtitle ?? vehicle.overview}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    ...cardStyles.standard,
    padding: 0,
    overflow: "hidden",
  },
  pressed: { transform: [{ scale: Motion.pressInScale }] },
  image: { width: "100%", height: 180 },
  body: { padding: 16, gap: 6 },
  title: { ...Typography.heading, color: Colors.textStrong },
  trim: { ...Typography.caption, color: Colors.textMuted },
  subtitle: { ...Typography.body, color: Colors.textMuted },
});
