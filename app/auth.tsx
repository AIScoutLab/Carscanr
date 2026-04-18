import { router, useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { useSubscription } from "@/hooks/useSubscription";
import { mobileEnv } from "@/lib/env";
import { authService } from "@/services/authService";

export default function AuthScreen() {
  const pathname = usePathname();
  const params = useLocalSearchParams<{ mode?: "sign-in" | "sign-up" }>();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const contentRef = useRef<View | null>(null);
  const passwordInputRef = useRef<TextInput | null>(null);
  const emailFieldRef = useRef<View | null>(null);
  const passwordFieldRef = useRef<View | null>(null);
  const submitButtonRef = useRef<View | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authDebugLines, setAuthDebugLines] = useState<string[]>([]);
  const { refreshStatus } = useSubscription();

  const hasApiBaseUrl = Boolean(mobileEnv.apiBaseUrl);
  const hasSupabaseUrl = Boolean(mobileEnv.supabaseUrl);
  const hasSupabaseAnonKey = Boolean(mobileEnv.supabaseAnonKey);
  const networkTarget = "Supabase";
  const supabaseTarget = useMemo(() => {
    try {
      return new URL(mobileEnv.supabaseUrl).origin;
    } catch {
      return mobileEnv.supabaseUrl || "invalid-supabase-url";
    }
  }, []);
  const apiTarget = useMemo(() => {
    try {
      return new URL(mobileEnv.apiBaseUrl).origin;
    } catch {
      return mobileEnv.apiBaseUrl || "invalid-api-url";
    }
  }, []);

  const appendAuthDebug = (label: string, value?: unknown) => {
    const nextLine = value === undefined ? label : `${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
    console.log("[auth-debug]", nextLine);
    setAuthDebugLines((current) => [...current.slice(-5), nextLine]);
  };

  const scrollFieldIntoView = (field: "email" | "password") => {
    requestAnimationFrame(() => {
      const contentNode = contentRef.current;
      const fieldNode = field === "email" ? emailFieldRef.current : passwordFieldRef.current;
      const submitNode = submitButtonRef.current;

      if (!contentNode || !fieldNode || !submitNode) {
        return;
      }

      fieldNode.measureLayout(
        contentNode,
        (_fieldX, fieldY) => {
          submitNode.measureLayout(
            contentNode,
            (_submitX, submitY) => {
              const desiredY = Math.max(0, Math.min(fieldY - 48, submitY - 220));
              scrollRef.current?.scrollTo({
                y: desiredY,
                animated: true,
              });
            },
            () => {
              scrollRef.current?.scrollTo({
                y: Math.max(0, fieldY - 48),
                animated: true,
              });
            },
          );
        },
        () => {
          return;
        },
      );
    });
  };

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
        console.log("[auth] redirecting to tabs", {
          reason: "access-token-present",
          pathname,
        });
        await refreshStatus();
        router.replace("/(tabs)/scan");
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
    if (!hasApiBaseUrl || !hasSupabaseUrl || !hasSupabaseAnonKey) {
      setAuthError("Configuration error - this build is missing API or Supabase settings.");
    }
  }, [hasApiBaseUrl, hasSupabaseAnonKey, hasSupabaseUrl]);

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
      setAuthDebugLines([]);
      appendAuthDebug("sign-up tapped", mode === "sign-up");
      appendAuthDebug("request start", { mode, target: networkTarget, supabaseTarget });
      if (mode === "sign-in") {
        await authService.signIn(normalizedEmail, normalizedPassword);
        console.log("[auth] submit success", { mode });
        await refreshStatus();
        console.log("[auth] redirecting to tabs", {
          reason: "auth-submit-success",
          pathname,
          mode,
        });
        router.replace("/(tabs)/scan");
        return;
      }

      const result = await authService.signUp(normalizedEmail, normalizedPassword);
      appendAuthDebug("sign-up outcome", result.outcome);
      if (result.outcome === "confirmation_required") {
        setMode("sign-in");
        setPassword("");
        setAuthNotice(result.message);
        return;
      }

      console.log("[auth] submit success", { mode });
      await refreshStatus();
      console.log("[auth] redirecting to tabs", {
        reason: "auth-submit-success",
        pathname,
        mode,
      });
      router.replace("/(tabs)/scan");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      appendAuthDebug("request failed", message);
      appendAuthDebug("parsed error message", message);
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
      appendAuthDebug("Reset link requested");
      appendAuthDebug("password reset request start", { target: networkTarget, supabaseTarget });
      await authService.resetPassword(normalizedEmail);
      setAuthNotice("Password reset email sent. Check your inbox.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send password reset email.";
      appendAuthDebug("password reset failed", message);
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
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "left"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Math.max(insets.top, 12)}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingTop: 4, paddingBottom: Math.max(insets.bottom, 24) + 120 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
      <View ref={contentRef} collapsable={false}>
      {__DEV__ ? (
        <View style={styles.debugBanner}>
          <Text style={styles.debugBannerTitle}>LIVE AUTH SCREEN V2</Text>
          <Text style={styles.debugBannerText}>AUTH SCREEN LOADED</Text>
          <Text style={styles.debugBannerText}>pathname: {pathname}</Text>
          <Text style={styles.debugBannerText}>mode: {mode}</Text>
          <Text style={styles.debugBannerText}>API base URL present: {hasApiBaseUrl ? "yes" : "no"}</Text>
          <Text style={styles.debugBannerText}>Supabase URL present: {hasSupabaseUrl ? "yes" : "no"}</Text>
          <Text style={styles.debugBannerText}>Network target: {networkTarget}</Text>
          <Text style={styles.debugBannerText}>Supabase host: {supabaseTarget}</Text>
          <Text style={styles.debugBannerText}>API host: {apiTarget}</Text>
          {authDebugLines.map((line) => (
            <Text key={line} style={styles.debugBannerText}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
      <LinearGradient colors={["rgba(16,56,148,0.38)", "rgba(0,194,255,0.12)", "rgba(7,13,28,0.94)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.brandWrap}>
        <View style={styles.logoShell}>
          <Image source={require("@/carscanr_app_icon_1024.png")} style={styles.logoImage} resizeMode="cover" />
        </View>
        <View style={styles.brandTextWrap}>
          <Text style={styles.brandName}>Use CarScanr free right away.</Text>
          <Text style={styles.brandNote}>Create an account only if you want Garage sync, saved history, and restore across devices.</Text>
        </View>
      </LinearGradient>
      <Text style={styles.title}>{mode === "sign-in" ? "Welcome back." : "Create your account."}</Text>
      <Text style={styles.subtitle}>
        {mode === "sign-in"
          ? "Sign in to sync your Garage, saved history, and unlocks across devices."
          : "Create an account if you want Garage sync, saved history, and restore across devices. Scanning still works without one."}
      </Text>
      <View style={styles.guestNoteCard}>
        <Text style={styles.guestNoteTitle}>Account optional</Text>
        <Text style={styles.guestNoteBody}>Unlimited basic scans stay free. Accounts are mainly for sync, saved history, and restore.</Text>
      </View>
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.quickActionButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          onPress={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        >
          <Text style={styles.quickActionLabel}>
            {mode === "sign-in" ? "Create Free Account" : "Already Have an Account?"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickActionButton}
          activeOpacity={0.86}
          accessibilityRole="button"
          onPress={() => {
            console.log("[tap] auth-continue-as-guest");
            router.replace("/(tabs)/scan");
          }}
        >
          <Text style={styles.quickActionLabel}>Continue as Guest</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.card}>
        <View ref={emailFieldRef} collapsable={false}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.textMuted}
            onFocus={() => {
              scrollFieldIntoView("email");
            }}
            onSubmitEditing={() => passwordInputRef.current?.focus()}
          />
        </View>
        <View ref={passwordFieldRef} collapsable={false}>
          <TextInput
            ref={passwordInputRef}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            returnKeyType="done"
            onFocus={() => {
              scrollFieldIntoView("password");
            }}
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
        <View ref={submitButtonRef} collapsable={false}>
          <PrimaryButton label={isSubmitting ? "Working..." : mode === "sign-in" ? "Sign In" : "Create Account"} onPress={submit} disabled={isSubmitting} />
        </View>
        <PrimaryButton
          label="Continue with Apple"
          secondary
          onPress={() => {
            console.log("[tap] auth-apple-placeholder");
            Alert.alert("Apple sign-in unavailable", "Apple sign-in is not wired yet. Please use email and password for now.");
          }}
        />
      </View>
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
        activeOpacity={0.86}
        accessibilityRole="button"
        onPress={() => {
          switchMode(mode === "sign-in" ? "sign-up" : "sign-in");
        }}
      >
        <Text style={styles.switchText}>{mode === "sign-in" ? "Need an account? Create one for free." : "Already have an account? Sign in."}</Text>
      </TouchableOpacity>
      </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    gap: 20,
    paddingHorizontal: 20,
  },
  debugBanner: {
    backgroundColor: "#FFF0C7",
    borderRadius: Radius.lg,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: "#E4C35A",
  },
  debugBannerTitle: {
    ...Typography.bodyStrong,
    color: Colors.text,
  },
  debugBannerText: {
    ...Typography.caption,
    color: Colors.text,
  },
  brandWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 8,
    padding: 18,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  logoShell: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.accentGlow,
    overflow: "hidden",
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 24,
  },
  brandTextWrap: {
    gap: 4,
    flex: 1,
  },
  brandName: {
    ...Typography.title,
    color: Colors.textStrong,
  },
  brandNote: {
    ...Typography.body,
    color: Colors.textSoft,
  },
  title: { ...Typography.largeTitle, color: Colors.text, marginTop: 10 },
  subtitle: { ...Typography.body, color: Colors.textSoft },
  quickActions: {
    gap: 10,
  },
  guestNoteCard: {
    backgroundColor: Colors.cardAlt,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  guestNoteTitle: {
    ...Typography.bodyStrong,
    color: Colors.text,
  },
  guestNoteBody: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  quickActionButton: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: {
    ...Typography.bodyStrong,
    color: Colors.text,
    textAlign: "center",
  },
  card: { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 20, gap: 14 },
  input: {
    backgroundColor: Colors.cardAlt,
    borderRadius: Radius.md,
    padding: 16,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Typography.body,
  },
  forgotPasswordButton: {
    alignSelf: "flex-end",
    marginTop: -2,
  },
  forgotPasswordText: {
    ...Typography.body,
    color: Colors.accent,
  },
  switchText: { ...Typography.body, color: Colors.accent, textAlign: "center" },
  errorCard: {
    backgroundColor: "#FFF1F2",
    borderWidth: 1,
    borderColor: "#FDA4AF",
    borderRadius: Radius.lg,
    padding: 16,
    gap: 8,
  },
  errorTitle: {
    ...Typography.bodyStrong,
    color: Colors.text,
  },
  errorBody: {
    ...Typography.body,
    color: Colors.text,
  },
  noticeCard: {
    backgroundColor: "#EEF8E8",
    borderWidth: 1,
    borderColor: "#9ED08A",
    borderRadius: Radius.lg,
    padding: 16,
    gap: 8,
  },
  noticeTitle: {
    ...Typography.bodyStrong,
    color: Colors.text,
  },
  noticeBody: {
    ...Typography.body,
    color: Colors.text,
  },
});
