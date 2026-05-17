import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { VehicleCard } from "@/components/VehicleCard";
import { Colors, Radius, Typography } from "@/constants/theme";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { vehicleService } from "@/services/vehicleService";
import { VehicleRecord } from "@/types";

type PickerField = "year" | "make" | "model" | "trim";

type ManualSearchOptions = {
  years: string[];
  makes: string[];
  models: string[];
  trims: string[];
};

const EMPTY_MANUAL_SEARCH_OPTIONS: ManualSearchOptions = {
  years: [],
  makes: [],
  models: [],
  trims: [],
};

export default function SearchScreen() {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [results, setResults] = useState<VehicleRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedTrim, setSelectedTrim] = useState<string | null>(null);
  const [selectedManualTrim, setSelectedManualTrim] = useState("");
  const [manualOptions, setManualOptions] = useState<ManualSearchOptions>(EMPTY_MANUAL_SEARCH_OPTIONS);
  const [pickerField, setPickerField] = useState<PickerField | null>(null);
  const [manualFallbackVisible, setManualFallbackVisible] = useState(false);

  useEffect(() => {
    let active = true;
    offlineCanonicalService
      .getManualSearchOptions({ year, make, model })
      .then((options) => {
        if (active) {
          setManualOptions(options);
        }
      })
      .catch((err) => {
        console.log("[manual-search] MANUAL_SEARCH_OPTIONS_LOAD_FAILED", err instanceof Error ? err.message : err);
        if (active) {
          setManualOptions(EMPTY_MANUAL_SEARCH_OPTIONS);
        }
      });

    return () => {
      active = false;
    };
  }, [year, make, model]);

  const clearSearchResults = (preserveSelectedTrim = false) => {
    setResults([]);
    setSearched(false);
    setError(null);
    if (!preserveSelectedTrim) {
      setSelectedTrim(null);
    }
  };

  const selectPickerOption = (value: string) => {
    if (pickerField === "year") {
      setYear(value);
      setMake("");
      setModel("");
      setSelectedManualTrim("");
      setSelectedTrim(null);
    } else if (pickerField === "make") {
      setMake(value);
      setModel("");
      setSelectedManualTrim("");
      setSelectedTrim(null);
    } else if (pickerField === "model") {
      setModel(value);
      setSelectedManualTrim("");
      setSelectedTrim(null);
    } else if (pickerField === "trim") {
      setSelectedManualTrim(value);
      setSelectedTrim(value);
    }
    clearSearchResults(pickerField === "trim");
    setPickerField(null);
  };

  const pickerOptions = useMemo(() => {
    if (pickerField === "year") {
      return manualOptions.years;
    }
    if (pickerField === "make") {
      return manualOptions.makes;
    }
    if (pickerField === "model") {
      return manualOptions.models;
    }
    if (pickerField === "trim") {
      return manualOptions.trims;
    }
    return [];
  }, [manualOptions.makes, manualOptions.models, manualOptions.trims, manualOptions.years, pickerField]);

  const pickerTitle =
    pickerField === "year"
      ? "Select year"
      : pickerField === "make"
        ? "Select make"
        : pickerField === "model"
          ? "Select model"
          : pickerField === "trim"
            ? "Select trim"
          : "";

  const canSearch = year.trim().length > 0 && make.trim().length > 0 && model.trim().length > 0;

  const search = async () => {
    Keyboard.dismiss();
    if (!canSearch) {
      setError("Select a year, make, and model before searching.");
      setSearched(false);
      return;
    }
    try {
      setIsSearching(true);
      setSelectedTrim(selectedManualTrim || null);
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
        <SelectionButton
          testID="manual-search-year-picker"
          label="Year"
          value={year}
          placeholder="Select year"
          onPress={() => setPickerField("year")}
        />
        <SelectionButton
          testID="manual-search-make-picker"
          label="Make"
          value={make}
          placeholder={year ? "Select make" : "Choose year first"}
          disabled={!year}
          onPress={() => setPickerField("make")}
        />
        <SelectionButton
          testID="manual-search-model-picker"
          label="Model"
          value={model}
          placeholder={year && make ? "Select model" : "Choose year and make first"}
          disabled={!year || !make}
          onPress={() => setPickerField("model")}
        />
        {model && manualOptions.trims.length > 0 ? (
          <SelectionButton
            testID="manual-search-trim-picker"
            label="Trim"
            value={selectedManualTrim}
            placeholder="Any trim"
            onPress={() => setPickerField("trim")}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={styles.manualFallbackButton}
          onPress={() => setManualFallbackVisible((visible) => !visible)}
        >
          <Ionicons name={manualFallbackVisible ? "remove-circle-outline" : "create-outline"} size={17} color={Colors.textSoft} />
          <Text style={styles.manualFallbackButtonText}>{manualFallbackVisible ? "Hide text fallback" : "Use text fallback"}</Text>
        </Pressable>
        {manualFallbackVisible ? (
          <View style={styles.manualFallbackFields}>
            <TextInput
              testID="manual-search-year-fallback-input"
              value={year}
              onChangeText={(value) => {
                setYear(value);
                setMake("");
                setModel("");
                setSelectedManualTrim("");
                setSelectedTrim(null);
                clearSearchResults();
              }}
              placeholder="Type year"
              style={styles.input}
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              returnKeyType="next"
            />
            <TextInput
              testID="manual-search-make-fallback-input"
              value={make}
              onChangeText={(value) => {
                setMake(value);
                setModel("");
                setSelectedManualTrim("");
                setSelectedTrim(null);
                clearSearchResults();
              }}
              placeholder="Type make"
              style={styles.input}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <TextInput
              testID="manual-search-model-fallback-input"
              value={model}
              onChangeText={(value) => {
                setModel(value);
                setSelectedManualTrim("");
                setSelectedTrim(null);
                clearSearchResults();
              }}
              placeholder="Type model"
              style={styles.input}
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="words"
              returnKeyType="search"
              onSubmitEditing={() => search().catch(() => undefined)}
            />
          </View>
        ) : null}
        <PrimaryButton label={isSearching ? "Searching..." : "Search Vehicles"} onPress={search} disabled={isSearching || !canSearch} />
      </View>
      <Modal visible={pickerField != null} animationType="slide" transparent onRequestClose={() => setPickerField(null)}>
        <View style={styles.modalScrim}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{pickerTitle}</Text>
              <Pressable accessibilityRole="button" style={styles.pickerCloseButton} onPress={() => setPickerField(null)}>
                <Ionicons name="close" size={20} color={Colors.textStrong} />
              </Pressable>
            </View>
            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
              {pickerOptions.length > 0 ? (
                pickerOptions.map((option) => {
                  const active =
                    (pickerField === "year" && year === option) ||
                    (pickerField === "make" && make === option) ||
                    (pickerField === "model" && model === option) ||
                    (pickerField === "trim" && selectedManualTrim === option);
                  return (
                    <Pressable
                      key={`${pickerField}-${option}`}
                      accessibilityRole="button"
                      style={[styles.pickerOption, active && styles.pickerOptionActive]}
                      onPress={() => selectPickerOption(option)}
                    >
                      <Text style={[styles.pickerOptionLabel, active && styles.pickerOptionLabelActive]}>{option}</Text>
                      {active ? <Ionicons name="checkmark" size={18} color={Colors.accent} /> : null}
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.pickerEmptyText}>Select the previous fields first.</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
          description={error ?? (searched ? "Try a broader year, make, or model to find a closer match." : "Select a year, make, and model to open the strongest direct vehicle match we can find.")}
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

function SelectionButton({
  testID,
  label,
  value,
  placeholder,
  disabled = false,
  onPress,
}: {
  testID: string;
  label: string;
  value: string;
  placeholder: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.selectorButton, disabled && styles.selectorButtonDisabled]}
      onPress={onPress}
    >
      <View style={styles.selectorTextStack}>
        <Text style={styles.selectorLabel}>{label}</Text>
        <Text style={[styles.selectorValue, !value && styles.selectorPlaceholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
      </View>
      <Ionicons name="chevron-down" size={18} color={disabled ? Colors.textMuted : Colors.textStrong} />
    </Pressable>
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
  selectorButton: {
    minHeight: 58,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  selectorButtonDisabled: {
    opacity: 0.56,
  },
  selectorTextStack: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  selectorLabel: { ...Typography.caption, color: Colors.textSoft },
  selectorValue: { ...Typography.bodyStrong, color: Colors.textStrong },
  selectorPlaceholder: { color: Colors.textMuted, fontWeight: "500" },
  selectorHint: { ...Typography.caption, color: Colors.textSoft },
  manualFallbackButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  manualFallbackButtonText: { ...Typography.caption, color: Colors.textSoft },
  manualFallbackFields: { gap: 10 },
  input: { backgroundColor: Colors.cardAlt, borderRadius: Radius.md, padding: 14, color: Colors.textStrong, borderWidth: 1, borderColor: Colors.borderSoft, ...Typography.body },
  modalScrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  pickerSheet: {
    maxHeight: "74%",
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: 14,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  pickerTitle: { ...Typography.heading, color: Colors.textStrong },
  pickerCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  pickerList: { maxHeight: 460 },
  pickerListContent: { paddingHorizontal: 18, paddingBottom: 24, gap: 8 },
  pickerOption: {
    minHeight: 48,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: Colors.cardSoft,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pickerOptionActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
  },
  pickerOptionLabel: { ...Typography.body, color: Colors.textStrong },
  pickerOptionLabelActive: { color: Colors.accent, fontWeight: "700" },
  pickerEmptyText: { ...Typography.body, color: Colors.textSoft, paddingVertical: 16 },
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
