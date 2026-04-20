import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Image, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AppContainer } from "@/components/AppContainer";
import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { ListingCard } from "@/components/ListingCard";
import { LockedContentPreview } from "@/components/LockedContentPreview";
import { PrimaryButton } from "@/components/PrimaryButton";
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
import { ScanUsageMeter } from "@/components/ScanUsageMeter";
import { SectionHeader } from "@/components/SectionHeader";
import { SegmentedTabBar } from "@/components/SegmentedTabBar";
import { ValueEstimateCard } from "@/components/ValueEstimateCard";
import { Colors, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";
import { useSubscription } from "@/hooks/useSubscription";
import { formatHorsepowerLabel } from "@/lib/vehicleData";
import { mobileEnv } from "@/lib/env";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { scanService } from "@/services/scanService";
import { buildVehicleSoftUnlockId, buildVehicleUnlockId } from "@/services/subscriptionService";
import { ListingsDebugMeta, VehicleLookupDescriptor, vehicleService } from "@/services/vehicleService";
import { ValuationResult, VehicleRecord } from "@/types";
import { formatCurrency } from "@/lib/utils";

const tabs = ["Overview", "Specs", "Value", "For Sale", "Photos"];
const defaultZip = "60610";
const defaultMileage = "18400";
const defaultCondition = "Excellent";
const conditionOptions = ["Poor", "Fair", "Good", "Very Good", "Excellent"];

type EstimateSupport = {
  groundedVehicleId: string | null;
  groundedVehicleDescriptor: VehicleLookupDescriptor | null;
  groundedYear: number | null;
  familyLabel: string | null;
  yearRangeLabel: string | null;
  specsSourceLabel: string | null;
  marketSourceLabel: string | null;
  groundedMatchType: string | null;
  candidateCount: number | null;
  msrpRangeLabel: string | null;
  hasSpecsData: boolean;
  hasMarketData: boolean;
  hasListingsData: boolean;
  trustedResult: boolean;
};

function isRealVehicleLookupId(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith("live:");
}

function buildEstimateLookupDescriptor(input: {
  year: number | null;
  make: string;
  model: string;
  trim?: string | null;
  vehicleType?: string | null;
  bodyStyle?: string | null;
}) {
  if (!input.year || !input.make || !input.model) {
    return null;
  }

  return {
    year: input.year,
    make: input.make,
    model: input.model,
    trim: input.trim ?? null,
    vehicleType: input.vehicleType === "motorcycle" ? "motorcycle" : "car",
    bodyStyle: input.bodyStyle ?? null,
    normalizedModel: input.model.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(),
  } satisfies VehicleLookupDescriptor;
}

function isCommonVehicleForDetailCheck(input: {
  make?: string | null;
  model?: string | null;
}) {
  const make = String(input.make ?? "")
    .trim()
    .toLowerCase();
  const model = String(input.model ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/-/g, " ");
  const family = `${make} ${model}`.trim();
  return [
    "honda cr v",
    "toyota corolla",
    "toyota camry",
    "honda civic",
    "honda accord",
    "toyota rav4",
    "ford f 150",
    "ford ranger",
    "bmw x3",
  ].includes(family);
}

type HorsepowerSupport = {
  label: string;
  value: string;
  numericValue: number | null;
  exact: boolean;
};

type ValueDebugStatus = "idle" | "requested" | "accepted" | "rejected";
type ValueDebugOrigin = "hydrated" | "recalculated" | "sticky_fallback";
type ValueTabFinalState = "value_available_strong" | "value_available_light" | "value_unavailable" | null;
type ForSaleTabFinalState = "listings_available_strong" | "listings_available_light" | "listings_unavailable" | null;
type HeroImagePolicy = {
  useResolvedImageInHero: boolean;
  artifactRisk: boolean;
  reason: string | null;
};

const mainstreamCoverageAggregate = new Map<string, {
  total: number;
  families: Map<string, number>;
}>();

function resetMainstreamGroundingCoverageAggregate() {
  mainstreamCoverageAggregate.clear();
  console.log("[vehicle-detail] MAINSTREAM_GROUNDING_COVERAGE_AGGREGATE_RESET", {
    scope: "current-app-session",
    resetAt: new Date().toISOString(),
  });
}

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

function hasStructuredValueEvidence(result: ValuationResult | null | undefined) {
  if (!result) {
    return false;
  }
  const rangeFields = [
    result.tradeInRange,
    result.privatePartyRange,
    result.dealerRetailRange,
  ];
  const midpointFields = [result.tradeIn, result.privateParty, result.dealerRetail];
  const hasRange = rangeFields.some((value) => !isUnavailableValue(value));
  const hasMidpoint = midpointFields.some((value) => !isUnavailableValue(value));
  const hasSourceLabel =
    typeof result.sourceLabel === "string" &&
    result.sourceLabel.trim().length > 0 &&
    result.sourceLabel !== "No live value source";
  return hasRange || hasMidpoint || hasSourceLabel;
}

function choosePreferredValuation(
  current: ValuationResult,
  next: ValuationResult,
  options?: {
    allowReplacement?: boolean;
  },
) {
  const currentHasEvidence = hasStructuredValueEvidence(current);
  const nextHasEvidence = hasStructuredValueEvidence(next);

  if (options?.allowReplacement) {
    if (nextHasEvidence) {
      return next;
    }
    return current;
  }

  if (currentHasEvidence && !nextHasEvidence) {
    return current;
  }

  return next;
}

function normalizeCondition(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function buildValueRequestKey(
  valueLookupInput: string | { vehicleId?: string | null; descriptor?: VehicleLookupDescriptor | null } | null,
  zip: string,
  mileage: string,
  condition: string,
) {
  if (!valueLookupInput) {
    return null;
  }

  return [
    typeof valueLookupInput === "string" ? valueLookupInput : valueLookupInput.vehicleId ?? "descriptor",
    zip.trim(),
    mileage.trim(),
    normalizeCondition(condition),
  ].join("|");
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

function formatYearRangeLabel(start?: number | null, end?: number | null) {
  if (!start && !end) {
    return null;
  }
  if (start && end) {
    return start === end ? `${start}` : `${start}-${end}`;
  }
  return `${start ?? end}`;
}

function isUnavailableValue(value: string | undefined | null) {
  return !value || value === "Unavailable";
}

function formatListingsModeLabel(mode?: ListingsDebugMeta["mode"] | null) {
  switch (mode) {
    case "exact_trim":
      return "exact trim";
    case "same_model_mixed_trims":
      return "same model mixed trims";
    case "adjacent_year_mixed_trims":
      return "adjacent year mixed trims";
    case "generation_fallback":
      return "generation fallback";
    case "similar_vehicle_fallback":
      return "similar vehicle fallback";
    default:
      return "none";
  }
}

function evaluateHeroImagePolicy(imageUri: string): HeroImagePolicy {
  const normalizedUri = imageUri.trim().toLowerCase();
  const screenshotLikeName =
    normalizedUri.includes("screenshot") ||
    normalizedUri.includes("screen_shot") ||
    normalizedUri.includes("screen-shot");

  if (screenshotLikeName) {
    return {
      useResolvedImageInHero: false,
      artifactRisk: true,
      reason: "screenshot-like-source-name",
    };
  }

  return {
    useResolvedImageInHero: true,
    artifactRisk: false,
    reason: null,
  };
}

function countBelievableValuePairs(result: ValuationResult) {
  const pairs = [
    [result.tradeIn, result.tradeInRange],
    [result.privateParty, result.privatePartyRange],
    [result.dealerRetail, result.dealerRetailRange],
  ] as const;

  return pairs.filter(([midpoint, range]) => !isUnavailableValue(midpoint) && !isUnavailableValue(range)).length;
}

function resolveValueUsefulness(result: ValuationResult) {
  const populatedPrimaryValues = [result.tradeIn, result.privateParty, result.dealerRetail].filter((value) => !isUnavailableValue(value)).length;
  const populatedRanges = [result.tradeInRange, result.privatePartyRange, result.dealerRetailRange].filter((value) => !isUnavailableValue(value)).length;
  const richModel = result.modelType === "provider_range" || result.modelType === "listing_derived";
  const believableValuePairs = countBelievableValuePairs(result);

  if (populatedPrimaryValues >= 2 && (populatedRanges >= 2 || richModel || believableValuePairs >= 2)) {
    return "value_available_strong" as const;
  }
  if (believableValuePairs >= 1) {
    return "value_available_light" as const;
  }
  if (populatedPrimaryValues >= 1 && (populatedRanges >= 1 || richModel)) {
    return "value_available_light" as const;
  }
  return "value_unavailable" as const;
}

function isBelievableListing(listing: VehicleRecord["listings"][number]) {
  const hasTitle = typeof listing.title === "string" && listing.title.trim().length > 0;
  const hasPrice = typeof listing.price === "string" && listing.price.trim().length > 0 && listing.price !== "Unavailable";
  const hasContext =
    hasTitle ||
    (typeof listing.dealer === "string" && listing.dealer.trim().length > 0) ||
    (typeof listing.location === "string" && listing.location.trim().length > 0);

  return hasPrice && hasContext;
}

function resolveListingsUsefulness(listings: VehicleRecord["listings"]) {
  const believableListings = listings.filter(isBelievableListing);

  if (believableListings.length >= 2) {
    return "listings_available_strong" as const;
  }
  if (believableListings.length >= 1) {
    return "listings_available_light" as const;
  }
  return "listings_unavailable" as const;
}

function hasResolvedSpecEvidence(vehicle: VehicleRecord | null, horsepowerSupport: HorsepowerSupport | null) {
  if (!vehicle) {
    return false;
  }

  return Boolean(
    vehicle.specs.horsepower ||
      horsepowerSupport?.numericValue ||
      (vehicle.specs.engine && vehicle.specs.engine !== "Unknown") ||
      (vehicle.specs.drivetrain && vehicle.specs.drivetrain !== "Unknown" && vehicle.specs.drivetrain !== "Unavailable") ||
      (vehicle.bodyStyle && vehicle.bodyStyle !== "Estimated vehicle") ||
      (vehicle.specs.mpgOrRange && vehicle.specs.mpgOrRange !== "Unknown") ||
      (typeof vehicle.specs.msrp === "number" && vehicle.specs.msrp > 0),
  );
}

function buildApproximateValuation(base: ValuationResult, familyLabel: string, yearRangeLabel?: string | null): ValuationResult {
  const familyContext = yearRangeLabel ? `${yearRangeLabel} ${familyLabel}` : familyLabel;
  return {
    ...base,
    sourceLabel: `Nearby market range for ${familyContext}`.trim(),
    confidenceLabel: `Market estimate based on nearby ${familyContext}`.trim(),
  };
}

function ApproximateDataState({
  title,
  body,
  supportNote,
  actionLabel,
  onAction,
  badgeLabel = "Availability",
  secondaryAction = true,
}: {
  title: string;
  body: string;
  supportNote?: string;
  actionLabel?: string;
  onAction?: () => void;
  badgeLabel?: string | null;
  secondaryAction?: boolean;
}) {
  return (
    <View style={styles.approximateStateCard}>
      {badgeLabel ? (
        <View style={styles.approximateStateBadge}>
          <Text style={styles.approximateStateBadgeLabel}>{badgeLabel}</Text>
        </View>
      ) : null}
      <Text style={styles.approximateStateTitle}>{title}</Text>
      <Text style={styles.approximateStateBody}>{body}</Text>
      {supportNote ? <Text style={styles.approximateStateSupport}>{supportNote}</Text> : null}
      {actionLabel && onAction ? <PrimaryButton label={actionLabel} secondary={secondaryAction} onPress={onAction} /> : null}
    </View>
  );
}

function isRiskSensitiveFamily(input: {
  make: string;
  model: string;
  vehicleType?: string | null;
  year?: number | null;
}) {
  const make = input.make.toLowerCase();
  const model = input.model.toLowerCase();
  const combined = `${make} ${model}`;
  const isClassic = typeof input.year === "number" && input.year > 0 && input.year < 1996;
  const isMotorcycle = (input.vehicleType ?? "").toLowerCase() === "motorcycle";
  const isRareExoticBrand = /ferrari|lamborghini|mclaren|aston martin|lotus|koenigsegg|pagani|rimac|bugatti|rolls royce|bentley/.test(make);
  const isRareExoticModel = /huracan|aventador|sf90|296 gtb|artura|senna|chiron|nevera|ghost|phantom|continental gt/.test(combined);
  return isClassic || isMotorcycle || isRareExoticBrand || isRareExoticModel;
}

function isMainstreamGroundingFriendlyFamily(input: {
  make: string;
  model: string;
}) {
  const make = input.make.toLowerCase();
  const model = input.model.toLowerCase();
  const combined = `${make} ${model}`;
  return (
    (make === "honda" && /(cr-v|crv|civic|accord)/.test(model)) ||
    (make === "toyota" && /(camry|rav4)/.test(model)) ||
    (make === "tesla" && /model 3/.test(model)) ||
    (make === "ford" && /(f-150|f150)/.test(combined)) ||
    ((make === "chevrolet" || make === "chevy") && /silverado/.test(model))
  );
}

function isTrustedResult(input: {
  confidence: number | null;
  make: string;
  model: string;
  vehicleType?: string | null;
  year?: number | null;
}) {
  return Boolean(
    typeof input.confidence === "number" &&
      input.confidence >= 0.9 &&
      !isRiskSensitiveFamily({
        make: input.make,
        model: input.model,
        vehicleType: input.vehicleType,
        year: input.year,
      }),
  );
}

function isCrvTraceTarget(input: {
  make?: string | null;
  model?: string | null;
}) {
  const make = String(input.make ?? "").trim().toLowerCase();
  const model = String(input.model ?? "").trim().toLowerCase();
  return make === "honda" && (model === "cr-v" || model === "crv" || model === "cr v");
}

function getMainstreamCoverageFamilyKey(input: {
  make: string;
  model: string;
}) {
  const make = input.make.toLowerCase();
  const model = input.model.toLowerCase();
  if (make === "honda" && /(cr-v|crv)/.test(model)) return "cr-v";
  if (make === "honda" && /civic/.test(model)) return "civic";
  if (make === "honda" && /accord/.test(model)) return "accord";
  if (make === "toyota" && /camry/.test(model)) return "camry";
  if (make === "toyota" && /rav4/.test(model)) return "rav4";
  if (make === "tesla" && /model 3/.test(model)) return "model-3";
  if (make === "ford" && /(f-150|f150)/.test(`${make} ${model}`)) return "f-150";
  if ((make === "chevrolet" || make === "chevy") && /silverado/.test(model)) return "silverado";
  return null;
}

function normalizeFamilyKey(input: {
  make: string;
  model: string;
}) {
  return `${String(input.make).trim().toLowerCase()}|${String(input.model).trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

function logMainstreamGroundingCoverage(input: {
  stage: "initial" | "final";
  scanId: string | null;
  familyKey: string | null;
  requestedYear: number | null;
  make: string;
  model: string;
  confidence: number | null;
  matchType: string | null;
  candidateCount: number | null;
  nearestYearDelta: number | null;
  groundedYearRangeLabel: string | null;
  familyLabel: string | null;
  strongFamilyFallback: boolean;
  strongMarketFallback: boolean;
  strongListingsFallback: boolean;
  familySafeSpecsShown: boolean;
  horsepowerShown: boolean;
  msrpRangeShown: boolean;
  valueShown: boolean;
  listingsShown: boolean;
}) {
  if (!input.familyKey) {
    return;
  }

  const conservativeReasons = [
    !input.strongFamilyFallback ? "family_threshold_blocked" : null,
    input.strongFamilyFallback && !input.familySafeSpecsShown ? "family_specs_missing" : null,
    input.familySafeSpecsShown && !input.horsepowerShown ? "horsepower_missing" : null,
    input.familySafeSpecsShown && !input.msrpRangeShown ? "msrp_missing" : null,
    !input.strongMarketFallback ? "market_threshold_blocked" : null,
    input.strongMarketFallback && !input.valueShown ? "market_data_missing" : null,
    !input.strongListingsFallback ? "listings_threshold_blocked" : null,
    input.strongListingsFallback && !input.listingsShown ? "listings_data_missing" : null,
  ].filter((reason): reason is string => Boolean(reason));

  const coverageSummary = [
    `specs=${input.familySafeSpecsShown ? "yes" : "no"}`,
    `horsepower=${input.horsepowerShown ? "yes" : "no"}`,
    `msrp=${input.msrpRangeShown ? "yes" : "no"}`,
    `value=${input.valueShown ? "yes" : "no"}`,
    `listings=${input.listingsShown ? "yes" : "no"}`,
  ].join(" ");

  const tuningHint = !input.strongFamilyFallback
    ? "threshold too strict"
    : input.familySafeSpecsShown && !input.horsepowerShown
      ? "horsepower fallback gap"
      : input.strongMarketFallback && !input.valueShown
        ? "market data missing"
        : input.strongListingsFallback && !input.listingsShown
          ? "listings data missing"
          : !input.strongMarketFallback || !input.strongListingsFallback
            ? "threshold too strict"
            : "coverage looks healthy";

  const aggregateKey = tuningHint;
  const currentAggregate = mainstreamCoverageAggregate.get(aggregateKey) ?? {
    total: 0,
    families: new Map<string, number>(),
  };
  currentAggregate.total += 1;
  currentAggregate.families.set(input.familyKey, (currentAggregate.families.get(input.familyKey) ?? 0) + 1);
  mainstreamCoverageAggregate.set(aggregateKey, currentAggregate);

  const aggregateSummary = [...mainstreamCoverageAggregate.entries()]
    .sort((left, right) => right[1].total - left[1].total)
    .map(([hint, data]) => ({
      tuningHint: hint,
      total: data.total,
      families: [...data.families.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([familyKey, count]) => ({ familyKey, count })),
    }));

  console.log("[vehicle-detail] MAINSTREAM_GROUNDING_COVERAGE", {
    stage: input.stage,
    coverageCase: `${input.familyKey} ${input.requestedYear ?? "unknown-year"} ${input.make} ${input.model}`.trim(),
    coverageSummary,
    tuningHint,
    scanId: input.scanId,
    familyKey: input.familyKey,
    requestedYear: input.requestedYear,
    make: input.make,
    model: input.model,
    confidence: input.confidence,
    matchType: input.matchType,
    candidateCount: input.candidateCount,
    nearestYearDelta: input.nearestYearDelta,
    groundedYearRangeLabel: input.groundedYearRangeLabel,
    familyLabel: input.familyLabel,
    coverage: {
      familySafeSpecsShown: input.familySafeSpecsShown,
      horsepowerShown: input.horsepowerShown,
      msrpRangeShown: input.msrpRangeShown,
      valueShown: input.valueShown,
      listingsShown: input.listingsShown,
    },
    thresholds: {
      strongFamilyFallback: input.strongFamilyFallback,
      strongMarketFallback: input.strongMarketFallback,
      strongListingsFallback: input.strongListingsFallback,
    },
    conservativeReasons,
  });

  console.log("[vehicle-detail] MAINSTREAM_GROUNDING_COVERAGE_AGGREGATE", {
    latestCase: `${input.familyKey} ${input.requestedYear ?? "unknown-year"} ${input.make} ${input.model}`.trim(),
    latestTuningHint: tuningHint,
    summary: aggregateSummary,
  });
}

function isStrongFamilyFallback(input: {
  matchType?: string | null;
  candidateCount?: number | null;
  requestedYear?: number | null;
  matchedYear?: number | null;
  riskyFamily?: boolean;
  mainstreamFriendly?: boolean;
}) {
  if (input.matchType === "id" || input.matchType === "exact") {
    return true;
  }
  if (input.matchType !== "model-family-range") {
    return false;
  }
  if (typeof input.requestedYear === "number" && typeof input.matchedYear === "number") {
    const maxYearDelta = input.riskyFamily ? 1 : input.mainstreamFriendly ? 3 : 2;
    return Math.abs(input.requestedYear - input.matchedYear) <= maxYearDelta;
  }
  const candidateCount = input.candidateCount ?? Number.POSITIVE_INFINITY;
  const maxCandidates = input.riskyFamily ? 1 : input.mainstreamFriendly ? 6 : 4;
  if (candidateCount < 1 || candidateCount > maxCandidates) {
    return false;
  }
  return input.mainstreamFriendly ? candidateCount <= 2 : !input.riskyFamily && candidateCount === 1;
}

function isStrongMarketFallback(input: {
  matchType?: string | null;
  candidateCount?: number | null;
  requestedYear?: number | null;
  matchedYear?: number | null;
  riskyFamily?: boolean;
  mainstreamFriendly?: boolean;
}) {
  if (input.matchType === "id" || input.matchType === "exact") {
    return true;
  }
  if (input.matchType !== "model-family-range") {
    return false;
  }
  const candidateCount = input.candidateCount ?? Number.POSITIVE_INFINITY;
  const maxCandidates = input.mainstreamFriendly ? 2 : 1;
  if (candidateCount < 1 || candidateCount > maxCandidates) {
    return false;
  }
  if (typeof input.requestedYear === "number" && typeof input.matchedYear === "number") {
    const maxYearDelta = input.riskyFamily ? 0 : input.mainstreamFriendly ? 2 : 1;
    return Math.abs(input.requestedYear - input.matchedYear) <= maxYearDelta;
  }
  return false;
}

function isStrongListingsFallback(input: {
  matchType?: string | null;
  candidateCount?: number | null;
  requestedYear?: number | null;
  matchedYear?: number | null;
  riskyFamily?: boolean;
  mainstreamFriendly?: boolean;
}) {
  if (input.matchType === "id" || input.matchType === "exact") {
    return true;
  }
  if (input.matchType !== "model-family-range") {
    return false;
  }
  const candidateCount = input.candidateCount ?? Number.POSITIVE_INFINITY;
  const maxCandidates = input.mainstreamFriendly ? 2 : 1;
  if (candidateCount < 1 || candidateCount > maxCandidates) {
    return false;
  }
  if (typeof input.requestedYear !== "number" || typeof input.matchedYear !== "number") {
    return false;
  }
  const maxYearDelta = input.riskyFamily ? 0 : input.mainstreamFriendly ? 2 : 1;
  return Math.abs(input.requestedYear - input.matchedYear) <= maxYearDelta;
}

function mergeApproximateSpecs(
  groundedRecord: VehicleRecord | null,
  approximateSupport: Awaited<ReturnType<typeof offlineCanonicalService.resolveApproximateFamilySupport>> | null,
) {
  return {
    engine: approximateSupport?.sharedSpecs.engine ?? groundedRecord?.specs.engine ?? "Unavailable",
    horsepower: groundedRecord?.specs.horsepower ?? null,
    torque: groundedRecord?.specs.torque ?? "Unavailable",
    transmission: approximateSupport?.sharedSpecs.transmission ?? groundedRecord?.specs.transmission ?? "Unavailable",
    drivetrain: approximateSupport?.sharedSpecs.drivetrain ?? groundedRecord?.specs.drivetrain ?? "Unavailable",
    mpgOrRange: approximateSupport?.sharedSpecs.mpgOrRange ?? groundedRecord?.specs.mpgOrRange ?? "Unavailable",
    exteriorColors: groundedRecord?.specs.exteriorColors ?? [],
    msrp:
      approximateSupport?.msrpRangeLabel && approximateSupport.msrpRangeLabel.includes(" - ")
        ? 0
        : groundedRecord?.specs.msrp ?? 0,
  };
}

function shouldShowEstimatedTrim(input: {
  trim: string;
  confidence: number;
  matchType?: string | null;
  strongFamilyFallback: boolean;
  make: string;
  model: string;
  vehicleType?: string | null;
  year?: number | null;
  trustedResult?: boolean;
}) {
  if (!input.trim.trim()) {
    return false;
  }
  if (input.trustedResult) {
    return false;
  }
  const riskyFamily = isRiskSensitiveFamily(input);
  if (riskyFamily) {
    return input.confidence >= 0.98 && (input.matchType === "id" || input.matchType === "exact");
  }
  return input.confidence >= 0.93 && input.strongFamilyFallback && (input.matchType === "id" || input.matchType === "exact");
}

export default function VehicleDetailScreen() {
  const { id, imageUri, scanId, estimate, titleLabel, yearLabel, make, model, trimLabel, vehicleType, confidence, unlockId, garageSource, reopenedSource, trustedCase, resultSource } = useLocalSearchParams<{
    id: string;
    imageUri?: string;
    scanId?: string;
    estimate?: string;
    titleLabel?: string;
    yearLabel?: string;
    make?: string;
    model?: string;
    trimLabel?: string;
    vehicleType?: string;
    confidence?: string;
    unlockId?: string;
    garageSource?: string;
    reopenedSource?: string;
    trustedCase?: string;
    resultSource?: string;
  }>();
  const [vehicle, setVehicle] = useState<VehicleRecord | null>(null);
  const [valuation, setValuation] = useState<ValuationResult>(createEmptyValuation());
  const [zipCode, setZipCode] = useState(defaultZip);
  const [mileage, setMileage] = useState(defaultMileage);
  const [condition, setCondition] = useState(defaultCondition);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [valueDebugStatus, setValueDebugStatus] = useState<ValueDebugStatus>("idle");
  const [valueDebugOrigin, setValueDebugOrigin] = useState<ValueDebugOrigin>("hydrated");
  const [valueDebugUpdateCount, setValueDebugUpdateCount] = useState(0);
  const [valueDebugUpdatedAt, setValueDebugUpdatedAt] = useState<string | null>(null);
  const [listingsDebugMeta, setListingsDebugMeta] = useState<ListingsDebugMeta | null>(null);
  const [tab, setTab] = useState("Overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedImageUri, setResolvedImageUri] = useState<string | null>(typeof imageUri === "string" && imageUri.trim().length > 0 ? imageUri : null);
  const [imageSourceLabel, setImageSourceLabel] = useState<string>(typeof imageUri === "string" && imageUri.trim().length > 0 ? "scanned photo (route param)" : "provider/generic");
  const [heroImagePolicy, setHeroImagePolicy] = useState<HeroImagePolicy>({
    useResolvedImageInHero: true,
    artifactRisk: false,
    reason: null,
  });
  const [estimateSupport, setEstimateSupport] = useState<EstimateSupport | null>(null);
  const [horsepowerSupport, setHorsepowerSupport] = useState<HorsepowerSupport | null>(null);
  const [heroPreviewOpen, setHeroPreviewOpen] = useState(false);
  const previousConditionRef = useRef<string | null>(null);
  const previousValueRef = useRef<string | null>(null);
  const strongestValuationRef = useRef<ValuationResult>(createEmptyValuation());
  const lastValueRequestKeyRef = useRef<string | null>(null);
  const pendingValueRequestKeyRef = useRef<string | null>(null);
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroTranslate = useRef(new Animated.Value(12)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(16)).current;
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
    unlockedVehicleIds,
  } = useSubscription();
  const unlockFailureTitle = (reason?: string) => (reason === "payload_too_thin" ? "Unlock protected" : "Unlock unavailable");
  const isEstimateMode = estimate === "1" || id.startsWith("estimate:");
  const showQaDebugStrip = mobileEnv.appEnv !== "production" || mobileEnv.showQaDebug === "1";
  const isPro = usage?.plan === "pro";
  const resolvedUnlockId =
    (typeof unlockId === "string" && unlockId.trim().length > 0
      ? unlockId
      : buildVehicleUnlockId({
          vehicleId: !isEstimateMode ? (vehicle?.id ?? id) : null,
          scanId: typeof scanId === "string" ? scanId : null,
          year: vehicle?.year || (typeof yearLabel === "string" ? yearLabel : null),
          groundedYear: estimateSupport?.groundedYear ?? null,
          make: vehicle?.make || (typeof make === "string" ? make : null),
          model: vehicle?.model || (typeof model === "string" ? model : null),
          trim: vehicle?.trim || (typeof trimLabel === "string" ? trimLabel : null),
          vehicleType: typeof vehicleType === "string" ? vehicleType : null,
          groundedMatchType: estimateSupport?.groundedMatchType ?? null,
        })) ?? null;
  const resolvedSoftUnlockId = buildVehicleSoftUnlockId({
    make: vehicle?.make || (typeof make === "string" ? make : null),
    model: vehicle?.model || (typeof model === "string" ? model : null),
    vehicleType: typeof vehicleType === "string" ? vehicleType : null,
    year: vehicle?.year || (typeof yearLabel === "string" ? yearLabel : null),
    trusted:
      trustedCase === "1" ||
      Boolean(
        isEstimateMode &&
          isTrustedResult({
            confidence: Number.isFinite(Number.parseFloat(typeof confidence === "string" ? confidence : "")) ? Number.parseFloat(typeof confidence === "string" ? confidence : "") : null,
            make: vehicle?.make || (typeof make === "string" ? make : ""),
            model: vehicle?.model || (typeof model === "string" ? model : ""),
            vehicleType: typeof vehicleType === "string" ? vehicleType : null,
            year: vehicle?.year || Number.parseInt(typeof yearLabel === "string" ? yearLabel : "", 10) || null,
          }),
      ),
  });
  const unlockedForVehicle = resolvedUnlockId
    ? isVehicleUnlocked(resolvedUnlockId) || (resolvedSoftUnlockId ? isVehicleUnlocked(resolvedSoftUnlockId) : false)
    : resolvedSoftUnlockId
      ? isVehicleUnlocked(resolvedSoftUnlockId)
      : false;
  const accessState: "locked" | "unlocked" = isPro || unlockedForVehicle ? "unlocked" : "locked";
  const hasFullAccess = accessState === "unlocked";
  const isLocked = accessState === "locked";
  const trustedResult = Boolean(
    (trustedCase === "1") ||
      (isEstimateMode &&
      isTrustedResult({
        confidence: Number.isFinite(Number.parseFloat(typeof confidence === "string" ? confidence : "")) ? Number.parseFloat(typeof confidence === "string" ? confidence : "") : null,
        make: vehicle?.make || (typeof make === "string" ? make : ""),
        model: vehicle?.model || (typeof model === "string" ? model : ""),
        vehicleType: typeof vehicleType === "string" ? vehicleType : null,
        year: vehicle?.year || Number.parseInt(typeof yearLabel === "string" ? yearLabel : "", 10) || null,
      })),
  );
  const finalDisplayIdentity = {
    titleLabel:
      typeof titleLabel === "string" && titleLabel.trim().length > 0
        ? titleLabel
        : [vehicle?.year ? `${vehicle.year}` : null, vehicle?.make ?? null, vehicle?.model ?? null].filter(Boolean).join(" "),
    yearLabel:
      typeof yearLabel === "string" && yearLabel.trim().length > 0
        ? yearLabel.replace(/\s*\(est\.\)\s*/i, "").trim()
        : vehicle?.year
          ? `${vehicle.year}`
          : "",
    make: typeof make === "string" && make.trim().length > 0 ? make : vehicle?.make ?? "",
    model: typeof model === "string" && model.trim().length > 0 ? model : vehicle?.model ?? "",
    trimLabel: typeof trimLabel === "string" && trimLabel.trim().length > 0 ? trimLabel : vehicle?.trim ?? "",
    confidence: typeof confidence === "string" ? confidence : "",
    trustedCase: trustedResult,
    source: typeof resultSource === "string" ? resultSource : "",
  };
  const resolvedDisplayTitle =
    finalDisplayIdentity.titleLabel ||
    [finalDisplayIdentity.yearLabel || null, finalDisplayIdentity.make || null, finalDisplayIdentity.model || null]
      .filter(Boolean)
      .join(" ") ||
    `${vehicle?.year ?? ""} ${vehicle?.make ?? ""} ${vehicle?.model ?? ""}`.trim();
  const resolvedDisplayBodyStyle = vehicle?.bodyStyle || (typeof vehicleType === "string" ? vehicleType : "") || "Vehicle";
  const resolvedDisplayTrim = trustedResult ? "" : finalDisplayIdentity.trimLabel || vehicle?.trim || "";
  const estimateSubtitle = isEstimateMode
    ? [
        trustedResult ? "High-confidence identification" : "Photo-based identification",
        resolvedDisplayBodyStyle || null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" • ")
    : null;
  const lockedEyebrow = isEstimateMode
    ? trustedResult
      ? "High-confidence identification"
      : "Vehicle identification"
    : "Vehicle dossier";
  const unlockedDetailSubtitle = isEstimateMode
    ? trustedResult
      ? "High-confidence identification"
      : "Vehicle identification"
    : [resolvedDisplayTrim || null, resolvedDisplayBodyStyle || null].filter(Boolean).join(" • ");

  const summaryChips = useMemo(() => {
    const chips = [
      isEstimateMode
        ? trustedResult
          ? finalDisplayIdentity.yearLabel || null
          : estimateSupport?.yearRangeLabel || (typeof yearLabel === "string" && yearLabel.trim().length > 0 ? yearLabel : null)
        : finalDisplayIdentity.yearLabel || (vehicle ? `${vehicle.year}` : null),
      vehicle?.bodyStyle || null,
      horsepowerSupport?.value || (vehicle?.specs.horsepower ? formatHorsepowerLabel(vehicle.specs.horsepower) : null),
      vehicle?.specs.drivetrain && vehicle.specs.drivetrain !== "Unavailable" ? vehicle.specs.drivetrain : null,
      vehicle?.specs.msrp && vehicle.specs.msrp > 0 ? formatCurrency(vehicle.specs.msrp) : null,
    ].filter((entry): entry is string => Boolean(entry));
    return chips.slice(0, 4);
  }, [estimateSupport?.yearRangeLabel, finalDisplayIdentity.yearLabel, horsepowerSupport?.value, isEstimateMode, trustedResult, vehicle, yearLabel]);
  const applyValuationUpdate = useCallback(
    (
      next: ValuationResult,
      reason: string,
      options?: {
        allowReplacement?: boolean;
      },
    ) => {
      setValuation((current) => {
        const preferred = choosePreferredValuation(current, next, options);
        strongestValuationRef.current = choosePreferredValuation(strongestValuationRef.current, preferred, options);
        const nextOrigin: ValueDebugOrigin =
          reason === "value-refresh-success"
            ? "recalculated"
            : !hasStructuredValueEvidence(next) && hasStructuredValueEvidence(strongestValuationRef.current)
              ? "sticky_fallback"
              : "hydrated";
        setValueDebugOrigin(nextOrigin);
        setValueDebugUpdateCount((currentCount) => currentCount + 1);
        setValueDebugUpdatedAt(new Date().toISOString());
        if (__DEV__) {
          console.log("[vehicle-detail] VEHICLE_VALUE_INITIAL", {
            routeId: id,
            scanId: typeof scanId === "string" ? scanId : null,
            reason,
            nextValue: next,
            currentValue: current,
            chosenValue: preferred,
            allowReplacement: Boolean(options?.allowReplacement),
            fallbackUiWouldBeChosen: !hasStructuredValueEvidence(preferred),
          });
        }
        return preferred;
      });
    },
    [id, scanId],
  );
  const displayValuation = hasStructuredValueEvidence(valuation) ? valuation : strongestValuationRef.current;
  const displayedValueOrigin: ValueDebugOrigin =
    !hasStructuredValueEvidence(valuation) && hasStructuredValueEvidence(strongestValuationRef.current)
      ? "sticky_fallback"
      : valueDebugOrigin;
  const hasApproximateValue = hasStructuredValueEvidence(displayValuation);
  const hasBelievableListings = (vehicle?.listings ?? []).some(isBelievableListing);
  const trustedUnlockedConfidence = Number.parseFloat(typeof confidence === "string" ? confidence : "");
  const unlockConfirmationRequired =
    isEstimateMode || (Number.isFinite(trustedUnlockedConfidence) && trustedUnlockedConfidence < 0.85);
  const confirmUnlockIfNeeded = async () => {
    if (!unlockConfirmationRequired) {
      return true;
    }
    const message = isEstimateMode
      ? "This vehicle is an estimate. Unlock anyway?"
      : "This result is lower confidence. Unlock anyway?";
    return await new Promise<boolean>((resolve) => {
      Alert.alert("Confirm unlock", message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Unlock", onPress: () => resolve(true) },
      ]);
    });
  };
  const trustedUnlockedYear = vehicle?.year || Number.parseInt(typeof yearLabel === "string" ? yearLabel : "", 10) || null;
  const trustedUnlockedMake = vehicle?.make || (typeof make === "string" ? make : "");
  const trustedUnlockedModel = vehicle?.model || (typeof model === "string" ? model : "");
  const unlockedEstimateCase = Boolean(isEstimateMode && hasFullAccess);
  const trustedUnlockedCase = Boolean(unlockedEstimateCase && trustedResult);
  const trustedValueAvailable = Boolean(unlockedEstimateCase && hasApproximateValue);
  const trustedListingsAvailable = Boolean(unlockedEstimateCase && hasBelievableListings);
  const resolvedSpecsAvailable = hasResolvedSpecEvidence(vehicle, horsepowerSupport);
  const valueTabFinalState: ValueTabFinalState = unlockedEstimateCase
    ? trustedValueAvailable
      ? resolveValueUsefulness(displayValuation)
      : "value_unavailable"
    : null;
  const forSaleTabFinalState: ForSaleTabFinalState = unlockedEstimateCase
    ? trustedListingsAvailable
      ? resolveListingsUsefulness(vehicle?.listings ?? [])
      : "listings_unavailable"
    : null;
  const isTrustedUnlockedEstimate = trustedUnlockedCase;
  const listingsSourceLabel =
    listingsDebugMeta?.sourceLabel ??
    (forSaleTabFinalState === "listings_available_light"
      ? "Nearby listings for this model"
      : vehicle?.listings.length
        ? estimateSupport?.marketSourceLabel ?? "Comparable listings"
        : null);
  const believableListingsCount = (vehicle?.listings ?? []).filter(isBelievableListing).length;
  const valueQaRows = [
    { label: "Value source", value: displayValuation.sourceLabel ?? "none" },
    { label: "ZIP", value: zipCode || "unset" },
    { label: "Mileage", value: mileage || "unset" },
    { label: "Condition", value: condition || "unset" },
    { label: "Recalc status", value: valueDebugStatus },
    { label: "Updated", value: valueDebugUpdatedAt ? `${valueDebugUpdateCount} • ${new Date(valueDebugUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : `${valueDebugUpdateCount}` },
    { label: "Value origin", value: displayedValueOrigin.replace("_", " ") },
  ];
  const listingsQaRows = [
    { label: "Listings source", value: listingsSourceLabel ?? "none" },
    { label: "Raw count", value: String(listingsDebugMeta?.rawCount ?? vehicle?.listings.length ?? 0) },
    { label: "Believable", value: String(listingsDebugMeta?.believableCount ?? believableListingsCount) },
    { label: "Fallback shown", value: forSaleTabFinalState === "listings_unavailable" ? "yes" : "no" },
    { label: "Listings mode", value: formatListingsModeLabel(listingsDebugMeta?.mode) },
  ];

  useEffect(() => {
    if (__DEV__) {
      console.log("[vehicle-detail] VEHICLE_UNLOCK_RESOLUTION", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        unlockId: resolvedUnlockId,
        unlocked: hasFullAccess,
        garageSource: garageSource === "1",
        reopenedSource: reopenedSource === "1",
        estimateMode: isEstimateMode,
      });
    }
  }, [garageSource, hasFullAccess, id, isEstimateMode, reopenedSource, resolvedUnlockId, scanId]);

  useEffect(() => {
    strongestValuationRef.current = createEmptyValuation();
    lastValueRequestKeyRef.current = null;
    pendingValueRequestKeyRef.current = null;
    previousConditionRef.current = null;
    previousValueRef.current = null;
    setValueDebugStatus("idle");
    setValueDebugOrigin("hydrated");
    setValueDebugUpdateCount(0);
    setValueDebugUpdatedAt(null);
    setListingsDebugMeta(null);
  }, [id, scanId]);

  useEffect(() => {
    if (__DEV__) {
      console.log("[vehicle-detail] VEHICLE_UNLOCK_PERSISTENCE", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        unlockId: resolvedUnlockId,
        unlocked: hasFullAccess,
        garageSource: garageSource === "1",
        reopenedSource: reopenedSource === "1",
        persistedUnlockIds: unlockedVehicleIds.length,
      });
    }
  }, [garageSource, hasFullAccess, id, reopenedSource, resolvedUnlockId, scanId, unlockedVehicleIds.length]);

  useEffect(() => {
    if (garageSource !== "1") {
      return;
    }
    if (__DEV__) {
      console.log("[vehicle-detail] GARAGE_UNLOCK_RESOLUTION", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        unlockId: resolvedUnlockId,
        sourceType: isEstimateMode ? "estimate" : "catalog",
        opened: true,
        unlocked: hasFullAccess,
        garageSource: true,
      });
    }
  }, [garageSource, hasFullAccess, id, isEstimateMode, resolvedUnlockId, scanId]);

  useEffect(() => {
    if (tab !== "Value" || !valueTabFinalState) {
      return;
    }
    if (__DEV__) {
      console.log("[vehicle-detail] VALUE_TAB_FINAL_STATE", {
        confidence: Number.isFinite(trustedUnlockedConfidence) ? trustedUnlockedConfidence : null,
        unlocked: !isLocked,
        trustedCase: trustedUnlockedCase,
        finalDerivedState: valueTabFinalState,
        valueAvailable: trustedValueAvailable,
        renderedUnavailableCardsExpected: valueTabFinalState === "value_unavailable" ? 1 : 0,
      });
    }
  }, [isLocked, tab, trustedUnlockedCase, trustedUnlockedConfidence, trustedValueAvailable, valueTabFinalState]);

  useEffect(() => {
    if (tab !== "For Sale" || !forSaleTabFinalState) {
      return;
    }
    if (__DEV__) {
      console.log("[vehicle-detail] FOR_SALE_TAB_FINAL_STATE", {
        confidence: Number.isFinite(trustedUnlockedConfidence) ? trustedUnlockedConfidence : null,
        unlocked: !isLocked,
        trustedCase: trustedUnlockedCase,
        finalDerivedState: forSaleTabFinalState,
        listingsAvailable: trustedListingsAvailable,
        renderedUnavailableCardsExpected: forSaleTabFinalState === "listings_unavailable" ? 1 : 0,
      });
    }
  }, [forSaleTabFinalState, isLocked, tab, trustedListingsAvailable, trustedUnlockedCase, trustedUnlockedConfidence]);

  useEffect(() => {
    setLoading(true);
    setVehicle(null);
    setValuation(createEmptyValuation());
    setEstimateSupport(null);
    setHorsepowerSupport(null);
    setError(null);
    let active = true;

    if (isEstimateMode) {
      const hydrateEstimateVehicle = async () => {
        const routeMake = typeof make === "string" && make.trim().length > 0 ? make : null;
        const routeModel = typeof model === "string" && model.trim().length > 0 ? model : null;
        let resolvedMake = routeMake;
        let resolvedModel = routeModel;
        let resolvedYearLabel = typeof yearLabel === "string" ? yearLabel : "";
        let resolvedTrimLabel = typeof trimLabel === "string" ? trimLabel : "";
        let resolvedVehicleType = typeof vehicleType === "string" ? vehicleType : "";
        let resolvedConfidence = typeof confidence === "string" ? confidence : "";

        if ((!resolvedMake || !resolvedModel) && scanId) {
          const scans = await scanService.getRecentScans();
          const matched = scans.find((entry) => entry.id === scanId);
          if (matched?.identifiedVehicle) {
            resolvedMake = resolvedMake ?? matched.identifiedVehicle.make ?? null;
            resolvedModel = resolvedModel ?? matched.identifiedVehicle.model ?? null;
            resolvedYearLabel = resolvedYearLabel || (matched.identifiedVehicle.year ? `${matched.identifiedVehicle.year} (est.)` : "");
            resolvedTrimLabel = resolvedTrimLabel || matched.identifiedVehicle.trim || "";
            resolvedVehicleType = resolvedVehicleType || matched.detectedVehicleType || "";
            resolvedConfidence = resolvedConfidence || `${matched.confidenceScore ?? ""}`;
          }
        }

        if (!resolvedMake || !resolvedModel) {
          if (!active) {
            return;
          }
          setVehicle(null);
          setError("This estimated result is no longer available. Please rescan the vehicle.");
          setLoading(false);
          return;
        }

        const parsedYear = Number.parseInt(resolvedYearLabel, 10);
        const numericConfidence = Number.parseFloat(resolvedConfidence);
        const riskyFamily = isRiskSensitiveFamily({
          make: resolvedMake,
          model: resolvedModel,
          vehicleType: resolvedVehicleType,
          year: Number.isFinite(parsedYear) ? parsedYear : null,
        });
        const mainstreamFriendlyFamily = isMainstreamGroundingFriendlyFamily({
          make: resolvedMake,
          model: resolvedModel,
        });
        const highConfidenceTrustedCase = isTrustedResult({
          confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
          make: resolvedMake,
          model: resolvedModel,
          vehicleType: resolvedVehicleType || null,
          year: Number.isFinite(parsedYear) ? parsedYear : null,
        });
        const coverageFamilyKey = getMainstreamCoverageFamilyKey({
          make: resolvedMake,
          model: resolvedModel,
        });
        const groundedPresentation = await offlineCanonicalService.resolveVehiclePresentation({
          year: Number.isFinite(parsedYear) ? parsedYear : null,
          make: resolvedMake,
          model: resolvedModel,
          trim: resolvedTrimLabel || null,
          vehicleType: resolvedVehicleType || null,
        });
        const approximateFamilySupport = await offlineCanonicalService.resolveApproximateFamilySupport({
          year: Number.isFinite(parsedYear) ? parsedYear : null,
          make: resolvedMake,
          model: resolvedModel,
          trim: resolvedTrimLabel || null,
          vehicleType: resolvedVehicleType || null,
        });

        const groundedVehicle = approximateFamilySupport?.vehicle ?? groundedPresentation?.vehicle ?? null;
        const descriptorSeedYear =
          groundedVehicle?.year ??
          approximateFamilySupport?.vehicle?.year ??
          (Number.isFinite(parsedYear) ? parsedYear : null);
        const descriptorSeedAvailable = Boolean(descriptorSeedYear && resolvedMake && resolvedModel);
        const unlockedEstimateAccess = accessState === "unlocked";
        const strongFamilyFallback = unlockedEstimateAccess
          ? Boolean(groundedVehicle || approximateFamilySupport || groundedPresentation || descriptorSeedAvailable)
          : highConfidenceTrustedCase
            ? true
            : isStrongFamilyFallback({
                matchType: approximateFamilySupport?.matchType ?? groundedPresentation?.matchType,
                candidateCount: approximateFamilySupport?.candidateCount ?? groundedPresentation?.candidateCount,
                requestedYear: Number.isFinite(parsedYear) ? parsedYear : null,
                matchedYear: approximateFamilySupport?.vehicle?.year ?? groundedPresentation?.vehicle?.year ?? null,
                riskyFamily,
                mainstreamFriendly: mainstreamFriendlyFamily || approximateFamilySupport?.mainstreamFriendly === true,
              });
        const strongMarketFallback = unlockedEstimateAccess
          ? Boolean(groundedVehicle || approximateFamilySupport || groundedPresentation || descriptorSeedAvailable)
          : highConfidenceTrustedCase && groundedVehicle
            ? true
            : isStrongMarketFallback({
                matchType: approximateFamilySupport?.matchType ?? groundedPresentation?.matchType,
                candidateCount: approximateFamilySupport?.candidateCount ?? groundedPresentation?.candidateCount,
                requestedYear: Number.isFinite(parsedYear) ? parsedYear : null,
                matchedYear: approximateFamilySupport?.vehicle?.year ?? groundedPresentation?.vehicle?.year ?? null,
                riskyFamily,
                mainstreamFriendly: mainstreamFriendlyFamily || approximateFamilySupport?.mainstreamFriendly === true,
              });
        const strongListingsFallback = unlockedEstimateAccess
          ? Boolean(groundedVehicle || approximateFamilySupport || groundedPresentation || descriptorSeedAvailable)
          : highConfidenceTrustedCase && groundedVehicle
            ? true
            : isStrongListingsFallback({
                matchType: approximateFamilySupport?.matchType ?? groundedPresentation?.matchType,
                candidateCount: approximateFamilySupport?.candidateCount ?? groundedPresentation?.candidateCount,
                requestedYear: Number.isFinite(parsedYear) ? parsedYear : null,
                matchedYear: approximateFamilySupport?.vehicle?.year ?? groundedPresentation?.vehicle?.year ?? null,
                riskyFamily,
                mainstreamFriendly: mainstreamFriendlyFamily || approximateFamilySupport?.mainstreamFriendly === true,
              });
        const groundedRecord = groundedVehicle
          && strongFamilyFallback
          ? offlineCanonicalService.mapToVehicleRecord(groundedVehicle)
          : null;
        const resolvedHorsepowerSupport =
          await offlineCanonicalService.resolveHorsepowerSupport({
            year: Number.isFinite(parsedYear) ? parsedYear : null,
            make: resolvedMake,
            model: resolvedModel,
            trim: resolvedTrimLabel || null,
            vehicleType: resolvedVehicleType || null,
          });
        const shouldDebugCrv = __DEV__ && isCrvTraceTarget({ make: resolvedMake, model: resolvedModel });
        const groundedYearRangeLabel =
          strongFamilyFallback
            ? formatYearRangeLabel(
                approximateFamilySupport?.yearRange?.start ?? groundedPresentation?.yearRange?.start,
                approximateFamilySupport?.yearRange?.end ?? groundedPresentation?.yearRange?.end,
              )
            : null;
        const groundedFamilyLabel = groundedVehicle
          && strongFamilyFallback
          ? `${groundedVehicle.make} ${groundedVehicle.model}`.trim()
          : null;
        const displayFamilyLabel = `${resolvedMake} ${resolvedModel}`.trim();
        const displayYearLabel = Number.isFinite(parsedYear) ? `${parsedYear}` : groundedYearRangeLabel;
        const resolvedBodyStyle =
          approximateFamilySupport?.sharedSpecs.bodyStyle ||
          groundedRecord?.bodyStyle ||
          (resolvedVehicleType && resolvedVehicleType.trim().length > 0 ? resolvedVehicleType : "Estimated vehicle");
        const specsSourceLabel = highConfidenceTrustedCase
          ? null
          : groundedFamilyLabel
            ? "Best available vehicle detail is shown from the closest verified match."
            : null;
        const marketSourceLabel = groundedFamilyLabel && strongMarketFallback
          ? highConfidenceTrustedCase
            ? "Nearby pricing and listing data is shown here when available."
            : "Nearby pricing and listing data is shown here when available."
          : descriptorSeedAvailable && (strongMarketFallback || strongListingsFallback)
            ? "Resolved from the best available descriptor-based market data."
            : null;
        const resolvedDisplayTrim = shouldShowEstimatedTrim({
          trim: resolvedTrimLabel,
          confidence: Number.isFinite(numericConfidence) ? numericConfidence : 0,
          matchType: groundedPresentation?.matchType,
          strongFamilyFallback,
          make: resolvedMake,
          model: resolvedModel,
          vehicleType: resolvedVehicleType,
          year: Number.isFinite(parsedYear) ? parsedYear : null,
          trustedResult: highConfidenceTrustedCase,
        })
          ? resolvedTrimLabel
          : "";

        const estimatedVehicle: VehicleRecord = {
          id,
          year: typeof resolvedYearLabel === "string" ? Number.parseInt(resolvedYearLabel, 10) || 0 : 0,
          make: resolvedMake,
          model: resolvedModel,
          trim: resolvedDisplayTrim,
          bodyStyle: resolvedBodyStyle,
          heroImage: "",
          overview: [
            highConfidenceTrustedCase ? "High-confidence vehicle identification." : "Vehicle identification from photo analysis.",
            resolvedConfidence ? `Confidence: ${Math.round(Number(resolvedConfidence) * 100)}%.` : null,
            groundedYearRangeLabel && !highConfidenceTrustedCase ? `Likely production range: ${groundedYearRangeLabel}.` : null,
            highConfidenceTrustedCase ? null : specsSourceLabel,
          ]
            .filter(Boolean)
            .join(" "),
          specs: mergeApproximateSpecs(groundedRecord, approximateFamilySupport),
          valuation:
            groundedRecord && strongMarketFallback
              ? buildApproximateValuation(groundedRecord.valuation, displayFamilyLabel, displayYearLabel)
              : createEmptyValuation(),
          listings: [],
        };
        const initialHorsepowerValue =
          groundedRecord?.specs.horsepower ?? resolvedHorsepowerSupport?.numericValue ?? null;
        const identifiedDetailYear = Number.isFinite(parsedYear) ? parsedYear : groundedVehicle?.year ?? approximateFamilySupport?.vehicle?.year ?? null;
        const identifiedDetailMake = resolvedMake;
        const identifiedDetailModel = resolvedModel;
        const detailLookupDescriptor = buildEstimateLookupDescriptor({
          year: identifiedDetailYear,
          make: identifiedDetailMake,
          model: identifiedDetailModel,
          trim: resolvedDisplayTrim || resolvedTrimLabel || groundedVehicle?.trim || approximateFamilySupport?.vehicle?.trim || null,
          vehicleType: resolvedVehicleType || groundedVehicle?.vehicleType || approximateFamilySupport?.vehicle?.vehicleType || null,
          bodyStyle: resolvedBodyStyle || groundedVehicle?.basicSpecs.bodyStyle || approximateFamilySupport?.sharedSpecs.bodyStyle || null,
        });
        const groundedVehicleIdForDetail =
          isRealVehicleLookupId(groundedVehicle?.id ?? null) &&
          groundedVehicle &&
          normalizeFamilyKey({ make: groundedVehicle.make, model: groundedVehicle.model }) === normalizeFamilyKey({ make: resolvedMake, model: resolvedModel }) &&
          (!Number.isFinite(parsedYear) || Math.abs(groundedVehicle.year - parsedYear) <= 1)
            ? groundedVehicle.id
            : null;
        if (shouldDebugCrv) {
          console.log("[vehicle-detail] DEBUG_CRV_TRACE", {
            phase: "estimate-hydration",
            identificationResult: {
              year: Number.isFinite(parsedYear) ? parsedYear : null,
              make: resolvedMake,
              model: resolvedModel,
              normalizedModel: resolvedModel.trim().toLowerCase().replace(/\s+/g, "-"),
              confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
            },
            enrichmentCandidateSet: {
              exactCandidate: {
                year: Number.isFinite(parsedYear) ? parsedYear : null,
                make: resolvedMake,
                model: resolvedModel,
                trim: resolvedTrimLabel || null,
              },
              adjacentYearCandidates: Number.isFinite(parsedYear)
                ? [
                    { year: parsedYear - 1, make: resolvedMake, model: resolvedModel },
                    { year: parsedYear + 1, make: resolvedMake, model: resolvedModel },
                  ]
                : [],
              generationCandidates: [
                groundedPresentation?.vehicle
                  ? {
                      source: "grounded-presentation",
                      year: groundedPresentation.vehicle.year,
                      make: groundedPresentation.vehicle.make,
                      model: groundedPresentation.vehicle.model,
                      trim: groundedPresentation.vehicle.trim ?? null,
                    }
                  : null,
                approximateFamilySupport?.vehicle
                  ? {
                      source: "approximate-family-support",
                      year: approximateFamilySupport.vehicle.year,
                      make: approximateFamilySupport.vehicle.make,
                      model: approximateFamilySupport.vehicle.model,
                      trim: approximateFamilySupport.vehicle.trim ?? null,
                    }
                  : null,
              ].filter(Boolean),
            },
            horsepower: {
              sourceUsed: groundedRecord?.specs.horsepower
                ? "canonical-grounded-record"
                : resolvedHorsepowerSupport?.value
                  ? "canonical-horsepower-support"
                  : "none",
              rawBeforeMerge: {
                groundedBasicHorsepower: groundedVehicle?.basicSpecs.horsepower ?? null,
                groundedRecordHorsepower: groundedRecord?.specs.horsepower ?? null,
                horsepowerSupportNumeric: resolvedHorsepowerSupport?.numericValue ?? null,
                horsepowerSupportLabel: resolvedHorsepowerSupport?.label ?? null,
              },
              finalMergedValue: initialHorsepowerValue,
            },
            handoff: {
              groundedVehicleId: groundedVehicleIdForDetail,
              groundedVehicleIdRaw: groundedVehicle?.id ?? null,
              descriptor: detailLookupDescriptor,
              resolutionMode: groundedVehicleIdForDetail ? "real-id" : "descriptor",
              groundedFamilyLabel,
              strongFamilyFallback,
              strongMarketFallback,
              strongListingsFallback,
              marketSourceLabel,
              note:
                groundedVehicleIdForDetail
                  ? "Backend value/listings will be requested with a real vehicle id."
                  : "Backend value/listings will be requested with a descriptor payload instead of the client offline id.",
            },
          });
        }
        logMainstreamGroundingCoverage({
          stage: "initial",
          scanId: typeof scanId === "string" ? scanId : null,
          familyKey: coverageFamilyKey,
          requestedYear: Number.isFinite(parsedYear) ? parsedYear : null,
          make: resolvedMake,
          model: resolvedModel,
          confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
          matchType: approximateFamilySupport?.matchType ?? groundedPresentation?.matchType ?? null,
          candidateCount: approximateFamilySupport?.candidateCount ?? groundedPresentation?.candidateCount ?? null,
          nearestYearDelta: approximateFamilySupport?.nearestYearDelta ?? null,
          groundedYearRangeLabel,
          familyLabel: groundedFamilyLabel,
          strongFamilyFallback,
          strongMarketFallback,
          strongListingsFallback,
          familySafeSpecsShown: strongFamilyFallback,
          horsepowerShown: strongFamilyFallback && (typeof initialHorsepowerValue === "number" || Boolean(resolvedHorsepowerSupport?.value)),
          msrpRangeShown: strongFamilyFallback && Boolean(approximateFamilySupport?.msrpRangeLabel || groundedRecord?.specs.msrp),
          valueShown:
            strongMarketFallback &&
            (!isUnavailableValue(estimatedVehicle.valuation.tradeIn) ||
              !isUnavailableValue(estimatedVehicle.valuation.privateParty) ||
              !isUnavailableValue(estimatedVehicle.valuation.dealerRetail)),
          listingsShown: false,
        });
        if (!active) {
          return;
        }
        setVehicle(estimatedVehicle);
        applyValuationUpdate(estimatedVehicle.valuation, "estimate-initial");
        setValueDebugStatus(hasStructuredValueEvidence(estimatedVehicle.valuation) ? "accepted" : "idle");
        setZipCode(defaultZip);
        setMileage(defaultMileage);
        setCondition(defaultCondition);
        lastValueRequestKeyRef.current = buildValueRequestKey(
          {
            vehicleId: groundedVehicleIdForDetail,
            descriptor: detailLookupDescriptor,
          },
          defaultZip,
          defaultMileage,
          defaultCondition,
        );
        previousConditionRef.current = normalizeCondition(defaultCondition);
        previousValueRef.current = JSON.stringify(estimatedVehicle.valuation);
        setEstimateSupport({
          groundedVehicleId: groundedVehicleIdForDetail,
          groundedVehicleDescriptor: detailLookupDescriptor,
          groundedYear: groundedVehicle?.year ?? null,
          familyLabel: displayFamilyLabel,
          yearRangeLabel: displayYearLabel,
          specsSourceLabel,
          marketSourceLabel,
          groundedMatchType: approximateFamilySupport?.matchType ?? groundedPresentation?.matchType ?? null,
          candidateCount: approximateFamilySupport?.candidateCount ?? groundedPresentation?.candidateCount ?? null,
          msrpRangeLabel: approximateFamilySupport?.msrpRangeLabel ?? null,
          hasSpecsData: strongFamilyFallback,
          hasMarketData: strongMarketFallback,
          hasListingsData: strongListingsFallback,
          trustedResult: highConfidenceTrustedCase,
        });
        setHorsepowerSupport(
          groundedRecord?.specs.horsepower
            ? null
            : resolvedHorsepowerSupport,
        );
        setError(null);
        setLoading(false);

        if (!groundedVehicleIdForDetail && !detailLookupDescriptor) {
          return;
        }

        if (__DEV__) {
          console.log(
            groundedVehicleIdForDetail
              ? "[vehicle-detail] DETAIL_REAL_ID_RESOLUTION_USED"
              : "[vehicle-detail] DETAIL_DESCRIPTOR_RESOLUTION_USED",
            {
              vehicleId: groundedVehicleIdForDetail,
              descriptor: detailLookupDescriptor,
              trustedResult: highConfidenceTrustedCase,
            },
          );
        }

        const estimateDetailLookupInput = {
          vehicleId: groundedVehicleIdForDetail,
          descriptor: detailLookupDescriptor,
        };

        const [specsResult, valueResult, listingsResult] = await Promise.allSettled([
          strongFamilyFallback
            ? vehicleService.getSpecsByLookup(estimateDetailLookupInput)
            : Promise.resolve(null),
          strongMarketFallback
            ? vehicleService.getValue(estimateDetailLookupInput, defaultZip, defaultMileage, normalizeCondition(defaultCondition))
            : Promise.resolve(null),
          strongListingsFallback
            ? vehicleService.getListings(estimateDetailLookupInput, defaultZip)
            : Promise.resolve({ listings: [], meta: null }),
        ]);

        if (!active) {
          return;
        }

        const resolvedSpecsVehicle = specsResult.status === "fulfilled" ? specsResult.value : null;

        if (strongFamilyFallback && resolvedSpecsVehicle) {
          setVehicle((current) =>
            current
              ? {
                  ...current,
                  bodyStyle: resolvedSpecsVehicle.bodyStyle || current.bodyStyle,
                  heroImage: resolvedSpecsVehicle.heroImage || current.heroImage,
                  specs: resolvedSpecsVehicle.specs,
                }
              : current,
          );
        }

        if (strongMarketFallback && valueResult.status === "fulfilled" && valueResult.value) {
          const nextValuation = buildApproximateValuation(
            valueResult.value,
            displayFamilyLabel,
            displayYearLabel,
          );
          applyValuationUpdate(nextValuation, "estimate-backend-value");
          setVehicle((current) => (current ? { ...current, valuation: nextValuation } : current));
        }

        if (strongListingsFallback && listingsResult.status === "fulfilled") {
          setListingsDebugMeta(listingsResult.value.meta);
          setVehicle((current) =>
            current
              ? {
                  ...current,
                  listings: listingsResult.value.listings.slice(0, 2),
                }
              : current,
          );
        }

        const finalValuation =
          strongMarketFallback && valueResult.status === "fulfilled" && valueResult.value
            ? buildApproximateValuation(valueResult.value, displayFamilyLabel, displayYearLabel)
            : estimatedVehicle.valuation;
        const finalListings =
          strongListingsFallback && listingsResult.status === "fulfilled"
            ? listingsResult.value.listings.slice(0, 2)
            : [];
        if (shouldDebugCrv) {
          console.log("[vehicle-detail] DEBUG_CRV_TRACE", {
            phase: "post-backend-resolution",
            identificationResult: {
              year: Number.isFinite(parsedYear) ? parsedYear : null,
              make: resolvedMake,
              model: resolvedModel,
              normalizedModel: resolvedModel.trim().toLowerCase().replace(/\s+/g, "-"),
            },
            valuePipeline: {
              attempted: strongMarketFallback,
              status: valueResult.status,
              returned: valueResult.status === "fulfilled" ? Boolean(valueResult.value) : false,
              sourceLabel: valueResult.status === "fulfilled" && valueResult.value ? valueResult.value.sourceLabel ?? null : null,
              modelType: valueResult.status === "fulfilled" && valueResult.value ? valueResult.value.modelType ?? null : null,
            },
            listingsPipeline: {
              attempted: strongListingsFallback,
              status: listingsResult.status,
              returnedCount: listingsResult.status === "fulfilled" ? listingsResult.value.listings.length : 0,
              believableCount: listingsResult.status === "fulfilled" ? listingsResult.value.meta?.believableCount ?? listingsResult.value.listings.length : 0,
            },
            final: {
              horsepowerPopulated: Boolean(initialHorsepowerValue),
              valuePresent:
                !isUnavailableValue(finalValuation.tradeIn) ||
                !isUnavailableValue(finalValuation.privateParty) ||
                !isUnavailableValue(finalValuation.dealerRetail),
              listingsPresent: finalListings.length > 0,
            },
          });
        }
        logMainstreamGroundingCoverage({
          stage: "final",
          scanId: typeof scanId === "string" ? scanId : null,
          familyKey: coverageFamilyKey,
          requestedYear: Number.isFinite(parsedYear) ? parsedYear : null,
          make: resolvedMake,
          model: resolvedModel,
          confidence: Number.isFinite(numericConfidence) ? numericConfidence : null,
          matchType: approximateFamilySupport?.matchType ?? groundedPresentation?.matchType ?? null,
          candidateCount: approximateFamilySupport?.candidateCount ?? groundedPresentation?.candidateCount ?? null,
          nearestYearDelta: approximateFamilySupport?.nearestYearDelta ?? null,
          groundedYearRangeLabel,
          familyLabel: groundedFamilyLabel,
          strongFamilyFallback,
          strongMarketFallback,
          strongListingsFallback,
          familySafeSpecsShown: strongFamilyFallback,
          horsepowerShown: strongFamilyFallback && (typeof initialHorsepowerValue === "number" || Boolean(resolvedHorsepowerSupport?.value)),
          msrpRangeShown: strongFamilyFallback && Boolean(approximateFamilySupport?.msrpRangeLabel || groundedRecord?.specs.msrp),
          valueShown:
            strongMarketFallback &&
            (!isUnavailableValue(finalValuation.tradeIn) ||
              !isUnavailableValue(finalValuation.privateParty) ||
              !isUnavailableValue(finalValuation.dealerRetail)),
          listingsShown: strongListingsFallback && finalListings.length > 0,
        });
      };

      hydrateEstimateVehicle().catch((err) => {
        if (!active) {
          return;
        }
        setVehicle(null);
        setError(err instanceof Error ? err.message : "This estimated result is no longer available.");
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    vehicleService
      .getOfflineVehicleById(id)
      .then((offlineResult) => {
        if (!active || !offlineResult) {
          return;
        }
        console.log("[vehicle-detail] OFFLINE_RESULT_RENDERED", {
          source: "offline_canonical",
          vehicleId: id,
        });
        setVehicle(offlineResult);
        applyValuationUpdate(offlineResult.valuation ?? createEmptyValuation(), "offline-result");
        setValueDebugStatus(hasStructuredValueEvidence(offlineResult.valuation) ? "accepted" : "idle");
        setZipCode(defaultZip);
        const initialMileage = getInitialMileage(offlineResult);
        const initialCondition = getInitialCondition(offlineResult);
        setMileage(initialMileage);
        setCondition(initialCondition);
        lastValueRequestKeyRef.current = buildValueRequestKey(offlineResult.id, defaultZip, initialMileage, initialCondition);
        previousConditionRef.current = normalizeCondition(initialCondition);
        previousValueRef.current = JSON.stringify(offlineResult.valuation ?? createEmptyValuation());
        setError(null);
        setLoading(false);
      })
      .catch(() => undefined);

    vehicleService
      .getVehicleById(id)
      .then((result) => {
        if (!active) {
          return;
        }
        setVehicle(result ?? null);
        applyValuationUpdate(result?.valuation ?? createEmptyValuation(), "backend-vehicle-load");
        setValueDebugStatus(hasStructuredValueEvidence(result?.valuation) ? "accepted" : "idle");
        if (result) {
          setZipCode(defaultZip);
          const initialMileage = getInitialMileage(result);
          const initialCondition = getInitialCondition(result);
          setMileage(initialMileage);
          setCondition(initialCondition);
          lastValueRequestKeyRef.current = buildValueRequestKey(result.id, defaultZip, initialMileage, initialCondition);
          previousConditionRef.current = normalizeCondition(initialCondition);
          previousValueRef.current = JSON.stringify(result.valuation ?? createEmptyValuation());
          console.log("[vehicle-detail] OFFLINE_RESULT_ENHANCED", {
            vehicleId: id,
            source: "backend",
          });
        }
        setError(result ? null : "Vehicle not found.");
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        setVehicle((current) => current);
        setValuation((current) => {
          const preferred = current ?? createEmptyValuation();
          strongestValuationRef.current = choosePreferredValuation(strongestValuationRef.current, preferred);
          return preferred;
        });
        setError((current) => current ?? (err instanceof Error ? err.message : "Unable to load vehicle."));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [accessState, confidence, id, isEstimateMode, make, model, scanId, titleLabel, trimLabel, vehicleType, yearLabel]);

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
    if (!resolvedImageUri) {
      setHeroImagePolicy({
        useResolvedImageInHero: true,
        artifactRisk: false,
        reason: null,
      });
      return;
    }

    const nextPolicy = evaluateHeroImagePolicy(resolvedImageUri);
    setHeroImagePolicy(nextPolicy);

    if (__DEV__) {
      console.log("[vehicle-detail] HERO_IMAGE_POLICY", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        resolvedImageUri,
        useResolvedImageInHero: nextPolicy.useResolvedImageInHero,
        artifactRisk: nextPolicy.artifactRisk,
        reason: nextPolicy.reason,
      });
    }
  }, [id, resolvedImageUri, scanId]);

  useEffect(() => {
    if (!vehicle || tab !== "Value") {
      return;
    }

    if (__DEV__) {
      console.log("[vehicle-detail] VALUE_UI_INPUT_CHANGED", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        zip: zipCode.trim(),
        mileage: mileage.trim(),
        condition: normalizeCondition(condition),
        previousDisplayedValue: displayValuation,
      });
      console.log("[vehicle-detail] VEHICLE_VALUE_INPUT_STATE", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        zip: zipCode.trim(),
        mileage: mileage.trim(),
        condition: normalizeCondition(condition),
        oldDisplayedValue: displayValuation,
      });
    }

    const valueLookupInput = isEstimateMode
      ? estimateSupport?.groundedVehicleDescriptor
        ? {
            vehicleId: estimateSupport.groundedVehicleId,
            descriptor: estimateSupport.groundedVehicleDescriptor,
          }
        : estimateSupport?.groundedVehicleId
          ? {
              vehicleId: estimateSupport.groundedVehicleId,
              descriptor: null,
            }
          : null
      : vehicle.id;
    if (!valueLookupInput) {
      return;
    }

    const normalizedZip = zipCode.trim();
    const normalizedMileage = mileage.trim();
    const normalizedCondition = normalizeCondition(condition);
    const requestKey = buildValueRequestKey(valueLookupInput, normalizedZip, normalizedMileage, normalizedCondition) ?? "";
    const userAdjustedInputs = lastValueRequestKeyRef.current !== null && lastValueRequestKeyRef.current !== requestKey;
    console.log("[vehicle-detail] VALUE_INPUT_CHANGED", {
      vehicleId: vehicle.id,
      resolutionMode:
        typeof valueLookupInput === "string"
          ? "real-id"
          : valueLookupInput?.descriptor
            ? "descriptor"
            : "real-id",
      previousCondition: previousConditionRef.current,
      newCondition: normalizedCondition,
      zip: normalizedZip,
      mileage: normalizedMileage,
    });
    if (__DEV__) {
      console.log("[vehicle-detail] VEHICLE_VALUE_ADJUSTMENT_INPUT_CHANGED", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        previousDisplayedValue: displayValuation,
        requestKey,
        previousRequestKey: lastValueRequestKeyRef.current,
        zip: normalizedZip,
        mileage: normalizedMileage,
        condition: normalizedCondition,
        userAdjustedInputs,
      });
    }

    if (!normalizedZip || !normalizedMileage || !normalizedCondition) {
      if (__DEV__) {
        console.log("[vehicle-detail] VEHICLE_VALUE_RECALC_SKIPPED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          previousDisplayedValue: displayValuation,
          zip: normalizedZip,
          mileage: normalizedMileage,
          condition: normalizedCondition,
          reason: "invalid-value-inputs",
        });
      }
      return;
    }

    if (pendingValueRequestKeyRef.current === requestKey) {
      if (__DEV__) {
        console.log("[vehicle-detail] VEHICLE_VALUE_RECALC_SKIPPED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          previousDisplayedValue: displayValuation,
          zip: normalizedZip,
          mileage: normalizedMileage,
          condition: normalizedCondition,
          reason: "value-request-in-flight",
        });
      }
      return;
    }

    if (lastValueRequestKeyRef.current === requestKey && hasStructuredValueEvidence(displayValuation)) {
      if (__DEV__) {
        console.log("[vehicle-detail] VEHICLE_VALUE_RECALC_SKIPPED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          previousDisplayedValue: displayValuation,
          zip: normalizedZip,
          mileage: normalizedMileage,
          condition: normalizedCondition,
          reason: "passive-rerender-same-inputs",
        });
      }
      return;
    }

    const timeout = setTimeout(() => {
      pendingValueRequestKeyRef.current = requestKey;
      setValueDebugStatus("requested");
      console.log("[vehicle-detail] VALUE_REQUEST_TRIGGERED", {
        vehicleId: typeof valueLookupInput === "string" ? valueLookupInput : null,
        descriptor: typeof valueLookupInput === "string" ? null : valueLookupInput.descriptor,
        resolutionMode:
          typeof valueLookupInput === "string"
            ? "real-id"
            : valueLookupInput?.descriptor
              ? "descriptor"
              : "real-id",
        previousCondition: previousConditionRef.current,
        newCondition: normalizedCondition,
        estimateMode: isEstimateMode,
      });
      if (__DEV__) {
        console.log("[vehicle-detail] VALUE_UI_REQUEST_SENT", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          zip: normalizedZip,
          mileage: normalizedMileage,
          condition: normalizedCondition,
          previousDisplayedValue: displayValuation,
        });
        console.log("[vehicle-detail] VEHICLE_VALUE_RECALC_REQUESTED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          previousDisplayedValue: displayValuation,
          zip: normalizedZip,
          mileage: normalizedMileage,
          condition: normalizedCondition,
          userAdjustedInputs,
        });
      }
      setValuationLoading(true);
      vehicleService
        .getValue(valueLookupInput, normalizedZip, normalizedMileage, normalizedCondition)
        .then((result) => {
          const nextResult =
            isEstimateMode && estimateSupport?.familyLabel
              ? buildApproximateValuation(result, estimateSupport.familyLabel, estimateSupport.yearRangeLabel)
              : result;
          const predictedRenderedValue = choosePreferredValuation(displayValuation, nextResult, {
            allowReplacement: userAdjustedInputs,
          });
          const nextResultHasEvidence = hasStructuredValueEvidence(nextResult);
          const acceptedForDisplay =
            userAdjustedInputs
              ? nextResultHasEvidence
              : JSON.stringify(predictedRenderedValue) !== JSON.stringify(displayValuation);
          const rejectionReason = acceptedForDisplay
            ? null
            : userAdjustedInputs
              ? nextResultHasEvidence
                ? "guard-logic-blocked-valid-user-value"
                : "empty-or-invalid-user-value"
              : hasStructuredValueEvidence(displayValuation) && JSON.stringify(predictedRenderedValue) === JSON.stringify(displayValuation)
                ? "identical-or-weaker-passive-result"
                : "passive-refresh-no-visible-change";
          const nextValue = JSON.stringify(result);
          console.log("[vehicle-detail] VALUE_CONDITION_COMPARISON", {
            vehicleId: typeof valueLookupInput === "string" ? valueLookupInput : null,
            previousCondition: previousConditionRef.current,
            newCondition: normalizedCondition,
            previousValue: previousValueRef.current,
            newValue: nextValue,
            changed: previousValueRef.current !== nextValue,
          });
          if (__DEV__) {
            console.log("[vehicle-detail] VALUE_UI_RESPONSE_RECEIVED", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              zip: normalizedZip,
              mileage: normalizedMileage,
              condition: normalizedCondition,
              previousDisplayedValue: displayValuation,
              returnedValue: nextResult,
              finalRenderedValue: predictedRenderedValue,
            });
            console.log("[vehicle-detail] VEHICLE_VALUE_RECALC_RESPONSE", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              zip: normalizedZip,
              mileage: normalizedMileage,
              condition: normalizedCondition,
              oldDisplayedValue: displayValuation,
              newReturnedValue: nextResult,
              accepted: acceptedForDisplay,
              acceptedReason: acceptedForDisplay
                ? userAdjustedInputs
                  ? "user-adjusted-valid-value"
                  : "passive-refresh-improved-or-initial"
                : rejectionReason,
            });
            console.log("[vehicle-detail] VEHICLE_VALUE_RECALC_RESOLVED", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              previousDisplayedValue: displayValuation,
              returnedRecalculatedValue: nextResult,
              zip: normalizedZip,
              mileage: normalizedMileage,
              condition: normalizedCondition,
              userAdjustedInputs,
              uiUpdated: hasStructuredValueEvidence(nextResult),
            });
          }
          if (__DEV__) {
            console.log(
              acceptedForDisplay
                ? "[vehicle-detail] VALUE_UI_UPDATE_ACCEPTED"
                : "[vehicle-detail] VALUE_UI_UPDATE_REJECTED",
              {
                routeId: id,
                scanId: typeof scanId === "string" ? scanId : null,
                zip: normalizedZip,
                mileage: normalizedMileage,
                condition: normalizedCondition,
                previousDisplayedValue: displayValuation,
                returnedValue: nextResult,
                finalRenderedValue: predictedRenderedValue,
                rangesExist: countBelievableValuePairs(nextResult) > 0,
                sourceLabelExists: Boolean(nextResult.sourceLabel && nextResult.sourceLabel !== "No live value source"),
                reason: acceptedForDisplay
                  ? userAdjustedInputs
                    ? "valid-different-user-driven-value"
                    : "valid-refresh-value"
                  : rejectionReason,
              },
            );
            console.log(
              acceptedForDisplay
                ? "[vehicle-detail] VEHICLE_VALUE_RECALC_ACCEPTED"
                : "[vehicle-detail] VEHICLE_VALUE_RECALC_REJECTED",
              {
                routeId: id,
                scanId: typeof scanId === "string" ? scanId : null,
                zip: normalizedZip,
                mileage: normalizedMileage,
                condition: normalizedCondition,
                oldDisplayedValue: displayValuation,
                newReturnedValue: nextResult,
                rangesExist: countBelievableValuePairs(nextResult) > 0,
                sourceLabelExists: Boolean(nextResult.sourceLabel && nextResult.sourceLabel !== "No live value source"),
                reason: acceptedForDisplay
                  ? userAdjustedInputs
                    ? "valid-user-adjusted-recalculation"
                    : "accepted-refresh-value"
                  : rejectionReason,
              },
            );
          }
          setValueDebugStatus(acceptedForDisplay ? "accepted" : "rejected");
          if (hasStructuredValueEvidence(nextResult)) {
            lastValueRequestKeyRef.current = requestKey;
          }
          applyValuationUpdate(nextResult, "value-refresh-success", {
            allowReplacement: userAdjustedInputs,
          });
          setVehicle((current) =>
            current
              ? {
                  ...current,
                  valuation: nextResult,
                }
              : current,
          );
          previousConditionRef.current = normalizedCondition;
          previousValueRef.current = nextValue;
        })
        .catch(() => {
          setValueDebugStatus("rejected");
          if (__DEV__) {
            console.log("[vehicle-detail] VALUE_UI_UPDATE_REJECTED", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              zip: normalizedZip,
              mileage: normalizedMileage,
              condition: normalizedCondition,
              previousDisplayedValue: displayValuation,
              returnedValue: null,
              finalRenderedValue: displayValuation,
              reason: "request-failed-previous-value-kept",
            });
            console.log("[vehicle-detail] VEHICLE_VALUE_RECALC_SKIPPED", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              previousDisplayedValue: displayValuation,
              zip: normalizedZip,
              mileage: normalizedMileage,
              condition: normalizedCondition,
              reason: "value-request-failed",
            });
            console.log("[vehicle-detail] VEHICLE_VALUE_RECALC_REJECTED", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              zip: normalizedZip,
              mileage: normalizedMileage,
              condition: normalizedCondition,
              oldDisplayedValue: displayValuation,
              newReturnedValue: null,
              reason: "request-failed-previous-value-kept",
            });
          }
        })
        .finally(() => {
          if (pendingValueRequestKeyRef.current === requestKey) {
            pendingValueRequestKeyRef.current = null;
          }
          setValuationLoading(false);
        });
    }, 250);

    return () => clearTimeout(timeout);
  }, [applyValuationUpdate, condition, displayValuation, estimateSupport, id, isEstimateMode, mileage, scanId, tab, vehicle, zipCode]);

  useEffect(() => {
    if (!vehicle || tab !== "Value") {
      return;
    }
    if (__DEV__) {
      console.log("[vehicle-detail] VALUE_UI_RENDER_BRANCH", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        zip: zipCode.trim(),
        mileage: mileage.trim(),
        condition: normalizeCondition(condition),
        previousDisplayedValue: null,
        returnedValue: valuation,
        finalRenderedValue: displayValuation,
        branch: valueTabFinalState ?? "default",
      });
    }
    console.log("[vehicle-detail] VEHICLE_VALUE_RENDERED", {
      vehicleId: vehicle.id,
      condition,
      valuation: displayValuation,
      sourceLabel: displayValuation.sourceLabel ?? null,
      fallbackUiChosen: valueTabFinalState === "value_unavailable",
    });
  }, [condition, displayValuation, id, mileage, scanId, tab, valuation, valueTabFinalState, vehicle, zipCode]);

  useEffect(() => {
    if (!vehicle) {
      return;
    }
    console.log("[vehicle-detail] HORSEPOWER_RENDERED", {
      vehicleId: vehicle.id,
      finalHorsepower: vehicle.specs.horsepower ?? horsepowerSupport?.value ?? null,
      estimateMode: isEstimateMode,
    });
  }, [horsepowerSupport?.value, isEstimateMode, vehicle]);

  useEffect(() => {
    if (!vehicle || !hasFullAccess) {
      return;
    }

    const payload =
      tab === "Specs"
        ? {
            tabName: "Specs",
            exactDataUsed: !isEstimateMode,
            fallbackDataUsed: isEstimateMode,
            unavailable: isEstimateMode ? !resolvedSpecsAvailable : false,
          }
        : tab === "Value"
          ? {
              tabName: "Value",
              exactDataUsed: !isEstimateMode,
              fallbackDataUsed: isEstimateMode && Boolean(estimateSupport?.hasMarketData),
              unavailable: isEstimateMode ? !hasApproximateValue : false,
            }
          : tab === "For Sale"
            ? {
                tabName: "For Sale",
                exactDataUsed: !isEstimateMode,
                fallbackDataUsed: isEstimateMode && Boolean(estimateSupport?.hasListingsData),
                unavailable: vehicle.listings.length === 0,
              }
            : tab === "Photos"
            ? {
                tabName: "Photos",
                exactDataUsed: !isEstimateMode,
                fallbackDataUsed: isEstimateMode,
                unavailable: !(resolvedImageUri ?? vehicle?.heroImage),
              }
              : {
                  tabName: tab,
                  exactDataUsed: !isEstimateMode,
                  fallbackDataUsed: isEstimateMode,
                  unavailable: false,
                };

    if (__DEV__) {
      console.log("[vehicle-detail] VEHICLE_TAB_DATA_RESOLUTION", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        unlockId: resolvedUnlockId,
        unlocked: hasFullAccess,
        garageSource: garageSource === "1",
        reopenedSource: reopenedSource === "1",
        ...payload,
      });
    }
  }, [
    estimateSupport?.hasListingsData,
    estimateSupport?.hasMarketData,
    garageSource,
    hasApproximateValue,
    hasFullAccess,
    id,
    isEstimateMode,
    reopenedSource,
    resolvedSpecsAvailable,
    resolvedImageUri,
    resolvedUnlockId,
    scanId,
    tab,
    vehicle,
  ]);

  useEffect(() => {
    if (!__DEV__ || !vehicle || !hasFullAccess) {
      return;
    }

    console.log("[vehicle-detail] VEHICLE_DETAIL_SOURCE_SUMMARY", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      unlockId: resolvedUnlockId,
      value: {
        finalValueSource: displayValuation.sourceLabel ?? null,
        finalValueModelType: displayValuation.modelType ?? null,
        familyCacheUsed: null,
        similarVehicleFallbackUsed: displayValuation.sourceLabel === "Estimated from similar vehicles",
        adjacentYearRescueUsed: false,
      },
      listings: {
        finalListingsSource: vehicle.listings.length > 0 ? listingsSourceLabel : null,
        familyCacheUsed: null,
        similarVehicleFallbackUsed: listingsDebugMeta?.mode === "similar_vehicle_fallback",
        adjacentYearRescueUsed: listingsDebugMeta?.mode === "adjacent_year_mixed_trims",
      },
      horsepowerPopulated: Boolean(vehicle.specs.horsepower || horsepowerSupport?.value),
    });
  }, [
    displayValuation,
    hasFullAccess,
    horsepowerSupport?.value,
    id,
    listingsDebugMeta?.mode,
    resolvedUnlockId,
    scanId,
    listingsSourceLabel,
    vehicle,
  ]);

  useEffect(() => {
    if (!__DEV__ || !vehicle) {
      return;
    }
    console.log("[vehicle-detail] VEHICLE_SPECS_RENDERED", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      backendDetailExists: Boolean(vehicle),
      sourceLabel: estimateSupport?.specsSourceLabel ?? (isEstimateMode ? "estimate-detail" : "backend-detail"),
      fallbackUiWon: tab === "Specs" ? isEstimateMode && !resolvedSpecsAvailable : false,
      horsepowerPresent: Boolean(vehicle.specs.horsepower || horsepowerSupport?.value),
      enginePresent: vehicle.specs.engine !== "Unknown",
      drivetrainPresent: vehicle.specs.drivetrain !== "Unknown" && vehicle.specs.drivetrain !== "Unavailable",
    });
  }, [estimateSupport?.specsSourceLabel, horsepowerSupport?.value, id, isEstimateMode, resolvedSpecsAvailable, scanId, tab, vehicle]);

  useEffect(() => {
    if (!__DEV__ || !vehicle) {
      return;
    }
    console.log("[vehicle-detail] FORSALE_UI_INPUT_PAYLOAD", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year ?? null,
      trim: vehicle.trim || null,
      rawCount: listingsDebugMeta?.rawCount ?? vehicle.listings.length,
      believableCount: listingsDebugMeta?.believableCount ?? believableListingsCount,
      finalSourceLabel: listingsSourceLabel,
      mode: listingsDebugMeta?.mode ?? "none",
    });
    console.log("[vehicle-detail] VEHICLE_LISTINGS_INPUT", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year || null,
      trim: vehicle.trim || null,
      listingsCount: vehicle.listings.length,
      believableListingsCount: vehicle.listings.filter(isBelievableListing).length,
      finalSourceLabel:
        vehicle.listings.length > 0 ? listingsSourceLabel : null,
    });
    console.log("[vehicle-detail] VEHICLE_LISTINGS_RENDERED", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      backendDetailExists: Boolean(vehicle),
      sourceLabel: vehicle.listings.length > 0 ? listingsSourceLabel : null,
      fallbackUiWon: tab === "For Sale" ? forSaleTabFinalState === "listings_unavailable" : false,
      believableListingsPresent: hasBelievableListings,
      listingsCount: vehicle.listings.length,
      listingsMode: listingsDebugMeta?.mode ?? "none",
    });
    console.log("[vehicle-detail] FORSALE_UI_RENDER_BRANCH", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year ?? null,
      trim: vehicle.trim || null,
      rawCount: listingsDebugMeta?.rawCount ?? vehicle.listings.length,
      believableCount: listingsDebugMeta?.believableCount ?? believableListingsCount,
      finalSourceLabel: listingsSourceLabel,
      branch: forSaleTabFinalState ?? "default",
    });
  }, [forSaleTabFinalState, hasBelievableListings, id, listingsDebugMeta?.mode, listingsSourceLabel, scanId, tab, vehicle]);

  useEffect(() => {
    if (!__DEV__ || tab !== "For Sale" || forSaleTabFinalState !== "listings_unavailable") {
      return;
    }
    console.log("[vehicle-detail] VEHICLE_LISTINGS_FALLBACK_CHOSEN", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      make: vehicle?.make ?? null,
      model: vehicle?.model ?? null,
      year: vehicle?.year ?? null,
      trim: vehicle?.trim ?? null,
      listingsCount: vehicle?.listings.length ?? 0,
      believableListingsCount: (vehicle?.listings ?? []).filter(isBelievableListing).length,
      finalSourceLabel: listingsSourceLabel,
      listingsMode: listingsDebugMeta?.mode ?? "none",
      reason:
        (vehicle?.listings ?? []).length === 0
          ? "no-listings-in-final-payload"
          : "all-listings-filtered-as-unbelievable",
    });
    console.log("[vehicle-detail] FORSALE_UI_FALLBACK_REASON", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      make: vehicle?.make ?? null,
      model: vehicle?.model ?? null,
      year: vehicle?.year ?? null,
      trim: vehicle?.trim ?? null,
      rawCount: listingsDebugMeta?.rawCount ?? vehicle?.listings.length ?? 0,
      believableCount: listingsDebugMeta?.believableCount ?? (vehicle?.listings ?? []).filter(isBelievableListing).length,
      finalSourceLabel: listingsSourceLabel,
      reason:
        (vehicle?.listings ?? []).length === 0
          ? "no-listings-in-final-payload"
          : "all-listings-filtered-as-unbelievable",
    });
  }, [forSaleTabFinalState, id, listingsDebugMeta?.mode, listingsSourceLabel, scanId, tab, vehicle]);

  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    console.log("[vehicle-detail] VEHICLE_INTERACTION_STATE_CHANGE", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      tab,
      unlockState: accessState,
      condition,
      estimateMode: isEstimateMode,
      marketDataFlag: estimateSupport?.hasMarketData ?? null,
      renderedValueSource: displayValuation.sourceLabel ?? null,
      fallbackUiChosen: tab === "Value" ? valueTabFinalState === "value_unavailable" : null,
    });
  }, [
    accessState,
    condition,
    displayValuation.sourceLabel,
    estimateSupport?.hasMarketData,
    id,
    isEstimateMode,
    scanId,
    tab,
    valueTabFinalState,
  ]);

  useEffect(() => {
    if (!__DEV__ || tab !== "Value") {
      return;
    }
    if (valueTabFinalState !== "value_unavailable") {
      return;
    }
    console.log("[vehicle-detail] VEHICLE_VALUE_FALLBACK_CHOSEN", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      sourceLabel: displayValuation.sourceLabel ?? null,
      hasStructuredValueEvidence: hasStructuredValueEvidence(displayValuation),
      hasMarketSupportFlag: estimateSupport?.hasMarketData ?? null,
      reason: hasStructuredValueEvidence(displayValuation)
        ? "guard-kept-real-value"
        : estimateSupport?.hasMarketData
          ? "value-usefulness-unavailable"
          : "market-support-flag-false-and-no-structured-value",
    });
  }, [displayValuation, estimateSupport?.hasMarketData, id, scanId, tab, valueTabFinalState]);

  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    const fallbackUiWon =
      (tab === "Value" && valueTabFinalState === "value_unavailable") ||
      (tab === "For Sale" && forSaleTabFinalState === "listings_unavailable") ||
      (tab === "Specs" && isEstimateMode && !resolvedSpecsAvailable);
    if (!fallbackUiWon) {
      return;
    }
    console.log("[vehicle-detail] VEHICLE_FALLBACK_CHOSEN", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      tab,
      backendDetailExists: Boolean(vehicle),
      fallbackUiWon,
      reason:
        tab === "Value"
          ? "value-unavailable"
          : tab === "For Sale"
            ? "listings-unavailable"
            : "specs-unavailable",
      valueSource: displayValuation.sourceLabel ?? null,
      listingsCount: vehicle?.listings.length ?? 0,
      specsAvailable: resolvedSpecsAvailable,
    });
  }, [
    displayValuation.sourceLabel,
    forSaleTabFinalState,
    id,
    isEstimateMode,
    resolvedSpecsAvailable,
    scanId,
    tab,
    valueTabFinalState,
    vehicle,
  ]);

  useEffect(() => {
    if (!vehicle) {
      return;
    }

    const horsepowerPresent = Boolean(vehicle.specs.horsepower || horsepowerSupport?.value);
    const specsPresent = hasResolvedSpecEvidence(vehicle, horsepowerSupport);
    const valuePresent =
      !isUnavailableValue(displayValuation.tradeIn) ||
      !isUnavailableValue(displayValuation.privateParty) ||
      !isUnavailableValue(displayValuation.dealerRetail);
    const listingsPresent = vehicle.listings.some(isBelievableListing);

    if (!isCommonVehicleForDetailCheck({ make: vehicle.make, model: vehicle.model })) {
      return;
    }

    if (specsPresent || valuePresent || listingsPresent) {
      return;
    }

    console.error("[vehicle-detail] DETAIL_EMPTY_COMMON_VEHICLE", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      unlockId: resolvedUnlockId,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year || null,
      horsepowerPresent,
      specsPresent,
      valuePresent,
      listingsPresent,
      estimateMode: isEstimateMode,
      trustedResult: estimateSupport?.trustedResult ?? false,
      reason:
        isEstimateMode && !estimateSupport?.groundedVehicleDescriptor && !estimateSupport?.groundedVehicleId
          ? "no descriptor candidate set"
          : vehicle.listings.length > 0 && !listingsPresent
            ? "listings filtered out"
            : isEstimateMode && !resolvedSpecsAvailable
              ? "stale flag gating"
            : !hasStructuredValueEvidence(displayValuation) && valueTabFinalState === "value_unavailable"
              ? "frontend fallback won"
              : "no provider hits",
    });
  }, [
    estimateSupport?.trustedResult,
    horsepowerSupport?.value,
    id,
    isEstimateMode,
    resolvedUnlockId,
    scanId,
    displayValuation,
    resolvedSpecsAvailable,
    vehicle,
  ]);

  useEffect(() => {
    if (!vehicle || vehicle.specs.horsepower) {
      if (vehicle?.specs.horsepower) {
        setHorsepowerSupport(null);
      }
      return;
    }

    let active = true;
    offlineCanonicalService
      .resolveHorsepowerSupport({
        year: vehicle.year || null,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim || null,
        vehicleType: vehicle.bodyStyle || null,
      })
      .then((support) => {
        if (!active) {
          return;
        }
        setHorsepowerSupport(support);
      })
      .catch(() => {
        if (active) {
          setHorsepowerSupport(null);
        }
      });

    return () => {
      active = false;
    };
  }, [vehicle]);

  const fallbackHeroImageUri = vehicle?.heroImage ?? "";
  const heroUsesResolvedImage = Boolean(resolvedImageUri && heroImagePolicy.useResolvedImageInHero);
  const heroImageUri = heroUsesResolvedImage ? resolvedImageUri ?? "" : fallbackHeroImageUri || resolvedImageUri || "";
  const selectedImageSourceLabel = heroUsesResolvedImage
    ? imageSourceLabel
    : fallbackHeroImageUri
      ? "clean vehicle image fallback"
      : resolvedImageUri
        ? "cropped scan fallback"
        : isEstimateMode
          ? "estimated result"
          : "provider/generic fallback";
  const scannedImageSelected = heroUsesResolvedImage || selectedImageSourceLabel === "cropped scan fallback";
  const heroImageFitMode = "cover";

  useEffect(() => {
    if (!vehicle || !heroImageUri) {
      return;
    }
    console.log("[vehicle-detail] RESULT_IMAGE_SOURCE_SELECTED", {
      source: selectedImageSourceLabel,
      imageUri: heroImageUri,
      vehicleId: vehicle.id,
      scanId,
    });
    console.log("[vehicle-detail] RESULT_IMAGE_LAYOUT_SELECTED", {
      source: selectedImageSourceLabel,
      fitMode: heroImageFitMode,
      vehicleId: vehicle.id,
    });
    console.log("[vehicle-detail] RESULT_IMAGE_FIT_MODE", {
      fitMode: heroImageFitMode,
      vehicleId: vehicle.id,
    });
  }, [heroImageFitMode, heroImageUri, scanId, selectedImageSourceLabel, vehicle]);

  useEffect(() => {
    if (loading || !vehicle) {
      heroOpacity.setValue(0);
      heroTranslate.setValue(12);
      contentOpacity.setValue(0);
      contentTranslate.setValue(16);
      return;
    }

    Animated.parallel([
      Animated.timing(heroOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(heroTranslate, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: 1, duration: 240, delay: 60, useNativeDriver: true }),
      Animated.timing(contentTranslate, { toValue: 0, duration: 240, delay: 60, useNativeDriver: true }),
    ]).start();
  }, [contentOpacity, contentTranslate, heroOpacity, heroTranslate, loading, vehicle]);

  if (loading) {
    return (
      <AppContainer scroll={false} contentContainerStyle={styles.loadingPage}>
        <BackButton fallbackHref="/(tabs)/scan" label="Back" />
        <View style={styles.loadingWrap}>
          <View style={styles.loadingHeroCard}>
            <PremiumSkeleton height={280} radius={Radius.xl} />
            <View style={styles.loadingHeroCopy}>
              <Text style={styles.loadingEyebrow}>Vehicle dossier</Text>
              <Text style={styles.loadingText}>Preparing the performance report</Text>
              <Text style={styles.loadingBody}>Loading identity, specs, ownership context, value, and related market sections.</Text>
            </View>
          </View>
          <View style={styles.loadingStack}>
            <PremiumSkeleton height={110} radius={Radius.xl} />
            <PremiumSkeleton height={176} radius={Radius.xl} />
            <PremiumSkeleton height={146} radius={Radius.xl} />
          </View>
          <ActivityIndicator size="small" color={Colors.accent} />
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

  return (
    <AppContainer>
      <BackButton fallbackHref="/(tabs)/scan" label="Back" />
      <Animated.View style={{ opacity: heroOpacity, transform: [{ translateY: heroTranslate }] }}>
        <View style={styles.heroShell}>
          <Pressable
            onPress={() => setHeroPreviewOpen(true)}
            style={styles.heroPressable}
            accessibilityRole="button"
            accessibilityHint="Opens a larger quick-view card for this vehicle"
          >
            <View style={styles.heroFrame}>
              <Image
                source={{ uri: heroImageUri }}
                style={[styles.hero, heroImagePolicy.artifactRisk && !fallbackHeroImageUri ? styles.heroArtifactCrop : null]}
                resizeMode={heroImageFitMode}
              />
              <LinearGradient colors={["rgba(4,8,18,0.04)", "rgba(4,8,18,0.12)", "rgba(4,8,18,0.46)"]} style={styles.heroGradient} />
            </View>
          </Pressable>
          <View style={styles.heroMetaCard}>
            <View style={styles.heroMetaTopRow}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeLabel}>{lockedEyebrow}</Text>
              </View>
              <View style={styles.heroTopActions}>
                <View style={styles.heroTapBadge}>
                  <Text style={styles.heroTapBadgeLabel}>Open quick view</Text>
                </View>
                {!isEstimateMode && hasFullAccess ? (
                  <View style={styles.heroStatusBadge}>
                    <Text style={styles.heroStatusBadgeLabel}>Full report unlocked</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Text style={styles.heroTitle}>{resolvedDisplayTitle}</Text>
            <Text style={styles.heroSubtitle}>{estimateSubtitle || unlockedDetailSubtitle}</Text>
            {summaryChips.length > 0 ? (
              <View style={styles.heroChipRow}>
                {summaryChips.map((chip) => (
                  <View key={chip} style={styles.heroChip}>
                    <Text style={styles.heroChipLabel}>{chip}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </Animated.View>
      {__DEV__ ? <Text style={styles.imageDebug}>Image source: {selectedImageSourceLabel}</Text> : null}
      <Animated.View style={{ opacity: contentOpacity, transform: [{ translateY: contentTranslate }] }}>
      {usage ? (
        <ScanUsageMeter
          status={usage}
          mode="unlocks"
          unlocksUsed={freeUnlocksUsed}
          unlocksRemaining={freeUnlocksRemaining}
          unlocksLimit={freeUnlocksLimit}
        />
      ) : null}
      <View style={[styles.headerCard, isEstimateMode && styles.headerCardEstimate]}>
        {isEstimateMode ? <Text style={styles.estimateEyebrow}>Vehicle details</Text> : null}
        {feedbackMessage ? <Text style={styles.feedbackNotice}>{feedbackMessage}</Text> : null}
        {errorMessage ? <Text style={styles.errorNotice}>{errorMessage}</Text> : null}
        <Text style={styles.headerKicker}>{isEstimateMode ? lockedEyebrow : "Performance intelligence summary"}</Text>
        <Text style={styles.subtitle}>{estimateSubtitle || unlockedDetailSubtitle}</Text>
        {isEstimateMode ? (
          <>
            <View style={styles.estimateBadge}>
              <Text style={styles.estimateBadgeLabel}>{lockedEyebrow}</Text>
            </View>
            {__DEV__ ? (
              <TouchableOpacity
                style={styles.qaResetButton}
                activeOpacity={0.86}
                accessibilityRole="button"
                onPress={() => {
                  resetMainstreamGroundingCoverageAggregate();
                  Alert.alert("Coverage counters reset", "Mainstream grounding QA aggregate counters were cleared for this app session.");
                }}
              >
                <Text style={styles.qaResetButtonLabel}>Reset coverage QA counters</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}
      </View>
      <SegmentedTabBar tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === "Overview" ? (
        <View style={styles.sectionCard}>
          {isEstimateMode ? (
            <SectionHeader
              title="Vehicle Identification"
              subtitle={trustedResult ? "High-confidence identification." : "Vehicle identification from your scan."}
            />
          ) : null}
          <Text style={styles.body}>{vehicle.overview}</Text>
          <DetailRow
            label="Year"
            value={
              isEstimateMode
                ? (finalDisplayIdentity.yearLabel || (vehicle.year ? `${vehicle.year}` : "Vehicle identified"))
                : finalDisplayIdentity.yearLabel || `${vehicle.year}`
            }
          />
          <DetailRow label="Make" value={finalDisplayIdentity.make || vehicle.make} />
          <DetailRow label="Model" value={finalDisplayIdentity.model || vehicle.model} />
          {!trustedResult ? (
            <DetailRow label={isEstimateMode ? "Trim" : "Trim"} value={resolvedDisplayTrim || "Unavailable"} />
          ) : null}
          <DetailRow label="Body style" value={resolvedDisplayBodyStyle || "Vehicle"} />
        </View>
      ) : null}

      {tab === "Specs" ? (
        isEstimateMode ? (
          <View style={styles.sectionCard}>
            <SectionHeader
              title="Specs"
              subtitle="Vehicle specs and pricing."
            />
            {resolvedSpecsAvailable ? (
              <View style={styles.trustedSpecsStack}>
                <DetailRow label={horsepowerSupport?.label ?? "Horsepower"} value={horsepowerSupport?.value ?? formatHorsepowerLabel(vehicle.specs.horsepower)} />
                <DetailRow label="Drivetrain" value={vehicle.specs.drivetrain} />
                <DetailRow label="Transmission" value={vehicle.specs.transmission} />
                <DetailRow label="MPG / Range" value={vehicle.specs.mpgOrRange} />
                <DetailRow label="Engine" value={vehicle.specs.engine} />
                <DetailRow
                  label={estimateSupport?.msrpRangeLabel?.includes(" - ") ? "MSRP range" : "MSRP"}
                  value={estimateSupport?.msrpRangeLabel ?? (vehicle.specs.msrp > 0 ? formatCurrency(vehicle.specs.msrp) : "Unavailable")}
                />
              </View>
            ) : (
              <ApproximateDataState
                title="Vehicle specs aren't available yet"
                body="We'll show vehicle specs here as soon as supporting data is available."
              />
            )}
          </View>
        ) : (
        <>
          {isLocked ? (
            <LockedContentPreview
              locked
              title="Premium specs"
              description="See the full powertrain, drivetrain, colors, and pricing with Pro."
            >
              <View style={styles.sectionCard}>
                <DetailRow label="Engine" value={vehicle.specs.engine} />
                <DetailRow label={horsepowerSupport?.label ?? "Horsepower"} value={horsepowerSupport?.value ?? formatHorsepowerLabel(vehicle.specs.horsepower)} />
                {horsepowerSupport && !horsepowerSupport.exact ? (
                  <Text style={styles.specSupportNote}>This horsepower comes from a strong family match because trim-level power differs across nearby variants.</Text>
                ) : null}
                <DetailRow label="Torque" value={vehicle.specs.torque} />
                <DetailRow label="Transmission" value={vehicle.specs.transmission} />
                <DetailRow label="Drivetrain" value={vehicle.specs.drivetrain} />
                <DetailRow label="MPG / Range" value={vehicle.specs.mpgOrRange} />
                <DetailRow label="Colors" value={vehicle.specs.exteriorColors.join(", ")} />
                <DetailRow label="Original MSRP" value={formatCurrency(vehicle.specs.msrp)} />
              </View>
            </LockedContentPreview>
          ) : (
            <View style={styles.sectionCard}>
              <DetailRow label="Engine" value={vehicle.specs.engine} />
              <DetailRow label={horsepowerSupport?.label ?? "Horsepower"} value={horsepowerSupport?.value ?? formatHorsepowerLabel(vehicle.specs.horsepower)} />
              {horsepowerSupport && !horsepowerSupport.exact ? (
                <Text style={styles.specSupportNote}>This horsepower comes from a strong family match because trim-level power differs across nearby variants.</Text>
              ) : null}
              <DetailRow label="Torque" value={vehicle.specs.torque} />
              <DetailRow label="Transmission" value={vehicle.specs.transmission} />
              <DetailRow label="Drivetrain" value={vehicle.specs.drivetrain} />
              <DetailRow label="MPG / Range" value={vehicle.specs.mpgOrRange} />
              <DetailRow label="Colors" value={vehicle.specs.exteriorColors.join(", ")} />
              <DetailRow label="Original MSRP" value={formatCurrency(vehicle.specs.msrp)} />
            </View>
          )}
          {isLocked ? (
            <UnlockAccessCard
              remaining={freeUnlocksRemaining}
              limit={freeUnlocksLimit}
              disabled={!vehicle?.id || isUnlocking}
              isUnlocking={isUnlocking}
              onUnlock={async () => {
                if (!vehicle?.id) return;
                const confirmed = await confirmUnlockIfNeeded();
                if (!confirmed) return;
                const result = await useFreeUnlockForVehicle(vehicle.id);
                if (result.ok) {
                  await refreshStatus();
                  Alert.alert("Free unlock applied", result.message);
                  setTab("Specs");
                } else {
                  Alert.alert(
                    unlockFailureTitle(result.reason),
                    result.message || errorMessage || "We couldn’t apply your free unlock right now.",
                  );
                }
              }}
              onUpgrade={() => router.push("/paywall")}
            />
          ) : null}
        </>
        )
      ) : null}

      {tab === "Value" ? (
        isEstimateMode ? (
          valueTabFinalState === "value_available_strong" || valueTabFinalState === "value_available_light" ? (
            <>
              <View style={styles.sectionCard}>
                <SectionHeader
                  title={valueTabFinalState === "value_available_light" ? "Nearby market view" : "Pricing"}
                  subtitle={
                    valueTabFinalState === "value_available_light"
                      ? "A useful nearby value range for this vehicle."
                      : "Nearby pricing for this vehicle when available."
                  }
                />
                <Text style={styles.body}>
                  {estimateSupport?.marketSourceLabel ?? "Nearby pricing support is shown here when available for this vehicle."}
                </Text>
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
                {valuationLoading ? <Text style={styles.valueLoading}>Updating pricing…</Text> : null}
              </View>
              <ValueEstimateCard result={displayValuation} tone={valueTabFinalState === "value_available_light" ? "light" : "strong"} />
              {showQaDebugStrip ? <QaDebugStrip title="QA Value Debug" rows={valueQaRows} /> : null}
            </>
          ) : (
            <>
              <ApproximateDataState
                title="Market data is limited for this vehicle."
                body="We're still showing the best available specs."
                supportNote={
                  trustedResult
                    ? "This vehicle was identified with high confidence, so the specs shown here remain the strongest available details."
                    : "The current result still includes the best available specs while local market coverage catches up."
                }
                badgeLabel={null}
              />
              {showQaDebugStrip ? <QaDebugStrip title="QA Value Debug" rows={valueQaRows} /> : null}
            </>
          )
        ) : (
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
          {isLocked ? (
            <LockedContentPreview
              locked
              title="Value preview"
              description="Preview the market card now. Pro reveals the full value context every time."
            >
              <ValueEstimateCard result={displayValuation} />
            </LockedContentPreview>
          ) : (
            <ValueEstimateCard result={displayValuation} />
          )}
          {showQaDebugStrip ? <QaDebugStrip title="QA Value Debug" rows={valueQaRows} /> : null}
          {isLocked ? (
            <UnlockAccessCard
              remaining={freeUnlocksRemaining}
              limit={freeUnlocksLimit}
              disabled={!vehicle?.id || isUnlocking}
              isUnlocking={isUnlocking}
              onUnlock={async () => {
                if (!vehicle?.id) return;
                const confirmed = await confirmUnlockIfNeeded();
                if (!confirmed) return;
                const result = await useFreeUnlockForVehicle(vehicle.id);
                if (result.ok) {
                  await refreshStatus();
                  Alert.alert("Free unlock applied", result.message);
                  setTab("Value");
                } else {
                  Alert.alert(
                    unlockFailureTitle(result.reason),
                    result.message || errorMessage || "We couldn’t apply your free unlock right now.",
                  );
                }
              }}
              onUpgrade={() => router.push("/paywall")}
            />
          ) : null}
        </>
        )
      ) : null}

      {tab === "For Sale" ? (
        isEstimateMode ? (
          forSaleTabFinalState === "listings_available_strong" || forSaleTabFinalState === "listings_available_light" ? (
            <>
              <View style={styles.sectionCard}>
                <SectionHeader
                  title={forSaleTabFinalState === "listings_available_light" ? "Nearby listings for this model" : "Comparable Listings"}
                  subtitle={
                    forSaleTabFinalState === "listings_available_light"
                      ? "A useful nearby listing for this model."
                      : "Nearby listings for this vehicle when available."
                  }
                />
                <Text style={styles.body}>
                  {listingsSourceLabel ?? "Nearby comparison listings are shown here when available."}
                </Text>
              </View>
              <View style={styles.listingsWrap}>
                {vehicle.listings
                  .slice(0, forSaleTabFinalState === "listings_available_light" ? 1 : vehicle.listings.length)
                  .map((listing, index) => (
                  <ListingCard key={listing.id} listing={listing} isBest={index === 0} />
                ))}
              </View>
              {showQaDebugStrip ? <QaDebugStrip title="QA Listings Debug" rows={listingsQaRows} /> : null}
            </>
          ) : (
            <>
              <ApproximateDataState
                title="Market data is limited for this vehicle."
                body="We're still showing the best available specs."
                supportNote={
                  trustedResult
                    ? "This vehicle was identified with high confidence, so the specs shown here remain the strongest available details."
                    : "The current result still includes the best available specs while local market coverage catches up."
                }
                badgeLabel={null}
              />
              {showQaDebugStrip ? <QaDebugStrip title="QA Listings Debug" rows={listingsQaRows} /> : null}
            </>
          )
        ) : (
        <>
          <View style={styles.sectionCard}>
            <Text style={styles.body}>
              {isLocked
                ? "Nearby listings are shown as a preview in free mode and fully unlocked in Pro."
                : "Nearby listings help you compare local pricing, mileage, and dealer context at a glance."}
            </Text>
          </View>
          {isLocked ? (
            <LockedContentPreview
              locked
              title="Nearby listings preview"
              description="See the full set of local comps and shopping context with Pro."
            >
              <View style={styles.listingsWrap}>
                {vehicle.listings
                  .slice(0, 1)
                  .map((listing, index) => (
                    <ListingCard key={listing.id} listing={listing} isBest={index === 0} />
                  ))}
              </View>
            </LockedContentPreview>
          ) : (
            <View style={styles.listingsWrap}>
              {vehicle.listings.map((listing, index) => (
                <ListingCard key={listing.id} listing={listing} isBest={index === 0} />
              ))}
            </View>
          )}
          {showQaDebugStrip ? <QaDebugStrip title="QA Listings Debug" rows={listingsQaRows} /> : null}
          {isLocked ? (
            <UnlockAccessCard
              remaining={freeUnlocksRemaining}
              limit={freeUnlocksLimit}
              disabled={!vehicle?.id || isUnlocking}
              isUnlocking={isUnlocking}
              onUnlock={async () => {
                if (!vehicle?.id) return;
                const confirmed = await confirmUnlockIfNeeded();
                if (!confirmed) return;
                const result = await useFreeUnlockForVehicle(vehicle.id);
                if (result.ok) {
                  await refreshStatus();
                  Alert.alert("Free unlock applied", result.message);
                  setTab("For Sale");
                } else {
                  Alert.alert(
                    unlockFailureTitle(result.reason),
                    result.message || errorMessage || "We couldn’t apply your free unlock right now.",
                  );
                }
              }}
              onUpgrade={() => router.push("/paywall")}
            />
          ) : null}
        </>
        )
      ) : null}

      {tab === "Photos" ? (
        <View style={styles.sectionCard}>
          <Text style={styles.body}>Your saved scan photos live here for each vehicle. Add more photos as the Garage evolves.</Text>
          <View style={styles.photoFrame}>
            <Image source={{ uri: heroImageUri }} style={styles.photo} resizeMode={heroImageFitMode} />
          </View>
        </View>
      ) : null}
      {isLocked ? (
        <>
          <PrimaryButton
            label="Scan Another Vehicle"
            onPress={() => router.push("/(tabs)/scan")}
          />
          <PrimaryButton label="View Pro Features" secondary onPress={() => router.push("/paywall")} />
        </>
      ) : (
        <PrimaryButton
          label="Scan Another Vehicle"
          secondary={isTrustedUnlockedEstimate}
          onPress={() => router.push("/(tabs)/scan")}
        />
      )}
      </Animated.View>
      <Modal visible={heroPreviewOpen} transparent animationType="fade" onRequestClose={() => setHeroPreviewOpen(false)}>
        <Pressable style={styles.heroModalBackdrop} onPress={() => setHeroPreviewOpen(false)}>
          <Pressable style={styles.heroModalCard} onPress={(event) => event.stopPropagation()}>
            <Image source={{ uri: heroImageUri }} style={styles.heroModalImage} resizeMode={heroImageFitMode} />
            <View style={styles.heroModalBody}>
              <Text style={styles.heroModalTitle}>{resolvedDisplayTitle}</Text>
              <Text style={styles.heroModalSubtitle}>{estimateSubtitle || unlockedDetailSubtitle}</Text>
              {summaryChips.length > 0 ? (
                <View style={styles.heroModalChipRow}>
                  {summaryChips.map((chip) => (
                    <View key={`modal-${chip}`} style={styles.heroChip}>
                      <Text style={styles.heroChipLabel}>{chip}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <PrimaryButton label="Close dossier" secondary onPress={() => setHeroPreviewOpen(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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

function QaDebugStrip({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <View style={styles.qaDebugStrip}>
      <Text style={styles.qaDebugTitle}>{title}</Text>
      {rows.map((row) => (
        <View key={`${title}-${row.label}`} style={styles.qaDebugRow}>
          <Text style={styles.qaDebugLabel}>{row.label}</Text>
          <Text style={styles.qaDebugValue}>{row.value}</Text>
        </View>
      ))}
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
  const used = Math.max(0, limit - Math.max(0, remaining));
  return (
    <View style={styles.unlockCard}>
      <Text style={styles.unlockTitle}>Unlock Full Details</Text>
      <Text style={styles.unlockBody}>This unlock gives full premium access for this vehicle.</Text>
      <Text style={styles.unlockNote}>
        {used} of {limit} free unlocks used • {Math.max(0, remaining)} remaining
      </Text>
      {remaining > 0 ? (
        <PrimaryButton label={isUnlocking ? "Applying unlock..." : "Unlock Full Details"} onPress={onUnlock} disabled={disabled} />
      ) : null}
      <PrimaryButton label="Unlock Pro" secondary onPress={onUpgrade} />
    </View>
  );
}

const styles = StyleSheet.create({
  heroShell: {
    gap: 12,
  },
  heroFrame: {
    width: "100%",
    height: 320,
    borderRadius: Radius.xl,
    overflow: "hidden",
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hero: { width: "100%", height: "100%" },
  heroArtifactCrop: {
    height: "114%",
    transform: [{ translateY: -30 }],
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroMetaCard: {
    ...cardStyles.primary,
    gap: 10,
    padding: 18,
  },
  heroMetaTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  heroTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  heroBadge: {
    backgroundColor: "rgba(0, 194, 255, 0.12)",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.cyanGlow,
  },
  heroBadgeLabel: {
    ...Typography.caption,
    color: Colors.premium,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  heroStatusBadge: {
    backgroundColor: "rgba(29, 140, 255, 0.14)",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.accentGlow,
  },
  heroStatusBadgeLabel: {
    ...Typography.caption,
    color: Colors.accent,
    fontWeight: "700",
  },
  heroTapBadge: {
    backgroundColor: "rgba(4, 12, 24, 0.56)",
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(142, 212, 255, 0.22)",
  },
  heroTapBadgeLabel: {
    ...Typography.caption,
    color: Colors.textSoft,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  heroPressable: {
    borderRadius: Radius.xl,
  },
  heroTitle: { ...Typography.hero, color: Colors.textStrong, fontSize: 30, lineHeight: 34 },
  heroSubtitle: { ...Typography.body, color: Colors.textSoft },
  heroChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  heroChip: {
    backgroundColor: Colors.cardAlt,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroChipLabel: { ...Typography.caption, color: Colors.textStrong },
  heroModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 14, 0.88)",
    justifyContent: "center",
    padding: 20,
  },
  heroModalCard: {
    backgroundColor: "rgba(9, 16, 28, 0.98)",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    gap: 16,
  },
  heroModalImage: {
    width: "100%",
    height: 320,
    backgroundColor: "rgba(2, 6, 12, 0.92)",
  },
  heroModalBody: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    gap: 12,
  },
  heroModalTitle: {
    ...Typography.heading,
    color: Colors.textStrong,
  },
  heroModalSubtitle: {
    ...Typography.body,
    color: Colors.textSoft,
  },
  heroModalChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  imageDebug: { ...Typography.caption, color: Colors.textMuted },
  headerCard: { ...cardStyles.primary, padding: 20, gap: 8 },
  headerCardEstimate: {
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: Colors.accentSoft,
  },
  estimateEyebrow: {
    ...Typography.caption,
    color: Colors.accent,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  title: { ...Typography.title, color: Colors.textStrong },
  headerKicker: {
    ...Typography.caption,
    color: Colors.premium,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  subtitle: { ...Typography.body, color: Colors.textMuted },
  qaResetButton: {
    alignSelf: "flex-start",
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    backgroundColor: Colors.background,
  },
  qaResetButtonLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "700",
  },
  estimateBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(14, 165, 233, 0.12)",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(94, 231, 255, 0.34)",
  },
  estimateBadgeLabel: { ...Typography.caption, color: Colors.premium, fontWeight: "700", letterSpacing: 0.4 },
  estimateNoticeInline: { ...Typography.caption, color: Colors.textMuted, lineHeight: 18 },
  sectionCard: { ...cardStyles.primary, padding: 20, gap: 16 },
  trustedSpecsStack: { gap: 4 },
  approximateStateCard: { ...cardStyles.secondary, gap: 12, padding: 18 },
  approximateStateBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.background,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  approximateStateBadgeLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  approximateStateTitle: { ...Typography.heading, color: Colors.textStrong },
  approximateStateBody: { ...Typography.body, color: Colors.textSoft },
  approximateStateSupport: { ...Typography.caption, color: Colors.textMuted, lineHeight: 18 },
  listingsWrap: { gap: 18 },
  pageContent: { paddingVertical: 24 },
  listingsPageContent: { paddingVertical: 24, backgroundColor: Colors.backgroundAlt },
  body: { ...Typography.body, color: Colors.textMuted },
  row: { borderTopWidth: 1, borderTopColor: Colors.borderSoft, paddingTop: 14, gap: 4 },
  rowLabel: { ...Typography.caption, color: Colors.textMuted },
  rowValue: { ...Typography.body, color: Colors.textStrong },
  specSupportNote: { ...Typography.caption, color: Colors.textMuted, marginTop: -4, marginBottom: 4 },
  specSupportNoteQuiet: { ...Typography.caption, color: Colors.textMuted, marginTop: 6, opacity: 0.88, lineHeight: 18 },
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
  qaDebugStrip: {
    ...cardStyles.secondary,
    gap: 8,
    padding: 14,
    borderColor: "rgba(94, 231, 255, 0.16)",
    backgroundColor: "rgba(7, 14, 24, 0.88)",
  },
  qaDebugTitle: {
    ...Typography.caption,
    color: Colors.premium,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    fontWeight: "700",
  },
  qaDebugRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  qaDebugLabel: {
    ...Typography.caption,
    color: Colors.textMuted,
    flex: 1,
  },
  qaDebugValue: {
    ...Typography.caption,
    color: Colors.textStrong,
    flexShrink: 1,
    textAlign: "right",
  },
  photoFrame: {
    width: "100%",
    height: 220,
    borderRadius: Radius.lg,
    overflow: "hidden",
    backgroundColor: Colors.cardAlt,
  },
  photo: { width: "100%", height: "100%" },
  loadingPage: { flex: 1, gap: 20 },
  loadingWrap: { flex: 1, justifyContent: "center", gap: 18 },
  loadingHeroCard: { ...cardStyles.primaryTint, gap: 16, padding: 18 },
  loadingHeroCopy: { gap: 8 },
  loadingEyebrow: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 1.2 },
  loadingText: { ...Typography.title, color: Colors.textStrong },
  loadingBody: { ...Typography.body, color: Colors.textSoft },
  loadingStack: { gap: 14 },
  unlockCard: { ...cardStyles.secondary, gap: 10 },
  feedbackNotice: { ...Typography.caption, color: Colors.textMuted },
  errorNotice: { ...Typography.caption, color: Colors.dangerSoft },
  unlockTitle: { ...Typography.heading, color: Colors.textStrong },
  unlockBody: { ...Typography.body, color: Colors.textMuted },
  unlockNote: { ...Typography.caption, color: Colors.textMuted },
});
