import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { VehicleCard } from "@/components/VehicleCard";
import { Colors, Radius, Typography } from "@/constants/theme";
import { vehicleService } from "@/services/vehicleService";
import { VehicleRecord } from "@/types";

export default function SearchScreen() {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [results, setResults] = useState<VehicleRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedTrim, setSelectedTrim] = useState<string | null>(null);

  const search = async () => {
    Keyboard.dismiss();
    try {
      setIsSearching(true);
      setSelectedTrim(null);
      const data = await vehicleService.searchVehicles({ year, make, model });
      setResults(data);
      setError(null);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : "Search unavailable.");
    } finally {
      setIsSearching(false);
      setSearched(true);
    }
  };

  const availableTrims = useMemo(() => {
    const trims = Array.from(
      new Set(
        results
          .map((vehicle) => vehicle.trim?.trim())
          .filter((trim): trim is string => Boolean(trim)),
      ),
    );
    return trims.sort((left, right) => left.localeCompare(right));
  }, [results]);

  const displayedResults = useMemo(() => {
    if (!selectedTrim) {
      return results;
    }
    return results.filter((vehicle) => vehicle.trim?.trim() === selectedTrim);
  }, [results, selectedTrim]);
  const requiresTrimSelection = availableTrims.length > 1 && !selectedTrim;

  return (
    <AppContainer>
      <BackButton fallbackHref="/(tabs)/scan" label="Back" />
      <LinearGradient colors={["rgba(29,140,255,0.18)", "rgba(94,231,255,0.05)", "rgba(4,8,18,0.2)"]} style={styles.heroCard}>
        <Text style={styles.title}>Dial in an exact vehicle</Text>
        <Text style={styles.subtitle}>Use year, make, and model when you already know the vehicle and want the most deterministic path in the app.</Text>
      </LinearGradient>
      <View style={styles.card}>
        <TextInput value={year} onChangeText={setYear} placeholder="Year" style={styles.input} placeholderTextColor={Colors.textMuted} keyboardType="number-pad" returnKeyType="next" />
        <TextInput value={make} onChangeText={setMake} placeholder="Make" style={styles.input} placeholderTextColor={Colors.textMuted} autoCapitalize="words" returnKeyType="next" />
        <TextInput value={model} onChangeText={setModel} placeholder="Model" style={styles.input} placeholderTextColor={Colors.textMuted} autoCapitalize="words" returnKeyType="search" onSubmitEditing={() => search().catch(() => undefined)} />
        <PrimaryButton label={isSearching ? "Searching..." : "Search Vehicles"} onPress={search} disabled={isSearching} />
      </View>
      {isSearching ? (
        <View style={styles.loadingCard}>
          <Text style={styles.loadingEyebrow}>Manual search</Text>
          <Text style={styles.loadingTitle}>Assembling likely vehicle matches</Text>
          <Text style={styles.loadingBody}>Looking for the closest year, make, and model match with the strongest detail handoff.</Text>
          <View style={styles.loadingStack}>
            <PremiumSkeleton height={126} radius={Radius.xl} />
            <PremiumSkeleton height={126} radius={Radius.xl} />
            <PremiumSkeleton height={126} radius={Radius.xl} />
          </View>
        </View>
      ) : results.length === 0 ? (
        <EmptyState
          title={searched ? "No vehicles found" : "Search when you're ready"}
          description={error ?? (searched ? "Try a broader year, make, or model to find a closer match." : "Enter a year, make, and model to open the strongest direct vehicle match we can find.")}
        />
      ) : (
        <>
          {availableTrims.length > 1 ? (
            <View style={styles.trimSection}>
              <Text style={styles.trimTitle}>Refine by trim for the strongest exact detail match</Text>
              <Text style={styles.trimBody}>Choose one trim before opening detail. Until you do, we keep the result broad on purpose so image and specs do not drift to the wrong variant.</Text>
              <View style={styles.trimRow}>
                {availableTrims.map((trimOption) => {
                  const active = selectedTrim === trimOption;
                  return (
                    <Pressable key={trimOption} style={[styles.trimChip, active && styles.trimChipActive]} onPress={() => setSelectedTrim(trimOption)}>
                      <Text style={[styles.trimChipLabel, active && styles.trimChipLabelActive]}>{trimOption}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {displayedResults.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            subtitle={
              requiresTrimSelection
                ? [vehicle.trim, "Select this trim above to open exact detail"].filter(Boolean).join(" • ")
                : [vehicle.trim, vehicle.bodyStyle].filter(Boolean).join(" • ")
            }
            onPress={
              requiresTrimSelection
                ? undefined
                : () =>
                    router.push({
                      pathname: "/vehicle/[id]",
                      params: {
                        id: vehicle.id,
                        imageUri: vehicle.heroImage,
                      },
                    })
            }
          />
          ))}
        </>
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
  card: { backgroundColor: Colors.cardSoft, borderRadius: Radius.xl, padding: 20, gap: 12, borderWidth: 1, borderColor: Colors.border },
  input: { backgroundColor: Colors.cardAlt, borderRadius: Radius.md, padding: 14, color: Colors.textStrong, borderWidth: 1, borderColor: Colors.borderSoft, ...Typography.body },
  loadingCard: { backgroundColor: Colors.cardSoft, borderRadius: Radius.xl, padding: 18, gap: 10, borderWidth: 1, borderColor: Colors.border },
  loadingEyebrow: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 1.1 },
  loadingTitle: { ...Typography.heading, color: Colors.textStrong },
  loadingBody: { ...Typography.body, color: Colors.textSoft },
  loadingStack: { gap: 12, marginTop: 4 },
  trimSection: {
    gap: 10,
    backgroundColor: Colors.cardSoft,
    borderRadius: Radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  trimTitle: { ...Typography.bodyStrong, color: Colors.textStrong },
  trimBody: { ...Typography.caption, color: Colors.textSoft },
  trimRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  trimChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  trimChipActive: {
    backgroundColor: Colors.accentSoft,
    borderColor: Colors.accent,
  },
  trimChipLabel: { ...Typography.caption, color: Colors.textStrong },
  trimChipLabelActive: { color: Colors.accent, fontWeight: "700" },
});
