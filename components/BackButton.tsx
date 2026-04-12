import { Ionicons } from "@expo/vector-icons";
import { Href, router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";

type Props = {
  fallbackHref: Href;
  label?: string;
};

export function BackButton({ fallbackHref, label = "Back" }: Props) {
  const handlePress = () => {
    console.log("[tap] back-button", { fallbackHref });
    if (typeof router.canGoBack === "function" && router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(fallbackHref);
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.button} onPress={handlePress} activeOpacity={0.86} accessibilityRole="button">
        <Ionicons name="chevron-back" size={18} color={Colors.text} />
        <Text style={styles.label}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "flex-start",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    ...Typography.body,
    color: Colors.text,
    fontWeight: "600",
  },
});
