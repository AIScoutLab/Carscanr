import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Image, ImageSourcePropType, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { AppContainer } from "@/components/AppContainer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmptyState } from "@/components/EmptyState";
import { PremiumSkeleton } from "@/components/PremiumSkeleton";
import { Colors, Radius, Typography } from "@/constants/theme";
import { SILHOUETTE_IMAGES } from "@/constants/vehicleImages";
import { cardStyles } from "@/design/patterns";
import { findSampleScanPhoto } from "@/features/scan/samplePhotos";
import { useSubscription } from "@/hooks/useSubscription";
import { buildVehicleDescription } from "@/lib/vehicleDescription";
import { parseHorsepower } from "@/lib/vehicleData";
import { generateVehicleInsight } from "@/lib/vehicleInsights";
import { isProPlan } from "@/lib/subscription";
import { garageService } from "@/services/garageService";
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { scanService } from "@/services/scanService";
import { buildVehicleSoftUnlockId, buildVehicleUnlockId } from "@/services/subscriptionService";
import { ScanResult, VehicleRecord } from "@/types";
import { confidenceTone, formatConfidence, formatCurrency } from "@/lib/utils";

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
  source: "visual_candidate" | "ocr_override" | "visual_override" | "sample_vehicle" | null;
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
type ResultIconName = keyof typeof Ionicons.glyphMap;
type ResultStat = { label: string; value: string; icon: ResultIconName };
type ResultSpecValues = {
  powertrain: string | null;
  horsepower: string | null;
  drivetrain: string | null;
  acceleration: string | null;
  range: string | null;
  mpg: string | null;
  msrp: string | null;
  bodyStyle: string | null;
};
type CuratedSampleResultDetails = {
  acceleration: string | null;
  range: string | null;
  insight: string;
  marketTitle: string;
  marketBody: string;
  listingsBody: string;
};
type LocalFreeSpecSupplement = Partial<ResultSpecValues> & {
  insight?: string;
};

const CURATED_SAMPLE_RESULT_DETAILS: Record<string, CuratedSampleResultDetails> = {
  "2022-tesla-model-3-long-range": {
    acceleration: "3.9s",
    range: "333 mi",
    insight:
      "The Model 3 Long Range blends dual-motor AWD performance with everyday practicality and one of the strongest EV charging ecosystems available.",
    marketTitle: "Market Value Preview",
    marketBody: "Sample demo values showing mileage, range, and trim context.",
    listingsBody:
      "Sample nearby listing preview using bundled demo inventory, not a live marketplace lookup.",
  },
  "2019-ford-mustang-gt": {
    acceleration: "4.2s",
    range: null,
    insight:
      "The Mustang GT delivers classic rear-drive character with a 5.0L V8, strong aftermarket depth, and broad enthusiast demand.",
    marketTitle: "Market Value Preview",
    marketBody: "Sample demo values showing mileage, condition, and enthusiast demand.",
    listingsBody:
      "Sample nearby listing preview using bundled demo inventory, not a live marketplace lookup.",
  },
  "2023-harley-davidson-street-glide-special": {
    acceleration: null,
    range: null,
    insight:
      "The Street Glide Special pairs long-distance touring comfort with Milwaukee-Eight torque, premium bagger presence, and strong brand-backed resale appeal.",
    marketTitle: "Market Value Preview",
    marketBody: "Sample demo values showing mileage, options, and regional demand.",
    listingsBody:
      "Sample nearby listing preview using bundled demo inventory, not a live marketplace lookup.",
  },
};

const LOCAL_FREE_SPEC_SUPPLEMENTS: Record<string, LocalFreeSpecSupplement> = {
  "chrysler:pt cruiser": {
    powertrain: "2.4L inline-4",
    horsepower: "150-230 HP by trim",
    drivetrain: "FWD",
    bodyStyle: "Compact wagon",
    mpg: "19-22 city / 24-29 hwy",
    insight:
      "The PT Cruiser blended retro styling with compact practicality and became one of Chrysler's most recognizable early-2000s designs.",
  },
};

type NormalizedScan = {
  id: string | null;
  imageUri: string | null;
  source: "visual_candidate" | "ocr_override" | "visual_override" | "sample_vehicle" | null;
  confidenceScore: number | null;
  detectedVehicleType: "car" | "truck" | "motorcycle" | null;
  candidates: NormalizedVehicle[];
  identifiedVehicle: NormalizedVehicle;
  scannedAt: string | null;
  limitedPreview: boolean | null;
  quickResult: boolean;
  quickResultSource: "offline_canonical" | "local_scan_cache" | null;
  identificationConfidence: number | null;
  dataConfidence: number | null;
  payloadStrength: "strong" | "usable" | "thin" | "empty" | null;
  enrichmentMode: "exact" | "adjacent_year" | "generation_fallback" | "fallback_only" | null;
  unlockEligible: boolean | null;
  unlockRecommendationReason: string | null;
  isSampleVehicle: boolean;
  previewSpecFacts: string[];
  visibleClues: string[];
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
  const rawDisplayYearLabel = safeString((input as any).displayYearLabel);
  const rawYearRange = (input as any).groundedYearRange ?? (input as any).yearRange ?? null;
  const groundedYearRange =
    typeof rawYearRange?.start === "number" && typeof rawYearRange?.end === "number"
      ? {
          start: rawYearRange.start,
          end: rawYearRange.end,
        }
      : null;
  return {
    id: typeof input.id === "string" ? input.id : null,
    year: safeNumber((input as any).year),
    make: safeString((input as any).make, "Unknown"),
    model: safeString((input as any).model, "Vehicle"),
    trim: typeof (input as any).trim === "string" ? (input as any).trim : null,
    source:
      (input as any).source === "ocr_override"
        ? "ocr_override"
        : (input as any).source === "visual_override"
          ? "visual_override"
          : (input as any).source === "visual_candidate"
            ? "visual_candidate"
            : null,
    displayTrimLabel: typeof (input as any).trim === "string" ? (input as any).trim : null,
    displayTitleLabel: null,
    confidence: safeNumber((input as any).confidence),
    thumbnailUrl: typeof (input as any).thumbnailUrl === "string" ? (input as any).thumbnailUrl : null,
    displayYearLabel: rawDisplayYearLabel || (safeNumber((input as any).year) ? String(safeNumber((input as any).year)) : null),
    groundedYearRange,
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
    source:
      raw.source === "sample_vehicle"
        ? "sample_vehicle"
        : raw.source === "ocr_override"
          ? "ocr_override"
          : raw.source === "visual_override"
            ? "visual_override"
            : raw.source === "visual_candidate"
              ? "visual_candidate"
              : null,
    confidenceScore: safeNumber(raw.confidenceScore),
    detectedVehicleType:
      raw.detectedVehicleType === "motorcycle"
        ? "motorcycle"
        : raw.detectedVehicleType === "truck"
          ? "truck"
          : raw.detectedVehicleType === "car"
            ? "car"
            : null,
    candidates,
    identifiedVehicle: identified,
    scannedAt: typeof raw.scannedAt === "string" ? raw.scannedAt : null,
    limitedPreview: typeof raw.limitedPreview === "boolean" ? raw.limitedPreview : null,
    quickResult: raw.quickResult === true,
    quickResultSource:
      raw.quickResultSource === "offline_canonical" || raw.quickResultSource === "local_scan_cache"
        ? raw.quickResultSource
        : null,
    identificationConfidence: safeNumber(raw.identificationConfidence),
    dataConfidence: safeNumber(raw.dataConfidence),
    payloadStrength:
      raw.payloadStrength === "strong" || raw.payloadStrength === "usable" || raw.payloadStrength === "thin" || raw.payloadStrength === "empty"
        ? raw.payloadStrength
        : null,
    enrichmentMode:
      raw.enrichmentMode === "exact" ||
      raw.enrichmentMode === "adjacent_year" ||
      raw.enrichmentMode === "generation_fallback" ||
      raw.enrichmentMode === "fallback_only"
        ? raw.enrichmentMode
        : null,
    unlockEligible: typeof raw.unlockEligible === "boolean" ? raw.unlockEligible : null,
    unlockRecommendationReason: typeof raw.unlockRecommendationReason === "string" ? raw.unlockRecommendationReason : null,
    isSampleVehicle: raw.isSampleVehicle === true || raw.source === "sample_vehicle",
    previewSpecFacts: [],
    visibleClues: Array.isArray((raw as any)?.normalizedResult?.visible_clues)
      ? (raw as any).normalizedResult.visible_clues.filter((clue: unknown): clue is string => typeof clue === "string" && clue.trim().length > 0)
      : [],
  };
}

async function buildPreviewSpecFacts(
  vehicle: NormalizedVehicle,
  detectedVehicleType: "car" | "truck" | "motorcycle" | null,
): Promise<string[]> {
  const [horsepowerSupport, familySupport] = await Promise.all([
    offlineCanonicalService.resolveHorsepowerSupport({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      vehicleType: detectedVehicleType,
    }),
    offlineCanonicalService.resolveApproximateFamilySupport({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      vehicleType: detectedVehicleType,
    }),
  ]);

  const facts = [
    horsepowerSupport?.value ? `${horsepowerSupport.label}: ${horsepowerSupport.value}` : null,
    familySupport?.sharedSpecs.engine ? `Engine: ${familySupport.sharedSpecs.engine}` : null,
    familySupport?.sharedSpecs.drivetrain ? `Drivetrain: ${familySupport.sharedSpecs.drivetrain}` : null,
    familySupport?.sharedSpecs.bodyStyle ? `Body style: ${familySupport.sharedSpecs.bodyStyle}` : null,
    familySupport?.sharedSpecs.mpgOrRange ? `MPG / Range: ${familySupport.sharedSpecs.mpgOrRange}` : null,
    familySupport?.msrpRangeLabel ? `MSRP: ${familySupport.msrpRangeLabel}` : null,
  ].filter((entry): entry is string => Boolean(entry));

  return [...new Set(facts)].slice(0, 8);
}

function extractPreviewFactValue(facts: string[], label: string) {
  const prefix = `${label}:`;
  const fact = facts.find((entry) => entry.toLowerCase().startsWith(prefix.toLowerCase()));
  return fact ? fact.slice(prefix.length).trim() : null;
}

function normalizeComparableText(value: string | null | undefined) {
  return safeString(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getLocalFreeSpecSupplement(vehicle: NormalizedVehicle) {
  const make = normalizeComparableText(vehicle.make);
  const model = normalizeComparableText(vehicle.model);

  for (const [key, supplement] of Object.entries(LOCAL_FREE_SPEC_SUPPLEMENTS)) {
    const [supplementMake, supplementModel] = key.split(":");
    const normalizedSupplementMake = normalizeComparableText(supplementMake);
    const normalizedSupplementModel = normalizeComparableText(supplementModel);

    if (make === normalizedSupplementMake && normalizedSupplementModel && model.includes(normalizedSupplementModel)) {
      return supplement;
    }
  }

  return null;
}

function cleanSpecValue(value: unknown) {
  const trimmed = safeString(value);
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeComparableText(trimmed);
  const genericValues = new Set([
    "available",
    "unavailable",
    "unknown",
    "n a",
    "na",
    "none",
    "not available",
    "estimated vehicle",
    "model family",
    "see live listing",
    "see listing",
    "live listing",
  ]);
  return genericValues.has(normalized) ? null : trimmed;
}

function cleanPowerValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return `${Math.round(value)} HP`;
  }
  const cleaned = cleanSpecValue(value);
  if (!cleaned) {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(cleaned)) {
    return `${Math.round(Number(cleaned))} HP`;
  }
  return cleaned;
}

function firstCleanValue(values: unknown[], cleaner: (value: unknown) => string | null = cleanSpecValue) {
  for (const value of values) {
    const cleaned = cleaner(value);
    if (cleaned) {
      return cleaned;
    }
  }
  return null;
}

function cleanDrivetrainValue(value: unknown, vehicle: NormalizedVehicle) {
  const cleaned = cleanSpecValue(value);
  if (!cleaned) {
    return null;
  }
  const normalized = normalizeComparableText(cleaned);
  const genericDriveValues = new Set(["car", "truck", "vehicle", "motorcycle", "sedan", "coupe", "suv", "body"]);
  const trim = normalizeComparableText(vehicle.displayTrimLabel ?? vehicle.trim);
  const model = normalizeComparableText(vehicle.model);
  if (genericDriveValues.has(normalized) || (trim && normalized === trim) || (model && normalized === model)) {
    return null;
  }
  return cleaned;
}

function cleanBodyStyleValue(value: unknown, vehicle: NormalizedVehicle) {
  const cleaned = cleanSpecValue(value);
  if (!cleaned) {
    return null;
  }
  const normalized = normalizeComparableText(cleaned);
  const genericBodyValues = new Set(["car", "truck", "vehicle", "motorcycle", "model", "body"]);
  const trim = normalizeComparableText(vehicle.displayTrimLabel ?? vehicle.trim);
  const model = normalizeComparableText(vehicle.model);
  if (genericBodyValues.has(normalized) || (trim && normalized === trim) || (model && normalized === model)) {
    return null;
  }
  return cleaned;
}

function isElectricPowertrain(value: string | null) {
  return Boolean(value && /(electric|ev|motor|battery)/i.test(value));
}

function isRangeLikeSpec(value: string | null, powertrain: string | null) {
  if (!value) {
    return false;
  }
  return isElectricPowertrain(powertrain) || /\b(range|mile|miles|mi\.?)\b/i.test(value);
}

function getPowertrainLabel(specs: ResultSpecValues, curatedSample: boolean) {
  return curatedSample || isElectricPowertrain(specs.powertrain) ? "Powertrain" : "Engine";
}

function joinReadableList(values: string[]) {
  const cleanedValues = values.map((value) => value.trim().replace(/\.+$/, "")).filter(Boolean);
  if (cleanedValues.length <= 1) {
    return cleanedValues[0] ?? "";
  }
  if (cleanedValues.length === 2) {
    return `${cleanedValues[0]} and ${cleanedValues[1]}`;
  }
  return `${cleanedValues.slice(0, -1).join(", ")}, and ${cleanedValues[cleanedValues.length - 1]}`;
}

function buildInsightSubject(vehicle: NormalizedVehicle) {
  const yearLabel = vehicle.displayYearLabel ?? (vehicle.year ? `${vehicle.year}` : "");
  const make = safeString(vehicle.make);
  const model = safeString(vehicle.model);
  const trim = safeString(vehicle.displayTrimLabel ?? vehicle.trim);
  const modelAlreadyIncludesTrim = trim && normalizeComparableText(model).includes(normalizeComparableText(trim));
  const identity = [yearLabel, make, model, modelAlreadyIncludesTrim ? null : trim].filter(Boolean).join(" ").trim();
  return identity || [make, model].filter(Boolean).join(" ").trim() || "This vehicle";
}

function vehicleMakeMatches(vehicle: NormalizedVehicle, terms: string[]) {
  const make = normalizeComparableText(vehicle.make);
  return terms.some((term) => {
    const normalizedTerm = normalizeComparableText(term);
    return normalizedTerm.length > 0 && make.includes(normalizedTerm);
  });
}

function vehicleModelMatches(vehicle: NormalizedVehicle, terms: string[]) {
  const model = normalizeComparableText(vehicle.model);
  const compactModel = model.replace(/\s+/g, "");
  const modelTokens = new Set(model.split(/\s+/).filter(Boolean));
  return terms.some((term) => {
    const normalizedTerm = normalizeComparableText(term);
    const compactTerm = normalizedTerm.replace(/\s+/g, "");
    if (!normalizedTerm) {
      return false;
    }
    if (normalizedTerm.length <= 2) {
      return modelTokens.has(normalizedTerm) || compactModel === compactTerm;
    }
    return model.includes(normalizedTerm) || compactModel.includes(compactTerm);
  });
}

function vehicleYearInRange(vehicle: NormalizedVehicle, start: number, end: number) {
  const year = vehicle.year ?? vehicle.groundedExactYear;
  return typeof year === "number" && year >= start && year <= end;
}

function hasSportIdentity(vehicle: NormalizedVehicle, specs: ResultSpecValues) {
  const trim = normalizeComparableText(vehicle.displayTrimLabel ?? vehicle.trim);
  const body = normalizeComparableText(specs.bodyStyle);
  return (
    vehicleModelMatches(vehicle, [
      "911",
      "boxster",
      "cayman",
      "corvette",
      "camaro",
      "mustang",
      "challenger",
      "charger",
      "miata",
      "mx 5",
      "brz",
      "gr86",
      "supra",
      "eclipse",
      "z",
      "gt r",
      "wrx",
      "s2000",
      "nsx",
    ]) ||
    /\b(gt|gti|si|type r|amg|m sport|m3|m4|rs|st|nismo|srt|ss|z06|zl1)\b/.test(trim) ||
    body.includes("sports car")
  );
}

function hasOffRoadIdentity(vehicle: NormalizedVehicle, specs: ResultSpecValues) {
  const trim = normalizeComparableText(vehicle.displayTrimLabel ?? vehicle.trim);
  const body = normalizeComparableText(specs.bodyStyle);
  return (
    vehicleModelMatches(vehicle, ["wrangler", "bronco", "4runner", "tacoma", "gladiator", "land cruiser", "defender", "g class"]) ||
    /\b(trd pro|trd off road|trailhawk|rubicon|wilderness|zr2|raptor|badlands)\b/.test(trim) ||
    body.includes("off road")
  );
}

function hasElectricIdentity(vehicle: NormalizedVehicle, specs: ResultSpecValues) {
  const allText = normalizeComparableText(
    [vehicle.make, vehicle.model, vehicle.displayTrimLabel ?? vehicle.trim, specs.powertrain, specs.range, specs.bodyStyle].filter(Boolean).join(" "),
  );
  return (
    isElectricPowertrain(specs.powertrain) ||
    /\b(ev|electric|battery|dual motor|single motor|long range|plug in|phev|hybrid)\b/.test(allText) ||
    vehicleMakeMatches(vehicle, ["tesla", "rivian", "lucid"])
  );
}

function buildKnownGenerationInsight(vehicle: NormalizedVehicle) {
  const subject = buildInsightSubject(vehicle);

  if (vehicleMakeMatches(vehicle, ["toyota"]) && vehicleModelMatches(vehicle, ["corolla"]) && vehicleYearInRange(vehicle, 2003, 2008)) {
    return `The ninth-generation Corolla focused on reliability, fuel efficiency, and low ownership costs, helping make it one of Toyota's best-selling global platforms.`;
  }

  if (
    vehicleMakeMatches(vehicle, ["mitsubishi"]) &&
    vehicleModelMatches(vehicle, ["eclipse"]) &&
    !vehicleModelMatches(vehicle, ["eclipse cross"]) &&
    vehicleYearInRange(vehicle, 1995, 1999)
  ) {
    return `The ${subject} sits in the second-generation Eclipse era, remembered for rounded sport-compact styling and strong tuner-era appeal. Its draw is the coupe identity and enthusiast platform, not luxury refinement.`;
  }

  if (vehicleMakeMatches(vehicle, ["jeep"]) && vehicleModelMatches(vehicle, ["wrangler"]) && vehicleYearInRange(vehicle, 2007, 2018)) {
    return `The ${subject} belongs to the JK Wrangler era, where the appeal centers on open-air character, trail hardware, and broad modification support.`;
  }

  if (vehicleMakeMatches(vehicle, ["ford"]) && vehicleModelMatches(vehicle, ["mustang"]) && vehicleYearInRange(vehicle, 2015, 2023)) {
    return `The ${subject} is part of the sixth-generation Mustang run, bringing modern pony-car proportions and a more composed performance platform while keeping the classic long-hood identity.`;
  }

  return null;
}

function buildKnownModelInsight(vehicle: NormalizedVehicle, specs: ResultSpecValues, detectedVehicleType: NormalizedScan["detectedVehicleType"]) {
  const subject = buildInsightSubject(vehicle);

  if (vehicleMakeMatches(vehicle, ["tesla"]) && vehicleModelMatches(vehicle, ["model 3", "3"])) {
    return `The ${subject} blends compact-sedan practicality with software-led EV ownership and access to one of the strongest charging ecosystems available. Its appeal is quick response and daily usability more than traditional luxury cues.`;
  }
  if (vehicleMakeMatches(vehicle, ["tesla"]) && vehicleModelMatches(vehicle, ["model y", "y"])) {
    return `The ${subject} applies Tesla's EV formula to a crossover shape, prioritizing easy daily range, quick response, and family-friendly utility over traditional luxury cues.`;
  }
  if (vehicleMakeMatches(vehicle, ["toyota"]) && vehicleModelMatches(vehicle, ["corolla"])) {
    return `The ${subject} leans into Toyota's compact-car formula: dependable daily use, efficient ownership, and practical packaging rather than flash.`;
  }
  if (vehicleMakeMatches(vehicle, ["toyota"]) && vehicleModelMatches(vehicle, ["camry"])) {
    return `The ${subject} is built around the Camry's core strengths: comfortable midsize packaging, low-drama ownership, and strong everyday dependability.`;
  }
  if (vehicleMakeMatches(vehicle, ["honda"]) && vehicleModelMatches(vehicle, ["civic"])) {
    return `The ${subject} balances efficient compact-car usability with one of the broadest enthusiast and commuter followings in its class.`;
  }
  if (vehicleMakeMatches(vehicle, ["honda"]) && vehicleModelMatches(vehicle, ["accord"])) {
    return `The ${subject} sits in Honda's midsize sweet spot, pairing practical cabin space with a reputation for efficient, durable daily driving.`;
  }
  if (vehicleMakeMatches(vehicle, ["chrysler"]) && vehicleModelMatches(vehicle, ["pt cruiser", "ptcruiser"])) {
    return `The PT Cruiser blended retro styling with compact practicality and became one of Chrysler's most recognizable early-2000s designs.`;
  }
  if (vehicleMakeMatches(vehicle, ["mitsubishi"]) && vehicleModelMatches(vehicle, ["eclipse"]) && !vehicleModelMatches(vehicle, ["eclipse cross"])) {
    return `The ${subject} carries Mitsubishi's sport-compact identity, with appeal rooted in its coupe profile, tuner-era recognition, and accessible performance image.`;
  }
  if (vehicleMakeMatches(vehicle, ["porsche"]) && vehicleModelMatches(vehicle, ["911"])) {
    return `The ${subject} sits in Porsche's core sports-car lineage, valued for precision, everyday usability, and one of the most recognizable performance silhouettes in the world.`;
  }
  if (vehicleMakeMatches(vehicle, ["porsche"]) && vehicleModelMatches(vehicle, ["taycan"])) {
    return `The ${subject} translates Porsche's performance identity into an EV platform, emphasizing immediate response, chassis composure, and premium touring ability.`;
  }
  if (vehicleMakeMatches(vehicle, ["ford"]) && vehicleModelMatches(vehicle, ["mustang"])) {
    return `The ${subject} carries the Mustang's pony-car identity, where the appeal is accessible performance, strong aftermarket depth, and an instantly recognizable profile.`;
  }
  if (vehicleMakeMatches(vehicle, ["ford"]) && vehicleModelMatches(vehicle, ["f 150", "f150"])) {
    return `The ${subject} is a full-size pickup built around work capability, broad configuration choice, and everyday truck practicality. Equipment and condition usually define its appeal.`;
  }
  if (vehicleMakeMatches(vehicle, ["chevrolet", "chevy"]) && vehicleModelMatches(vehicle, ["corvette"])) {
    return `The ${subject} is Chevrolet's dedicated sports-car platform, known for pairing serious performance with comparatively approachable ownership for the segment.`;
  }
  if (vehicleMakeMatches(vehicle, ["chevrolet", "chevy", "gmc"]) && vehicleModelMatches(vehicle, ["silverado", "sierra"])) {
    return `The ${subject} fits the full-size truck brief: hauling utility, trim-dependent comfort, and strong usefulness across work and daily driving.`;
  }
  if (vehicleMakeMatches(vehicle, ["jeep"]) && vehicleModelMatches(vehicle, ["wrangler"])) {
    return `The ${subject} is defined by Wrangler's off-road identity, open-air character, and deep modification ecosystem rather than conventional crossover polish.`;
  }
  if (vehicleMakeMatches(vehicle, ["toyota"]) && vehicleModelMatches(vehicle, ["4runner", "4 runner"])) {
    return `The ${subject} is a truck-based SUV with a durability-first reputation, strong off-road credibility, and an ownership story centered on longevity.`;
  }
  if (vehicleMakeMatches(vehicle, ["toyota"]) && vehicleModelMatches(vehicle, ["tacoma"])) {
    return `The ${subject} is a midsize pickup known for durability, off-road trims, and strong owner loyalty more than outright refinement.`;
  }
  if (vehicleMakeMatches(vehicle, ["subaru"]) && vehicleModelMatches(vehicle, ["outback", "forester", "crosstrek"])) {
    return `The ${subject} leans into Subaru's practical adventure formula, blending everyday usability with all-weather confidence and wagon-SUV versatility.`;
  }
  if (vehicleMakeMatches(vehicle, ["mazda"]) && vehicleModelMatches(vehicle, ["miata", "mx 5", "mx5"])) {
    return `The ${subject} is Mazda's lightweight roadster formula at its purest: simple, balanced, and built around driver involvement over raw numbers.`;
  }
  if (vehicleMakeMatches(vehicle, ["harley davidson", "harley"]) || detectedVehicleType === "motorcycle") {
    if (vehicleModelMatches(vehicle, ["street glide", "road glide", "electra glide"])) {
      return `The ${subject} reads as a touring bagger, built around highway comfort, long-distance presence, and the character of a large-displacement cruiser platform.`;
    }
    return `The ${subject} should be judged by riding position, engine character, service history, and intended use more than car-style spec comparisons.`;
  }

  if (hasOffRoadIdentity(vehicle, specs)) {
    return `The ${subject} has an off-road-oriented identity, where ground clearance, trim equipment, tires, and prior use matter as much as the model badge.`;
  }
  if (hasSportIdentity(vehicle, specs)) {
    return `The ${subject} reads as an enthusiast-focused vehicle, with appeal tied to driver engagement, condition, and trim-specific hardware more than basic transportation.`;
  }

  return null;
}

function buildBodyStyleInsight(vehicle: NormalizedVehicle, specs: ResultSpecValues, detectedVehicleType: NormalizedScan["detectedVehicleType"]) {
  const subject = buildInsightSubject(vehicle);
  const body = normalizeComparableText(specs.bodyStyle);

  if (hasElectricIdentity(vehicle, specs)) {
    return `The ${subject} is best understood through its EV ownership strengths: instant response, quiet daily use, and range or charging fit for the driver's routine.`;
  }
  if (detectedVehicleType === "motorcycle" || body.includes("motorcycle")) {
    return `The ${subject} is a motorcycle result, so the useful context is riding style, ergonomics, service condition, and how the bike is configured.`;
  }
  if (body.includes("pickup") || body.includes("truck")) {
    return `The ${subject} is positioned around utility, cab and bed configuration, and work-ready durability. Condition, options, and use history are the details that matter most.`;
  }
  if (body.includes("suv") || body.includes("sport utility") || body.includes("crossover")) {
    return `The ${subject} focuses on passenger space, cargo flexibility, and everyday versatility, with trim and drivetrain shaping its real-world appeal.`;
  }
  if (body.includes("coupe") || body.includes("convertible") || body.includes("roadster")) {
    return `The ${subject} has a more style- and driver-focused identity, where body condition, trim, and ownership history matter more than simple commuter utility.`;
  }
  if (body.includes("sedan") || body.includes("hatch") || body.includes("wagon")) {
    return `The ${subject} is rooted in practical daily use, efficient packaging, and approachable ownership, with trim and condition doing most of the differentiating.`;
  }
  if (vehicleMakeMatches(vehicle, ["lexus", "mercedes benz", "bmw", "audi", "cadillac", "lincoln", "genesis", "infiniti", "acura"])) {
    return `The ${subject} sits in a premium ownership lane, where cabin condition, options, and maintenance history are central to how the vehicle presents.`;
  }

  return null;
}

function buildResultSpecFacts(specs: ResultSpecValues, options: { curatedSample: boolean; includeReferenceSpecs: boolean }) {
  const powertrainLabel = getPowertrainLabel(specs, options.curatedSample);
  return [
    specs.powertrain ? `${powertrainLabel}: ${specs.powertrain}` : null,
    specs.horsepower ? `Power: ${specs.horsepower}` : null,
    specs.drivetrain ? `Drivetrain: ${specs.drivetrain}` : null,
    (options.curatedSample || options.includeReferenceSpecs) && specs.acceleration ? `0-60: ${specs.acceleration}` : null,
    (options.curatedSample || options.includeReferenceSpecs) && specs.range ? `Range: ${specs.range}` : null,
    options.includeReferenceSpecs && specs.mpg ? `MPG: ${specs.mpg}` : null,
    options.includeReferenceSpecs && specs.msrp ? `MSRP: ${specs.msrp}` : null,
    specs.bodyStyle ? `Body style: ${specs.bodyStyle}` : null,
  ].filter((entry): entry is string => Boolean(entry));
}

function buildResultStats(specs: ResultSpecValues, options: { curatedSample: boolean; includeReferenceSpecs: boolean }): ResultStat[] {
  const powertrainLabel = getPowertrainLabel(specs, options.curatedSample);
  return [
    specs.powertrain
      ? {
          label: powertrainLabel,
          value: specs.powertrain,
          icon: isElectricPowertrain(specs.powertrain) ? "flash-outline" : "speedometer-outline",
      }
      : null,
    specs.horsepower ? { label: "Power", value: specs.horsepower, icon: "flash-outline" } : null,
    specs.drivetrain ? { label: "Drive", value: specs.drivetrain, icon: "git-branch-outline" } : null,
    (options.curatedSample || options.includeReferenceSpecs) && specs.acceleration ? { label: "0-60", value: specs.acceleration, icon: "timer-outline" } : null,
    (options.curatedSample || options.includeReferenceSpecs) && specs.range ? { label: "Range", value: specs.range, icon: "battery-charging-outline" } : null,
    options.includeReferenceSpecs && specs.mpg ? { label: "MPG", value: specs.mpg, icon: "leaf-outline" } : null,
    options.includeReferenceSpecs && specs.msrp ? { label: "MSRP", value: specs.msrp, icon: "pricetag-outline" } : null,
    specs.bodyStyle ? { label: "Body", value: specs.bodyStyle, icon: "car-sport-outline" } : null,
  ].filter((stat): stat is ResultStat => Boolean(stat));
}

function buildConciseInsight(input: {
  vehicle: NormalizedVehicle;
  specs: ResultSpecValues;
  detectedVehicleType: NormalizedScan["detectedVehicleType"];
  confidenceScore: number | null;
}) {
  const subject = buildInsightSubject(input.vehicle);
  const generationInsight = buildKnownGenerationInsight(input.vehicle);
  if (generationInsight) {
    return generationInsight;
  }

  const modelInsight = buildKnownModelInsight(input.vehicle, input.specs, input.detectedVehicleType);
  if (modelInsight) {
    return modelInsight;
  }

  const bodyInsight = buildBodyStyleInsight(input.vehicle, input.specs, input.detectedVehicleType);
  if (bodyInsight) {
    return bodyInsight;
  }

  if (input.confidenceScore !== null && input.confidenceScore < 0.55) {
    return `${subject} is a lower-confidence match, so the useful next step is another angle that can lock in the exact year, model, and trim.`;
  }

  return `${subject} has limited local context available, so this free insight stays focused on the confirmed identity rather than guessing beyond the data.`;
}

function removeDuplicateFacts(facts: string[], blockedFacts: Array<string | null | undefined>) {
  const blocked = new Set(blockedFacts.map((fact) => normalizeComparableText(fact)).filter(Boolean));
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = normalizeComparableText(fact);
    if (!key || seen.has(key) || blocked.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function getFactLabel(fact: string) {
  const separatorIndex = fact.indexOf(":");
  return separatorIndex > -1 ? fact.slice(0, separatorIndex).trim() : fact.trim();
}

function normalizeFactLabel(label: string) {
  const normalized = normalizeComparableText(label);
  if (normalized === "drivetrain") {
    return "drive";
  }
  if (normalized === "body style") {
    return "body";
  }
  if (normalized === "powertrain") {
    return "engine";
  }
  return normalized;
}

function removeFactsAlreadyShownInStats(facts: string[], stats: ResultStat[]) {
  if (stats.length === 0) {
    return facts;
  }

  const visibleStatLabels = new Set(stats.map((stat) => normalizeFactLabel(stat.label)).filter(Boolean));
  return facts.filter((fact) => !visibleStatLabels.has(normalizeFactLabel(getFactLabel(fact))));
}

function parseMoneyValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  }
  const raw = safeString(value);
  if (!raw) {
    return 0;
  }
  const matches = raw.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,}(?:\.\d+)?/g) ?? [];
  const values = matches
    .map((match) => Number(match.replace(/,/g, "")))
    .filter((parsed) => Number.isFinite(parsed) && parsed > 0);
  if (values.length === 0) {
    return 0;
  }
  const referenceValue = values.length === 1
    ? values[0]
    : values.reduce((sum, parsed) => sum + parsed, 0) / values.length;
  return Math.round(referenceValue);
}

async function resolveLocalGarageReferenceValue(input: {
  vehicle: NormalizedVehicle;
  detectedVehicleType: "car" | "truck" | "motorcycle" | null | undefined;
  displayedMsrp: string | null;
}) {
  try {
    const familySupport = await offlineCanonicalService.resolveApproximateFamilySupport({
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
      trim: input.vehicle.trim,
      vehicleType: input.detectedVehicleType,
    });
    const canonicalReference = parseMoneyValue(familySupport?.vehicle?.basicSpecs?.msrp);
    if (canonicalReference > 0) {
      return canonicalReference;
    }
    const localSpreadsheetReference = offlineCanonicalService.resolveLocalReferenceValue({
      year: input.vehicle.year,
      make: input.vehicle.make,
      model: input.vehicle.model,
    });
    if (localSpreadsheetReference?.value) {
      return localSpreadsheetReference.value;
    }
    const rangeReference = parseMoneyValue(familySupport?.msrpRangeLabel);
    if (rangeReference > 0) {
      return rangeReference;
    }
  } catch (err) {
    console.log("[scan-result] GARAGE_REFERENCE_VALUE_LOCAL_LOOKUP_FAILED", err);
  }
  return parseMoneyValue(input.displayedMsrp);
}

function formatDemoMileage(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value.toLocaleString("en-US")} mi`
    : "Demo mileage";
}

function formatDemoDistance(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${value} mi away` : null;
}

function getSampleListingThumbnailSource(sample: NonNullable<ReturnType<typeof findSampleScanPhoto>>): ImageSourcePropType {
  const bodyStyle = sample.specs.bodyStyle.toLowerCase();
  if (sample.specs.vehicleType === "motorcycle" || bodyStyle.includes("motorcycle")) {
    return SILHOUETTE_IMAGES.motorcycle;
  }
  if (bodyStyle.includes("coupe")) {
    return SILHOUETTE_IMAGES.coupe;
  }
  if (bodyStyle.includes("sedan")) {
    return SILHOUETTE_IMAGES.sedan;
  }
  if (bodyStyle.includes("suv")) {
    return SILHOUETTE_IMAGES.suv;
  }
  if (bodyStyle.includes("truck") || bodyStyle.includes("pickup")) {
    return SILHOUETTE_IMAGES.pickup_truck;
  }
  return SILHOUETTE_IMAGES.neutral_vehicle;
}

function buildSampleMarketPreview(sample: NonNullable<ReturnType<typeof findSampleScanPhoto>>) {
  const value = sample.demoValue;
  return [
    {
      label: "Demo value range",
      value: `${formatCurrency(value.tradeIn)} - ${formatCurrency(value.dealerRetail)}`,
      detail: "Trade-in to retail sample band",
    },
    {
      label: "Private party",
      value: formatCurrency(value.privateParty),
      detail: `${formatDemoMileage(value.mileage)} demo baseline`,
    },
    {
      label: "Retail signal",
      value: formatCurrency(value.dealerRetail),
      detail: "Curated sample estimate",
    },
  ];
}

function buildSampleListingPreview(sample: NonNullable<ReturnType<typeof findSampleScanPhoto>>) {
  const thumbnailSource = getSampleListingThumbnailSource(sample);
  return sample.demoListings.slice(0, 2).map((listing, index) => {
    const price = typeof listing.price === "number" && Number.isFinite(listing.price) ? formatCurrency(listing.price) : "Demo price";
    const mileage = formatDemoMileage(listing.mileage);
    const distance = formatDemoDistance(listing.distanceMiles);
    const location = safeString(listing.location);
    const marketMeta = [mileage, distance].filter(Boolean).join(" | ");
    return {
      id: safeString(listing.id, `sample-listing-${sample.id}-${index + 1}`),
      title: safeString(listing.title, `${sample.year} ${sample.make} ${sample.model} ${sample.trim}`),
      price,
      seller: safeString(listing.dealer, "Sample seller"),
      marketMeta,
      location,
      thumbnailSource,
    };
  });
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

function isExtremeRiskFamily(vehicle: Pick<NormalizedVehicle, "make" | "model" | "year">) {
  const make = vehicle.make.toLowerCase();
  const model = vehicle.model.toLowerCase();
  const combined = `${make} ${model}`;
  const isClassic = typeof vehicle.year === "number" && vehicle.year > 0 && vehicle.year < 1996;
  const isRareExoticBrand = /ferrari|lamborghini|mclaren|aston martin|lotus|koenigsegg|pagani|rimac|bugatti|rolls royce|bentley/.test(make);
  const isRareExoticModel = /huracan|aventador|sf90|296 gtb|artura|senna|chiron|nevera|ghost|phantom|continental gt/.test(combined);
  return isClassic || isRareExoticBrand || isRareExoticModel;
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
  detectedVehicleType: "car" | "truck" | "motorcycle" | null,
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
      displayYearLabel:
        vehicle.displayYearLabel ??
        resolveDisplayYearLabel({
          rawYear: vehicle.year,
          confidence: vehicle.confidence,
          yearRange: vehicle.groundedYearRange,
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
    displayYearLabel: vehicle.displayYearLabel ?? displayYearLabel,
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
    previewSpecFacts: await buildPreviewSpecFacts(
      {
        ...resolvedIdentifiedVehicle,
        displayTitleLabel: buildDisplayTitleLabel(resolvedIdentifiedVehicle),
      },
      normalizedScan.detectedVehicleType,
    ),
  };
}

export default function ScanResultScreen() {
  const insets = useSafeAreaInsets();
  const rawParams = useLocalSearchParams<{ scanId?: string; imageUri?: string }>();
  const params = typeof rawParams === "object" && rawParams ? rawParams : {};
  const scanId = typeof params.scanId === "string" ? params.scanId : undefined;
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [normalized, setNormalized] = useState<NormalizedScan | null>(null);
  const [selectedResultCardKey, setSelectedResultCardKey] = useState<string>("best-match");
  const [showBasicInfoDetails, setShowBasicInfoDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [garageSaveState, setGarageSaveState] = useState<"idle" | "saving" | "saved" | "removing">("idle");
  const [savedGarageItemId, setSavedGarageItemId] = useState<string | null>(null);
  const [garageSaveError, setGarageSaveError] = useState<string | null>(null);
  const garageOperationVersionRef = useRef(0);
  const unlockConfirmationOpenRef = useRef(false);
  const unlockSpendInFlightRef = useRef(false);
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
  const screenOpacity = useRef(new Animated.Value(0)).current;
  const screenTranslate = useRef(new Animated.Value(10)).current;
  const bestMatchScale = useRef(new Animated.Value(0.97)).current;
  const bestMatchOpacity = useRef(new Animated.Value(0)).current;
  const confidenceOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setGarageSaveState("idle");
    setSavedGarageItemId(null);
    setGarageSaveError(null);
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
          setShowBasicInfoDetails(false);
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

  useEffect(() => {
    if (!__DEV__ || !normalized) {
      return;
    }
    console.log("[scan-result] UNLOCK_PROTECTION_SCAN_RESULT", {
      scanId: normalized.id,
      identifiedCandidate: {
        year: normalized.identifiedVehicle.year,
        make: normalized.identifiedVehicle.make,
        model: normalized.identifiedVehicle.model,
        trim: normalized.identifiedVehicle.trim,
        source: normalized.source,
        confidence: normalized.identificationConfidence ?? normalized.confidenceScore,
      },
      candidateSet: normalized.candidates.map((candidate) => ({
        year: candidate.year,
        make: candidate.make,
        model: candidate.model,
        trim: candidate.trim,
      })),
      payloadStrength: normalized.payloadStrength,
      unlockEligible: normalized.unlockEligible,
      unlockRecommendationReason: normalized.unlockRecommendationReason,
      finalDisplayedFallbackReason: normalized.unlockEligible === false ? normalized.unlockRecommendationReason : null,
    });
  }, [normalized]);

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
  let confidenceLine = "Confidence: 0% match";
  let insightLine = "Solid all-around vehicle.";
  const isCatalogMatched = Boolean(bestMatch.id);
  const isQuickResult = normalized?.quickResult === true;
  const isSampleScan = normalized?.isSampleVehicle === true || normalized?.source === "sample_vehicle";
  const isPro = isProPlan(usage?.plan);
  const displayConfidenceScore = safeNumber(normalized?.confidenceScore, 0) ?? 0;
  const isVisualOverride = normalized?.source === "visual_override" || bestMatch.source === "visual_override";
  const isHighConfidenceVisualOverride = !isCatalogMatched && isVisualOverride && displayConfidenceScore >= 0.9;
  const isHighConfidenceTrustedVisualOverride = isHighConfidenceVisualOverride && !isExtremeRiskFamily(bestMatch);
  const bestMatchUnlockId = buildVehicleUnlockId({
    vehicleId: bestMatch.id,
    scanId: normalized?.id ?? null,
    year: bestMatch.year ?? normalized?.identifiedVehicle.year ?? null,
    groundedYear: bestMatch.groundedExactYear,
    make: bestMatch.make,
    model: bestMatch.model,
    trim: bestMatch.trim ?? null,
    vehicleType: normalized?.detectedVehicleType ?? null,
    groundedMatchType: bestMatch.groundedMatchType,
  });
  const bestMatchSoftUnlockId = buildVehicleSoftUnlockId({
    make: bestMatch.make,
    model: bestMatch.model,
    vehicleType: normalized?.detectedVehicleType ?? null,
    year: bestMatch.year ?? normalized?.identifiedVehicle.year ?? null,
    trusted: isHighConfidenceTrustedVisualOverride,
  });
  const bestMatchLookupYear = bestMatch.year ?? normalized?.identifiedVehicle.year ?? null;
  const bestMatchUnlockLookup =
    bestMatchLookupYear && bestMatch.make && bestMatch.model
      ? {
          vehicleId: bestMatch.id ?? bestMatchUnlockId,
          descriptor: {
            year: bestMatchLookupYear,
            make: bestMatch.make,
            model: bestMatch.model,
            trim: bestMatch.trim ?? null,
            vehicleType: normalized?.detectedVehicleType ?? null,
          },
        }
      : {
          vehicleId: bestMatch.id ?? bestMatchUnlockId,
          descriptor: null,
        };
  const approximateUnlockId = isHighConfidenceVisualOverride ? bestMatchUnlockId : null;
  const unlockedForVehicle = bestMatchUnlockId ? isVehicleUnlocked(bestMatchUnlockId) : false;
  const unlockedForApproximateDetail = approximateUnlockId
    ? isVehicleUnlocked(approximateUnlockId) || (bestMatchSoftUnlockId ? isVehicleUnlocked(bestMatchSoftUnlockId) : false)
    : false;
  const hasFullAccess = isSampleScan
    ? true
    : isCatalogMatched
    ? isPro || unlockedForVehicle
    : isHighConfidenceVisualOverride
      ? isPro || unlockedForApproximateDetail
      : false;
  const isHighConfidence = displayConfidenceScore >= 0.82;
  const confidencePalette =
    displayConfidenceScore >= 0.9
      ? { pill: "rgba(12,24,40,0.92)", text: "#EAF3FF", label: "#D8E8FF", dot: Colors.accent }
      : displayConfidenceScore >= 0.75
        ? { pill: "rgba(44,127,255,0.14)", text: Colors.premium, label: Colors.premium, dot: Colors.accent }
        : { pill: "rgba(100,116,139,0.18)", text: Colors.textSoft, label: Colors.textMuted, dot: Colors.textMuted };
  try {
    if (normalized) {
      const candidates = Array.isArray(normalized.candidates) ? normalized.candidates : [];
      candidatesForRender = buildRenderCandidates(candidates);
      const bestKey = candidatesForRender[0]?.renderKey;
      bestMatch = candidatesForRender[0] ?? bestMatch;
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

  const bestMatchYearLabel = bestMatch.displayYearLabel;
  const bestMatchTitle = bestMatch.displayTitleLabel ?? [bestMatchYearLabel, bestMatch.make, bestMatch.model].filter(Boolean).join(" ");
  const bestMatchSubtitle = resolveResultSubtitle(bestMatch);
  const buildDisplayIdentityParams = (vehicle: NormalizedVehicle) => ({
    titleLabel: vehicle.displayTitleLabel ?? [vehicle.displayYearLabel, vehicle.make, vehicle.model].filter(Boolean).join(" "),
    yearLabel: vehicle.displayYearLabel ?? (vehicle.year ? `${vehicle.year}` : ""),
    make: vehicle.make,
    model: vehicle.model,
    trimLabel: vehicle.displayTrimLabel ?? vehicle.trim ?? "",
    vehicleType: normalized?.detectedVehicleType ?? "",
    confidence: `${vehicle.confidence ?? displayConfidenceScore}`,
    trustedCase: isHighConfidenceTrustedVisualOverride ? "1" : "0",
    resultSource: vehicle.source ?? normalized?.source ?? "",
    isSampleVehicle: isSampleScan ? "1" : "0",
    source: isSampleScan ? "sample_vehicle" : (vehicle.source ?? normalized?.source ?? ""),
  });
  const buildEstimateDetailParams = (vehicle: NormalizedVehicle) => ({
    id: buildEstimateDetailId(normalized?.id, vehicle),
    estimate: "1",
    imageUri: normalized?.imageUri ?? "",
    scanId: normalized?.id ?? "",
    ...buildDisplayIdentityParams(vehicle),
  });
  const getDetailTarget = (vehicle: NormalizedVehicle) => {
    if (vehicle.id) {
      return {
        kind: "grounded" as const,
        params: {
          id: vehicle.id,
          unlockId: isSampleScan ? "" : buildVehicleUnlockId({ vehicleId: vehicle.id }),
          imageUri: normalized?.imageUri ?? "",
          scanId: normalized?.id ?? "",
          ...buildDisplayIdentityParams(vehicle),
        },
      };
    }
    if (canRenderEstimatedDetail(vehicle)) {
      return {
        kind: "estimated" as const,
        params: {
          ...buildEstimateDetailParams(vehicle),
          unlockId: buildVehicleUnlockId({
            vehicleId: vehicle.id,
            scanId: normalized?.id ?? null,
            year: vehicle.year,
            groundedYear: vehicle.groundedExactYear,
            make: vehicle.make,
            model: vehicle.model,
            trim: vehicle.trim ?? null,
            vehicleType: normalized?.detectedVehicleType ?? null,
            groundedMatchType: vehicle.groundedMatchType,
          }) ?? "",
          reopenedSource: "1",
        },
      };
    }
    return {
      kind: "none" as const,
      params: null,
    };
  };
  const requiresApproximateUnlock = !isSampleScan && !isCatalogMatched && isHighConfidenceVisualOverride;
  const openVehicleDetail = (
    vehicle: NormalizedVehicle,
    source: string,
    options?: {
      allowLockedApproximate?: boolean;
      initialTab?: "Overview" | "Specs" | "Value" | "For Sale" | "Photos";
      marketIntent?: "value" | "listings" | "bundle";
    },
  ) => {
    const target = getDetailTarget(vehicle);
    console.log("[tap] result-open-request", {
      source,
      vehicleId: vehicle.id,
      targetKind: target.kind,
    });
    if (requiresApproximateUnlock && !hasFullAccess && !options?.allowLockedApproximate) {
      console.log("[scan-result] APPROXIMATE_DETAIL_LOCKED", {
        source,
        scanId: normalized?.id ?? null,
        unlockId: approximateUnlockId,
      });
      return;
    }
    if (target.kind === "none" || !target.params) {
      console.log("[scan-result] FALLBACK_CARD_TAPPED", { source, scanId: normalized?.id ?? null });
      return;
    }
    router.push({
      pathname: "/vehicle/[id]",
      params: {
        ...target.params,
        ...(options?.initialTab ? { initialTab: options.initialTab } : null),
        ...(options?.marketIntent ? { marketIntent: options.marketIntent } : null),
      },
    });
  };
  const useCandidate = (candidate: NormalizedVehicle) => {
    console.log("[tap] result-use-candidate", { candidateId: candidate.id, model: candidate.model });
    setSelectedResultCardKey(candidate.id || `${candidate.year ?? "unknown"}:${candidate.make}:${candidate.model}`);
  };

  const bestMatchDetailTarget = getDetailTarget(bestMatch);
  const garageUnlockId =
    bestMatchDetailTarget.params?.unlockId ||
    bestMatchDetailTarget.params?.id ||
    bestMatchUnlockId ||
    bestMatchSoftUnlockId ||
    buildEstimateDetailId(normalized?.id, bestMatch);
  const canOpenBestMatch = bestMatchDetailTarget.kind !== "none" && (!requiresApproximateUnlock || hasFullAccess);
  const unlockWorthinessBlocked = normalized?.unlockEligible === false;
  const unlockFailureTitle = (reason?: string) =>
    reason === "payload_too_thin" ? "Unlock protected" : reason === "backend_error" ? "Unlock service unavailable" : "Unlock unavailable";
  const unlockWorthinessMessage =
    normalized?.unlockRecommendationReason ?? "We found the vehicle, but there is not enough useful detail yet to make an unlock worth it.";
  const confirmVehicleMarketUnlockSpend = async () => {
    if (unlockConfirmationOpenRef.current) {
      return false;
    }
    unlockConfirmationOpenRef.current = true;
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
    unlockConfirmationOpenRef.current = false;
    return confirmed;
  };
  const buildVehicleMarketUnlockSuccessBody = (alreadyUnlocked: boolean) => {
    const nextRemaining = Number.isFinite(freeUnlocksRemaining)
      ? alreadyUnlocked
        ? freeUnlocksRemaining
        : Math.max(0, freeUnlocksRemaining - 1)
      : null;
    return `Live market value and nearby listings are unlocked for this vehicle.${nextRemaining != null ? `\n\n${nextRemaining} ${nextRemaining === 1 ? "unlock" : "unlocks"} remaining.` : ""}`;
  };
  const handleHighConfidenceVisualOverrideAction = async (source: string) => {
    if (isUnlocking || unlockSpendInFlightRef.current) {
      return;
    }
    if (!isHighConfidenceVisualOverride) {
      handleOpenBestMatch();
      return;
    }
    if (hasFullAccess) {
      openVehicleDetail(bestMatch, source);
      return;
    }
    if (unlockWorthinessBlocked) {
      if (__DEV__) {
        console.log("[scan-result] UNLOCK_PROTECTION_BLOCKED", {
          source,
          scanId: normalized?.id ?? null,
          payloadStrength: normalized?.payloadStrength ?? null,
          unlockEligible: normalized?.unlockEligible ?? null,
          unlockRecommendationReason: unlockWorthinessMessage,
          finalDisplayedFallbackReason: unlockWorthinessMessage,
        });
      }
      Alert.alert("Unlock protected", unlockWorthinessMessage);
      return;
    }
    if (freeUnlocksRemaining > 0 && approximateUnlockId) {
      const confirmed = await confirmVehicleMarketUnlockSpend();
      if (!confirmed) {
        return;
      }
      unlockSpendInFlightRef.current = true;
      try {
        const result = await useFreeUnlockForVehicle(
          approximateUnlockId,
          bestMatchSoftUnlockId ? [bestMatchSoftUnlockId] : [],
          bestMatchUnlockLookup,
        );
        if (result.ok) {
          await refreshStatus();
          Alert.alert(
            "Value & Listings unlocked",
            buildVehicleMarketUnlockSuccessBody(result.alreadyUnlocked),
          );
          openVehicleDetail(bestMatch, `${source}-unlocked`);
        } else {
          Alert.alert(unlockFailureTitle(result.reason), result.message || errorMessage || "We couldn’t apply your free unlock right now.");
        }
      } finally {
        unlockSpendInFlightRef.current = false;
      }
      return;
    }
    router.push("/paywall");
  };
  const handleOpenBestMatch = () => {
    setSelectedResultCardKey("best-match");
  };
  const handleViewBasicInfo = () => {
    setSelectedResultCardKey("best-match");
    setShowBasicInfoDetails(true);
  };
  const handleOpenFullDetail = () => {
    console.log("[tap] result-open-full-detail", { vehicleId: bestMatch.id, targetKind: bestMatchDetailTarget.kind });
    openVehicleDetail(bestMatch, "open-full-detail");
  };
  const handlePrimaryResultAction = async () => {
    if (isUnlocking || unlockSpendInFlightRef.current) {
      return;
    }
    if (isSampleScan || hasFullAccess) {
      handleOpenFullDetail();
      return;
    }
    if (isHighConfidenceVisualOverride) {
      await handleHighConfidenceVisualOverrideAction("primary-result-cta");
      return;
    }
    console.log("[tap] result-use-free-unlock", { vehicleId: bestMatch.id });
    if (!bestMatch.id) {
      console.log("[scan-result] FALLBACK_CARD_TAPPED", { source: "primary-result-cta", scanId: normalized?.id ?? null });
      return;
    }
    const confirmed = await confirmVehicleMarketUnlockSpend();
    if (!confirmed) {
      return;
    }
    unlockSpendInFlightRef.current = true;
    try {
      const result = await useFreeUnlockForVehicle(bestMatch.id, [], bestMatchUnlockLookup);
      if (result.ok) {
        await refreshStatus();
        Alert.alert(
          "Value & Listings unlocked",
          buildVehicleMarketUnlockSuccessBody(result.alreadyUnlocked),
        );
        openVehicleDetail(bestMatch, "free-unlock-continue");
      } else {
        Alert.alert(
          unlockFailureTitle(result.reason),
          result.message || errorMessage || "We couldn’t apply your free unlock right now.",
        );
      }
    } finally {
      unlockSpendInFlightRef.current = false;
    }
  };
  const fallbackConfidenceLabel =
    isHighConfidenceTrustedVisualOverride
      ? "High confidence"
      : isHighConfidenceVisualOverride
      ? "High confidence"
      : displayConfidenceScore >= 0.9
        ? "High confidence"
        : displayConfidenceScore >= 0.8
          ? "Likely match"
          : "Estimated match";
  const resultImageSource = normalized?.imageUri ? "scanned-photo" : "none";
  const resultImageFitMode = normalized?.imageUri ? "contain" : "cover";
  const basicPreviewFacts = [
    bestMatch.displayTrimLabel ? `Trim: ${bestMatch.displayTrimLabel}` : null,
    normalized?.detectedVehicleType ? `Vehicle type: ${normalized.detectedVehicleType === "motorcycle" ? "Motorcycle" : "Car"}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  const previewSpecFacts = normalized?.previewSpecFacts ?? [];
  const normalizedSampleId =
    typeof normalized?.id === "string" && normalized.id.startsWith("sample-")
      ? normalized.id.slice("sample-".length)
      : normalized?.id;
  const sampleVehicle = isSampleScan ? findSampleScanPhoto(bestMatch.id ?? normalized?.identifiedVehicle.id ?? normalizedSampleId) : null;
  const curatedSampleDetails = sampleVehicle ? CURATED_SAMPLE_RESULT_DETAILS[sampleVehicle.id] ?? null : null;
  const isCuratedSampleResult = Boolean(curatedSampleDetails);
  const isSamplePreviewMode = Boolean(sampleVehicle);
  const sampleSpecs = sampleVehicle?.specs ?? null;
  const sampleMarketPreview = sampleVehicle ? buildSampleMarketPreview(sampleVehicle) : [];
  const sampleListingPreview = sampleVehicle ? buildSampleListingPreview(sampleVehicle) : [];
  const includeReferenceSpecs = !isSamplePreviewMode;
  const localFreeSpecSupplement = includeReferenceSpecs ? getLocalFreeSpecSupplement(bestMatch) : null;
  const powertrainValue = firstCleanValue([
    sampleSpecs?.engine,
    extractPreviewFactValue(previewSpecFacts, "Powertrain"),
    extractPreviewFactValue(previewSpecFacts, "Motor"),
    extractPreviewFactValue(previewSpecFacts, "Engine"),
    localFreeSpecSupplement?.powertrain,
  ]);
  const mpgOrRangeValue = firstCleanValue([
    sampleSpecs?.mpgOrRange,
    extractPreviewFactValue(previewSpecFacts, "MPG / Range"),
    extractPreviewFactValue(previewSpecFacts, "MPG"),
    extractPreviewFactValue(previewSpecFacts, "Range"),
  ]);
  const localAccelerationValue = firstCleanValue([
    extractPreviewFactValue(previewSpecFacts, "0-60"),
    extractPreviewFactValue(previewSpecFacts, "0–60"),
    extractPreviewFactValue(previewSpecFacts, "Acceleration"),
    localFreeSpecSupplement?.acceleration,
  ]);
  const localRangeValue = includeReferenceSpecs
    ? firstCleanValue([
        isRangeLikeSpec(mpgOrRangeValue, powertrainValue) ? mpgOrRangeValue : null,
        localFreeSpecSupplement?.range,
      ])
    : null;
  const localMpgValue = includeReferenceSpecs
    ? firstCleanValue([
        mpgOrRangeValue && !isRangeLikeSpec(mpgOrRangeValue, powertrainValue) ? mpgOrRangeValue : null,
        localFreeSpecSupplement?.mpg,
      ])
    : null;
  const resultSpecValues: ResultSpecValues = {
    powertrain: powertrainValue,
    horsepower: firstCleanValue(
      [
        sampleSpecs?.horsepower,
        extractPreviewFactValue(previewSpecFacts, "Power"),
        extractPreviewFactValue(previewSpecFacts, "Horsepower"),
        extractPreviewFactValue(previewSpecFacts, "Typical horsepower"),
        extractPreviewFactValue(previewSpecFacts, "Horsepower varies by trim"),
        localFreeSpecSupplement?.horsepower,
      ],
      cleanPowerValue,
    ),
    drivetrain: firstCleanValue(
      [
        sampleSpecs?.drivetrain,
        extractPreviewFactValue(previewSpecFacts, "Drivetrain"),
        extractPreviewFactValue(previewSpecFacts, "Drive"),
        localFreeSpecSupplement?.drivetrain,
      ],
      (value) => cleanDrivetrainValue(value, bestMatch),
    ),
    acceleration: curatedSampleDetails?.acceleration ?? (includeReferenceSpecs ? localAccelerationValue : null),
    range: curatedSampleDetails?.range ?? localRangeValue,
    mpg: localMpgValue,
    msrp: includeReferenceSpecs ? firstCleanValue([extractPreviewFactValue(previewSpecFacts, "MSRP"), localFreeSpecSupplement?.msrp]) : null,
    bodyStyle: firstCleanValue(
      [
        sampleSpecs?.bodyStyle,
        extractPreviewFactValue(previewSpecFacts, "Body style"),
        extractPreviewFactValue(previewSpecFacts, "Body"),
        localFreeSpecSupplement?.bodyStyle,
      ],
      (value) => cleanBodyStyleValue(value, bestMatch),
    ),
  };
  const displaySpecFacts = buildResultSpecFacts(resultSpecValues, { curatedSample: isCuratedSampleResult, includeReferenceSpecs });
  const resultStats = buildResultStats(resultSpecValues, { curatedSample: isCuratedSampleResult, includeReferenceSpecs });
  const previewDescription = displaySpecFacts.length > 0 ? buildVehicleDescription({
    year: bestMatch.year,
    make: bestMatch.make,
    model: bestMatch.model,
    trim: bestMatch.displayTrimLabel ?? bestMatch.trim ?? null,
    bodyStyle: resultSpecValues.bodyStyle,
    engine: resultSpecValues.powertrain,
    horsepower: typeof sampleSpecs?.horsepower === "number" ? sampleSpecs.horsepower : null,
    drivetrain: resultSpecValues.drivetrain,
    vehicleType: normalized?.detectedVehicleType ?? null,
  }).description : null;
  const previewFallbackFacts = [
    previewDescription,
    normalized?.visibleClues?.[0] ? `Visible clue: ${normalized.visibleClues[0]}` : null,
    normalized?.visibleClues?.[1] ? `Visible clue: ${normalized.visibleClues[1]}` : null,
  ]
    .filter((entry, index, list): entry is string => Boolean(entry) && list.indexOf(entry) === index)
    .slice(0, 3);
  const hasMeaningfulBasicInfo = displaySpecFacts.length > 0 || previewFallbackFacts.length > 0;
  const titleYearLabel = isCuratedSampleResult && bestMatch.year ? `${bestMatch.year}` : bestMatch.displayYearLabel ?? (bestMatch.year ? `${bestMatch.year}` : "Identified");
  const titleMake = safeString(bestMatch.make, "Vehicle");
  const titleModel = [bestMatch.model, bestMatch.displayTrimLabel ?? null].filter(Boolean).join(" ");
  const aiInsightBody = curatedSampleDetails?.insight ?? localFreeSpecSupplement?.insight ?? buildConciseInsight({
    vehicle: bestMatch,
    specs: resultSpecValues,
    detectedVehicleType: normalized?.detectedVehicleType ?? null,
    confidenceScore: displayConfidenceScore,
  });
  const previewFactLimit = isCuratedSampleResult ? 5 : includeReferenceSpecs ? 6 : 3;
  const secondaryDetailFacts = displaySpecFacts.length > 0
    ? removeFactsAlreadyShownInStats(displaySpecFacts, resultStats)
    : previewFallbackFacts;
  const previewSecondaryFacts = resultStats.length === 0
    ? removeDuplicateFacts(
        secondaryDetailFacts,
        [aiInsightBody],
      ).slice(0, previewFactLimit)
    : [];
  const previewSecondaryLabel = displaySpecFacts.length > 0 ? "Confirmed details" : "Quick overview";
  const showFreePreviewCard = previewSecondaryFacts.length > 0;
  const matchBadgeLabel = isSamplePreviewMode ? "100% match" : formatConfidence(displayConfidenceScore);
  const vehicleDetailsLabel = "View Vehicle Details";
  const premiumTeasersLocked = !isSamplePreviewMode && !hasFullAccess;
  const marketTitle = curatedSampleDetails?.marketTitle ?? "Market Value";
  const marketBody =
    curatedSampleDetails?.marketBody ??
    "See estimated value range, market demand trends, and pricing confidence from multiple data sources.";
  const listingsBody =
    curatedSampleDetails?.listingsBody ??
    "Browse nearby listings with verified pricing, mileage, and seller details from trusted marketplaces.";
  const vehicleMarketUnlockLabel = "Unlock Value & Listings";
  const marketUnlockLabel = vehicleMarketUnlockLabel;
  const listingsUnlockLabel = vehicleMarketUnlockLabel;
  const garageSaved = garageSaveState === "saved";
  const garageSaving = garageSaveState === "saving";
  const garageRemoving = garageSaveState === "removing";
  const garageBusy = garageSaving || garageRemoving;
  const saveGarageLabel = garageSaved ? "Saved to Garage" : garageRemoving ? "Removing from Garage" : garageSaving ? "Saving to Garage" : "Save to Garage";
  const handlePremiumTeaserAction = (intent: "value" | "listings") => {
    if (isSamplePreviewMode) {
      console.log("[scan-result] SAMPLE_PREVIEW_STATIC_TAPPED", {
        scanId: normalized?.id ?? null,
        providerCall: false,
      });
      return;
    }
    openVehicleDetail(bestMatch, intent === "value" ? "unlock-value-listings-from-market" : "unlock-value-listings-from-listings", {
      allowLockedApproximate: true,
      initialTab: intent === "value" ? "Value" : "For Sale",
      marketIntent: "bundle",
    });
  };
  const handleSaveToGarage = async () => {
    if (garageBusy) {
      return;
    }
    garageOperationVersionRef.current += 1;

    if (garageSaved) {
      if (!savedGarageItemId) {
        setGarageSaveState("idle");
        setGarageSaveError(null);
        return;
      }

      setGarageSaveState("removing");
      setGarageSaveError(null);
      try {
        await garageService.deleteItem(savedGarageItemId);
        setSavedGarageItemId(null);
        setGarageSaveState("idle");
        console.log("[scan-result] GARAGE_UNSAVE_LOCAL_SUCCESS", {
          scanId: normalized?.id ?? null,
          garageItemId: savedGarageItemId,
        });
      } catch (err) {
        console.log("[scan-result] GARAGE_UNSAVE_LOCAL_FAILED", err);
        setGarageSaveState("saved");
        setGarageSaveError("Could not remove from Garage. Try again.");
      }
      return;
    }

    const titleLabel = [titleYearLabel, titleMake, titleModel || null].filter(Boolean).join(" ");
    const imageUri = normalized?.imageUri ?? bestMatch.thumbnailUrl ?? "";
    const localReferenceValue = await resolveLocalGarageReferenceValue({
      vehicle: bestMatch,
      detectedVehicleType: normalized?.detectedVehicleType,
      displayedMsrp: resultSpecValues.msrp,
    });
    const estimateVehicleType =
      normalized?.detectedVehicleType === "motorcycle"
        ? "motorcycle"
        : normalized?.detectedVehicleType === "car"
          ? "car"
          : "";
    const vehicleRecord: VehicleRecord = {
      id: garageUnlockId,
      year: bestMatch.year ?? bestMatch.groundedExactYear ?? 0,
      make: titleMake,
      model: bestMatch.model || titleModel || "Vehicle",
      trim: bestMatch.displayTrimLabel ?? bestMatch.trim ?? "",
      bodyStyle: resultSpecValues.bodyStyle ?? "",
      vehicleType: normalized?.detectedVehicleType ?? undefined,
      heroImage: imageUri,
      overview: `${titleLabel || "Vehicle"} saved from your scan.`,
      specs: {
        engine: resultSpecValues.powertrain ?? "",
        horsepower: parseHorsepower(resultSpecValues.horsepower),
        torque: "",
        transmission: "",
        drivetrain: resultSpecValues.drivetrain ?? "",
        mpgOrRange: resultSpecValues.range ?? resultSpecValues.mpg ?? "",
        exteriorColors: [],
        msrp: localReferenceValue,
      },
      valuation: {
        status: "ready_to_load",
        tradeIn: "Unavailable",
        tradeInRange: "Unavailable",
        privateParty: "Unavailable",
        privatePartyRange: "Unavailable",
        dealerRetail: "Unavailable",
        dealerRetailRange: "Unavailable",
        low: null,
        high: null,
        median: null,
        confidenceLabel: "Live market value available on demand",
        sourceLabel: "Garage reference save",
        message: null,
        reason: null,
        listingCount: null,
        modelType: "modeled",
      },
      listings: [],
      isSampleVehicle: isSampleScan || undefined,
      source: isSampleScan ? "sample_vehicle" : undefined,
    };

    setGarageSaveState("saving");
    setGarageSaveError(null);
    try {
      const savedItem = await garageService.saveEstimate({
        unlockId: garageUnlockId,
        sourceType: bestMatch.source === "visual_override" || normalized?.source === "visual_override" ? "visual_override" : "estimate",
        imageUri,
        confidence: bestMatch.confidence ?? displayConfidenceScore,
        estimateMeta: {
          year: bestMatch.year ?? bestMatch.groundedExactYear ?? 0,
          make: titleMake,
          model: bestMatch.model || titleModel || "Vehicle",
          trim: bestMatch.displayTrimLabel ?? bestMatch.trim ?? "",
          vehicleType: estimateVehicleType,
          titleLabel,
          trustedCase: isHighConfidenceTrustedVisualOverride,
          resultSource: bestMatch.source ?? normalized?.source ?? "",
        },
        vehicle: vehicleRecord,
      });
      setSavedGarageItemId(savedItem.id);
      setGarageSaveState("saved");
      console.log("[scan-result] GARAGE_SAVE_LOCAL_SUCCESS", {
        scanId: normalized?.id ?? null,
        unlockId: garageUnlockId,
        garageItemId: savedItem.id,
      });
    } catch (err) {
      console.log("[scan-result] GARAGE_SAVE_LOCAL_FAILED", err);
      setGarageSaveState("idle");
      setGarageSaveError("Could not save to Garage. Try again.");
    }
  };
  const handleBackPress = () => {
    console.log("[tap] result-back-button", { fallbackHref: "/(tabs)/scan" });
    if (typeof router.canGoBack === "function" && router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/scan");
  };

  useEffect(() => {
    if (!normalized?.id || !garageUnlockId) {
      return;
    }
    let cancelled = false;
    const lookupVersion = garageOperationVersionRef.current;
    garageService.getLocalEstimateByUnlockId(garageUnlockId)
      .then((savedItem) => {
        if (cancelled || lookupVersion !== garageOperationVersionRef.current) {
          return;
        }
        if (savedItem) {
          setSavedGarageItemId(savedItem.id);
          setGarageSaveState((current) => (current === "saving" || current === "removing" ? current : "saved"));
          setGarageSaveError(null);
          return;
        }
        setGarageSaveState((current) => {
          if (current === "saving" || current === "saved" || current === "removing") {
            return current;
          }
          return "idle";
        });
      })
      .catch((err) => {
        console.log("[scan-result] GARAGE_SAVED_STATE_LOOKUP_FAILED", err);
      });
    return () => {
      cancelled = true;
    };
  }, [garageUnlockId, normalized?.id]);

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
      if (basicPreviewFacts.length > 0 || previewSecondaryFacts.length > 0) {
        console.log("[scan-result] FALLBACK_QUICK_FACTS_RENDERED", {
          scanId: normalized.id,
          facts: [...basicPreviewFacts, ...previewSecondaryFacts],
        });
      }
    }
  }, [basicPreviewFacts, displayConfidenceScore, isCatalogMatched, normalized, previewSecondaryFacts]);

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
    <SafeAreaView style={styles.resultSafeArea} edges={["top", "right", "bottom", "left"]}>
      <LinearGradient colors={["#040506", "#080708", "#030405"]} style={styles.resultScreen}>
        <ErrorBoundary fallbackTitle="Result unavailable" fallbackMessage="We hit a rendering issue. Please go back and try again.">
          <ScrollView
            style={styles.resultScroll}
            contentContainerStyle={[styles.resultScrollContent, { paddingBottom: Math.max(170, insets.bottom + 140) }]}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View style={[styles.resultContent, { opacity: screenOpacity, transform: [{ translateY: screenTranslate }] }]}>
              <View style={styles.heroImageWrap}>
                {normalized.imageUri ? (
                  <Image source={{ uri: normalized.imageUri }} style={styles.heroImage} resizeMode="cover" />
                ) : (
                  <View style={styles.heroImageFallback}>
                    <Ionicons name="car-sport-outline" size={64} color="rgba(233,184,120,0.56)" />
                  </View>
                )}
                <LinearGradient colors={["rgba(4,5,6,0.12)", "rgba(4,5,6,0.34)", "#040506"]} style={styles.heroImageOverlay} />
                <View style={styles.resultTopActions}>
                  <TouchableOpacity accessibilityRole="button" activeOpacity={0.84} onPress={handleBackPress} style={styles.roundActionButton}>
                    <Ionicons name="chevron-back" size={25} color={resultColors.text} />
                  </TouchableOpacity>
                </View>
              </View>

              <Animated.View style={[styles.vehicleSummaryShell, { opacity: bestMatchOpacity, transform: [{ scale: bestMatchScale }] }]}>
                <LinearGradient colors={["rgba(28,25,24,0.96)", "rgba(15,14,14,0.98)", "rgba(8,8,9,0.98)"]} style={styles.vehicleSummaryCard}>
                  <View style={styles.vehicleTitleRow}>
                    <View style={styles.vehicleTitleCopy}>
                      <Text style={styles.vehicleYear}>{titleYearLabel}</Text>
                      <Text style={styles.vehicleMake}>{titleMake}</Text>
                      <Text style={styles.vehicleModel}>{titleModel || bestMatchSubtitle}</Text>
                    </View>
                    <Animated.View style={[styles.matchPill, { opacity: confidenceOpacity }]}>
                      <Ionicons name="checkmark-circle-outline" size={15} color={resultColors.goldLight} />
                      <Text style={styles.matchPillText}>{matchBadgeLabel}</Text>
                    </Animated.View>
                  </View>
                  {resultStats.length > 0 ? (
                    <View style={styles.statsGrid}>
                      {resultStats.map((stat) => (
                        <View key={stat.label} style={styles.statCard}>
                          <View style={styles.statLabelRow}>
                            <Ionicons name={stat.icon} size={13} color="rgba(233,184,120,0.74)" />
                            <Text style={styles.statLabel}>{stat.label}</Text>
                          </View>
                          <Text style={styles.statValue} numberOfLines={2}>{stat.value}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </LinearGradient>
              </Animated.View>

              {feedbackMessage ? <Text style={styles.feedbackNotice}>{feedbackMessage}</Text> : null}
              {errorMessage ? <Text style={styles.errorNotice}>{errorMessage}</Text> : null}

              <View style={styles.saveGarageBlock}>
                <TouchableOpacity
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  accessibilityLabel={saveGarageLabel}
                  disabled={garageBusy}
                  onPress={() => {
                    void handleSaveToGarage();
                  }}
                >
                  <LinearGradient
                    colors={
                      garageSaved
                        ? ["rgba(32,216,120,0.18)", "rgba(12,18,14,0.96)"]
                        : ["rgba(214,158,93,0.20)", "rgba(12,12,13,0.98)"]
                    }
                    style={[styles.saveGarageAction, (garageBusy || garageSaved) && styles.saveGarageActionConfirmed]}
                  >
                    <View style={[styles.saveGarageIcon, garageSaved && styles.saveGarageIconSaved]}>
                      <Ionicons
                        name={garageSaved ? "checkmark" : garageBusy ? "time-outline" : "add"}
                        size={18}
                        color={garageSaved ? "#78F2B1" : resultColors.goldLight}
                      />
                    </View>
                    <Text style={[styles.saveGarageText, garageSaved && styles.saveGarageTextSaved]}>{saveGarageLabel}</Text>
                  </LinearGradient>
                </TouchableOpacity>
                {garageSaveError ? <Text style={styles.saveGarageError}>{garageSaveError}</Text> : null}
              </View>

              <View style={styles.insightsCard}>
                <View style={styles.cardTitleRow}>
                  <Ionicons name="analytics-outline" size={17} color={resultColors.goldLight} />
                  <Text style={styles.premiumCardTitle}>AI Insights</Text>
                </View>
                <Text style={styles.insightBody}>{aiInsightBody}</Text>
                {showFreePreviewCard ? (
                  <View style={styles.previewFactsWrap}>
                    <Text style={styles.previewFactsLabel}>{previewSecondaryLabel}</Text>
                    {previewSecondaryFacts.map((fact) => (
                      <Text key={fact} style={styles.previewFactText}>{fact}</Text>
                    ))}
                  </View>
                ) : null}
              </View>

              <LinearGradient colors={["rgba(37,26,17,0.78)", "rgba(19,15,13,0.94)", "rgba(10,10,10,0.98)"]} style={styles.lockedValueCard}>
                <View style={styles.lockedCardHeader}>
                  <View style={styles.cardTitleRow}>
                    <Ionicons name="cash-outline" size={18} color={resultColors.goldLight} />
                    <Text style={styles.premiumCardTitle}>{marketTitle}</Text>
                  </View>
                  {isSamplePreviewMode ? (
                    <View style={styles.samplePreviewPill}>
                      <Ionicons name="pricetag-outline" size={13} color={resultColors.goldLight} />
                      <Text style={styles.samplePreviewPillText}>Sample</Text>
                    </View>
                  ) : premiumTeasersLocked ? (
                    <View style={styles.lockedPill}>
                      <Ionicons name="lock-closed-outline" size={13} color={resultColors.goldLight} />
                      <Text style={styles.lockedPillText}>LOCKED</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.lockedBody}>{marketBody}</Text>
                {isSamplePreviewMode ? (
                  <View style={styles.sampleMarketGrid}>
                    {sampleMarketPreview.map((metric) => (
                      <View key={metric.label} style={styles.sampleMarketMetric}>
                        <Text style={styles.sampleMetricLabel}>{metric.label}</Text>
                        <Text style={styles.sampleMetricValue}>{metric.value}</Text>
                        <Text style={styles.sampleMetricDetail}>{metric.detail}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.86}
                    accessibilityRole="button"
                    disabled={isUnlocking}
                    onPress={() => handlePremiumTeaserAction("value")}
                  >
                    <LinearGradient colors={["rgba(214,158,93,0.25)", "rgba(214,158,93,0.12)"]} style={[styles.lockedCta, isUnlocking && styles.disabledAction]}>
                      <Text style={styles.lockedCtaText}>{marketUnlockLabel}</Text>
                      <Ionicons name="chevron-forward" size={17} color={resultColors.goldLight} />
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </LinearGradient>

              <View style={styles.lockedListingsCard}>
                <View style={styles.lockedCardHeader}>
                  <View style={styles.cardTitleRow}>
                    <Ionicons name="location-outline" size={18} color={resultColors.goldLight} />
                    <Text style={styles.premiumCardTitle}>Available Listings</Text>
                  </View>
                  {isSamplePreviewMode ? (
                    <View style={styles.samplePreviewPill}>
                      <Ionicons name="map-outline" size={13} color={resultColors.goldLight} />
                      <Text style={styles.samplePreviewPillText}>Demo</Text>
                    </View>
                  ) : premiumTeasersLocked ? (
                    <View style={styles.lockIconCircle}>
                      <Ionicons name="lock-closed-outline" size={15} color={resultColors.goldLight} />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.lockedBody}>{listingsBody}</Text>
                {isSamplePreviewMode ? (
                  <View style={styles.sampleListingStack}>
                    {sampleListingPreview.map((listing) => (
                      <View key={listing.id} style={styles.sampleListingRow}>
                        <View style={styles.sampleListingThumbnailWrap}>
                          <Image source={listing.thumbnailSource} style={styles.sampleListingThumbnail} resizeMode="contain" />
                        </View>
                        <View style={styles.sampleListingCopy}>
                          <Text style={styles.sampleListingTitle} numberOfLines={2}>{listing.title}</Text>
                          <Text style={styles.sampleListingPrice}>{listing.price}</Text>
                          <Text style={styles.sampleListingSeller} numberOfLines={1}>{listing.seller}</Text>
                          <Text style={styles.sampleListingMeta} numberOfLines={1}>{listing.marketMeta}</Text>
                          {listing.location ? <Text style={styles.sampleListingLocation} numberOfLines={1}>{listing.location}</Text> : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <>
                    <View style={styles.listingSkeletonStack} pointerEvents="none">
                      {[0, 1].map((item) => (
                        <View key={item} style={styles.listingSkeletonRow}>
                          <View style={styles.skeletonLineShort} />
                          <View style={styles.skeletonLineLong} />
                          <Ionicons name="lock-closed-outline" size={14} color="rgba(172,178,190,0.68)" style={styles.skeletonLock} />
                        </View>
                      ))}
                    </View>
                    <TouchableOpacity
                      activeOpacity={0.86}
                      accessibilityRole="button"
                      disabled={isUnlocking}
                      onPress={() => handlePremiumTeaserAction("listings")}
                    >
                      <LinearGradient colors={["rgba(214,158,93,0.25)", "rgba(214,158,93,0.12)"]} style={[styles.lockedCta, isUnlocking && styles.disabledAction]}>
                        <Text style={styles.lockedCtaText}>{listingsUnlockLabel}</Text>
                        <Ionicons name="chevron-forward" size={17} color={resultColors.goldLight} />
                      </LinearGradient>
                    </TouchableOpacity>
                  </>
                )}
              </View>

            </Animated.View>
          </ScrollView>
          <LinearGradient
            colors={["rgba(3,4,5,0)", "rgba(3,4,5,0.96)", "#030405"]}
            style={styles.resultFooter}
          >
            <TouchableOpacity
              activeOpacity={0.86}
              accessibilityRole="button"
              disabled={false}
              onPress={() => {
                openVehicleDetail(bestMatch, "view-vehicle-details", { allowLockedApproximate: true });
              }}
              style={styles.primaryBottomAction}
            >
              <Text style={styles.primaryBottomActionText}>{vehicleDetailsLabel}</Text>
            </TouchableOpacity>
          </LinearGradient>
        </ErrorBoundary>
      </LinearGradient>
    </SafeAreaView>
  );
}

const resultColors = {
  background: "#030405",
  card: "#0A0B0D",
  cardWarm: "#17120F",
  text: "#F6F3EE",
  textSoft: "#B9BBC4",
  textMuted: "#858A98",
  line: "rgba(255,255,255,0.09)",
  lineWarm: "rgba(214,158,93,0.24)",
  gold: "#D69E5D",
  goldLight: "#E9B878",
};

const styles = StyleSheet.create({
  resultSafeArea: {
    flex: 1,
    backgroundColor: resultColors.background,
  },
  resultScreen: {
    flex: 1,
  },
  resultScroll: {
    flex: 1,
  },
  resultScrollContent: {
    paddingBottom: 34,
  },
  resultContent: {
    gap: 18,
  },
  heroImageWrap: {
    height: 356,
    marginHorizontal: -1,
    backgroundColor: "#050506",
    overflow: "hidden",
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroImageFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#070707",
  },
  heroImageOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  resultTopActions: {
    position: "absolute",
    top: 18,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roundActionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(21,22,24,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  vehicleSummaryShell: {
    marginTop: -74,
    paddingHorizontal: 18,
  },
  vehicleSummaryCard: {
    borderRadius: 24,
    paddingHorizontal: 25,
    paddingTop: 25,
    paddingBottom: 23,
    gap: 22,
    borderWidth: 1,
    borderColor: resultColors.lineWarm,
    shadowColor: "#000000",
    shadowOpacity: 0.38,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 18 },
    elevation: 7,
  },
  vehicleTitleRow: {
    flexDirection: "row",
    gap: 16,
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  vehicleTitleCopy: {
    flex: 1,
    minWidth: 0,
  },
  vehicleYear: {
    ...Typography.caption,
    color: resultColors.textSoft,
    fontWeight: "700",
    marginBottom: 6,
  },
  vehicleMake: {
    fontFamily: Typography.title.fontFamily,
    fontSize: 29,
    lineHeight: 33,
    fontWeight: "900",
    letterSpacing: 0,
    color: resultColors.text,
  },
  vehicleModel: {
    fontFamily: Typography.title.fontFamily,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: "700",
    letterSpacing: 0,
    color: resultColors.text,
  },
  matchPill: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    borderRadius: 18,
    backgroundColor: "rgba(214,158,93,0.15)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.34)",
  },
  matchPillText: {
    ...Typography.caption,
    color: resultColors.goldLight,
    fontWeight: "900",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    width: "48.4%",
    minHeight: 70,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  statLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statLabel: {
    ...Typography.caption,
    color: resultColors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  statValue: {
    ...Typography.bodyStrong,
    color: resultColors.text,
    fontWeight: "900",
    lineHeight: 20,
  },
  insightsCard: {
    marginHorizontal: 18,
    borderRadius: 19,
    padding: 22,
    gap: 14,
    backgroundColor: "rgba(8,10,14,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flex: 1,
    minWidth: 0,
  },
  premiumCardTitle: {
    ...Typography.bodyStrong,
    color: resultColors.text,
    fontWeight: "900",
    flexShrink: 1,
  },
  insightBody: {
    ...Typography.body,
    color: resultColors.textSoft,
    lineHeight: 24,
  },
  previewFactsWrap: {
    gap: 7,
    paddingTop: 2,
  },
  previewFactsLabel: {
    ...Typography.caption,
    color: resultColors.goldLight,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  previewFactText: {
    ...Typography.caption,
    color: resultColors.textSoft,
    lineHeight: 18,
  },
  saveGarageBlock: {
    marginHorizontal: 18,
    gap: 8,
  },
  saveGarageAction: {
    minHeight: 56,
    borderRadius: 15,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.28)",
    shadowColor: resultColors.gold,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  saveGarageActionConfirmed: {
    opacity: 0.98,
  },
  saveGarageIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,158,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.28)",
  },
  saveGarageIconSaved: {
    backgroundColor: "rgba(32,216,120,0.10)",
    borderColor: "rgba(120,242,177,0.26)",
  },
  saveGarageText: {
    ...Typography.bodyStrong,
    color: resultColors.text,
    fontWeight: "900",
  },
  saveGarageTextSaved: {
    color: "#D7FFE7",
  },
  saveGarageError: {
    ...Typography.caption,
    color: Colors.danger,
    textAlign: "center",
  },
  lockedValueCard: {
    marginHorizontal: 18,
    borderRadius: 20,
    padding: 21,
    gap: 18,
    borderWidth: 1,
    borderColor: resultColors.lineWarm,
    shadowColor: resultColors.gold,
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  lockedListingsCard: {
    marginHorizontal: 18,
    borderRadius: 20,
    padding: 21,
    gap: 18,
    backgroundColor: "rgba(8,10,14,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  lockedCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
  },
  lockedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(214,158,93,0.14)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.32)",
  },
  lockedPillText: {
    ...Typography.caption,
    color: resultColors.goldLight,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  samplePreviewPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignSelf: "flex-start",
    maxWidth: "100%",
    backgroundColor: "rgba(214,158,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.28)",
  },
  samplePreviewPillText: {
    ...Typography.caption,
    color: resultColors.goldLight,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
  },
  lockedBody: {
    ...Typography.body,
    color: resultColors.textSoft,
    lineHeight: 23,
  },
  lockedCta: {
    minHeight: 50,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.34)",
  },
  lockedCtaText: {
    ...Typography.bodyStrong,
    color: resultColors.goldLight,
    fontWeight: "900",
  },
  lockIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,158,93,0.10)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.24)",
  },
  sampleMarketGrid: {
    gap: 10,
  },
  sampleMarketMetric: {
    borderRadius: 13,
    paddingHorizontal: 15,
    paddingVertical: 13,
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.075)",
  },
  sampleMetricLabel: {
    ...Typography.caption,
    color: resultColors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  sampleMetricValue: {
    ...Typography.bodyStrong,
    color: resultColors.text,
    fontWeight: "900",
  },
  sampleMetricDetail: {
    ...Typography.caption,
    color: resultColors.textSoft,
  },
  sampleListingStack: {
    gap: 12,
  },
  sampleListingRow: {
    borderRadius: 13,
    padding: 14,
    gap: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.075)",
  },
  sampleListingThumbnailWrap: {
    width: 70,
    height: 58,
    borderRadius: 11,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(214,158,93,0.10)",
    borderWidth: 1,
    borderColor: "rgba(214,158,93,0.18)",
  },
  sampleListingThumbnail: {
    width: "88%",
    height: "88%",
    opacity: 0.9,
  },
  sampleListingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  sampleListingTitle: {
    ...Typography.bodyStrong,
    color: resultColors.text,
    fontWeight: "900",
    lineHeight: 20,
  },
  sampleListingPrice: {
    ...Typography.bodyStrong,
    color: resultColors.goldLight,
    fontWeight: "900",
    lineHeight: 19,
  },
  sampleListingSeller: {
    ...Typography.caption,
    color: resultColors.textSoft,
    fontWeight: "800",
    marginTop: 1,
  },
  sampleListingMeta: {
    ...Typography.caption,
    color: resultColors.textMuted,
    lineHeight: 17,
  },
  sampleListingLocation: {
    ...Typography.caption,
    color: resultColors.textMuted,
    lineHeight: 17,
  },
  listingSkeletonStack: {
    gap: 12,
  },
  listingSkeletonRow: {
    minHeight: 62,
    borderRadius: 13,
    paddingHorizontal: 15,
    justifyContent: "center",
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.025)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.045)",
  },
  skeletonLineShort: {
    width: 88,
    height: 11,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  skeletonLineLong: {
    width: 126,
    height: 13,
    borderRadius: 7,
    backgroundColor: "rgba(214,158,93,0.18)",
  },
  skeletonLock: {
    position: "absolute",
    right: 16,
    top: 24,
  },
  resultFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 18,
    paddingBottom: 12,
  },
  primaryBottomAction: {
    minHeight: 56,
    marginHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  primaryBottomActionText: {
    ...Typography.bodyStrong,
    color: resultColors.text,
    fontWeight: "900",
  },
  disabledAction: {
    opacity: 0.58,
  },
  feedbackNotice: {
    ...Typography.caption,
    color: resultColors.textMuted,
    marginHorizontal: 18,
  },
  errorNotice: {
    ...Typography.caption,
    color: Colors.danger,
    marginHorizontal: 18,
  },
  loadingScreen: { flex: 1, gap: 18, justifyContent: "center" },
  loadingHeroCard: { ...cardStyles.primaryTint, gap: 16, padding: 18 },
  loadingHeroCopy: { gap: 8 },
  loadingEyebrow: { ...Typography.caption, color: Colors.premium, textTransform: "uppercase", letterSpacing: 1.2 },
  loadingText: { ...Typography.title, color: Colors.textStrong },
  loadingBody: { ...Typography.body, color: Colors.textSoft },
  loadingStack: { gap: 14 },
});
