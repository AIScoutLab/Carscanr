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
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
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

type WranglerGeneration = "TJ" | "JK" | "JL";
type VehicleYearSupport = {
  stableFamily: boolean;
  yearSpread: number | null;
  noGenerationConflict: boolean;
  candidateCount: number;
};

type NormalizedVehicle = {
  id: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  source: "visual_candidate" | "ocr_override" | null;
  displayTrimLabel: string | null;
  displayTitleLabel: string | null;
  confidence: number | null;
  thumbnailUrl: string | null;
  displayYearLabel: string | null;
  groundedYearRange: GroundedYearRange | null;
  groundedMatchType: string | null;
  groundedCandidateCount: number | null;
  groundedExactYear: number | null;
  wranglerGeneration: WranglerGeneration | null;
  wranglerGenerationLabel: string | null;
  wranglerGenerationCompatible: boolean | null;
};

type RenderCandidate = NormalizedVehicle & { renderKey: string };

type NormalizedScan = {
  id: string | null;
  imageUri: string | null;
  source: "visual_candidate" | "ocr_override" | null;
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
    source: (input as any).source === "ocr_override" ? "ocr_override" : (input as any).source === "visual_candidate" ? "visual_candidate" : null,
    displayTrimLabel: typeof (input as any).trim === "string" ? (input as any).trim : null,
    displayTitleLabel: null,
    confidence: safeNumber((input as any).confidence),
    thumbnailUrl: typeof (input as any).thumbnailUrl === "string" ? (input as any).thumbnailUrl : null,
    displayYearLabel: safeNumber((input as any).year) ? String(safeNumber((input as any).year)) : null,
    groundedYearRange: null,
    groundedMatchType: null,
    groundedCandidateCount: null,
    groundedExactYear: null,
    wranglerGeneration: null,
    wranglerGenerationLabel: null,
    wranglerGenerationCompatible: null,
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
    source: raw.source === "ocr_override" ? "ocr_override" : raw.source === "visual_candidate" ? "visual_candidate" : null,
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

function getWranglerGenerationFromExactYear(year: number | null): WranglerGeneration | null {
  if (typeof year !== "number") {
    return null;
  }
  if (year >= 1997 && year <= 2006) {
    return "TJ";
  }
  if (year >= 2007 && year <= 2017) {
    return "JK";
  }
  if (year >= 2019) {
    return "JL";
  }
  return null;
}

function isWranglerGenerationCompatibleWithYear(generation: WranglerGeneration, year: number | null) {
  if (typeof year !== "number") {
    return null;
  }
  if (generation === "TJ") {
    return year >= 1997 && year <= 2006;
  }
  if (generation === "JK") {
    return year >= 2007 && year <= 2018;
  }
  return year >= 2018;
}

function getWranglerGenerationFromRange(
  yearRange: GroundedYearRange | null,
  candidateCount: number | null,
): WranglerGeneration | null {
  if (!yearRange) {
    return null;
  }
  if (typeof candidateCount === "number" && candidateCount > 4) {
    return null;
  }
  if (yearRange.start >= 1997 && yearRange.end <= 2006) {
    return "TJ";
  }
  if (yearRange.start >= 2007 && yearRange.end <= 2018) {
    return "JK";
  }
  if (yearRange.start >= 2018) {
    return "JL";
  }
  return null;
}

function buildWranglerGenerationLabel(generation: WranglerGeneration | null) {
  if (generation === "TJ") {
    return "likely TJ, 1997-2006";
  }
  if (generation === "JK") {
    return "likely JK, 2007-2018";
  }
  if (generation === "JL") {
    return "likely JL, 2018-present";
  }
  return null;
}

function resolveWranglerGeneration(input: {
  rawYear: number | null;
  confidence: number | null;
  yearRange: GroundedYearRange | null;
  exactGroundedYear: number | null;
  groundedMatchType: string | null;
  groundedCandidateCount: number | null;
}) {
  const confidence = input.confidence ?? 0;
  const rawGeneration = confidence >= 0.72 ? getWranglerGenerationFromExactYear(input.rawYear) : null;
  const groundedExactGeneration =
    input.groundedMatchType === "id" || input.groundedMatchType === "exact"
      ? getWranglerGenerationFromExactYear(input.exactGroundedYear)
      : null;
  const groundedRangeGeneration = getWranglerGenerationFromRange(input.yearRange, input.groundedCandidateCount);
  const resolvedGeneration = rawGeneration ?? groundedExactGeneration ?? groundedRangeGeneration;
  const compatibilityChecks = [
    rawGeneration && groundedExactGeneration ? rawGeneration === groundedExactGeneration : null,
    resolvedGeneration ? isWranglerGenerationCompatibleWithYear(resolvedGeneration, input.rawYear) : null,
    resolvedGeneration && typeof input.exactGroundedYear === "number"
      ? isWranglerGenerationCompatibleWithYear(resolvedGeneration, input.exactGroundedYear)
      : null,
  ].filter((value): value is boolean => typeof value === "boolean");

  const compatible = compatibilityChecks.length > 0 ? compatibilityChecks.every(Boolean) : null;

  return {
    generation: compatible === false ? rawGeneration ?? groundedRangeGeneration ?? null : resolvedGeneration,
    label: buildWranglerGenerationLabel(compatible === false ? rawGeneration ?? groundedRangeGeneration ?? null : resolvedGeneration),
    compatible,
  };
}

function buildDisplayTitleLabel(vehicle: NormalizedVehicle) {
  if (isWranglerFamily(vehicle) && vehicle.wranglerGenerationLabel) {
    return `${vehicle.make} ${vehicle.model} (${vehicle.wranglerGenerationLabel})`;
  }
  return [vehicle.displayYearLabel ?? null, vehicle.make, vehicle.model].filter(Boolean).join(" ");
}

function getYearRangeSpan(yearRange: GroundedYearRange | null) {
  if (!yearRange) {
    return null;
  }
  return Math.max(0, yearRange.end - yearRange.start);
}

function isGenerationSensitiveFamily(vehicle: Pick<NormalizedVehicle, "make" | "model" | "year">) {
  const make = vehicle.make.toLowerCase();
  const model = vehicle.model.toLowerCase();
  const combined = `${make} ${model}`;
  const isTruck = /(f150|f250|f350|silverado|sierra|ram|tacoma|tundra|colorado|canyon|ranger)/.test(combined);
  const isMuscle = /(mustang|camaro|challenger|charger|corvette)/.test(combined);
  const isClassic = typeof vehicle.year === "number" && vehicle.year > 0 && vehicle.year < 1996;
  return isWranglerFamily(vehicle) || isTruck || isMuscle || isClassic;
}

function isModernMainstreamFamily(vehicle: Pick<NormalizedVehicle, "make" | "model" | "year">) {
  if (isGenerationSensitiveFamily(vehicle)) {
    return false;
  }
  if (typeof vehicle.year !== "number" || vehicle.year < 2016) {
    return false;
  }
  const make = vehicle.make.toLowerCase();
  const mainstreamMakes = new Set([
    "toyota",
    "honda",
    "hyundai",
    "kia",
    "nissan",
    "mazda",
    "subaru",
    "chevrolet",
    "ford",
    "volkswagen",
  ]);
  return mainstreamMakes.has(make);
}

function buildVehicleFamilyKey(vehicle: Pick<NormalizedVehicle, "make" | "model">) {
  return `${safeString(vehicle.make).trim().toLowerCase()}:${safeString(vehicle.model).trim().toLowerCase()}`;
}

function getVehicleGenerationSignal(vehicle: NormalizedVehicle) {
  if (isWranglerFamily(vehicle)) {
    return vehicle.wranglerGeneration ?? null;
  }
  if (typeof vehicle.groundedYearRange?.start === "number" && typeof vehicle.groundedYearRange?.end === "number") {
    return `${vehicle.groundedYearRange.start}-${vehicle.groundedYearRange.end}`;
  }
  if (typeof vehicle.year === "number" && vehicle.year > 0) {
    return `${vehicle.year}`;
  }
  return null;
}

function buildYearSupportMap(candidates: NormalizedVehicle[]) {
  const supportByFamily = new Map<string, VehicleYearSupport>();
  const topCandidates = [...candidates].slice(0, 3);
  const familyKeys = Array.from(new Set(topCandidates.map((candidate) => buildVehicleFamilyKey(candidate))));

  familyKeys.forEach((familyKey) => {
    const familyCandidates = topCandidates.filter((candidate) => buildVehicleFamilyKey(candidate) === familyKey);
    const years = familyCandidates
      .map((candidate) => (typeof candidate.year === "number" && candidate.year > 0 ? candidate.year : null))
      .filter((year): year is number => typeof year === "number");
    const generationSignals = familyCandidates
      .map((candidate) => getVehicleGenerationSignal(candidate))
      .filter((signal): signal is string => typeof signal === "string" && signal.length > 0);

    supportByFamily.set(familyKey, {
      stableFamily: familyCandidates.length >= 2,
      yearSpread: years.length >= 2 ? Math.max(...years) - Math.min(...years) : years.length === 1 ? 0 : null,
      noGenerationConflict: new Set(generationSignals).size <= 1,
      candidateCount: familyCandidates.length,
    });
  });

  return supportByFamily;
}

function getYearConfidenceDecision(input: {
  rawYear: number | null;
  confidence: number | null;
  yearRange: GroundedYearRange | null;
  exactGroundedYear: number | null;
  vehicle: NormalizedVehicle;
  yearSupport?: VehicleYearSupport | null;
}) {
  const confidence = input.confidence ?? 0;
  const rangeSpan = getYearRangeSpan(input.yearRange);
  const yearRange = input.yearRange;
  const generationSensitive = isGenerationSensitiveFamily(input.vehicle);
  const modernMainstream = isModernMainstreamFamily(input.vehicle);
  const yearSupport = input.yearSupport ?? null;
  const groundedMatchType = input.vehicle.groundedMatchType;
  const strongCanonicalGrounding = groundedMatchType === "id" || groundedMatchType === "exact";
  const candidateCount = input.vehicle.groundedCandidateCount ?? Number.POSITIVE_INFINITY;
  const exactYearAgrees =
    typeof input.rawYear === "number" &&
    typeof input.exactGroundedYear === "number" &&
    input.rawYear === input.exactGroundedYear;
  const rawYearWithinRange =
    typeof input.rawYear === "number" &&
    !!yearRange &&
    input.rawYear >= yearRange.start &&
    input.rawYear <= yearRange.end;
  const noNearbyConflict =
    !yearRange ||
    (typeof rangeSpan === "number" && rangeSpan <= (generationSensitive ? 1 : 2) && candidateCount <= (generationSensitive ? 1 : 2));
  const strongGenerationSupport =
    strongCanonicalGrounding ||
    (!!yearRange &&
      typeof rangeSpan === "number" &&
      rangeSpan <= (generationSensitive ? 5 : 7) &&
      candidateCount <= (generationSensitive ? 2 : 3));
  const stableModernFamily =
    modernMainstream &&
    !generationSensitive &&
    (yearSupport?.stableFamily ?? false) &&
    (yearSupport?.noGenerationConflict ?? true) &&
    ((yearSupport?.yearSpread ?? 4) <= 3);
  const stableHighConfidenceFamily =
    !generationSensitive &&
    (yearSupport?.stableFamily ?? false) &&
    (yearSupport?.noGenerationConflict ?? true) &&
    ((yearSupport?.yearSpread ?? 2) <= 2);
  const narrowRangePromotion = stableModernFamily && confidence >= 0.88;
  const stableHighConfidencePromotion =
    stableHighConfidenceFamily &&
    confidence >= (modernMainstream ? 0.88 : 0.91) &&
    (exactYearAgrees || rawYearWithinRange || !yearRange || noNearbyConflict);
  const nearCertainOverride =
    !generationSensitive &&
    typeof input.rawYear === "number" &&
    confidence >= (modernMainstream ? 0.985 : 0.992) &&
    (exactYearAgrees || rawYearWithinRange || !yearRange || noNearbyConflict);
  const modernHighConfidenceOverride =
    modernMainstream &&
    !generationSensitive &&
    confidence >= 0.88 &&
    (yearSupport?.noGenerationConflict ?? true) &&
    ((yearSupport?.yearSpread ?? rangeSpan ?? 4) <= 3) &&
    ((yearSupport?.stableFamily ?? false) || strongCanonicalGrounding) &&
    (exactYearAgrees || rawYearWithinRange || noNearbyConflict);
  const canShowExactYear =
    (
      exactYearAgrees &&
      strongCanonicalGrounding &&
      strongGenerationSupport &&
      noNearbyConflict &&
      confidence >= (generationSensitive ? 0.97 : modernMainstream ? 0.91 : 0.94)
    ) ||
    nearCertainOverride ||
    (stableHighConfidencePromotion && typeof input.rawYear === "number") ||
    (modernHighConfidenceOverride && typeof input.rawYear === "number") ||
    (narrowRangePromotion && typeof input.rawYear === "number");
  const shouldPreferRange =
    !!yearRange &&
    typeof rangeSpan === "number" &&
    rangeSpan > 0 &&
    !narrowRangePromotion &&
    (
      strongGenerationSupport ||
      (rawYearWithinRange && confidence >= (generationSensitive ? 0.86 : 0.82))
    );
  const canShowEstimatedYear =
    typeof input.rawYear === "number" &&
    !shouldPreferRange &&
    !canShowExactYear &&
    confidence >= (generationSensitive ? 0.92 : modernMainstream ? 0.85 : 0.9) &&
    (
      generationSensitive
        ? (!yearRange || (rawYearWithinRange && typeof rangeSpan === "number" && rangeSpan <= 1 && strongCanonicalGrounding))
        : !stableModernFamily || (typeof yearSupport?.yearSpread === "number" && yearSupport.yearSpread > 3) || yearSupport?.noGenerationConflict === false
    );

  return {
    canShowExactYear,
    shouldPreferRange,
    canShowEstimatedYear,
    strongGenerationSupport,
    noNearbyConflict,
  };
}

function resolveDisplayYearLabel(input: {
  rawYear: number | null;
  confidence: number | null;
  yearRange: GroundedYearRange | null;
  exactGroundedYear: number | null;
  vehicle: NormalizedVehicle;
  yearSupport?: VehicleYearSupport | null;
}) {
  if (input.vehicle.source === "ocr_override" && typeof input.rawYear === "number") {
    return `${input.rawYear}`;
  }
  const rangeLabel = buildYearRangeLabel(input.yearRange);
  const isWrangler = isWranglerFamily(input.vehicle);
  const wranglerGeneration = isWrangler
    ? resolveWranglerGeneration({
        rawYear: input.rawYear,
        confidence: input.confidence,
        yearRange: input.yearRange,
        exactGroundedYear: input.exactGroundedYear,
        groundedMatchType: input.vehicle.groundedMatchType,
        groundedCandidateCount: input.vehicle.groundedCandidateCount,
      })
    : null;
  const yearDecision = getYearConfidenceDecision(input);

  if (
    yearDecision.canShowExactYear &&
    (!isWrangler || wranglerGeneration?.compatible !== false)
  ) {
    return `${input.rawYear}`;
  }

  if (isWrangler && wranglerGeneration?.generation) {
    return null;
  }

  if (
    rangeLabel &&
    input.yearRange &&
    input.yearRange.start !== input.yearRange.end &&
    yearDecision.shouldPreferRange &&
    (!isWrangler || wranglerGeneration?.compatible !== false)
  ) {
    return rangeLabel;
  }

  if (typeof input.rawYear === "number" && yearDecision.canShowEstimatedYear) {
    return `${input.rawYear} (est.)`;
  }

  if (rangeLabel && yearDecision.strongGenerationSupport) {
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

function isRiskSensitiveTrimFamily(vehicle: Pick<NormalizedVehicle, "make" | "model">) {
  const make = vehicle.make.toLowerCase();
  const model = vehicle.model.toLowerCase();
  const combined = `${make} ${model}`;
  return (
    isWranglerFamily(vehicle) ||
    /(f150|f250|f350|silverado|sierra|ram|tacoma|tundra|colorado|canyon|ranger)/.test(combined) ||
    /(mustang|camaro|challenger|charger|corvette)/.test(combined)
  );
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
    const generation = resolveWranglerGeneration({
      rawYear: input.vehicle.year,
      confidence: input.confidence,
      yearRange: input.vehicle.groundedYearRange,
      exactGroundedYear: input.vehicle.groundedExactYear,
      groundedMatchType: input.vehicle.groundedMatchType,
      groundedCandidateCount: input.vehicle.groundedCandidateCount,
    });
    if (!generation.generation || generation.compatible === false || confidence < 0.88) {
      return null;
    }
    if (groundedTrimText.includes("willys") || rawTrimText.includes("willys")) {
      return confidence >= 0.9 ? "Willys" : null;
    }
    if (groundedTrimText.includes("rubicon") || rawTrimText.includes("rubicon")) {
      return confidence >= 0.97 ? "Rubicon" : null;
    }
    return null;
  }

  if (isRiskSensitiveTrimFamily(input.vehicle)) {
    if (groundedTrim && groundedTrimText === rawTrimText && confidence >= 0.95) {
      return groundedTrim;
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
    const baseVehicle: NormalizedVehicle = {
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
      groundedCandidateCount: null,
      groundedExactYear: null,
    };
    const wranglerGeneration = isWranglerFamily(baseVehicle)
      ? resolveWranglerGeneration({
          rawYear: baseVehicle.year,
          confidence: baseVehicle.confidence,
          yearRange: baseVehicle.groundedYearRange,
          exactGroundedYear: baseVehicle.groundedExactYear,
          groundedMatchType: baseVehicle.groundedMatchType,
          groundedCandidateCount: baseVehicle.groundedCandidateCount,
        })
      : null;
    return {
      ...baseVehicle,
      wranglerGeneration: wranglerGeneration?.generation ?? null,
      wranglerGenerationLabel: wranglerGeneration?.label ?? null,
      wranglerGenerationCompatible: wranglerGeneration?.compatible ?? null,
      displayTitleLabel: buildDisplayTitleLabel({
        ...baseVehicle,
        wranglerGeneration: wranglerGeneration?.generation ?? null,
        wranglerGenerationLabel: wranglerGeneration?.label ?? null,
        wranglerGenerationCompatible: wranglerGeneration?.compatible ?? null,
      }),
    };
  }

  const groundedVehicle = grounding.vehicle;
  const provisionalVehicle: NormalizedVehicle = {
    ...vehicle,
    id: vehicle.id || (grounding.matchType === "id" || grounding.matchType === "exact" ? groundedVehicle.id : null),
    make: groundedVehicle.make || vehicle.make,
    model: groundedVehicle.model || vehicle.model,
    trim: groundedVehicle.trim || vehicle.trim,
    groundedYearRange: grounding.yearRange,
    groundedMatchType: grounding.matchType,
    groundedCandidateCount: grounding.candidateCount,
    groundedExactYear: groundedVehicle.year,
    displayTrimLabel: vehicle.displayTrimLabel,
    displayYearLabel: vehicle.displayYearLabel,
    displayTitleLabel: vehicle.displayTitleLabel,
    wranglerGeneration: null,
    wranglerGenerationLabel: null,
    wranglerGenerationCompatible: null,
  };
  const wranglerGeneration = isWranglerFamily(provisionalVehicle)
    ? resolveWranglerGeneration({
        rawYear: vehicle.year,
        confidence: vehicle.confidence,
        yearRange: grounding.yearRange,
        exactGroundedYear: groundedVehicle.year,
        groundedMatchType: grounding.matchType,
        groundedCandidateCount: grounding.candidateCount,
      })
    : null;
  const allowWranglerGrounding = !isWranglerFamily(provisionalVehicle) || wranglerGeneration?.compatible !== false;
  const groundedVehicleForDisplay = allowWranglerGrounding ? groundedVehicle : null;
  const groundedRangeForDisplay = allowWranglerGrounding ? grounding.yearRange : null;
  const groundedMatchTypeForDisplay = allowWranglerGrounding ? grounding.matchType : null;
  const groundedCandidateCountForDisplay = allowWranglerGrounding ? grounding.candidateCount : null;
  const vehicleForDisplay: NormalizedVehicle = {
    ...vehicle,
    id:
      vehicle.id ||
      (allowWranglerGrounding && (grounding.matchType === "id" || grounding.matchType === "exact") ? groundedVehicle.id : null),
    make: groundedVehicle.make || vehicle.make,
    model: groundedVehicle.model || vehicle.model,
    trim: allowWranglerGrounding && groundedVehicleForDisplay?.trim ? groundedVehicleForDisplay.trim : vehicle.trim,
    groundedYearRange: groundedRangeForDisplay,
    groundedMatchType: groundedMatchTypeForDisplay,
    groundedCandidateCount: groundedCandidateCountForDisplay,
    groundedExactYear: allowWranglerGrounding ? groundedVehicle.year : null,
    displayTrimLabel: null,
    displayYearLabel: null,
    displayTitleLabel: null,
    wranglerGeneration: wranglerGeneration?.generation ?? null,
    wranglerGenerationLabel: wranglerGeneration?.label ?? null,
    wranglerGenerationCompatible: wranglerGeneration?.compatible ?? null,
  };
  const displayTrimLabel = resolveDisplayTrimLabel({
    vehicle: vehicleForDisplay,
    groundedTrim: groundedVehicleForDisplay?.trim || null,
    confidence: vehicle.confidence,
  });
  const displayYearLabel = resolveDisplayYearLabel({
    rawYear: vehicle.year,
    confidence: vehicle.confidence,
    yearRange: groundedRangeForDisplay,
    exactGroundedYear: allowWranglerGrounding ? groundedVehicle.year : null,
    vehicle: vehicleForDisplay,
  });
  const resolvedVehicle = {
    ...vehicleForDisplay,
    displayTrimLabel,
    displayYearLabel,
  };
  return {
    ...resolvedVehicle,
    displayTitleLabel: buildDisplayTitleLabel(resolvedVehicle),
  };
}

function canRenderEstimatedDetail(vehicle: NormalizedVehicle) {
  const makeKnown = vehicle.make.trim().toLowerCase() !== "unknown";
  const modelKnown = vehicle.model.trim().toLowerCase() !== "vehicle";
  const confidence = vehicle.confidence ?? 0;
  const groundedSupport = Boolean(vehicle.groundedYearRange || vehicle.groundedMatchType);
  return makeKnown && modelKnown && (confidence >= 0.8 || (groundedSupport && confidence >= 0.72));
}

function getWranglerGenerationSortScore(vehicle: NormalizedVehicle) {
  if (!isWranglerFamily(vehicle)) {
    return 0;
  }
  if (vehicle.wranglerGenerationCompatible === false) {
    return -3;
  }
  if (vehicle.wranglerGeneration) {
    return 3;
  }
  if (vehicle.groundedMatchType === "id" || vehicle.groundedMatchType === "exact") {
    return 2;
  }
  return 0;
}

function getYearConsistencySortScore(vehicle: NormalizedVehicle) {
  const yearDecision = getYearConfidenceDecision({
    rawYear: vehicle.year,
    confidence: vehicle.confidence,
    yearRange: vehicle.groundedYearRange,
    exactGroundedYear: vehicle.groundedExactYear,
    vehicle,
  });
  if (yearDecision.canShowExactYear) {
    return 4;
  }
  if (yearDecision.shouldPreferRange) {
    return 3;
  }
  if (yearDecision.canShowEstimatedYear) {
    return 1;
  }
  if (vehicle.groundedYearRange) {
    return -1;
  }
  return 0;
}

function resolveResultSubtitle(vehicle: NormalizedVehicle) {
  if (vehicle.displayTrimLabel) {
    return vehicle.displayTrimLabel;
  }
  if (isWranglerFamily(vehicle)) {
    return vehicle.wranglerGeneration ? "Trim not confidently supported" : "Generation still being verified";
  }
  if (vehicle.trim && (vehicle.confidence ?? 0) >= 0.9) {
    return vehicle.trim;
  }
  return "Likely model family";
}

function buildEstimateDetailId(scanId: string | null | undefined, vehicle: NormalizedVehicle) {
  const suffix = [scanId ?? null, vehicle.make, vehicle.model, vehicle.displayYearLabel ?? null]
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .join(":")
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `estimate:${suffix || "vehicle"}`;
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

  const initiallyRankedCandidates = [...candidates].sort((left, right) => {
    const leftWranglerGeneration = getWranglerGenerationSortScore(left);
    const rightWranglerGeneration = getWranglerGenerationSortScore(right);
    if (leftWranglerGeneration !== rightWranglerGeneration) {
      return rightWranglerGeneration - leftWranglerGeneration;
    }

    const leftYearConsistency = getYearConsistencySortScore(left);
    const rightYearConsistency = getYearConsistencySortScore(right);
    if (leftYearConsistency !== rightYearConsistency) {
      return rightYearConsistency - leftYearConsistency;
    }

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

  const yearSupportMap = buildYearSupportMap(initiallyRankedCandidates);
  const mappedCandidates = initiallyRankedCandidates.map((candidate) => {
    const yearSupport = yearSupportMap.get(buildVehicleFamilyKey(candidate)) ?? null;
    const displayYearLabel = resolveDisplayYearLabel({
      rawYear: candidate.year,
      confidence: candidate.confidence,
      yearRange: candidate.groundedYearRange,
      exactGroundedYear: candidate.groundedExactYear,
      vehicle: candidate,
      yearSupport,
    });
    const resolvedCandidate = {
      ...candidate,
      displayYearLabel,
    };
    return {
      ...resolvedCandidate,
      displayTitleLabel: buildDisplayTitleLabel(resolvedCandidate),
    };
  });

  const leadingCandidate = mappedCandidates[0] ?? null;
  const promotedModernCandidate =
    leadingCandidate && isModernMainstreamFamily(leadingCandidate)
      ? (() => {
          const support = yearSupportMap.get(buildVehicleFamilyKey(leadingCandidate)) ?? null;
          if (!support?.stableFamily || support.yearSpread == null || support.yearSpread > 3 || !support.noGenerationConflict) {
            return null;
          }
          const familyKey = buildVehicleFamilyKey(leadingCandidate);
          const leadingConfidence = leadingCandidate.confidence ?? 0;
          const closeFamilyCandidates = mappedCandidates.filter(
            (candidate) =>
              buildVehicleFamilyKey(candidate) === familyKey &&
              Math.abs((candidate.confidence ?? 0) - leadingConfidence) <= 0.08,
          );
          if (closeFamilyCandidates.length < 2) {
            return null;
          }
          return [...closeFamilyCandidates].sort((left, right) => {
            const yearDelta = (right.year ?? 0) - (left.year ?? 0);
            if (yearDelta !== 0) {
              return yearDelta;
            }
            return (right.confidence ?? 0) - (left.confidence ?? 0);
          })[0] ?? null;
        })()
      : null;
  const rankedCandidates = promotedModernCandidate
    ? [
        promotedModernCandidate,
        ...mappedCandidates.filter(
          (candidate) => buildCandidateBaseKey(candidate) !== buildCandidateBaseKey(promotedModernCandidate),
        ),
      ]
    : mappedCandidates;

  const matchedIdentifiedVehicle = rankedCandidates.find((candidate) => candidate.id === identifiedVehicle.id);
  const bestCandidate = rankedCandidates[0] ?? identifiedVehicle;
  const resolvedIdentifiedVehicleBase = matchedIdentifiedVehicle ?? bestCandidate;
  const identifiedYearSupport = yearSupportMap.get(buildVehicleFamilyKey(resolvedIdentifiedVehicleBase)) ?? null;
  const resolvedIdentifiedVehicle = {
    ...resolvedIdentifiedVehicleBase,
    displayYearLabel: resolveDisplayYearLabel({
      rawYear: resolvedIdentifiedVehicleBase.year,
      confidence: resolvedIdentifiedVehicleBase.confidence,
      yearRange: resolvedIdentifiedVehicleBase.groundedYearRange,
      exactGroundedYear: resolvedIdentifiedVehicleBase.groundedExactYear,
      vehicle: resolvedIdentifiedVehicleBase,
      yearSupport: identifiedYearSupport,
    }),
  };

  return {
    ...normalizedScan,
    identifiedVehicle: {
      ...resolvedIdentifiedVehicle,
      displayTitleLabel: buildDisplayTitleLabel(resolvedIdentifiedVehicle),
    },
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
    feedbackMessage,
    errorMessage,
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
    source: null,
    displayTrimLabel: null,
    displayTitleLabel: null,
    confidence: null,
    thumbnailUrl: null,
    displayYearLabel: null,
    groundedYearRange: null,
    groundedMatchType: null,
    groundedCandidateCount: null,
    groundedExactYear: null,
    wranglerGeneration: null,
    wranglerGenerationLabel: null,
    wranglerGenerationCompatible: null,
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
      ? { pill: "rgba(34,197,94,0.12)", text: "#7AF0A8", label: "#7AF0A8", dot: "#34D399" }
      : displayConfidenceScore >= 0.75
        ? { pill: "rgba(44,127,255,0.14)", text: Colors.premium, label: Colors.premium, dot: Colors.accent }
        : { pill: "rgba(100,116,139,0.18)", text: Colors.textSoft, label: Colors.textMuted, dot: Colors.textMuted };
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
  const bestMatchTitle = bestMatch.displayTitleLabel ?? [bestMatchYearLabel, bestMatch.make, bestMatch.model].filter(Boolean).join(" ");
  const bestMatchSubtitle = resolveResultSubtitle(bestMatch);
  const buildEstimateDetailParams = (vehicle: NormalizedVehicle) => ({
    id: buildEstimateDetailId(normalized?.id, vehicle),
    estimate: "1",
    imageUri: normalized?.imageUri ?? "",
    scanId: normalized?.id ?? "",
    titleLabel: vehicle.displayTitleLabel ?? "",
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
      <AppContainer scroll={false} contentContainerStyle={styles.loadingScreen}>
        <View style={styles.loadingHeroCard}>
          <PremiumSkeleton height={250} radius={Radius.xl} />
          <View style={styles.loadingHeroCopy}>
            <Text style={styles.loadingEyebrow}>Vehicle report</Text>
            <Text style={styles.loadingText}>Building your premium match dossier</Text>
            <Text style={styles.loadingBody}>Preparing the image, confidence profile, and closest performance report modules.</Text>
          </View>
        </View>
        <View style={styles.loadingStack}>
          <PremiumSkeleton height={136} radius={Radius.xl} />
          <PremiumSkeleton height={124} radius={Radius.xl} />
          <PremiumSkeleton height={184} radius={Radius.xl} />
        </View>
        <ActivityIndicator size="small" color={Colors.accent} />
      </AppContainer>
    );
  }

  if (!scan || !normalized) {
    return (
      <AppContainer>
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
          {feedbackMessage ? <Text style={styles.feedbackNotice}>{feedbackMessage}</Text> : null}
          {errorMessage ? <Text style={styles.errorNotice}>{errorMessage}</Text> : null}
          
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
                <Text style={styles.subtitle}>{bestMatchSubtitle}</Text>
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
                {alternatives.length > 0 ? (
                  <PrimaryButton label="Explore Similar Matches" onPress={() => openVehicleDetail(alternatives[0], "estimated-alternative")} />
                ) : (
                  <PrimaryButton label="Refine With Another Photo" onPress={() => router.push("/(tabs)/scan")} />
                )}
                <PrimaryButton label="Scan Another Vehicle" secondary onPress={() => router.push("/(tabs)/scan")} />
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
                  {Math.max(0, freeUnlocksUsed)} of {freeUnlocksLimit} free unlocks used • {Math.max(0, freeUnlocksRemaining)} remaining
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
                      const result = await useFreeUnlockForVehicle(bestMatch.id);
                      if (result.ok) {
                        await refreshStatus();
                        Alert.alert("Free unlock applied", result.message);
                        openVehicleDetail(bestMatch, "free-unlock-continue");
                      } else {
                        Alert.alert("Unlock unavailable", result.message || errorMessage || "We couldn’t apply your free unlock right now.");
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
                    displayTitleLabel: candidate.displayTitleLabel ?? undefined,
                    make: candidate.make,
                    model: candidate.model,
                    trim: candidate.displayTrimLabel ? candidate.displayTrimLabel : undefined,
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
    backgroundColor: "rgba(44, 127, 255, 0.14)",
    borderColor: Colors.accentGlow,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 2,
  },
  quickResultBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    borderColor: Colors.cyanGlow,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 2,
  },
  quickResultBadgeText: { ...Typography.caption, color: Colors.premium, fontWeight: "700" },
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
  feedbackNotice: { ...Typography.caption, color: Colors.textMuted },
  errorNotice: { ...Typography.caption, color: Colors.dangerSoft },
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
  loadingScreen: { flex: 1, gap: 18, justifyContent: "center" },
  loadingHeroCard: { ...cardStyles.primaryTint, gap: 16, padding: 18 },
  loadingHeroCopy: { gap: 8 },
  loadingEyebrow: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 1.2 },
  loadingText: { ...Typography.title, color: Colors.textStrong },
  loadingBody: { ...Typography.body, color: Colors.textSoft },
  loadingStack: { gap: 14 },
});
