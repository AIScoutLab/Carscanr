import { Redirect, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { authService } from "@/services/authService";
import { guestSessionService } from "@/services/guestSessionService";
import { startupPreferences } from "@/services/startupPreferences";

export default function Index() {
  const pathname = usePathname();
  const [target, setTarget] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    console.log("[startup] index mounted", { pathname });
    return () => {
      console.log("[startup] index unmounted", { pathname });
    };
  }, [pathname]);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        setStartupError(null);
        const [hasSeenOnboarding, token] = await Promise.all([startupPreferences.hasSeenOnboarding(), authService.getAccessToken()]);
        if (!active) return;
        if (token) {
          console.log("[startup] route decision", {
            pathname,
            reason: "access-token-present",
            target: "/(tabs)/scan",
          });
          setTarget("/(tabs)/scan");
          return;
        }
        await guestSessionService.getGuestId();
        if (!active) return;
        const nextTarget = hasSeenOnboarding ? "/(tabs)/scan" : "/onboarding";
        console.log("[startup] route decision", {
          pathname,
          reason: hasSeenOnboarding ? "guest-resume" : "first-launch",
          hasSeenOnboarding,
          guestMode: true,
          target: nextTarget,
        });
        setTarget(nextTarget as never);
      } catch (error) {
        console.error("[startup] failed to resolve initial route", error);
        if (!active) return;
        setTarget(null);
        setStartupError(error instanceof Error ? error.message : "Unable to load the app.");
      }
    };
    hydrate().catch((error) => {
      console.error("[startup] unhandled initial route error", error);
      if (!active) return;
      setTarget(null);
      setStartupError(error instanceof Error ? error.message : "Unable to load the app.");
    });
    return () => {
      active = false;
    };
  }, [pathname, reloadKey]);

  useEffect(() => {
    if (target) {
      console.log("[startup] redirect firing", {
        pathname,
        target,
      });
    }
  }, [pathname, target]);

  if (startupError) {
    return (
      <AppContainer>
        <View style={styles.card}>
          <View style={styles.errorBadge}>
            <Text style={styles.errorBadgeLabel}>Startup issue</Text>
          </View>
          <Text style={styles.title}>CarScanr couldn’t finish startup</Text>
          <Text style={styles.message}>Try loading the app again. If this keeps happening, reinstall the latest build.</Text>
          <Text style={styles.detail}>{startupError}</Text>
          <PrimaryButton label="Try Again" onPress={() => setReloadKey((value) => value + 1)} />
        </View>
      </AppContainer>
    );
  }

  if (!target) {
    return (
      <AppContainer scroll={false} contentContainerStyle={styles.loadingPage}>
        <LinearGradient colors={["rgba(29,140,255,0.24)", "rgba(94,231,255,0.08)", "rgba(4,8,18,0.08)"]} style={styles.loadingHero}>
          <Text style={styles.title}>Starting CarScanr</Text>
          <Text style={styles.message}>Restoring your session and getting the next scan ready.</Text>
        </LinearGradient>
        <View style={styles.loadingStack}>
          <PremiumSkeleton height={132} radius={Radius.xl} />
          <PremiumSkeleton height={108} radius={Radius.xl} />
          <PremiumSkeleton height={168} radius={Radius.xl} />
        </View>
      </AppContainer>
    );
  }

  return <Redirect href={target as never} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: 24,
    gap: 12,
    marginTop: 24,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  loadingPage: {
    flex: 1,
    justifyContent: "center",
    gap: 18,
  },
  loadingHero: {
    borderRadius: Radius.xl,
    padding: 22,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  loadingStack: {
    gap: 14,
  },
  errorBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.dangerSoft,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  errorBadgeLabel: {
    ...Typography.caption,
    color: Colors.danger,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    ...Typography.heading,
    color: Colors.textStrong,
  },
  message: {
    ...Typography.body,
    color: Colors.textSoft,
  },
  detail: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
});
