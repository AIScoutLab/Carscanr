import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { authService } from "@/services/authService";

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
        const [hasSeenOnboarding, token] = await Promise.all([
          AsyncStorage.getItem("hasSeenOnboarding"),
          authService.getAccessToken(),
        ]);
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
        const nextTarget = hasSeenOnboarding ? "/auth" : "/onboarding";
        console.log("[startup] route decision", {
          pathname,
          reason: hasSeenOnboarding ? "has-seen-onboarding" : "first-launch",
          hasSeenOnboarding,
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
          <Text style={styles.title}>Startup error</Text>
          <Text style={styles.message}>Configuration error - missing API settings or startup session restore failed.</Text>
          <Text style={styles.detail}>{startupError}</Text>
          <PrimaryButton label="Try Again" onPress={() => setReloadKey((value) => value + 1)} />
        </View>
      </AppContainer>
    );
  }

  if (!target) {
    return (
      <AppContainer>
        <View style={styles.card}>
          <Text style={styles.title}>Loading CarScanr</Text>
          <Text style={styles.message}>Checking your configuration and restoring your session.</Text>
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
    marginTop: 48,
  },
  title: {
    ...Typography.heading,
    color: Colors.text,
  },
  message: {
    ...Typography.body,
    color: Colors.text,
  },
  detail: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
});
