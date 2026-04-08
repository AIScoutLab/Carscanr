import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { EmptyState } from "@/components/EmptyState";
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

  const search = async () => {
    try {
      const data = await vehicleService.searchVehicles({ year, make, model });
      setResults(data);
      setError(null);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : "Search unavailable.");
    } finally {
      setSearched(true);
    }
  };

  return (
    <AppContainer>
      <Text style={styles.title}>Search manually</Text>
      <Text style={styles.subtitle}>Find a vehicle by year, make, and model when you already know what you’re after.</Text>
      <View style={styles.card}>
        <TextInput value={year} onChangeText={setYear} placeholder="Year" style={styles.input} placeholderTextColor={Colors.textMuted} />
        <TextInput value={make} onChangeText={setMake} placeholder="Make" style={styles.input} placeholderTextColor={Colors.textMuted} />
        <TextInput value={model} onChangeText={setModel} placeholder="Model" style={styles.input} placeholderTextColor={Colors.textMuted} />
        <PrimaryButton label="Search Vehicles" onPress={search} />
      </View>
      {results.length === 0 ? (
        <EmptyState
          title={searched ? "No vehicles found" : "No results yet"}
          description={error ?? (searched ? "Try a broader year, make, or model." : "Run a search to browse backend vehicle records and jump into full detail pages.")}
        />
      ) : (
        results.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} onPress={() => router.push(`/vehicle/${vehicle.id}`)} />)
      )}
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  title: { ...Typography.largeTitle, color: Colors.text, marginTop: 12 },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  card: { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 20, gap: 12 },
  input: { backgroundColor: Colors.cardAlt, borderRadius: Radius.md, padding: 14, color: Colors.text, ...Typography.body },
});
