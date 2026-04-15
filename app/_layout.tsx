import "react-native-gesture-handler";
import { useEffect, useState } from "react";
import { router, Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Linking, StyleSheet, Text, View } from "react-native";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Colors, Typography } from "@/constants/theme";
import { SubscriptionProvider } from "@/features/subscription/SubscriptionProvider";
import { assertMobileStartupConfig, getMobileEnvDiagnostics, getMobileStartupConfigError, requiredExpoPublicEnvKeys } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";

function extractDeepLinkTokens(url: string) {
  try {
    const parsed = new URL(url);
    const hashParams = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash);
    const searchParams = new URLSearchParams(parsed.search.startsWith("?") ? parsed.search.slice(1) : parsed.search);
    const params = hashParams.toString() ? hashParams : searchParams;

    return {
      accessToken: params.get("access_token"),
      refreshToken: params.get("refresh_token"),
      type: params.get("type"),
      errorDescription: params.get("error_description"),
    };
  } catch (error) {
    console.error("[auth-link] failed to parse incoming url", { url, error });
    return null;
  }
}

export default function RootLayout() {
  const [startupError, setStartupError] = useState<string | null>(null);
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  useEffect(() => {
    const diagnostics = getMobileEnvDiagnostics();
    console.log("[startup-config] EXPO_PUBLIC env diagnostics", diagnostics);

    try {
      const configError = getMobileStartupConfigError();
      if (configError) {
        console.error("[startup-config] missing or invalid EXPO_PUBLIC variables", {
          requiredKeys: requiredExpoPublicEnvKeys,
          ...diagnostics,
          configError,
        });
        throw new Error(configError);
      }

      assertMobileStartupConfig();
      void offlineCanonicalService.preload();
      setStartupError(null);
    } catch (error) {
      console.error("[startup-config] invalid mobile configuration", error);
      setStartupError(error instanceof Error ? error.message : "Configuration error - missing API settings");
    }
  }, []);

  useEffect(() => {
    console.log("[route] root layout route change", {
      pathname,
      params,
    });
  }, [pathname, params]);

  useEffect(() => {
    let active = true;

    const handleAuthLink = async (url: string, source: "initial" | "event") => {
      console.log("[auth-link] received", { source, url });
      const isAuthLink = url.startsWith("carscanr://auth");
      const isResetPasswordLink = url.startsWith("carscanr://reset-password");
      if (!isAuthLink && !isResetPasswordLink) {
        return;
      }

      const parsed = extractDeepLinkTokens(url);
      if (!parsed) {
        return;
      }

      if (parsed.errorDescription) {
        console.error("[auth-link] provider returned error", {
          source,
          errorDescription: parsed.errorDescription,
        });
        if (active) {
          router.replace((isResetPasswordLink ? "/reset-password?error=link-error" : "/auth?mode=sign-in") as never);
        }
        return;
      }

      if (!parsed.accessToken || !parsed.refreshToken) {
        console.log("[auth-link] no session tokens found in url", {
          source,
          type: parsed.type,
        });
        if (active) {
          router.replace((isResetPasswordLink ? "/reset-password?error=missing-session" : "/auth?mode=sign-in") as never);
        }
        return;
      }

      try {
        await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        });
        console.log("[auth-link] session restored from deep link", {
          source,
          type: parsed.type,
        });
        if (active) {
          if (isResetPasswordLink || parsed.type === "recovery") {
            router.replace("/reset-password" as never);
          } else {
            router.replace("/(tabs)/scan" as never);
          }
        }
      } catch (error) {
        console.error("[auth-link] failed to restore session from deep link", error);
        if (active) {
          router.replace((isResetPasswordLink ? "/reset-password?error=session-restore-failed" : "/auth?mode=sign-in") as never);
        }
      }
    };

    Linking.getInitialURL()
      .then((url) => {
        if (url) {
          return handleAuthLink(url, "initial");
        }
      })
      .catch((error) => {
        console.error("[auth-link] failed to read initial url", error);
      });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void handleAuthLink(url, "event");
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  if (startupError) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.card}>
          <Text style={styles.title}>Configuration error - missing API settings</Text>
          <Text style={styles.message}>{startupError}</Text>
          <Text style={styles.help}>
            This build is missing one or more required EXPO_PUBLIC environment variables. Verify the production EAS environment.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ErrorBoundary
      fallbackTitle="App error"
      fallbackMessage="The app hit an unexpected rendering issue. Review the console logs and the detail message below."
    >
      <SubscriptionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#F5F6F8" } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="auth" />
          <Stack.Screen name="reset-password" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="scan/camera" />
          <Stack.Screen name="scan/result" />
          <Stack.Screen name="vehicle/[id]" />
          <Stack.Screen name="paywall" options={{ presentation: "modal" }} />
        </Stack>
      </SubscriptionProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F6F8",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 24,
    padding: 24,
    gap: 12,
  },
  title: {
    ...Typography.heading,
    color: Colors.text,
  },
  message: {
    ...Typography.body,
    color: Colors.text,
  },
  help: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
});
