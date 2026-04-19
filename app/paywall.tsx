import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { PaywallCard } from "@/components/PaywallCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { planBenefits } from "@/features/subscription/planCopy";
import { useSubscription } from "@/hooks/useSubscription";
import { Colors, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";

export default function PaywallScreen() {
  const {
    status,
    isLoading,
    isPurchasing,
    isRestoring,
    freeUnlocksRemaining,
    freeUnlocksLimit,
    feedbackMessage,
    errorMessage,
    purchasePro,
    restorePurchases,
  } = useSubscription();
  const hasPro = status?.plan === "pro";
  const backendProActive = status?.plan === "pro" && status?.provider === "backend";
  const availableProduct = status?.availableProducts?.[0] ?? null;
  const purchaseAvailabilityState = status?.purchaseAvailabilityState ?? "not_configured";
  const purchaseAvailable = status?.purchaseAvailabilityState === "ready" && Boolean(status?.purchaseAvailable && availableProduct);
  const purchaseNotice =
    purchaseAvailabilityState === "preview_only"
      ? "Purchases can be previewed here, but they require a development or production build to complete."
      : purchaseAvailabilityState === "not_configured"
        ? "Purchases are not configured for this build yet. Free unlocks and free scans still work normally."
        : null;
  const primaryLabel = hasPro
    ? backendProActive
      ? "Continue With Pro"
      : isPurchasing
        ? "Activating Pro..."
        : "Activate Pro Access"
    : purchaseAvailable
      ? isPurchasing
        ? "Starting purchase..."
        : availableProduct
          ? `Start Pro • ${availableProduct.priceLabel}/${availableProduct.billingPeriodLabel}`
          : "Start Pro"
      : "Purchases Unavailable In This Build";

  return (
    <AppContainer>
      <BackButton fallbackHref="/(tabs)/scan" label="Back" />
      <LinearGradient colors={["rgba(29,140,255,0.2)", "rgba(94,231,255,0.08)", "rgba(4,8,18,0.18)"]} style={styles.heroBanner}>
        <View style={styles.heroBadge}>
          <Ionicons name="flash-outline" size={18} color={Colors.premium} />
          <Text style={styles.heroBadgeLabel}>Premium depth</Text>
        </View>
        <Text style={styles.heroTitle}>A cleaner performance tier</Text>
        <Text style={styles.heroBody}>Unlimited free scans stay in front. Pro opens deeper specs, richer value context, shopping intelligence, and synced premium access.</Text>
      </LinearGradient>
      <View style={styles.heroSection}>
        {!backendProActive ? <PaywallCard status={status} unlocksRemaining={freeUnlocksRemaining} unlocksLimit={freeUnlocksLimit} /> : null}
        {status ? (
          <ScanUsageMeter
            status={status}
            mode="unlocks"
            unlocksUsed={freeUnlocksLimit - freeUnlocksRemaining}
            unlocksRemaining={freeUnlocksRemaining}
            unlocksLimit={freeUnlocksLimit}
            supportingText="Unlimited basic scans stay free. Unlock full details when you want."
          />
        ) : null}
      </View>
      {backendProActive ? (
        <View style={styles.detailCard}>
          <Text style={styles.title}>Pro is active</Text>
          <Text style={styles.subtitle}>Unlimited scans and full details are unlocked on this device.</Text>
          <PlanColumn title="Included with Pro" items={planBenefits.pro} highlight />
        </View>
      ) : (
        <View style={styles.detailCard}>
          <Text style={styles.title}>Everything behind Pro</Text>
          <Text style={styles.subtitle}>Unlimited scans stay free. Use your 5 free unlocks first, then upgrade only if you want always-on full access.</Text>
          <PlanColumn title="Included" items={planBenefits.pro} highlight />
          {availableProduct ? (
            <View style={styles.productCard}>
              <Text style={styles.productEyebrow}>Current offer</Text>
              <Text style={styles.productTitle}>{availableProduct.priceLabel}/{availableProduct.billingPeriodLabel}</Text>
              <Text style={styles.productBody}>Live App Store purchase via RevenueCat.</Text>
            </View>
          ) : null}
          {purchaseNotice ? <Text style={styles.notice}>{purchaseNotice}</Text> : null}
        </View>
      )}
      <PrimaryButton
        label={primaryLabel}
        onPress={async () => {
          console.log("[paywall] PAYWALL_CTA_TAPPED", {
            cta: "primary",
            backendProActive,
            hasPro,
            isLoading,
            isPurchasing,
            purchaseAvailable,
          });
          if (backendProActive) {
            router.back();
            return;
          }
          if (!purchaseAvailable) {
            return;
          }
          try {
            const result = await purchasePro();
            console.log("[paywall] purchase result", { outcome: result.outcome, provider: result.status.provider, plan: result.status.plan });
            if (result.outcome === "verified" || result.outcome === "restored" || result.status.provider === "backend") {
              router.replace("/pro-activated");
            }
          } catch {
            // The inline error state from the subscription provider handles display.
          }
        }}
        disabled={isLoading || isPurchasing || !purchaseAvailable}
      />
      {!backendProActive ? (
        <PrimaryButton
          label={isRestoring ? "Restoring purchases..." : "Restore Purchases"}
          secondary
          onPress={async () => {
            try {
              const result = await restorePurchases();
              console.log("[paywall] restore result", {
                outcome: result.outcome,
                provider: result.status.provider,
                plan: result.status.plan,
              });
              if (result.outcome === "restored" && result.status.plan === "pro") {
                router.replace("/pro-activated");
              }
            } catch {
              // Provider surfaces the inline error state.
            }
          }}
          disabled={isLoading || isRestoring || purchaseAvailabilityState !== "ready"}
        />
      ) : null}
      <PrimaryButton
        label="Keep Free Access"
        secondary
        onPress={() => {
          console.log("[paywall] PAYWALL_CTA_TAPPED", { cta: "secondary-keep-free" });
          router.back();
        }}
      />
      {feedbackMessage ? <Text style={styles.feedback}>{feedbackMessage}</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {!hasPro && purchaseAvailable ? <Text style={styles.footnote}>Cancel anytime</Text> : null}
    </AppContainer>
  );
}

function PlanColumn({ title, items, highlight = false }: { title: string; items: string[]; highlight?: boolean }) {
  return (
    <View style={[styles.plan, highlight && styles.planHighlight]}>
      <Text style={[styles.planTitle, highlight && styles.planTitleHighlight]}>{title}</Text>
      {items.map((item) => (
        <Text key={item} style={[styles.item, highlight && styles.itemHighlight]}>{`\u2022 ${item}`}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heroBanner: {
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
  heroTitle: { ...Typography.title, color: Colors.textStrong },
  heroBody: { ...Typography.body, color: Colors.textSoft },
  heroSection: { gap: 14 },
  detailCard: { ...cardStyles.standard, padding: 20, gap: 14 },
  title: { ...Typography.title, color: Colors.textStrong },
  subtitle: { ...Typography.body, color: Colors.textSoft },
  plan: { backgroundColor: Colors.cardAlt, borderRadius: Radius.lg, padding: 16, gap: 8 },
  planHighlight: { backgroundColor: Colors.primary },
  planTitle: { ...Typography.heading, color: Colors.textStrong },
  planTitleHighlight: { color: "#FFFFFF" },
  item: { ...Typography.body, color: Colors.textSoft },
  itemHighlight: { color: "rgba(255,255,255,0.86)" },
  productCard: {
    backgroundColor: Colors.cardAlt,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  productEyebrow: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 0.8 },
  productTitle: { ...Typography.heading, color: Colors.textStrong },
  productBody: { ...Typography.body, color: Colors.textSoft },
  notice: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
  feedback: { ...Typography.caption, color: Colors.textSoft, textAlign: "center" },
  error: { ...Typography.caption, color: Colors.danger, textAlign: "center" },
  footnote: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
});
