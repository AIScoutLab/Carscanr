import AsyncStorage from "@react-native-async-storage/async-storage";
import bundledDataset from "@/assets/data/offline_canonical.json";
import { getVehicleImage } from "@/constants/vehicleImages";
import { formatCurrency } from "@/lib/utils";
import { parseHorsepower } from "@/lib/vehicleData";
import { OfflineCanonicalVehicle, VehicleRecord } from "@/types";

const OFFLINE_CANONICAL_STORAGE_KEY = "offline_canonical_dataset_v1";

type OfflineCanonicalDataset = {
  offline_canonical_version: string;
  generated_at: string;
  vehicles: OfflineCanonicalVehicle[];
};

type OfflineCanonicalIndex = {
  dataset: OfflineCanonicalDataset;
  byId: Map<string, OfflineCanonicalVehicle>;
  byCanonicalKey: Map<string, OfflineCanonicalVehicle>;
  byModelFamily: Map<string, OfflineCanonicalVehicle[]>;
  byMakeModelFamily: Map<string, OfflineCanonicalVehicle[]>;
};

let loadPromise: Promise<OfflineCanonicalIndex> | null = null;

function normalizeText(value: string | undefined | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModelFamily(value: string | undefined | null) {
  return normalizeText(value)
    .replace(/\b(competition|comp|lariat|eddie bauer|platinum|limited|premium|luxury|sport|touring|special|standard|base|xlt|gt|ex|lx|se|sel|xle|le)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function buildCanonicalKey(input: {
  year: number;
  make: string;
  model: string;
  trim?: string | null;
  vehicleType?: string | null;
}) {
  return [
    "canonical",
    input.year,
    normalizeText(input.make).replace(/\s+/g, "-"),
    normalizeText(input.model).replace(/\s+/g, "-"),
    normalizeText(input.trim ?? "base").replace(/\s+/g, "-") || "base",
    normalizeText(input.vehicleType ?? "unknown").replace(/\s+/g, "-") || "unknown",
  ].join(":");
}

function buildFamilyKey(input: { year: number; make: string; model: string }) {
  return `${input.year}:${normalizeText(input.make)}:${normalizeModelFamily(input.model)}`;
}

function buildMakeModelFamilyKey(input: { make: string; model: string }) {
  return `${normalizeText(input.make)}:${normalizeModelFamily(input.model)}`;
}

function isWranglerVehicle(vehicle: Pick<OfflineCanonicalVehicle, "make" | "model">) {
  return normalizeText(vehicle.make) === "jeep" && normalizeText(vehicle.model).includes("wrangler");
}

function isMainstreamGroundingFriendlyFamily(vehicle: Pick<OfflineCanonicalVehicle, "make" | "model">) {
  const make = normalizeText(vehicle.make);
  const model = normalizeText(vehicle.model);
  const combined = `${make} ${model}`;
  return (
    (make === "honda" && /(cr v|crv|civic|accord)/.test(model)) ||
    (make === "toyota" && /(camry|rav4)/.test(model)) ||
    (make === "tesla" && /model 3/.test(model)) ||
    (make === "ford" && /(f 150|f150)/.test(combined)) ||
    ((make === "chevrolet" || make === "chevy") && /silverado/.test(model))
  );
}

function getWranglerGenerationFromYear(year: number) {
  if (year >= 1997 && year <= 2006) {
    return "TJ" as const;
  }
  if (year >= 2007 && year <= 2018) {
    return "JK" as const;
  }
  if (year >= 2018) {
    return "JL" as const;
  }
  return null;
}

function selectPresentationVehicles(
  groundedVehicles: OfflineCanonicalVehicle[],
  bestVehicle: OfflineCanonicalVehicle | null,
) {
  if (!bestVehicle || !isWranglerVehicle(bestVehicle)) {
    return groundedVehicles;
  }

  const generation = getWranglerGenerationFromYear(bestVehicle.year);
  if (!generation) {
    return groundedVehicles;
  }

  const generationVehicles = groundedVehicles.filter((vehicle) => getWranglerGenerationFromYear(vehicle.year) === generation);
  return generationVehicles.length > 0 ? generationVehicles : groundedVehicles;
}

function formatHorsepowerValue(value: number) {
  return `${value} hp`;
}

function getTrustedFamilySpecValue(values: Array<string | null | undefined>, allowDominant = false) {
  const normalized = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  const unique = [...new Set(normalized)];
  if (unique.length === 1) {
    return unique[0];
  }
  if (!allowDominant || normalized.length < 2) {
    return null;
  }

  const counts = new Map<string, number>();
  normalized.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const [candidate, count] = ranked[0] ?? [];
  if (!candidate || !count) {
    return null;
  }

  const ratio = count / normalized.length;
  return ratio >= 0.6 ? candidate : null;
}

function buildMsrpRangeLabel(values: number[]) {
  const unique = [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
  if (unique.length === 0) {
    return null;
  }
  if (unique.length === 1) {
    return formatCurrency(unique[0]);
  }
  return `${formatCurrency(unique[0])} - ${formatCurrency(unique[unique.length - 1])}`;
}

function createEmptyListings() {
  return [];
}

function buildDatasetIndex(dataset: OfflineCanonicalDataset): OfflineCanonicalIndex {
  const byId = new Map<string, OfflineCanonicalVehicle>();
  const byCanonicalKey = new Map<string, OfflineCanonicalVehicle>();
  const byModelFamily = new Map<string, OfflineCanonicalVehicle[]>();
  const byMakeModelFamily = new Map<string, OfflineCanonicalVehicle[]>();

  dataset.vehicles.forEach((vehicle) => {
    byId.set(vehicle.id, vehicle);
    byCanonicalKey.set(vehicle.canonicalKey, vehicle);
    const familyKey = buildFamilyKey({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
    });
    const existing = byModelFamily.get(familyKey) ?? [];
    existing.push(vehicle);
    byModelFamily.set(familyKey, existing);

    const makeModelFamilyKey = buildMakeModelFamilyKey({
      make: vehicle.make,
      model: vehicle.model,
    });
    const existingFamily = byMakeModelFamily.get(makeModelFamilyKey) ?? [];
    existingFamily.push(vehicle);
    byMakeModelFamily.set(makeModelFamilyKey, existingFamily);
  });

  console.log("[offline-canonical] OFFLINE_CANONICAL_LOADED", {
    version: dataset.offline_canonical_version,
    vehicleCount: dataset.vehicles.length,
  });

  return { dataset, byId, byCanonicalKey, byModelFamily, byMakeModelFamily };
}

function scoreTrimCompatibility(vehicle: OfflineCanonicalVehicle, requestedTrim: string | undefined | null) {
  const requested = normalizeModelFamily(requestedTrim);
  if (!requested) {
    return 0;
  }
  const candidate = normalizeModelFamily(vehicle.trim);
  if (!candidate) {
    return 0;
  }
  if (candidate === requested) {
    return 3;
  }
  if (candidate.includes(requested) || requested.includes(candidate)) {
    return 2;
  }
  return 0;
}

function chooseBestGroundedVehicle(
  vehicles: OfflineCanonicalVehicle[],
  input: { year?: number | null; trim?: string | null; vehicleType?: string | null },
) {
  const requestedYear = typeof input.year === "number" ? input.year : null;
  const requestedVehicleType = normalizeText(input.vehicleType);

  const filteredByType = requestedVehicleType
    ? vehicles.filter((vehicle) => normalizeText(vehicle.vehicleType) === requestedVehicleType)
    : vehicles;

  const candidates = filteredByType.length > 0 ? filteredByType : vehicles;

  return [...candidates].sort((left, right) => {
    const trimScoreDelta = scoreTrimCompatibility(right, input.trim) - scoreTrimCompatibility(left, input.trim);
    if (trimScoreDelta !== 0) {
      return trimScoreDelta;
    }

    if (requestedYear != null) {
      const leftDelta = Math.abs(left.year - requestedYear);
      const rightDelta = Math.abs(right.year - requestedYear);
      if (leftDelta !== rightDelta) {
        return leftDelta - rightDelta;
      }
    }

    return left.year - right.year;
  })[0] ?? null;
}

function getGroundingWindowYears(input: {
  year?: number | null;
  mainstreamFriendly: boolean;
  wrangler: boolean;
}) {
  if (typeof input.year !== "number") {
    return null;
  }
  if (input.wrangler) {
    return 1;
  }
  if (input.mainstreamFriendly) {
    return 3;
  }
  return 2;
}

async function syncBundledDataset() {
  const bundled = bundledDataset as OfflineCanonicalDataset;
  const storedRaw = await AsyncStorage.getItem(OFFLINE_CANONICAL_STORAGE_KEY);
  if (!storedRaw) {
    await AsyncStorage.setItem(OFFLINE_CANONICAL_STORAGE_KEY, JSON.stringify(bundled));
    console.log("[offline-canonical] OFFLINE_DATASET_UPDATED", {
      reason: "initial-bundle-sync",
      version: bundled.offline_canonical_version,
    });
    return bundled;
  }

  try {
    const stored = JSON.parse(storedRaw) as OfflineCanonicalDataset;
    if (stored.offline_canonical_version !== bundled.offline_canonical_version) {
      console.log("[offline-canonical] OFFLINE_DATASET_UPDATE_AVAILABLE", {
        currentVersion: stored.offline_canonical_version,
        nextVersion: bundled.offline_canonical_version,
      });
      await AsyncStorage.setItem(OFFLINE_CANONICAL_STORAGE_KEY, JSON.stringify(bundled));
      console.log("[offline-canonical] OFFLINE_DATASET_UPDATED", {
        reason: "bundled-version-newer",
        version: bundled.offline_canonical_version,
      });
      return bundled;
    }
    return stored;
  } catch {
    await AsyncStorage.setItem(OFFLINE_CANONICAL_STORAGE_KEY, JSON.stringify(bundled));
    console.log("[offline-canonical] OFFLINE_DATASET_UPDATED", {
      reason: "stored-dataset-invalid",
      version: bundled.offline_canonical_version,
    });
    return bundled;
  }
}

function mapOfflineVehicleToRecord(vehicle: OfflineCanonicalVehicle): VehicleRecord {
  const parsedHorsepower = parseHorsepower(vehicle.basicSpecs.horsepower);
  console.log("[offline-canonical] HORSEPOWER_MAPPING", {
    vehicleId: vehicle.id,
    rawHorsepower: vehicle.basicSpecs.horsepower ?? null,
    parsedHorsepower,
  });
  const valuation = vehicle.lightweightValue
    ? {
        tradeIn: formatCurrency(vehicle.lightweightValue.tradeIn),
        tradeInRange: `${formatCurrency(vehicle.lightweightValue.tradeIn)} - ${formatCurrency(vehicle.lightweightValue.tradeIn)}`,
        privateParty: formatCurrency(vehicle.lightweightValue.privateParty),
        privatePartyRange: `${formatCurrency(vehicle.lightweightValue.privateParty)} - ${formatCurrency(vehicle.lightweightValue.privateParty)}`,
        dealerRetail: formatCurrency(vehicle.lightweightValue.dealerRetail),
        dealerRetailRange: `${formatCurrency(vehicle.lightweightValue.dealerRetail)} - ${formatCurrency(vehicle.lightweightValue.dealerRetail)}`,
        confidenceLabel: vehicle.lightweightValue.confidenceLabel,
        sourceLabel: vehicle.lightweightValue.sourceLabel,
        modelType: "modeled" as const,
      }
    : {
        tradeIn: "Unavailable",
        tradeInRange: "Unavailable",
        privateParty: "Unavailable",
        privatePartyRange: "Unavailable",
        dealerRetail: "Unavailable",
        dealerRetailRange: "Unavailable",
        confidenceLabel: "Offline quick estimate",
        sourceLabel: "Quick result",
        modelType: "modeled" as const,
      };

  return {
    id: vehicle.id,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    bodyStyle: vehicle.basicSpecs.bodyStyle,
    heroImage: getVehicleImage(vehicle.id, vehicle.vehicleType),
    overview: `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim} from bundled offline canonical data.`,
    specs: {
      engine: vehicle.basicSpecs.engine,
      horsepower: parsedHorsepower,
      torque: vehicle.basicSpecs.torque,
      transmission: vehicle.basicSpecs.transmission,
      drivetrain: vehicle.basicSpecs.drivetrain,
      mpgOrRange: vehicle.basicSpecs.mpgOrRange,
      exteriorColors: vehicle.basicSpecs.exteriorColors,
      msrp: vehicle.basicSpecs.msrp,
    },
    valuation,
    listings: createEmptyListings(),
  };
}

export const offlineCanonicalService = {
  async preload() {
    if (!loadPromise) {
      loadPromise = syncBundledDataset().then(buildDatasetIndex);
    }
    return loadPromise;
  },

  async getDatasetVersion() {
    const index = await this.preload();
    return index.dataset.offline_canonical_version;
  },

  async findById(id: string) {
    const index = await this.preload();
    return index.byId.get(id) ?? null;
  },

  async matchCandidate(input: { id?: string | null; year: number; make: string; model: string; trim?: string | null; vehicleType?: string | null }) {
    const index = await this.preload();
    if (input.id) {
      const direct = index.byId.get(input.id);
      if (direct) {
        return { vehicle: direct, matchType: "id" as const, datasetVersion: index.dataset.offline_canonical_version };
      }
    }

    const canonicalKey = buildCanonicalKey({
      year: input.year,
      make: input.make,
      model: input.model,
      trim: input.trim,
      vehicleType: input.vehicleType,
    });
    const exact = index.byCanonicalKey.get(canonicalKey);
    if (exact) {
      return { vehicle: exact, matchType: "exact" as const, datasetVersion: index.dataset.offline_canonical_version };
    }

    const familyMatches = index.byModelFamily.get(
      buildFamilyKey({
        year: input.year,
        make: input.make,
        model: input.model,
      }),
    ) ?? [];
    if (familyMatches.length > 0) {
      return { vehicle: familyMatches[0], matchType: "model-family" as const, datasetVersion: index.dataset.offline_canonical_version };
    }

    return null;
  },

  async resolveVehiclePresentation(input: {
    id?: string | null;
    year?: number | null;
    make: string;
    model: string;
    trim?: string | null;
    vehicleType?: string | null;
  }) {
    const index = await this.preload();

    const direct = input.id ? index.byId.get(input.id) ?? null : null;
    const exact =
      typeof input.year === "number"
        ? index.byCanonicalKey.get(
            buildCanonicalKey({
              year: input.year,
              make: input.make,
              model: input.model,
              trim: input.trim,
              vehicleType: input.vehicleType,
            }),
          ) ?? null
        : null;
    const makeModelFamilyMatches = index.byMakeModelFamily.get(
      buildMakeModelFamilyKey({
        make: input.make,
        model: input.model,
      }),
    ) ?? [];

    const groundedVehicles = direct
      ? makeModelFamilyMatches.length > 0
        ? makeModelFamilyMatches
        : [direct]
      : exact
        ? makeModelFamilyMatches.length > 0
          ? makeModelFamilyMatches
          : [exact]
      : makeModelFamilyMatches;

    if (groundedVehicles.length === 0) {
      return null;
    }

    const bestVehicle = direct ?? exact ?? chooseBestGroundedVehicle(groundedVehicles, input);
    const presentationVehicles = selectPresentationVehicles(groundedVehicles, bestVehicle);
    const years = presentationVehicles.map((vehicle) => vehicle.year).sort((a, b) => a - b);
    return {
      vehicle: bestVehicle,
      yearRange: {
        start: years[0],
        end: years[years.length - 1],
      },
      datasetVersion: index.dataset.offline_canonical_version,
      matchType: direct ? ("id" as const) : exact ? ("exact" as const) : ("model-family-range" as const),
      candidateCount: presentationVehicles.length,
    };
  },

  async resolveHorsepowerSupport(input: {
    year?: number | null;
    make: string;
    model: string;
    trim?: string | null;
    vehicleType?: string | null;
  }) {
    const index = await this.preload();
    const familyMatches = index.byMakeModelFamily.get(
      buildMakeModelFamilyKey({
        make: input.make,
        model: input.model,
      }),
    ) ?? [];

    if (familyMatches.length === 0) {
      return null;
    }

    const bestVehicle = chooseBestGroundedVehicle(familyMatches, input);
    const presentationVehicles = selectPresentationVehicles(familyMatches, bestVehicle);
    const mainstreamFriendly = bestVehicle ? isMainstreamGroundingFriendlyFamily(bestVehicle) : false;
    const yearWindow = getGroundingWindowYears({
      year: input.year,
      mainstreamFriendly,
      wrangler: Boolean(bestVehicle && isWranglerVehicle(bestVehicle)),
    });
    const nearbyVehicles =
      typeof input.year === "number" && typeof yearWindow === "number"
        ? presentationVehicles.filter((vehicle) => Math.abs(vehicle.year - input.year!) <= yearWindow)
        : presentationVehicles;
    const horsepowerVehicles = (nearbyVehicles.length > 0 ? nearbyVehicles : presentationVehicles)
      .map((vehicle) => ({
        vehicle,
        horsepower: parseHorsepower(vehicle.basicSpecs.horsepower),
      }))
      .filter((entry): entry is { vehicle: OfflineCanonicalVehicle; horsepower: number } => typeof entry.horsepower === "number");

    if (horsepowerVehicles.length === 0) {
      return null;
    }

    const exactTrimMatches =
      input.trim && input.trim.trim().length > 0
        ? horsepowerVehicles.filter((entry) => scoreTrimCompatibility(entry.vehicle, input.trim) >= 3)
        : [];
    const exactYearMatches =
      typeof input.year === "number"
        ? horsepowerVehicles.filter((entry) => entry.vehicle.year === input.year)
        : [];

    const preferredExact = exactTrimMatches[0] ?? exactYearMatches[0] ?? null;
    if (preferredExact) {
      return {
        label: "Horsepower",
        value: formatHorsepowerValue(preferredExact.horsepower),
        numericValue: preferredExact.horsepower,
        exact: true,
      };
    }

    const uniqueHorsepower = [...new Set(horsepowerVehicles.map((entry) => entry.horsepower))].sort((a, b) => a - b);
    if (uniqueHorsepower.length === 1) {
      return {
        label: "Typical horsepower",
        value: formatHorsepowerValue(uniqueHorsepower[0]),
        numericValue: uniqueHorsepower[0],
        exact: false,
      };
    }

    return {
      label: "Horsepower varies by trim",
      value: `${uniqueHorsepower[0]}-${uniqueHorsepower[uniqueHorsepower.length - 1]} hp`,
      numericValue: null,
      exact: false,
    };
  },

  async resolveApproximateFamilySupport(input: {
    year?: number | null;
    make: string;
    model: string;
    trim?: string | null;
    vehicleType?: string | null;
  }) {
    const index = await this.preload();
    const familyMatches = index.byMakeModelFamily.get(
      buildMakeModelFamilyKey({
        make: input.make,
        model: input.model,
      }),
    ) ?? [];

    if (familyMatches.length === 0) {
      return null;
    }

    const bestVehicle = chooseBestGroundedVehicle(familyMatches, input);
    const presentationVehicles = selectPresentationVehicles(familyMatches, bestVehicle);
    const mainstreamFriendly = bestVehicle ? isMainstreamGroundingFriendlyFamily(bestVehicle) : false;
    const yearWindow = getGroundingWindowYears({
      year: input.year,
      mainstreamFriendly,
      wrangler: Boolean(bestVehicle && isWranglerVehicle(bestVehicle)),
    });
    const nearbyVehicles =
      typeof input.year === "number" && typeof yearWindow === "number"
        ? presentationVehicles.filter((vehicle) => Math.abs(vehicle.year - input.year!) <= yearWindow)
        : presentationVehicles;
    const groundedVehicles = nearbyVehicles.length > 0 ? nearbyVehicles : presentationVehicles;
    const years = groundedVehicles.map((vehicle) => vehicle.year).sort((a, b) => a - b);
    const exact =
      typeof input.year === "number"
        ? index.byCanonicalKey.get(
            buildCanonicalKey({
              year: input.year,
              make: input.make,
              model: input.model,
              trim: input.trim,
              vehicleType: input.vehicleType,
            }),
          ) ?? null
        : null;

    return {
      vehicle: bestVehicle,
      yearRange: {
        start: years[0],
        end: years[years.length - 1],
      },
      matchType: exact ? ("exact" as const) : ("model-family-range" as const),
      candidateCount: groundedVehicles.length,
      nearestYearDelta:
        typeof input.year === "number" && bestVehicle ? Math.abs(bestVehicle.year - input.year) : null,
      mainstreamFriendly,
      sharedSpecs: {
        engine: getTrustedFamilySpecValue(groundedVehicles.map((vehicle) => vehicle.basicSpecs.engine), mainstreamFriendly),
        transmission: getTrustedFamilySpecValue(groundedVehicles.map((vehicle) => vehicle.basicSpecs.transmission), mainstreamFriendly),
        drivetrain: getTrustedFamilySpecValue(groundedVehicles.map((vehicle) => vehicle.basicSpecs.drivetrain), mainstreamFriendly),
        mpgOrRange: getTrustedFamilySpecValue(groundedVehicles.map((vehicle) => vehicle.basicSpecs.mpgOrRange), mainstreamFriendly),
        bodyStyle: getTrustedFamilySpecValue(groundedVehicles.map((vehicle) => vehicle.basicSpecs.bodyStyle), mainstreamFriendly),
      },
      msrpRangeLabel: buildMsrpRangeLabel(groundedVehicles.map((vehicle) => vehicle.basicSpecs.msrp)),
    };
  },

  mapToVehicleRecord(vehicle: OfflineCanonicalVehicle) {
    return mapOfflineVehicleToRecord(vehicle);
  },
};
