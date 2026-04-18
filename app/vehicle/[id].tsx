import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
import { offlineCanonicalService } from "@/services/offlineCanonicalService";
import { scanService } from "@/services/scanService";
import { vehicleService } from "@/services/vehicleService";
import { ValuationResult, VehicleRecord } from "@/types";
import { formatCurrency } from "@/lib/utils";

const tabs = ["Overview", "Specs", "Value", "For Sale", "Photos"];
const defaultZip = "60610";
const defaultMileage = "18400";
const defaultCondition = "Excellent";
const conditionOptions = ["Poor", "Fair", "Good", "Very Good", "Excellent"];

type EstimateSupport = {
  groundedVehicleId: string | null;
  familyLabel: string | null;
  yearRangeLabel: string | null;
  specsSourceLabel: string | null;
  marketSourceLabel: string | null;
  groundedMatchType: string | null;
  candidateCount: number | null;
  showApproximateSpecs: boolean;
  showApproximateMarket: boolean;
  showApproximateListings: boolean;
};

type HorsepowerSupport = {
  label: string;
  value: string;
  numericValue: number | null;
  exact: boolean;
};

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

function buildApproximateValuation(base: ValuationResult, familyLabel: string, yearRangeLabel?: string | null): ValuationResult {
  const familyContext = yearRangeLabel ? `${yearRangeLabel} ${familyLabel}` : familyLabel;
  return {
    ...base,
    sourceLabel: `Approximate market range from similar ${familyContext}`.trim(),
    confidenceLabel: `Similar-market estimate based on a nearby ${familyContext}`.trim(),
  };
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
  const isTruck =
    /(f150|f250|f350|silverado|sierra|ram|tacoma|tundra|colorado|canyon|ranger)/.test(combined);
  const isMuscle = /(mustang|camaro|challenger|charger|corvette)/.test(combined);
  const isWrangler = make === "jeep" && model.includes("wrangler");
  const isClassic = typeof input.year === "number" && input.year > 0 && input.year < 1996;
  const isMotorcycle = (input.vehicleType ?? "").toLowerCase() === "motorcycle";
  return isTruck || isMuscle || isWrangler || isClassic || isMotorcycle;
}

function isStrongFamilyFallback(input: {
  matchType?: string | null;
  candidateCount?: number | null;
  requestedYear?: number | null;
  matchedYear?: number | null;
  riskyFamily?: boolean;
}) {
  if (input.matchType === "id" || input.matchType === "exact") {
    return true;
  }
  if (input.matchType !== "model-family-range") {
    return false;
  }
  const candidateCount = input.candidateCount ?? Number.POSITIVE_INFINITY;
  const maxCandidates = input.riskyFamily ? 1 : 2;
  if (candidateCount < 1 || candidateCount > maxCandidates) {
    return false;
  }
  if (typeof input.requestedYear === "number" && typeof input.matchedYear === "number") {
    const maxYearDelta = input.riskyFamily ? 1 : 2;
    return Math.abs(input.requestedYear - input.matchedYear) <= maxYearDelta;
  }
  return !input.riskyFamily && candidateCount === 1;
}

function isStrongMarketFallback(input: {
  matchType?: string | null;
  candidateCount?: number | null;
  requestedYear?: number | null;
  matchedYear?: number | null;
  riskyFamily?: boolean;
}) {
  if (input.matchType === "id" || input.matchType === "exact") {
    return true;
  }
  if (input.matchType !== "model-family-range") {
    return false;
  }
  const candidateCount = input.candidateCount ?? Number.POSITIVE_INFINITY;
  if (candidateCount !== 1) {
    return false;
  }
  if (typeof input.requestedYear === "number" && typeof input.matchedYear === "number") {
    const maxYearDelta = input.riskyFamily ? 0 : 1;
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
}) {
  if (input.matchType === "id" || input.matchType === "exact") {
    return true;
  }
  if (input.matchType !== "model-family-range") {
    return false;
  }
  const candidateCount = input.candidateCount ?? Number.POSITIVE_INFINITY;
  if (candidateCount !== 1) {
    return false;
  }
  if (typeof input.requestedYear !== "number" || typeof input.matchedYear !== "number") {
    return false;
  }
  const maxYearDelta = input.riskyFamily ? 0 : 1;
  return Math.abs(input.requestedYear - input.matchedYear) <= maxYearDelta;
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
}) {
  if (!input.trim.trim()) {
    return false;
  }
  const riskyFamily = isRiskSensitiveFamily(input);
  if (riskyFamily) {
    return input.confidence >= 0.98 && (input.matchType === "id" || input.matchType === "exact");
  }
  return input.confidence >= 0.93 && input.strongFamilyFallback && (input.matchType === "id" || input.matchType === "exact");
}

export default function VehicleDetailScreen() {
  const { id, imageUri, scanId, estimate, titleLabel, yearLabel, make, model, trimLabel, vehicleType, confidence } = useLocalSearchParams<{
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
  }>();
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
  const [estimateSupport, setEstimateSupport] = useState<EstimateSupport | null>(null);
  const [horsepowerSupport, setHorsepowerSupport] = useState<HorsepowerSupport | null>(null);
  const [heroPreviewOpen, setHeroPreviewOpen] = useState(false);
  const previousConditionRef = useRef<string | null>(null);
  const previousValueRef = useRef<string | null>(null);
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
  } = useSubscription();
  const isEstimateMode = estimate === "1" || id.startsWith("estimate:");
  const isPro = usage?.plan === "pro";
  const unlockedForVehicle = vehicle?.id ? isVehicleUnlocked(vehicle.id) : false;
  const hasFullAccess = isEstimateMode ? true : isPro || unlockedForVehicle;
  const isLocked = !hasFullAccess;
  const estimateSubtitle = isEstimateMode
    ? [vehicle?.trim ? `Possible ${vehicle.trim}` : "Estimated identification", vehicle?.bodyStyle || null]
        .filter((entry): entry is string => Boolean(entry))
        .join(" • ")
    : null;

  const estimateHeaderTitle =
    typeof titleLabel === "string" && titleLabel.trim().length > 0
      ? titleLabel
      : [typeof yearLabel === "string" && yearLabel.trim().length > 0 ? yearLabel : null, make, model]
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .join(" ");

  const summaryChips = useMemo(() => {
    const chips = [
      isEstimateMode
        ? estimateSupport?.yearRangeLabel || (typeof yearLabel === "string" && yearLabel.trim().length > 0 ? yearLabel : null)
        : vehicle ? `${vehicle.year}` : null,
      vehicle?.bodyStyle || null,
      horsepowerSupport?.value || (vehicle?.specs.horsepower ? formatHorsepowerLabel(vehicle.specs.horsepower) : null),
      vehicle?.specs.drivetrain && vehicle.specs.drivetrain !== "Unavailable" ? vehicle.specs.drivetrain : null,
      vehicle?.specs.msrp && vehicle.specs.msrp > 0 ? formatCurrency(vehicle.specs.msrp) : null,
    ].filter((entry): entry is string => Boolean(entry));
    return chips.slice(0, 4);
  }, [estimateSupport?.yearRangeLabel, horsepowerSupport?.value, isEstimateMode, vehicle, yearLabel]);

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
        const groundedPresentation = await offlineCanonicalService.resolveVehiclePresentation({
          year: Number.isFinite(parsedYear) ? parsedYear : null,
          make: resolvedMake,
          model: resolvedModel,
          trim: resolvedTrimLabel || null,
          vehicleType: resolvedVehicleType || null,
        });

        const strongFamilyFallback = isStrongFamilyFallback({
          matchType: groundedPresentation?.matchType,
          candidateCount: groundedPresentation?.candidateCount,
          requestedYear: Number.isFinite(parsedYear) ? parsedYear : null,
          matchedYear: groundedPresentation?.vehicle?.year ?? null,
          riskyFamily,
        });
        const strongMarketFallback = isStrongMarketFallback({
          matchType: groundedPresentation?.matchType,
          candidateCount: groundedPresentation?.candidateCount,
          requestedYear: Number.isFinite(parsedYear) ? parsedYear : null,
          matchedYear: groundedPresentation?.vehicle?.year ?? null,
          riskyFamily,
        });
        const strongListingsFallback = isStrongListingsFallback({
          matchType: groundedPresentation?.matchType,
          candidateCount: groundedPresentation?.candidateCount,
          requestedYear: Number.isFinite(parsedYear) ? parsedYear : null,
          matchedYear: groundedPresentation?.vehicle?.year ?? null,
          riskyFamily,
        });
        const groundedRecord = groundedPresentation?.vehicle
          && strongFamilyFallback
          ? offlineCanonicalService.mapToVehicleRecord(groundedPresentation.vehicle)
          : null;
        const resolvedHorsepowerSupport =
          await offlineCanonicalService.resolveHorsepowerSupport({
            year: Number.isFinite(parsedYear) ? parsedYear : null,
            make: resolvedMake,
            model: resolvedModel,
            trim: resolvedTrimLabel || null,
            vehicleType: resolvedVehicleType || null,
          });
        const groundedFamilyLabel = groundedPresentation?.vehicle
          && strongFamilyFallback
          ? `${groundedPresentation.vehicle.make} ${groundedPresentation.vehicle.model}`.trim()
          : null;
        const groundedYearRangeLabel =
          strongFamilyFallback
            ? formatYearRangeLabel(
                groundedPresentation?.yearRange?.start,
                groundedPresentation?.yearRange?.end,
              )
            : null;
        const resolvedBodyStyle =
          groundedRecord?.bodyStyle ||
          (resolvedVehicleType && resolvedVehicleType.trim().length > 0 ? resolvedVehicleType : "Estimated vehicle");
        const specsSourceLabel = groundedFamilyLabel
          ? `Approximate specs below are based on a nearby ${groundedYearRangeLabel ? `${groundedYearRangeLabel} ` : ""}${groundedFamilyLabel}.`
          : null;
        const marketSourceLabel = groundedFamilyLabel && strongMarketFallback
          ? `Similar market context below reflects nearby ${groundedYearRangeLabel ? `${groundedYearRangeLabel} ` : ""}${groundedFamilyLabel} vehicles.`
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
            "Estimated identification from photo analysis.",
            resolvedConfidence ? `Confidence: ${Math.round(Number(resolvedConfidence) * 100)}%.` : null,
            groundedYearRangeLabel ? `Likely production range: ${groundedYearRangeLabel}.` : null,
            specsSourceLabel ?? "Some deeper vehicle data may not be available for this estimate yet.",
          ]
            .filter(Boolean)
            .join(" "),
          specs: {
            engine: groundedRecord?.specs.engine ?? "Unavailable",
            horsepower: groundedRecord?.specs.horsepower ?? null,
            torque: groundedRecord?.specs.torque ?? "Unavailable",
            transmission: groundedRecord?.specs.transmission ?? "Unavailable",
            drivetrain: groundedRecord?.specs.drivetrain ?? "Unavailable",
            mpgOrRange: groundedRecord?.specs.mpgOrRange ?? "Unavailable",
            exteriorColors: groundedRecord?.specs.exteriorColors ?? [],
            msrp: groundedRecord?.specs.msrp ?? 0,
          },
          valuation:
            groundedRecord && groundedFamilyLabel && strongMarketFallback
              ? buildApproximateValuation(groundedRecord.valuation, groundedFamilyLabel, groundedYearRangeLabel)
              : createEmptyValuation(),
          listings: [],
        };
        if (!active) {
          return;
        }
        setVehicle(estimatedVehicle);
        setValuation(estimatedVehicle.valuation);
        setZipCode(defaultZip);
        setMileage(defaultMileage);
        setCondition(defaultCondition);
        setEstimateSupport({
          groundedVehicleId: groundedPresentation?.vehicle?.id ?? null,
          familyLabel: groundedFamilyLabel,
          yearRangeLabel: groundedYearRangeLabel,
          specsSourceLabel,
          marketSourceLabel,
          groundedMatchType: groundedPresentation?.matchType ?? null,
          candidateCount: groundedPresentation?.candidateCount ?? null,
          showApproximateSpecs: strongFamilyFallback,
          showApproximateMarket: strongMarketFallback,
          showApproximateListings: strongListingsFallback,
        });
        setHorsepowerSupport(
          groundedRecord?.specs.horsepower
            ? null
            : resolvedHorsepowerSupport,
        );
        setError(null);
        setLoading(false);

        if (!groundedPresentation?.vehicle?.id || !groundedFamilyLabel || (!strongMarketFallback && !strongListingsFallback)) {
          return;
        }

        const [valueResult, listingsResult] = await Promise.allSettled([
          strongMarketFallback
            ? vehicleService.getValue(
                groundedPresentation.vehicle.id,
                defaultZip,
                defaultMileage,
                normalizeCondition(defaultCondition),
              )
            : Promise.resolve(null),
          strongListingsFallback
            ? vehicleService.getListings(groundedPresentation.vehicle.id, defaultZip)
            : Promise.resolve([]),
        ]);

        if (!active) {
          return;
        }

        if (strongMarketFallback && valueResult.status === "fulfilled" && valueResult.value) {
          const nextValuation = buildApproximateValuation(
            valueResult.value,
            groundedFamilyLabel,
            groundedYearRangeLabel,
          );
          setValuation(nextValuation);
          setVehicle((current) => (current ? { ...current, valuation: nextValuation } : current));
        }

        if (strongListingsFallback && listingsResult.status === "fulfilled") {
          setVehicle((current) =>
            current
              ? {
                  ...current,
                  listings: listingsResult.value.slice(0, 2),
                }
              : current,
          );
        }
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
        setValuation(offlineResult.valuation ?? createEmptyValuation());
        setZipCode(defaultZip);
        setMileage(getInitialMileage(offlineResult));
        setCondition(getInitialCondition(offlineResult));
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
        setValuation(result?.valuation ?? createEmptyValuation());
        if (result) {
          setZipCode(defaultZip);
          setMileage(getInitialMileage(result));
          setCondition(getInitialCondition(result));
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
        setValuation((current) => current ?? createEmptyValuation());
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
  }, [confidence, id, isEstimateMode, make, model, scanId, titleLabel, trimLabel, vehicleType, yearLabel]);

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

    if (isEstimateMode && !estimateSupport?.showApproximateMarket) {
      return;
    }

    const valueVehicleId = isEstimateMode ? estimateSupport?.groundedVehicleId : vehicle.id;
    if (!valueVehicleId) {
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
        vehicleId: valueVehicleId,
        previousCondition: previousConditionRef.current,
        newCondition: normalizedCondition,
        estimateMode: isEstimateMode,
      });
      setValuationLoading(true);
      vehicleService
        .getValue(valueVehicleId, normalizedZip, normalizedMileage, normalizedCondition)
        .then((result) => {
          const nextResult =
            isEstimateMode && estimateSupport?.familyLabel
              ? buildApproximateValuation(result, estimateSupport.familyLabel, estimateSupport.yearRangeLabel)
              : result;
          const nextValue = JSON.stringify(result);
          console.log("[vehicle-detail] VALUE_CONDITION_COMPARISON", {
            vehicleId: valueVehicleId,
            previousCondition: previousConditionRef.current,
            newCondition: normalizedCondition,
            previousValue: previousValueRef.current,
            newValue: nextValue,
            changed: previousValueRef.current !== nextValue,
          });
          setValuation(nextResult);
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
  }, [condition, estimateSupport, isEstimateMode, mileage, tab, vehicle, zipCode]);

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

  const heroImageUri = resolvedImageUri ?? vehicle?.heroImage ?? "";
  const selectedImageSourceLabel = resolvedImageUri ? imageSourceLabel : isEstimateMode ? "estimated result" : "provider/generic fallback";
  const scannedImageSelected = selectedImageSourceLabel !== "provider/generic fallback";
  const heroImageFitMode = scannedImageSelected ? "contain" : "cover";

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
        <Pressable
          onPress={() => setHeroPreviewOpen(true)}
          style={styles.heroPressable}
          accessibilityRole="button"
          accessibilityHint="Opens a larger quick-view card for this vehicle"
        >
          <View style={styles.heroFrame}>
            <Image source={{ uri: heroImageUri }} style={styles.hero} resizeMode={heroImageFitMode} />
            <LinearGradient colors={["rgba(4,8,18,0.04)", "rgba(4,8,18,0.18)", "rgba(4,8,18,0.9)"]} style={styles.heroGradient} />
            <View style={styles.heroTopRow}>
              <View style={styles.heroBadge}>
                <Text style={styles.heroBadgeLabel}>{isEstimateMode ? "Estimated dossier" : "Vehicle dossier"}</Text>
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
            <View style={styles.heroIdentity}>
              <Text style={styles.heroTitle}>{isEstimateMode ? estimateHeaderTitle || `${vehicle.make} ${vehicle.model}` : `${vehicle.year} ${vehicle.make} ${vehicle.model}`}</Text>
              <Text style={styles.heroSubtitle}>
                {isEstimateMode
                  ? estimateSubtitle || "Estimated identification"
                  : `${vehicle.trim} • ${vehicle.bodyStyle}`}
              </Text>
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
        </Pressable>
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
        {isEstimateMode ? <Text style={styles.estimateEyebrow}>Estimated vehicle detail</Text> : null}
        {feedbackMessage ? <Text style={styles.feedbackNotice}>{feedbackMessage}</Text> : null}
        {errorMessage ? <Text style={styles.errorNotice}>{errorMessage}</Text> : null}
        <Text style={styles.headerKicker}>{isEstimateMode ? "Photo-based confidence layer" : "Performance intelligence summary"}</Text>
        <Text style={styles.subtitle}>{isEstimateMode ? estimateSubtitle || "Estimated identification" : `${vehicle.trim} • ${vehicle.bodyStyle}`}</Text>
        {isEstimateMode ? (
          <>
            <View style={styles.estimateBadge}>
              <Text style={styles.estimateBadgeLabel}>Photo-based estimate</Text>
            </View>
            <View style={styles.estimateNotice}>
              <Text style={styles.estimateNoticeTitle}>Approximate detail, not a verified catalog record</Text>
              <Text style={styles.estimateNoticeBody}>
                This page shows the most likely identification from the scan photo. Any family-based specs, market ranges, or listings below stay labeled as approximate or similar so they are not mistaken for an exact verified match.
              </Text>
            </View>
          </>
        ) : null}
      </View>
      <SegmentedTabBar tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === "Overview" ? (
        <View style={styles.sectionCard}>
          {isEstimateMode ? <SectionHeader title="Estimated Identification" subtitle="Photo-based result with conservative grounding when available." /> : null}
          <Text style={styles.body}>{vehicle.overview}</Text>
          <DetailRow
            label="Year"
            value={
              isEstimateMode
                ? estimateSupport?.yearRangeLabel || (typeof yearLabel === "string" && yearLabel.trim().length > 0 ? yearLabel : "Estimated")
                : `${vehicle.year}`
            }
          />
          <DetailRow label="Make" value={vehicle.make} />
          <DetailRow label="Model" value={vehicle.model} />
          <DetailRow label={isEstimateMode ? "Possible trim" : "Trim"} value={vehicle.trim || "Not confidently supported"} />
          <DetailRow label="Body style" value={vehicle.bodyStyle || "Estimated vehicle"} />
          {isEstimateMode && estimateSupport?.familyLabel ? (
            <DetailRow label="Nearest grounded family" value={`Similar ${estimateSupport.familyLabel}`} />
          ) : null}
        </View>
      ) : null}

      {tab === "Specs" ? (
        isEstimateMode ? (
          <View style={styles.sectionCard}>
            <SectionHeader title="Approximate Specs" subtitle="Only shown when a nearby grounded family match is strong enough to help." />
            <Text style={styles.body}>
              {estimateSupport?.specsSourceLabel ?? "This result is estimated from the scan photo. Full catalog specs are not linked for this vehicle yet."}
            </Text>
            {estimateSupport?.showApproximateSpecs ? (
              <>
                <DetailRow label="Likely engine" value={vehicle.specs.engine} />
                <DetailRow label={horsepowerSupport?.label ?? "Approx. horsepower"} value={horsepowerSupport?.value ?? formatHorsepowerLabel(vehicle.specs.horsepower)} />
                {horsepowerSupport && !horsepowerSupport.exact ? (
                  <Text style={styles.specSupportNote}>Shown from a strong family match because exact trim horsepower is not fully grounded here.</Text>
                ) : null}
                <DetailRow label="Likely transmission" value={vehicle.specs.transmission} />
                <DetailRow label="Likely drivetrain" value={vehicle.specs.drivetrain} />
                <DetailRow label="Approx. MPG / Range" value={vehicle.specs.mpgOrRange} />
                <DetailRow label="Approx. MSRP" value={vehicle.specs.msrp > 0 ? formatCurrency(vehicle.specs.msrp) : "Unavailable"} />
              </>
            ) : (
              <Text style={styles.body}>We’re keeping specs hidden here because the closest family match is too broad to support a trustworthy approximation.</Text>
            )}
          </View>
        ) : (
        <>
          <LockedContentPreview
            locked={isLocked}
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
          {isLocked ? (
            <UnlockAccessCard
              remaining={freeUnlocksRemaining}
              limit={freeUnlocksLimit}
              disabled={!vehicle?.id || isUnlocking}
              isUnlocking={isUnlocking}
              onUnlock={async () => {
                if (!vehicle?.id) return;
                const result = await useFreeUnlockForVehicle(vehicle.id);
                if (result.ok) {
                  await refreshStatus();
                  Alert.alert("Free unlock applied", result.message);
                  setTab("Specs");
                } else {
                  Alert.alert("Unlock unavailable", result.message || errorMessage || "We couldn’t apply your free unlock right now.");
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
          <>
            <View style={styles.sectionCard}>
              <SectionHeader title="Similar Market Range" subtitle="Approximate market context, not an exact appraisal." />
              <Text style={styles.body}>
                {estimateSupport?.marketSourceLabel ??
                  "Market value is not fully grounded for this result yet. If we find a similar vehicle family, we show an approximate range instead of an exact appraisal."}
              </Text>
              {estimateSupport?.showApproximateMarket && estimateSupport?.groundedVehicleId ? (
                <>
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
                  {valuationLoading ? <Text style={styles.valueLoading}>Updating approximate market range…</Text> : null}
                </>
              ) : (
                <Text style={styles.body}>We’re hiding value inputs here because the nearest family match is too weak to support a meaningful approximate market range.</Text>
              )}
            </View>
            {estimateSupport?.showApproximateMarket &&
            (!isUnavailableValue(valuation.tradeIn) || !isUnavailableValue(valuation.privateParty) || !isUnavailableValue(valuation.dealerRetail)) ? (
              <ValueEstimateCard result={valuation} />
            ) : (
              <View style={styles.sectionCard}>
                <Text style={styles.body}>Approximate market value is not available yet for this estimated result. Try another scan angle or check again after coverage improves.</Text>
              </View>
            )}
          </>
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
                const result = await useFreeUnlockForVehicle(vehicle.id);
                if (result.ok) {
                  await refreshStatus();
                  Alert.alert("Free unlock applied", result.message);
                  setTab("Value");
                } else {
                  Alert.alert("Unlock unavailable", result.message || errorMessage || "We couldn’t apply your free unlock right now.");
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
          <>
            <View style={styles.sectionCard}>
              <SectionHeader title="Similar Listings" subtitle="Comparable market results, not an exact trim-verified listing set." />
              <Text style={styles.body}>
                {estimateSupport?.showApproximateListings && estimateSupport?.marketSourceLabel
                  ? `${estimateSupport.marketSourceLabel} These are similar listings, not an exact trim-verified match.`
                  : "Similar listings are not available yet for this estimated result."}
              </Text>
            </View>
            {estimateSupport?.showApproximateListings && vehicle.listings.length > 0 ? (
              <View style={styles.listingsWrap}>
                {vehicle.listings.map((listing, index) => (
                  <ListingCard key={listing.id} listing={listing} isBest={index === 0} />
                ))}
              </View>
            ) : (
              <View style={styles.sectionCard}>
                <Text style={styles.body}>We’re hiding similar listings here because the nearest grounded family is too broad to make those comparisons useful.</Text>
              </View>
            )}
          </>
        ) : (
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
                const result = await useFreeUnlockForVehicle(vehicle.id);
                if (result.ok) {
                  await refreshStatus();
                  Alert.alert("Free unlock applied", result.message);
                  setTab("For Sale");
                } else {
                  Alert.alert("Unlock unavailable", result.message || errorMessage || "We couldn’t apply your free unlock right now.");
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
          <PrimaryButton label={isEstimateMode ? "Refine With Another Photo" : "Scan Another Vehicle"} onPress={() => router.push("/(tabs)/scan")} />
          <PrimaryButton label="View Pro Features" secondary onPress={() => router.push("/paywall")} />
        </>
      ) : (
        <PrimaryButton label={isEstimateMode ? "Refine With Another Photo" : "Scan Another Vehicle"} onPress={() => router.push("/(tabs)/scan")} />
      )}
      </Animated.View>
      <Modal visible={heroPreviewOpen} transparent animationType="fade" onRequestClose={() => setHeroPreviewOpen(false)}>
        <Pressable style={styles.heroModalBackdrop} onPress={() => setHeroPreviewOpen(false)}>
          <Pressable style={styles.heroModalCard} onPress={(event) => event.stopPropagation()}>
            <Image source={{ uri: heroImageUri }} style={styles.heroModalImage} resizeMode={heroImageFitMode} />
            <View style={styles.heroModalBody}>
              <Text style={styles.heroModalTitle}>
                {isEstimateMode ? estimateHeaderTitle || `${vehicle.make} ${vehicle.model}` : `${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              </Text>
              <Text style={styles.heroModalSubtitle}>
                {isEstimateMode ? estimateSubtitle || "Estimated identification" : `${vehicle.trim} • ${vehicle.bodyStyle}`}
              </Text>
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
      <Text style={styles.unlockTitle}>Use 1 Free Unlock</Text>
      <Text style={styles.unlockBody}>This unlock gives full premium access for this vehicle.</Text>
      <Text style={styles.unlockNote}>
        {used} of {limit} free unlocks used • {Math.max(0, remaining)} remaining
      </Text>
      {remaining > 0 ? (
        <PrimaryButton label={isUnlocking ? "Applying unlock..." : "Use 1 Free Unlock"} onPress={onUnlock} disabled={disabled} />
      ) : null}
      <PrimaryButton label="Unlock Pro" secondary onPress={onUpgrade} />
    </View>
  );
}

const styles = StyleSheet.create({
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
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroTopRow: {
    position: "absolute",
    top: 18,
    left: 18,
    right: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  heroTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  heroIdentity: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 18,
    gap: 8,
  },
  heroTitle: { ...Typography.hero, color: Colors.textStrong, fontSize: 30, lineHeight: 34 },
  heroSubtitle: { ...Typography.body, color: Colors.textSoft },
  heroChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  heroChip: {
    backgroundColor: "rgba(4, 8, 18, 0.58)",
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
  estimateBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.background,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  estimateBadgeLabel: { ...Typography.caption, color: Colors.accent, fontWeight: "700" },
  estimateNotice: { ...cardStyles.secondary, gap: 6 },
  estimateNoticeTitle: { ...Typography.bodyStrong, color: Colors.textStrong },
  estimateNoticeBody: { ...Typography.caption, color: Colors.textMuted },
  sectionCard: { ...cardStyles.primary, padding: 18, gap: 14 },
  listingsWrap: { gap: 18 },
  pageContent: { paddingVertical: 24 },
  listingsPageContent: { paddingVertical: 24, backgroundColor: Colors.backgroundAlt },
  body: { ...Typography.body, color: Colors.textMuted },
  row: { borderTopWidth: 1, borderTopColor: Colors.borderSoft, paddingTop: 14, gap: 4 },
  rowLabel: { ...Typography.caption, color: Colors.textMuted },
  rowValue: { ...Typography.body, color: Colors.textStrong },
  specSupportNote: { ...Typography.caption, color: Colors.textMuted, marginTop: -4, marginBottom: 4 },
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
