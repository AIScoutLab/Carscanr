import { router } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppContainer } from "@/components/AppContainer";
import { PaywallCard } from "@/components/PaywallCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { useSubscription } from "@/hooks/useSubscription";
import { authService } from "@/services/authService";
import { getApiAuthDebug } from "@/services/apiClient";
import { AuthUser } from "@/types";

export default function ProfileScreen() {
  const { status, isLoading, isRestoring, isCancelling, feedbackMessage, errorMessage, restorePurchases, cancelPro } = useSubscription();
  const [user, setUser] = useState<AuthUser | null>(authService.getCurrentUserSync());
  const [tokenPresent, setTokenPresent] = useState(false);
  const [apiDebug, setApiDebug] = useState(getApiAuthDebug());

  const refreshAuthSnapshot = async () => {
    const [nextUser, token] = await Promise.all([authService.getCurrentUser(), authService.getAccessToken()]);
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
      <Text style={styles.title}>Profile</Text>
      <View style={styles.card}>
        <Text style={styles.name}>{user ? user.fullName : "Guest"}</Text>
        <Text style={styles.meta}>{user ? user.email : "Sign in to sync your account"}</Text>
        <View style={styles.debugBlock}>
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
      </View>
      {status?.plan !== "pro" ? <PaywallCard status={status} /> : null}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Plan</Text>
        <Text style={styles.meta}>{isLoading ? "Checking plan..." : status?.plan === "pro" ? "Pro active" : "Free plan"}</Text>
        <Text style={styles.meta}>{status?.renewalLabel ?? "Sign in to sync your subscription status."}</Text>
        <PrimaryButton label={status?.plan === "pro" ? "View Pro Status" : "Upgrade to Pro"} onPress={() => router.push("/paywall")} />
        <PrimaryButton
          label={isRestoring ? "Checking App Store..." : "Restore Purchases"}
          secondary
          onPress={() => {
            restorePurchases().catch(() => undefined);
          }}
          disabled={isRestoring}
        />
        {status?.plan === "pro" ? (
          <Text
            style={[styles.linkText, isCancelling && styles.linkTextDisabled]}
            onPress={() => {
              if (isCancelling) return;
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
            {isCancelling ? "Cancelling Pro..." : "Cancel Pro"}
          </Text>
        ) : null}
        {feedbackMessage ? <Text style={styles.helper}>{feedbackMessage}</Text> : null}
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Privacy & Settings</Text>
        <Text style={styles.meta}>Manage account, app permissions, analytics preferences, and future sync settings here.</Text>
        {user ? (
          <PrimaryButton
            label="Sign Out"
            secondary
            onPress={() => {
              authService
                .signOut()
                .then(() => {
                  router.replace("/(auth)");
                })
                .catch(() => undefined);
            }}
          />
        ) : (
          <PrimaryButton label="Sign In" onPress={() => router.replace("/(auth)")} />
        )}
      </View>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...Typography.largeTitle, color: Colors.text, marginTop: 12 },
  card: { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 20, gap: 10 },
  name: { ...Typography.heading, color: Colors.text },
  meta: { ...Typography.body, color: Colors.textMuted },
  sectionTitle: { ...Typography.heading, color: Colors.text },
  helper: { ...Typography.caption, color: Colors.textMuted },
  error: { ...Typography.caption, color: "#A14D52" },
  linkText: { ...Typography.caption, color: Colors.accent, textAlign: "center" },
  linkTextDisabled: { opacity: 0.6 },
  debugBlock: { marginTop: 8, gap: 4 },
  debugLine: { ...Typography.caption, color: Colors.textMuted },
});
