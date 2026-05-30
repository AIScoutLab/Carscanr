import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
import { Shadows, Typography } from "@/constants/theme";
import { toVehicleImageSource } from "@/constants/vehicleImages";
import { filterGarageItems } from "@/features/garage/garageFilters";
import { useSubscription } from "@/hooks/useSubscription";
import { formatHorsepowerLabel } from "@/lib/vehicleData";
import { authService } from "@/services/authService";
import { garageService } from "@/services/garageService";
import { GarageItem } from "@/types";

const garageColors = {
  background: "#040506",
  surface: "rgba(16,16,18,0.94)",
  border: "rgba(255,255,255,0.08)",
  borderWarm: "rgba(214,158,93,0.26)",
  text: "#F7F2EA",
  textSoft: "#B9BBC4",
  textMuted: "#858A98",
  goldLight: "#E9B878",
  success: "#20D878",
} as const;

function parseCurrencyValue(value?: string | number | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (!value) {
    return null;
  }
  const matches = String(value).match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?/g) ?? [];
  const values = matches
    .map((match) => Number(match.replace(/,/g, "")))
    .filter((parsed) => Number.isFinite(parsed) && parsed > 0);
  if (values.length === 0) {
    return null;
  }
  const referenceValue = values.length === 1
    ? values[0]
    : values.reduce((sum, parsed) => sum + parsed, 0) / values.length;
  return Math.round(referenceValue);
}

function getGarageItemReferenceValue(item: GarageItem) {
  return parseCurrencyValue(item.vehicle.specs.msrp);
}

function getConditionValueSnapshot(item: GarageItem) {
  const conditionValues = item.vehicle.valuation.conditionValues;
  if (!conditionValues) {
    return null;
  }

  const preferredCondition = item.vehicle.valuation.selectedCondition ?? item.vehicle.valuation.baseCondition ?? "good";
  if (preferredCondition === "fair" || preferredCondition === "good" || preferredCondition === "excellent") {
    return conditionValues[preferredCondition] ?? conditionValues.good ?? conditionValues.excellent ?? conditionValues.fair ?? null;
  }
  return conditionValues.good ?? conditionValues.excellent ?? conditionValues.fair ?? null;
}

function getGarageItemMarketValue(item: GarageItem) {
  const valuation = item.vehicle.valuation;
  if (
    !valuation ||
    valuation.valuationSource === "sample_demo" ||
    valuation.valuationSource === "unavailable" ||
    valuation.status === "ready_to_load" ||
    valuation.status === "provider_error" ||
    valuation.status === "no_comps_found" ||
    valuation.status === "specialty_unavailable" ||
    valuation.status === "stale_after_input_change"
  ) {
    return null;
  }

  const hasLiveMarketSource =
    valuation.valuationSource === "provider" ||
    valuation.valuationSource === "cache" ||
    valuation.valuationSource === "listing_comps" ||
    valuation.valuationSource === "modeled_fallback" ||
    valuation.modelType === "provider_range" ||
    valuation.modelType === "listing_derived" ||
    valuation.status === "loaded_value" ||
    valuation.status === "loaded_listing_range" ||
    valuation.status === "loaded_condition_set";

  if (!hasLiveMarketSource) {
    return null;
  }

  const conditionSnapshot = getConditionValueSnapshot(item);
  return (
    parseCurrencyValue(conditionSnapshot?.privateParty) ??
    parseCurrencyValue(conditionSnapshot?.median) ??
    parseCurrencyValue(conditionSnapshot?.dealerRetail) ??
    parseCurrencyValue(conditionSnapshot?.tradeIn) ??
    parseCurrencyValue(conditionSnapshot?.high) ??
    parseCurrencyValue(conditionSnapshot?.low) ??
    parseCurrencyValue(valuation.midpoint) ??
    parseCurrencyValue(valuation.median) ??
    parseCurrencyValue(valuation.privateParty) ??
    parseCurrencyValue(valuation.dealerRetail) ??
    parseCurrencyValue(valuation.tradeIn) ??
    parseCurrencyValue(valuation.privatePartyRange) ??
    parseCurrencyValue(valuation.dealerRetailRange) ??
    parseCurrencyValue(valuation.tradeInRange) ??
    parseCurrencyValue(valuation.rangeHigh) ??
    parseCurrencyValue(valuation.rangeLow) ??
    parseCurrencyValue(valuation.high) ??
    parseCurrencyValue(valuation.low) ??
    null
  );
}

function getGarageItemDisplayValue(item: GarageItem) {
  const marketValue = getGarageItemMarketValue(item);
  if (marketValue) {
    return {
      label: "Market Value",
      value: marketValue,
      source: "market" as const,
    };
  }
  return {
    label: "Reference Value",
    value: getGarageItemReferenceValue(item),
    source: "reference" as const,
  };
}

function formatCurrency(value: number | null) {
  if (!value) {
    return "Reference pending";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSavedDate(savedAt: string) {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return "Saved";
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getGarageTitle(item: GarageItem) {
  const title = item.estimateMeta?.titleLabel?.trim();
  if (title) {
    return title;
  }
  return [item.vehicle.year > 0 ? String(item.vehicle.year) : null, item.vehicle.make, item.vehicle.model].filter(Boolean).join(" ") || "Saved vehicle";
}

function getGarageSubtitle(item: GarageItem) {
  return [item.vehicle.trim, item.vehicle.bodyStyle].map((value) => value?.trim()).filter(Boolean).join(" • ");
}

function getImageSource(item: GarageItem) {
  return item.imageUri ? { uri: item.imageUri } : toVehicleImageSource(item.vehicle.heroImage);
}

function getMetaPill(item: GarageItem) {
  if (item.favorite) {
    return { label: "Favorite", icon: "star" as const };
  }
  if (item.confidence != null) {
    return { label: `${Math.round(item.confidence * 100)}% match`, icon: "checkmark-circle-outline" as const };
  }
  if (item.sourceType === "estimate" || item.sourceType === "visual_override") {
    return { label: "Scan saved", icon: "scan-outline" as const };
  }
  return { label: "Saved", icon: "bookmark-outline" as const };
}

export default function GarageScreen() {
  const [items, setItems] = useState<GarageItem[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const hasLoadedGarageOnceRef = useRef(false);
  const { status: usage } = useSubscription();

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!hasLoadedGarageOnceRef.current) {
      setLoading(true);
    }
    Promise.all([authService.getAccessToken(), garageService.list()])
      .then(([token, result]) => {
        if (cancelled) {
          return;
        }
        setHasAccessToken(Boolean(token));
        setItems(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setItems([]);
        setHasAccessToken(false);
        setError(err instanceof Error ? err.message : "Garage unavailable.");
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        hasLoadedGarageOnceRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []));

  const filtered = filterGarageItems(items, query, favoritesOnly);
  const showGarageUpgrade = usage?.plan === "free" && items.length > 0;
  const collectionValue = items.reduce((sum, item) => sum + (getGarageItemDisplayValue(item).value ?? 0), 0);
  const collectionValueLabel = collectionValue > 0 ? formatCurrency(collectionValue) : "Build your collection";
  const collectionCountLabel = `${items.length} ${items.length === 1 ? "vehicle" : "vehicles"}`;

  const openGarageItem = (item: GarageItem) => {
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
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "right", "bottom", "left"]}>
      <LinearGradient colors={["#020202", "#070605", "#050505"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.screenShell}>
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(214,158,93,0.11)", "rgba(214,158,93,0.032)", "rgba(214,158,93,0)"]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.topAmberWash}
        />
        <View style={styles.graphiteWash} pointerEvents="none" />
        <View style={styles.bottomVignette} pointerEvents="none" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>Private collection</Text>
              <Text style={styles.title}>My Garage</Text>
            </View>
            <Pressable style={styles.addButton} onPress={() => router.push("/(tabs)/scan")} accessibilityRole="button" accessibilityLabel="Scan a vehicle">
              <Ionicons name="add" size={22} color={garageColors.goldLight} />
            </Pressable>
          </View>

          <LinearGradient colors={["rgba(42,34,27,0.96)", "rgba(18,17,18,0.98)", "rgba(9,9,10,0.98)"]} style={styles.collectionCard}>
            <View style={styles.collectionHeaderRow}>
              <Text style={styles.collectionLabel}>Total Collection Value</Text>
              <View style={styles.collectionBadge}>
                <Ionicons name="albums-outline" size={14} color={garageColors.goldLight} />
                <Text style={styles.collectionBadgeText}>{collectionCountLabel}</Text>
              </View>
            </View>
            <Text style={styles.collectionValue}>{collectionValueLabel}</Text>
            <View style={styles.collectionSignalRow}>
              <Ionicons name="trending-up-outline" size={15} color={garageColors.success} />
              <Text style={styles.collectionSignalText}>
                {collectionValue > 0 ? "Best saved value snapshot" : "Save scanned vehicles to start tracking value"}
              </Text>
            </View>
          </LinearGradient>

          <View style={styles.controls}>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={17} color={garageColors.textMuted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search collection" placeholderTextColor={garageColors.textMuted} style={styles.input} />
            </View>
            <Pressable style={[styles.filter, favoritesOnly && styles.filterActive]} onPress={() => setFavoritesOnly((current) => !current)}>
              <Ionicons name={favoritesOnly ? "star" : "star-outline"} size={15} color={favoritesOnly ? "#101010" : garageColors.goldLight} />
              <Text style={[styles.filterLabel, favoritesOnly && styles.filterLabelActive]}>Favorites</Text>
            </Pressable>
          </View>

          {showGarageUpgrade ? (
            <LinearGradient colors={["rgba(214,158,93,0.16)", "rgba(18,17,18,0.98)"]} style={styles.upgradeCard}>
              <View style={styles.upgradeIcon}>
                <Ionicons name="lock-open-outline" size={18} color={garageColors.goldLight} />
              </View>
              <View style={styles.upgradeCopy}>
                <Text style={styles.upgradeTitle}>{items.length} of 25 Garage saves used</Text>
                <Text style={styles.upgradeText}>Unlock unlimited saves for a deeper long-term collection.</Text>
              </View>
              <Pressable style={styles.upgradeButton} onPress={() => router.push("/paywall")} accessibilityRole="button">
                <Text style={styles.upgradeButtonText}>Go Pro</Text>
                <Ionicons name="chevron-forward" size={15} color={garageColors.goldLight} />
              </Pressable>
            </LinearGradient>
          ) : null}

          {loading ? (
            <View style={styles.loadingWrap}>
              <LinearGradient colors={["rgba(42,34,27,0.82)", "rgba(13,13,15,0.98)"]} style={styles.loadingHeroCard}>
                <Text style={styles.loadingEyebrow}>Collection sync</Text>
                <Text style={styles.loadingTitle}>Preparing your garage archive</Text>
                <Text style={styles.loadingText}>Loading saved vehicles, favorites, and collection cards.</Text>
              </LinearGradient>
              <PremiumSkeleton height={320} radius={22} />
              <PremiumSkeleton height={320} radius={22} />
              <ActivityIndicator size="small" color={garageColors.goldLight} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <LinearGradient colors={["rgba(30,26,22,0.96)", "rgba(11,11,12,0.98)"]} style={styles.emptyCard}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="car-sport-outline" size={30} color={garageColors.goldLight} />
                </View>
                <Text style={styles.emptyTitle}>{favoritesOnly || query ? "No matching vehicles" : "Your collection awaits"}</Text>
                <Text style={styles.emptyText}>
                  {error ??
                    (favoritesOnly || query
                      ? "Adjust your search or favorites filter to reveal more of your saved collection."
                      : hasAccessToken
                        ? "Save a scan to build a cinematic archive of vehicles, photos, notes, and market context."
                        : "Save vehicles here as you scan. Sign in anytime to sync your Garage across devices.")}
                </Text>
              </LinearGradient>
              <Pressable style={styles.primaryAction} onPress={() => router.push("/(tabs)/scan")} accessibilityRole="button">
                <Text style={styles.primaryActionText}>Scan Another Vehicle</Text>
              </Pressable>
              {!hasAccessToken ? (
                <Pressable style={styles.secondaryAction} onPress={() => router.push("/auth?mode=sign-in")} accessibilityRole="button">
                  <Text style={styles.secondaryActionText}>Sign In to Sync Garage</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.collectionList}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{filtered.length} {filtered.length === 1 ? "vehicle" : "vehicles"}</Text>
              </View>
              {filtered.map((item) => {
                const title = getGarageTitle(item);
                const subtitle = getGarageSubtitle(item);
                const itemValue = getGarageItemDisplayValue(item);
                const pill = getMetaPill(item);
                const statChips = [
                  item.vehicle.specs.drivetrain || null,
                  item.vehicle.specs.mpgOrRange || null,
                  formatHorsepowerLabel(item.vehicle.specs.horsepower),
                ].filter(Boolean);
                return (
                  <Pressable key={item.id} style={styles.vehicleCard} onPress={() => openGarageItem(item)} accessibilityRole="button">
                    <View style={styles.vehicleImageWrap}>
                      <Image source={getImageSource(item)} style={styles.vehicleImage} resizeMode="cover" />
                      <LinearGradient colors={["rgba(4,5,6,0.08)", "rgba(4,5,6,0.18)", "rgba(4,5,6,0.62)", "rgba(4,5,6,0.98)"]} style={styles.vehicleImageOverlay} />
                      <View style={styles.savedDatePill}>
                        <Text style={styles.savedDateText}>{formatSavedDate(item.savedAt)}</Text>
                      </View>
                    </View>
                    <View style={styles.vehicleBody}>
                      <View style={styles.vehicleTitleRow}>
                        <View style={styles.vehicleTitleCopy}>
                          <Text style={styles.vehicleTitle} numberOfLines={2}>{title}</Text>
                          {subtitle ? <Text style={styles.vehicleSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
                        </View>
                        <View style={styles.vehicleStatusPill}>
                          <Ionicons name={pill.icon} size={13} color={garageColors.goldLight} />
                          <Text style={styles.vehicleStatusText}>{pill.label}</Text>
                        </View>
                      </View>
                      {statChips.length > 0 ? (
                        <View style={styles.statChipRow}>
                          {statChips.slice(0, 3).map((chip, index) => (
                            <View key={`${item.id}-${chip}-${index}`} style={styles.statChip}>
                              <Text style={styles.statChipText} numberOfLines={1}>{chip}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      <View style={styles.valueRow}>
                        <View>
                          <Text style={styles.valueLabel}>{itemValue.label}</Text>
                          <Text style={[styles.itemValue, !itemValue.value && styles.itemValueMuted]}>{formatCurrency(itemValue.value)}</Text>
                        </View>
                        <View style={styles.openButton}>
                          <Ionicons name="chevron-forward" size={18} color={garageColors.goldLight} />
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: garageColors.background,
  },
  screenShell: {
    flex: 1,
    backgroundColor: garageColors.background,
    overflow: "hidden",
  },
  topAmberWash: {
    position: "absolute",
    top: -172,
    left: -80,
    right: -80,
    height: 382,
    opacity: 0.78,
  },
  graphiteWash: {
    position: "absolute",
    top: 118,
    right: -110,
    width: 260,
    height: 260,
    borderRadius: 260,
    backgroundColor: "rgba(90,82,72,0.09)",
  },
  bottomVignette: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 260,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  scroll: {
    flex: 1,
  },
  screenContent: {
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 38,
    gap: 19,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  headerCopy: {
    gap: 4,
  },
  eyebrow: {
    ...Typography.caption,
    color: garageColors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1.7,
    fontWeight: "800",
  },
  title: {
    fontFamily: Typography.title.fontFamily,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    letterSpacing: 0,
    color: garageColors.text,
  },
  addButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,158,93,0.14)",
    borderWidth: 1,
    borderColor: "rgba(233,184,120,0.36)",
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  collectionCard: {
    borderRadius: 22,
    padding: 21,
    minHeight: 128,
    justifyContent: "space-between",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.22)",
    ...Shadows.cardStrong,
  },
  collectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  collectionLabel: {
    ...Typography.body,
    color: "rgba(247,242,234,0.66)",
  },
  collectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(214,158,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.2)",
  },
  collectionBadgeText: {
    ...Typography.caption,
    color: garageColors.goldLight,
    fontWeight: "800",
  },
  collectionValue: {
    fontFamily: Typography.title.fontFamily,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: 0,
    color: garageColors.goldLight,
  },
  collectionSignalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  collectionSignalText: {
    ...Typography.caption,
    color: garageColors.success,
    fontWeight: "800",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  searchWrap: {
    flex: 1,
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: "rgba(13,13,15,0.86)",
    borderWidth: 1,
    borderColor: garageColors.border,
  },
  input: {
    flex: 1,
    color: garageColors.text,
    ...Typography.body,
    paddingVertical: 0,
  },
  filter: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: "rgba(13,13,15,0.86)",
    borderWidth: 1,
    borderColor: garageColors.borderWarm,
  },
  filterActive: {
    backgroundColor: garageColors.goldLight,
    borderColor: garageColors.goldLight,
  },
  filterLabel: {
    ...Typography.caption,
    color: garageColors.goldLight,
    fontWeight: "800",
  },
  filterLabelActive: {
    color: "#101010",
  },
  upgradeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: garageColors.borderWarm,
  },
  upgradeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,158,93,0.13)",
  },
  upgradeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  upgradeTitle: {
    ...Typography.bodyStrong,
    color: garageColors.text,
    fontWeight: "800",
  },
  upgradeText: {
    ...Typography.caption,
    color: garageColors.textSoft,
  },
  upgradeButton: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(214,158,93,0.12)",
  },
  upgradeButtonText: {
    ...Typography.caption,
    color: garageColors.goldLight,
    fontWeight: "800",
  },
  loadingWrap: {
    gap: 14,
    alignItems: "center",
  },
  loadingHeroCard: {
    width: "100%",
    borderRadius: 22,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: garageColors.borderWarm,
  },
  loadingEyebrow: {
    ...Typography.caption,
    color: garageColors.goldLight,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  loadingTitle: {
    ...Typography.heading,
    color: garageColors.text,
    fontWeight: "800",
  },
  loadingText: {
    ...Typography.body,
    color: garageColors.textSoft,
  },
  emptyWrap: {
    gap: 14,
  },
  emptyCard: {
    minHeight: 258,
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 15,
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.2)",
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,158,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.2)",
  },
  emptyTitle: {
    fontFamily: Typography.title.fontFamily,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "800",
    color: garageColors.text,
    textAlign: "center",
  },
  emptyText: {
    ...Typography.body,
    color: garageColors.textSoft,
    textAlign: "center",
    lineHeight: 23,
  },
  primaryAction: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: garageColors.goldLight,
  },
  primaryActionText: {
    ...Typography.bodyStrong,
    color: "#080808",
    fontWeight: "800",
  },
  secondaryAction: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18,18,20,0.94)",
    borderWidth: 1,
    borderColor: garageColors.border,
  },
  secondaryActionText: {
    ...Typography.bodyStrong,
    color: garageColors.text,
    fontWeight: "800",
  },
  collectionList: {
    gap: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    paddingTop: 2,
  },
  sectionTitle: {
    ...Typography.caption,
    color: garageColors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    fontWeight: "800",
  },
  vehicleCard: {
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: garageColors.surface,
    borderWidth: 1,
    borderColor: garageColors.border,
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 18 },
    elevation: 5,
  },
  vehicleImageWrap: {
    height: 238,
    backgroundColor: garageColors.background,
  },
  vehicleImage: {
    width: "100%",
    height: "100%",
  },
  vehicleImageOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  savedDatePill: {
    position: "absolute",
    top: 14,
    right: 14,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(8,8,9,0.56)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  savedDateText: {
    ...Typography.caption,
    color: garageColors.goldLight,
    fontWeight: "800",
  },
  vehicleBody: {
    marginTop: -42,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 14,
  },
  vehicleTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },
  vehicleTitleCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  vehicleTitle: {
    ...Typography.heading,
    color: garageColors.text,
    fontWeight: "800",
  },
  vehicleSubtitle: {
    ...Typography.body,
    color: "rgba(247,242,234,0.66)",
  },
  vehicleStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(214,158,93,0.1)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.2)",
    maxWidth: 122,
  },
  vehicleStatusText: {
    ...Typography.caption,
    color: garageColors.goldLight,
    fontWeight: "800",
  },
  statChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statChip: {
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  statChipText: {
    ...Typography.caption,
    color: garageColors.textSoft,
    fontWeight: "700",
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    paddingTop: 2,
  },
  valueLabel: {
    ...Typography.caption,
    color: garageColors.textMuted,
    marginBottom: 2,
  },
  itemValue: {
    ...Typography.price,
    color: garageColors.goldLight,
    fontSize: 20,
    lineHeight: 25,
  },
  itemValueMuted: {
    color: garageColors.textMuted,
    fontSize: 17,
  },
  openButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,158,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.2)",
  },
});
