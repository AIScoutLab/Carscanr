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
  const { status, isLoading, isPurchasing, feedbackMessage, errorMessage, purchasePro } = useSubscription();
  const hasPro = status?.plan === "pro";
  const backendProActive = status?.plan === "pro" && status?.provider === "backend";
  const primaryLabel = hasPro
    ? backendProActive
      ? "Continue With Pro"
      : isPurchasing
        ? "Activating Pro..."
        : "Activate Pro Access"
    : isPurchasing
      ? "Preparing purchase flow..."
      : "Start Free Trial";

  return (
    <AppContainer>
      <BackButton fallbackHref="/(tabs)/scan" label="Back" />
      {!backendProActive ? <PaywallCard status={status} /> : null}
      {status ? <ScanUsageMeter status={status} /> : null}
      {backendProActive ? (
        <View style={styles.compareCard}>
          <Text style={styles.title}>Pro is active</Text>
          <Text style={styles.subtitle}>Unlimited scans and full details are unlocked on this device.</Text>
          <PlanColumn title="Included with Pro" items={planBenefits.pro} highlight />
        </View>
      ) : (
        <View style={styles.compareCard}>
          <Text style={styles.title}>Unlock CarScanr Pro</Text>
          <Text style={styles.subtitle}>Everything you need to make smarter car decisions</Text>
          <PlanColumn title="Included" items={planBenefits.pro} highlight />
          <Text style={styles.footer}>Cancel anytime</Text>
        </View>
      )}
      <PrimaryButton
        label={primaryLabel}
        onPress={async () => {
          console.log("[tap] paywall-primary", { backendProActive, hasPro, isLoading, isPurchasing });
          if (backendProActive) {
            router.back();
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
        disabled={isLoading || isPurchasing}
      />
      <PrimaryButton label="Keep Free Access" secondary onPress={() => { console.log("[tap] paywall-keep-free"); router.back(); }} />
      {feedbackMessage ? <Text style={styles.feedback}>{feedbackMessage}</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {!hasPro ? <Text style={styles.footnote}>Cancel anytime</Text> : null}
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
  compareCard: { ...cardStyles.standard, padding: 20, gap: 14 },
  title: { ...Typography.title, color: Colors.textStrong },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  plan: { backgroundColor: Colors.cardAlt, borderRadius: Radius.lg, padding: 16, gap: 8 },
  planHighlight: { backgroundColor: Colors.primary },
  planTitle: { ...Typography.heading, color: Colors.textStrong },
  planTitleHighlight: { color: "#FFFFFF" },
  item: { ...Typography.body, color: Colors.textMuted },
  itemHighlight: { color: "rgba(255,255,255,0.86)" },
  feedback: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
  error: { ...Typography.caption, color: "#A14D52", textAlign: "center" },
  footnote: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
  footer: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
});
