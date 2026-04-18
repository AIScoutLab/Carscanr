import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { Colors, Radius, Typography } from "@/constants/theme";
import { buttonStyles } from "@/design/patterns";

const slides = [
  { title: "Scan any car instantly", body: "Take a photo or upload one from your library. CarScanr handles everyday cars, trucks, motorcycles, and classics with a fast photo-first flow." },
  { title: "Get specs, value, and listings", body: "See the vehicle basics first, then explore specs, market context, and similar listings when they’re available." },
  { title: "Save and collect cars", body: "Keep your favorite scans in Garage so you can revisit interesting vehicles, compare them later, and build a collection over time." },
  { title: "Unlock more when you want", body: "Basic scans stay free. Use your included Pro unlocks only when you want deeper detail on a specific vehicle." },
];

export default function OnboardingScreen() {
  const screenWidth = Dimensions.get("window").width - 40;
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const [lastTap, setLastTap] = useState<"Guest" | "Create Free Account" | "Sign In" | null>(null);

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

  const completeOnboarding = async (target: string) => {
    await AsyncStorage.setItem("hasSeenOnboarding", "true");
    router.replace(target as never);
  };

  const goToAuth = (mode: "sign-in" | "sign-up") => {
    const tapLabel = mode === "sign-up" ? "Create Free Account" : "Sign In";
    const href = mode === "sign-up" ? "/auth?mode=sign-up" : "/auth?mode=sign-in";

    setLastTap(tapLabel);
    console.log(`[tap] onboarding-${mode === "sign-up" ? "create-account" : "sign-in"}`);
    console.log("[onboarding] navigating to auth", { mode, href });
    void completeOnboarding(href).catch((error) => {
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
        {__DEV__ ? (
          <View style={styles.debugBanner}>
            <Text style={styles.debugBannerTitle}>LIVE ONBOARDING SCREEN V2</Text>
            <Text style={styles.debugBannerText}>pathname: {pathname}</Text>
          </View>
        ) : null}
        <LinearGradient colors={["rgba(16,56,148,0.42)", "rgba(0,194,255,0.12)", "rgba(7,13,28,0.94)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
          <Text style={styles.title}>Use CarScanr free right away.</Text>
          <Text style={styles.subtitle}>Scan first. Create an account later only if you want Garage sync, saved history, and restore.</Text>
          <Text style={styles.heroSupport}>Unlimited scans stay free. Use your included Pro unlocks only when you want deeper detail.</Text>
        </LinearGradient>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slidesRow}>
          {slides.map((slide) => (
            <View key={slide.title} style={[styles.card, { width: screenWidth }]}>
              <Text style={styles.cardTitle}>{slide.title}</Text>
              <Text style={styles.cardBody}>{slide.body}</Text>
            </View>
          ))}
        </ScrollView>
      </ScrollView>

      <View style={styles.ctaSection}>
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          onPress={() => {
            console.log("[tap] onboarding-guest-button");
            setLastTap("Guest");
            void completeOnboarding("/(tabs)/scan").catch((error) => {
              console.error("[onboarding] guest continue failed", error);
            });
          }}
        >
          <Text style={styles.primaryButtonLabel}>Try Free Without Account</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          activeOpacity={0.86}
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
          activeOpacity={0.86}
          accessibilityRole="button"
          onPress={() => {
            console.log("[tap] onboarding-sign-in-button");
            goToAuth("sign-in");
          }}
        >
          <Text style={styles.tertiaryButtonLabel}>Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.86} accessibilityRole="button" onPress={() => {
          setLastTap("Guest");
          void completeOnboarding("/(tabs)/scan").catch(() => undefined);
        }}>
          <Text style={styles.skipLabel}>Skip intro and continue as guest</Text>
        </TouchableOpacity>
        {__DEV__ ? <Text style={styles.debugLabel}>Last tap: {lastTap ?? "none yet"}</Text> : null}
        <View style={styles.footerWrap} pointerEvents="none">
          <Text style={styles.footer}>Free includes unlimited scans and 5 Pro unlocks. Upgrade later only if you want unlimited full details.</Text>
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
    paddingBottom: 12,
  },
  heroCard: {
    borderRadius: Radius.xl,
    padding: 20,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  heroSupport: { ...Typography.bodyStrong, color: Colors.textStrong },
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
  title: { ...Typography.largeTitle, color: Colors.textStrong },
  subtitle: { ...Typography.body, color: Colors.textSoft },
  slidesRow: { gap: 12 },
  card: {
    backgroundColor: Colors.card,
    padding: 20,
    borderRadius: Radius.lg,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { ...Typography.heading, color: Colors.textStrong },
  cardBody: { ...Typography.body, color: Colors.textSoft },
  ctaSection: {
    gap: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  primaryButton: buttonStyles.primary,
  primaryButtonLabel: { ...Typography.bodyStrong, color: "#FFFFFF" },
  secondaryButton: buttonStyles.secondary,
  secondaryButtonLabel: { ...Typography.bodyStrong, color: Colors.text },
  tertiaryButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  tertiaryButtonLabel: { ...Typography.bodyStrong, color: Colors.text },
  debugLabel: {
    ...Typography.caption,
    color: Colors.text,
    textAlign: "center",
  },
  skipLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: "center",
  },
  footerWrap: {
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  footer: { ...Typography.caption, color: Colors.textSoft, textAlign: "center" },
});
