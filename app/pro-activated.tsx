import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";

export default function ProActivatedScreen() {
  return (
    <AppContainer>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Pro activated</Text>
        <Text style={styles.title}>Unlimited scans and full vehicle details are now unlocked.</Text>
        <Text style={styles.body}>
          You can go back to scanning, open listings and values, and use full premium detail without worrying about free unlock limits.
        </Text>
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
