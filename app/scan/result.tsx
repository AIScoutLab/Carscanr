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
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { garageService } from "@/services/garageService";
import { scanService } from "@/services/scanService";
import { vehicleService } from "@/services/vehicleService";
import { ListingResult, ScanResult, ValuationResult } from "@/types";
import { confidenceTone, formatConfidence } from "@/lib/utils";

type GroundedYearRange = {
  start: number;
  end: number;
};

type NormalizedVehicle = {
  id: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  displayTrimLabel: string | null;
  confidence: number | null;
  thumbnailUrl: string | null;
  displayYearLabel: string | null;
  groundedYearRange: GroundedYearRange | null;
  groundedMatchType: string | null;
};

type RenderCandidate = NormalizedVehicle & { renderKey: string };

type NormalizedScan = {
  id: string | null;
  imageUri: string | null;
  confidenceScore: number | null;
  detectedVehicleType: "car" | "motorcycle" | null;
  candidates: NormalizedVehicle[];
  identifiedVehicle: NormalizedVehicle;
  scannedAt: string | null;
  limitedPreview: boolean | null;
  quickResult: boolean;
  quickResultSource: "offline_canonical" | "local_scan_cache" | null;
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
    displayTrimLabel: typeof (input as any).trim === "string" ? (input as any).trim : null,
    confidence: safeNumber((input as any).confidence),
    thumbnailUrl: typeof (input as any).thumbnailUrl === "string" ? (input as any).thumbnailUrl : null,
    displayYearLabel: safeNumber((input as any).year) ? String(safeNumber((input as any).year)) : null,
    groundedYearRange: null,
    groundedMatchType: null,
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
    detectedVehicleType: raw.detectedVehicleType === "motorcycle" ? "motorcycle" : raw.detectedVehicleType === "car" ? "car" : null,
    candidates,
    identifiedVehicle: identified,
    scannedAt: typeof raw.scannedAt === "string" ? raw.scannedAt : null,
    limitedPreview: typeof raw.limitedPreview === "boolean" ? raw.limitedPreview : null,
    quickResult: raw.quickResult === true,
    quickResultSource:
      raw.quickResultSource === "offline_canonical" || raw.quickResultSource === "local_scan_cache"
        ? raw.quickResultSource
        : null,
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

function buildYearRangeLabel(yearRange: GroundedYearRange | null) {
  if (!yearRange) {
    return null;
  }
  return yearRange.start === yearRange.end ? `${yearRange.start}` : `${yearRange.start}-${yearRange.end}`;
}

function resolveDisplayYearLabel(input: {
  rawYear: number | null;
  confidence: number | null;
  yearRange: GroundedYearRange | null;
  exactGroundedYear: number | null;
  vehicle: NormalizedVehicle;
}) {
  const confidence = input.confidence ?? 0;
  const rangeLabel = buildYearRangeLabel(input.yearRange);
  const isWrangler = isWranglerFamily(input.vehicle);
  const canonicalAgreesExactly =
    typeof input.rawYear === "number" &&
    typeof input.exactGroundedYear === "number" &&
    input.rawYear === input.exactGroundedYear;

  if (canonicalAgreesExactly && confidence >= (isWrangler ? 0.95 : 0.9)) {
    return `${input.rawYear}`;
  }

  if (rangeLabel && input.yearRange && input.yearRange.start !== input.yearRange.end) {
    return rangeLabel;
  }

  if (typeof input.rawYear === "number") {
    if (confidence >= 0.9 && !input.yearRange && !isWrangler) {
      return `${input.rawYear} (est.)`;
    }
    if (confidence >= 0.75) {
      return `${input.rawYear} (est.)`;
    }
  }

  if (rangeLabel) {
    return rangeLabel;
  }

  return null;
}

function normalizeTrimText(value: string | null | undefined) {
  return safeString(value).toLowerCase();
}

function isWranglerFamily(vehicle: Pick<NormalizedVehicle, "make" | "model">) {
  return vehicle.make.toLowerCase() === "jeep" && vehicle.model.toLowerCase().includes("wrangler");
}

function resolveDisplayTrimLabel(input: {
  vehicle: NormalizedVehicle;
  groundedTrim: string | null;
  confidence: number | null;
}) {
  const confidence = input.confidence ?? 0;
  const rawTrim = input.vehicle.trim;
  const groundedTrim = input.groundedTrim;
  const rawTrimText = normalizeTrimText(rawTrim);
  const groundedTrimText = normalizeTrimText(groundedTrim);
  const preferredTrim = groundedTrim || rawTrim;

  if (!preferredTrim) {
    return null;
  }

  if (isWranglerFamily(input.vehicle)) {
    if (groundedTrimText.includes("willys") || rawTrimText.includes("willys")) {
      return confidence >= 0.8 ? "Willys" : null;
    }
    if (groundedTrimText.includes("rubicon") || rawTrimText.includes("rubicon")) {
      return confidence >= 0.95 ? "Rubicon" : null;
    }
    return null;
  }

  if (confidence >= 0.9 && groundedTrim) {
    return groundedTrim;
  }

  if (confidence >= 0.85 && rawTrim && groundedTrimText === rawTrimText) {
    return rawTrim;
  }

  return null;
}

async function enrichVehicleWithCanonicalGrounding(
  vehicle: NormalizedVehicle,
  detectedVehicleType: "car" | "motorcycle" | null,
): Promise<NormalizedVehicle> {
  const grounding = await offlineCanonicalService.resolveVehiclePresentation({
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    vehicleType: detectedVehicleType,
  });

  if (!grounding?.vehicle) {
    return {
      ...vehicle,
      displayYearLabel: resolveDisplayYearLabel({
        rawYear: vehicle.year,
        confidence: vehicle.confidence,
        yearRange: null,
        exactGroundedYear: null,
        vehicle,
      }),
      displayTrimLabel: resolveDisplayTrimLabel({
        vehicle,
        groundedTrim: null,
        confidence: vehicle.confidence,
      }),
    };
  }

  const groundedVehicle = grounding.vehicle;
  const displayTrimLabel = resolveDisplayTrimLabel({
    vehicle,
    groundedTrim: groundedVehicle.trim || null,
    confidence: vehicle.confidence,
  });
  return {
    ...vehicle,
    id: vehicle.id || (grounding.matchType === "id" || grounding.matchType === "exact" ? groundedVehicle.id : null),
    make: groundedVehicle.make || vehicle.make,
    model: groundedVehicle.model || vehicle.model,
    trim: groundedVehicle.trim || vehicle.trim,
    displayTrimLabel,
    groundedYearRange: grounding.yearRange,
    groundedMatchType: grounding.matchType,
    displayYearLabel: resolveDisplayYearLabel({
      rawYear: vehicle.year,
      confidence: vehicle.confidence,
      yearRange: grounding.yearRange,
      exactGroundedYear: groundedVehicle.year,
      vehicle,
    }),
  };
}

function canRenderEstimatedDetail(vehicle: NormalizedVehicle) {
  const makeKnown = vehicle.make.trim().toLowerCase() !== "unknown";
  const modelKnown = vehicle.model.trim().toLowerCase() !== "vehicle";
  return makeKnown && modelKnown;
}

async function enrichScanForDisplay(raw: ScanResult) {
  const normalizedScan = normalizeScanForResult(raw);
  const candidates = await Promise.all(
    normalizedScan.candidates.map((candidate) =>
      enrichVehicleWithCanonicalGrounding(candidate, normalizedScan.detectedVehicleType),
    ),
  );
  const identifiedVehicle = await enrichVehicleWithCanonicalGrounding(
    normalizedScan.identifiedVehicle,
    normalizedScan.detectedVehicleType,
  );

  const rankedCandidates = [...candidates].sort((left, right) => {
    const leftGrounded = left.id ? 1 : 0;
    const rightGrounded = right.id ? 1 : 0;
    if (leftGrounded !== rightGrounded) {
      return rightGrounded - leftGrounded;
    }

    const leftRange = left.groundedYearRange ? 1 : 0;
    const rightRange = right.groundedYearRange ? 1 : 0;
    if (leftRange !== rightRange) {
      return rightRange - leftRange;
    }

    const leftTrim = left.displayTrimLabel ? 1 : 0;
    const rightTrim = right.displayTrimLabel ? 1 : 0;
    if (leftTrim !== rightTrim) {
      return rightTrim - leftTrim;
    }

    return (right.confidence ?? 0) - (left.confidence ?? 0);
  });

  const matchedIdentifiedVehicle = rankedCandidates.find((candidate) => candidate.id === identifiedVehicle.id);
  const bestCandidate = rankedCandidates[0] ?? identifiedVehicle;

  return {
    ...normalizedScan,
    identifiedVehicle: matchedIdentifiedVehicle ?? bestCandidate,
    candidates: rankedCandidates,
  };
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
    scanService.getRecentScans().then(async (items) => {
      try {
        const matched = items.find((entry) => entry.id === scanId) ?? null;
        setScan(matched);
        if (!matched) {
          setNormalized(null);
          setError("Scan result is no longer available.");
        } else {
          const normalizedScan = await enrichScanForDisplay(matched);
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
    displayTrimLabel: null,
    confidence: null,
    thumbnailUrl: null,
    displayYearLabel: null,
    groundedYearRange: null,
    groundedMatchType: null,
  };
  let bestMatch: RenderCandidate = {
    ...(normalized?.identifiedVehicle ?? fallbackVehicle),
    renderKey: buildCandidateBaseKey(normalized?.identifiedVehicle ?? fallbackVehicle),
  };
  let candidatesForRender: RenderCandidate[] = [];
  let alternatives: RenderCandidate[] = [];
  let confidenceLine = "Confidence: 0% match";
  let insightLine = "Solid all-around vehicle.";
  const isCatalogMatched = Boolean(bestMatch.id);
  const isQuickResult = normalized?.quickResult === true;
  const isPro = usage?.plan === "pro";
  const unlockedForVehicle = isCatalogMatched && bestMatch.id ? isVehicleUnlocked(bestMatch.id) : false;
  const hasFullAccess = isCatalogMatched && (isPro || unlockedForVehicle);
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

  const saveToGarage = async () => {
    try {
      console.log("[tap] result-save-to-garage", { vehicleId: normalized?.identifiedVehicle.id ?? null });
      if (!(await authService.getAccessToken())) {
        Alert.alert("Sign in required", "Sign in to save vehicles to your Garage and keep them across devices.", [
          { text: "Not now", style: "cancel" },
          { text: "Sign In", onPress: () => router.push("/auth?mode=sign-in") },
        ]);
        return;
      }
      if (!normalized?.identifiedVehicle.id || !normalized.imageUri) {
        throw new Error("Missing vehicle details.");
      }
      await garageService.save(normalized.identifiedVehicle.id, normalized.imageUri);
    } catch (err) {
      console.log("[scan-result] save failed", err);
    }
    router.push("/(tabs)/garage");
  };

  const bestMatchYearLabel = bestMatch.displayYearLabel;
  const bestMatchTitle = [bestMatchYearLabel, bestMatch.make, bestMatch.model].filter(Boolean).join(" ");
  const buildEstimateDetailParams = (vehicle: NormalizedVehicle) => ({
    id: vehicle.id ?? `estimate-${normalized?.id ?? `${vehicle.make}-${vehicle.model}`}`.replace(/\s+/g, "-").toLowerCase(),
    estimate: "1",
    imageUri: normalized?.imageUri ?? "",
    scanId: normalized?.id ?? "",
    yearLabel: vehicle.displayYearLabel ?? "",
    make: vehicle.make,
    model: vehicle.model,
    trimLabel: vehicle.displayTrimLabel ?? vehicle.trim ?? "",
    vehicleType: normalized?.detectedVehicleType ?? "",
    confidence: `${vehicle.confidence ?? displayConfidenceScore}`,
  });
  const getDetailTarget = (vehicle: NormalizedVehicle) => {
    if (vehicle.id) {
      return {
        kind: "grounded" as const,
        params: {
          id: vehicle.id,
          imageUri: normalized?.imageUri ?? "",
          scanId: normalized?.id ?? "",
        },
      };
    }
    if (canRenderEstimatedDetail(vehicle)) {
      return {
        kind: "estimated" as const,
        params: buildEstimateDetailParams(vehicle),
      };
    }
    return {
      kind: "none" as const,
      params: null,
    };
  };
  const openVehicleDetail = (vehicle: NormalizedVehicle, source: string) => {
    const target = getDetailTarget(vehicle);
    console.log("[tap] result-open-request", {
      source,
      vehicleId: vehicle.id,
      targetKind: target.kind,
    });
    if (target.kind === "none" || !target.params) {
      console.log("[scan-result] FALLBACK_CARD_TAPPED", { source, scanId: normalized?.id ?? null });
      return;
    }
    router.push({
      pathname: "/vehicle/[id]",
      params: target.params,
    });
  };
  const useCandidate = (candidate: NormalizedVehicle) => {
    console.log("[tap] result-use-candidate", { candidateId: candidate.id, model: candidate.model });
    openVehicleDetail(candidate, "candidate-card");
  };

  const bestMatchDetailTarget = getDetailTarget(bestMatch);
  const canOpenBestMatch = bestMatchDetailTarget.kind !== "none";
  const handleOpenBestMatch = () => openVehicleDetail(bestMatch, "best-match-card");
  const handleOpenFullDetail = () => {
    console.log("[tap] result-open-full-detail", { vehicleId: bestMatch.id, targetKind: bestMatchDetailTarget.kind });
    openVehicleDetail(bestMatch, "open-full-detail");
  };
  const fallbackConfidenceLabel =
    displayConfidenceScore >= 0.9 ? "High confidence" : displayConfidenceScore >= 0.8 ? "Likely match" : "Estimated match";
  const resultImageSource = normalized?.imageUri ? "scanned-photo" : "none";
  const resultImageFitMode = normalized?.imageUri ? "contain" : "cover";
  const fallbackQuickFacts = !isCatalogMatched && displayConfidenceScore >= 0.85
    ? [
        bestMatch.displayYearLabel ? `Year: ${bestMatch.displayYearLabel}` : null,
        bestMatch.make ? `Make: ${bestMatch.make}` : null,
        bestMatch.model ? `Model: ${bestMatch.model}` : null,
        bestMatch.displayTrimLabel ? `Trim: ${bestMatch.displayTrimLabel}` : null,
        normalized?.detectedVehicleType ? `Vehicle type: ${normalized.detectedVehicleType === "motorcycle" ? "Motorcycle" : "Car"}` : null,
      ].filter((entry): entry is string => Boolean(entry))
    : [];

  useEffect(() => {
    if (!isCatalogMatched && normalized) {
      console.log("[scan-result] FALLBACK_RESULT_RENDERED", {
        scanId: normalized.id,
        confidence: displayConfidenceScore,
        vehicleType: normalized.detectedVehicleType,
      });
      console.log("[scan-result] FALLBACK_INLINE_STATE_SHOWN", {
        scanId: normalized.id,
        title: "Estimated match",
      });
      if (fallbackQuickFacts.length > 0) {
        console.log("[scan-result] FALLBACK_QUICK_FACTS_RENDERED", {
          scanId: normalized.id,
          facts: fallbackQuickFacts,
        });
      }
    }
  }, [displayConfidenceScore, fallbackQuickFacts, isCatalogMatched, normalized]);

  useEffect(() => {
    if (!normalized?.imageUri) {
      return;
    }
    console.log("[scan-result] RESULT_IMAGE_SOURCE_SELECTED", {
      source: resultImageSource,
      scanId: normalized.id,
      imageUri: normalized.imageUri,
    });
    console.log("[scan-result] RESULT_IMAGE_LAYOUT_SELECTED", {
      scanId: normalized.id,
      fitMode: resultImageFitMode,
      source: resultImageSource,
    });
    console.log("[scan-result] RESULT_IMAGE_FIT_MODE", {
      fitMode: resultImageFitMode,
      scanId: normalized.id,
    });
  }, [normalized?.id, normalized?.imageUri, resultImageFitMode, resultImageSource]);

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
          {normalized.imageUri ? (
            <View style={styles.imageFrame}>
              <Image source={{ uri: normalized.imageUri }} style={styles.image} resizeMode="contain" />
            </View>
          ) : null}
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
                style={[styles.primaryCard, !canOpenBestMatch && styles.primaryCardDisabled]}
                activeOpacity={canOpenBestMatch ? 0.88 : 1}
                accessibilityRole={canOpenBestMatch ? "button" : undefined}
                onPress={handleOpenBestMatch}
                disabled={!canOpenBestMatch}
              >
                <View style={styles.primaryAccent} pointerEvents="none" />
                {isQuickResult ? (
                  <View style={styles.quickResultBadge}>
                    <Text style={styles.quickResultBadgeText}>Quick result</Text>
                  </View>
                ) : null}
                {!isCatalogMatched ? (
                  <View style={styles.estimatedBadge}>
                    <Text style={styles.estimatedBadgeText}>Estimated match</Text>
                  </View>
                ) : null}
                <Text style={styles.primaryTitle}>{bestMatchTitle || `${bestMatch.make} ${bestMatch.model}`}</Text>
                <Text style={styles.subtitle}>{bestMatch.displayTrimLabel ?? (bestMatch.trim && (bestMatch.confidence ?? 0) >= 0.9 ? bestMatch.trim : "Likely model family")}</Text>
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
                    {!isCatalogMatched ? fallbackConfidenceLabel : confidenceTone(displayConfidenceScore)}
                  </Text>
                </Animated.View>
                <Text style={styles.confidenceNote}>This is the most likely match based on visible design cues from your photo.</Text>
                {!isCatalogMatched ? (
                  <Text style={styles.bestEffortNote}>We identified this vehicle from the photo with high confidence, but full catalog specs are still being linked.</Text>
                ) : null}
                {bestMatchDetailTarget.kind === "estimated" ? (
                  <Text style={styles.preview}>Estimated detail view is available. Full catalog specs may still be limited.</Text>
                ) : null}
                {!canOpenBestMatch ? (
                  <Text style={styles.preview}>Detailed specs are not available for this match yet.</Text>
                ) : null}
                {isCatalogMatched && !hasFullAccess ? <Text style={styles.preview}>Premium details are locked until you use a free unlock or upgrade to Pro.</Text> : null}
              </TouchableOpacity>
            </Animated.View>
          </>
          {!isCatalogMatched ? (
            <>
              {fallbackQuickFacts.length > 0 ? (
                <View style={styles.quickFactsCard}>
                  <Text style={styles.quickFactsTitle}>Estimated from photo analysis</Text>
                  {fallbackQuickFacts.map((fact) => (
                    <Text key={fact} style={styles.quickFactLine}>{fact}</Text>
                  ))}
                </View>
              ) : null}
              <View style={styles.unlockCard}>
                <Text style={styles.unlockTitle}>Estimated match</Text>
                <Text style={styles.unlockBody}>We identified this vehicle from the photo with high confidence, but full catalog specs are still being linked.</Text>
                <Text style={styles.unlockNote}>This is not a purchase issue. Try another scan angle, or check again after the catalog refreshes.</Text>
              </View>
            </>
          ) : !hasFullAccess ? (
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
                        console.log("[scan-result] FALLBACK_CARD_TAPPED", { source: "free-unlock-button", scanId: normalized?.id ?? null });
                        return;
                      }
                      const success = await useFreeUnlockForVehicle(bestMatch.id);
                      if (success) {
                        await refreshStatus();
                        openVehicleDetail(bestMatch, "free-unlock-continue");
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
                    displayTrimLabel: candidate.displayTrimLabel ?? undefined,
                    confidence: candidate.confidence ?? 0,
                    thumbnailUrl: candidate.thumbnailUrl ?? "",
                    displayYearLabel: candidate.displayYearLabel ?? undefined,
                  }}
                  onPress={getDetailTarget(candidate).kind !== "none" ? () => useCandidate(candidate) : undefined}
                />
              ))}
            </>
          ) : null}
          {isCatalogMatched ? <PrimaryButton label="Save to Garage" onPress={saveToGarage} /> : null}
          {canOpenBestMatch ? (
            <PrimaryButton
              label={bestMatchDetailTarget.kind === "estimated" ? "Open Estimated Detail" : "Open Full Vehicle Detail"}
              secondary
              onPress={handleOpenFullDetail}
            />
          ) : null}
          <Text style={styles.notRight}>Not right? Try one of the other possibilities above, or rescan from a cleaner front or rear angle.</Text>
        </Animated.View>
      </ErrorBoundary>
    </AppContainer>
  );
}

const styles = StyleSheet.create({
  imageFrame: {
    width: "100%",
    height: 280,
    borderRadius: Radius.xl,
    overflow: "hidden",
    backgroundColor: Colors.cardAlt,
  },
  image: { width: "100%", height: "100%" },
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
  estimatedBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#E8F4FF",
    borderColor: "#B8D8FF",
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 2,
  },
  quickResultBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 2,
  },
  quickResultBadgeText: { ...Typography.caption, color: "#047857", fontWeight: "700" },
  estimatedBadgeText: { ...Typography.caption, color: Colors.accent, fontWeight: "700" },
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
  quickFactsCard: {
    ...cardStyles.secondary,
    gap: 8,
  },
  quickFactsTitle: { ...Typography.heading, color: Colors.textStrong },
  quickFactLine: { ...Typography.body, color: Colors.textMuted },
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
