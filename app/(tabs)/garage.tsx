import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { EmptyState } from "@/components/EmptyState";
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { UpgradePromptCard } from "@/components/UpgradePromptCard";
import { VehicleCard } from "@/components/VehicleCard";
import { Colors, Radius, Typography } from "@/constants/theme";
import { filterGarageItems } from "@/features/garage/garageFilters";
import { useSubscription } from "@/hooks/useSubscription";
import { authService } from "@/services/authService";
import { garageService } from "@/services/garageService";
import { GarageItem } from "@/types";

export default function GarageScreen() {
  const [items, setItems] = useState<GarageItem[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const { status: usage, freeUnlocksRemaining, freeUnlocksLimit } = useSubscription();

  useEffect(() => {
    Promise.all([authService.getAccessToken(), garageService.list()])
      .then(([token, result]) => {
        setHasAccessToken(Boolean(token));
        setItems(result);
        setError(null);
      })
      .catch((err) => {
        setItems([]);
        setHasAccessToken(false);
        setError(err instanceof Error ? err.message : "Garage unavailable.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const filtered = filterGarageItems(items, query, favoritesOnly);
  const showGarageUpgrade = usage?.plan === "free" && items.length > 0;

  return (
    <AppContainer>
      <LinearGradient colors={["rgba(29,140,255,0.18)", "rgba(94,231,255,0.05)", "rgba(4,8,18,0.2)"]} style={styles.heroCard}>
        <View style={styles.heroBadge}>
          <Ionicons name="car-sport-outline" size={18} color={Colors.premium} />
          <Text style={styles.heroBadgeLabel}>Garage archive</Text>
        </View>
        <Text style={styles.title}>Your saved machines</Text>
        <Text style={styles.subtitle}>Collect scans, keep notes, and revisit the vehicles that deserve a second look.</Text>
      </LinearGradient>
      {usage ? <ScanUsageMeter status={usage} mode="unlocks" unlocksUsed={freeUnlocksLimit - freeUnlocksRemaining} unlocksRemaining={freeUnlocksRemaining} unlocksLimit={freeUnlocksLimit} /> : null}
      <TextInput value={query} onChangeText={setQuery} placeholder="Search your garage" placeholderTextColor={Colors.textMuted} style={styles.input} />
      <Pressable style={[styles.filter, favoritesOnly && styles.filterActive]} onPress={() => setFavoritesOnly((current) => !current)}>
        <Text style={[styles.filterLabel, favoritesOnly && styles.filterLabelActive]}>Favorites only</Text>
      </Pressable>
      {showGarageUpgrade ? (
        <UpgradePromptCard
          title={`${items.length} of 25 Garage saves used`}
          description="Free keeps your recent discoveries close. Pro gives you unlimited saved vehicles and a roomier long-term Garage."
          ctaLabel="Unlock Unlimited Garage"
          onPress={() => router.push("/paywall")}
        />
      ) : null}
      {loading ? (
        <View style={styles.loadingWrap}>
          <View style={styles.loadingHeroCard}>
            <Text style={styles.loadingEyebrow}>Collection sync</Text>
            <Text style={styles.loadingTitle}>Preparing your garage archive</Text>
            <Text style={styles.loadingText}>Loading saved vehicles, favorites, and collection cards.</Text>
          </View>
          <PremiumSkeleton height={110} radius={Radius.xl} />
          <PremiumSkeleton height={148} radius={Radius.xl} />
          <PremiumSkeleton height={148} radius={Radius.xl} />
          <ActivityIndicator size="small" color={Colors.accent} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyBadge}>
            <Ionicons name="albums-outline" size={18} color={Colors.premium} />
            <Text style={styles.emptyBadgeLabel}>Collection ready</Text>
          </View>
          <EmptyState
            title="No saved vehicles yet"
            description={
              error ??
              (hasAccessToken
                ? "Save a scan to your Garage to start building a curated vehicle archive with notes, favorites, and photos."
                : "Save vehicles here as you scan. Sign in anytime to sync your Garage across devices.")
            }
          />
          <PrimaryButton label="Scan Another Vehicle" onPress={() => router.push("/(tabs)/scan")} />
          {!hasAccessToken ? <PrimaryButton label="Sign In to Sync Garage" secondary onPress={() => router.push("/auth?mode=sign-in")} /> : null}
        </View>
      ) : (
        filtered.map((item) => (
          <VehicleCard
            key={item.id}
            vehicle={item.vehicle}
            subtitle={`${item.favorite ? "Favorite" : "Saved"} • ${item.notes}`}
            onPress={() => {
              if (item.sourceType === "estimate" || item.sourceType === "visual_override") {
                console.log("[garage] GARAGE_OPEN_ESTIMATE", {
                  unlockId: item.unlockId ?? item.vehicleId,
                  sourceType: item.sourceType,
                  opened: true,
                  garageItemId: item.id,
                });
              }
              router.push(
                item.sourceType === "estimate" || item.sourceType === "visual_override"
                  ? {
                      pathname: "/vehicle/[id]",
                      params: {
                        id: item.vehicleId,
                        unlockId: item.unlockId ?? item.vehicleId,
                        garageSource: "1",
                        reopenedSource: "1",
                        estimate: "1",
                        imageUri: item.imageUri,
                        yearLabel: item.estimateMeta?.year ? `${item.estimateMeta.year}` : "",
                        titleLabel: item.estimateMeta?.titleLabel ?? "",
                        make: item.estimateMeta?.make ?? item.vehicle.make,
                        model: item.estimateMeta?.model ?? item.vehicle.model,
                        trimLabel: item.estimateMeta?.trim ?? "",
                        vehicleType: item.estimateMeta?.vehicleType ?? "",
                        confidence: item.confidence != null ? `${item.confidence}` : "",
                        trustedCase: item.estimateMeta?.trustedCase ? "1" : "0",
                        resultSource: item.estimateMeta?.resultSource ?? item.sourceType ?? "",
                      },
                    }
                  : {
                      pathname: "/vehicle/[id]",
                      params: {
                        id: item.vehicleId,
                        unlockId: item.vehicleId,
                        garageSource: "1",
                        reopenedSource: "1",
                        titleLabel: `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`.trim(),
                        yearLabel: item.vehicle.year ? `${item.vehicle.year}` : "",
                        make: item.vehicle.make,
                        model: item.vehicle.model,
                        trimLabel: item.vehicle.trim,
                      },
                    },
              )}
            }
          />
        ))
      )}
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...Typography.largeTitle, color: Colors.text, marginTop: 4 },
  subtitle: { ...Typography.body, color: Colors.textSoft },
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
  input: { backgroundColor: Colors.cardSoft, borderRadius: Radius.md, padding: 16, color: Colors.textStrong, borderWidth: 1, borderColor: Colors.border, ...Typography.body },
  filter: { alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.cardAlt, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.borderSoft },
  filterActive: { backgroundColor: Colors.primary },
  filterLabel: { ...Typography.caption, color: Colors.textStrong },
  filterLabelActive: { color: "#FFFFFF" },
  loadingWrap: { backgroundColor: Colors.cardSoft, borderRadius: Radius.xl, padding: 24, alignItems: "center", gap: 12, borderWidth: 1, borderColor: Colors.border },
  loadingHeroCard: {
    width: "100%",
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    padding: 18,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  loadingEyebrow: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 1.1 },
  loadingTitle: { ...Typography.heading, color: Colors.textStrong },
  loadingText: { ...Typography.body, color: Colors.textSoft, textAlign: "center" },
  emptyWrap: { gap: 14 },
  emptyBadge: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.cyanGlow,
  },
  emptyBadgeLabel: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 0.9 },
});
