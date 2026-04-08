import { Ionicons } from "@expo/vector-icons";
import { Href, router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Radius, Typography } from "@/constants/theme";

type Props = {
  fallbackHref: Href;
  label?: string;
};

export function BackButton({ fallbackHref, label = "Back" }: Props) {
  const handlePress = () => {
    if (typeof router.canGoBack === "function" && router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(fallbackHref);
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.button} onPress={handlePress}>
        <Ionicons name="chevron-back" size={18} color={Colors.text} />
        <Text style={styles.label}>{label}</Text>
      </Pressable>
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
