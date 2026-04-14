import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { ListingCard } from "@/components/ListingCard";
import { LockedContentPreview } from "@/components/LockedContentPreview";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { SectionHeader } from "@/components/SectionHeader";
import { SegmentedTabBar } from "@/components/SegmentedTabBar";
import { ValueEstimateCard } from "@/components/ValueEstimateCard";
import { Colors, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";
import { useSubscription } from "@/hooks/useSubscription";
import { scanService } from "@/services/scanService";
import { vehicleService } from "@/services/vehicleService";
import { ValuationResult, VehicleRecord } from "@/types";
import { formatCurrency } from "@/lib/utils";

const tabs = ["Overview", "Specs", "Value", "For Sale", "Photos"];
const defaultZip = "60610";
const defaultMileage = "18400";
const defaultCondition = "Excellent";
const conditionOptions = ["Poor", "Fair", "Good", "Very Good", "Excellent"];

function createEmptyValuation(): ValuationResult {
  return {
    tradeIn: "Unavailable",
    tradeInRange: "Unavailable",
    privateParty: "Unavailable",
    privatePartyRange: "Unavailable",
    dealerRetail: "Unavailable",
    dealerRetailRange: "Unavailable",
    confidenceLabel: "Live valuation unavailable",
    sourceLabel: "No live value source",
    modelType: "modeled" as const,
  };
}

function normalizeCondition(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function parseMileageValue(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  return digits.length > 0 ? digits : null;
}

function parseConditionLabel(value: string) {
  const match = value.match(/^Based on (.+) condition at /i);
  if (!match?.[1]) {
    return null;
  }

  return match[1]
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getInitialMileage(vehicle: VehicleRecord) {
  const listingMileage = vehicle.listings[0]?.mileage ? parseMileageValue(vehicle.listings[0].mileage) : null;
  if (listingMileage) {
    return listingMileage;
  }

  const valuationMileage = parseMileageValue(vehicle.valuation.confidenceLabel);
  return valuationMileage ?? defaultMileage;
}

function getInitialCondition(vehicle: VehicleRecord) {
  if (vehicle.valuation.confidenceLabel !== "Live valuation unavailable") {
    const parsed = parseConditionLabel(vehicle.valuation.confidenceLabel);
    if (parsed) {
      return parsed;
    }
  }

  return defaultCondition;
}

export default function VehicleDetailScreen() {
  const { id, imageUri, scanId } = useLocalSearchParams<{ id: string; imageUri?: string; scanId?: string }>();
  const [vehicle, setVehicle] = useState<VehicleRecord | null>(null);
  const [valuation, setValuation] = useState<ValuationResult>(createEmptyValuation());
  const [zipCode, setZipCode] = useState(defaultZip);
  const [mileage, setMileage] = useState(defaultMileage);
  const [condition, setCondition] = useState(defaultCondition);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [tab, setTab] = useState("Overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedImageUri, setResolvedImageUri] = useState<string | null>(typeof imageUri === "string" && imageUri.trim().length > 0 ? imageUri : null);
  const [imageSourceLabel, setImageSourceLabel] = useState<string>(typeof imageUri === "string" && imageUri.trim().length > 0 ? "scanned photo (route param)" : "provider/generic");
  const previousConditionRef = useRef<string | null>(null);
  const previousValueRef = useRef<string | null>(null);
  const {
    status: usage,
    freeUnlocksUsed,
    freeUnlocksRemaining,
    freeUnlocksLimit,
    isUnlocking,
    isVehicleUnlocked,
    useFreeUnlockForVehicle,
  } = useSubscription();
  const isPro = usage?.plan === "pro";
  const unlockedForVehicle = vehicle?.id ? isVehicleUnlocked(vehicle.id) : false;
  const hasFullAccess = isPro || unlockedForVehicle;
  const isLocked = !hasFullAccess;

  useEffect(() => {
    setLoading(true);
    vehicleService
      .getVehicleById(id)
      .then((result) => {
        setVehicle(result ?? null);
        setValuation(result?.valuation ?? createEmptyValuation());
        if (result) {
          setZipCode(defaultZip);
          setMileage(getInitialMileage(result));
          setCondition(getInitialCondition(result));
        }
        setError(result ? null : "Vehicle not found.");
      })
      .catch((err) => {
        setVehicle(null);
        setValuation(createEmptyValuation());
        setError(err instanceof Error ? err.message : "Unable to load vehicle.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (typeof imageUri === "string" && imageUri.trim().length > 0) {
      console.log("[vehicle-detail] image source selected", {
        source: "route-image-uri",
        imageUri,
        scanId,
        vehicleId: id,
      });
      setResolvedImageUri(imageUri);
      setImageSourceLabel("scanned photo (route param)");
      return;
    }

    if (!scanId) {
      return;
    }

    scanService.getRecentScans().then((items) => {
      const matched = items.find((entry) => entry.id === scanId);
      if (matched?.imageUri) {
        console.log("[vehicle-detail] image source selected", {
          source: "recent-scan-cache",
          imageUri: matched.imageUri,
          scanId,
          vehicleId: id,
        });
        setResolvedImageUri(matched.imageUri);
        setImageSourceLabel("saved scan image");
      }
    }).catch(() => undefined);
  }, [id, imageUri, scanId]);

  useEffect(() => {
    if (!vehicle || tab !== "Value") {
      return;
    }

    const normalizedZip = zipCode.trim();
    const normalizedMileage = mileage.trim();
    const normalizedCondition = normalizeCondition(condition);
    console.log("[vehicle-detail] VALUE_INPUT_CHANGED", {
      vehicleId: vehicle.id,
      previousCondition: previousConditionRef.current,
      newCondition: normalizedCondition,
      zip: normalizedZip,
      mileage: normalizedMileage,
    });

    if (!normalizedZip || !normalizedMileage || !normalizedCondition) {
      setValuation(createEmptyValuation());
      return;
    }

    const timeout = setTimeout(() => {
      console.log("[vehicle-detail] VALUE_REQUEST_TRIGGERED", {
        vehicleId: vehicle.id,
        previousCondition: previousConditionRef.current,
        newCondition: normalizedCondition,
      });
      setValuationLoading(true);
      vehicleService
        .getValue(vehicle.id, normalizedZip, normalizedMileage, normalizedCondition)
        .then((result) => {
          const nextValue = JSON.stringify(result);
          console.log("[vehicle-detail] VALUE_CONDITION_COMPARISON", {
            vehicleId: vehicle.id,
            previousCondition: previousConditionRef.current,
            newCondition: normalizedCondition,
            previousValue: previousValueRef.current,
            newValue: nextValue,
            changed: previousValueRef.current !== nextValue,
          });
          setValuation(result);
          previousConditionRef.current = normalizedCondition;
          previousValueRef.current = nextValue;
        })
        .catch(() => {
          setValuation(createEmptyValuation());
        })
        .finally(() => {
          setValuationLoading(false);
        });
    }, 250);

    return () => clearTimeout(timeout);
  }, [vehicle, tab, zipCode, mileage, condition]);

  useEffect(() => {
    if (!vehicle || tab !== "Value") {
      return;
    }
    console.log("[vehicle-detail] VALUE_RENDERED", {
      vehicleId: vehicle.id,
      condition,
      valuation,
    });
  }, [condition, tab, valuation, vehicle]);

  if (loading) {
    return (
      <AppContainer scroll={false} contentContainerStyle={styles.loadingPage}>
        <BackButton fallbackHref="/(tabs)/scan" label="Back" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={styles.loadingText}>Loading vehicle details</Text>
        </View>
      </AppContainer>
    );
  }

  if (!vehicle) {
    return (
      <AppContainer contentContainerStyle={tab === "For Sale" ? styles.listingsPageContent : styles.pageContent}>
        <BackButton fallbackHref="/(tabs)/scan" label="Back" />
        <EmptyState title="Vehicle unavailable" description={error ?? "We couldn’t load this vehicle right now."} />
      </AppContainer>
    );
  }

  const heroImageUri = resolvedImageUri ?? vehicle.heroImage;
  const selectedImageSourceLabel = resolvedImageUri ? imageSourceLabel : "provider/generic fallback";
  console.log("[vehicle-detail] image source selected", {
    source: selectedImageSourceLabel,
    imageUri: heroImageUri,
    vehicleId: vehicle.id,
    scanId,
  });

  return (
    <AppContainer>
      <BackButton fallbackHref="/(tabs)/scan" label="Back" />
      <Image source={{ uri: heroImageUri }} style={styles.hero} />
      <Text style={styles.imageDebug}>Image source: {selectedImageSourceLabel}</Text>
      {usage ? (
        <ScanUsageMeter
          status={usage}
          mode="unlocks"
          unlocksUsed={freeUnlocksUsed}
          unlocksRemaining={freeUnlocksRemaining}
          unlocksLimit={freeUnlocksLimit}
        />
      ) : null}
      <View style={styles.headerCard}>
        <Text style={styles.title}>{vehicle.year} {vehicle.make} {vehicle.model}</Text>
        <Text style={styles.subtitle}>{vehicle.trim} • {vehicle.bodyStyle}</Text>
      </View>
      <SegmentedTabBar tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === "Overview" ? (
        <View style={styles.sectionCard}>
          <Text style={styles.body}>{vehicle.overview}</Text>
          <DetailRow label="Year" value={`${vehicle.year}`} />
          <DetailRow label="Make" value={vehicle.make} />
          <DetailRow label="Model" value={vehicle.model} />
          <DetailRow label="Trim" value={vehicle.trim} />
          <DetailRow label="Body style" value={vehicle.bodyStyle} />
        </View>
      ) : null}

      {tab === "Specs" ? (
        <>
          <LockedContentPreview
            locked={isLocked}
            title="Premium specs"
            description="See the full powertrain, drivetrain, colors, and pricing with Pro."
          >
            <View style={styles.sectionCard}>
              <DetailRow label="Engine" value={vehicle.specs.engine} />
              <DetailRow label="Horsepower" value={`${vehicle.specs.horsepower} hp`} />
              <DetailRow label="Torque" value={vehicle.specs.torque} />
              <DetailRow label="Transmission" value={vehicle.specs.transmission} />
              <DetailRow label="Drivetrain" value={vehicle.specs.drivetrain} />
              <DetailRow label="MPG / Range" value={vehicle.specs.mpgOrRange} />
              <DetailRow label="Colors" value={vehicle.specs.exteriorColors.join(", ")} />
              <DetailRow label="Original MSRP" value={formatCurrency(vehicle.specs.msrp)} />
            </View>
          </LockedContentPreview>
          {isLocked ? (
            <UnlockAccessCard
              remaining={freeUnlocksRemaining}
              limit={freeUnlocksLimit}
              disabled={!vehicle?.id || isUnlocking}
              isUnlocking={isUnlocking}
              onUnlock={async () => {
                if (!vehicle?.id) return;
                const success = await useFreeUnlockForVehicle(vehicle.id);
                if (success) {
                  setTab("Specs");
                }
              }}
              onUpgrade={() => router.push("/paywall")}
            />
          ) : null}
        </>
      ) : null}

      {tab === "Value" ? (
        <>
          <View style={styles.sectionCard}>
            <SectionHeader title="Value inputs" subtitle="Tune the estimate to your market and condition." />
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>ZIP code</Text>
              <TextInput
                style={styles.input}
                value={zipCode}
                onChangeText={setZipCode}
                autoCapitalize="characters"
                keyboardType="number-pad"
                maxLength={5}
                placeholder="ZIP code"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Mileage</Text>
              <TextInput
                style={styles.input}
                value={mileage}
                onChangeText={setMileage}
                keyboardType="number-pad"
                placeholder="Mileage"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Condition</Text>
              <View style={styles.conditionGrid}>
                {conditionOptions.map((option) => {
                  const active = option === condition;
                  return (
                    <Pressable
                      key={option}
                      style={[styles.conditionChip, active && styles.conditionChipActive]}
                      onPress={() => setCondition(option)}
                    >
                      <Text style={[styles.conditionChipLabel, active && styles.conditionChipLabelActive]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {valuationLoading ? <Text style={styles.valueLoading}>Updating live value…</Text> : null}
          </View>
          <LockedContentPreview
            locked={isLocked}
            title="Value preview"
            description="Preview the market card now. Pro reveals the full value context every time."
          >
            <ValueEstimateCard result={valuation} />
          </LockedContentPreview>
          {isLocked ? (
            <UnlockAccessCard
              remaining={freeUnlocksRemaining}
              limit={freeUnlocksLimit}
              disabled={!vehicle?.id || isUnlocking}
              isUnlocking={isUnlocking}
              onUnlock={async () => {
                if (!vehicle?.id) return;
                const success = await useFreeUnlockForVehicle(vehicle.id);
                if (success) {
                  setTab("Value");
                }
              }}
              onUpgrade={() => router.push("/paywall")}
            />
          ) : null}
        </>
      ) : null}

      {tab === "For Sale" ? (
        <>
          <View style={styles.sectionCard}>
            <Text style={styles.body}>
              {isLocked
                ? "Nearby listings are shown as a preview in free mode and fully unlocked in Pro."
                : "Nearby listings help you compare local pricing, mileage, and dealer context at a glance."}
            </Text>
          </View>
          <LockedContentPreview
            locked={isLocked}
            title="Nearby listings preview"
            description="See the full set of local comps and shopping context with Pro."
          >
            <View style={styles.listingsWrap}>
              {vehicle.listings
                .slice(0, Math.max(1, isLocked ? 1 : vehicle.listings.length))
                .map((listing, index) => (
                  <ListingCard key={listing.id} listing={listing} isBest={index === 0} />
                ))}
            </View>
          </LockedContentPreview>
          {isLocked ? (
            <UnlockAccessCard
              remaining={freeUnlocksRemaining}
              limit={freeUnlocksLimit}
              disabled={!vehicle?.id || isUnlocking}
              isUnlocking={isUnlocking}
              onUnlock={async () => {
                if (!vehicle?.id) return;
                const success = await useFreeUnlockForVehicle(vehicle.id);
                if (success) {
                  setTab("For Sale");
                }
              }}
              onUpgrade={() => router.push("/paywall")}
            />
          ) : null}
        </>
      ) : null}

      {tab === "Photos" ? (
        <View style={styles.sectionCard}>
          <Text style={styles.body}>Your saved scan photos live here for each vehicle. Add more photos as the Garage evolves.</Text>
          <Image source={{ uri: heroImageUri }} style={styles.photo} />
        </View>
      ) : null}
      {isLocked ? (
        <>
          <PrimaryButton label="Continue Browsing" onPress={() => router.back()} />
          <PrimaryButton label="View Pro Features" secondary onPress={() => router.push("/paywall")} />
        </>
      ) : (
        <PrimaryButton label="Continue Exploring" onPress={() => router.back()} />
      )}
    </AppContainer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function UnlockAccessCard({
  remaining,
  limit,
  disabled,
  isUnlocking,
  onUnlock,
  onUpgrade,
}: {
  remaining: number;
  limit: number;
  disabled: boolean;
  isUnlocking: boolean;
  onUnlock: () => void;
  onUpgrade: () => void;
}) {
  return (
    <View style={styles.unlockCard}>
      <Text style={styles.unlockTitle}>Use 1 Free Unlock</Text>
      <Text style={styles.unlockBody}>This unlock gives full premium access for this vehicle.</Text>
      <Text style={styles.unlockNote}>
        {Math.max(0, remaining)} of {limit} free unlocks remaining
      </Text>
      {remaining > 0 ? (
        <PrimaryButton label={isUnlocking ? "Applying unlock..." : "Use 1 Free Unlock"} onPress={onUnlock} disabled={disabled} />
      ) : null}
      <PrimaryButton label="Unlock Pro" secondary onPress={onUpgrade} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width: "100%", height: 260, borderRadius: Radius.xl },
  imageDebug: { ...Typography.caption, color: Colors.textMuted },
  headerCard: { ...cardStyles.primary, padding: 20, gap: 6 },
  title: { ...Typography.title, color: Colors.textStrong },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  sectionCard: { ...cardStyles.primary, padding: 18, gap: 14 },
  listingsWrap: { gap: 18 },
  pageContent: { paddingVertical: 24 },
  listingsPageContent: { paddingVertical: 24, backgroundColor: Colors.backgroundAlt },
  body: { ...Typography.body, color: Colors.textMuted },
  row: { borderTopWidth: 1, borderTopColor: Colors.borderSoft, paddingTop: 12, gap: 2 },
  rowLabel: { ...Typography.caption, color: Colors.textMuted },
  rowValue: { ...Typography.body, color: Colors.textStrong },
  inputGroup: { gap: 8 },
  inputLabel: { ...Typography.caption, color: Colors.textMuted },
  input: { backgroundColor: Colors.cardAlt, borderRadius: Radius.md, padding: 14, color: Colors.text, ...Typography.body },
  conditionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  conditionChip: {
    backgroundColor: Colors.cardAlt,
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  conditionChipActive: {
    backgroundColor: Colors.accentSoft,
    borderColor: Colors.accent,
  },
  conditionChipLabel: { ...Typography.caption, color: Colors.text },
  conditionChipLabelActive: { color: Colors.accent, fontWeight: "700" },
  valueLoading: { ...Typography.caption, color: Colors.textMuted },
  photo: { width: "100%", height: 220, borderRadius: Radius.lg },
  loadingPage: { flex: 1, gap: 20 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { ...Typography.body, color: Colors.textMuted },
  unlockCard: { ...cardStyles.secondary, gap: 10 },
  unlockTitle: { ...Typography.heading, color: Colors.textStrong },
  unlockBody: { ...Typography.body, color: Colors.textMuted },
  unlockNote: { ...Typography.caption, color: Colors.textMuted },
});
