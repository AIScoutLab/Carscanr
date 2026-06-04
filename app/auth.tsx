import { Href, router, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Radius, Typography } from "@/constants/theme";
import { RuntimeDebugStamp } from "@/components/RuntimeDebugStamp";
import { useSubscription } from "@/hooks/useSubscription";
import { mobileEnv } from "@/lib/env";
import { authService } from "@/services/authService";
import { startupPreferences } from "@/services/startupPreferences";

export default function AuthScreen() {
  const pathname = usePathname();
  const params = useLocalSearchParams<{ mode?: "sign-in" | "sign-up"; returnTo?: string }>();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const passwordInputRef = useRef<TextInput | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [pendingReturnTo, setPendingReturnTo] = useState<string | null>(null);
  const { refreshStatus } = useSubscription();

  const hasApiBaseUrl = Boolean(mobileEnv.apiBaseUrl);
  const hasSupabaseUrl = Boolean(mobileEnv.supabaseUrl);
  const hasSupabaseAnonKey = Boolean(mobileEnv.supabaseAnonKey);
  const explicitReturnTo = typeof params.returnTo === "string" && isSafeReturnTarget(params.returnTo)
    ? params.returnTo
    : null;
  const returnTo = explicitReturnTo ?? "/(tabs)/scan";

  useEffect(() => {
    console.log("[auth] route mounted", {
      pathname,
      params,
      mode: params.mode,
    });
    return () => {
      console.log("[auth] route unmounted", {
        pathname,
        params,
        mode: params.mode,
      });
    };
  }, [pathname, params]);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      const token = await authService.getAccessToken();
      if (!active) return;
      if (token) {
        console.log("[auth] active session detected on auth screen", {
          pathname,
        });
        await refreshStatus();
      }
    };
    hydrate().catch((error) => {
      console.error("[auth] failed to hydrate auth entry", error);
    });
    return () => {
      active = false;
    };
  }, [refreshStatus]);

  useEffect(() => {
    if (params.mode === "sign-in" || params.mode === "sign-up") {
      setMode(params.mode);
      setEmail("");
      setPassword("");
      setAuthNotice(null);
    }
  }, [params.mode]);

  useEffect(() => {
    let active = true;
    const hydratePendingReturn = async () => {
      if (explicitReturnTo) {
        await startupPreferences.setPendingAuthReturnTarget(explicitReturnTo);
      }
      const persisted = await startupPreferences.getPendingAuthReturnTarget();
      if (!active) return;
      setPendingReturnTo(persisted);
      console.log("[auth] pending return target hydrated", {
        explicitReturnTo: explicitReturnTo ?? null,
        persistedReturnTo: persisted ?? null,
      });
    };
    hydratePendingReturn().catch((error) => {
      console.warn("[auth] failed to hydrate return target", {
        explicitReturnTo: explicitReturnTo ?? null,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => {
      active = false;
    };
  }, [explicitReturnTo]);

  useEffect(() => {
    if (!hasApiBaseUrl || !hasSupabaseUrl || !hasSupabaseAnonKey) {
      setAuthError("Configuration error - this build is missing API or Supabase settings.");
    }
  }, [hasApiBaseUrl, hasSupabaseAnonKey, hasSupabaseUrl]);

  const scrollFormIntoView = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 90);
  };

  const clearPendingReturnTarget = async () => {
    await startupPreferences.clearPendingAuthReturnTarget();
    setPendingReturnTo(null);
  };

  const navigateAfterAuthSuccess = async () => {
    const target = await startupPreferences.consumePendingAuthReturnTarget(explicitReturnTo ?? returnTo);
    setPendingReturnTo(null);
    console.log("[auth] redirecting after submit", {
      reason: "auth-submit-success",
      pathname,
      mode,
      explicitReturnTo: explicitReturnTo ?? null,
      pendingReturnTo: target,
      hasReturnTo: target !== "/(tabs)/scan",
    });
    router.replace(target as Href);
  };

  const submit = async () => {
    console.log("[tap] auth-submit", { mode, hasEmail: Boolean(email.trim()), hasPassword: Boolean(password.trim()) });
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (!normalizedEmail || !normalizedPassword) {
      Alert.alert(mode === "sign-in" ? "Sign in required" : "Create account required", "Enter an email and password to continue.");
      return;
    }

    try {
      setIsSubmitting(true);
      setAuthError(null);
      setAuthNotice(null);
      if (mode === "sign-in") {
        await authService.signIn(normalizedEmail, normalizedPassword);
        console.log("[auth] submit success", { mode });
        await refreshStatus();
        await navigateAfterAuthSuccess();
        return;
      }

      const result = await authService.signUp(normalizedEmail, normalizedPassword);
      if (result.outcome === "confirmation_required") {
        setMode("sign-in");
        setPassword("");
        setAuthNotice(result.message);
        return;
      }

      console.log("[auth] submit success", { mode });
      await refreshStatus();
      await navigateAfterAuthSuccess();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      setAuthError(message);
      Alert.alert(mode === "sign-in" ? "Unable to sign in" : "Unable to create account", message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const forgotPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    console.log("[tap] auth-forgot-password", { hasEmail: Boolean(normalizedEmail) });

    setAuthError(null);
    setAuthNotice(null);

    if (!normalizedEmail) {
      setAuthError("Enter your email address first so we can send a password reset link.");
      return;
    }

    try {
      setIsSubmitting(true);
      await authService.resetPassword(normalizedEmail);
      setAuthNotice("Password reset email sent. Check your inbox.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send password reset email.";
      setAuthError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (nextMode: "sign-in" | "sign-up") => {
    console.log("[tap] auth-switch-mode", { from: mode, to: nextMode });
    setMode(nextMode);
    setEmail("");
    setPassword("");
    setAuthError(null);
    setAuthNotice(null);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "left", "bottom"]}>
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(205,144,82,0.16)", "rgba(22,19,18,0.10)", "rgba(5,5,6,0)"]}
        locations={[0, 0.45, 1]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.82, y: 0.9 }}
        style={styles.warmGlow}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.05)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.7 }}
        style={styles.topSheen}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 132, 180) }]}
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          <View style={styles.contentInner}>
            <View style={styles.topBar}>
              <TouchableOpacity
                style={[styles.topBarButton, styles.backButton]}
                activeOpacity={0.86}
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={() => {
                  clearPendingReturnTarget()
                    .catch(() => undefined)
                    .finally(() => {
                      if (router.canGoBack()) {
                        router.back();
                        return;
                      }
                      router.replace("/(tabs)/scan");
                    });
                }}
              >
                <Ionicons name="chevron-back" size={20} color={Colors.textStrong} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.topBarButton}
                activeOpacity={0.86}
                accessibilityRole="button"
                onPress={() => {
                  clearPendingReturnTarget()
                    .catch(() => undefined)
                    .finally(() => {
                      router.replace("/(tabs)/scan");
                    });
                }}
              >
                <Text style={styles.topBarButtonLabel}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.heroCopy}>
              <Text style={styles.title}>{mode === "sign-in" ? "Welcome back." : "Create your account."}</Text>
              <Text style={styles.subtitle}>
                {mode === "sign-in"
                  ? "Sign in to sync your Garage, saved scans, and unlocks across devices."
                  : "Create an account to sync your Garage, history, and unlocks across devices."}
              </Text>
            </View>
            <RuntimeDebugStamp
              screen="auth-v4-return"
              lines={[
                `explicitReturnTo ${explicitReturnTo ? explicitReturnTo.slice(0, 72) : "none"}`,
                `pendingReturnTo ${pendingReturnTo ? pendingReturnTo.slice(0, 72) : "none"}`,
                `mode ${mode}`,
              ]}
            />

            <View style={styles.guestNoteCard}>
              <View style={styles.sectionEyebrowRow}>
                <View style={styles.goldDot} />
                <Text style={styles.guestNoteTitle}>Account Optional</Text>
              </View>
              <Text style={styles.guestNoteBody}>Basic scanning stays free. Accounts sync your Garage, history, and unlocks across devices.</Text>
              <View style={styles.guestActionRow}>
                <TouchableOpacity
                  style={[styles.authButton, styles.authButtonPrimary]}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  onPress={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
                >
                  <LinearGradient colors={["#D9A46D", "#C8905A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonFill}>
                    <Text style={styles.primaryButtonLabel}>
                      {mode === "sign-in" ? "Create Free Account" : "Sign In Instead"}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.authButton, styles.authButtonSecondary]}
                  activeOpacity={0.86}
                  accessibilityRole="button"
                  onPress={() => {
                    console.log("[tap] auth-continue-as-guest");
                    startupPreferences
                      .setHasSeenOnboarding()
                      .catch(() => undefined)
                      .finally(() => {
                        clearPendingReturnTarget()
                          .catch(() => undefined)
                          .finally(() => {
                            router.replace("/(tabs)/scan");
                          });
                      });
                  }}
                >
                  <Text style={styles.secondaryButtonLabel}>Continue as Guest</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.formLabel}>{mode === "sign-in" ? "Already have an account" : "Create with email"}</Text>
              <View style={styles.inputStack}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                  style={styles.input}
                  placeholder="Email"
                  placeholderTextColor="#7E8797"
                  onFocus={scrollFormIntoView}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
                <TextInput
                  ref={passwordInputRef}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#7E8797"
                  returnKeyType="done"
                  onFocus={scrollFormIntoView}
                  onSubmitEditing={() => {
                    void submit();
                  }}
                />
              </View>
              {mode === "sign-in" ? (
                <TouchableOpacity
                  activeOpacity={0.86}
                  accessibilityRole="button"
                  onPress={() => {
                    void forgotPassword();
                  }}
                  style={styles.forgotPasswordButton}
                >
                  <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                </TouchableOpacity>
              ) : null}
              {authError ? (
                <View style={styles.errorCard}>
                  <Text style={styles.errorTitle}>Auth error</Text>
                  <Text style={styles.errorBody}>{authError}</Text>
                </View>
              ) : null}
              {authNotice ? (
                <View style={styles.noticeCard}>
                  <Text style={styles.noticeTitle}>Check your email</Text>
                  <Text style={styles.noticeBody}>{authNotice}</Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={[styles.authButton, styles.authButtonPrimary, isSubmitting && styles.disabledButton]}
                activeOpacity={0.88}
                accessibilityRole="button"
                onPress={submit}
                disabled={isSubmitting}
              >
                <LinearGradient colors={["#D9A46D", "#C8905A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonFill}>
                  <Text style={styles.primaryButtonLabel}>{isSubmitting ? "Working..." : mode === "sign-in" ? "Sign In" : "Create Account"}</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.authButton, styles.appleButton]}
                activeOpacity={0.86}
                accessibilityRole="button"
                onPress={() => {
                  console.log("[tap] auth-apple-placeholder");
                  Alert.alert("Apple sign-in unavailable", "Apple sign-in is not wired yet. Please use email and password for now.");
                }}
              >
                <Ionicons name="logo-apple" size={18} color={Colors.textStrong} />
                <Text style={styles.secondaryButtonLabel}>Continue with Apple</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function isSafeReturnTarget(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("://");
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#050506",
  },
  flex: {
    flex: 1,
  },
  warmGlow: {
    position: "absolute",
    top: -120,
    left: -80,
    right: -80,
    height: 420,
  },
  topSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  content: {
    flexGrow: 1,
    paddingTop: 6,
    paddingHorizontal: 22,
  },
  contentInner: {
    gap: 18,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 0,
  },
  topBarButton: {
    minHeight: 38,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(28,28,30,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  backButton: {
    width: 38,
    paddingHorizontal: 0,
  },
  topBarButtonLabel: {
    ...Typography.caption,
    color: Colors.textStrong,
    fontWeight: "600",
    letterSpacing: 0,
  },
  heroCopy: {
    gap: 8,
    marginTop: 4,
  },
  title: {
    ...Typography.largeTitle,
    fontFamily: Platform.select({ ios: "AvenirNext-Bold", default: "sans-serif" }),
    fontWeight: "700",
    letterSpacing: -0.45,
    color: Colors.text,
    lineHeight: 41,
    paddingTop: 2,
  },
  subtitle: {
    ...Typography.body,
    color: "#AEB5C2",
    lineHeight: 22,
  },
  guestNoteCard: {
    backgroundColor: "rgba(21,21,23,0.88)",
    borderRadius: 18,
    padding: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  sectionEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  goldDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#D8A46F",
  },
  guestNoteTitle: {
    ...Typography.caption,
    color: "#E7BD8A",
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  guestNoteBody: {
    ...Typography.body,
    color: "#B9BFCA",
    lineHeight: 21,
  },
  guestActionRow: {
    gap: 10,
  },
  authButton: {
    minHeight: 50,
    borderRadius: 13,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  authButtonPrimary: {
    backgroundColor: "#C8905A",
    shadowColor: "#C8905A",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 22,
    elevation: 4,
  },
  authButtonSecondary: {
    backgroundColor: "rgba(26,26,28,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  appleButton: {
    backgroundColor: "rgba(12,12,13,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonFill: {
    minHeight: 50,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryButtonLabel: {
    ...Typography.bodyStrong,
    color: "#070707",
    textAlign: "center",
    fontWeight: "800",
  },
  secondaryButtonLabel: {
    ...Typography.bodyStrong,
    color: Colors.textStrong,
    textAlign: "center",
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.65,
  },
  card: {
    backgroundColor: "rgba(20,20,22,0.88)",
    borderRadius: 18,
    padding: 18,
    gap: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  formLabel: {
    ...Typography.caption,
    color: "#9098A7",
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  inputStack: {
    gap: 10,
  },
  input: {
    minHeight: 50,
    backgroundColor: "rgba(43,43,45,0.82)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: Colors.text,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    ...Typography.body,
  },
  forgotPasswordButton: {
    alignSelf: "flex-end",
    marginTop: -1,
    marginBottom: 1,
    paddingVertical: 2,
  },
  forgotPasswordText: {
    ...Typography.caption,
    color: "#DDB27F",
    fontWeight: "700",
  },
  errorCard: {
    backgroundColor: "rgba(90,31,36,0.42)",
    borderWidth: 1,
    borderColor: "rgba(244,113,116,0.34)",
    borderRadius: Radius.lg,
    padding: 16,
    gap: 8,
  },
  errorTitle: {
    ...Typography.bodyStrong,
    color: "#FFD4D6",
  },
  errorBody: {
    ...Typography.body,
    color: "#F1BEC2",
  },
  noticeCard: {
    backgroundColor: "rgba(38,57,35,0.46)",
    borderWidth: 1,
    borderColor: "rgba(158,208,138,0.34)",
    borderRadius: Radius.lg,
    padding: 16,
    gap: 8,
  },
  noticeTitle: {
    ...Typography.bodyStrong,
    color: "#D8F0CE",
  },
  noticeBody: {
    ...Typography.body,
    color: "#C3D8BB",
  },
});
