import { router } from "expo-router";
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
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
        <View style={styles.heroBadge}>
          <Ionicons name="person-circle-outline" size={18} color={Colors.premium} />
          <Text style={styles.heroBadgeLabel}>Driver profile</Text>
        </View>
        <Text style={styles.title}>Account and access</Text>
        <Text style={styles.heroBody}>Unlimited free scans stay front and center. Your account adds sync, history, and recovery across devices.</Text>
      </LinearGradient>
      {!user ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Create your free account</Text>
          <Text style={styles.meta}>Unlimited basic scans stay free forever. Create an account to save your Garage, keep unlock history, and restore across devices.</Text>
          <PrimaryButton label="Create Free Account" onPress={() => router.push("/auth?mode=sign-up")} />
          <PrimaryButton label="Sign In" secondary onPress={() => router.push("/auth?mode=sign-in")} />
          <PrimaryButton label="See Pro Extras" secondary onPress={() => router.push("/paywall")} />
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>What stays free</Text>
        <Text style={styles.meta}>Unlimited scans, basic identification, and your included free Pro unlocks stay available without upgrading.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.name}>{user ? user.fullName : "Guest"}</Text>
        <Text style={styles.meta}>{user ? user.email : "Sign in to sync your account"}</Text>
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
      {status?.plan !== "pro" ? <PaywallCard status={status} unlocksRemaining={freeUnlocksRemaining} unlocksLimit={freeUnlocksLimit} /> : null}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Plan</Text>
        <Text style={styles.meta}>{isLoading ? "Checking plan..." : status?.plan === "pro" ? "Pro active" : "Free plan"}</Text>
        <Text style={styles.meta}>{status?.renewalLabel ?? "Sign in to sync your subscription status."}</Text>
        <Text style={styles.meta}>
          {freeUnlocksUsed} of {freeUnlocksLimit} free Pro unlocks used
        </Text>
        <Text style={styles.meta}>{Math.max(0, freeUnlocksRemaining)} remaining</Text>
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
        <Text style={styles.sectionTitle}>Privacy & Settings</Text>
        <Text style={styles.meta}>Manage account, app permissions, analytics preferences, and future sync settings here.</Text>
        <PrimaryButton
          label="Request a Feature"
          secondary
          onPress={() => {
            void Linking.openURL("mailto:support@carscanr.app?subject=CarScanr%20Feature%20Request");
          }}
        />
        {user ? (
          <PrimaryButton
            label="Sign Out"
            secondary
            onPress={() => {
              console.log("[tap] profile-sign-out");
              authService
                .signOut()
                .then(() => {
                  router.replace("/auth" as never);
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
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(12, 21, 36, 0.82)",
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  heroBadgeLabel: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 0.8 },
  heroBody: { ...Typography.body, color: Colors.textSoft },
  card: { backgroundColor: Colors.cardSoft, borderRadius: Radius.xl, padding: 20, gap: 10, borderWidth: 1, borderColor: Colors.border },
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
