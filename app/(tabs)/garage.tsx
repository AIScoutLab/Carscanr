import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { EmptyState } from "@/components/EmptyState";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { UpgradePromptCard } from "@/components/UpgradePromptCard";
import { VehicleCard } from "@/components/VehicleCard";
import { Colors, Radius, Typography } from "@/constants/theme";
import { filterGarageItems } from "@/features/garage/garageFilters";
import { useSubscription } from "@/hooks/useSubscription";
import { garageService } from "@/services/garageService";
import { GarageItem } from "@/types";

export default function GarageScreen() {
  const [items, setItems] = useState<GarageItem[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { status: usage } = useSubscription();

  useEffect(() => {
    garageService
      .list()
      .then((result) => {
        setItems(result);
        setError(null);
      })
      .catch((err) => {
        setItems([]);
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
      <Text style={styles.title}>Garage</Text>
      <Text style={styles.subtitle}>Saved scans, notes, and favorites in one clean collection.</Text>
      {usage ? <ScanUsageMeter status={usage} /> : null}
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
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading your garage</Text>
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No saved vehicles yet"
          description={error ?? "Save a scan to your Garage to keep notes, favorites, and photos attached to each vehicle."}
        />
      ) : (
        filtered.map((item) => (
          <VehicleCard
            key={item.id}
            vehicle={item.vehicle}
            subtitle={`${item.favorite ? "Favorite" : "Saved"} • ${item.notes}`}
            onPress={() => router.push(`/vehicle/${item.vehicleId}`)}
          />
        ))
      )}
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...Typography.largeTitle, color: Colors.text, marginTop: 12 },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  input: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: 16, color: Colors.text, ...Typography.body },
  filter: { alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.cardAlt, borderRadius: Radius.pill },
  filterActive: { backgroundColor: Colors.primary },
  filterLabel: { ...Typography.caption, color: Colors.text },
  filterLabelActive: { color: "#FFFFFF" },
  loadingWrap: { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 24, alignItems: "center", gap: 12 },
  loadingText: { ...Typography.body, color: Colors.textMuted },
});
