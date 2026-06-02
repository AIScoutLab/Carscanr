import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CANONICAL_BRAND_MARK_SOURCE } from "@/constants/branding";
import { Typography } from "@/constants/theme";
import { useSubscription } from "@/hooks/useSubscription";
import { mobileBuildInfo, mobileEnv } from "@/lib/env";
import { resolveProfileAccessState } from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { authService } from "@/services/authService";
import { AuthUser } from "@/types";

type IconName = keyof typeof Ionicons.glyphMap;

const premiumFeatures: Array<{ icon: IconName; label: string }> = [
  { icon: "trending-up-outline", label: "Market Value Intelligence" },
  { icon: "location-outline", label: "Live Listings" },
  { icon: "sparkles-outline", label: "Pricing Insights" },
  { icon: "albums-outline", label: "Garage Sync" },
];

function sanitizeProfileMessage(message: string | null) {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (
    normalized.includes("revenuecat") ||
    normalized.includes("configured") ||
    normalized.includes("entitlement") ||
    normalized.includes("sdk") ||
    normalized.includes("expo go") ||
    normalized.includes("development or production build")
  ) {
    return "Purchases could not be restored right now. Please try again later or contact support.";
  }
  return message;
}

function openSupportEmail(subject?: string) {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  void Linking.openURL(`mailto:support@carscanr.com${query}`);
}

function formatDiagnosticValue(value: unknown) {
  if (value === null || typeof value === "undefined" || value === "") {
    return "Unavailable";
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Unavailable" : value.toISOString();
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function formatLaunchDuration(value: number | null) {
  return typeof value === "number" ? `${value} ms` : "Unavailable";
}

function getUpdateManifestSummary(manifest: unknown) {
  const candidate = manifest as
    | {
        id?: string;
        createdAt?: string;
        runtimeVersion?: string;
        extra?: {
          buildInfo?: { gitCommit?: string };
          expoClient?: { extra?: { buildInfo?: { gitCommit?: string } } };
        };
      }
    | undefined;

  return {
    id: candidate?.id ?? null,
    createdAt: candidate?.createdAt ?? null,
    runtimeVersion: candidate?.runtimeVersion ?? null,
    gitCommit:
      candidate?.extra?.buildInfo?.gitCommit ??
      candidate?.extra?.expoClient?.extra?.buildInfo?.gitCommit ??
      null,
  };
}

function getCurrentUpdateDiagnostics() {
  return {
    isEnabled: Updates.isEnabled,
    channel: mobileBuildInfo.channel || null,
    runtimeVersion: mobileBuildInfo.runtimeVersion || null,
    rawUpdateId: mobileBuildInfo.updateId || null,
    activeOtaUpdateId: mobileBuildInfo.activeOtaUpdateId || null,
    activeOtaGitCommit: mobileBuildInfo.activeOtaGitCommit || null,
    activeOtaCreatedAt: mobileBuildInfo.activeOtaCreatedAt || null,
    embeddedGitCommit: mobileBuildInfo.embeddedGitCommit || null,
    isEmbeddedLaunch: mobileBuildInfo.isEmbeddedLaunch,
    isEmergencyLaunch: mobileBuildInfo.isEmergencyLaunch,
    emergencyLaunchReason: mobileBuildInfo.emergencyLaunchReason || null,
    launchDuration: Updates.launchDuration ?? null,
    checkAutomatically: Updates.checkAutomatically ?? null,
  };
}

function getUpdateCheckSummary(result: Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>) {
  return {
    isAvailable: result.isAvailable,
    isRollBackToEmbedded: result.isRollBackToEmbedded,
    reason: "reason" in result ? result.reason ?? null : null,
    manifest: getUpdateManifestSummary("manifest" in result ? result.manifest : undefined),
  };
}

function getUpdateFetchSummary(result: Awaited<ReturnType<typeof Updates.fetchUpdateAsync>>) {
  return {
    isNew: result.isNew,
    isRollBackToEmbedded: result.isRollBackToEmbedded,
    manifest: getUpdateManifestSummary("manifest" in result ? result.manifest : undefined),
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function logRecentUpdateEntries(context: string) {
  try {
    const entries = await Updates.readLogEntriesAsync(60 * 60 * 1000);
    console.log("OTA_DIAGNOSTICS_RECENT_LOGS", {
      context,
      entries: entries.slice(-8).map((entry) => ({
        timestamp: entry.timestamp,
        code: entry.code,
        level: entry.level,
        message: entry.message,
        updateId: entry.updateId ?? null,
        assetId: entry.assetId ?? null,
      })),
    });
  } catch (error) {
    console.log("OTA_DIAGNOSTICS_RECENT_LOGS_ERROR", {
      context,
      message: getErrorMessage(error),
    });
  }
}

export default function ProfileScreen() {
  const {
    status,
    isLoading,
    isRestoring,
    isCancelling,
    freeUnlocksRemaining,
    feedbackMessage,
    errorMessage,
    restorePurchases,
    cancelPro,
  } = useSubscription();
  const [user, setUser] = useState<AuthUser | null>(authService.getCurrentUserSync());
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const [updateDiagnosticMessage, setUpdateDiagnosticMessage] = useState<string | null>(null);
  const accessState = resolveProfileAccessState(status, isLoading);

  const refreshAuthSnapshot = async () => {
    const [, nextUser] = await Promise.all([supabase.auth.getSession(), authService.getCurrentUser(), authService.getAccessToken()]);
    setUser(nextUser);
  };

  useEffect(() => {
    refreshAuthSnapshot().catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAuthSnapshot().catch(() => undefined);
    }, []),
  );

  useEffect(() => {
    console.log("SUBSCRIPTION_STATE_RESOLVED", {
      plan: status?.plan ?? null,
      provider: status?.provider ?? null,
      isActive: status?.isActive ?? null,
      purchaseAvailabilityState: accessState.purchaseAvailabilityState,
      hasProEntitlement: accessState.hasProEntitlement,
      planLabel: accessState.planLabel,
      showUpgradeOptions: accessState.showUpgradeOptions,
      showPrimaryUpgradeCta: accessState.showPrimaryUpgradeCta,
      showPaywallCard: accessState.showPaywallCard,
    });
    console.log("PROFILE_ACCESS_STATE_RENDERED", {
      plan: status?.plan ?? null,
      provider: status?.provider ?? null,
      isActive: status?.isActive ?? null,
      planLabel: accessState.planLabel,
      renewalLabel: accessState.renewalLabel,
      hasProEntitlement: accessState.hasProEntitlement,
    });
    console.log("PAYWALL_VISIBILITY_DECISION", {
      surface: "profile",
      showUpgradeOptions: accessState.showUpgradeOptions,
      showFreeUnlockUsage: accessState.showFreeUnlockUsage,
      purchaseAvailabilityState: accessState.purchaseAvailabilityState,
      showPrimaryUpgradeCta: accessState.showPrimaryUpgradeCta,
      showPaywallCard: accessState.showPaywallCard,
    });
  }, [
    accessState.hasProEntitlement,
    accessState.planLabel,
    accessState.purchaseAvailabilityState,
    accessState.renewalLabel,
    accessState.showFreeUnlockUsage,
    accessState.showUpgradeOptions,
    accessState.showPaywallCard,
    accessState.showPrimaryUpgradeCta,
    status?.isActive,
    status?.plan,
    status?.provider,
  ]);

  const scansUsed = status?.scansUsed ?? status?.scansUsedToday ?? 0;
  const displayName = user?.fullName?.trim() || "Guest";
  const memberSubtitle = user ? user.email : accessState.hasProEntitlement ? "Pro member" : "Free member";
  const sinceLabel = new Date().toLocaleString("en-US", { month: "short", year: "numeric" });
  const garageValue = user ? "Sync" : "0";
  const remainingUnlocks = Math.max(0, freeUnlocksRemaining);
  const unlockUsageLabel = accessState.hasProEntitlement ? "Pro Access active" : `${remainingUnlocks} free unlocks remaining`;
  const displayFeedbackMessage = sanitizeProfileMessage(feedbackMessage);
  const displayErrorMessage = sanitizeProfileMessage(errorMessage);
  const nativeAppVersion = mobileBuildInfo.nativeAppVersion || mobileBuildInfo.version || "Unavailable";
  const nativeBuildNumber = mobileBuildInfo.nativeBuildNumber || mobileBuildInfo.iosBuildNumber || "Unavailable";
  const embeddedCommit = mobileBuildInfo.embeddedGitCommit || "Unavailable";
  const activeOtaUpdateId = mobileBuildInfo.activeOtaUpdateId || (mobileBuildInfo.isEmbeddedLaunch ? "Embedded launch" : "Unavailable");
  const activeOtaCommit = mobileBuildInfo.activeOtaGitCommit || (mobileBuildInfo.isEmbeddedLaunch ? "Embedded launch" : "Unavailable");
  const runtimeVersion = mobileBuildInfo.runtimeVersion || "Unavailable";
  const channel = mobileBuildInfo.channel || "Unavailable";
  const isEmbeddedLaunch = formatDiagnosticValue(mobileBuildInfo.isEmbeddedLaunch);
  const isEmergencyLaunch = formatDiagnosticValue(mobileBuildInfo.isEmergencyLaunch);
  const showOtaDiagnostics = __DEV__ || mobileEnv.showQaDebug === "1" || mobileEnv.showQaDebug.toLowerCase() === "true";
  const otaDiagnosticsRows: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: "power-outline", label: "Updates Enabled", value: formatDiagnosticValue(Updates.isEnabled) },
    { icon: "cloud-outline", label: "Raw Current Update ID", value: formatDiagnosticValue(mobileBuildInfo.updateId) },
    { icon: "calendar-outline", label: "Active OTA Created At", value: formatDiagnosticValue(mobileBuildInfo.activeOtaCreatedAt) },
    { icon: "timer-outline", label: "Launch Duration", value: formatLaunchDuration(Updates.launchDuration) },
    { icon: "refresh-outline", label: "Check Automatically", value: formatDiagnosticValue(Updates.checkAutomatically) },
    { icon: "calendar-number-outline", label: "Embedded Timestamp", value: formatDiagnosticValue(mobileBuildInfo.embeddedBuildInfo.buildTimestamp) },
    { icon: "phone-portrait-outline", label: "Embedded Version", value: formatDiagnosticValue(mobileBuildInfo.embeddedBuildInfo.version) },
    { icon: "construct-outline", label: "Embedded iOS Build", value: formatDiagnosticValue(mobileBuildInfo.embeddedBuildInfo.iosBuildNumber) },
    ...(mobileBuildInfo.emergencyLaunchReason
      ? [{ icon: "alert-circle-outline" as IconName, label: "Emergency Reason", value: mobileBuildInfo.emergencyLaunchReason }]
      : []),
  ];

  const handleRestorePurchases = useCallback(() => {
    if (isRestoring) return;
    console.log("[tap] profile-restore-purchases");
    restorePurchases().catch(() => undefined);
  }, [isRestoring, restorePurchases]);

  const handleCancelPro = useCallback(() => {
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
  }, [cancelPro, isCancelling]);

  const handleSignOut = useCallback(() => {
    console.log("[tap] profile-sign-out");
    authService
      .signOut()
      .then(() => {
        router.replace("/(tabs)/scan" as never);
      })
      .catch(() => undefined);
  }, []);

  const handleManualUpdateCheck = useCallback(async () => {
    if (isCheckingForUpdate) return;
    setIsCheckingForUpdate(true);
    setUpdateDiagnosticMessage("Checking for an OTA update...");
    console.log("OTA_DIAGNOSTICS_MANUAL_CHECK_STARTED", getCurrentUpdateDiagnostics());

    try {
      if (!Updates.isEnabled) {
        console.log("OTA_DIAGNOSTICS_MANUAL_CHECK_SKIPPED", {
          reason: "updates_disabled",
          diagnostics: getCurrentUpdateDiagnostics(),
        });
        setUpdateDiagnosticMessage("Expo Updates is disabled for this launch.");
        await logRecentUpdateEntries("updates-disabled");
        return;
      }

      console.log("OTA_DIAGNOSTICS_CHECK_FOR_UPDATE_STARTED", getCurrentUpdateDiagnostics());
      const checkResult = await Updates.checkForUpdateAsync();
      const checkSummary = getUpdateCheckSummary(checkResult);
      console.log("OTA_DIAGNOSTICS_CHECK_FOR_UPDATE_RESULT", checkSummary);

      if (!checkResult.isAvailable && !checkResult.isRollBackToEmbedded) {
        setUpdateDiagnosticMessage(`No OTA update available (${checkSummary.reason ?? "no reason returned"}).`);
        await logRecentUpdateEntries("no-update-available");
        return;
      }

      setUpdateDiagnosticMessage("Update available. Downloading...");
      console.log("OTA_DIAGNOSTICS_FETCH_UPDATE_STARTED", checkSummary);
      const fetchResult = await Updates.fetchUpdateAsync();
      const fetchSummary = getUpdateFetchSummary(fetchResult);
      console.log("OTA_DIAGNOSTICS_FETCH_UPDATE_RESULT", fetchSummary);

      if (fetchResult.isNew || fetchResult.isRollBackToEmbedded) {
        setUpdateDiagnosticMessage("Update downloaded. Reload to apply it.");
        await logRecentUpdateEntries("update-downloaded");
        Alert.alert("Update Downloaded", "Reload CarScanr now to apply the downloaded update?", [
          { text: "Later", style: "cancel" },
          {
            text: "Reload",
            onPress: () => {
              console.log("OTA_DIAGNOSTICS_RELOAD_REQUESTED", getCurrentUpdateDiagnostics());
              Updates.reloadAsync().catch((error) => {
                console.log("OTA_DIAGNOSTICS_RELOAD_ERROR", {
                  message: getErrorMessage(error),
                  diagnostics: getCurrentUpdateDiagnostics(),
                });
                setUpdateDiagnosticMessage(`Reload failed: ${getErrorMessage(error)}`);
              });
            },
          },
        ]);
        return;
      }

      setUpdateDiagnosticMessage("Update check completed, but no new update was fetched.");
      await logRecentUpdateEntries("fetch-completed-no-new-update");
    } catch (error) {
      console.log("OTA_DIAGNOSTICS_MANUAL_CHECK_ERROR", {
        message: getErrorMessage(error),
        diagnostics: getCurrentUpdateDiagnostics(),
      });
      setUpdateDiagnosticMessage(`Update check failed: ${getErrorMessage(error)}`);
      await logRecentUpdateEntries("manual-check-error");
    } finally {
      setIsCheckingForUpdate(false);
    }
  }, [isCheckingForUpdate]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <LinearGradient colors={["#040506", "#080709", "#030405"]} style={styles.screen}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.profileHeader}>
            <View style={styles.identityRow}>
              <View style={styles.logoShell}>
                <Image source={CANONICAL_BRAND_MARK_SOURCE} style={styles.logoImage} resizeMode="contain" />
              </View>
              <View style={styles.identityText}>
                <Text style={styles.profileName}>{displayName}</Text>
                <Text style={styles.memberSubtitle}>{memberSubtitle}</Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <ProfileStat label="SCANS" value={isLoading ? "..." : scansUsed} />
              <ProfileStat label="GARAGE" value={garageValue} />
              <ProfileStat label="SINCE" value={sinceLabel} wide />
            </View>
          </View>

          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Your automotive intelligence companion</Text>
            <Text style={styles.heroBody}>
              {user
                ? "Your account keeps Garage sync, purchase restore, and collection history ready across devices."
                : "Scans stay free. Create an account to unlock advanced features and sync your collection."}
            </Text>
          </View>

          {!user ? (
            <View style={styles.accountCard}>
              <Text style={styles.accountEyebrow}>ACCOUNT</Text>
              <Text style={styles.accountTitle}>Set up your Garage</Text>
              <Text style={styles.accountBody}>Create a free account or sign in to sync your Garage, history, and unlocks across devices.</Text>
              <View style={styles.authActions}>
                <GoldButton label="Create Account" onPress={() => router.push("/auth?mode=sign-up")} />
                <DarkButton label="Sign In" onPress={() => router.push("/auth?mode=sign-in")} />
              </View>
            </View>
          ) : null}

          <LinearGradient colors={["#221A15", "#171311", "#0A0908"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.proCard}>
            <View style={styles.premiumEyebrowRow}>
              <Ionicons name="trophy-outline" size={15} color={profileColors.goldLight} />
              <Text style={styles.premiumEyebrow}>PRO ACCESS</Text>
            </View>
            <Text style={styles.proTitle}>Pro Access</Text>
            <Text style={styles.proBody}>Unlock market values, live listings, pricing insights, and garage tools for every vehicle you scan.</Text>
            <View style={styles.featureList}>
              {premiumFeatures.map((feature) => (
                <PremiumFeature key={feature.label} icon={feature.icon} label={feature.label} />
              ))}
            </View>
            {accessState.showFreeUnlockUsage ? (
              <View style={styles.unlockPill}>
                <Ionicons name="flash-outline" size={16} color={profileColors.goldLight} />
                <Text style={styles.unlockText}>{unlockUsageLabel}</Text>
              </View>
            ) : accessState.hasProEntitlement ? (
              <View style={styles.unlockPill}>
                <Ionicons name="checkmark-circle-outline" size={16} color={profileColors.goldLight} />
                <Text style={styles.unlockText}>{unlockUsageLabel}</Text>
              </View>
            ) : null}
            {accessState.showPrimaryUpgradeCta ? (
              <TouchableOpacity activeOpacity={0.88} accessibilityRole="button" onPress={() => router.push("/paywall")}>
                <LinearGradient colors={["rgba(214,158,93,0.28)", "rgba(214,158,93,0.16)"]} style={styles.upgradeButton}>
                  <Ionicons name="flash-outline" size={18} color={profileColors.goldLight} />
                  <Text style={styles.upgradeButtonText}>Upgrade to Pro</Text>
                  <Ionicons name="chevron-forward" size={17} color={profileColors.goldLight} />
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <View style={styles.activeAccessPill}>
                <Ionicons name="checkmark-circle-outline" size={18} color={profileColors.goldLight} />
                <Text style={styles.activeAccessText}>{accessState.planLabel}</Text>
              </View>
            )}
          </LinearGradient>

          {displayFeedbackMessage || displayErrorMessage ? (
            <View style={[styles.messageCard, displayErrorMessage && styles.errorMessageCard]}>
              <Text style={[styles.messageText, displayErrorMessage && styles.errorMessageText]}>{displayErrorMessage ?? displayFeedbackMessage}</Text>
            </View>
          ) : null}

          <SectionLabel label="Account" />
          <View style={styles.settingsCard}>
            <SettingsRow icon="refresh-outline" label={isRestoring ? "Restoring Purchases..." : "Restore Purchases"} onPress={handleRestorePurchases} disabled={isRestoring} />
            {accessState.hasProEntitlement ? (
              <>
                <View style={styles.separator} />
                <SettingsRow icon="close-circle-outline" label={isCancelling ? "Cancelling Pro..." : "Cancel Pro"} onPress={handleCancelPro} disabled={isCancelling} />
              </>
            ) : null}
            {user ? (
              <>
                <View style={styles.separator} />
                <SettingsRow icon="log-out-outline" label="Sign Out" onPress={handleSignOut} />
              </>
            ) : null}
          </View>

          <SectionLabel label="Support" />
          <View style={styles.settingsCard}>
            <SettingsRow icon="mail-outline" label="Contact Support" onPress={() => openSupportEmail()} />
            <View style={styles.separator} />
            <SettingsRow icon="alert-circle-outline" label="Report an Issue" onPress={() => openSupportEmail("CarScanr Issue Report")} />
            <View style={styles.separator} />
            <SettingsRow icon="sparkles-outline" label="Request a Feature" onPress={() => openSupportEmail("CarScanr Feature Request")} />
          </View>

          <SectionLabel label="Legal" />
          <View style={styles.settingsCard}>
            <SettingsRow icon="shield-outline" label="Privacy Policy" onPress={() => router.push("/legal/privacy-policy" as never)} />
            <View style={styles.separator} />
            <SettingsRow icon="document-text-outline" label="Terms of Service" onPress={() => router.push("/legal/terms-of-service" as never)} />
          </View>

          <SectionLabel label="About" />
          <View style={styles.settingsCard}>
            <InfoRow icon="phone-portrait-outline" label="Native App Version" value={nativeAppVersion} />
            <View style={styles.separator} />
            <InfoRow icon="construct-outline" label="Native Build" value={nativeBuildNumber} />
            <View style={styles.separator} />
            <InfoRow icon="code-slash-outline" label="Embedded Commit" value={embeddedCommit} />
            <View style={styles.separator} />
            <InfoRow icon="cloud-download-outline" label="Active OTA Update ID" value={activeOtaUpdateId} />
            <View style={styles.separator} />
            <InfoRow icon="git-commit-outline" label="Active OTA Commit" value={activeOtaCommit} />
            <View style={styles.separator} />
            <InfoRow icon="cube-outline" label="Runtime" value={runtimeVersion} />
            <View style={styles.separator} />
            <InfoRow icon="git-branch-outline" label="Channel" value={channel} />
            <View style={styles.separator} />
            <InfoRow icon="archive-outline" label="Is Embedded Launch" value={isEmbeddedLaunch} />
            <View style={styles.separator} />
            <InfoRow icon="warning-outline" label="Is Emergency Launch" value={isEmergencyLaunch} />
          </View>

          {showOtaDiagnostics ? (
            <>
              <SectionLabel label="OTA Diagnostics" />
              <View style={styles.settingsCard}>
                {otaDiagnosticsRows.map((row, index) => (
                  <View key={row.label}>
                    {index > 0 ? <View style={styles.separator} /> : null}
                    <InfoRow icon={row.icon} label={row.label} value={row.value} />
                  </View>
                ))}
                <View style={styles.separator} />
                <SettingsRow
                  icon="cloud-download-outline"
                  label={isCheckingForUpdate ? "Checking for Update..." : "Check for Update"}
                  onPress={handleManualUpdateCheck}
                  disabled={isCheckingForUpdate}
                />
              </View>
              {updateDiagnosticMessage ? (
                <View style={styles.messageCard}>
                  <Text style={styles.messageText}>{updateDiagnosticMessage}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

function ProfileStat({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) {
  return (
    <View style={[styles.statItem, wide && styles.statItemWide]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function PremiumFeature({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>
        <Ionicons name={icon} size={17} color={profileColors.goldLight} />
      </View>
      <Text style={styles.featureLabel}>{label}</Text>
    </View>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

function SettingsRow({ icon, label, onPress, disabled = false }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity activeOpacity={0.78} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.settingsRow, disabled && styles.disabledRow]}>
      <View style={styles.settingsRowLeft}>
        <Ionicons name={icon} size={18} color={profileColors.goldLight} />
        <Text style={styles.settingsRowText}>{label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={profileColors.textMuted} />
    </TouchableOpacity>
  );
}

function InfoRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.settingsRowLeft}>
        <Ionicons name={icon} size={18} color={profileColors.goldLight} />
        <Text style={styles.settingsRowText}>{label}</Text>
      </View>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function GoldButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.88} accessibilityRole="button" onPress={onPress} style={styles.ctaShell}>
      <LinearGradient colors={["#E2B071", "#CC965C"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryCta}>
        <Text style={styles.primaryCtaText}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function DarkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.82} accessibilityRole="button" onPress={onPress} style={styles.secondaryCta}>
      <Text style={styles.secondaryCtaText}>{label}</Text>
    </TouchableOpacity>
  );
}

const profileColors = {
  background: "#030405",
  text: "#F8F6F2",
  textSoft: "#B9BDC9",
  textMuted: "#727784",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.13)",
  goldLight: "#E9BC7C",
  danger: "#FF7A7A",
};

const fontFamily = Typography.body.fontFamily;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: profileColors.background,
  },
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 44,
    gap: 12,
  },
  profileHeader: {
    gap: 13,
    marginBottom: 6,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  logoShell: {
    width: 58,
    height: 58,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050505",
    shadowColor: "#000000",
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  logoImage: {
    width: 58,
    height: 58,
    borderRadius: 20,
  },
  identityText: {
    flex: 1,
    gap: 3,
  },
  profileName: {
    fontFamily,
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: 0,
    color: profileColors.text,
  },
  memberSubtitle: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    letterSpacing: 0,
    color: profileColors.textMuted,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 71,
  },
  statItem: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
    marginRight: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: profileColors.lineStrong,
    gap: 4,
  },
  statItemWide: {
    flex: 1.3,
    minWidth: 0,
    marginRight: 0,
    borderRightWidth: 0,
  },
  statLabel: {
    fontFamily,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0,
    color: profileColors.textMuted,
  },
  statValue: {
    fontFamily,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    letterSpacing: 0,
    color: profileColors.text,
  },
  heroCopy: {
    gap: 12,
    marginTop: 3,
  },
  heroTitle: {
    maxWidth: 300,
    fontFamily,
    fontSize: 23,
    lineHeight: 27,
    fontWeight: "900",
    letterSpacing: 0,
    color: profileColors.text,
  },
  heroBody: {
    maxWidth: 340,
    fontFamily,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "500",
    letterSpacing: 0,
    color: profileColors.textSoft,
  },
  authActions: {
    gap: 11,
    marginTop: 13,
  },
  accountCard: {
    borderRadius: 20,
    padding: 18,
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3,
  },
  accountEyebrow: {
    fontFamily,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 0,
    color: profileColors.goldLight,
  },
  accountTitle: {
    fontFamily,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
    letterSpacing: 0,
    color: profileColors.text,
  },
  accountBody: {
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 0,
    color: profileColors.textSoft,
  },
  ctaShell: {
    borderRadius: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  primaryCta: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryCtaText: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    letterSpacing: 0,
    color: "#050404",
  },
  secondaryCta: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: profileColors.lineStrong,
  },
  secondaryCtaText: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    letterSpacing: 0,
    color: profileColors.text,
  },
  proCard: {
    borderRadius: 21,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    gap: 11,
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.2)",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
    elevation: 4,
    overflow: "hidden",
  },
  premiumEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  premiumEyebrow: {
    fontFamily,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0,
    color: profileColors.goldLight,
  },
  proTitle: {
    marginTop: 5,
    fontFamily,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "900",
    letterSpacing: 0,
    color: profileColors.text,
  },
  proBody: {
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
    letterSpacing: 0,
    color: profileColors.textSoft,
  },
  featureList: {
    gap: 10,
    marginTop: 5,
  },
  featureRow: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  featureIcon: {
    width: 30,
    height: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(209,154,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(209,154,93,0.28)",
  },
  featureLabel: {
    flex: 1,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: 0,
    color: profileColors.text,
  },
  unlockPill: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 13,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  unlockText: {
    flex: 1,
    fontFamily,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    letterSpacing: 0,
    color: profileColors.textSoft,
  },
  upgradeButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 4,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(233,188,124,0.38)",
  },
  upgradeButtonText: {
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
    letterSpacing: 0,
    color: profileColors.goldLight,
  },
  activeAccessPill: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 4,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(233,188,124,0.12)",
    borderWidth: 1,
    borderColor: "rgba(233,188,124,0.24)",
  },
  activeAccessText: {
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 0,
    color: profileColors.goldLight,
  },
  messageCard: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: "rgba(233,188,124,0.1)",
    borderWidth: 1,
    borderColor: "rgba(233,188,124,0.18)",
  },
  errorMessageCard: {
    backgroundColor: "rgba(255,122,122,0.1)",
    borderColor: "rgba(255,122,122,0.22)",
  },
  messageText: {
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    letterSpacing: 0,
    color: profileColors.goldLight,
  },
  errorMessageText: {
    color: profileColors.danger,
  },
  sectionLabel: {
    marginTop: 22,
    marginLeft: 3,
    marginBottom: 4,
    fontFamily,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
    color: profileColors.textMuted,
  },
  settingsCard: {
    borderRadius: 20,
    backgroundColor: "rgba(14,15,19,0.86)",
    borderWidth: 1,
    borderColor: profileColors.line,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  settingsRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingHorizontal: 19,
  },
  disabledRow: {
    opacity: 0.62,
  },
  settingsRowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  settingsRowText: {
    flex: 1,
    fontFamily,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    letterSpacing: 0,
    color: profileColors.text,
  },
  infoRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingHorizontal: 19,
  },
  infoValue: {
    maxWidth: 190,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
    letterSpacing: 0,
    color: profileColors.textMuted,
    textAlign: "right",
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: profileColors.line,
  },
});
