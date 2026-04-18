import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { authService } from "@/services/authService";

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ error?: string }>();
  const scrollRef = useRef<ScrollView | null>(null);
  const contentRef = useRef<View | null>(null);
  const passwordFieldRef = useRef<View | null>(null);
  const confirmPasswordFieldRef = useRef<View | null>(null);
  const submitButtonRef = useRef<View | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resetDiagnostics, setResetDiagnostics] = useState<string[]>(["Reset screen opened"]);

  const scrollFieldIntoView = (field: "password" | "confirm-password") => {
    requestAnimationFrame(() => {
      const contentNode = contentRef.current;
      const fieldNode = field === "password" ? passwordFieldRef.current : confirmPasswordFieldRef.current;
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
    if (!params.error) {
      return;
    }

    setResetDiagnostics((current) => [...current.slice(-4), "Reset screen opened with invalid link"]);
    setErrorMessage("This password reset link is invalid or expired. Request a new reset email and try again.");
  }, [params.error]);

  const submit = async () => {
    const nextPassword = password.trim();
    const nextConfirmPassword = confirmPassword.trim();

    setErrorMessage(null);
    setSuccessMessage(null);

    if (!nextPassword || !nextConfirmPassword) {
      setErrorMessage("Enter and confirm your new password to continue.");
      return;
    }

    if (nextPassword.length < 8) {
      setErrorMessage("Use a password with at least 8 characters.");
      return;
    }

    if (nextPassword !== nextConfirmPassword) {
      setErrorMessage("Your passwords do not match.");
      return;
    }

    try {
      setIsSubmitting(true);
      setResetDiagnostics((current) => [...current.slice(-4), "Password update requested"]);
      await authService.updatePassword(nextPassword);
      setPassword("");
      setConfirmPassword("");
      setResetDiagnostics((current) => [...current.slice(-4), "Password updated successfully"]);
      setSuccessMessage("Password updated. You can sign in with your new password.");
    } catch (error) {
      setResetDiagnostics((current) => [...current.slice(-4), "Password update failed"]);
      setErrorMessage(error instanceof Error ? error.message : "Unable to update your password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "left"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Math.max(insets.top, 12)}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingTop: 14, paddingBottom: Math.max(insets.bottom, 24) + 120 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View ref={contentRef} collapsable={false}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>CarScanr</Text>
            <Text style={styles.title}>Reset your password.</Text>
            <Text style={styles.subtitle}>Choose a new password for your CarScanr account, then sign in again.</Text>
          </View>
          {__DEV__ ? (
            <View style={styles.debugBanner}>
              {resetDiagnostics.map((line) => (
                <Text key={line} style={styles.debugBannerText}>
                  {line}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.card}>
            <View ref={passwordFieldRef} collapsable={false}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                style={styles.input}
                placeholder="New password"
                placeholderTextColor={Colors.textMuted}
                returnKeyType="next"
                onFocus={() => {
                  scrollFieldIntoView("password");
                }}
              />
            </View>
            <View ref={confirmPasswordFieldRef} collapsable={false}>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                style={styles.input}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.textMuted}
                returnKeyType="done"
                onFocus={() => {
                  scrollFieldIntoView("confirm-password");
                }}
                onSubmitEditing={() => {
                  void submit();
                }}
              />
            </View>
            <View ref={submitButtonRef} collapsable={false}>
              <PrimaryButton label={isSubmitting ? "Updating..." : "Update Password"} onPress={submit} disabled={isSubmitting} />
            </View>
            <PrimaryButton
              label="Back to Sign In"
              secondary
              onPress={() => {
                router.replace("/auth?mode=sign-in");
              }}
            />
          </View>

          {errorMessage ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Reset error</Text>
              <Text style={styles.errorBody}>{errorMessage}</Text>
            </View>
          ) : null}

          {successMessage ? (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeTitle}>Password updated</Text>
              <Text style={styles.noticeBody}>{successMessage}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            activeOpacity={0.86}
            accessibilityRole="button"
            onPress={() => {
              router.replace("/auth?mode=sign-in");
            }}
          >
            <Text style={styles.switchText}>Return to sign in</Text>
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
  hero: {
    gap: 10,
  },
  debugBanner: {
    backgroundColor: "#FFF0C7",
    borderRadius: Radius.lg,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: "#E4C35A",
  },
  debugBannerText: {
    ...Typography.caption,
    color: Colors.text,
  },
  eyebrow: {
    ...Typography.caption,
    color: Colors.accent,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  title: {
    ...Typography.largeTitle,
    color: Colors.text,
  },
  subtitle: {
    ...Typography.body,
    color: Colors.textMuted,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: 20,
    gap: 14,
  },
  input: {
    backgroundColor: Colors.cardAlt,
    borderRadius: Radius.md,
    padding: 16,
    color: Colors.text,
    ...Typography.body,
  },
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
  switchText: {
    ...Typography.body,
    color: Colors.accent,
    textAlign: "center",
  },
});
