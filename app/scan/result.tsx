import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { CandidateMatchCard } from "@/components/CandidateMatchCard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmptyState } from "@/components/EmptyState";
import { LockedContentPreview } from "@/components/LockedContentPreview";
import { MarketSnapshotCard } from "@/components/MarketSnapshotCard";
import { OwnershipInsightsCard } from "@/components/OwnershipInsightsCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ProLockCard } from "@/components/ProLockCard";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { SectionHeader } from "@/components/SectionHeader";
import { UpgradePromptCard } from "@/components/UpgradePromptCard";
import { Colors, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";
import { useSubscription } from "@/hooks/useSubscription";
import { generateVehicleInsight } from "@/lib/vehicleInsights";
import { authService } from "@/services/authService";
import { garageService } from "@/services/garageService";
import { scanService } from "@/services/scanService";
import { vehicleService } from "@/services/vehicleService";
import { ListingResult, ScanResult, ValuationResult } from "@/types";
import { confidenceTone, formatConfidence } from "@/lib/utils";

type NormalizedVehicle = {
  id: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  confidence: number | null;
  thumbnailUrl: string | null;
};

type RenderCandidate = NormalizedVehicle & { renderKey: string };

type NormalizedScan = {
  id: string | null;
  imageUri: string | null;
  confidenceScore: number | null;
  candidates: NormalizedVehicle[];
  identifiedVehicle: NormalizedVehicle;
  scannedAt: string | null;
  limitedPreview: boolean | null;
};

function safeString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function safeNumber(value: unknown, fallback: number | null = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeVehicleForResult(raw: unknown): NormalizedVehicle {
  const input = (raw ?? {}) as Partial<ScanResult["identifiedVehicle"]>;
  return {
    id: typeof input.id === "string" ? input.id : null,
    year: safeNumber((input as any).year),
    make: safeString((input as any).make, "Unknown"),
    model: safeString((input as any).model, "Vehicle"),
    trim: typeof (input as any).trim === "string" ? (input as any).trim : null,
    confidence: safeNumber((input as any).confidence),
    thumbnailUrl: typeof (input as any).thumbnailUrl === "string" ? (input as any).thumbnailUrl : null,
  };
}

function normalizeScanForResult(raw: ScanResult): NormalizedScan {
  const candidates = Array.isArray(raw.candidates)
    ? raw.candidates.map((candidate) => normalizeVehicleForResult(candidate))
    : [];
  const identified = normalizeVehicleForResult(raw.identifiedVehicle ?? candidates[0]);
  return {
    id: typeof raw.id === "string" ? raw.id : null,
    imageUri: typeof raw.imageUri === "string" ? raw.imageUri : null,
    confidenceScore: safeNumber(raw.confidenceScore),
    candidates,
    identifiedVehicle: identified,
    scannedAt: typeof raw.scannedAt === "string" ? raw.scannedAt : null,
    limitedPreview: typeof raw.limitedPreview === "boolean" ? raw.limitedPreview : null,
  };
}

function buildCandidateBaseKey(candidate: NormalizedVehicle) {
  const parts = [
    candidate.id ? `id:${candidate.id}` : null,
    `year:${candidate.year ?? "na"}`,
    `make:${candidate.make || "unknown"}`,
    `model:${candidate.model || "vehicle"}`,
    `trim:${candidate.trim ?? "na"}`,
  ].filter(Boolean);
  return parts.join("|");
}

function buildRenderCandidates(candidates: NormalizedVehicle[]): RenderCandidate[] {
  const counts = new Map<string, number>();
  return candidates.map((candidate) => {
    const baseKey = buildCandidateBaseKey(candidate);
    const nextCount = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, nextCount);
    const renderKey = nextCount > 1 ? `${baseKey}:${nextCount}` : baseKey;
    return { ...candidate, renderKey };
  });
}

export default function ScanResultScreen() {
  const rawParams = useLocalSearchParams<{ scanId?: string; imageUri?: string }>();
  const params = typeof rawParams === "object" && rawParams ? rawParams : {};
  const scanId = typeof params.scanId === "string" ? params.scanId : undefined;
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [normalized, setNormalized] = useState<NormalizedScan | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<{
    avgPrice: string | null;
    priceRange: string | null;
    dealRating: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const {
    status: usage,
    freeUnlocksUsed,
    freeUnlocksRemaining,
    freeUnlocksLimit,
    isUnlocking,
    isVehicleUnlocked,
    useFreeUnlockForVehicle,
    refreshStatus,
  } = useSubscription();
  const sectionStateRef = useRef<{
    lockedPreview: boolean;
    alternatives: number;
  } | null>(null);
  const screenOpacity = useRef(new Animated.Value(0)).current;
  const screenTranslate = useRef(new Animated.Value(10)).current;
  const bestMatchScale = useRef(new Animated.Value(0.97)).current;
  const bestMatchOpacity = useRef(new Animated.Value(0)).current;
  const confidenceOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(screenOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(screenTranslate, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
    Animated.parallel([
      Animated.timing(bestMatchScale, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(bestMatchOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    Animated.timing(confidenceOpacity, { toValue: 1, duration: 120, delay: 100, useNativeDriver: true }).start();
    scanService.getRecentScans().then((items) => {
      try {
        const matched = items.find((entry) => entry.id === scanId) ?? null;
        setScan(matched);
        if (!matched) {
          setNormalized(null);
          setError("Scan result is no longer available.");
        } else {
          const normalizedScan = normalizeScanForResult(matched);
          setNormalized(normalizedScan);
          setError(null);
        }
      } catch (err) {
        console.log("[scan-result] normalize failed", err);
        setNormalized(null);
        setError("We couldn’t prepare that scan result.");
      } finally {
        setLoading(false);
      }
    });
    return () => {
      console.log("[scan-result] unmounted", { scanId });
    };
  }, [scanId]);

  const fallbackVehicle: NormalizedVehicle = {
    id: null,
    year: null,
    make: "Unknown",
    model: "Vehicle",
    trim: null,
    confidence: null,
    thumbnailUrl: null,
  };
  let bestMatch: RenderCandidate = {
    ...(normalized?.identifiedVehicle ?? fallbackVehicle),
    renderKey: buildCandidateBaseKey(normalized?.identifiedVehicle ?? fallbackVehicle),
  };
  let candidatesForRender: RenderCandidate[] = [];
  let alternatives: RenderCandidate[] = [];
  let confidenceLine = "Confidence: 0% match";
  let insightLine = "Solid all-around vehicle.";
  const isPro = usage?.plan === "pro";
  const unlockedForVehicle = bestMatch.id ? isVehicleUnlocked(bestMatch.id) : false;
  const hasFullAccess = isPro || unlockedForVehicle;
  const displayConfidenceScore = safeNumber(normalized?.confidenceScore, 0) ?? 0;
  const isHighConfidence = displayConfidenceScore >= 0.82;
  const confidencePalette =
    displayConfidenceScore >= 0.9
      ? { pill: "#ECFDF5", text: "#22C55E", label: "#16A34A", dot: "#22C55E" }
      : displayConfidenceScore >= 0.75
        ? { pill: "#EFF6FF", text: "#3B82F6", label: "#1D4ED8", dot: "#3B82F6" }
        : { pill: "#F1F5F9", text: "#475569", label: "#64748B", dot: "#94A3B8" };
  const parseCurrencyValue = (value: string | null | undefined) => {
    if (!value) return null;
    const digits = value.replace(/[^\d.]/g, "");
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const buildMarketSnapshot = (valuation: ValuationResult | null, listings: ListingResult[]) => {
    const listingPrices = listings
      .map((listing) => parseCurrencyValue(listing.price))
      .filter((price): price is number => typeof price === "number");
    const valuationPrices = valuation
      ? [valuation.tradeIn, valuation.privateParty, valuation.dealerRetail]
          .map((value) => parseCurrencyValue(value))
          .filter((price): price is number => typeof price === "number")
      : [];

    const averageFromListings =
      listingPrices.length > 0
        ? Math.round(listingPrices.reduce((sum, price) => sum + price, 0) / listingPrices.length)
        : null;
    const rangeFromListings =
      listingPrices.length > 1
        ? `$${Math.min(...listingPrices).toLocaleString("en-US")} - $${Math.max(...listingPrices).toLocaleString("en-US")}`
        : null;

    const avgPrice = averageFromListings
      ? `$${averageFromListings.toLocaleString("en-US")}`
      : valuationPrices.length > 0
        ? `$${Math.round(valuationPrices.reduce((sum, price) => sum + price, 0) / valuationPrices.length).toLocaleString("en-US")}`
        : null;

    const priceRange =
      rangeFromListings ??
      (valuationPrices.length > 1
        ? `$${Math.min(...valuationPrices).toLocaleString("en-US")} - $${Math.max(...valuationPrices).toLocaleString("en-US")}`
        : null);

    const dealRating =
      avgPrice || priceRange
        ? listingPrices.length >= 3
          ? "Strong market signal"
          : "Limited market signal"
        : null;

    return { avgPrice, priceRange, dealRating };
  };

  try {
    if (normalized) {
      const candidates = Array.isArray(normalized.candidates) ? normalized.candidates : [];
      candidatesForRender = buildRenderCandidates(candidates);
      const bestKey = candidatesForRender[0]?.renderKey;
      const duplicateBest = bestKey
        ? candidatesForRender.slice(1).some((candidate) => candidate.renderKey === bestKey)
        : false;
      bestMatch = candidatesForRender[0] ?? bestMatch;
      alternatives = candidatesForRender.filter((candidate) => candidate.renderKey !== bestKey).slice(0, 3);
      const confidenceScore = displayConfidenceScore;
      confidenceLine = `Confidence: ${formatConfidence(confidenceScore)} match`;
      insightLine = generateVehicleInsight({
        id: bestMatch.id ?? "unknown",
        year: bestMatch.year ?? 0,
        make: bestMatch.make ?? "Unknown",
        model: bestMatch.model ?? "Vehicle",
        trim: bestMatch.trim ?? undefined,
        confidence: bestMatch.confidence ?? confidenceScore,
        thumbnailUrl: bestMatch.thumbnailUrl ?? "",
      });
    }
  } catch (err) {
    console.log("[scan-result] derived fields failed", err);
  }

  const insightCopy =
    insightLine.toLowerCase().includes("performance") || insightLine.toLowerCase().includes("value")
      ? `⚡ ${insightLine}`
      : insightLine.toLowerCase().includes("resale") || insightLine.toLowerCase().includes("strong")
        ? `🔥 ${insightLine}`
        : insightLine;

  useEffect(() => {
    const vehicleId = bestMatch.id;
    if (!vehicleId) {
      setMarketSnapshot(null);
      return;
    }
    const zip = "60610";
    const mileage = "18400";
    const condition = "excellent";
    Promise.all([
      vehicleService.getValue(vehicleId, zip, mileage, condition).catch((err) => {
        console.log("[scan-result] value fetch failed", err);
        return null;
      }),
      vehicleService.getListings(vehicleId, zip).catch((err) => {
        console.log("[scan-result] listings fetch failed", err);
        return [] as ListingResult[];
      }),
    ])
      .then(([valuation, listings]) => {
        const snapshot = buildMarketSnapshot(valuation, listings);
        setMarketSnapshot(snapshot);
      })
      .catch((err) => {
        console.log("[scan-result] market snapshot failed", err);
        setMarketSnapshot(null);
      });
  }, [bestMatch.id]);

  useEffect(() => {
    if (!normalized) return;
    const nextState = { lockedPreview: !hasFullAccess, alternatives: alternatives.length };
    sectionStateRef.current = nextState;
  }, [normalized, hasFullAccess, alternatives.length]);

  if (loading) {
    return (
      <AppContainer scroll={false} contentContainerStyle={styles.loadingWrap}>
        <View style={styles.debugBanner}>
          <Text style={styles.debugBannerTitle}>RESULT SCREEN LOADED</Text>
          <Text style={styles.debugBannerBody}>Loading result for scanId: {scanId ?? "missing"}</Text>
        </View>
        <ActivityIndicator size="large" color={Colors.accent} />
        <Text style={styles.loadingText}>Loading scan result</Text>
      </AppContainer>
    );
  }

  if (!scan || !normalized) {
    return (
      <AppContainer>
        <View style={styles.debugBanner}>
          <Text style={styles.debugBannerTitle}>RESULT SCREEN LOADED</Text>
          <Text style={styles.debugBannerBody}>Result error for scanId: {scanId ?? "missing"}</Text>
        </View>
        <EmptyState title="Scan unavailable" description={error ?? "We couldn’t load that scan result."} />
      </AppContainer>
    );
  }

  const saveToGarage = async () => {
    try {
      console.log("[tap] result-save-to-garage", { vehicleId: normalized.identifiedVehicle.id });
      if (!(await authService.getAccessToken())) {
        Alert.alert("Sign in required", "Sign in to save vehicles to your Garage and keep them across devices.", [
          { text: "Not now", style: "cancel" },
          { text: "Sign In", onPress: () => router.push("/auth?mode=sign-in") },
        ]);
        return;
      }
      if (!normalized.identifiedVehicle.id || !normalized.imageUri) {
        throw new Error("Missing vehicle details.");
      }
      await garageService.save(normalized.identifiedVehicle.id, normalized.imageUri);
    } catch (err) {
      console.log("[scan-result] save failed", err);
    }
    router.push("/(tabs)/garage");
  };

  const explainBestEffortOnly = () => {
    console.log("[tap] result-best-effort-info");
    Alert.alert(
      "Best-effort identification",
      "We identified the vehicle from the photo, but couldn’t link it to the full specs catalog yet. Try rescanning from a cleaner front or rear angle for deeper details.",
    );
  };

  const openVehicleIfAvailable = (vehicleId: string | null, source: string) => {
    console.log("[tap] result-open-request", { source, vehicleId });
    if (!vehicleId) {
      explainBestEffortOnly();
      return;
    }
    router.push(`/vehicle/${vehicleId}`);
  };

  const useCandidate = (candidateId: string) => {
    console.log("[tap] result-use-candidate", { candidateId });
    openVehicleIfAvailable(candidateId || null, "candidate-card");
  };

  return (
    <AppContainer>
      <ErrorBoundary fallbackTitle="Result unavailable" fallbackMessage="We hit a rendering issue. Please go back and try again.">
        <Animated.View
          style={[
            styles.content,
            { opacity: screenOpacity, transform: [{ translateY: screenTranslate }] },
          ]}
        >
          <View style={styles.debugBanner}>
            <Text style={styles.debugBannerTitle}>RESULT SCREEN LOADED</Text>
            <Text style={styles.debugBannerBody}>scanId: {normalized.id ?? "missing"} | mode: full result</Text>
          </View>
          <BackButton fallbackHref="/(tabs)/scan" label="Scan" />
          {normalized.imageUri ? <Image source={{ uri: normalized.imageUri }} style={styles.image} /> : null}
          {usage ? (
            <ScanUsageMeter
              status={usage}
              mode="unlocks"
              unlocksUsed={freeUnlocksUsed}
              unlocksRemaining={freeUnlocksRemaining}
              unlocksLimit={freeUnlocksLimit}
            />
          ) : null}
          
          <>
            <SectionHeader title="Best Match" subtitle="Our strongest identification from this photo." />
            <Animated.View style={{ opacity: bestMatchOpacity, transform: [{ scale: bestMatchScale }] }}>
              <TouchableOpacity
                style={[styles.primaryCard, !bestMatch.id && styles.primaryCardDisabled]}
                activeOpacity={0.88}
                accessibilityRole="button"
                onPress={() => openVehicleIfAvailable(bestMatch.id, "best-match-card")}
              >
                <View style={styles.primaryAccent} pointerEvents="none" />
                <Text style={styles.primaryTitle}>{bestMatch.year ?? "--"} {bestMatch.make} {bestMatch.model}</Text>
                <Text style={styles.subtitle}>{bestMatch.trim ?? "Likely trim match"}</Text>
                <Text style={styles.confidenceLine}>{confidenceLine}</Text>
                <Text style={styles.insightLine}>{insightCopy}</Text>
                <Animated.View style={[styles.confidenceRow, { opacity: confidenceOpacity }]}>
                  <View style={[styles.confidencePill, { backgroundColor: confidencePalette.pill }]}>
                    <View style={[styles.confidenceDot, { backgroundColor: confidencePalette.dot }]} />
                    <Text style={[styles.confidencePillValue, { color: confidencePalette.text }, isHighConfidence && styles.confidencePositive]}>
                      {formatConfidence(displayConfidenceScore)}
                    </Text>
                  </View>
                  <Text style={[styles.confidenceCopy, { color: confidencePalette.label }, isHighConfidence && styles.confidencePositive]}>
                    {confidenceTone(displayConfidenceScore)}
                  </Text>
                </Animated.View>
                <Text style={styles.confidenceNote}>This is the most likely match based on visible design cues from your photo.</Text>
                {!bestMatch.id ? (
                  <Text style={styles.bestEffortNote}>Best-effort identification. Full specs catalog match is not available for this result yet.</Text>
                ) : null}
                {!hasFullAccess ? <Text style={styles.preview}>Premium details are locked until you use a free unlock or upgrade to Pro.</Text> : null}
              </TouchableOpacity>
            </Animated.View>
          </>
          {!hasFullAccess ? (
            <>
              <ProLockCard onPress={() => { console.log("[tap] result-pro-lock-card"); router.push("/paywall"); }} />
              <LockedContentPreview
                locked
                title="Full detail preview"
                description="You can still see the shape of the result. Pro reveals the full vehicle profile, value, and listings."
              >
                <View style={styles.previewCard}>
                  <Text style={styles.previewHeading}>What opens next</Text>
                  <Text style={styles.previewBody}>Original MSRP, engine, drivetrain, colors, market value, dealer listings, and your saved photo history for this vehicle.</Text>
                </View>
              </LockedContentPreview>
              <View style={styles.unlockCard}>
                <Text style={styles.unlockTitle}>Use 1 of your free unlocks</Text>
                <Text style={styles.unlockBody}>This unlock gives full premium access for this vehicle.</Text>
                <Text style={styles.unlockNote}>
                  {Math.max(0, freeUnlocksRemaining)} of {freeUnlocksLimit} free unlocks remaining
                </Text>
                {freeUnlocksRemaining > 0 ? (
                  <PrimaryButton
                    label={isUnlocking ? "Applying unlock..." : "Use 1 Free Unlock"}
                    onPress={async () => {
                      console.log("[tap] result-use-free-unlock", { vehicleId: bestMatch.id });
                      if (!bestMatch.id) {
                        explainBestEffortOnly();
                        return;
                      }
                      const success = await useFreeUnlockForVehicle(bestMatch.id);
                      if (success) {
                        await refreshStatus();
                        openVehicleIfAvailable(bestMatch.id, "free-unlock-continue");
                      }
                    }}
                    disabled={isUnlocking}
                  />
                ) : null}
                <PrimaryButton label="Unlock Pro" secondary onPress={() => { console.log("[tap] result-unlock-pro"); router.push("/paywall"); }} />
              </View>
            </>
          ) : (
            <>
              <MarketSnapshotCard
                avgPrice={marketSnapshot?.avgPrice ?? null}
                priceRange={marketSnapshot?.priceRange ?? null}
                dealRating={marketSnapshot?.dealRating ?? null}
              />
              <OwnershipInsightsCard />
            </>
          )}
          {alternatives.length > 0 ? (
            <>
              <SectionHeader title="Other Possibilities" subtitle="Helpful alternatives if the best match doesn’t look quite right." />
              {alternatives.map((candidate) => (
                <CandidateMatchCard
                  key={candidate.renderKey}
                  candidate={{
                    id: candidate.id ?? "",
                    year: candidate.year ?? 0,
                    make: candidate.make,
                    model: candidate.model,
                    trim: candidate.trim && candidate.trim.length > 0 ? candidate.trim : undefined,
                    confidence: candidate.confidence ?? 0,
                    thumbnailUrl: candidate.thumbnailUrl ?? "",
                  }}
                  onPress={() => useCandidate(candidate.id ?? "")}
                />
              ))}
            </>
          ) : null}
          <PrimaryButton label="Save to Garage" onPress={saveToGarage} />
          <PrimaryButton
            label="Open Full Vehicle Detail"
            secondary
            onPress={() => {
              console.log("[tap] result-open-full-detail", { vehicleId: bestMatch.id });
              openVehicleIfAvailable(bestMatch.id, "open-full-detail");
            }}
          />
          <Text style={styles.notRight}>Not right? Try one of the other possibilities above, or rescan from a cleaner front or rear angle.</Text>
        </Animated.View>
      </ErrorBoundary>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", height: 280, borderRadius: Radius.xl },
  content: { gap: 22 },
  primaryCard: {
    ...cardStyles.primaryTint,
    gap: 10,
    overflow: "hidden",
  },
  primaryCardDisabled: {
    opacity: 0.97,
  },
  primaryAccent: {
    position: "absolute",
    left: 0,
    top: 16,
    bottom: 16,
    width: 4,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },
  primaryTitle: { ...Typography.title, color: Colors.textStrong, fontWeight: "700", fontSize: 22, lineHeight: 28 },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  confidenceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  confidencePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.successSoft,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  confidenceDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: Colors.success,
  },
  confidencePillValue: { ...Typography.bodyStrong, color: Colors.success },
  confidenceCopy: { ...Typography.bodyStrong, color: Colors.success },
  confidencePositive: { color: Colors.success },
  confidenceNote: { ...Typography.caption, color: Colors.textMuted },
  confidenceLine: { ...Typography.caption, color: Colors.textMuted },
  insightLine: { ...Typography.bodyStrong, color: Colors.textStrong },
  preview: { ...Typography.caption, color: Colors.warning },
  bestEffortNote: { ...Typography.caption, color: Colors.accent },
  unlockCard: {
    ...cardStyles.secondary,
    gap: 10,
  },
  unlockTitle: { ...Typography.heading, color: Colors.textStrong },
  unlockBody: { ...Typography.body, color: Colors.textMuted },
  unlockNote: { ...Typography.caption, color: Colors.textMuted },
  previewCard: {
    ...cardStyles.tertiary,
    minHeight: 132,
    justifyContent: "center",
    gap: 8,
  },
  previewHeading: { ...Typography.heading, color: Colors.textStrong },
  previewBody: { ...Typography.body, color: Colors.textMuted },
  notRight: { ...Typography.caption, color: Colors.textMuted, textAlign: "center" },
  debugBanner: {
    backgroundColor: "#DCFCE7",
    borderColor: "#86EFAC",
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: 12,
    gap: 4,
    marginBottom: 12,
  },
  debugBannerTitle: { ...Typography.bodyStrong, color: Colors.textStrong },
  debugBannerBody: { ...Typography.caption, color: Colors.text },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { ...Typography.body, color: Colors.textMuted },
});
