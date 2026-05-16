import { router } from "expo-router";
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { PaywallCard } from "@/components/PaywallCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/lib/supabase";
import { authService } from "@/services/authService";
import { getApiAuthDebug } from "@/services/apiClient";
import { AuthUser } from "@/types";

export default function ProfileScreen() {
  const {
    status,
    isLoading,
    isRestoring,
    isCancelling,
    freeUnlocksUsed,
    freeUnlocksRemaining,
    freeUnlocksLimit,
    feedbackMessage,
    errorMessage,
    restorePurchases,
    cancelPro,
  } = useSubscription();
  const [user, setUser] = useState<AuthUser | null>(authService.getCurrentUserSync());
  const [tokenPresent, setTokenPresent] = useState(false);
  const [sessionDetected, setSessionDetected] = useState(false);
  const [apiDebug, setApiDebug] = useState(getApiAuthDebug());

  const refreshAuthSnapshot = async () => {
    const [{ data }, nextUser, token] = await Promise.all([supabase.auth.getSession(), authService.getCurrentUser(), authService.getAccessToken()]);
    setSessionDetected(Boolean(data.session));
    setUser(nextUser);
    setTokenPresent(Boolean(token));
    setApiDebug(getApiAuthDebug());
  };

  useEffect(() => {
    refreshAuthSnapshot().catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAuthSnapshot().catch(() => undefined);
    }, []),
  );

  return (
    <AppContainer>
      <LinearGradient colors={["rgba(29,140,255,0.18)", "rgba(94,231,255,0.05)", "rgba(4,8,18,0.2)"]} style={styles.heroCard}>
        <Text style={styles.title}>Account and access</Text>
        <Text style={styles.heroBody}>Unlimited free scans stay front and center. Your account adds sync, history, support, and recovery across devices.</Text>
      </LinearGradient>
      <View style={[styles.card, styles.accountCard]}>
        <Text style={styles.sectionTitle}>Account</Text>
        <Text style={styles.name}>{user ? user.fullName : "Guest mode"}</Text>
        <Text style={styles.meta}>
          {user ? user.email : "Create an account to sync your Garage, unlock history, and purchase recovery across devices."}
        </Text>
        {!user ? (
          <View style={styles.actionGroup}>
            <PrimaryButton label="Create Free Account" onPress={() => router.push("/auth?mode=sign-up")} />
            <PrimaryButton label="Sign In" secondary onPress={() => router.push("/auth?mode=sign-in")} />
          </View>
        ) : null}
        {__DEV__ ? (
          <View style={styles.debugBlock}>
            <Text style={styles.debugLine}>Session detected: {sessionDetected ? "yes" : "no"}</Text>
            <Text style={styles.debugLine}>Auth status: {user ? "Signed In" : "Guest"}</Text>
            <Text style={styles.debugLine}>Token present: {tokenPresent ? "Yes" : "No"}</Text>
            <Text style={styles.debugLine}>Current email: {user?.email ?? "None"}</Text>
            <Text style={styles.debugLine}>API base: {apiDebug?.baseUrl ?? "Unknown"}</Text>
            <Text style={styles.debugLine}>
              Last request: {apiDebug ? `${apiDebug.method} ${apiDebug.path}` : "None"}
            </Text>
            <Text style={styles.debugLine}>
              Last request auth: {apiDebug ? (apiDebug.sentAuthHeader ? "Yes" : "No") : "Unknown"}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Subscription & access</Text>
        <Text style={styles.meta}>{isLoading ? "Checking plan..." : status?.plan === "pro" ? "Pro active" : "Free plan"}</Text>
        <Text style={styles.meta}>{status?.renewalLabel ?? "Sign in to sync your subscription status."}</Text>
        <Text style={styles.meta}>
          {freeUnlocksUsed} of {freeUnlocksLimit} free Pro unlocks used
        </Text>
        <Text style={styles.meta}>{Math.max(0, freeUnlocksRemaining)} remaining</Text>
        {status?.plan !== "pro" ? <Text style={styles.helper}>Missing Pro after sign-in? Use Restore Purchases to recheck your App Store entitlements for this account.</Text> : null}
        {status?.plan !== "pro" ? <PaywallCard status={status} unlocksRemaining={freeUnlocksRemaining} unlocksLimit={freeUnlocksLimit} /> : null}
        <View style={styles.actionGroup}>
          <PrimaryButton label={status?.plan === "pro" ? "View Pro Status" : "Upgrade to Pro"} secondary={!user} onPress={() => router.push("/paywall")} />
          <PrimaryButton
            label={isRestoring ? "Checking App Store..." : "Restore Purchases"}
            secondary
            onPress={() => {
              console.log("[tap] profile-restore-purchases");
              restorePurchases().catch(() => undefined);
            }}
            disabled={isRestoring}
          />
        </View>
        {status?.plan === "pro" ? (
          <TouchableOpacity
            activeOpacity={0.86}
            accessibilityRole="button"
            disabled={isCancelling}
            onPress={() => {
              if (isCancelling) return;
              console.log("[tap] profile-cancel-pro");
              Alert.alert("Cancel Pro", "Move this account back to the free plan?", [
                { text: "Keep Pro", style: "cancel" },
                {
                  text: "Cancel Pro",
                  style: "destructive",
                  onPress: () => {
                    cancelPro().catch(() => undefined);
                  },
                },
              ]);
            }}
          >
            <Text style={[styles.linkText, isCancelling && styles.linkTextDisabled]}>
              {isCancelling ? "Cancelling Pro..." : "Cancel Pro"}
            </Text>
          </TouchableOpacity>
        ) : null}
        {feedbackMessage ? <Text style={styles.helper}>{feedbackMessage}</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Garage & sync</Text>
        <Text style={styles.meta}>
          {user
            ? "Your signed-in account can keep vehicle history, unlocks, and future sync data tied to one profile."
            : "Sign in anytime to connect this device to a single Garage and purchase history."}
        </Text>
        <Text style={styles.helper}>
          Session {sessionDetected ? "detected" : "not detected"} • API auth header {tokenPresent ? "ready" : "missing"}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Support & feedback</Text>
        <Text style={styles.meta}>Reach the team quickly when something breaks, when Pro needs to be restored, or when you have an idea worth building.</Text>
        <View style={styles.actionGroup}>
          <PrimaryButton
            label="Request a Feature"
            secondary
            onPress={() => {
              void Linking.openURL("mailto:support@carscanr.app?subject=CarScanr%20Feature%20Request");
            }}
          />
          <PrimaryButton
            label="Report an Issue"
            secondary
            onPress={() => {
              void Linking.openURL("mailto:support@carscanr.app?subject=CarScanr%20Bug%20Report");
            }}
          />
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>App & account</Text>
        <Text style={styles.meta}>Manage account access and keep the current app experience organized on this device.</Text>
        {user ? (
          <PrimaryButton
            label="Sign Out"
            secondary
            onPress={() => {
              console.log("[tap] profile-sign-out");
              authService
                .signOut()
                .then(() => {
                  router.replace("/(tabs)/scan" as never);
                })
                .catch(() => undefined);
            }}
          />
        ) : (
          <PrimaryButton label="Sign In" secondary onPress={() => { console.log("[tap] profile-sign-in"); router.replace("/auth" as never); }} />
        )}
      </View>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...Typography.largeTitle, color: Colors.textStrong, marginTop: 4 },
  heroCard: {
    borderRadius: Radius.xl,
    padding: 22,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroBody: { ...Typography.body, color: Colors.textSoft },
  card: { backgroundColor: Colors.cardSoft, borderRadius: Radius.xl, padding: 20, gap: 10, borderWidth: 1, borderColor: Colors.border },
  accountCard: { gap: 8 },
  actionGroup: { gap: 10 },
  name: { ...Typography.heading, color: Colors.textStrong },
  meta: { ...Typography.body, color: Colors.textSoft },
  sectionTitle: { ...Typography.heading, color: Colors.textStrong },
  helper: { ...Typography.caption, color: Colors.textMuted },
  error: { ...Typography.caption, color: Colors.danger },
  linkText: { ...Typography.caption, color: Colors.accent, textAlign: "center" },
  linkTextDisabled: { opacity: 0.6 },
  debugBlock: { marginTop: 8, gap: 4 },
  debugLine: { ...Typography.caption, color: Colors.textMuted },
});
