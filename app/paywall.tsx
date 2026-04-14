import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
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
  const { status, isLoading, isPurchasing, freeUnlocksRemaining, freeUnlocksLimit, feedbackMessage, errorMessage, purchasePro } = useSubscription();
  const hasPro = status?.plan === "pro";
  const backendProActive = status?.plan === "pro" && status?.provider === "backend";
  const purchaseAvailable = Boolean(status?.purchaseAvailable);
  const primaryLabel = hasPro
    ? backendProActive
      ? "Continue With Pro"
      : isPurchasing
        ? "Activating Pro..."
        : "Activate Pro Access"
    : purchaseAvailable
      ? isPurchasing
        ? "Preparing purchase flow..."
        : "Start Free Trial"
      : "Purchases Coming Soon";

  return (
    <AppContainer>
      <BackButton fallbackHref="/(tabs)/scan" label="Back" />
      <View style={styles.heroSection}>
        {!backendProActive ? <PaywallCard status={status} unlocksRemaining={freeUnlocksRemaining} unlocksLimit={freeUnlocksLimit} /> : null}
        {status ? (
          <ScanUsageMeter
            status={status}
            mode="unlocks"
            unlocksUsed={freeUnlocksLimit - freeUnlocksRemaining}
            unlocksRemaining={freeUnlocksRemaining}
            unlocksLimit={freeUnlocksLimit}
            supportingText="Basic scan results stay available even after your free Pro unlocks run out."
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
          <Text style={styles.subtitle}>Use your 5 free Pro unlocks first, then upgrade later for unlimited premium details.</Text>
          <PlanColumn title="Included" items={planBenefits.pro} highlight />
          {!purchaseAvailable ? <Text style={styles.notice}>In-app purchase is not live in this build yet. This screen is informational for the current debug cycle.</Text> : null}
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
  heroSection: { gap: 14 },
  detailCard: { ...cardStyles.standard, padding: 20, gap: 14 },
  title: { ...Typography.title, color: Colors.textStrong },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  plan: { backgroundColor: Colors.cardAlt, borderRadius: Radius.lg, padding: 16, gap: 8 },
  planHighlight: { backgroundColor: Colors.primary },
  planTitle: { ...Typography.heading, color: Colors.textStrong },
  planTitleHighlight: { color: "#FFFFFF" },
  item: { ...Typography.body, color: Colors.textMuted },
  itemHighlight: { color: "rgba(255,255,255,0.86)" },
  notice: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
  feedback: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
  error: { ...Typography.caption, color: "#A14D52", textAlign: "center" },
  footnote: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
});
