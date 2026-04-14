import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { Colors, Radius, Typography } from "@/constants/theme";
import { buttonStyles } from "@/design/patterns";

const slides = [
  { title: "Snap", body: "Take a photo or upload one from your library. CarScanr handles cars and motorcycles with a fast, premium flow." },
  { title: "Identify", body: "AI returns the most likely year, make, and model with confidence and backup candidate matches when the shot is tricky." },
  { title: "Learn and save", body: "See original MSRP, colors, drivetrain, value, and nearby listings, then save the scan to your Garage." },
];

export default function OnboardingScreen() {
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const [lastTap, setLastTap] = useState<"Start Free" | "Sign In" | null>(null);

  useEffect(() => {
    console.log("[onboarding] mounted", {
      pathname,
      params,
    });
    return () => {
      console.log("[onboarding] unmounted", {
        pathname,
        params,
      });
    };
  }, [pathname, params]);

  const goToAuth = (mode: "sign-in" | "sign-up") => {
    const tapLabel = mode === "sign-up" ? "Start Free" : "Sign In";
    const href = mode === "sign-up" ? "/auth?mode=sign-up" : "/auth?mode=sign-in";

    setLastTap(tapLabel);
    console.log(`[tap] onboarding-${mode === "sign-up" ? "start-free" : "sign-in"}`);
    console.log("[onboarding] navigating to auth", { mode, href });
    router.replace(href as never);

    void AsyncStorage.setItem("hasSeenOnboarding", "true").catch((error) => {
      console.error("[onboarding] failed to persist onboarding state", error);
    });
  };

  return (
    <AppContainer scroll={false} contentContainerStyle={styles.page}>
      <ScrollView
        style={styles.topScroll}
        contentContainerStyle={styles.topSection}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.debugBanner}>
          <Text style={styles.debugBannerTitle}>LIVE ONBOARDING SCREEN V2</Text>
          <Text style={styles.debugBannerText}>pathname: {pathname}</Text>
        </View>
        <Text style={styles.eyebrow}>CarScanr Pro</Text>
        <Text style={styles.title}>Identify vehicles from a single photo.</Text>
        <Text style={styles.subtitle}>A simple, elegant mobile app for recognizing cars and motorcycles, then seeing the details that matter.</Text>
        {slides.map((slide) => (
          <View key={slide.title} style={styles.card}>
            <Text style={styles.cardTitle}>{slide.title}</Text>
            <Text style={styles.cardBody}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.ctaSection}>
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          onPress={() => {
            console.log("[tap] onboarding-start-free-button");
            goToAuth("sign-up");
          }}
        >
          <Text style={styles.primaryButtonLabel}>Start Free</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          onPress={() => {
            console.log("[tap] onboarding-sign-in-button");
            goToAuth("sign-in");
          }}
        >
          <Text style={styles.secondaryButtonLabel}>Sign In</Text>
        </TouchableOpacity>
        <Text style={styles.debugLabel}>Last tap: {lastTap ?? "none yet"}</Text>
        <View style={styles.footerWrap} pointerEvents="none">
          <Text style={styles.footer}>Free includes unlimited basic scans and 5 Pro unlocks. Pro unlocks full specs and premium details for $6.99/month.</Text>
        </View>
      </View>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingBottom: 28,
  },
  topScroll: {
    flex: 1,
  },
  topSection: {
    gap: 20,
    paddingBottom: 20,
  },
  debugBanner: {
    backgroundColor: "#D9F3FF",
    borderRadius: Radius.lg,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: "#69B9DB",
  },
  debugBannerTitle: {
    ...Typography.heading,
    color: Colors.text,
  },
  debugBannerText: {
    ...Typography.caption,
    color: Colors.text,
  },
  eyebrow: { ...Typography.caption, color: Colors.premium, letterSpacing: 1, textTransform: "uppercase" },
  title: { ...Typography.largeTitle, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  card: { backgroundColor: Colors.card, padding: 20, borderRadius: Radius.lg, gap: 8 },
  cardTitle: { ...Typography.heading, color: Colors.text },
  cardBody: { ...Typography.body, color: Colors.textMuted },
  ctaSection: {
    gap: 14,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: Colors.background,
  },
  primaryButton: buttonStyles.primary,
  primaryButtonLabel: { ...Typography.bodyStrong, color: "#FFFFFF" },
  secondaryButton: buttonStyles.secondary,
  secondaryButtonLabel: { ...Typography.bodyStrong, color: Colors.text },
  debugLabel: {
    ...Typography.caption,
    color: Colors.text,
    textAlign: "center",
  },
  footerWrap: {
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  footer: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
});
