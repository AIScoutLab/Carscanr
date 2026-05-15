import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";

export function FeatureRow({
  items,
}: {
  items: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string }>;
}) {
  return (
    <View style={styles.row}>
      {items.map((item) => (
        <View key={`${item.icon}-${item.label}`} style={styles.item}>
          <View style={styles.iconWrap}>
            <Ionicons name={item.icon} size={18} color={Colors.premium} />
          </View>
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  item: {
    minWidth: 140,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(94, 235, 255, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(94, 235, 255, 0.16)",
  },
  label: {
    ...Typography.caption,
    color: Colors.textSoft,
    flex: 1,
  },
});
