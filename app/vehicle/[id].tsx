import { Href, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Image, InputAccessoryView, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { EmptyState } from "@/components/EmptyState";
import { ListingCard } from "@/components/ListingCard";
import { LockedContentPreview } from "@/components/LockedContentPreview";
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
import { RuntimeDebugStamp } from "@/components/RuntimeDebugStamp";
import { SectionHeader } from "@/components/SectionHeader";
import { ValueEstimateCard } from "@/components/ValueEstimateCard";
import { Colors, Radius, Typography } from "@/constants/theme";
import { cardStyles } from "@/design/patterns";
import { isFordRangerIdentity, isSafeVehicleImageForIdentity, normalizeVehicleIdentityForRendering, toVehicleImageSource } from "@/constants/vehicleImages";
import { useSubscription } from "@/hooks/useSubscription";
import { buildListingDerivedConditionSetFromListings, getConditionSourceLabel, normalizeSupportedValueCondition, resolveConditionValues } from "@/lib/valueConditionSet";
import { completeCanonicalSpecs, formatCanonicalModelName, sanitizeSpecValue } from "@/lib/canonicalSpecCompletion";
import { formatHorsepowerLabel } from "@/lib/vehicleData";
import { mobileBuildInfo } from "@/lib/env";
import { isProPlan } from "@/lib/subscription";
import { buildSpecialtyVehicleOverview, isSpecialtyExoticMake } from "@/lib/specialtyVehicles";
import { buildVehicleDescription } from "@/lib/vehicleDescription";
import { MarketAreaZipSource, isValidMarketAreaZip, normalizeMarketAreaZip } from "@/lib/marketAreaZip";
import { garageService } from "@/services/garageService";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { marketAreaZipService } from "@/services/marketAreaZipService";
import { scanService } from "@/services/scanService";
import { authService } from "@/services/authService";
import { startupPreferences } from "@/services/startupPreferences";
import { getApiAuthDebug, getLastApiRequestDebug } from "@/services/apiClient";
import { buildVehicleSoftUnlockId, buildVehicleUnlockId } from "@/services/subscriptionService";
import { ListingsDebugMeta, VehicleLookupDescriptor, vehicleService } from "@/services/vehicleService";
import { ValuationResult, VehicleRecord } from "@/types";
import { formatCurrency } from "@/lib/utils";

const allDetailTabs = ["Overview", "Specs", "Value", "For Sale", "Photos"] as const;
const detailTabs = ["Overview", "Value", "Photos"] as const;
const tabs = [...detailTabs];
type DetailTab = (typeof allDetailTabs)[number];
const detailTabLabels: Record<(typeof detailTabs)[number], string> = {
  Overview: "Details",
  Value: "Value & Listings",
  Photos: "Photos",
};
const defaultZip = "";
const defaultMileage = "18400";
const defaultCondition = "Good";
const conditionOptions = ["Fair", "Good", "Excellent"];
const marketInputAccessoryViewID = "vehicle-market-input-accessory";
const MAX_VISIBLE_LIVE_LISTINGS = 12;
const INITIAL_VISIBLE_LIVE_LISTINGS = 6;

function coerceDetailTab(value: unknown): DetailTab | null {
  if (value === "Specs") {
    return "Overview";
  }
  if (value === "Market Value") {
    return "Value";
  }
  if (value === "Listings" || value === "For Sale") {
    return "Value";
  }
  return typeof value === "string" && (allDetailTabs as readonly string[]).includes(value) ? (value as DetailTab) : null;
}

type ListingsMarketContext = {
  zip: string;
  mileage: string;
  zipSource: MarketAreaZipSource;
  radiusMiles: number;
  acceptedListingsCount: number;
  source: "listingsScreen";
};

type ZipStorageDebug = {
  storageKey: string;
  storageVersion: "v4";
  wasLegacy60610Ignored: boolean;
};

type LiveMarketRuntimeDebug = {
  action: string;
  authBelievedSignedIn: boolean | null;
  authHadToken: boolean | null;
  authSentHeader: boolean | null;
  requestPath: string | null;
  requestUrl: string | null;
  valueCode: string | null;
  valueHttpStatus: number | null;
  valueStatus: string | null;
  valueReason: string | null;
  valueSource: string | null;
  listingsCode: string | null;
  listingsHttpStatus: number | null;
  listingsRawCount: number | null;
  listingsBelievableCount: number | null;
  listingsMode: string | null;
  listingsFallbackReason: string | null;
  marketCheckTrace: string | null;
};

const initialLiveMarketRuntimeDebug: LiveMarketRuntimeDebug = {
  action: "idle",
  authBelievedSignedIn: null,
  authHadToken: null,
  authSentHeader: null,
  requestPath: null,
  requestUrl: null,
  valueCode: null,
  valueHttpStatus: null,
  valueStatus: null,
  valueReason: null,
  valueSource: null,
  listingsCode: null,
  listingsHttpStatus: null,
  listingsRawCount: null,
  listingsBelievableCount: null,
  listingsMode: null,
  listingsFallbackReason: null,
  marketCheckTrace: null,
};

function logValueUiTransition(
  label: "VALUE_UI_REFRESH_STARTED" | "VALUE_UI_REFRESH_SUCCESS" | "VALUE_UI_REFRESH_UNAVAILABLE" | "VALUE_UI_REFRESH_ERROR",
  payload: Record<string, unknown>,
) {
  console.log(`[vehicle-detail] ${label}`, payload);
}

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
  const normalizedIdentity = normalizeVehicleIdentityForRendering({
    make: input.make,
    model: input.model,
    vehicleType: input.vehicleType,
    bodyStyle: input.bodyStyle,
  });

  return {
    year: input.year,
    make: input.make,
    model: input.model,
    trim: input.trim ?? null,
    vehicleType: normalizedIdentity.vehicleType,
    bodyStyle: normalizedIdentity.bodyStyle ?? input.bodyStyle ?? null,
    normalizedModel: input.model.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(),
  } satisfies VehicleLookupDescriptor;
}

function normalizeDetailLookupBodyStyle(vehicle: VehicleRecord) {
  const identity = `${vehicle.id} ${vehicle.make} ${vehicle.model}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/\bford\b[\s\S]*\branger\b|\branger\b/.test(identity)) {
    return "Pickup Truck";
  }
  const bodyStyle = vehicle.bodyStyle?.trim();
  return bodyStyle && bodyStyle !== "Estimated vehicle" ? bodyStyle : null;
}

function buildDetailLookupDescriptor(vehicle: VehicleRecord) {
  if (!vehicle.year || !vehicle.make || !vehicle.model) {
    return null;
  }
  const normalizedIdentity = normalizeVehicleIdentityForRendering({
    vehicleId: vehicle.id,
    make: vehicle.make,
    model: vehicle.model,
    vehicleType: vehicle.vehicleType,
    bodyStyle: vehicle.bodyStyle,
  });

  return {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim?.trim() || null,
    vehicleType: normalizedIdentity.vehicleType,
    bodyStyle: normalizedIdentity.bodyStyle ?? normalizeDetailLookupBodyStyle(vehicle),
    normalizedModel: vehicle.model.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(),
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
    status: "ready_to_load",
    selectedCondition: null,
    baseCondition: null,
    conditionValues: null,
    tradeIn: "Unavailable",
    tradeInRange: "Unavailable",
    privateParty: "Unavailable",
    privatePartyRange: "Unavailable",
    dealerRetail: "Unavailable",
    dealerRetailRange: "Unavailable",
    low: null,
    high: null,
    median: null,
    confidenceLabel: "Enter ZIP, mileage, and condition, then load live market value.",
    sourceLabel: "Live market value available on demand",
    message: null,
    reason: null,
    listingCount: null,
    sourceBasis: null,
    modelType: "modeled" as const,
  };
}

function hasStructuredValueEvidence(result: ValuationResult | null | undefined) {
  if (!result) {
    return false;
  }
  if (
    result.status === "loaded_condition_set"
  ) {
    return Boolean(
      result.conditionValues &&
        Object.values(result.conditionValues).some((entry) =>
          [entry.tradeIn, entry.privateParty, entry.dealerRetail, entry.low, entry.median, entry.high].some((value) => !isUnavailableValue(value)),
        ),
    );
  }
  if (
    result.status === "specialty_unavailable" ||
    result.status === "provider_error" ||
    result.status === "no_comps_found" ||
    result.status === "ready_to_load" ||
    result.status === "stale_after_input_change"
  ) {
    return false;
  }
  if (result.status === "loaded_listing_range") {
    return Boolean(result.low || result.high || result.median);
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
    result.sourceLabel !== "No live value source" &&
    result.sourceLabel !== "Live market value available on demand";
  return hasRange || hasMidpoint || hasSourceLabel;
}

function hasResolvedValueState(result: ValuationResult | null | undefined) {
  return (
    hasStructuredValueEvidence(result) ||
    result?.status === "specialty_unavailable" ||
    result?.status === "provider_error" ||
    result?.status === "no_comps_found" ||
    result?.status === "ready_to_load" ||
    result?.status === "stale_after_input_change"
  );
}

function canRenderValueEstimateCard(result: ValuationResult | null | undefined) {
  return Boolean(result && (result.status === "loaded_value" || result.status === "loaded_listing_range" || result.status === "loaded_condition_set"));
}

function shouldDisplayCurrentValuationState(result: ValuationResult | null | undefined) {
  if (!result) {
    return false;
  }
  return (
    hasStructuredValueEvidence(result) ||
    result.status === "specialty_unavailable" ||
    result.status === "provider_error" ||
    result.status === "no_comps_found" ||
    result.status === "ready_to_load" ||
    result.status === "stale_after_input_change"
  );
}

function isModeledFallbackValuation(result: ValuationResult | null | undefined) {
  if (!result) {
    return false;
  }
  return result.valuationSource === "modeled_fallback" || (result.modelType === "modeled" && hasStructuredValueEvidence(result));
}

function shouldReplaceValueFromListings(result: ValuationResult | null | undefined) {
  if (!result) {
    return true;
  }
  if (result.valuationSource === "listing_comps" || result.modelType === "listing_derived") {
    return false;
  }
  return (
    isModeledFallbackValuation(result) ||
    result.status === "no_comps_found" ||
    result.status === "provider_error" ||
    result.status === "specialty_unavailable" ||
    result.status === "ready_to_load" ||
    result.status === "stale_after_input_change"
  );
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
    if (nextHasEvidence || hasResolvedValueState(next)) {
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
  return normalizeSupportedValueCondition(value);
}

function buildValueRequestKey(
  valueLookupInput: string | { vehicleId?: string | null; descriptor?: VehicleLookupDescriptor | null } | null,
  zip: string,
  mileage: string,
) {
  if (!valueLookupInput) {
    return null;
  }

  return [
    typeof valueLookupInput === "string" ? valueLookupInput : valueLookupInput.vehicleId ?? "descriptor",
    zip.trim(),
    mileage.trim(),
  ].join("|");
}

function parseMileageValue(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  return digits.length > 0 ? digits : null;
}

function buildListingsHydratedValuation(input: {
  listings: VehicleRecord["listings"];
  condition: string;
  vehicle: VehicleRecord;
}) {
  const believableListings = input.listings.filter(isBelievableListing);
  console.log("[vehicle-detail] VALUE_COMP_SOURCE", {
    vehicleId: input.vehicle.id,
    source: "shared_vehicle_listings",
    rawListingsCount: input.listings.length,
    believableListingsCount: believableListings.length,
  });
  const derived = buildListingDerivedConditionSetFromListings({
    listings: believableListings,
    selectedCondition: input.condition,
    make: input.vehicle.make,
    sourceLabel: "Based on live MarketCheck listings",
  });
  if (!derived) {
    return null;
  }

  if (derived.status === "loaded_condition_set") {
    return {
      ...derived,
      sourceLabel: getConditionSourceLabel({
        result: derived,
        make: input.vehicle.make,
        model: input.vehicle.model,
      }),
    };
  }

  return derived;
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

function parseYearRangeLabel(value?: string | null) {
  const match = String(value ?? "").match(/\b(\d{4})\s*[-–—]\s*(\d{4})\b/);
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function isOverbroadYearRangeLabel(value?: string | null) {
  const range = parseYearRangeLabel(value);
  return Boolean(range && range.end - range.start > 4);
}

function buildProductionDisplayTitle(input: {
  routeTitle?: string | null;
  yearLabel?: string | null;
  make: string;
  model: string;
  trustedResult: boolean;
  estimateMode: boolean;
}) {
  const makeModel = [input.make, formatCanonicalModelName(input.make, input.model)].filter(Boolean).join(" ").trim();
  const routeTitle = String(input.routeTitle ?? "").trim();
  const polishedRouteTitle = routeTitle
    .replace(/\b4runner\b/gi, "4Runner")
    .replace(/\bct4\b/gi, "CT4")
    .replace(/\bct5\b/gi, "CT5");
  const routeTitleLeaksFamilyRange = isOverbroadYearRangeLabel(routeTitle);
  if (input.estimateMode && (!input.trustedResult || routeTitleLeaksFamilyRange)) {
    return makeModel || routeTitle;
  }
  if (polishedRouteTitle) {
    const range = parseYearRangeLabel(polishedRouteTitle);
    if (range && range.start === range.end) {
      return polishedRouteTitle.replace(/\b\d{4}\s*[-–—]\s*\d{4}\b/, `${range.start}`);
    }
    if (!routeTitleLeaksFamilyRange) {
      return polishedRouteTitle;
    }
  }
  return [input.yearLabel && !isOverbroadYearRangeLabel(input.yearLabel) ? input.yearLabel : null, makeModel].filter(Boolean).join(" ").trim();
}

function buildDetailHeroTitle(title: string) {
  const cleaned = title.replace(/\s*\(est\.\)\s*/gi, " ").replace(/\s+/g, " ").trim();
  return cleaned.replace(/^\d{4}(?:\s*[-–—]\s*\d{4})?\s+/, "").trim() || cleaned;
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
  if (result.status === "loaded_condition_set") {
    const selectedCondition = result.selectedCondition ?? result.baseCondition ?? "good";
    const selected = result.conditionValues?.[selectedCondition];
    const hasListingRange = Boolean(selected?.low || selected?.median || selected?.high);
    const populatedPrimaryValues = [selected?.tradeIn, selected?.privateParty, selected?.dealerRetail].filter((value) => !isUnavailableValue(value)).length;
    if (hasListingRange || populatedPrimaryValues >= 2) {
      return "value_available_strong" as const;
    }
    if (populatedPrimaryValues >= 1) {
      return "value_available_light" as const;
    }
    return "value_unavailable" as const;
  }
  if (result.status === "loaded_listing_range") {
    const listingRangeValues = [result.low, result.median, result.high].filter((value) => !isUnavailableValue(value));
    if (listingRangeValues.length >= 2) {
      return "value_available_strong" as const;
    }
    if (listingRangeValues.length >= 1) {
      return "value_available_light" as const;
    }
    return "value_unavailable" as const;
  }
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

function buildUnavailableValueResult(input: {
  reason: string;
  sourceLabel: string;
  message: string;
  status?: "no_comps_found" | "provider_error";
}): ValuationResult {
  return {
    status: input.status ?? "no_comps_found",
    selectedCondition: null,
    baseCondition: null,
    conditionValues: null,
    tradeIn: "Unavailable",
    tradeInRange: "Unavailable",
    privateParty: "Unavailable",
    privatePartyRange: "Unavailable",
    dealerRetail: "Unavailable",
    dealerRetailRange: "Unavailable",
    low: null,
    high: null,
    median: null,
    confidenceLabel: input.message,
    sourceLabel: input.sourceLabel,
    valuationSource: "unavailable",
    compCount: null,
    confidence: "unavailable",
    rangeLow: null,
    rangeHigh: null,
    midpoint: null,
    unavailableReason: input.reason,
    message: input.message,
    reason: input.reason,
    listingCount: null,
    sourceBasis: null,
    modelType: "modeled",
  };
}

function getApiRequestErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

function getApiRequestErrorStatus(error: unknown) {
  if (typeof error !== "object" || error === null || !("details" in error)) {
    return null;
  }
  const details = (error as { details?: unknown }).details;
  return typeof details === "object" && details !== null && "status" in details && typeof (details as { status?: unknown }).status === "number"
    ? (details as { status: number }).status
    : null;
}

function captureLiveMarketRequestDebug(): Pick<LiveMarketRuntimeDebug, "authBelievedSignedIn" | "authHadToken" | "authSentHeader" | "requestPath" | "requestUrl"> {
  const authDebug = getApiAuthDebug();
  const requestDebug = getLastApiRequestDebug();
  return {
    authBelievedSignedIn: authService.hasActiveSession(),
    authHadToken: authDebug?.hadToken ?? null,
    authSentHeader: authDebug?.sentAuthHeader ?? null,
    requestPath: requestDebug?.path ?? authDebug?.path ?? null,
    requestUrl: requestDebug?.url ?? null,
  };
}

function formatLiveMarketDebugBool(value: boolean | null) {
  return value === null ? "unknown" : value ? "yes" : "no";
}

function formatDebugRoute(value: string | null, maxLength = 74) {
  if (!value) {
    return "none";
  }
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function buildSpecialtyValueStateCopy(input: {
  make: string;
  model: string;
  trustedResult: boolean;
}) {
  return {
    title: "Specialty market value unavailable",
    body: `${input.make} ${input.model} uses specialty-market pricing. We won't show a generic depreciation estimate for this vehicle.`,
    supportNote: input.trustedResult
      ? "Load live market value when you want a current market-based estimate. Pricing can vary widely by mileage, condition, options, service history, and provenance."
      : "This vehicle was identified, but specialty pricing should be loaded from live market data instead of a generic fallback. Pricing can vary widely by mileage, condition, options, service history, and provenance.",
  };
}

function buildValueStatusCardCopy(input: {
  valuation: ValuationResult;
  specialtyValueCopy: ReturnType<typeof buildSpecialtyValueStateCopy> | null;
  zipCode: string;
}) {
  if (!input.zipCode) {
    return {
      title: "Enter a market area ZIP",
      body: "Enter ZIP code for local market pricing before loading live market value.",
      supportNote: "Local market pricing depends on ZIP.",
    };
  }

  switch (input.valuation.status) {
    case "stale_after_input_change":
      return {
        title: "Live market value needs refresh",
        body: input.valuation.message ?? "ZIP or mileage changed since the last live value load.",
        supportNote: input.valuation.confidenceLabel,
      };
    case "provider_error":
      return {
        title: "Live market data could not be loaded",
        body: input.valuation.message ?? "We couldn't load live market data for this request.",
        supportNote: "Try the live market lookup again in a moment.",
      };
    case "no_comps_found":
      if (input.valuation.unavailableReason === "missing_zip_or_mileage" || input.valuation.reason === "missing_zip_or_mileage") {
        return {
          title: "ZIP and mileage required",
          body: input.valuation.message ?? "Enter ZIP, mileage, and condition before loading live market value.",
          supportNote: "Local value needs a market area and mileage.",
        };
      }
      if (input.valuation.unavailableReason === "missing_required_vehicle_identity" || input.valuation.reason === "missing_required_vehicle_identity") {
        return {
          title: "Vehicle identity required",
          body: input.valuation.message ?? "We need year, make, and model before loading market value.",
          supportNote: "Try searching again with a complete vehicle selection.",
        };
      }
      if (input.valuation.unavailableReason === "no_safe_baseline_data" || input.valuation.reason === "no_safe_baseline_data") {
        return {
          title: "No safe baseline data available",
          body:
            input.valuation.message ??
            "No safe baseline data is available after checking live value, cached comps, listings, and modeled fallback data.",
          supportNote: "Try a nearby ZIP or check again later when more market data is available.",
        };
      }
      return {
        title: "No live market comps found",
        body: input.valuation.message ?? "No live market comps found for this ZIP, mileage, and condition.",
        supportNote: "Try a nearby ZIP, broader condition, or check again later when more listings are available.",
      };
    case "specialty_unavailable":
      return (
        input.specialtyValueCopy ?? {
          title: "Specialty market value unavailable",
          body: "We won't show a generic depreciation estimate for this vehicle.",
          supportNote: "Load live market value when you want current specialty pricing.",
        }
      );
    case "ready_to_load":
      return {
        title: "Live market value ready",
        body: "Live market pricing is available on demand for this ZIP, mileage, and condition.",
        supportNote: "Press Load live market value when you're ready to check current pricing.",
      };
    default:
      return {
        title: "Live market value unavailable",
        body: input.valuation.message ?? "We don't have a trusted market value for this vehicle yet.",
        supportNote: input.valuation.confidenceLabel,
      };
  }
}

function ApproximateDataState({
  title,
  body,
  supportNote,
  actionLabel,
  onAction,
  badgeLabel = "Availability",
  secondaryAction = true,
  actionDisabled = false,
  loading = false,
}: {
  title: string;
  body: string;
  supportNote?: string;
  actionLabel?: string;
  onAction?: () => void;
  badgeLabel?: string | null;
  secondaryAction?: boolean;
  actionDisabled?: boolean;
  loading?: boolean;
}) {
  return (
    <View style={styles.approximateStateCard}>
      {badgeLabel ? (
        <View style={styles.approximateStateBadge}>
          <Text style={styles.approximateStateBadgeLabel}>{badgeLabel}</Text>
        </View>
      ) : null}
      {loading ? <ActivityIndicator color={Colors.textStrong} /> : null}
      <Text style={styles.approximateStateTitle}>{title}</Text>
      <Text style={styles.approximateStateBody}>{body}</Text>
      {supportNote ? <Text style={styles.approximateStateSupport}>{supportNote}</Text> : null}
      {actionLabel && onAction ? <PremiumDetailButton label={actionLabel} secondary={secondaryAction} onPress={onAction} disabled={actionDisabled} /> : null}
    </View>
  );
}

function PremiumDetailButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      style={[styles.detailActionButton, secondary && styles.detailActionButtonSecondary, disabled && styles.detailActionButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      {secondary ? (
        <Text style={[styles.detailActionLabel, styles.detailActionLabelSecondary]}>{label}</Text>
      ) : (
        <LinearGradient colors={["#D8A36B", "#B6844F"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.detailActionGradient}>
          <Text style={styles.detailActionLabel}>{label}</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

function VehicleDetailContainer({
  children,
  scroll = true,
  contentContainerStyle,
}: PropsWithChildren<{
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
}>) {
  const content = (
    <>
      <View style={styles.pageGlowAmber} pointerEvents="none" />
      <View style={styles.pageGlowGraphite} pointerEvents="none" />
      {children}
    </>
  );

  return (
    <SafeAreaView style={styles.vehicleSafeArea} edges={["top", "right", "bottom", "left"]}>
      <LinearGradient colors={["#030405", "#0A0A09", "#040405"]} style={styles.vehicleGradient}>
        {scroll ? (
          <ScrollView
            style={styles.vehicleScroll}
            contentContainerStyle={[styles.vehicleContent, contentContainerStyle]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScrollBeginDrag={() => Keyboard.dismiss()}
          >
            {content}
          </ScrollView>
        ) : (
          <View style={[styles.vehicleContent, styles.vehicleStaticContent, contentContainerStyle]}>{content}</View>
        )}
      </LinearGradient>
    </SafeAreaView>
  );
}

function DetailSectionNav({
  activeTab,
  onChange,
}: {
  activeTab: DetailTab;
  onChange: (tab: DetailTab) => void;
}) {
  return (
    <View style={styles.detailTabRail}>
      {tabs.map((item) => {
        const active = item === activeTab;
        return (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              Keyboard.dismiss();
              onChange(item);
            }}
            style={[styles.detailTabButton, active && styles.detailTabButtonActive]}
          >
            <Text style={[styles.detailTabLabel, active && styles.detailTabLabelActive]}>{detailTabLabels[item]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DetailBackButton({ fallbackHref }: { fallbackHref: Href }) {
  const handlePress = () => {
    console.log("[tap] vehicle-detail-back", { fallbackHref });
    if (typeof router.canGoBack === "function" && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(fallbackHref);
  };

  return (
    <Pressable style={styles.detailBackButton} onPress={handlePress} accessibilityRole="button">
      <Ionicons name="chevron-back" size={18} color="#F5F3EE" />
      <Text style={styles.detailBackLabel}>Back</Text>
    </Pressable>
  );
}

function buildMarketMetrics(result: ValuationResult) {
  const conditionSetMode = result.status === "loaded_condition_set";
  const listingRangeMode =
    result.status === "loaded_listing_range" ||
    (conditionSetMode &&
      result.conditionValues != null &&
      Boolean(result.low || result.median || result.high) &&
      result.tradeIn === "Unavailable" &&
      result.privateParty === "Unavailable");

  return listingRangeMode
    ? [
        { label: "Low", value: result.low ?? "Unavailable", range: result.listingCount ? `${result.listingCount} comps` : "Comparable listings" },
        { label: "Median", value: result.median ?? "Unavailable", range: result.sourceLabel },
        { label: "High", value: result.high ?? "Unavailable", range: result.confidenceLabel },
      ]
    : [
        { label: "Trade-in", value: result.tradeIn, range: result.tradeInRange },
        { label: "Private", value: result.privateParty, range: result.privatePartyRange },
        { label: "Retail", value: result.dealerRetail, range: result.dealerRetailRange },
      ];
}

function PremiumMarketValueCard({
  result,
  loading = false,
}: {
  result: ValuationResult;
  loading?: boolean;
}) {
  const metrics = buildMarketMetrics(result);
  const visibleMetrics = metrics.filter((metric) => !isUnavailableValue(metric.value));
  const primaryValue =
    visibleMetrics.find((metric) => metric.label === "Private")?.value ??
    visibleMetrics.find((metric) => metric.label === "Median")?.value ??
    visibleMetrics[0]?.value ??
    "Value pending";
  const sourceLabel = result.valuationSource === "listing_comps" ? "Market Value" : "Reference Value";

  return (
    <View style={styles.marketValueCard}>
      <View style={styles.premiumSectionHeader}>
        <Text style={styles.marketValueLabel}>{sourceLabel}</Text>
      </View>
      <Text style={styles.marketValueHeading}>{primaryValue}</Text>
      {visibleMetrics.length > 1 ? (
        <View style={styles.marketMetricGrid}>
          {visibleMetrics.map((metric, index) => (
          <View key={`${metric.label}-${index}`} style={styles.marketMetricCard}>
            <Text style={styles.marketMetricLabel}>{metric.label}</Text>
            <Text style={styles.marketMetricValue}>{metric.value}</Text>
          </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.marketSource}>{result.sourceLabel}</Text>
      <Text style={styles.marketConfidence}>{result.confidenceLabel}</Text>
      {loading ? <ActivityIndicator color="#E7B97F" /> : null}
    </View>
  );
}

function ReferenceValueCard({ vehicle, compact = false }: { vehicle: VehicleRecord; compact?: boolean }) {
  if (!vehicle.specs.msrp || vehicle.specs.msrp <= 0) {
    return null;
  }
  return (
    <View style={[styles.referenceValueCard, compact && styles.referenceValueCardCompact]}>
      <View style={styles.premiumSectionHeader}>
        <Text style={styles.referenceValueLabel}>Reference Value</Text>
      </View>
      <Text style={styles.referenceValueAmount}>{formatCurrency(vehicle.specs.msrp)}</Text>
      <Text style={styles.referenceValueBody}>
        {compact ? "Based on local canonical data" : "Local canonical MSRP/reference data. Live market value loads only when you request it."}
      </Text>
    </View>
  );
}

function LockedValueListingsCard({
  vehicle,
  loading,
  disabled,
  onPress,
}: {
  vehicle: VehicleRecord;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const referenceValue = vehicle.specs.msrp && vehicle.specs.msrp > 0 ? formatCurrency(vehicle.specs.msrp) : null;
  return (
    <Pressable
      style={[styles.lockedValueCard, disabled && styles.lockedValueCardDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Unlock Value and Listings"
    >
      <View style={styles.lockedValueHeader}>
        <View style={styles.lockedValueIcon}>
          <Ionicons name="lock-closed-outline" size={18} color="#E7B97F" />
        </View>
        <View style={styles.lockedValueCopy}>
          <Text style={styles.lockedValueTitle}>Value & Listings locked</Text>
          <Text style={styles.lockedValueBody}>Unlock once to load live market value and nearby listings.</Text>
        </View>
      </View>
      {referenceValue ? (
        <View style={styles.lockedReferenceStrip}>
          <View>
            <Text style={styles.lockedReferenceLabel}>Reference Value</Text>
            <Text style={styles.lockedReferenceBody}>Based on local canonical data</Text>
          </View>
          <Text style={styles.lockedReferenceValue}>{referenceValue}</Text>
        </View>
      ) : null}
      <View style={styles.lockedValueCta}>
        {loading ? <ActivityIndicator color="#0B0907" /> : <Text style={styles.lockedValueCtaText}>Unlock Value & Listings</Text>}
        {!loading ? <Ionicons name="chevron-forward" size={17} color="#0B0907" /> : null}
      </View>
    </Pressable>
  );
}

function PremiumListingsSection({
  listings,
  locked,
  loading,
  fallbackImageSource,
  debugMeta,
}: {
  listings: VehicleRecord["listings"];
  locked: boolean;
  loading: boolean;
  fallbackImageSource?: ImageSourcePropType | null;
  debugMeta?: ListingsDebugMeta | null;
}) {
  const [showAllListings, setShowAllListings] = useState(false);
  const believableListings = listings.filter(isBelievableListing);
  const priceListings = listings.filter((listing) => safeListingText(listing.price, "") !== "");
  const displayListings = priceListings.length > 0
    ? [...priceListings].sort((a, b) => Number(isBelievableListing(b)) - Number(isBelievableListing(a)))
    : listings;
  const canExpandListings = displayListings.length > INITIAL_VISIBLE_LIVE_LISTINGS;
  const visibleListings = showAllListings
    ? displayListings
    : displayListings.slice(0, INITIAL_VISIBLE_LIVE_LISTINGS);
  useEffect(() => {
    setShowAllListings(false);
  }, [displayListings.length]);
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    console.log("[vehicle-detail] LISTINGS_RENDER_ARRAY_TRACE", {
      totalListingsReceived: listings.length,
      listingsWithUrl: listings.filter((listing) => Boolean(getOpenableListingUrl(listing))).length,
      listingsWithoutUrl: listings.filter((listing) => !getOpenableListingUrl(listing)).length,
      firstThreeUrls: listings.slice(0, 3).map((listing) => getOpenableListingUrl(listing)),
      believableListingsUsedByOldRenderer: believableListings.length,
      priceListingsAvailable: priceListings.length,
      badgeCount: displayListings.length,
      rendererCount: visibleListings.length,
      showAllListings,
      showMoreVisible: canExpandListings,
    });
  }, [believableListings.length, canExpandListings, displayListings.length, listings.length, priceListings.length, showAllListings, visibleListings.length]);
  const providerAuthFailed = debugMeta?.fallbackReason === "provider_auth_failed";
  const noListingsReason =
    providerAuthFailed
      ? "MarketCheck rejected the backend credentials before listings could be searched."
      : debugMeta?.fallbackReason === "provider_error"
      ? "Live listings could not be loaded. Check the market settings and try refreshing."
      : debugMeta?.rawCount === 0 || debugMeta?.mode === "none"
        ? "No nearby live listings found for this exact match."
        : listings.length > 0
          ? "Listings were returned, but none had enough price and seller detail to show confidently."
          : "No nearby live listings found for this exact match.";
  const noListingsContext =
    providerAuthFailed
      ? "This is a provider authentication problem, not a nearby inventory shortage."
      : debugMeta?.sourceLabel && debugMeta.sourceLabel !== "Live listings could not be loaded"
      ? debugMeta.sourceLabel
      : "If a market value is shown, it may be based on available comps, cached data, or modeled fallback rather than visible nearby listings.";
  const noListingsTitle = providerAuthFailed
    ? "Provider authentication failed"
    : debugMeta?.fallbackReason === "provider_error"
      ? "Live listings could not be loaded"
      : "No nearby live listings found";

  return (
    <View style={styles.listingsPanel}>
      <View style={styles.tabIntroCompact}>
        <Text style={styles.listingsKicker}>Similar Listings</Text>
        <View style={styles.listingsHeaderBadges}>
          <View style={styles.listingsVersionBadge}>
            <Text style={styles.listingsVersionText}>Listings UI v935c1bc</Text>
          </View>
          <View style={styles.premiumBadge}>
            <Text style={styles.premiumBadgeText}>{locked ? "Locked" : displayListings.length > 0 ? `${displayListings.length} comps` : loading ? "Loading" : "None found"}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.listingsPanelBody}>
        {locked
          ? "Unlock once to load live market value and nearby listings for this vehicle."
          : displayListings.length > 0
            ? "Nearby comps help ground the market view with price, mileage, and seller context."
            : loading
              ? "Searching live nearby listings for current comparable vehicles."
              : noListingsReason}
      </Text>
      {locked ? (
        <View style={styles.lockedPreviewStack} pointerEvents="none">
          {[0, 1].map((item) => (
            <View key={item} style={styles.lockedPreviewRow}>
              <View style={styles.lockedPreviewLineShort} />
              <View style={styles.lockedPreviewLineLong} />
              <Ionicons name="lock-closed-outline" size={14} color="rgba(172,178,190,0.68)" />
            </View>
          ))}
        </View>
      ) : displayListings.length > 0 ? (
        <View style={styles.premiumListingStack}>
          {visibleListings.map((listing, index) => (
            <PremiumListingRow key={`${listing.id || listing.title}-${index}`} listing={listing} fallbackImageSource={fallbackImageSource} />
          ))}
          {canExpandListings ? (
            <Pressable
              style={styles.showMoreListingsButton}
              onPress={() => setShowAllListings((current) => !current)}
              accessibilityRole="button"
            >
              <Text style={styles.showMoreListingsLabel}>
                {showAllListings ? "Show Less" : `Show More Listings (${displayListings.length - visibleListings.length} more)`}
              </Text>
              <Ionicons name={showAllListings ? "chevron-up" : "chevron-down"} size={17} color="#E7B97F" />
            </Pressable>
          ) : null}
        </View>
      ) : !loading ? (
        <View style={styles.listingsEmptyCard}>
          <Ionicons name={providerAuthFailed ? "alert-circle-outline" : "search-outline"} size={18} color="#E7B97F" />
          <View style={styles.listingsEmptyCopy}>
            <Text style={styles.listingsEmptyTitle}>{noListingsTitle}</Text>
            <Text style={styles.listingsEmptyBody}>{noListingsContext}</Text>
          </View>
        </View>
      ) : null}
      {loading ? <ActivityIndicator color="#E7B97F" /> : null}
    </View>
  );
}

function PremiumListingRow({
  listing,
  fallbackImageSource,
}: {
  listing: VehicleRecord["listings"][number];
  fallbackImageSource?: ImageSourcePropType | null;
}) {
  const price = safeListingText(listing.price, "Price unavailable");
  const mileage = safeListingText(listing.mileage, "Mileage unavailable");
  const distance = safeListingText(listing.distance, "");
  const location = safeListingText(listing.location, "Location unavailable");
  const source = safeListingText(listing.sourceLabel || listing.dealer, "Marketplace");
  const listingUrl = getOpenableListingUrl(listing);
  const imageSource =
    typeof listing.imageUrl === "string" && listing.imageUrl.trim().length > 0
      ? { uri: listing.imageUrl.trim() }
      : fallbackImageSource ?? null;

  const openListing = useCallback(async () => {
    if (!listingUrl) {
      console.warn("[vehicle-detail] LISTING_OPEN_BLOCKED", {
        listingId: listing.id,
        reason: "missing-openable-url",
        hasListingUrl: Boolean(listing.listingUrl),
      });
      return;
    }
    try {
      console.log("[vehicle-detail] LISTING_OPEN_REQUESTED", {
        listingId: listing.id,
        urlHost: getSafeUrlHost(listingUrl),
        handler: "in-app-browser",
        hasListingUrl: Boolean(listing.listingUrl),
      });
      await WebBrowser.openBrowserAsync(listingUrl);
    } catch (error) {
      console.warn("[vehicle-detail] LISTING_IN_APP_BROWSER_FAILED", {
        listingId: listing.id,
        urlHost: getSafeUrlHost(listingUrl),
        message: error instanceof Error ? error.message : String(error),
      });
      try {
        await Linking.openURL(listingUrl);
      } catch (fallbackError) {
        console.warn("[vehicle-detail] LISTING_OPEN_FALLBACK_FAILED", {
          listingId: listing.id,
          urlHost: getSafeUrlHost(listingUrl),
          message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }
  }, [listing.id, listing.listingUrl, listingUrl]);

  return (
    <Pressable
      style={[styles.premiumListingRow, !listingUrl && styles.premiumListingRowDisabled]}
      onPress={openListing}
      disabled={!listingUrl}
      accessibilityRole="link"
      accessibilityLabel={listingUrl ? `Open listing for ${listing.title}` : `Listing link unavailable for ${listing.title}`}
    >
      {imageSource ? <Image source={imageSource} style={styles.premiumListingImage} resizeMode="cover" /> : <View style={styles.premiumListingImageFallback} />}
      <View style={styles.premiumListingCopy}>
        <Text style={styles.premiumListingSource} numberOfLines={1}>{source}</Text>
        <Text style={styles.premiumListingPrice}>{price}</Text>
        <Text style={styles.premiumListingMeta} numberOfLines={1}>{[mileage, distance, location].filter(Boolean).join(" • ")}</Text>
      </View>
      <View style={[styles.premiumListingAction, !listingUrl && styles.premiumListingActionDisabled]} pointerEvents="none">
        <Ionicons name={listingUrl ? "open-outline" : "link-outline"} size={18} color={listingUrl ? "#E7B97F" : "rgba(231, 185, 127, 0.38)"} />
      </View>
    </Pressable>
  );
}

function safeListingText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function getOpenableListingUrl(listing: VehicleRecord["listings"][number]) {
  const candidates = [listing.listingUrl].filter((value): value is string => typeof value === "string");
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

function getSafeUrlHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function normalizePhotoMatchPart(value: string | number | null | undefined) {
  return `${value ?? ""}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function listingImageMatchesVehicle(listing: VehicleRecord["listings"][number], vehicle: VehicleRecord) {
  if (typeof listing.imageUrl !== "string" || listing.imageUrl.trim().length === 0 || !isBelievableListing(listing)) {
    return false;
  }
  if (vehicle.isSampleVehicle && listing.isSampleListing) {
    return true;
  }

  const title = normalizePhotoMatchPart(listing.title);
  const make = normalizePhotoMatchPart(vehicle.make);
  const model = normalizePhotoMatchPart(vehicle.model);
  const year = vehicle.year > 0 ? String(vehicle.year) : "";
  const modelTokens = model.split(" ").filter((part) => part.length >= 2);
  const hasModel = modelTokens.length > 0 && modelTokens.every((part) => title.split(" ").includes(part));
  const hasMake = make.length > 0 && title.includes(make);
  const hasYear = year.length > 0 && title.includes(year);

  return hasModel && (hasMake || hasYear || model.length <= 4);
}

function capitalizeCondition(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
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
  identity?: { year?: number | null; make?: string | null; model?: string | null },
) {
  const engine = sanitizeSpecValue(approximateSupport?.sharedSpecs.engine, "") || sanitizeSpecValue(groundedRecord?.specs.engine, "") || "Unknown";
  return completeCanonicalSpecs({
    year: identity?.year ?? groundedRecord?.year ?? null,
    make: identity?.make ?? groundedRecord?.make ?? "",
    model: identity?.model ?? groundedRecord?.model ?? "",
    specs: {
    engine,
    horsepower: groundedRecord?.specs.horsepower ?? null,
    torque: groundedRecord?.specs.torque ?? "Unknown",
    transmission: approximateSupport?.sharedSpecs.transmission ?? groundedRecord?.specs.transmission ?? "Unknown",
    drivetrain: approximateSupport?.sharedSpecs.drivetrain ?? groundedRecord?.specs.drivetrain ?? "Unknown",
    mpgOrRange: approximateSupport?.sharedSpecs.mpgOrRange ?? groundedRecord?.specs.mpgOrRange ?? "Unknown",
    exteriorColors: groundedRecord?.specs.exteriorColors ?? [],
    msrp:
      approximateSupport?.msrpRangeLabel && approximateSupport.msrpRangeLabel.includes(" - ")
        ? 0
        : groundedRecord?.specs.msrp ?? 0,
    },
  });
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
  const { id, imageUri, scanId, estimate, titleLabel, yearLabel, make, model, trimLabel, vehicleType, confidence, unlockId, garageSource, reopenedSource, trustedCase, resultSource, isSampleVehicle: sampleVehicleParam, source: routeSource, initialTab, marketIntent } = useLocalSearchParams<{
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
    isSampleVehicle?: string;
    source?: string;
    initialTab?: string;
    marketIntent?: string;
  }>();
  const [vehicle, setVehicle] = useState<VehicleRecord | null>(null);
  const [valuation, setValuation] = useState<ValuationResult>(createEmptyValuation());
  const [zipCode, setZipCode] = useState(defaultZip);
  const [zipSource, setZipSource] = useState<MarketAreaZipSource>("blank");
  const [zipStorageDebug, setZipStorageDebug] = useState<ZipStorageDebug | null>(null);
  const [mileage, setMileage] = useState(defaultMileage);
  const [condition, setCondition] = useState(defaultCondition);
  const [valuationLoading, setValuationLoading] = useState(false);
  const [listingsRefreshLoading, setListingsRefreshLoading] = useState(false);
  const [listingsMarketContext, setListingsMarketContext] = useState<ListingsMarketContext | null>(null);
  const [valueDebugStatus, setValueDebugStatus] = useState<ValueDebugStatus>("idle");
  const [valueDebugOrigin, setValueDebugOrigin] = useState<ValueDebugOrigin>("hydrated");
  const [valueDebugUpdateCount, setValueDebugUpdateCount] = useState(0);
  const [valueDebugUpdatedAt, setValueDebugUpdatedAt] = useState<string | null>(null);
  const [listingsDebugMeta, setListingsDebugMeta] = useState<ListingsDebugMeta | null>(null);
  const [liveMarketRuntimeDebug, setLiveMarketRuntimeDebug] = useState<LiveMarketRuntimeDebug>(initialLiveMarketRuntimeDebug);
  const initialRouteTab = coerceDetailTab(initialTab);
  const routeMarketIntent =
    marketIntent === "value" || marketIntent === "listings" || marketIntent === "bundle" ? marketIntent : null;
  const [tab, setTab] = useState<DetailTab>(initialRouteTab ?? "Overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [marketZipInitialized, setMarketZipInitialized] = useState(false);
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
  const routeMarketIntentHandledRef = useRef<string | null>(null);
  const marketUnlockConfirmationOpenRef = useRef(false);
  const marketUnlockSpendInFlightRef = useRef(false);
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroTranslate = useRef(new Animated.Value(12)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(16)).current;
  const {
    status: usage,
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
  const unlockFailureTitle = (reason?: string) =>
    reason === "payload_too_thin" ? "Unlock protected" : reason === "backend_error" ? "Unlock service unavailable" : "Unlock unavailable";
  const isEstimateMode = estimate === "1" || id.startsWith("estimate:");
  const isSampleDetail =
    sampleVehicleParam === "1" ||
    routeSource === "sample_vehicle" ||
    resultSource === "sample_vehicle" ||
    id.endsWith("-sample") ||
    vehicle?.isSampleVehicle === true;
  const showQaDebugStrip = false;
  const isPro = isProPlan(usage?.plan);
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
  const accessState: "locked" | "unlocked" = isSampleDetail || isPro || unlockedForVehicle ? "unlocked" : "locked";
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
    titleLabel: "",
    yearLabel:
      typeof yearLabel === "string" && yearLabel.trim().length > 0
        ? isOverbroadYearRangeLabel(yearLabel)
          ? ""
          : yearLabel.replace(/\s*\(est\.\)\s*/i, "").trim()
        : vehicle?.year
          ? `${vehicle.year}`
          : "",
    make: typeof make === "string" && make.trim().length > 0 ? make : vehicle?.make ?? "",
    model: formatCanonicalModelName(
      typeof make === "string" && make.trim().length > 0 ? make : vehicle?.make ?? "",
      typeof model === "string" && model.trim().length > 0 ? model : vehicle?.model ?? "",
    ),
    trimLabel: typeof trimLabel === "string" && trimLabel.trim().length > 0 ? trimLabel : vehicle?.trim ?? "",
    confidence: typeof confidence === "string" ? confidence : "",
    trustedCase: trustedResult,
    source: typeof resultSource === "string" ? resultSource : "",
  };
  finalDisplayIdentity.titleLabel = buildProductionDisplayTitle({
    routeTitle: typeof titleLabel === "string" ? titleLabel : null,
    yearLabel: finalDisplayIdentity.yearLabel,
    make: finalDisplayIdentity.make || vehicle?.make || "",
    model: finalDisplayIdentity.model || vehicle?.model || "",
    trustedResult,
    estimateMode: isEstimateMode,
  });
  const resolvedDisplayTitle = finalDisplayIdentity.titleLabel || `${vehicle?.year ?? ""} ${vehicle?.make ?? ""} ${formatCanonicalModelName(vehicle?.make, vehicle?.model)}`.trim();
  const resolvedHeroTitle = buildDetailHeroTitle(resolvedDisplayTitle);
  const normalizedRenderedIdentity = useMemo(
    () =>
      normalizeVehicleIdentityForRendering({
        vehicleId: vehicle?.id ?? (typeof id === "string" ? id : null),
        make: vehicle?.make ?? (typeof make === "string" ? make : null),
        model: vehicle?.model ?? (typeof model === "string" ? model : null),
        vehicleType: vehicle?.vehicleType ?? (typeof vehicleType === "string" ? vehicleType : null),
        bodyStyle: vehicle?.bodyStyle ?? null,
      }),
    [id, make, model, vehicle?.bodyStyle, vehicle?.id, vehicle?.make, vehicle?.model, vehicle?.vehicleType, vehicleType],
  );
  const resolvedDisplayBodyStyle = normalizedRenderedIdentity.bodyStyle || vehicle?.bodyStyle || (typeof vehicleType === "string" ? vehicleType : "") || "Vehicle";
  const resolvedDisplayVehicleType = normalizedRenderedIdentity.vehicleType;
  if (vehicle) {
    console.log("[vehicle-detail] FRONTEND_BODY_STYLE_RENDERED", {
      routeId: id,
      vehicleId: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      bodyStyle: resolvedDisplayBodyStyle,
      vehicleType: resolvedDisplayVehicleType,
      rawBodyStyle: vehicle.bodyStyle,
      rawVehicleType: vehicle.vehicleType ?? null,
    });
    if (isFordRangerIdentity(vehicle) && resolvedDisplayVehicleType !== "truck") {
      console.warn("[vehicle-detail] RANGER_NORMALIZATION_LOST", {
        routeId: id,
        vehicleId: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        bodyStyle: resolvedDisplayBodyStyle,
        vehicleType: resolvedDisplayVehicleType,
      });
    }
  }
  const resolvedDisplayTrim = trustedResult ? "" : finalDisplayIdentity.trimLabel || vehicle?.trim || "";
  const estimateSubtitle = isEstimateMode
    ? [
        trustedResult ? "High-confidence identification" : "Photo-based identification",
        resolvedDisplayBodyStyle || null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" • ")
    : null;
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
          : null
        : finalDisplayIdentity.yearLabel || (vehicle ? `${vehicle.year}` : null),
      resolvedDisplayBodyStyle || null,
      horsepowerSupport?.value || (vehicle?.specs.horsepower ? formatHorsepowerLabel(vehicle.specs.horsepower) : null),
      vehicle?.specs.drivetrain && vehicle.specs.drivetrain !== "Unavailable" ? vehicle.specs.drivetrain : null,
      vehicle?.specs.msrp && vehicle.specs.msrp > 0 ? formatCurrency(vehicle.specs.msrp) : null,
    ].filter((entry): entry is string => Boolean(entry));
    return chips.slice(0, 4);
  }, [
    estimateSupport?.yearRangeLabel,
    finalDisplayIdentity.yearLabel,
    horsepowerSupport?.value,
    isEstimateMode,
    resolvedDisplayBodyStyle,
    trustedResult,
    vehicle,
    yearLabel,
  ]);
  const unlockStatusTitle = hasFullAccess
    ? feedbackMessage?.toLowerCase().includes("free unlock")
      ? "Free unlock applied"
      : "Value & Listings unlocked"
    : "Value & Listings locked";
  const unlockStatusBody = hasFullAccess
    ? "This vehicle is now fully unlocked"
    : "Unlock once to load live market value and nearby listings.";
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
  const updateSavedGarageMarketSnapshot = useCallback(
    (input: {
      valuation: ValuationResult;
      listings?: VehicleRecord["listings"] | null;
      source: "live_value" | "live_listings";
    }) => {
      if (isSampleDetail || !resolvedUnlockId || !hasStructuredValueEvidence(input.valuation)) {
        return;
      }

      void garageService
        .updateLocalEstimateMarketSnapshot({
          unlockId: resolvedUnlockId,
          valuation: input.valuation,
          listings: input.listings ?? vehicle?.listings ?? null,
          source: input.source,
        })
        .then((updatedItem) => {
          if (__DEV__) {
            console.log("[vehicle-detail] GARAGE_MARKET_SNAPSHOT_SYNCED", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              unlockId: resolvedUnlockId,
              source: input.source,
              updated: Boolean(updatedItem),
              garageItemId: updatedItem?.id ?? null,
              providerCall: false,
            });
          }
        })
        .catch((err) => {
          console.log("[vehicle-detail] GARAGE_MARKET_SNAPSHOT_SYNC_FAILED", {
            routeId: id,
            scanId: typeof scanId === "string" ? scanId : null,
            unlockId: resolvedUnlockId,
            source: input.source,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [id, isSampleDetail, resolvedUnlockId, scanId, vehicle?.listings],
  );
  const baseDisplayValuation = shouldDisplayCurrentValuationState(valuation) ? valuation : strongestValuationRef.current;
  const conditionAwareDisplayValuation = useMemo(() => {
    const resolved = resolveConditionValues(baseDisplayValuation, condition);
    if (resolved.status === "loaded_condition_set") {
      return {
        ...resolved,
        sourceLabel: getConditionSourceLabel({
          result: resolved,
          make: vehicle?.make ?? null,
          model: vehicle?.model ?? null,
        }),
      };
    }
    return resolved;
  }, [baseDisplayValuation, condition, vehicle?.make, vehicle?.model]);
  const displayValuation = conditionAwareDisplayValuation;
  const displayedValueOrigin: ValueDebugOrigin =
    !shouldDisplayCurrentValuationState(valuation) && hasStructuredValueEvidence(strongestValuationRef.current)
      ? "sticky_fallback"
      : valueDebugOrigin;
  const hasApproximateValue = hasStructuredValueEvidence(displayValuation);
  const hasResolvedValue = hasResolvedValueState(displayValuation);
  const specialtyValueUnavailable = displayValuation.status === "specialty_unavailable" || displayValuation.modelType === "specialty_unavailable";
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
  const confirmVehicleMarketUnlockSpend = useCallback(async () => {
    if (marketUnlockConfirmationOpenRef.current) {
      return false;
    }
    marketUnlockConfirmationOpenRef.current = true;
    const remainingLine = Number.isFinite(freeUnlocksRemaining)
      ? `\n\nYou have ${freeUnlocksRemaining} ${freeUnlocksRemaining === 1 ? "unlock" : "unlocks"} remaining.`
      : "";
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Use 1 unlock?",
        `This will unlock live market value and nearby listings for this vehicle.${remainingLine}`,
        [
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => resolve(false),
          },
          {
            text: "Use Unlock",
            onPress: () => resolve(true),
          },
        ],
      );
    });
    marketUnlockConfirmationOpenRef.current = false;
    return confirmed;
  }, [freeUnlocksRemaining]);
  const buildVehicleMarketUnlockSuccessBody = useCallback((alreadyUnlocked: boolean) => {
    const nextRemaining = Number.isFinite(freeUnlocksRemaining)
      ? alreadyUnlocked
        ? freeUnlocksRemaining
        : Math.max(0, freeUnlocksRemaining - 1)
      : null;
    return `Live market value and nearby listings are unlocked for this vehicle.${nextRemaining != null ? `\n\n${nextRemaining} ${nextRemaining === 1 ? "unlock" : "unlocks"} remaining.` : ""}`;
  }, [freeUnlocksRemaining]);
  const trustedUnlockedYear = vehicle?.year || Number.parseInt(typeof yearLabel === "string" ? yearLabel : "", 10) || null;
  const trustedUnlockedMake = vehicle?.make || (typeof make === "string" ? make : "");
  const trustedUnlockedModel = vehicle?.model || (typeof model === "string" ? model : "");
  const unlockedEstimateCase = Boolean(isEstimateMode && hasFullAccess);
  const trustedUnlockedCase = Boolean(unlockedEstimateCase && trustedResult);
  const trustedValueAvailable = Boolean(unlockedEstimateCase && hasResolvedValue);
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
  const valueLookupInput = useMemo(() => {
    if (!vehicle) {
      return null;
    }
    if (isEstimateMode) {
      if (estimateSupport?.groundedVehicleDescriptor) {
        return {
          vehicleId: estimateSupport.groundedVehicleId,
          descriptor: estimateSupport.groundedVehicleDescriptor,
        };
      }
      if (estimateSupport?.groundedVehicleId) {
        return {
          vehicleId: estimateSupport.groundedVehicleId,
          descriptor: null,
        };
      }
      return null;
    }
    return {
      vehicleId: vehicle.id,
      descriptor: buildDetailLookupDescriptor(vehicle),
    };
  }, [estimateSupport?.groundedVehicleDescriptor, estimateSupport?.groundedVehicleId, isEstimateMode, vehicle]);
  const believableListingsCount = (vehicle?.listings ?? []).filter(isBelievableListing).length;
  const valueQaRows = [
    { label: "Build commit", value: mobileBuildInfo.gitCommit || "unknown" },
    { label: "Value source", value: displayValuation.sourceLabel ?? "none" },
    { label: "Market ZIP", value: zipCode || "unset" },
    { label: "ZIP source", value: zipSource },
    { label: "ZIP storage key", value: zipStorageDebug?.storageKey ?? "unset" },
    { label: "ZIP storage version", value: zipStorageDebug?.storageVersion ?? "unknown" },
    { label: "Legacy 60610 ignored", value: zipStorageDebug?.wasLegacy60610Ignored ? "yes" : "no" },
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
  const specialtyValueCopy =
    vehicle && specialtyValueUnavailable
      ? buildSpecialtyValueStateCopy({
          make: vehicle.make,
          model: vehicle.model,
          trustedResult,
        })
      : null;
  const marketAreaZipHint = zipCode
    ? "Local market pricing depends on ZIP."
    : "Enter ZIP code for local market pricing.";
  const canRequestLiveValue = !isSampleDetail && isValidMarketAreaZip(normalizeMarketAreaZip(zipCode)) && mileage.trim().length > 0 && normalizeCondition(condition).length > 0;
  const valueStatusCardCopy = buildValueStatusCardCopy({
    valuation: displayValuation,
    specialtyValueCopy,
    zipCode,
  });
  const loadingValueCardCopy = {
    title: "Loading live market value...",
    body: "Checking MarketCheck listings and recent comps.",
    supportNote: "This can take a few seconds for the current ZIP and mileage.",
  };
  const handleZipCodeChange = useCallback((nextValue: string) => {
    const normalizedZip = normalizeMarketAreaZip(nextValue);
    setZipCode(normalizedZip);
    setZipSource(normalizedZip.length > 0 ? "user_input" : "blank");
    if (isValidMarketAreaZip(normalizedZip)) {
      Keyboard.dismiss();
    }
    console.log("[vehicle-detail] VALUE_ZIP_SOURCE", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      zip: normalizedZip,
      zipSource: normalizedZip.length > 0 ? "user_input" : "empty_required",
      previousZip: zipCode,
      requestZip: normalizedZip,
      storageKey: zipStorageDebug?.storageKey ?? null,
      storageVersion: zipStorageDebug?.storageVersion ?? null,
      wasLegacy60610Ignored: zipStorageDebug?.wasLegacy60610Ignored ?? false,
      buildCommit: mobileBuildInfo.gitCommit || "unknown",
    });
  }, [id, scanId, zipCode, zipStorageDebug?.storageKey, zipStorageDebug?.storageVersion, zipStorageDebug?.wasLegacy60610Ignored]);
  const vehicleDetailReturnTarget = useMemo(() => {
    const params = new URLSearchParams();
    const setParam = (key: string, value: string | undefined) => {
      if (typeof value === "string" && value.trim().length > 0) {
        params.set(key, value);
      }
    };

    setParam("imageUri", typeof imageUri === "string" ? imageUri : undefined);
    setParam("scanId", typeof scanId === "string" ? scanId : undefined);
    setParam("estimate", typeof estimate === "string" ? estimate : undefined);
    setParam("titleLabel", typeof titleLabel === "string" ? titleLabel : undefined);
    setParam("yearLabel", typeof yearLabel === "string" ? yearLabel : undefined);
    setParam("make", typeof make === "string" ? make : undefined);
    setParam("model", typeof model === "string" ? model : undefined);
    setParam("trimLabel", typeof trimLabel === "string" ? trimLabel : undefined);
    setParam("vehicleType", typeof vehicleType === "string" ? vehicleType : undefined);
    setParam("confidence", typeof confidence === "string" ? confidence : undefined);
    setParam("unlockId", resolvedUnlockId ?? undefined);
    setParam("garageSource", typeof garageSource === "string" ? garageSource : undefined);
    setParam("reopenedSource", typeof reopenedSource === "string" ? reopenedSource : undefined);
    setParam("trustedCase", typeof trustedCase === "string" ? trustedCase : undefined);
    setParam("resultSource", typeof resultSource === "string" ? resultSource : undefined);
    setParam("isSampleVehicle", typeof sampleVehicleParam === "string" ? sampleVehicleParam : undefined);
    setParam("source", typeof routeSource === "string" ? routeSource : undefined);
    params.set("initialTab", "Value");
    params.set("marketIntent", "bundle");

    const query = params.toString();
    return `/vehicle/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
  }, [
    confidence,
    estimate,
    garageSource,
    id,
    imageUri,
    make,
    model,
    reopenedSource,
    resolvedUnlockId,
    resultSource,
    routeSource,
    sampleVehicleParam,
    scanId,
    titleLabel,
    trimLabel,
    trustedCase,
    vehicleType,
    yearLabel,
  ]);
  const routeToAuthForLiveMarket = useCallback(() => {
    startupPreferences
      .setPendingAuthReturnTarget(vehicleDetailReturnTarget)
      .catch((error) => {
        console.warn("[vehicle-detail] failed to persist auth return target", {
          returnTo: vehicleDetailReturnTarget,
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        setLiveMarketRuntimeDebug((current) => ({
          ...current,
          action: "auth-required-return-persisted",
          marketCheckTrace: `pendingReturn ${formatDebugRoute(vehicleDetailReturnTarget)}`,
        }));
        router.push({
          pathname: "/auth",
          params: {
            mode: "sign-in",
            intent: "vehicle-market",
          },
        });
      });
  }, [vehicleDetailReturnTarget]);
  const requestExplicitLiveValue = useCallback(() => {
    Keyboard.dismiss();
    if (!vehicle || !valueLookupInput || valuationLoading) {
      return;
    }
    if (isSampleDetail) {
      console.log("[vehicle-detail] SAMPLE_VEHICLE_LIVE_REFRESH_BLOCKED", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        vehicleId: vehicle.id,
        section: "value",
        providerCall: false,
      });
      applyValuationUpdate(vehicle.valuation ?? displayValuation, "sample-vehicle-value-refresh", {
        allowReplacement: true,
      });
      return;
    }

    const normalizedZip = normalizeMarketAreaZip(zipCode);
    const normalizedMileage = mileage.trim();
    const normalizedCondition = normalizeCondition(condition);
    console.log("[vehicle-detail] VALUE_REFRESH_BUTTON_TAPPED", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      vehicleId: vehicle.id,
      lookupMode: typeof valueLookupInput === "string" ? "id" : valueLookupInput.descriptor ? "descriptor" : "id",
      zip: normalizedZip,
      zipSource,
      mileage: normalizedMileage,
      condition: normalizedCondition,
    });
    if (!isValidMarketAreaZip(normalizedZip) || !normalizedMileage || !normalizedCondition) {
      const missingInputValue = buildUnavailableValueResult({
        reason: "missing_zip_or_mileage",
        sourceLabel: "ZIP and mileage required",
        message: "Enter a valid ZIP, mileage, and condition before loading live market value.",
      });
      applyValuationUpdate(missingInputValue, "value-refresh-invalid-input", {
        allowReplacement: true,
      });
      setVehicle((current) => (current ? { ...current, valuation: missingInputValue } : current));
      setValueDebugStatus("rejected");
      console.log("[vehicle-detail] VALUE_ZIP_SOURCE", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        zip: normalizedZip,
        zipSource: normalizedZip ? zipSource : "empty_required",
        previousZip: zipCode,
        requestZip: normalizedZip,
        buildCommit: mobileBuildInfo.gitCommit || "unknown",
      });
      console.log("[vehicle-detail] VALUE_REFRESH_REQUEST_PAYLOAD", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        vehicleId: vehicle.id,
        lookup: valueLookupInput,
        zip: normalizedZip,
        zipSource,
        mileage: normalizedMileage,
        condition: normalizedCondition,
        rejectedReason: "missing_zip_or_mileage",
      });
      return;
    }

    const requestKey = buildValueRequestKey(valueLookupInput, normalizedZip, normalizedMileage) ?? "";
    pendingValueRequestKeyRef.current = requestKey;
    setValueDebugStatus("requested");
    setValuationLoading(true);
    setLiveMarketRuntimeDebug((current) => ({
      ...current,
      action: "value-request-started",
      authBelievedSignedIn: authService.hasActiveSession(),
      requestPath: "/api/vehicle/value",
      requestUrl: null,
      valueCode: "REQUESTING",
      valueHttpStatus: null,
      valueStatus: null,
      valueReason: null,
      valueSource: null,
      marketCheckTrace: "waiting for backend response",
    }));
    logValueUiTransition("VALUE_UI_REFRESH_STARTED", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      vehicleId: vehicle.id,
      zip: normalizedZip,
      zipSource,
      mileage: normalizedMileage,
      condition: normalizedCondition,
      buildCommit: mobileBuildInfo.gitCommit || "unknown",
    });
    console.log("[vehicle-detail] VALUE_LIVE_REFRESH_BUTTON_PRESSED", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      sourceScreen: "valueScreen",
      action: "valueRefresh",
      zip: normalizedZip,
      zipSource,
      mileage: normalizedMileage,
      condition: normalizedCondition,
    });
    console.log("[vehicle-detail] VALUE_REFRESH_REQUEST_PAYLOAD", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      vehicleId: vehicle.id,
      lookup: valueLookupInput,
      zip: normalizedZip,
      zipSource,
      mileage: normalizedMileage,
      condition: normalizedCondition,
      allowLive: true,
      forceLive: true,
    });

    vehicleService
      .getValue(valueLookupInput, normalizedZip, normalizedMileage, normalizedCondition, {
        allowLive: true,
        fetchReason: "user_requested_value_refresh",
        sourceScreen: "valueScreen",
        action: "valueRefresh",
        forceLive: true,
        zipSource,
      })
      .then((result) => {
        const requestDebug = captureLiveMarketRequestDebug();
        const nextResult =
          isEstimateMode && estimateSupport?.familyLabel
            ? buildApproximateValuation(result, estimateSupport.familyLabel, estimateSupport.yearRangeLabel)
            : result;
        setLiveMarketRuntimeDebug((current) => ({
          ...current,
          ...requestDebug,
          action: "value-response-ok",
          valueCode: "OK",
          valueHttpStatus: null,
          valueStatus: nextResult.status ?? null,
          valueReason: nextResult.unavailableReason ?? nextResult.reason ?? null,
          valueSource: nextResult.valuationSource ?? nextResult.modelType ?? null,
          marketCheckTrace:
            nextResult.valuationSource === "listing_comps" || nextResult.valuationSource === "provider"
              ? "backend returned live/provider valuation evidence"
              : `backend returned ${nextResult.valuationSource ?? nextResult.modelType ?? "unknown"} valuation`,
        }));
        console.log("[vehicle-detail] VALUE_REFRESH_RESPONSE_RECEIVED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          vehicleId: vehicle.id,
          status: nextResult.status,
          valuationSource: nextResult.valuationSource ?? null,
          unavailableReason: nextResult.unavailableReason ?? nextResult.reason ?? null,
          sourceLabel: nextResult.sourceLabel ?? null,
          confidence: nextResult.confidence ?? null,
          compCount: nextResult.compCount ?? nextResult.listingCount ?? null,
        });
        setValueDebugStatus(hasResolvedValueState(nextResult) ? "accepted" : "rejected");
        if (hasStructuredValueEvidence(nextResult)) {
          logValueUiTransition("VALUE_UI_REFRESH_SUCCESS", {
            routeId: id,
            scanId: typeof scanId === "string" ? scanId : null,
            vehicleId: vehicle.id,
            zip: normalizedZip,
            zipSource,
            valuationStatus: nextResult.status,
            valuationSource: nextResult.valuationSource ?? nextResult.modelType,
            listingCount: nextResult.listingCount ?? null,
          });
        } else {
          logValueUiTransition("VALUE_UI_REFRESH_UNAVAILABLE", {
            routeId: id,
            scanId: typeof scanId === "string" ? scanId : null,
            vehicleId: vehicle.id,
            zip: normalizedZip,
            zipSource,
            valuationStatus: nextResult.status,
            reason: nextResult.reason ?? null,
            sourceLabel: nextResult.sourceLabel ?? null,
          });
        }
        lastValueRequestKeyRef.current = requestKey;
        applyValuationUpdate(nextResult, "value-refresh-success", {
          allowReplacement: true,
        });
        setVehicle((current) => (current ? { ...current, valuation: nextResult } : current));
        updateSavedGarageMarketSnapshot({
          valuation: nextResult,
          listings: vehicle.listings,
          source: "live_value",
        });
        previousConditionRef.current = normalizedCondition;
        previousValueRef.current = JSON.stringify(result);
        void marketAreaZipService.saveLastUsedZip(normalizedZip);
      })
      .catch((error) => {
        const errorCode = getApiRequestErrorCode(error);
        const httpStatus = getApiRequestErrorStatus(error);
        const requestDebug = captureLiveMarketRequestDebug();
        const believedSignedIn = authService.hasActiveSession();
        setLiveMarketRuntimeDebug((current) => ({
          ...current,
          ...requestDebug,
          action: "value-response-error",
          valueCode: errorCode ?? "ERROR",
          valueHttpStatus: httpStatus,
          valueStatus: "error",
          valueReason: error instanceof Error ? error.message : String(error),
          valueSource: null,
          marketCheckTrace:
            errorCode === "AUTH_REQUIRED" || errorCode === "PREMIUM_ACCESS_REQUIRED"
              ? "MarketCheck not called: backend denied access before provider"
              : "backend/provider error; inspect code and status",
        }));
        console.error("[vehicle-detail] VALUE_REQUEST_FAILED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          vehicleId: vehicle.id,
          lookup: valueLookupInput,
          zip: normalizedZip,
          zipSource,
          mileage: normalizedMileage,
          condition: normalizedCondition,
          endpoint: "/api/vehicle/value",
          allowLive: true,
          errorCode,
          httpStatus,
          believedSignedIn,
          message: error instanceof Error ? error.message : String(error),
        });
        if (errorCode === "AUTH_REQUIRED") {
          const authValue = buildUnavailableValueResult({
            reason: "auth_required",
            sourceLabel: "Sign in required",
            message: "Sign in to load live market data.",
          });
          applyValuationUpdate(authValue, "value-refresh-auth-required", {
            allowReplacement: true,
          });
          setVehicle((current) => (current ? { ...current, valuation: authValue } : current));
          setValueDebugStatus("rejected");
          Alert.alert(
            "Sign in to load live market data",
            "Your session is needed to verify this vehicle unlock.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Sign In", onPress: routeToAuthForLiveMarket },
            ],
          );
          return;
        }
        if (errorCode === "PREMIUM_ACCESS_REQUIRED") {
          const lockedValue = buildUnavailableValueResult({
            reason: "premium_access_required",
            sourceLabel: "Unlock Value & Listings",
            message: "Unlock this vehicle before loading live market data.",
          });
          applyValuationUpdate(lockedValue, "value-refresh-premium-required", {
            allowReplacement: true,
          });
          setVehicle((current) => (current ? { ...current, valuation: lockedValue } : current));
          setValueDebugStatus("rejected");
          return;
        }
        const errorValue = buildUnavailableValueResult({
          reason: "provider_error",
          status: "provider_error",
          sourceLabel: "Live market data could not be loaded",
          message: "Live market value could not be loaded. Try again after checking your connection.",
        });
        applyValuationUpdate(errorValue, "value-refresh-error", {
          allowReplacement: true,
        });
        setVehicle((current) => (current ? { ...current, valuation: errorValue } : current));
        setValueDebugStatus("rejected");
        logValueUiTransition("VALUE_UI_REFRESH_ERROR", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          vehicleId: vehicle.id,
          zip: normalizedZip,
          zipSource,
          message: error instanceof Error ? error.message : String(error),
        });
        console.log("[vehicle-detail] VALUE_REFRESH_RESPONSE_RECEIVED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          vehicleId: vehicle.id,
          status: errorValue.status,
          valuationSource: errorValue.valuationSource,
          unavailableReason: errorValue.unavailableReason,
          sourceLabel: errorValue.sourceLabel,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (pendingValueRequestKeyRef.current === requestKey) {
          pendingValueRequestKeyRef.current = null;
        }
        setValuationLoading(false);
      });
  }, [
    applyValuationUpdate,
    condition,
    displayValuation,
    estimateSupport?.familyLabel,
    estimateSupport?.yearRangeLabel,
    isEstimateMode,
    isSampleDetail,
    mileage,
    routeToAuthForLiveMarket,
    updateSavedGarageMarketSnapshot,
    valueLookupInput,
    vehicle,
    zipCode,
    zipSource,
    valuationLoading,
  ]);
  const requestExplicitLiveListings = useCallback(() => {
    Keyboard.dismiss();
    if (!vehicle || !valueLookupInput || listingsRefreshLoading) {
      return;
    }
    if (isSampleDetail) {
      console.log("[vehicle-detail] SAMPLE_VEHICLE_LIVE_REFRESH_BLOCKED", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        vehicleId: vehicle.id,
        section: "listings",
        providerCall: false,
      });
      setListingsDebugMeta({
        sourceLabel: "Sample listings",
        rawCount: vehicle.listings.length,
        believableCount: vehicle.listings.filter(isBelievableListing).length,
        mode: "none",
        fallbackReason: "sample_vehicle_demo",
      });
      return;
    }

    const normalizedZip = normalizeMarketAreaZip(zipCode);
    const normalizedMileage = mileage.trim();
    const normalizedCondition = normalizeCondition(condition);
    if (!isValidMarketAreaZip(normalizedZip)) {
      return;
    }

    setListingsRefreshLoading(true);
    setLiveMarketRuntimeDebug((current) => ({
      ...current,
      action: "listings-request-started",
      authBelievedSignedIn: authService.hasActiveSession(),
      requestPath: "/api/vehicle/listings",
      requestUrl: null,
      listingsCode: "REQUESTING",
      listingsHttpStatus: null,
      listingsRawCount: null,
      listingsBelievableCount: null,
      listingsMode: null,
      listingsFallbackReason: null,
      marketCheckTrace: "waiting for backend response",
    }));
    console.log("[vehicle-detail] LISTINGS_LIVE_REFRESH_REQUESTED", {
      routeId: id,
      scanId: typeof scanId === "string" ? scanId : null,
      sourceScreen: "listingsScreen",
      action: "listingsRefresh",
      zip: normalizedZip,
      zipSource,
      staleListingsClearedBeforeRequest: vehicle.listings.length,
    });
    setListingsDebugMeta({
      sourceLabel: "Refreshing live listings",
      rawCount: 0,
      believableCount: 0,
      mode: "none",
      fallbackReason: null,
    });
    setListingsMarketContext(null);
    setVehicle((current) => (current ? { ...current, listings: [] } : current));

    vehicleService
      .getListings(valueLookupInput, normalizedZip, {
        allowLive: true,
        fetchReason: "user_requested_listings_refresh",
        sourceScreen: "listingsScreen",
        action: "listingsRefresh",
        forceLive: true,
        radiusMiles: 100,
        mileage: normalizedMileage,
        zipSource,
      })
      .then(async (result) => {
        const requestDebug = captureLiveMarketRequestDebug();
        setListingsDebugMeta(result.meta);
        const believableListings = result.listings.filter(isBelievableListing);
        setLiveMarketRuntimeDebug((current) => ({
          ...current,
          ...requestDebug,
          action: "listings-response-ok",
          listingsCode: "OK",
          listingsHttpStatus: null,
          listingsRawCount: result.meta?.rawCount ?? result.listings.length,
          listingsBelievableCount: result.meta?.believableCount ?? believableListings.length,
          listingsMode: result.meta?.mode ?? null,
          listingsFallbackReason: result.meta?.fallbackReason ?? null,
          marketCheckTrace:
            result.meta?.rawCount && result.meta.rawCount > 0
              ? `backend returned ${result.meta.rawCount} raw listing(s)`
              : `backend returned no displayable listings (${result.meta?.fallbackReason ?? "no reason"})`,
        }));
        setVehicle((current) =>
          current
            ? {
                ...current,
                listings: result.listings,
              }
            : current,
        );
        setListingsMarketContext({
          zip: normalizedZip,
          mileage: normalizedMileage,
          zipSource,
          radiusMiles: 100,
          acceptedListingsCount: believableListings.length,
          source: "listingsScreen",
        });
        if (believableListings.length > 0 && normalizedMileage && normalizedCondition) {
          const wasModeledFallback = isModeledFallbackValuation(displayValuation);
          const shouldReplaceStaleValue = shouldReplaceValueFromListings(displayValuation);
          console.log("[vehicle-detail] VALUE_QUERY_INVALIDATED_FROM_LISTINGS", {
            routeId: id,
            scanId: typeof scanId === "string" ? scanId : null,
            vehicleId: vehicle.id,
            previousStatus: displayValuation.status,
            previousValuationSource: displayValuation.valuationSource ?? null,
            previousModelType: displayValuation.modelType ?? null,
            believableCount: believableListings.length,
            shouldReplaceStaleValue,
            zip: normalizedZip,
            mileage: normalizedMileage,
            zipSource,
          });
          console.log("[vehicle-detail] VALUE_REFRESH_TRIGGERED_FROM_LISTINGS", {
            routeId: id,
            scanId: typeof scanId === "string" ? scanId : null,
            vehicleId: vehicle.id,
            strategy: "shared_listing_comps",
            providerCall: false,
            believableCount: believableListings.length,
            existingValueResolved: hasResolvedValueState(displayValuation),
          });
          const derivedValue = buildListingsHydratedValuation({
            listings: result.listings,
            condition: normalizedCondition,
            vehicle,
          });
          if (derivedValue) {
            updateSavedGarageMarketSnapshot({
              valuation: derivedValue,
              listings: result.listings,
              source: "live_listings",
            });
          }
          if (derivedValue && shouldReplaceStaleValue) {
            console.log("[vehicle-detail] VALUE_HYDRATED_FROM_FORSALE_LISTINGS", {
              vehicleId: vehicle.id,
              valueRequestSource: "for_sale_listing_sync",
              acceptedListingsAvailable: true,
              acceptedListingsCount: believableListings.length,
              derivedValueCreated: true,
              finalValueStatus: derivedValue.status,
              zip: normalizedZip,
              mileage: normalizedMileage,
              zipSource,
            });
            const requestKey = buildValueRequestKey(valueLookupInput, normalizedZip, normalizedMileage) ?? null;
            lastValueRequestKeyRef.current = requestKey;
            applyValuationUpdate(derivedValue, "listings-cache-sync", {
              allowReplacement: true,
            });
            setVehicle((current) => (current ? { ...current, valuation: derivedValue } : current));
            setValueDebugStatus(hasResolvedValueState(derivedValue) ? "accepted" : "idle");
            console.log("[vehicle-detail] VALUE_UI_STATE_REPLACED_AFTER_LISTINGS", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              vehicleId: vehicle.id,
              previousStatus: displayValuation.status,
              previousValuationSource: displayValuation.valuationSource ?? null,
              nextStatus: derivedValue.status,
              nextValuationSource: derivedValue.valuationSource ?? null,
              compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
            });
            if (wasModeledFallback) {
              console.log("[vehicle-detail] VALUE_STALE_MODELED_FALLBACK_REPLACED", {
                routeId: id,
                scanId: typeof scanId === "string" ? scanId : null,
                vehicleId: vehicle.id,
                previousSourceLabel: displayValuation.sourceLabel ?? null,
                nextSourceLabel: derivedValue.sourceLabel ?? null,
                compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
              });
            }
          } else if (derivedValue) {
            console.log("[vehicle-detail] VALUE_UI_STATE_REPLACED_AFTER_LISTINGS", {
              routeId: id,
              scanId: typeof scanId === "string" ? scanId : null,
              vehicleId: vehicle.id,
              skipped: true,
              reason: "current_value_already_listing_derived",
              currentValuationSource: displayValuation.valuationSource ?? null,
              currentModelType: displayValuation.modelType ?? null,
              compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
            });
          }
        }
        void marketAreaZipService.saveLastUsedZip(normalizedZip);
      })
      .catch((error) => {
        const errorCode = getApiRequestErrorCode(error);
        const httpStatus = getApiRequestErrorStatus(error);
        const requestDebug = captureLiveMarketRequestDebug();
        const believedSignedIn = authService.hasActiveSession();
        setLiveMarketRuntimeDebug((current) => ({
          ...current,
          ...requestDebug,
          action: "listings-response-error",
          listingsCode: errorCode ?? "ERROR",
          listingsHttpStatus: httpStatus,
          listingsRawCount: 0,
          listingsBelievableCount: 0,
          listingsMode: "none",
          listingsFallbackReason: error instanceof Error ? error.message : String(error),
          marketCheckTrace:
            errorCode === "AUTH_REQUIRED" || errorCode === "PREMIUM_ACCESS_REQUIRED"
              ? "MarketCheck not called: backend denied access before provider"
              : "backend/provider error; inspect code and status",
        }));
        console.error("[vehicle-detail] LISTINGS_REQUEST_FAILED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          vehicleId: vehicle.id,
          lookup: valueLookupInput,
          zip: normalizedZip,
          zipSource,
          mileage: normalizedMileage,
          endpoint: "/api/vehicle/listings",
          allowLive: true,
          errorCode,
          httpStatus,
          believedSignedIn,
          message: error instanceof Error ? error.message : String(error),
        });
        if (errorCode === "AUTH_REQUIRED") {
          setListingsDebugMeta({
            sourceLabel: "Sign in to load live listings",
            rawCount: 0,
            believableCount: 0,
            mode: "none",
            fallbackReason: "auth_required",
          });
          Alert.alert(
            "Sign in to load live market data",
            "Your session is needed to verify this vehicle unlock.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Sign In", onPress: routeToAuthForLiveMarket },
            ],
          );
          return;
        }
        if (errorCode === "PREMIUM_ACCESS_REQUIRED") {
          setListingsDebugMeta({
            sourceLabel: "Unlock Value & Listings",
            rawCount: 0,
            believableCount: 0,
            mode: "none",
            fallbackReason: "premium_access_required",
          });
          return;
        }
        if (errorCode === "MARKETCHECK_AUTH_FAILED" || errorCode === "MARKETCHECK_ACCESS_DENIED") {
          setListingsDebugMeta({
            sourceLabel:
              errorCode === "MARKETCHECK_AUTH_FAILED"
                ? "MarketCheck rejected backend credentials"
                : "MarketCheck inventory access denied",
            rawCount: 0,
            believableCount: 0,
            mode: "none",
            fallbackReason: "provider_auth_failed",
          });
          return;
        }
        setListingsDebugMeta({
          sourceLabel: "Live listings could not be loaded",
          rawCount: 0,
          believableCount: 0,
          mode: "none",
          fallbackReason: "provider_error",
        });
      })
      .finally(() => {
        setListingsRefreshLoading(false);
      });
  }, [applyValuationUpdate, condition, displayValuation, id, isSampleDetail, mileage, routeToAuthForLiveMarket, scanId, updateSavedGarageMarketSnapshot, valueLookupInput, vehicle, zipCode, zipSource]);

  const marketUnlockPrimaryId = resolvedUnlockId || vehicle?.id || "";
  const marketUnlockLinkedIds = useMemo(
    () =>
      [vehicle?.id ?? null, resolvedSoftUnlockId]
        .filter((entry): entry is string => Boolean(entry && entry !== marketUnlockPrimaryId)),
    [marketUnlockPrimaryId, resolvedSoftUnlockId, vehicle?.id],
  );
  const marketUnlockLookup = useMemo(() => {
    if (valueLookupInput && typeof valueLookupInput !== "string") {
      return valueLookupInput;
    }
    return {
      vehicleId: valueLookupInput ?? marketUnlockPrimaryId,
      descriptor: vehicle ? buildDetailLookupDescriptor(vehicle) : null,
    };
  }, [marketUnlockPrimaryId, valueLookupInput, vehicle]);
  const canRequestLiveListings = !isSampleDetail && isValidMarketAreaZip(normalizeMarketAreaZip(zipCode));
  const vehicleMarketUnlockLabel = "Unlock Value & Listings";
  const marketValueActionLabel = valuationLoading
    ? "Loading live market value..."
    : hasFullAccess || isPro
      ? "Load live market value"
      : vehicleMarketUnlockLabel;
  const marketListingsActionLabel = listingsRefreshLoading
    ? "Loading live listings..."
    : hasFullAccess || isPro
      ? "Load live listings"
      : vehicleMarketUnlockLabel;
  const marketValueActionDisabled = valuationLoading || isUnlocking || (!marketUnlockPrimaryId && !hasFullAccess);
  const marketListingsActionDisabled = listingsRefreshLoading || isUnlocking || (!marketUnlockPrimaryId && !hasFullAccess);
  const loadVehicleMarketSections = useCallback(() => {
    requestExplicitLiveValue();
    if (canRequestLiveListings) {
      requestExplicitLiveListings();
    }
  }, [canRequestLiveListings, requestExplicitLiveListings, requestExplicitLiveValue]);

  const ensureAuthenticatedForLiveMarket = useCallback(async () => {
    const token = await authService.getAccessToken();
    if (token) {
      return true;
    }
    Alert.alert(
      "Sign in to load live data",
      "Live market value and nearby listings require a signed-in account so unlocks and purchases can be verified securely.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign In",
          onPress: routeToAuthForLiveMarket,
        },
      ],
    );
    return false;
  }, [routeToAuthForLiveMarket]);

  const handleVehicleMarketBundleAction = useCallback(async () => {
    Keyboard.dismiss();
    if (valuationLoading || listingsRefreshLoading || isUnlocking || isSampleDetail || marketUnlockSpendInFlightRef.current) {
      return;
    }
    if (!(await ensureAuthenticatedForLiveMarket())) {
      return;
    }
    if (hasFullAccess || isPro) {
      loadVehicleMarketSections();
      return;
    }
    if (freeUnlocksRemaining <= 0) {
      router.push("/paywall");
      return;
    }
    if (!marketUnlockPrimaryId) {
      Alert.alert("Unlock unavailable", "This saved vehicle cannot be unlocked yet.");
      return;
    }
    if (!canRequestLiveValue && !canRequestLiveListings) {
      requestExplicitLiveValue();
      return;
    }
    const confirmed = await confirmVehicleMarketUnlockSpend();
    if (!confirmed) {
      return;
    }
    marketUnlockSpendInFlightRef.current = true;
    try {
      const result = await useFreeUnlockForVehicle(marketUnlockPrimaryId, marketUnlockLinkedIds, marketUnlockLookup);
      if (result.ok) {
        await refreshStatus();
        loadVehicleMarketSections();
        Alert.alert(
          "Value & Listings unlocked",
          buildVehicleMarketUnlockSuccessBody(result.alreadyUnlocked),
        );
        return;
      }
      if (result.reason === "no_free_unlocks") {
        router.push("/paywall");
        return;
      }
      Alert.alert(
        unlockFailureTitle(result.reason),
        result.message || errorMessage || "We couldn’t apply your free unlock right now.",
      );
    } finally {
      marketUnlockSpendInFlightRef.current = false;
    }
  }, [
    canRequestLiveListings,
    canRequestLiveValue,
    buildVehicleMarketUnlockSuccessBody,
    confirmVehicleMarketUnlockSpend,
    errorMessage,
    ensureAuthenticatedForLiveMarket,
    freeUnlocksRemaining,
    hasFullAccess,
    isPro,
    isSampleDetail,
    isUnlocking,
    listingsRefreshLoading,
    loadVehicleMarketSections,
    marketUnlockLinkedIds,
    marketUnlockLookup,
    marketUnlockPrimaryId,
    refreshStatus,
    requestExplicitLiveValue,
    useFreeUnlockForVehicle,
    valuationLoading,
  ]);

  const handleMarketValueAction = useCallback(async () => {
    Keyboard.dismiss();
    if (valuationLoading || isUnlocking || isSampleDetail || marketUnlockSpendInFlightRef.current) {
      return;
    }
    if (!(await ensureAuthenticatedForLiveMarket())) {
      return;
    }
    if (hasFullAccess || isPro) {
      requestExplicitLiveValue();
      return;
    }
    if (freeUnlocksRemaining <= 0) {
      router.push("/paywall");
      return;
    }
    if (!marketUnlockPrimaryId) {
      Alert.alert("Unlock unavailable", "This saved vehicle cannot be unlocked yet.");
      return;
    }
    if (!canRequestLiveValue) {
      requestExplicitLiveValue();
      return;
    }
    const confirmed = await confirmVehicleMarketUnlockSpend();
    if (!confirmed) {
      return;
    }
    marketUnlockSpendInFlightRef.current = true;
    try {
      const result = await useFreeUnlockForVehicle(marketUnlockPrimaryId, marketUnlockLinkedIds, marketUnlockLookup);
      if (result.ok) {
        await refreshStatus();
        loadVehicleMarketSections();
        Alert.alert(
          "Value & Listings unlocked",
          buildVehicleMarketUnlockSuccessBody(result.alreadyUnlocked),
        );
        return;
      }
      if (result.reason === "no_free_unlocks") {
        router.push("/paywall");
        return;
      }
      Alert.alert(
        unlockFailureTitle(result.reason),
        result.message || errorMessage || "We couldn’t apply your free unlock right now.",
      );
    } finally {
      marketUnlockSpendInFlightRef.current = false;
    }
  }, [
    canRequestLiveValue,
    buildVehicleMarketUnlockSuccessBody,
    confirmVehicleMarketUnlockSpend,
    errorMessage,
    ensureAuthenticatedForLiveMarket,
    freeUnlocksRemaining,
    hasFullAccess,
    isPro,
    isSampleDetail,
    isUnlocking,
    marketUnlockLinkedIds,
    marketUnlockLookup,
    marketUnlockPrimaryId,
    refreshStatus,
    loadVehicleMarketSections,
    requestExplicitLiveValue,
    useFreeUnlockForVehicle,
    valuationLoading,
  ]);

  const handleMarketListingsAction = useCallback(async () => {
    Keyboard.dismiss();
    if (listingsRefreshLoading || isUnlocking || isSampleDetail || marketUnlockSpendInFlightRef.current) {
      return;
    }
    if (!(await ensureAuthenticatedForLiveMarket())) {
      return;
    }
    if (hasFullAccess || isPro) {
      requestExplicitLiveListings();
      return;
    }
    if (freeUnlocksRemaining <= 0) {
      router.push("/paywall");
      return;
    }
    if (!marketUnlockPrimaryId) {
      Alert.alert("Unlock unavailable", "This saved vehicle cannot be unlocked yet.");
      return;
    }
    if (!canRequestLiveListings) {
      Alert.alert("Market ZIP required", "Enter a valid market area ZIP before loading nearby listings.");
      return;
    }
    const confirmed = await confirmVehicleMarketUnlockSpend();
    if (!confirmed) {
      return;
    }
    marketUnlockSpendInFlightRef.current = true;
    try {
      const result = await useFreeUnlockForVehicle(marketUnlockPrimaryId, marketUnlockLinkedIds, marketUnlockLookup);
      if (result.ok) {
        await refreshStatus();
        loadVehicleMarketSections();
        Alert.alert(
          "Value & Listings unlocked",
          buildVehicleMarketUnlockSuccessBody(result.alreadyUnlocked),
        );
        return;
      }
      if (result.reason === "no_free_unlocks") {
        router.push("/paywall");
        return;
      }
      Alert.alert(
        unlockFailureTitle(result.reason),
        result.message || errorMessage || "We couldn’t apply your free unlock right now.",
      );
    } finally {
      marketUnlockSpendInFlightRef.current = false;
    }
  }, [
    canRequestLiveListings,
    buildVehicleMarketUnlockSuccessBody,
    confirmVehicleMarketUnlockSpend,
    errorMessage,
    ensureAuthenticatedForLiveMarket,
    freeUnlocksRemaining,
    hasFullAccess,
    isPro,
    isSampleDetail,
    isUnlocking,
    listingsRefreshLoading,
    loadVehicleMarketSections,
    marketUnlockLinkedIds,
    marketUnlockLookup,
    marketUnlockPrimaryId,
    refreshStatus,
    requestExplicitLiveListings,
    useFreeUnlockForVehicle,
  ]);

  useEffect(() => {
    if (!routeMarketIntent || loading || !vehicle || isSampleDetail || !marketZipInitialized) {
      return;
    }
    const intentKey = `${id}:${typeof scanId === "string" ? scanId : ""}:${routeMarketIntent}`;
    if (routeMarketIntentHandledRef.current === intentKey) {
      return;
    }
    routeMarketIntentHandledRef.current = intentKey;
    if (routeMarketIntent === "bundle") {
      setTab(initialRouteTab ?? "Value");
      void handleVehicleMarketBundleAction();
      return;
    }
    if (routeMarketIntent === "value") {
      setTab("Value");
      void handleMarketValueAction();
      return;
    }
      setTab("Value");
    void handleMarketListingsAction();
  }, [
    handleMarketListingsAction,
    handleMarketValueAction,
    handleVehicleMarketBundleAction,
    id,
    initialRouteTab,
    isSampleDetail,
    loading,
    marketZipInitialized,
    routeMarketIntent,
    scanId,
    vehicle,
  ]);

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
    routeMarketIntentHandledRef.current = null;
    setValueDebugStatus("idle");
    setValueDebugOrigin("hydrated");
    setValueDebugUpdateCount(0);
    setValueDebugUpdatedAt(null);
    setListingsDebugMeta(null);
    setListingsMarketContext(null);
    setZipStorageDebug(null);
    setZipCode("");
    setZipSource("blank");
    setMarketZipInitialized(false);
    setTab(initialRouteTab ?? "Overview");
  }, [id, initialRouteTab, scanId]);

  useEffect(() => {
    let active = true;

    marketAreaZipService
      .getInitialMarketAreaZip()
      .then((result) => {
        if (!active) {
          return;
        }
        setZipCode(result.zip);
        setZipSource(result.zipSource);
        setZipStorageDebug(result.debug);
        console.log("[vehicle-detail] VALUE_ZIP_SOURCE", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          zip: result.zip,
          zipSource: result.zipSource === "blank" ? "empty_required" : result.zipSource,
          storageKey: result.debug.storageKey,
          storageVersion: result.debug.storageVersion,
          wasLegacy60610Ignored: result.debug.wasLegacy60610Ignored,
          buildCommit: mobileBuildInfo.gitCommit || "unknown",
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setMarketZipInitialized(true);
        }
      });

    return () => {
      active = false;
    };
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
    if (tab !== "For Sale" || !isSampleDetail || !vehicle) {
      return;
    }
    try {
      const count = Array.isArray(vehicle.listings) ? vehicle.listings.length : 0;
      console.log("[vehicle-detail] SAMPLE_LISTINGS_RENDER_START", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        vehicleId: vehicle.id,
        count,
        providerCall: false,
        unlockRequired: false,
      });
      if (count === 0) {
        console.warn("[vehicle-detail] SAMPLE_LISTINGS_RENDER_FALLBACK_USED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          vehicleId: vehicle.id,
          reason: "empty_sample_listings",
          providerCall: false,
        });
      }
    } catch (err) {
      console.error("[vehicle-detail] SAMPLE_LISTINGS_RENDER_ERROR", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        vehicleId: vehicle?.id ?? null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [id, isSampleDetail, scanId, tab, vehicle]);

  useEffect(() => {
    setLoading(true);
    setVehicle(null);
    setValuation(createEmptyValuation());
    setEstimateSupport(null);
    setHorsepowerSupport(null);
    setError(null);
    let active = true;

    if (isSampleDetail) {
      const hydrateSampleVehicle = async () => {
        const sampleVehicle = vehicleService.getSampleVehicleById(id) ?? await vehicleService.getOfflineVehicleById(id);
        if (!active) {
          return;
        }
        if (!sampleVehicle) {
          console.warn("[vehicle-detail] SAMPLE_VEHICLE_MISSING_LOCAL_DATA", {
            routeId: id,
            scanId: typeof scanId === "string" ? scanId : null,
            backendLookupRequired: false,
          });
          setVehicle(null);
          setError("Sample vehicle data is unavailable.");
          setLoading(false);
          return;
        }
        console.log("[vehicle-detail] SAMPLE_VEHICLE_LOCAL_RENDERED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          vehicleId: sampleVehicle.id,
          source: sampleVehicle.source ?? "sample_vehicle",
          backendLookupRequired: false,
          unlockRequired: false,
          providerCallsBlocked: true,
        });
        setVehicle(sampleVehicle);
        applyValuationUpdate(sampleVehicle.valuation ?? createEmptyValuation(), "sample-vehicle-local", {
          allowReplacement: true,
        });
        setValueDebugStatus(hasStructuredValueEvidence(sampleVehicle.valuation) ? "accepted" : "idle");
        setMileage(String(sampleVehicle.valuation?.listingCount ? sampleVehicle.listings[0]?.mileage?.replace(/[^\d]/g, "") || defaultMileage : defaultMileage));
        setCondition(defaultCondition);
        setListingsDebugMeta({
          sourceLabel: "Sample listings",
          rawCount: sampleVehicle.listings.length,
          believableCount: sampleVehicle.listings.filter(isBelievableListing).length,
          mode: "none",
          fallbackReason: "sample_vehicle_demo",
        });
        setEstimateSupport({
          groundedVehicleId: null,
          groundedVehicleDescriptor: buildDetailLookupDescriptor(sampleVehicle),
          groundedYear: sampleVehicle.year,
          familyLabel: `${sampleVehicle.make} ${sampleVehicle.model}`.trim(),
          yearRangeLabel: `${sampleVehicle.year}`,
          specsSourceLabel: "Specs from bundled sample catalog.",
          marketSourceLabel: "Demo data — not live market data.",
          groundedMatchType: "sample_vehicle",
          candidateCount: 1,
          msrpRangeLabel: null,
          hasSpecsData: true,
          hasMarketData: true,
          hasListingsData: true,
          trustedResult: true,
        });
        previousConditionRef.current = normalizeCondition(defaultCondition);
        previousValueRef.current = JSON.stringify(sampleVehicle.valuation ?? createEmptyValuation());
        setError(null);
        setLoading(false);
      };

      hydrateSampleVehicle().catch((err) => {
        if (!active) {
          return;
        }
        setVehicle(null);
        setError(err instanceof Error ? err.message : "Sample vehicle data is unavailable.");
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }

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
        const safeGroundedYearRangeLabel = isOverbroadYearRangeLabel(groundedYearRangeLabel) ? null : groundedYearRangeLabel;
        const groundedFamilyLabel = groundedVehicle
          && strongFamilyFallback
          ? `${groundedVehicle.make} ${groundedVehicle.model}`.trim()
          : null;
        const displayFamilyLabel = `${resolvedMake} ${formatCanonicalModelName(resolvedMake, resolvedModel)}`.trim();
        const displayYearLabel = Number.isFinite(parsedYear) ? `${parsedYear}` : safeGroundedYearRangeLabel;
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
          overview: isSpecialtyExoticMake(resolvedMake)
            ? buildSpecialtyVehicleOverview({
                make: resolvedMake,
                model: resolvedModel,
                bodyStyle: resolvedBodyStyle,
              })
            : [
                highConfidenceTrustedCase ? "High-confidence vehicle identification." : "Vehicle identification from photo analysis.",
                resolvedConfidence ? `Confidence: ${Math.round(Number(resolvedConfidence) * 100)}%.` : null,
                safeGroundedYearRangeLabel && !highConfidenceTrustedCase ? `Likely production range: ${safeGroundedYearRangeLabel}.` : null,
                highConfidenceTrustedCase ? null : specsSourceLabel,
              ]
                .filter(Boolean)
                .join(" "),
          specs: mergeApproximateSpecs(groundedRecord, approximateFamilySupport, {
            year: Number.isFinite(parsedYear) ? parsedYear : null,
            make: resolvedMake,
            model: resolvedModel,
          }),
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
        setMileage(defaultMileage);
        setCondition(defaultCondition);
        lastValueRequestKeyRef.current = null;
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
          Promise.resolve(null),
          Promise.resolve({ listings: [], meta: null }),
        ]);

        if (!active) {
          return;
        }

        const resolvedSpecsVehicle = specsResult.status === "fulfilled" ? specsResult.value : null;
        const resolvedValueResult = valueResult.status === "fulfilled" ? (valueResult.value as ValuationResult | null) : null;
        const resolvedListingsResult =
          listingsResult.status === "fulfilled"
            ? (listingsResult.value as { listings: VehicleRecord["listings"]; meta: ListingsDebugMeta | null })
            : null;

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

        if (strongMarketFallback && resolvedValueResult) {
          const nextValuation = buildApproximateValuation(
            resolvedValueResult,
            displayFamilyLabel,
            displayYearLabel,
          );
          applyValuationUpdate(nextValuation, "estimate-backend-value");
          setVehicle((current) => (current ? { ...current, valuation: nextValuation } : current));
        }

        if (strongListingsFallback && resolvedListingsResult) {
          setListingsDebugMeta(resolvedListingsResult.meta);
          setVehicle((current) =>
            current
              ? {
                  ...current,
                  listings: resolvedListingsResult.listings.slice(0, MAX_VISIBLE_LIVE_LISTINGS),
                }
              : current,
          );
        }

        const finalValuation =
          strongMarketFallback && resolvedValueResult
            ? buildApproximateValuation(resolvedValueResult, displayFamilyLabel, displayYearLabel)
            : estimatedVehicle.valuation;
        const finalListings =
          strongListingsFallback && resolvedListingsResult
            ? resolvedListingsResult.listings.slice(0, MAX_VISIBLE_LIVE_LISTINGS)
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
              returned: Boolean(resolvedValueResult),
              sourceLabel: resolvedValueResult?.sourceLabel ?? null,
              modelType: resolvedValueResult?.modelType ?? null,
            },
            listingsPipeline: {
              attempted: strongListingsFallback,
              status: listingsResult.status,
              returnedCount: resolvedListingsResult?.listings.length ?? 0,
              believableCount: resolvedListingsResult?.meta?.believableCount ?? resolvedListingsResult?.listings.length ?? 0,
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
        const initialMileage = getInitialMileage(offlineResult);
        const initialCondition = getInitialCondition(offlineResult);
        setMileage(initialMileage);
        setCondition(initialCondition);
        lastValueRequestKeyRef.current = null;
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
          const initialMileage = getInitialMileage(result);
          const initialCondition = getInitialCondition(result);
          setMileage(initialMileage);
          setCondition(initialCondition);
          lastValueRequestKeyRef.current = null;
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
  }, [accessState, applyValuationUpdate, confidence, id, isEstimateMode, isSampleDetail, make, model, scanId, titleLabel, trimLabel, vehicleType, yearLabel]);

  useEffect(() => {
    if (typeof imageUri === "string" && imageUri.trim().length > 0) {
      const routeImageSafe = isSafeVehicleImageForIdentity(
        {
          vehicleId: typeof id === "string" ? id : vehicle?.id,
          make: typeof make === "string" ? make : vehicle?.make,
          model: typeof model === "string" ? model : vehicle?.model,
          vehicleType: typeof vehicleType === "string" ? vehicleType : vehicle?.vehicleType,
          bodyStyle: vehicle?.bodyStyle ?? null,
        },
        imageUri,
      );
      if (!routeImageSafe) {
        console.warn("[vehicle-detail] IMAGE_REJECT_REASON", {
          vehicleId: id,
          imageUri,
          reason: "route-image-rejected-for-requested-identity",
        });
        setResolvedImageUri(null);
        setImageSourceLabel("clean vehicle image fallback");
        return;
      }
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
  }, [id, imageUri, make, model, scanId, vehicle, vehicleType]);

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
        zip: normalizeMarketAreaZip(zipCode),
        zipSource,
        mileage: mileage.trim(),
        condition: normalizeCondition(condition),
        previousDisplayedValue: displayValuation,
      });
      console.log("[vehicle-detail] VEHICLE_VALUE_INPUT_STATE", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        zip: normalizeMarketAreaZip(zipCode),
        zipSource,
        mileage: mileage.trim(),
        condition: normalizeCondition(condition),
        oldDisplayedValue: displayValuation,
      });
    }

    if (!valueLookupInput) {
      return;
    }

    const normalizedZip = normalizeMarketAreaZip(zipCode);
    const normalizedMileage = mileage.trim();
    const normalizedCondition = normalizeCondition(condition);
    const requestKey = buildValueRequestKey(valueLookupInput, normalizedZip, normalizedMileage) ?? "";
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
      setValueDebugStatus("idle");
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

    if (lastValueRequestKeyRef.current === requestKey && hasResolvedValueState(displayValuation)) {
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

    if (userAdjustedInputs) {
      setValueDebugStatus("idle");
      setValuation((current) => {
        if (current.status === "stale_after_input_change" && current.reason === "inputs_changed") {
          return current;
        }
        return {
          ...current,
          status: "stale_after_input_change",
          tradeIn: "Unavailable",
          tradeInRange: "Unavailable",
          privateParty: "Unavailable",
          privatePartyRange: "Unavailable",
          dealerRetail: "Unavailable",
          dealerRetailRange: "Unavailable",
          low: null,
          high: null,
          median: null,
          sourceLabel: "Live market inputs changed",
          confidenceLabel: "Press Load live market value to refresh pricing for the current ZIP and mileage.",
          message: "Live market inputs changed since the last value load.",
          reason: "inputs_changed",
        };
      });
      if (__DEV__) {
        console.log("[vehicle-detail] VALUE_AUTO_REFRESH_SKIPPED", {
          routeId: id,
          scanId: typeof scanId === "string" ? scanId : null,
          zip: normalizedZip,
          mileage: normalizedMileage,
          condition: normalizedCondition,
          previousRequestKey: lastValueRequestKeyRef.current,
          nextRequestKey: requestKey,
          reason: "inputs-changed-requires-explicit-refresh",
        });
      }
    }
  }, [condition, displayValuation, id, mileage, scanId, tab, valueLookupInput, vehicle, zipCode, zipSource]);

  useEffect(() => {
    if (!vehicle || tab !== "Value") {
      return;
    }
    if (__DEV__) {
      console.log("[vehicle-detail] VALUE_UI_RENDER_BRANCH", {
        routeId: id,
        scanId: typeof scanId === "string" ? scanId : null,
        zip: normalizeMarketAreaZip(zipCode),
        zipSource,
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
      valuationSource: displayValuation.valuationSource ?? null,
      sourceLabel: displayValuation.sourceLabel ?? null,
      unavailableReason: displayValuation.unavailableReason ?? displayValuation.reason ?? null,
      fallbackUiChosen: valueTabFinalState === "value_unavailable",
    });
    console.log("[vehicle-detail] VALUE_RENDER_STATE", {
      vehicleId: vehicle.id,
      condition,
      status: displayValuation.status,
      valuationSource: displayValuation.valuationSource ?? null,
      sourceLabel: displayValuation.sourceLabel ?? null,
      unavailableReason: displayValuation.unavailableReason ?? displayValuation.reason ?? null,
      valueUsefulness: resolveValueUsefulness(displayValuation),
    });
  }, [condition, displayValuation, id, mileage, scanId, tab, valuation, valueTabFinalState, vehicle, zipCode, zipSource]);

  useEffect(() => {
    if (!vehicle || isSampleDetail || !listingsMarketContext) {
      return;
    }

    const normalizedZip = normalizeMarketAreaZip(zipCode);
    const normalizedMileage = mileage.trim();
    const normalizedCondition = normalizeCondition(condition);
    const sameMarketContext =
      listingsMarketContext.zip === normalizedZip && listingsMarketContext.mileage === normalizedMileage;
    const shouldHydrateFromListings = shouldReplaceValueFromListings(displayValuation);

    if (!sameMarketContext || !shouldHydrateFromListings) {
      return;
    }

    const derivedValue = buildListingsHydratedValuation({
      listings: vehicle.listings,
      condition: normalizedCondition,
      vehicle,
    });
    if (!derivedValue) {
      return;
    }

    const wasModeledFallback = isModeledFallbackValuation(displayValuation);
    console.log("[vehicle-detail] VALUE_QUERY_INVALIDATED_FROM_LISTINGS", {
      vehicleId: vehicle.id,
      valueRequestSource: "cache_read",
      previousStatus: displayValuation.status,
      previousValuationSource: displayValuation.valuationSource ?? null,
      previousModelType: displayValuation.modelType ?? null,
      acceptedListingsCount: listingsMarketContext.acceptedListingsCount,
      zip: normalizedZip,
      mileage: normalizedMileage,
      zipSource,
    });
    console.log("[vehicle-detail] VALUE_REFRESH_TRIGGERED_FROM_LISTINGS", {
      vehicleId: vehicle.id,
      valueRequestSource: "cache_read",
      strategy: "shared_listing_comps",
      providerCall: false,
      acceptedListingsCount: listingsMarketContext.acceptedListingsCount,
    });
    console.log("[vehicle-detail] VALUE_COMP_DERIVATION_STARTED", {
      vehicleId: vehicle.id,
      valueRequestSource: "cache_read",
      acceptedListingsAvailable: true,
      acceptedListingsCount: listingsMarketContext.acceptedListingsCount,
      listingCacheKeysChecked: ["shared_vehicle_listings"],
      radiiChecked: [listingsMarketContext.radiusMiles],
      derivedValueCreated: true,
      finalValueStatus: derivedValue.status,
      zip: normalizedZip,
      mileage: normalizedMileage,
      zipSource,
    });
    console.log("[vehicle-detail] VALUE_COMP_DERIVATION_RESULT", {
      vehicleId: vehicle.id,
      valueRequestSource: "cache_read",
      acceptedListingsCount: listingsMarketContext.acceptedListingsCount,
      listingCacheKeysChecked: ["shared_vehicle_listings"],
      derivedValueCreated: true,
      finalValueStatus: derivedValue.status,
      compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
    });
    const requestKey = buildValueRequestKey(valueLookupInput, normalizedZip, normalizedMileage) ?? null;
    lastValueRequestKeyRef.current = requestKey;
    applyValuationUpdate(derivedValue, "shared-listings-hydration", {
      allowReplacement: true,
    });
    setVehicle((current) => (current ? { ...current, valuation: derivedValue } : current));
    setValueDebugStatus(hasResolvedValueState(derivedValue) ? "accepted" : "idle");
    console.log("[vehicle-detail] VALUE_UI_STATE_REPLACED_AFTER_LISTINGS", {
      vehicleId: vehicle.id,
      valueRequestSource: "cache_read",
      previousStatus: displayValuation.status,
      previousValuationSource: displayValuation.valuationSource ?? null,
      nextStatus: derivedValue.status,
      nextValuationSource: derivedValue.valuationSource ?? null,
      compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
    });
    if (wasModeledFallback) {
      console.log("[vehicle-detail] VALUE_STALE_MODELED_FALLBACK_REPLACED", {
        vehicleId: vehicle.id,
        valueRequestSource: "cache_read",
        previousSourceLabel: displayValuation.sourceLabel ?? null,
        nextSourceLabel: derivedValue.sourceLabel ?? null,
        compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
      });
    }
  }, [
    applyValuationUpdate,
    condition,
    displayValuation,
    isSampleDetail,
    mileage,
    listingsMarketContext,
    valueLookupInput,
    vehicle,
    zipCode,
    zipSource,
  ]);

  useEffect(() => {
    if (!vehicle || isSampleDetail) {
      return;
    }

    const normalizedZip = normalizeMarketAreaZip(zipCode);
    const normalizedMileage = mileage.trim();
    const normalizedCondition = normalizeCondition(condition);
    const believableListings = vehicle.listings.filter(isBelievableListing);
    const shouldHydrateFromListings = shouldReplaceValueFromListings(displayValuation);

    if (believableListings.length === 0 || !shouldHydrateFromListings) {
      return;
    }

    const derivedValue = buildListingsHydratedValuation({
      listings: believableListings,
      condition: normalizedCondition,
      vehicle,
    });
    if (!derivedValue) {
      return;
    }

    const wasModeledFallback = isModeledFallbackValuation(displayValuation);
    console.log("[vehicle-detail] VALUE_QUERY_INVALIDATED_FROM_LISTINGS", {
      vehicleId: vehicle.id,
      valueRequestSource: listingsMarketContext ? "for_sale_listing_sync" : "cache_read",
      previousStatus: displayValuation.status,
      previousValuationSource: displayValuation.valuationSource ?? null,
      previousModelType: displayValuation.modelType ?? null,
      believableListingsCount: believableListings.length,
      zip: normalizedZip,
      mileage: normalizedMileage,
      zipSource,
    });
    console.log("[vehicle-detail] VALUE_REFRESH_TRIGGERED_FROM_LISTINGS", {
      vehicleId: vehicle.id,
      valueRequestSource: listingsMarketContext ? "for_sale_listing_sync" : "cache_read",
      strategy: "shared_listing_comps",
      providerCall: false,
      believableListingsCount: believableListings.length,
    });
    console.log("[vehicle-detail] VALUE_COMP_DERIVATION_STARTED", {
      vehicleId: vehicle.id,
      valueRequestSource: listingsMarketContext ? "for_sale_listing_sync" : "cache_read",
      acceptedListingsAvailable: true,
      acceptedListingsCount: believableListings.length,
      listingCacheKeysChecked: ["shared_vehicle_listings"],
      radiiChecked: listingsMarketContext ? [listingsMarketContext.radiusMiles] : [50, 100, 250, 500],
      derivedValueCreated: true,
      finalValueStatus: derivedValue.status,
      zip: normalizedZip,
      mileage: normalizedMileage,
      zipSource,
    });
    console.log("[vehicle-detail] VALUE_COMP_DERIVATION_RESULT", {
      vehicleId: vehicle.id,
      valueRequestSource: listingsMarketContext ? "for_sale_listing_sync" : "cache_read",
      acceptedListingsCount: believableListings.length,
      listingCacheKeysChecked: ["shared_vehicle_listings"],
      derivedValueCreated: true,
      finalValueStatus: derivedValue.status,
      compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
    });
    const requestKey = buildValueRequestKey(valueLookupInput, normalizedZip, normalizedMileage) ?? null;
    lastValueRequestKeyRef.current = requestKey;
    applyValuationUpdate(derivedValue, "shared-listings-hydration", {
      allowReplacement: true,
    });
    setVehicle((current) => (current ? { ...current, valuation: derivedValue } : current));
    setValueDebugStatus(hasResolvedValueState(derivedValue) ? "accepted" : "idle");
    console.log("[vehicle-detail] VALUE_UI_STATE_REPLACED_AFTER_LISTINGS", {
      vehicleId: vehicle.id,
      valueRequestSource: listingsMarketContext ? "for_sale_listing_sync" : "cache_read",
      previousStatus: displayValuation.status,
      previousValuationSource: displayValuation.valuationSource ?? null,
      nextStatus: derivedValue.status,
      nextValuationSource: derivedValue.valuationSource ?? null,
      compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
    });
    if (wasModeledFallback) {
      console.log("[vehicle-detail] VALUE_STALE_MODELED_FALLBACK_REPLACED", {
        vehicleId: vehicle.id,
        valueRequestSource: listingsMarketContext ? "for_sale_listing_sync" : "cache_read",
        previousSourceLabel: displayValuation.sourceLabel ?? null,
        nextSourceLabel: derivedValue.sourceLabel ?? null,
        compCount: derivedValue.compCount ?? derivedValue.listingCount ?? null,
      });
    }
  }, [
    applyValuationUpdate,
    condition,
    displayValuation,
    isSampleDetail,
    listingsMarketContext,
    mileage,
    valueLookupInput,
    vehicle,
    zipCode,
    zipSource,
  ]);

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
        vehicleType: resolvedDisplayVehicleType,
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
  }, [resolvedDisplayVehicleType, vehicle]);

  const fallbackHeroImageSource = vehicle?.heroImage ?? null;
  const fallbackHeroImageUri = typeof fallbackHeroImageSource === "string" ? fallbackHeroImageSource : "";
  const heroUsesResolvedImage = Boolean(resolvedImageUri && heroImagePolicy.useResolvedImageInHero);
  const heroImageUri = heroUsesResolvedImage ? resolvedImageUri ?? "" : fallbackHeroImageUri || resolvedImageUri || "";
  const heroImageSource = useMemo(() => {
    if (heroUsesResolvedImage && resolvedImageUri) {
      return { uri: resolvedImageUri };
    }
    if (fallbackHeroImageSource) {
      return toVehicleImageSource(fallbackHeroImageSource);
    }
    return resolvedImageUri ? { uri: resolvedImageUri } : null;
  }, [fallbackHeroImageSource, heroUsesResolvedImage, resolvedImageUri]);
  const heroImageLogValue = heroImageUri || (fallbackHeroImageSource ? "static-silhouette-fallback" : "");
  const selectedImageSourceLabel = heroUsesResolvedImage
    ? imageSourceLabel
    : fallbackHeroImageSource
      ? "clean vehicle image fallback"
      : resolvedImageUri
        ? "cropped scan fallback"
        : isEstimateMode
          ? "estimated result"
          : "provider/generic fallback";
  const galleryImageSources = useMemo(() => {
    if (!vehicle) {
      return [];
    }
    const primary = resolvedImageUri && (heroUsesResolvedImage || selectedImageSourceLabel === "cropped scan fallback")
      ? { uri: resolvedImageUri }
      : vehicle.isSampleVehicle && vehicle.heroImage
        ? toVehicleImageSource(vehicle.heroImage)
        : null;
    const listingSources = vehicle.listings
      .filter((listing) => listingImageMatchesVehicle(listing, vehicle))
      .map((listing) => ({ uri: listing.imageUrl.trim() }));
    const uniqueSources = new Map<string, NonNullable<typeof primary> | { uri: string }>();
    if (primary) {
      uniqueSources.set(JSON.stringify(primary), primary);
    }
    listingSources.forEach((source) => {
      uniqueSources.set(source.uri, source);
    });
    const sources = Array.from(uniqueSources.values());
    return sources.slice(0, 4);
  }, [heroUsesResolvedImage, resolvedImageUri, selectedImageSourceLabel, vehicle]);
  const scannedImageSelected = heroUsesResolvedImage || selectedImageSourceLabel === "cropped scan fallback";
  const heroImageFitMode = "cover";
  const overviewCopy =
    vehicle && isSpecialtyExoticMake(vehicle.make)
      ? buildSpecialtyVehicleOverview({
          make: vehicle.make,
          model: vehicle.model,
          bodyStyle: resolvedDisplayBodyStyle || vehicle.bodyStyle,
        })
      : vehicle?.overview ?? "";
  const vehicleDescription = useMemo(
    () =>
      buildVehicleDescription({
        year: vehicle?.year,
        make: vehicle?.make,
        model: vehicle?.model,
        trim: resolvedDisplayTrim || vehicle?.trim,
        bodyStyle: resolvedDisplayBodyStyle || vehicle?.bodyStyle,
        vehicleType: resolvedDisplayVehicleType,
        engine: vehicle?.specs.engine,
        horsepower: vehicle?.specs.horsepower ?? null,
        drivetrain: vehicle?.specs.drivetrain,
        transmission: vehicle?.specs.transmission,
      }),
    [
      resolvedDisplayBodyStyle,
      resolvedDisplayTrim,
      vehicle,
      resolvedDisplayVehicleType,
    ],
  );

  useEffect(() => {
    if (!vehicle || !heroImageLogValue) {
      return;
    }
    console.log("[vehicle-detail] RESULT_IMAGE_SOURCE_SELECTED", {
      source: selectedImageSourceLabel,
      imageUri: heroImageLogValue,
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
  }, [heroImageFitMode, heroImageLogValue, scanId, selectedImageSourceLabel, vehicle]);

  useEffect(() => {
    if (!vehicle) {
      return;
    }
    if (vehicleDescription.description) {
      console.log("[vehicle-detail] VEHICLE_DESCRIPTION_GENERATED", {
        vehicleId: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
      });
      return;
    }
    console.log(
      `[vehicle-detail] ${
        vehicleDescription.reason === "data_insufficient"
          ? "VEHICLE_DESCRIPTION_DATA_INSUFFICIENT"
          : "VEHICLE_DESCRIPTION_SKIPPED"
      }`,
      {
        vehicleId: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
      },
    );
  }, [vehicle, vehicleDescription.description, vehicleDescription.reason]);

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
      <VehicleDetailContainer scroll={false} contentContainerStyle={styles.loadingPage}>
        <DetailBackButton fallbackHref="/(tabs)/scan" />
        <View style={styles.loadingWrap}>
          <View style={styles.loadingHeroCard}>
            <PremiumSkeleton height={280} radius={Radius.xl} />
            <View style={styles.loadingHeroCopy}>
              <Text style={styles.loadingEyebrow}>Loading vehicle details</Text>
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
      </VehicleDetailContainer>
    );
  }

  if (!vehicle) {
    return (
      <VehicleDetailContainer contentContainerStyle={styles.pageContent}>
        <DetailBackButton fallbackHref="/(tabs)/scan" />
        <EmptyState title="Vehicle unavailable" description={error ?? "We couldn’t load this vehicle right now."} />
      </VehicleDetailContainer>
    );
  }

  return (
    <VehicleDetailContainer contentContainerStyle={styles.pageContent}>
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
                source={heroImageSource ?? toVehicleImageSource(vehicle.heroImage)}
                style={[styles.hero, heroImagePolicy.artifactRisk && !fallbackHeroImageUri ? styles.heroArtifactCrop : null]}
                resizeMode={heroImageFitMode}
              />
              <LinearGradient colors={["rgba(3,4,5,0.04)", "rgba(3,4,5,0.26)", "rgba(3,4,5,0.96)"]} style={styles.heroGradient} />
              <View style={styles.heroBackOverlay}>
                <DetailBackButton fallbackHref="/(tabs)/scan" />
              </View>
              <View style={styles.heroTitleBlock}>
                <Text style={styles.heroTitle}>{resolvedHeroTitle}</Text>
                <Text style={styles.heroSubtitle}>{estimateSubtitle || unlockedDetailSubtitle}</Text>
              </View>
            </View>
          </Pressable>
        </View>
      </Animated.View>
      <Animated.View style={[styles.contentStack, styles.contentInset, { opacity: contentOpacity, transform: [{ translateY: contentTranslate }] }]}>
        {summaryChips.length > 0 ? (
          <View style={styles.heroChipRow}>
            {summaryChips.map((chip, index) => (
              <View key={`${chip}-${index}`} style={styles.heroChip}>
                <Text style={styles.heroChipLabel}>{chip}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.unlockStatusCard}>
          <View style={styles.unlockStatusIcon}>
            <Ionicons name={hasFullAccess ? "flash" : "lock-closed"} size={17} color="#E7B97F" />
          </View>
          <View style={styles.unlockStatusCopy}>
            <Text style={styles.unlockStatusTitle}>{unlockStatusTitle}</Text>
            <Text style={styles.unlockStatusBody}>{unlockStatusBody}</Text>
          </View>
          {garageSource === "1" || reopenedSource === "1" ? <Text style={styles.unlockStatusMeta}>Saved</Text> : null}
        </View>
        {feedbackMessage && !hasFullAccess ? <Text style={styles.feedbackNotice}>{feedbackMessage}</Text> : null}
        {errorMessage ? <Text style={styles.errorNotice}>{errorMessage}</Text> : null}
        <DetailSectionNav activeTab={tab} onChange={setTab} />

      {tab === "Overview" ? (
        <>
          <View style={styles.tabIntro}>
            <Text style={styles.tabIntroTitle}>Details</Text>
            <Text style={styles.tabIntroSubtitle}>Identity, canonical specs, and ownership context.</Text>
            {vehicleDescription.description ? <Text style={styles.tabIntroBody}>{vehicleDescription.description}</Text> : null}
          </View>
          <View style={styles.detailGroupStack}>
            <ReferenceValueCard vehicle={vehicle} compact />
            <InfoGroupCard title="Identity" icon="finger-print-outline">
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
            </InfoGroupCard>
            <InfoGroupCard title="Performance" icon="speedometer-outline">
              <SpecGrid
                items={[
                  { label: "Engine", value: vehicle.specs.engine },
                  { label: horsepowerSupport?.label ?? "Horsepower", value: horsepowerSupport?.value ?? formatHorsepowerLabel(vehicle.specs.horsepower) },
                  { label: "MPG / Range", value: vehicle.specs.mpgOrRange },
                ]}
              />
            </InfoGroupCard>
            <InfoGroupCard title="Drivetrain" icon="git-branch-outline">
              <SpecGrid
                items={[
                  { label: "Drivetrain", value: vehicle.specs.drivetrain },
                  { label: "Transmission", value: vehicle.specs.transmission },
                  { label: "Body style", value: resolvedDisplayBodyStyle || "Vehicle" },
                ]}
              />
            </InfoGroupCard>
          </View>
          {horsepowerSupport && !horsepowerSupport.exact ? (
            <Text style={styles.specSupportNoteQuiet}>Horsepower is matched from local canonical family data because exact trim power can vary.</Text>
          ) : null}
        </>
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
                <SpecGrid
                  items={[
                    { label: horsepowerSupport?.label ?? "Horsepower", value: horsepowerSupport?.value ?? formatHorsepowerLabel(vehicle.specs.horsepower) },
                    { label: "Drivetrain", value: vehicle.specs.drivetrain },
                    { label: "Transmission", value: vehicle.specs.transmission },
                    { label: "MPG / Range", value: vehicle.specs.mpgOrRange },
                    { label: "Engine", value: vehicle.specs.engine },
                    {
                      label: estimateSupport?.msrpRangeLabel?.includes(" - ") ? "MSRP range" : "MSRP",
                      value: estimateSupport?.msrpRangeLabel ?? (vehicle.specs.msrp > 0 ? formatCurrency(vehicle.specs.msrp) : "Unavailable"),
                    },
                  ]}
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
                <SpecGrid
                  items={[
                    { label: "Engine", value: vehicle.specs.engine },
                    { label: horsepowerSupport?.label ?? "Horsepower", value: horsepowerSupport?.value ?? formatHorsepowerLabel(vehicle.specs.horsepower) },
                    { label: "Torque", value: vehicle.specs.torque },
                    { label: "Transmission", value: vehicle.specs.transmission },
                    { label: "Drivetrain", value: vehicle.specs.drivetrain },
                    { label: "MPG / Range", value: vehicle.specs.mpgOrRange },
                  ]}
                />
                {horsepowerSupport && !horsepowerSupport.exact ? (
                  <Text style={styles.specSupportNote}>This horsepower comes from a strong family match because trim-level power differs across nearby variants.</Text>
                ) : null}
                <DetailRow label="Colors" value={vehicle.specs.exteriorColors.join(", ")} />
                <DetailRow label="Original MSRP" value={formatCurrency(vehicle.specs.msrp)} />
              </View>
            </LockedContentPreview>
          ) : (
            <View style={styles.sectionCard}>
              <SpecGrid
                items={[
                  { label: "Engine", value: vehicle.specs.engine },
                  { label: horsepowerSupport?.label ?? "Horsepower", value: horsepowerSupport?.value ?? formatHorsepowerLabel(vehicle.specs.horsepower) },
                  { label: "Torque", value: vehicle.specs.torque },
                  { label: "Transmission", value: vehicle.specs.transmission },
                  { label: "Drivetrain", value: vehicle.specs.drivetrain },
                  { label: "MPG / Range", value: vehicle.specs.mpgOrRange },
                ]}
              />
              {horsepowerSupport && !horsepowerSupport.exact ? (
                <Text style={styles.specSupportNote}>This horsepower comes from a strong family match because trim-level power differs across nearby variants.</Text>
              ) : null}
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
        <>
          <View style={styles.tabIntro}>
            <Text style={styles.tabIntroTitle}>Value & Listings</Text>
            <Text style={styles.tabIntroSubtitle}>Market trend and live comparable listings.</Text>
          </View>
          <RuntimeDebugStamp
            screen="vehicle-value-v4-live-debug"
            lines={[
              `route ${formatDebugRoute(`/vehicle/${id}`, 52)} | tab ${tab} | locked ${isLocked ? "yes" : "no"}`,
              `returnTo ${formatDebugRoute(vehicleDetailReturnTarget, 82)}`,
              `auth signedIn ${formatLiveMarketDebugBool(liveMarketRuntimeDebug.authBelievedSignedIn)} token ${formatLiveMarketDebugBool(liveMarketRuntimeDebug.authHadToken)} header ${formatLiveMarketDebugBool(liveMarketRuntimeDebug.authSentHeader)}`,
              `request ${formatDebugRoute(liveMarketRuntimeDebug.requestPath ?? liveMarketRuntimeDebug.requestUrl, 82)}`,
              `value ${liveMarketRuntimeDebug.valueCode ?? "none"} status ${liveMarketRuntimeDebug.valueStatus ?? "none"} reason ${formatDebugRoute(liveMarketRuntimeDebug.valueReason, 42)}`,
              `listings ${liveMarketRuntimeDebug.listingsCode ?? "none"} raw ${liveMarketRuntimeDebug.listingsRawCount ?? "?"} shown ${liveMarketRuntimeDebug.listingsBelievableCount ?? "?"} mode ${liveMarketRuntimeDebug.listingsMode ?? "none"}`,
              `trace ${formatDebugRoute(liveMarketRuntimeDebug.marketCheckTrace, 82)}`,
            ]}
          />
          {!isSampleDetail ? (
            <View style={styles.marketSettingsCard}>
              <View style={styles.premiumSectionHeader}>
                <View style={styles.premiumSectionTitleRow}>
                  <Ionicons name="options-outline" size={17} color="#E7B97F" />
                  <Text style={styles.premiumSectionTitle}>Market Settings</Text>
                </View>
                <Text style={styles.marketSettingsHint}>{zipCode || "ZIP required"}</Text>
              </View>
              <Text style={styles.marketSettingsDescription}>ZIP, mileage, and condition shape the local market estimate.</Text>
              <View style={styles.marketSettingsRow}>
                <View style={styles.marketFieldCompact}>
                  <Text style={styles.inputLabel}>ZIP</Text>
                  <TextInput
                    style={[styles.input, styles.inputCompact]}
                    value={zipCode}
                    onChangeText={handleZipCodeChange}
                    autoCapitalize="characters"
                    keyboardType="number-pad"
                    maxLength={5}
                    inputAccessoryViewID={marketInputAccessoryViewID}
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    placeholder="ZIP"
                    placeholderTextColor="rgba(214, 205, 194, 0.48)"
                  />
                </View>
                <View style={styles.marketFieldCompact}>
                  <Text style={styles.inputLabel}>Mileage</Text>
                  <TextInput
                    style={[styles.input, styles.inputCompact]}
                    value={mileage}
                    onChangeText={setMileage}
                    keyboardType="number-pad"
                    inputAccessoryViewID={marketInputAccessoryViewID}
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    placeholder="Mileage"
                    placeholderTextColor="rgba(214, 205, 194, 0.48)"
                  />
                </View>
              </View>
              <Pressable style={styles.marketSettingsDoneButton} onPress={() => Keyboard.dismiss()} accessibilityRole="button">
                <Text style={styles.marketSettingsDoneLabel}>Done</Text>
              </Pressable>
              <InputAccessoryView nativeID={marketInputAccessoryViewID}>
                <View style={styles.keyboardAccessory}>
                  <Pressable style={styles.keyboardAccessoryDone} onPress={() => Keyboard.dismiss()} accessibilityRole="button">
                    <Text style={styles.keyboardAccessoryDoneText}>Done</Text>
                  </Pressable>
                </View>
              </InputAccessoryView>
              <View style={styles.conditionGridCompact}>
                {conditionOptions.map((option) => {
                  const active = option === condition;
                  return (
                    <Pressable
                      key={option}
                      style={[styles.conditionChip, styles.conditionChipCompact, active && styles.conditionChipActive]}
                      onPress={() => {
                        Keyboard.dismiss();
                        setCondition(option);
                      }}
                    >
                      <Text style={[styles.conditionChipLabel, active && styles.conditionChipLabelActive]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.inputHint}>{marketAreaZipHint}</Text>
            </View>
          ) : null}
          {isLocked ? (
            <>
              <LockedValueListingsCard
                vehicle={vehicle}
                loading={isUnlocking}
                onPress={handleVehicleMarketBundleAction}
                disabled={marketValueActionDisabled || marketListingsActionDisabled}
              />
            </>
          ) : (
            <>
              {canRenderValueEstimateCard(displayValuation) ? (
                <PremiumMarketValueCard
                  result={displayValuation}
                  loading={valuationLoading}
                />
              ) : (
                <>
                  <ReferenceValueCard vehicle={vehicle} />
                  {valuationLoading ? (
                    <ApproximateDataState
                      title={loadingValueCardCopy.title}
                      body={loadingValueCardCopy.body}
                      supportNote={loadingValueCardCopy.supportNote}
                      badgeLabel={null}
                      loading
                    />
                  ) : (
                    <ApproximateDataState
                      title={valueStatusCardCopy.title}
                      body={valueStatusCardCopy.body}
                      supportNote={valueStatusCardCopy.supportNote}
                      badgeLabel={null}
                    />
                  )}
                </>
              )}
              <PremiumListingsSection
                listings={vehicle.listings}
                locked={false}
                loading={listingsRefreshLoading}
                fallbackImageSource={heroImageSource ?? toVehicleImageSource(vehicle.heroImage)}
                debugMeta={listingsDebugMeta}
              />
              {!isSampleDetail ? (
                <PremiumDetailButton
                  label={valuationLoading || listingsRefreshLoading ? "Loading Value & Listings..." : canRenderValueEstimateCard(displayValuation) ? "Refresh Value & Listings" : "Load Value & Listings"}
                  onPress={handleVehicleMarketBundleAction}
                  disabled={marketValueActionDisabled || marketListingsActionDisabled}
                  secondary={canRenderValueEstimateCard(displayValuation)}
                />
              ) : null}
            </>
          )}
        </>
      ) : null}

      {tab === "For Sale" ? (
        isSampleDetail ? (
          <>
            <View style={styles.sectionCard}>
              <SectionHeader title="Sample listings" subtitle="Demo data — not live market data." />
              <Text style={styles.body}>
                These static showcase listings let you explore the For Sale experience without using live MarketCheck data,
                provider calls, or unlocks.
              </Text>
            </View>
            <View style={styles.listingsWrap}>
              {vehicle.listings.length > 0 ? (
                vehicle.listings.map((listing, index) => (
                  <ListingCard key={listing.id || `sample-listing-${index}`} listing={listing} isBest={index === 0} />
                ))
              ) : (
                <ApproximateDataState
                  title="Sample listings unavailable"
                  body="Demo data only — no live provider was called."
                  supportNote="Back navigation and the rest of the sample vehicle tabs remain available."
                  badgeLabel={null}
                />
              )}
            </View>
            {showQaDebugStrip ? <QaDebugStrip title="QA Listings Debug" rows={listingsQaRows} /> : null}
          </>
        ) : isEstimateMode ? (
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
                actionLabel={marketListingsActionLabel}
                onAction={handleMarketListingsAction}
                badgeLabel={null}
                actionDisabled={marketListingsActionDisabled}
                secondaryAction={false}
              />
              {showQaDebugStrip ? <QaDebugStrip title="QA Listings Debug" rows={listingsQaRows} /> : null}
            </>
          )
        ) : (
        <>
          <View style={styles.sectionCard}>
            <Text style={styles.body}>
              {isLocked
                ? "Nearby listings unlock with market value for this vehicle. No second unlock is required."
                : "Nearby listings help you compare local pricing, mileage, and dealer context at a glance."}
            </Text>
          </View>
          {isLocked ? (
            <LockedContentPreview
              locked
              title="Listings locked"
              description="Use one vehicle unlock to load both live listings and market value."
            >
              <View style={styles.listingsWrap}>
                {vehicle.listings
                  .slice(0, 1)
                  .map((listing, index) => (
                    <ListingCard key={listing.id} listing={listing} isBest={index === 0} />
                  ))}
              </View>
            </LockedContentPreview>
          ) : resolveListingsUsefulness(vehicle.listings) === "listings_unavailable" ? (
            <>
              <ApproximateDataState
                title="Live listings unavailable"
                body="We don't have trusted nearby listings for this vehicle yet."
                supportNote="Load live listings when you're ready to check current comps."
                actionLabel={marketListingsActionLabel}
                onAction={handleMarketListingsAction}
                badgeLabel={null}
                actionDisabled={marketListingsActionDisabled}
                secondaryAction={false}
              />
            </>
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
              variant="listings"
              remaining={freeUnlocksRemaining}
              limit={freeUnlocksLimit}
              disabled={marketListingsActionDisabled}
              isUnlocking={isUnlocking}
              onUnlock={handleMarketListingsAction}
              onUpgrade={() => router.push("/paywall")}
            />
          ) : null}
        </>
        )
      ) : null}

      {tab === "Photos" ? (
        <View style={styles.photosSection}>
          <View style={styles.tabIntro}>
            <Text style={styles.tabIntroTitle}>Photos</Text>
            <Text style={styles.tabIntroSubtitle}>Reference imagery for this vehicle.</Text>
          </View>
          {galleryImageSources.length > 0 ? (
            <View style={styles.photoGrid}>
              {galleryImageSources.map((source, index) => (
                <View key={index} style={styles.photoTile}>
                  <Image source={source} style={styles.photoTileImage} resizeMode="cover" />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.photosEmptyCard}>
              <Text style={styles.photosEmptyTitle}>No additional photos yet</Text>
              <Text style={styles.photosEmptyBody}>More photos appear after listings are loaded.</Text>
            </View>
          )}
        </View>
      ) : null}
      <View style={styles.bottomActionStack}>
        {isLocked ? (
          <>
            <PremiumDetailButton
              label="Scan Another Vehicle"
              onPress={() => router.push("/(tabs)/scan")}
            />
            <PremiumDetailButton label="View Pro Features" secondary onPress={() => router.push("/paywall")} />
          </>
        ) : (
          <PremiumDetailButton
            label="Scan Another Vehicle"
            secondary={isTrustedUnlockedEstimate}
            onPress={() => router.push("/(tabs)/scan")}
          />
        )}
      </View>
      </Animated.View>
      <Modal visible={heroPreviewOpen} transparent animationType="fade" onRequestClose={() => setHeroPreviewOpen(false)}>
        <Pressable style={styles.heroModalBackdrop} onPress={() => setHeroPreviewOpen(false)}>
          <Pressable style={styles.heroModalCard} onPress={(event) => event.stopPropagation()}>
            <Image source={heroImageSource ?? toVehicleImageSource(vehicle.heroImage)} style={styles.heroModalImage} resizeMode={heroImageFitMode} />
            <View style={styles.heroModalBody}>
              <Text style={styles.heroModalTitle}>{resolvedHeroTitle}</Text>
              <Text style={styles.heroModalSubtitle}>{estimateSubtitle || unlockedDetailSubtitle}</Text>
              {summaryChips.length > 0 ? (
                <View style={styles.heroModalChipRow}>
                  {summaryChips.map((chip, index) => (
                    <View key={`modal-${chip}-${index}`} style={styles.heroChip}>
                      <Text style={styles.heroChipLabel}>{chip}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <PremiumDetailButton label="Close quick view" secondary onPress={() => setHeroPreviewOpen(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </VehicleDetailContainer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const displayValue = sanitizeSpecValue(value);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{displayValue}</Text>
    </View>
  );
}

function InfoGroupCard({
  title,
  icon,
  children,
}: PropsWithChildren<{
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
}>) {
  return (
    <View style={styles.infoGroupCard}>
      <View style={styles.infoGroupHeader}>
        <View style={styles.infoGroupIcon}>
          <Ionicons name={icon} size={16} color="#E7B97F" />
        </View>
        <Text style={styles.infoGroupTitle}>{title}</Text>
      </View>
      <View style={styles.infoGroupBody}>{children}</View>
    </View>
  );
}

function SpecGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  const displayItems = items
    .map((item) => ({ ...item, value: sanitizeSpecValue(item.value) }))
    .filter((item) => item.value !== "Unknown");
  return (
    <View style={styles.specGrid}>
      {displayItems.map((item, index) => (
        <View key={`${item.label}-${item.value}-${index}`} style={styles.specCard}>
          <Text style={styles.specCardLabel}>{item.label}</Text>
          <Text style={styles.specCardValue}>{item.value}</Text>
        </View>
      ))}
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
  variant = "details",
  remaining,
  limit,
  disabled,
  isUnlocking,
  onUnlock,
  onUpgrade,
}: {
  variant?: "details" | "market" | "listings";
  remaining: number;
  limit: number;
  disabled: boolean;
  isUnlocking: boolean;
  onUnlock: () => void;
  onUpgrade: () => void;
}) {
  const used = Math.max(0, limit - Math.max(0, remaining));
  const isVehicleMarketUnlock = variant === "market" || variant === "listings";
  const title =
    isVehicleMarketUnlock ? "Unlock Value & Listings" : "Unlock Full Details";
  const body =
    isVehicleMarketUnlock
      ? "One free unlock loads live market value and nearby listings for this saved vehicle."
      : "This unlock gives full premium access for this vehicle.";
  const primaryLabel = isUnlocking
    ? "Applying unlock..."
    : remaining > 0
      ? "Use Free Unlock"
      : isVehicleMarketUnlock
        ? "Unlock Value & Listings"
        : "Unlock Full Details";
  return (
    <View style={styles.unlockCard}>
      <Text style={styles.unlockTitle}>{title}</Text>
      <Text style={styles.unlockBody}>{body}</Text>
      <Text style={styles.unlockNote}>
        {used} of {limit} free unlocks used • {Math.max(0, remaining)} remaining
      </Text>
      {remaining > 0 ? (
        <PremiumDetailButton label={primaryLabel} onPress={onUnlock} disabled={disabled} />
      ) : null}
      <PremiumDetailButton label="Go Pro" secondary onPress={onUpgrade} />
    </View>
  );
}

const styles = StyleSheet.create({
  vehicleSafeArea: {
    flex: 1,
    backgroundColor: "#030405",
  },
  vehicleGradient: {
    flex: 1,
  },
  vehicleScroll: {
    flex: 1,
  },
  vehicleContent: {
    paddingTop: 10,
    paddingHorizontal: 0,
    paddingBottom: 156,
    gap: 0,
  },
  vehicleStaticContent: {
    flex: 1,
  },
  pageGlowAmber: {
    position: "absolute",
    top: -110,
    right: -92,
    width: 260,
    height: 260,
    borderRadius: 260,
    backgroundColor: "rgba(216, 163, 107, 0.13)",
  },
  pageGlowGraphite: {
    position: "absolute",
    top: 110,
    left: -120,
    width: 260,
    height: 260,
    borderRadius: 260,
    backgroundColor: "rgba(255, 255, 255, 0.025)",
  },
  heroShell: {
    gap: 0,
    marginHorizontal: 16,
    borderRadius: 26,
    overflow: "hidden",
    backgroundColor: "rgba(10, 10, 10, 0.98)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.18)",
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
  },
  heroFrame: {
    width: "100%",
    height: 306,
    borderRadius: 26,
    overflow: "hidden",
    backgroundColor: "#050505",
  },
  hero: { width: "100%", height: "100%", backgroundColor: "#050505" },
  heroArtifactCrop: {
    height: "114%",
    transform: [{ translateY: -30 }],
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroBackOverlay: {
    position: "absolute",
    top: 16,
    left: 14,
  },
  heroTitleBlock: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 18,
    gap: 4,
  },
  heroMetaCard: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 10,
    gap: 9,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "rgba(12, 12, 12, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.22)",
  },
  heroMetaTopRow: {
    marginBottom: 2,
  },
  heroBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(216, 163, 107, 0.1)",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.28)",
  },
  heroBadgeLabel: {
    ...Typography.caption,
    color: "#E7B97F",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  heroPressable: {
    borderRadius: 0,
  },
  heroTitle: { ...Typography.hero, color: Colors.textStrong, fontSize: 29, lineHeight: 32 },
  heroSubtitle: { ...Typography.body, color: "#D4D7DD", lineHeight: 20 },
  heroChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  heroChip: {
    backgroundColor: "rgba(18, 18, 19, 0.92)",
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.18)",
  },
  heroChipLabel: { ...Typography.caption, color: "#F3F1EC", fontWeight: "800" },
  heroModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(3, 4, 5, 0.9)",
    justifyContent: "center",
    padding: 20,
  },
  heroModalCard: {
    backgroundColor: "rgba(12, 12, 12, 0.98)",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.2)",
    overflow: "hidden",
    gap: 16,
  },
  heroModalImage: {
    width: "100%",
    height: 320,
    backgroundColor: "#050505",
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
  detailBackButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: Radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: "rgba(18, 18, 18, 0.76)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.18)",
  },
  detailBackLabel: {
    ...Typography.bodyStrong,
    color: "#F5F3EE",
    fontWeight: "700",
  },
  contentStack: { gap: 18 },
  contentInset: { paddingHorizontal: 17, paddingTop: 16 },
  unlockStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 15,
    borderRadius: 18,
    backgroundColor: "rgba(31, 24, 19, 0.84)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.26)",
  },
  unlockStatusIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(216, 163, 107, 0.16)",
  },
  unlockStatusCopy: {
    flex: 1,
    gap: 2,
  },
  unlockStatusTitle: {
    ...Typography.caption,
    color: "#E7B97F",
    fontWeight: "800",
  },
  unlockStatusBody: {
    ...Typography.caption,
    color: "#D6D1C9",
  },
  unlockStatusMeta: {
    ...Typography.caption,
    color: "#8F96A3",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  detailStatusCard: {
    borderRadius: 20,
    padding: 12,
    gap: 8,
    backgroundColor: "rgba(14, 14, 14, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.16)",
  },
  detailStatusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusPill: {
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    backgroundColor: "rgba(255, 255, 255, 0.045)",
  },
  statusPillUnlocked: {
    borderColor: "rgba(216, 163, 107, 0.34)",
    backgroundColor: "rgba(216, 163, 107, 0.12)",
  },
  statusPillLocked: {
    borderColor: "rgba(153, 158, 170, 0.18)",
    backgroundColor: "rgba(153, 158, 170, 0.07)",
  },
  statusPillLabel: {
    ...Typography.caption,
    color: "#E7B97F",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "700",
  },
  detailStatusCopy: {
    ...Typography.body,
    color: "#AEB3BE",
    lineHeight: 22,
  },
  detailTabRail: {
    flexDirection: "row",
    gap: 5,
    padding: 5,
    borderRadius: 18,
    backgroundColor: "rgba(16, 16, 17, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  detailTabButton: {
    flex: 1,
    minHeight: 41,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  detailTabButtonActive: {
    backgroundColor: "#D6A269",
    borderWidth: 1,
    borderColor: "rgba(255, 225, 190, 0.36)",
    shadowColor: "#D8A36B",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  detailTabLabel: {
    ...Typography.caption,
    color: "#848B98",
    fontWeight: "700",
  },
  detailTabLabelActive: {
    color: "#0B0907",
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
  estimateNoticeInline: { ...Typography.caption, color: "#8F96A3", lineHeight: 18 },
  tabIntro: {
    gap: 7,
    marginTop: 10,
  },
  tabIntroCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  tabIntroTitle: {
    ...Typography.heading,
    color: "#F5F3EE",
    fontSize: 21,
    lineHeight: 25,
  },
  tabIntroSubtitle: {
    ...Typography.body,
    color: "#8F96A3",
    lineHeight: 22,
  },
  tabIntroBody: {
    ...Typography.body,
    color: "#CFD2D8",
    lineHeight: 24,
    marginTop: 8,
  },
  detailListCard: {
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "rgba(14, 14, 14, 0.88)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
  },
  detailGroupStack: {
    gap: 13,
  },
  infoGroupCard: {
    gap: 13,
    padding: 16,
    borderRadius: 22,
    backgroundColor: "rgba(15, 15, 16, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
  },
  infoGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  infoGroupIcon: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(216, 163, 107, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.22)",
  },
  infoGroupTitle: {
    ...Typography.bodyStrong,
    color: "#F5F3EE",
  },
  infoGroupBody: {
    gap: 10,
  },
  sectionCard: {
    padding: 20,
    gap: 16,
    borderRadius: 22,
    backgroundColor: "rgba(14, 14, 14, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  trustedSpecsStack: { gap: 12 },
  specGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  specCard: {
    width: "48%",
    minHeight: 82,
    borderRadius: 16,
    padding: 13,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.075)",
    justifyContent: "space-between",
    gap: 8,
  },
  specCardLabel: {
    ...Typography.caption,
    color: "#8F96A3",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  specCardValue: {
    ...Typography.bodyStrong,
    color: "#F5F3EE",
  },
  approximateStateCard: {
    gap: 12,
    padding: 18,
    borderRadius: 22,
    backgroundColor: "rgba(14, 14, 14, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.18)",
  },
  approximateStateBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(216, 163, 107, 0.1)",
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.24)",
  },
  approximateStateBadgeLabel: {
    ...Typography.caption,
    color: "#E7B97F",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  approximateStateTitle: { ...Typography.heading, color: "#F5F3EE" },
  approximateStateBody: { ...Typography.body, color: "#B5BAC4" },
  approximateStateSupport: { ...Typography.caption, color: "#8F96A3", lineHeight: 18 },
  listingsWrap: { gap: 18 },
  pageContent: { paddingVertical: 14 },
  listingsPageContent: { paddingVertical: 14 },
  body: { ...Typography.body, color: "#B5BAC4", lineHeight: 23 },
  descriptionBody: { ...Typography.body, color: "#CED2DA", lineHeight: 24 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.07)",
    paddingTop: 11,
  },
  rowLabel: { ...Typography.caption, color: "#8F96A3", textTransform: "uppercase", letterSpacing: 1 },
  rowValue: { ...Typography.bodyStrong, color: "#F5F3EE", flexShrink: 1, textAlign: "right" },
  specSupportNote: { ...Typography.caption, color: "#8F96A3", marginTop: -4, marginBottom: 4 },
  specSupportNoteQuiet: { ...Typography.caption, color: "#8F96A3", marginTop: 6, opacity: 0.88, lineHeight: 18 },
  inputGroup: { gap: 8 },
  inputLabel: { ...Typography.caption, color: "#8F96A3", textTransform: "uppercase", letterSpacing: 0.7 },
  input: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderRadius: Radius.md,
    padding: 14,
    color: "#F5F3EE",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    ...Typography.body,
  },
  inputHint: { ...Typography.caption, color: "#8F96A3", lineHeight: 18 },
  marketSettingsCard: {
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(14, 14, 14, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  premiumSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  premiumSectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  premiumSectionTitle: {
    ...Typography.bodyStrong,
    color: "#F5F3EE",
  },
  premiumBadge: {
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.28)",
    backgroundColor: "rgba(216, 163, 107, 0.1)",
  },
  premiumBadgeText: {
    ...Typography.caption,
    color: "#E7B97F",
    fontWeight: "700",
  },
  marketSettingsHint: {
    ...Typography.caption,
    color: "#E7B97F",
    fontWeight: "700",
  },
  marketSettingsDescription: {
    ...Typography.caption,
    color: "#AEB3BE",
    lineHeight: 18,
  },
  marketSettingsRow: {
    flexDirection: "row",
    gap: 10,
  },
  marketSettingsDoneButton: {
    alignSelf: "flex-end",
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(216, 163, 107, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.28)",
  },
  marketSettingsDoneLabel: {
    ...Typography.caption,
    color: "#E7B97F",
    fontWeight: "800",
  },
  keyboardAccessory: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 7,
    alignItems: "flex-end",
    justifyContent: "center",
    backgroundColor: "#10100F",
    borderTopWidth: 1,
    borderTopColor: "rgba(216, 163, 107, 0.18)",
  },
  keyboardAccessoryDone: {
    minHeight: 34,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(216, 163, 107, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.32)",
  },
  keyboardAccessoryDoneText: {
    ...Typography.caption,
    color: "#E7B97F",
    fontWeight: "800",
  },
  marketFieldCompact: {
    flex: 1,
    gap: 7,
  },
  inputCompact: {
    paddingVertical: 12,
  },
  conditionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  conditionGridCompact: {
    flexDirection: "row",
    gap: 8,
  },
  conditionChip: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderRadius: Radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  conditionChipCompact: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  conditionChipActive: {
    backgroundColor: "rgba(216, 163, 107, 0.14)",
    borderColor: "rgba(216, 163, 107, 0.38)",
  },
  conditionChipLabel: { ...Typography.caption, color: "#D7DAE0" },
  conditionChipLabelActive: { color: "#E7B97F", fontWeight: "700" },
  marketValueCard: {
    gap: 14,
    padding: 18,
    borderRadius: 20,
    backgroundColor: "rgba(26, 20, 17, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.26)",
  },
  marketValueLabel: {
    ...Typography.caption,
    color: "#E7B97F",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  marketValueHeading: {
    ...Typography.price,
    color: "#F5F3EE",
  },
  marketMetricGrid: {
    flexDirection: "row",
    gap: 8,
  },
  marketMetricCard: {
    flex: 1,
    minHeight: 70,
    borderRadius: 14,
    padding: 10,
    gap: 5,
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  marketMetricLabel: {
    ...Typography.caption,
    color: "#8F96A3",
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  marketMetricValue: {
    ...Typography.bodyStrong,
    color: "#F5F3EE",
  },
  marketSource: {
    ...Typography.caption,
    color: "#D8C0A0",
  },
  marketConfidence: {
    ...Typography.caption,
    color: "#8F96A3",
  },
  referenceValueCard: {
    gap: 10,
    padding: 18,
    borderRadius: 22,
    backgroundColor: "rgba(28, 21, 17, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.24)",
  },
  referenceValueCardCompact: {
    marginTop: 6,
  },
  referenceValueLabel: {
    ...Typography.caption,
    color: "#E7B97F",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "800",
  },
  referenceValueAmount: {
    ...Typography.price,
    color: "#F5F3EE",
  },
  referenceValueBody: {
    ...Typography.caption,
    color: "#8F96A3",
    lineHeight: 18,
  },
  lockedValueCard: {
    gap: 16,
    padding: 18,
    borderRadius: 24,
    backgroundColor: "rgba(28, 21, 17, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.28)",
    shadowColor: "#D8A36B",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  lockedValueCardDisabled: {
    opacity: 0.62,
  },
  lockedValueHeader: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  lockedValueIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(216, 163, 107, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.28)",
  },
  lockedValueCopy: {
    flex: 1,
    gap: 5,
  },
  lockedValueTitle: {
    ...Typography.heading,
    color: "#F5F3EE",
  },
  lockedValueBody: {
    ...Typography.body,
    color: "#B8BEC8",
    lineHeight: 22,
  },
  lockedReferenceStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    borderRadius: 17,
    padding: 13,
    backgroundColor: "rgba(255, 255, 255, 0.045)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  lockedReferenceLabel: {
    ...Typography.caption,
    color: "#E7B97F",
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
  },
  lockedReferenceBody: {
    ...Typography.caption,
    color: "#8F96A3",
    marginTop: 3,
  },
  lockedReferenceValue: {
    ...Typography.bodyStrong,
    color: "#F5F3EE",
    flexShrink: 0,
  },
  lockedValueCta: {
    minHeight: 50,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#D8A36B",
  },
  lockedValueCtaText: {
    ...Typography.bodyStrong,
    color: "#0B0907",
  },
  listingsPanel: {
    gap: 12,
  },
  listingsKicker: {
    ...Typography.caption,
    color: "#8F96A3",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    fontWeight: "800",
  },
  listingsPanelBody: {
    ...Typography.body,
    color: "#8F96A3",
    lineHeight: 22,
  },
  listingsHeaderBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  listingsVersionBadge: {
    borderRadius: Radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: "rgba(216, 163, 107, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.20)",
  },
  listingsVersionText: {
    ...Typography.caption,
    color: "#E7B97F",
    fontWeight: "800",
  },
  lockedPreviewStack: {
    gap: 10,
  },
  lockedPreviewRow: {
    minHeight: 54,
    borderRadius: 16,
    padding: 12,
    gap: 7,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  lockedPreviewLineShort: {
    width: "38%",
    height: 9,
    borderRadius: 9,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  lockedPreviewLineLong: {
    width: "62%",
    height: 10,
    borderRadius: 10,
    backgroundColor: "rgba(216, 163, 107, 0.18)",
  },
  premiumListingStack: {
    gap: 12,
  },
  showMoreListingsButton: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(216, 163, 107, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.26)",
  },
  showMoreListingsLabel: {
    ...Typography.bodyStrong,
    color: "#E7B97F",
  },
  premiumListingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(18, 18, 19, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.09)",
  },
  premiumListingRowDisabled: {
    opacity: 0.72,
  },
  premiumListingImage: {
    width: 78,
    height: 70,
    borderRadius: 14,
    backgroundColor: "#050505",
  },
  premiumListingImageFallback: {
    width: 78,
    height: 70,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  premiumListingCopy: {
    flex: 1,
    gap: 6,
  },
  premiumListingSource: {
    ...Typography.caption,
    color: "#8F96A3",
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "800",
  },
  premiumListingPrice: {
    ...Typography.heading,
    color: "#E7B97F",
  },
  premiumListingMeta: {
    ...Typography.caption,
    color: "#B5BAC4",
  },
  premiumListingAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(216, 163, 107, 0.13)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.32)",
  },
  premiumListingActionDisabled: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  listingsEmptyCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(18, 18, 19, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.16)",
  },
  listingsEmptyCopy: {
    flex: 1,
    gap: 4,
  },
  listingsEmptyTitle: {
    ...Typography.bodyStrong,
    color: "#F5F3EE",
  },
  listingsEmptyBody: {
    ...Typography.caption,
    color: "#9BA1AD",
    lineHeight: 18,
  },
  valueLoading: { ...Typography.caption, color: Colors.textMuted },
  qaDebugStrip: {
    ...cardStyles.secondary,
    gap: 8,
    padding: 14,
    borderColor: "rgba(216, 163, 107, 0.16)",
    backgroundColor: "rgba(12, 12, 12, 0.88)",
  },
  qaDebugTitle: {
    ...Typography.caption,
    color: "#E7B97F",
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
  photosSection: {
    gap: 16,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  photoTile: {
    width: "48%",
    aspectRatio: 1.08,
    overflow: "hidden",
    borderRadius: 14,
    backgroundColor: "#050505",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  photoTileImage: {
    width: "100%",
    height: "100%",
  },
  photosEmptyCard: {
    gap: 8,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "rgba(18, 18, 19, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  photosEmptyTitle: {
    ...Typography.bodyStrong,
    color: "#F5F3EE",
  },
  photosEmptyBody: {
    ...Typography.body,
    color: "#8F96A3",
    lineHeight: 22,
  },
  bottomActionStack: { gap: 12, marginTop: 6, paddingTop: 10, paddingBottom: 10 },
  loadingPage: { flex: 1, gap: 20 },
  loadingWrap: { flex: 1, justifyContent: "center", gap: 18 },
  loadingHeroCard: {
    gap: 16,
    padding: 18,
    borderRadius: 22,
    backgroundColor: "rgba(14, 14, 14, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.16)",
  },
  loadingHeroCopy: { gap: 8 },
  loadingEyebrow: { ...Typography.caption, color: "#E7B97F", textTransform: "uppercase", letterSpacing: 1.2 },
  loadingText: { ...Typography.title, color: Colors.textStrong },
  loadingBody: { ...Typography.body, color: Colors.textSoft },
  loadingStack: { gap: 14 },
  detailActionButton: {
    minHeight: 54,
    borderRadius: Radius.pill,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.34)",
    backgroundColor: "rgba(216, 163, 107, 0.12)",
  },
  detailActionButtonSecondary: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  detailActionButtonDisabled: { opacity: 0.58 },
  detailActionGradient: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  detailActionLabel: { ...Typography.bodyStrong, color: "#080807" },
  detailActionLabelSecondary: { color: "#EBD0AD" },
  unlockCard: {
    gap: 12,
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(216, 163, 107, 0.22)",
    backgroundColor: "rgba(18, 16, 14, 0.94)",
  },
  feedbackNotice: { ...Typography.caption, color: "#AEB3BE" },
  errorNotice: { ...Typography.caption, color: Colors.dangerSoft },
  unlockTitle: { ...Typography.heading, color: "#F5F3EE" },
  unlockBody: { ...Typography.body, color: "#B5BAC4" },
  unlockNote: { ...Typography.caption, color: "#8F96A3" },
});
