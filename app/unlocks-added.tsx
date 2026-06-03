import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";

export default function UnlocksAddedScreen() {
  return (
    <AppContainer>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>5 unlocks added</Text>
        <Text style={styles.title}>Your account now has 5 premium unlocks.</Text>
        <Text style={styles.body}>Use them for Market Values, Live Listings, and pricing details on the vehicles you choose.</Text>
      </View>
      <PrimaryButton label="Continue" onPress={() => router.replace("/(tabs)/scan")} />
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: 24,
    gap: 12,
    marginTop: 28,
  },
  eyebrow: { ...Typography.caption, color: Colors.accent },
  title: { ...Typography.title, color: Colors.text },
  body: { ...Typography.body, color: Colors.textMuted },
});
