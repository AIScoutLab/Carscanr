import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";

const slides = [
  { title: "Snap", body: "Take a photo or upload one from your library. CarScanr handles cars and motorcycles with a fast, premium flow." },
  { title: "Identify", body: "AI returns the most likely year, make, and model with confidence and backup candidate matches when the shot is tricky." },
  { title: "Learn and save", body: "See original MSRP, colors, drivetrain, value, and nearby listings, then save the scan to your Garage." },
];

export default function OnboardingScreen() {
  const goToAuth = async (mode: "sign-in" | "sign-up") => {
    await AsyncStorage.setItem("hasSeenOnboarding", "true");
    router.replace({ pathname: "/(auth)", params: { mode } });
  };

  return (
    <AppContainer>
      <Text style={styles.eyebrow}>CarScanr</Text>
      <Text style={styles.title}>Identify vehicles from a single photo.</Text>
      <Text style={styles.subtitle}>A simple, elegant mobile app for recognizing cars and motorcycles, then seeing the details that matter.</Text>
      {slides.map((slide) => (
        <View key={slide.title} style={styles.card}>
          <Text style={styles.cardTitle}>{slide.title}</Text>
          <Text style={styles.cardBody}>{slide.body}</Text>
        </View>
      ))}
      <PrimaryButton label="Start Free" onPress={() => goToAuth("sign-up")} />
      <PrimaryButton
        label="Sign In"
        secondary
        onPress={() => goToAuth("sign-in")}
      />
      <Text style={styles.footer}>Free includes 5 scans total. Pro unlocks unlimited scans and full specs for $6.99/month.</Text>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  eyebrow: { ...Typography.caption, color: Colors.accent, marginTop: 12 },
  title: { ...Typography.largeTitle, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  card: { backgroundColor: Colors.card, padding: 20, borderRadius: Radius.lg, gap: 8 },
  cardTitle: { ...Typography.heading, color: Colors.text },
  cardBody: { ...Typography.body, color: Colors.textMuted },
  footer: { ...Typography.caption, color: Colors.textMuted, textAlign: "center", paddingHorizontal: 10 },
});
