import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ImageBackground, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Radius, Typography } from "@/constants/theme";
import { startupPreferences } from "@/services/startupPreferences";

const HERO_IMAGE_URI =
  "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1400&q=80";

const features = [
  {
    key: "instant-scan",
    label: "Instant AI Scan",
    icon: <Ionicons name="flash" size={20} color="#B8F6FF" />,
  },
  {
    key: "specs-value",
    label: "Full Specs + Value",
    icon: <Ionicons name="bar-chart" size={20} color="#B8F6FF" />,
  },
  {
    key: "cars-near-you",
    label: "Cars Near You",
    icon: <Ionicons name="location" size={20} color="#B8F6FF" />,
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();

  const completeOnboarding = async (target: string) => {
    await startupPreferences.setHasSeenOnboarding();
    router.replace(target as never);
  };

  const goToAuth = (mode: "sign-in" | "sign-up") => {
    const href = mode === "sign-up" ? "/auth?mode=sign-up" : "/auth?mode=sign-in";
    void completeOnboarding(href).catch((error) => {
      console.error("[onboarding] failed to persist onboarding state", error);
    });
  };

  return (
    <View style={styles.root}>
      <ImageBackground source={{ uri: HERO_IMAGE_URI }} style={styles.heroBackground} imageStyle={styles.heroImage}>
        <LinearGradient colors={["rgba(2,6,14,0.88)", "rgba(3,10,24,0.42)", "rgba(5,8,18,0.08)"]} start={{ x: 0, y: 0.05 }} end={{ x: 1, y: 0.6 }} style={styles.topGradient} />
        <LinearGradient colors={["rgba(7,13,24,0.0)", "rgba(7,13,24,0.38)", "rgba(3,6,14,0.94)"]} start={{ x: 0.5, y: 0.45 }} end={{ x: 0.5, y: 1 }} style={styles.bottomGradient} />
        <LinearGradient colors={["rgba(0,0,0,0.34)", "rgba(0,0,0,0.04)", "rgba(0,0,0,0.4)"]} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 1 }} style={styles.vignette} />
      </ImageBackground>

      <SafeAreaView style={styles.safeContent} edges={["top", "bottom"]}>
        <View
          style={[
            styles.content,
            {
              paddingTop: Math.max(22, insets.top + 8),
              paddingBottom: Math.max(22, insets.bottom + 10),
            },
          ]}
        >
          <View style={styles.topSection}>
            <View style={styles.cameraIconWrap}>
              <Ionicons name="scan" size={36} color="#69DFFF" />
            </View>
            <Text style={styles.headline}>Identify any car instantly.</Text>
            <Text style={styles.subheadline}>Scan first. Save later if you want.</Text>
          </View>

          <View style={styles.featureBlock}>
            {features.map((feature) => (
              <View key={feature.key} style={styles.featureRow}>
                <View style={styles.featureIcon}>{feature.icon}</View>
                <Text style={styles.featureLabel}>{feature.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.88}
              accessibilityRole="button"
              onPress={() => {
                console.log("[tap] onboarding-guest-button");
                void completeOnboarding("/(tabs)/scan").catch((error) => {
                  console.error("[onboarding] guest continue failed", error);
                });
              }}
            >
              <LinearGradient
                colors={["#2458D6", "#2E7AF0", "#4FCFF2"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.primaryButtonGradient}
              >
                <Text style={styles.primaryButtonLabel}>Try for Free</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.88}
              accessibilityRole="button"
              onPress={() => {
                console.log("[tap] onboarding-create-account-button");
                goToAuth("sign-up");
              }}
            >
              <Text style={styles.secondaryButtonLabel}>Create Free Account</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tertiaryButton}
              activeOpacity={0.88}
              accessibilityRole="button"
              onPress={() => {
                console.log("[tap] onboarding-sign-in-button");
                goToAuth("sign-in");
              }}
            >
              <Text style={styles.tertiaryButtonLabel}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020611",
  },
  heroBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#020611",
  },
  heroImage: {
    resizeMode: "cover",
    transform: [{ scale: 1.08 }],
  },
  topGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
  },
  safeContent: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 28,
  },
  topSection: {
    alignItems: "center",
    gap: 14,
    marginTop: 8,
  },
  cameraIconWrap: {
    width: 78,
    height: 78,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8, 24, 46, 0.26)",
    borderWidth: 1,
    borderColor: "rgba(103, 226, 255, 0.18)",
    shadowColor: "#3EDCFF",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  headline: {
    ...Typography.hero,
    color: "#FFFFFF",
    textAlign: "center",
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    maxWidth: 320,
  },
  subheadline: {
    ...Typography.body,
    color: "rgba(255,255,255,0.78)",
    textAlign: "center",
    fontSize: 18,
    lineHeight: 25,
    maxWidth: 300,
  },
  featureBlock: {
    alignSelf: "flex-start",
    gap: 18,
    marginLeft: 12,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  featureIcon: {
    width: 24,
    alignItems: "center",
  },
  featureLabel: {
    ...Typography.heading,
    color: "#FFFFFF",
    fontWeight: "500",
  },
  bottomSection: {
    gap: 11,
  },
  primaryButton: {
    borderRadius: 999,
    overflow: "hidden",
    shadowColor: "#33CFFF",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryButtonGradient: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(171,243,255,0.18)",
  },
  primaryButtonLabel: {
    ...Typography.heading,
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 17,
  },
  secondaryButton: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,16,28,0.34)",
    borderWidth: 1,
    borderColor: "rgba(198,220,255,0.16)",
  },
  secondaryButtonLabel: {
    ...Typography.heading,
    color: "#FFFFFF",
    fontWeight: "500",
    fontSize: 17,
  },
  tertiaryButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 6,
  },
  tertiaryButtonLabel: {
    ...Typography.heading,
    color: "rgba(255,255,255,0.52)",
    fontWeight: "500",
  },
});
