import { Href, router, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Radius, Typography } from "@/constants/theme";
import { useSubscription } from "@/hooks/useSubscription";
import { mobileEnv } from "@/lib/env";
import { posthog } from "@/lib/posthog";
import { authService } from "@/services/authService";
import { startupPreferences } from "@/services/startupPreferences";

export default function AuthScreen() {
  const pathname = usePathname();
  const params = useLocalSearchParams<{ mode?: "sign-in" | "sign-up"; returnTo?: string }>();
  const insets = useSafeAreaInsets();
  const passwordInputRef = useRef<TextInput | null>(null);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(null);
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

  const clearPendingReturnTarget = async () => {
    await startupPreferences.clearPendingAuthReturnTarget();
    setPendingReturnTo(null);
  };

  useEffect(() => {
    const keyboardShowEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const keyboardHideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(keyboardShowEvent, () => {
      setIsKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(keyboardHideEvent, () => {
      setIsKeyboardVisible(false);
      setFocusedField(null);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

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
        const signedInUser = await authService.getCurrentUser();
        if (signedInUser?.id) {
          posthog.identify(signedInUser.id, { $set: { app_env: mobileEnv.appEnv } });
        }
        posthog.capture("user_signed_in");
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
      const signedUpUser = await authService.getCurrentUser();
      if (signedUpUser?.id) {
        posthog.identify(signedUpUser.id, {
          $set: { app_env: mobileEnv.appEnv },
          $set_once: { first_signup_date: new Date().toISOString() },
        });
      }
      posthog.capture("user_signed_up");
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

  const continueAsGuest = () => {
    console.log("[tap] auth-continue-as-guest");
    posthog.capture("guest_session_started");
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
  };

  const continueWithApple = () => {
    console.log("[tap] auth-apple-placeholder");
    Alert.alert("Apple sign-in unavailable", "Apple sign-in is not wired yet. Please use email and password for now.");
  };

  const isSignUp = mode === "sign-up";
  const screenTitle = isSignUp ? "Sync your Garage and unlocks" : "Welcome back.";
  const screenSubtitle = isSignUp
    ? "Create an account to back up your Garage, scan history, purchases, and unlocks across devices."
    : "Sign in to sync your Garage, saved scans, purchases, and unlocks across devices.";

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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? Math.max(insets.top - 8, 0) : 0}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            isKeyboardVisible && styles.contentKeyboardVisible,
            { paddingBottom: isKeyboardVisible ? Math.max(insets.bottom + 36, 56) : Math.max(insets.bottom + 96, 128) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          <View style={[styles.contentInner, isKeyboardVisible && styles.contentInnerKeyboardVisible]}>
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

            <View style={[styles.heroCopy, isKeyboardVisible && styles.heroCopyKeyboardVisible]}>
              <Text style={[styles.title, isKeyboardVisible && styles.titleKeyboardVisible]}>{screenTitle}</Text>
              {!isKeyboardVisible ? <Text style={styles.subtitle}>{screenSubtitle}</Text> : null}
            </View>
            {!isKeyboardVisible ? (
              <TouchableOpacity
                style={[styles.authButton, styles.primaryAppleButton]}
                activeOpacity={0.88}
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
                onPress={continueWithApple}
              >
                <LinearGradient colors={["#E0AE79", "#C8905A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonFill}>
                  <Ionicons name="logo-apple" size={19} color="#070707" />
                  <Text style={styles.primaryButtonLabel}>Continue with Apple</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : null}

            <View style={[styles.card, isKeyboardVisible && styles.cardKeyboardVisible]}>
              {isSignUp ? (
                <View style={styles.dividerRow} accessibilityRole="text">
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerLabel}>or create with email</Text>
                  <View style={styles.dividerLine} />
                </View>
              ) : (
                <Text style={styles.formLabel}>Sign in with email</Text>
              )}
              <View style={styles.inputStack}>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                  style={[styles.input, focusedField === "email" && styles.inputFocused]}
                  placeholder="Email"
                  placeholderTextColor="#7E8797"
                  accessibilityLabel="Email"
                  textContentType="emailAddress"
                  onFocus={() => setFocusedField("email")}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
                <TextInput
                  ref={passwordInputRef}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  style={[styles.input, focusedField === "password" && styles.inputFocused]}
                  placeholder="Password"
                  placeholderTextColor="#7E8797"
                  returnKeyType="done"
                  accessibilityLabel="Password"
                  textContentType={isSignUp ? "newPassword" : "password"}
                  onFocus={() => setFocusedField("password")}
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
                style={[styles.authButton, isSignUp ? styles.emailSubmitButton : styles.authButtonPrimary, isSubmitting && styles.disabledButton]}
                activeOpacity={0.88}
                accessibilityRole="button"
                accessibilityLabel={isSignUp ? "Create Account" : "Sign In"}
                onPress={submit}
                disabled={isSubmitting}
              >
                {isSignUp ? (
                  <Text style={styles.emailSubmitButtonLabel}>{isSubmitting ? "Working..." : "Create Account"}</Text>
                ) : (
                  <LinearGradient colors={["#D9A46D", "#C8905A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buttonFill}>
                    <Text style={styles.primaryButtonLabel}>{isSubmitting ? "Working..." : "Sign In"}</Text>
                  </LinearGradient>
                )}
              </TouchableOpacity>
              <View style={styles.modeLinkRow}>
                <Text style={styles.modeLinkCopy}>{isSignUp ? "Already have an account?" : "Need an account?"}</Text>
                <TouchableOpacity
                  activeOpacity={0.86}
                  accessibilityRole="link"
                  accessibilityLabel={isSignUp ? "Sign In" : "Create Account"}
                  onPress={() => switchMode(isSignUp ? "sign-in" : "sign-up")}
                >
                  <Text style={styles.modeLinkText}>{isSignUp ? "Sign In" : "Create Account"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {!isKeyboardVisible ? (
              <TouchableOpacity
                style={styles.guestOption}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel="Continue as Guest"
                onPress={continueAsGuest}
              >
                <Text style={styles.guestOptionText}>Continue as Guest</Text>
                <Text style={styles.guestOptionHelper}>Skip for now. You can create an account later.</Text>
              </TouchableOpacity>
            ) : null}
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
  contentKeyboardVisible: {
    paddingTop: 0,
    justifyContent: "flex-start",
  },
  contentInner: {
    gap: 18,
  },
  contentInnerKeyboardVisible: {
    gap: 8,
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
  heroCopyKeyboardVisible: {
    gap: 0,
    marginTop: 0,
  },
  title: {
    ...Typography.largeTitle,
    fontFamily: Platform.select({ ios: "AvenirNext-Bold", default: "sans-serif" }),
    fontWeight: "700",
    letterSpacing: 0,
    color: Colors.text,
    lineHeight: 41,
    paddingTop: 2,
  },
  titleKeyboardVisible: {
    fontSize: 24,
    lineHeight: 29,
  },
  subtitle: {
    ...Typography.body,
    color: "#AEB5C2",
    lineHeight: 22,
  },
  authButton: {
    minHeight: 50,
    borderRadius: 8,
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
  primaryAppleButton: {
    minHeight: 54,
    backgroundColor: "#C8905A",
    shadowColor: "#C8905A",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 5,
  },
  buttonFill: {
    minHeight: 50,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 18,
  },
  primaryButtonLabel: {
    ...Typography.bodyStrong,
    color: "#070707",
    textAlign: "center",
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.65,
  },
  card: {
    backgroundColor: "rgba(20,20,22,0.88)",
    borderRadius: 8,
    padding: 18,
    gap: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  cardKeyboardVisible: {
    padding: 14,
    gap: 10,
  },
  formLabel: {
    ...Typography.caption,
    color: "#9098A7",
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  dividerLabel: {
    ...Typography.caption,
    color: "#9EA6B4",
    fontWeight: "700",
    letterSpacing: 0,
  },
  emailSubmitButton: {
    backgroundColor: "rgba(26,26,28,0.94)",
    borderWidth: 1,
    borderColor: "rgba(216,164,111,0.42)",
  },
  emailSubmitButtonLabel: {
    ...Typography.bodyStrong,
    color: "#F0C38E",
    textAlign: "center",
    fontWeight: "800",
  },
  modeLinkRow: {
    minHeight: 28,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  modeLinkCopy: {
    ...Typography.caption,
    color: "#AEB5C2",
    letterSpacing: 0,
  },
  modeLinkText: {
    ...Typography.caption,
    color: "#E5B87E",
    fontWeight: "800",
    letterSpacing: 0,
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
  guestOption: {
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  guestOptionText: {
    ...Typography.bodyStrong,
    color: "#D2D7E0",
    textAlign: "center",
    fontWeight: "700",
  },
  guestOptionHelper: {
    ...Typography.caption,
    color: "#838C9B",
    textAlign: "center",
    letterSpacing: 0,
  },
  inputFocused: {
    borderColor: "rgba(216,164,111,0.72)",
    backgroundColor: "rgba(47,47,50,0.94)",
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
